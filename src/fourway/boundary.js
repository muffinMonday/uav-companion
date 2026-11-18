// The ONLY module that writes 4-way bytes. Every request goes through one private method that runs buildRequest() (the allowlist),
// and the MSP enter frame through the same single transport write. Every wait uses the injected clock. Nothing here throws to the caller.
import { ACK, FOURWAY_CMD, FourWayParser, buildEnterFrame, buildRequest, parseEnterReply } from './codec.js';
import { EXPECTED_CHANNELS, FOURWAY_TIMINGS } from './constants.js';
import { classifyInit, readPlan } from './identify.js';

const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

export class FourWayBoundary {
  constructor({ transport, clock, timings = FOURWAY_TIMINGS, shouldAbort = null } = {}) {
    this.transport = transport;
    this.clock = clock;
    this.T = timings;
    this._shouldAbort = shouldAbort;
    this._aborted = false;
    this._active = false;
    this._mode = 'idle'; // idle | enter | fourway
    this._parser = new FourWayParser();
    this._enterBuf = [];
    this._pending = null;
    this._enterPending = null;
    transport.onData((bytes) => this._onData(bytes));
    transport.onClose(() => this._onClose());
  }

  get active() { return this._active; }
  abort() { this._aborted = true; }

  // ---- plumbing
  _now() { return typeof this.clock.now === 'function' ? this.clock.now() : Date.now(); }
  _sleep(ms) { return new Promise((r) => this.clock.setTimeout(r, ms)); }
  _stop(extra) {
    if (this._aborted) return true;
    for (const f of [extra, this._shouldAbort]) { try { if (typeof f === 'function' && f()) this._aborted = true; } catch { this._aborted = true; } }
    return this._aborted;
  }

  // The single transport write in this module.
  _emit(bytes, onFail) {
    try {
      const r = this.transport._write(bytes);
      if (r && typeof r.then === 'function') r.then(undefined, () => onFail && onFail());
      return true;
    } catch { return false; }
  }

  _onData(bytes) {
    try {
      if (this._mode === 'enter') {
        for (const b of bytes) this._enterBuf.push(b);
        const i = this._enterBuf.indexOf(0x24);
        if (i < 0) { this._enterBuf = []; return; }
        if (i > 0) this._enterBuf.splice(0, i);
        const r = parseEnterReply(this._enterBuf);
        if (!r.ok && r.reason === 'short') return;
        const rest = this._enterBuf.slice(r.ok ? r.length : this._enterBuf.length);
        this._enterBuf = [];
        const p = this._enterPending;
        if (!p) return;
        if (r.ok) { this._mode = 'fourway'; this._parser.reset(); p.finish({ ok: true, escCount: r.escCount, reason: null }); if (rest.length) this._onData(Uint8Array.from(rest)); }
        else p.finish({ ok: false, escCount: 0, reason: r.reason });
      } else if (this._mode === 'fourway') {
        for (const ev of this._parser.push(bytes)) {
          const p = this._pending;
          if (!p) continue;
          if (ev.type === 'error') { if (ev.code === 'bad-crc') p.finish({ ok: false, reason: 'bad-crc' }); continue; }
          if (ev.cmd !== p.cmd || ev.addr !== p.addr) continue; // not for the pending request
          if (ev.ack !== ACK.OK) p.finish({ ok: false, reason: 'ack-' + hex(ev.ack), ack: ev.ack });
          else p.finish({ ok: true, frame: ev });
        }
      }
    } catch { /* a malformed chunk never throws out of the data listener */ }
  }

  _onClose() {
    if (this._pending) this._pending.finish({ ok: false, reason: 'closed' });
    if (this._enterPending) this._enterPending.finish({ ok: false, escCount: 0, reason: 'closed' });
    this._active = false;
    this._mode = 'idle';
  }

  _xfer(spec, timeoutMs) {
    return new Promise((resolve) => {
      if (!this._active || this._mode !== 'fourway') return resolve({ ok: false, reason: 'not-in-fourway' });
      if (this._pending) return resolve({ ok: false, reason: 'busy' });
      if (this._aborted && spec.cmd !== FOURWAY_CMD.INTERFACE_EXIT) return resolve({ ok: false, reason: 'aborted' });
      let req;
      try { req = buildRequest(spec); } catch (e) { return resolve({ ok: false, reason: (e && e.reason) || 'refused' }); }
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        this.clock.clearTimeout(timer);
        if (this._pending === pend) this._pending = null;
        resolve(r);
      };
      const pend = { cmd: req[1], addr: (req[2] << 8) | req[3], finish };
      const timer = this.clock.setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
      this._pending = pend;
      this._parser.reset();
      if (!this._emit(req, () => finish({ ok: false, reason: 'write-failed' }))) finish({ ok: false, reason: 'write-failed' });
    });
  }

  // ---- public API
  async enter() {
    if (this._active) return { ok: false, escCount: 0, reason: 'already-active' };
    return new Promise((resolve) => {
      this._active = true;
      this._mode = 'enter';
      this._aborted = false;
      this._enterBuf = [];
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        this.clock.clearTimeout(timer);
        this._enterPending = null;
        if (!r.ok) {
          if (r.reason === 'msp-error') { this._active = false; this._mode = 'idle'; } // the FC refused: it did not enter 4-way
          else if (this._mode === 'enter') { this._mode = 'fourway'; this._parser.reset(); } // unknown state: stay active so exit() is attempted
        }
        resolve(r);
      };
      const timer = this.clock.setTimeout(() => finish({ ok: false, escCount: 0, reason: 'timeout' }), this.T.enterReplyMs);
      this._enterPending = { finish };
      if (!this._emit(buildEnterFrame(), () => finish({ ok: false, escCount: 0, reason: 'write-failed' }))) finish({ ok: false, escCount: 0, reason: 'write-failed' });
    });
  }

  async identifyAll({ count, onProgress, shouldAbort } = {}) {
    const n = Number.isInteger(count) && count > 0 ? Math.min(count, 8, EXPECTED_CHANNELS) : 0;
    const out = [];
    const progress = (p) => { try { if (onProgress) onProgress(p); } catch { /* observer errors are ignored */ } };
    const T = this.T;
    const deadline = this._now() + T.overallMs;
    const fail = (channel, error, init = null, blocks = {}) => ({ channel, init, blocks, error });
    if (!n) return out;
    const failAll = (reason) => { for (let c = 0; c < n; c++) out.push(fail(c, reason)); return out; };
    if (!this._active || this._mode !== 'fourway') return failAll('not-in-fourway');
    // probe the interface first
    progress({ phase: 'probe', channel: null, total: n });
    const alive = await this._xfer({ cmd: FOURWAY_CMD.TEST_ALIVE }, T.cmdMs);
    if (!alive.ok) return failAll('probe-' + alive.reason);
    const ver = await this._xfer({ cmd: FOURWAY_CMD.PROTOCOL_GET_VERSION }, T.cmdMs);
    if (!ver.ok) return failAll('probe-' + ver.reason);
    if (ver.frame.params[0] !== 108) return failAll('unsupported-protocol');
    const nm = await this._xfer({ cmd: FOURWAY_CMD.INTERFACE_GET_NAME }, T.cmdMs);
    if (!nm.ok) return failAll('probe-' + nm.reason);
    if (String.fromCharCode(...nm.frame.params.slice(0, 3)) !== 'm4w') return failAll('unsupported-interface');

    for (let ch = 0; ch < n; ch++) {
      progress({ phase: 'init', channel: ch, total: n });
      const one = await this._identifyChannel(ch, deadline, shouldAbort);
      out.push(one);
      progress({ phase: 'channel', channel: ch, total: n, result: one });
    }
    progress({ phase: 'done', channel: null, total: n });
    return out;
  }

  async _identifyChannel(ch, deadline, shouldAbort) {
    const T = this.T;
    let init = null;
    let last = 'timeout';
    for (let a = 0; a < T.initAttempts; a++) {
      if (this._stop(shouldAbort)) return { channel: ch, init: null, blocks: {}, error: 'aborted' };
      if (this._now() > deadline) return { channel: ch, init: null, blocks: {}, error: 'overall-timeout' };
      const r = await this._xfer({ cmd: FOURWAY_CMD.DEVICE_INIT_FLASH, params: [ch] }, T.initAttemptMs);
      if (r.ok && r.frame.params.length >= 4) { init = classifyInit(r.frame.params); break; }
      last = r.ok ? 'short-init' : r.reason;
      if (r.reason === 'closed' || r.reason === 'aborted') break;
      if (a < T.initAttempts - 1) await this._sleep(T.initSpacingMs);
    }
    if (!init) return { channel: ch, init: null, blocks: {}, error: last };
    const blocks = {};
    for (const step of readPlan(init)) {
      if (this._stop(shouldAbort)) return { channel: ch, init, blocks, error: 'aborted' };
      const r = await this._xfer({ cmd: FOURWAY_CMD.DEVICE_READ, addr: step.addr, params: [step.len] }, T.readMs);
      if (!r.ok) return { channel: ch, init, blocks, error: 'read-' + r.reason };
      if (r.frame.params.length !== step.len) return { channel: ch, init, blocks, error: 'read-short' };
      blocks[step.tag] = r.frame.params;
    }
    return { channel: ch, init, blocks, error: null };
  }

  async resetChannels(channels) {
    const out = [];
    for (const channel of Array.isArray(channels) ? channels : []) {
      if (this._stop()) { out.push({ channel, ok: false }); continue; }
      const r = await this._xfer({ cmd: FOURWAY_CMD.DEVICE_RESET, addr: 0, params: [channel] }, this.T.resetMs);
      out.push({ channel, ok: r.ok });
    }
    return out;
  }

  async exit() {
    if (!this._active) return { ok: true, reason: 'not-active' };
    if (this._mode === 'enter') { this._mode = 'fourway'; this._parser.reset(); }
    let reason = 'timeout';
    for (let a = 0; a < this.T.exitAttempts; a++) {
      const r = await this._xfer({ cmd: FOURWAY_CMD.INTERFACE_EXIT }, this.T.exitMs);
      if (r.ok) { this._active = false; this._mode = 'idle'; this._parser.reset(); return { ok: true, reason: null }; }
      reason = r.reason;
      if (r.reason === 'closed') break;
    }
    return { ok: false, reason };
  }
}
