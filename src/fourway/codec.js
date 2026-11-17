// 4-way interface codec. The ONLY place that names or numbers the prohibited commands. buildRequest() can encode the allowlist and nothing else.
export const FOURWAY_CMD = Object.freeze({
  TEST_ALIVE: 0x30,
  PROTOCOL_GET_VERSION: 0x31,
  INTERFACE_GET_NAME: 0x32,
  INTERFACE_GET_VERSION: 0x33,
  INTERFACE_EXIT: 0x34,
  DEVICE_RESET: 0x35,
  DEVICE_INIT_FLASH: 0x37,
  DEVICE_READ: 0x3a,
});

// Documented so the tests can prove none of them is encodable. Never used to build a frame.
export const PROHIBITED_CMD = Object.freeze({
  DEVICE_ERASE_ALL: 0x38,
  DEVICE_PAGE_ERASE: 0x39,
  DEVICE_WRITE: 0x3b,
  C2CK_LOW: 0x3c,
  DEVICE_READ_EEPROM: 0x3d,
  DEVICE_WRITE_EEPROM: 0x3e,
  INTERFACE_SET_MODE: 0x3f,
  DEVICE_VERIFY: 0x40,
});

export const ACK = Object.freeze({ OK: 0x00, INVALID_CMD: 0x02, INVALID_CRC: 0x03, VERIFY_ERROR: 0x04, INVALID_CHANNEL: 0x08, INVALID_PARAM: 0x09, GENERAL_ERROR: 0x0f });

export class FourWayRefused extends Error {
  constructor(reason, message) { super(message || `4-way request refused: ${reason}`); this.name = 'FourWayRefused'; this.reason = reason; }
}

const REQ_START = 0x2f;
const RESP_START = 0x2e;
const ALLOWED = new Set(Object.values(FOURWAY_CMD));
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function crc16Xmodem(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const withCrc = (body) => { const c = crc16Xmodem(body); return Uint8Array.from([...body, c >> 8, c & 0xff]); };

export function buildRequest({ cmd, addr = 0, params = [0] } = {}) {
  if (!Number.isInteger(cmd) || !ALLOWED.has(cmd)) throw new FourWayRefused('not-allowlisted');
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) throw new FourWayRefused('bad-addr');
  if (!Array.isArray(params) && !(params instanceof Uint8Array)) throw new FourWayRefused('bad-params');
  if (params.length !== 1) throw new FourWayRefused('bad-params');
  const p = params[0];
  if (!Number.isInteger(p)) throw new FourWayRefused('bad-params');
  if (cmd === FOURWAY_CMD.DEVICE_INIT_FLASH || cmd === FOURWAY_CMD.DEVICE_RESET) {
    if (!isInt(p, 0, 7)) throw new FourWayRefused('bad-channel');
    if (addr !== 0) throw new FourWayRefused('bad-addr');
  } else if (cmd === FOURWAY_CMD.DEVICE_READ) {
    if (!isInt(p, 1, 255)) throw new FourWayRefused('bad-length');
    if (addr > 0xfffe) throw new FourWayRefused('bad-addr');
  } else {
    if (p !== 0) throw new FourWayRefused('bad-params');
    if (addr !== 0) throw new FourWayRefused('bad-addr');
  }
  return withCrc([REQ_START, cmd, addr >> 8, addr & 0xff, 1, p]);
}

// MSP v1 request '$M<' size 0, id 245 (empty payload = ESC 4-way pass-through).
export function buildEnterFrame() { return Uint8Array.from([0x24, 0x4d, 0x3c, 0x00, 0xf5, 0xf5]); }

// Synthetic FC and tests only.
export function encodeResponse({ cmd, addr = 0, params = [0], ack = 0 } = {}) {
  const p = params.length ? Array.from(params) : [0];
  if (p.length > 256) throw new FourWayRefused('oversize');
  return withCrc([RESP_START, cmd & 0xff, (addr >> 8) & 0xff, addr & 0xff, p.length & 0xff, ...p, ack & 0xff]);
}

export class FourWayParser {
  constructor({ maxParams = 256 } = {}) { this.maxParams = maxParams; this.buf = []; }
  reset() { this.buf = []; }
  push(bytes) {
    const events = [];
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i] & 0xff);
    const b = this.buf;
    for (;;) {
      if (!b.length) break;
      if (b[0] !== RESP_START) {
        let k = 1;
        while (k < b.length && b[k] !== RESP_START) k++;
        b.splice(0, k);
        events.push({ type: 'error', code: 'bad-start' });
        continue;
      }
      if (b.length < 5) break;
      const n = b[4] === 0 ? 256 : b[4];
      if (n > this.maxParams) { b.splice(0, 1); events.push({ type: 'error', code: 'oversize' }); continue; }
      const total = 8 + n;
      if (b.length < total) break;
      const frame = b.slice(0, total);
      b.splice(0, total);
      const crc = crc16Xmodem(frame.slice(0, total - 2));
      if (crc !== ((frame[total - 2] << 8) | frame[total - 1])) { events.push({ type: 'error', code: 'bad-crc' }); continue; }
      events.push({ type: 'frame', cmd: frame[1], addr: (frame[2] << 8) | frame[3], params: Uint8Array.from(frame.slice(5, 5 + n)), ack: frame[5 + n] });
    }
    return events;
  }
}

// Tiny MSP v1 checker: '$M>' size 1, id 245, one payload byte (the ESC count), xor checksum. Reason 'short' means wait for more bytes.
export function parseEnterReply(mspBytes) {
  const b = mspBytes || [];
  if (b.length < 3) return { ok: false, reason: 'short' };
  if (b[0] !== 0x24 || b[1] !== 0x4d) return { ok: false, reason: 'bad-header' };
  if (b[2] === 0x21) return { ok: false, reason: 'msp-error' };
  if (b[2] !== 0x3e) return { ok: false, reason: 'bad-header' };
  if (b.length < 4) return { ok: false, reason: 'short' };
  if (b[3] !== 1) return { ok: false, reason: 'bad-size' };
  if (b.length < 5) return { ok: false, reason: 'short' };
  if (b[4] !== 245) return { ok: false, reason: 'bad-cmd' };
  if (b.length < 7) return { ok: false, reason: 'short' };
  if (((b[3] ^ b[4] ^ b[5]) & 0xff) !== b[6]) return { ok: false, reason: 'bad-checksum' };
  return { ok: true, escCount: b[5], length: 7 };
}
