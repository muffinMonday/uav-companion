// Motor diagnostics: transports. Backlog sections 3 (Android boundary) and 12.
//
// A transport moves bytes. It also enforces the read-only rule at the last step: write() throws unless the bytes are
// exactly one allowlisted read request (isAllowedRequestFrame). So even a bug above this layer cannot send a motor
// command, a CLI line or any other write.
//
// Adapters: WebSerialTransport (desktop Chrome/Edge, and Chrome for Android 148+ where the device exposes the serial port)
// and MockTransport (tests, synthetic fixtures). A Capacitor / usb-serial-for-android bridge is a spike prototype only
// (tools/preflight-spike/CAPACITOR_BRIDGE.md); it is not adopted and implements this same interface.
import { isAllowedRequestFrame, MspError } from './msp-codec.js';

export class Transport {
  constructor(kind) { this.kind = kind; this._data = []; this._close = []; }
  onData(cb) { this._data.push(cb); }
  onClose(cb) { this._close.push(cb); }
  _emitData(bytes) { for (const cb of this._data) cb(bytes); }
  _emitClose(reason) { for (const cb of this._close) cb(reason); }
  write(bytes) {
    if (!isAllowedRequestFrame(bytes)) throw new MspError('write-blocked', 'only allowlisted read requests may be written');
    return this._write(bytes);
  }
}

export const hasWebSerial = (nav = globalThis.navigator) => !!nav && 'serial' in nav;

export class WebSerialTransport extends Transport {
  constructor(port, opts = {}) { super('web-serial'); this.port = port; this.baudRate = opts.baudRate || 115200; this._open = false; }
  // Must be called from a user gesture (Chrome requires it for requestPort).
  static async request(nav = globalThis.navigator, filters = []) {
    if (!hasWebSerial(nav)) throw new MspError('no-web-serial', 'Web Serial is not available in this browser');
    return new WebSerialTransport(await nav.serial.requestPort({ filters }));
  }
  async open() {
    await this.port.open({ baudRate: this.baudRate });
    this._open = true;
    this._writer = this.port.writable.getWriter();
    this._reader = this.port.readable.getReader();
    (async () => {
      try {
        for (;;) { const { value, done } = await this._reader.read(); if (done) break; if (value) this._emitData(value); }
      } catch (e) { this._emitClose(e && e.name ? e.name : 'read-error'); return; }
      this._emitClose('closed');
    })();
  }
  info() { try { return this.port.getInfo ? this.port.getInfo() : {}; } catch { return {}; } }
  _write(bytes) { return this._writer.write(bytes); }
  async close() {
    this._open = false;
    try { await this._reader?.cancel(); } catch { /* already closed */ }
    try { this._reader?.releaseLock(); this._writer?.releaseLock(); await this.port.close(); } catch { /* already closed */ }
  }
}

// Synthetic transport. `respond(id)` returns a Uint8Array response frame, 'error' for an MSP error frame, or null for silence.
export class MockTransport extends Transport {
  constructor(respond, opts = {}) { super('mock'); this.respond = respond; this.sent = []; this.delayMs = opts.delayMs ?? 0; this.closed = false; }
  async open() { this.opened = true; }
  _write(bytes) {
    this.sent.push(Uint8Array.from(bytes));
    const id = bytes[4];
    const r = this.respond(id);
    if (r == null) return;
    const out = r === 'error' ? Uint8Array.from([0x24, 0x4d, 0x21, 0, id, id]) : r;
    const send = () => { if (!this.closed) this._emitData(out); };
    if (this.delayMs) setTimeout(send, this.delayMs); else queueMicrotask(send);
  }
  disconnect(reason = 'disconnected') { this.closed = true; this._emitClose(reason); }
  async close() { this.closed = true; }
}
