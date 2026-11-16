// Motor diagnostics: read-only FC session (Phase 1). Sequential allowlisted reads with timeout and one retry.
// No write exists in this module. collectSnapshot() is the only data the inventory and readiness code consume.
import { ALLOWED_REQUESTS, MspParser, MspError, NAME_BY_ID, decode, encodeRequest } from './msp-codec.js';
import { TIMINGS } from './constants.js';

// Order matters only for readability. Identity first: if it fails the snapshot is marked unidentified.
export const SNAPSHOT_READS = Object.freeze([
  'MSP_API_VERSION', 'MSP_FC_VARIANT', 'MSP_FC_VERSION', 'MSP_BOARD_INFO', 'MSP_UID', 'MSP_FEATURE_CONFIG', 'MSP_MOTOR_CONFIG',
  'MSP_ADVANCED_CONFIG', 'MSP_MOTOR_3D_CONFIG', 'MSP_BLACKBOX_CONFIG', 'MSP_DATAFLASH_SUMMARY', 'MSP_SDCARD_SUMMARY',
  'MSP_ANALOG', 'MSP_STATUS_EX', 'MSP_BOXIDS', 'MSP_MOTOR', 'MSP_MOTOR_TELEMETRY',
]);

export class ReadOnlySession {
  constructor(transport, opts = {}) {
    this.t = transport;
    this.timeoutMs = opts.timeoutMs ?? TIMINGS.mspReadTimeoutMs;
    this.retries = opts.retries ?? TIMINGS.mspReadRetries;
    this.parser = new MspParser();
    this.pending = null;
    this.chain = Promise.resolve();
    this.closed = false;
    this.ctx = {}; // filled from MSP_API_VERSION so later decoders can follow API-dependent layouts
    this.parseErrors = 0;
    transport.onData((b) => this._onData(b));
    transport.onClose((r) => { this.closed = true; this._settle({ error: new MspError('transport-closed', String(r)) }); });
  }
  _settle(result) { const p = this.pending; if (!p) return; this.pending = null; clearTimeout(p.timer); result.error ? p.reject(result.error) : p.resolve(result.frame); }
  _onData(bytes) {
    for (const ev of this.parser.push(bytes)) {
      if (ev.type === 'error') { this.parseErrors++; continue; }
      const p = this.pending;
      if (p && ev.cmd === p.id) this._settle({ frame: ev });
      // frames for a command nobody is waiting for are ignored (late reply after a timeout)
    }
  }
  _once(id) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new MspError('transport-closed'));
      const timer = setTimeout(() => this._settle({ error: new MspError('timeout', `${NAME_BY_ID[id]} timed out after ${this.timeoutMs} ms`) }), this.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      try { this.parser.reset(); const w = this.t.write(encodeRequest(id)); if (w && w.catch) w.catch((e) => this._settle({ error: e })); } catch (e) { this._settle({ error: e }); }
    });
  }
  // Serialised: one request in flight at a time.
  request(name) {
    const id = ALLOWED_REQUESTS[name];
    const run = async () => {
      let last;
      for (let a = 0; a <= this.retries; a++) {
        try {
          const f = await this._once(id);
          if (f.flagError) throw new MspError('fc-rejected', `${name} was rejected by the FC`);
          const v = decode(name, f.payload, this.ctx);
          if (name === 'MSP_API_VERSION') this.ctx = { apiMajor: v.major, apiMinor: v.minor };
          return v;
        } catch (e) {
          last = e;
          if (e.code === 'fc-rejected' || e.code === 'short-payload' || e.code === 'transport-closed' || e.code === 'write-blocked' || e.code === 'not-allowlisted') break; // retrying cannot help
        }
      }
      throw last;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
  async collectSnapshot(names = SNAPSHOT_READS) {
    const reads = {};
    for (const n of names) {
      try { reads[n] = { ok: true, value: await this.request(n) }; } catch (e) { reads[n] = { ok: false, error: e.code || 'error', message: e.message }; if (e.code === 'transport-closed') { /* record the rest as failed */ } }
    }
    const v = (n) => (reads[n] && reads[n].ok ? reads[n].value : null);
    return { reads, api: v('MSP_API_VERSION'), variant: v('MSP_FC_VARIANT'), version: v('MSP_FC_VERSION'), parseErrors: this.parseErrors, collectedAt: new Date().toISOString() };
  }
}
