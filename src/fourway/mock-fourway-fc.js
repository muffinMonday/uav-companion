// SYNTHETIC flight controller side of the 4-way interface, layered on a MockTransport or the bench mock. No real aircraft, port or ESC.
// It answers the MSP enter frame, then speaks only 4-way until a successful InterfaceExit. Anything that is not a 4-way frame while in
// 4-way mode is recorded in transport.fourway.mspWhileFourWay and not answered.
import { ACK, FOURWAY_CMD, crc16Xmodem, encodeResponse } from './codec.js';

const ascii = (s, n) => { const o = new Array(n).fill(0); for (let i = 0; i < Math.min(s.length, n); i++) o[i] = s.charCodeAt(i); return o; };

// Sparse memory image: [{addr, bytes}]; everything else reads as 0xFF (erased flash).
function imageFor(spec) {
  const k = spec.kind;
  if (k === 'am32') {
    const off = spec.eepromOffset ?? 0x7c00;
    const [main, sub] = spec.version || [2, 19];
    return [
      { addr: off - 32, bytes: ascii(spec.fileName ?? 'AM32_SYNTH_F051', 16) },
      { addr: off, bytes: [1, 2, 6, main, sub, ...ascii(spec.name ?? 'SYNTH ESC', 12)] },
    ];
  }
  if (k === 'arm-unknown') return [{ addr: 0x7c00, bytes: [1, 2, 3, 32, 4, ...ascii('SYNTH', 12)] }];
  const bluejay = k !== 'blheli_s';
  const [main, sub] = spec.version || (bluejay ? [0, 21] : [16, 7]);
  const bytes = new Array(0x70).fill(0);
  bytes[0] = main; bytes[1] = sub; bytes[2] = 33;
  bytes.splice(64, 16, ...ascii(spec.layout ?? '#S_H_50#', 16));
  bytes.splice(80, 16, ...ascii(spec.mcu ?? '#BLHELI$EFM8B21#', 16));
  bytes.splice(96, 16, ...ascii(spec.name ?? (bluejay ? 'Bluejay' : ''), 16));
  return [{ addr: spec.settingsAddr ?? 0x1a00, bytes }];
}

function readImage(regions, addr, len) {
  const out = new Array(len).fill(0xff);
  for (const r of regions) for (let i = 0; i < len; i++) { const j = addr + i - r.addr; if (j >= 0 && j < r.bytes.length) out[i] = r.bytes[j]; }
  return out;
}

const INIT = {
  bluejay: [0xb2, 0xe8, 0x01, 1], blheli_s: [0xb2, 0xe8, 0x01, 1], am32: [0x06, 0x1f, 0x06, 4], 'arm-unknown': [0x06, 0x1f, 0x01, 4],
  atmel: [0x07, 0x93, 0x00, 2], 'read-timeout': [0xb2, 0xe8, 0x01, 1], 'stuck-in-bootloader': [0xb2, 0xe8, 0x01, 1], badcrc: [0xb2, 0xe8, 0x01, 1], garbage: [0xb2, 0xe8, 0x01, 1],
};

export function attachFourWay(transport, scenario = {}) {
  const sc = { escCount: 4, channels: [], exit: 'ok', afterExit: { motorsDisabled: false }, resetEffect: 'returns-to-app', ...scenario };
  const fw = { active: false, log: [], mspWhileFourWay: [], exited: false, resets: [], stuck: [], entered: false };
  transport.fourway = fw;
  const original = transport._write.bind(transport);
  const stuck = new Set();
  let current = null; // channel last initialised
  const reply = (bytes) => { if (!transport.closed) queueMicrotask(() => { if (!transport.closed) transport._emitData(Uint8Array.from(bytes)); }); };
  const respond = (req, params, ack = 0) => reply(encodeResponse({ cmd: req.cmd, addr: req.addr, params, ack }));
  const specOf = (ch) => sc.channels[ch] || { kind: 'bluejay' };

  const handle = (req) => {
    const p0 = req.params[0];
    switch (req.cmd) {
      case FOURWAY_CMD.TEST_ALIVE: return respond(req, [0]);
      case FOURWAY_CMD.PROTOCOL_GET_VERSION: return respond(req, [108]);
      case FOURWAY_CMD.INTERFACE_GET_NAME: return respond(req, ascii('m4wFCIntf', 9));
      case FOURWAY_CMD.INTERFACE_GET_VERSION: return respond(req, [2, 0]);
      case FOURWAY_CMD.INTERFACE_EXIT: {
        if (sc.exit === 'no-reply' || sc.exit === 'never') return undefined;
        if (sc.exit === 'bad-crc') { const f = encodeResponse({ cmd: req.cmd, addr: req.addr, params: [0] }); f[f.length - 1] ^= 0xff; return reply(f); }
        respond(req, [0]);
        fw.active = false; fw.exited = true;
        if (sc.afterExit && sc.afterExit.motorsDisabled && transport.fc) transport.fc.inject.telemetrySilent = true;
        if (stuck.size && transport.fc) transport.fc.inject.telemetrySilent = true;
        return undefined;
      }
      case FOURWAY_CMD.DEVICE_RESET: {
        fw.resets.push(p0);
        if (sc.resetEffect === 'stays-in-bootloader') stuck.add(p0); else stuck.delete(p0);
        fw.stuck = [...stuck];
        return respond(req, [0]);
      }
      case FOURWAY_CMD.DEVICE_INIT_FLASH: {
        const spec = specOf(p0);
        if (p0 >= sc.escCount || spec.kind === 'silent') return undefined;
        if (spec.kind === 'init-fail') return respond(req, [0], ACK.GENERAL_ERROR);
        if (spec.kind === 'garbage') return reply([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
        const init = spec.init || INIT[spec.kind] || INIT.bluejay;
        current = p0;
        if (spec.kind === 'stuck-in-bootloader') { stuck.add(p0); fw.stuck = [...stuck]; }
        if (spec.kind === 'badcrc') { const f = encodeResponse({ cmd: req.cmd, addr: req.addr, params: init }); f[f.length - 2] ^= 0x55; return reply(f); }
        return respond(req, init);
      }
      case FOURWAY_CMD.DEVICE_READ: {
        if (current === null) return respond(req, [0], ACK.GENERAL_ERROR);
        const spec = specOf(current);
        if (spec.kind === 'read-timeout') return undefined;
        return respond(req, readImage(imageFor(spec), req.addr, p0 === 0 ? 256 : p0));
      }
      default: return respond(req, [0], ACK.INVALID_CMD);
    }
  };

  transport._write = (bytes) => {
    const b = Uint8Array.from(bytes);
    if (!fw.active) {
      if (b.length === 6 && b[0] === 0x24 && b[1] === 0x4d && b[2] === 60 && b[3] === 0 && b[4] === 245) {
        if (transport.sent) transport.sent.push(b);
        fw.entered = true;
        if (sc.enter === 'silent') return undefined;
        fw.active = true;
        const n = sc.escCount & 0xff;
        return reply([0x24, 0x4d, 62, 1, 245, n, 1 ^ 245 ^ n]);
      }
      return original(bytes);
    }
    if (b[0] !== 0x2f || b.length < 8 || b.length !== 7 + (b[4] === 0 ? 256 : b[4])) { fw.mspWhileFourWay.push(b); return undefined; }
    const body = b.slice(0, b.length - 2);
    if (crc16Xmodem(body) !== ((b[b.length - 2] << 8) | b[b.length - 1])) return undefined; // a bad request is swallowed
    const req = { cmd: b[1], addr: (b[2] << 8) | b[3], params: Array.from(b.slice(5, b.length - 2)) };
    fw.log.push({ cmd: req.cmd, addr: req.addr, params: req.params.slice() });
    handle(req);
    return undefined;
  };
  return transport;
}
