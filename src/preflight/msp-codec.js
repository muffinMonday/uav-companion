// Motor diagnostics: minimal READ-ONLY MSP codec. Backlog sections 12, 20.
//
// Only the requests in ALLOWED_REQUESTS can be encoded. MSP_SET_MOTOR (214), every other write, the CLI,
// the 4-way interface, DATAFLASH_ERASE and DATAFLASH_READ are not encodable here: encodeRequest() throws.
// Parsing fails closed: bad checksum, oversize, wrong direction and short payloads are errors, never defaults.
//
// Clean-room: written from the public MSP protocol description and the Betaflight message layouts compared in
// docs/MOTOR_DIAGNOSTICS_MSP_COMPARISON.md. No GPL source is copied.

export const ALLOWED_REQUESTS = Object.freeze({
  MSP_API_VERSION: 1, MSP_FC_VARIANT: 2, MSP_FC_VERSION: 3, MSP_BOARD_INFO: 4, MSP_BUILD_INFO: 5, MSP_RX_CONFIG: 44, MSP_UID: 160, MSP_FEATURE_CONFIG: 36,
  MSP_MOTOR_CONFIG: 131, MSP_ADVANCED_CONFIG: 90, MSP_ANALOG: 110, MSP_BLACKBOX_CONFIG: 80,
  MSP_MOTOR_TELEMETRY: 139, MSP_MOTOR: 104, MSP_STATUS_EX: 150, MSP_MOTOR_3D_CONFIG: 124,
  MSP_DATAFLASH_SUMMARY: 70, MSP_SDCARD_SUMMARY: 79, MSP_BOXIDS: 119,
});
const ALLOWED_IDS = new Set(Object.values(ALLOWED_REQUESTS));
export const NAME_BY_ID = Object.freeze(Object.fromEntries(Object.entries(ALLOWED_REQUESTS).map(([k, v]) => [v, k])));

export class MspError extends Error {
  constructor(code, message) { super(message || code); this.name = 'MspError'; this.code = code; }
}

export function encodeRequest(nameOrId) {
  const id = typeof nameOrId === 'string' ? ALLOWED_REQUESTS[nameOrId] : nameOrId;
  if (!Number.isInteger(id) || !ALLOWED_IDS.has(id)) throw new MspError('not-allowlisted', `MSP request ${nameOrId} is not on the read-only allowlist`);
  // MSP v1, no payload: '$' 'M' '<' size cmd checksum(size ^ cmd)
  return Uint8Array.of(0x24, 0x4d, 0x3c, 0, id, id);
}

// A byte string may leave the app only if it is exactly one allowlisted, payload-free MSP v1 read request.
export function isAllowedRequestFrame(bytes) {
  if (!bytes || bytes.length !== 6) return false;
  return bytes[0] === 0x24 && bytes[1] === 0x4d && bytes[2] === 0x3c && bytes[3] === 0 && ALLOWED_IDS.has(bytes[4]) && bytes[5] === bytes[4];
}

const MAX_PAYLOAD = 1024;

function crc8DvbS2(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

// Streaming frame parser. push(bytes) returns events; unparseable input resyncs on the next '$'.
// Event: { type: 'frame', version: 1|2, cmd, payload: Uint8Array, flagError: boolean } or { type: 'error', code }.
export class MspParser {
  constructor() { this.buf = []; }
  reset() { this.buf = []; }
  push(bytes) {
    for (const b of bytes) this.buf.push(b);
    const out = [];
    for (;;) {
      const ev = this._next();
      if (!ev) break;
      if (ev !== 'skip') out.push(ev);
    }
    return out;
  }
  _drop(n) { this.buf.splice(0, n); }
  _resync() { const i = this.buf.indexOf(0x24, 1); this._drop(i < 0 ? this.buf.length : i); }
  _next() {
    const b = this.buf;
    while (b.length && b[0] !== 0x24) b.shift();
    if (b.length < 3) return null;
    const ver = b[1], dir = b[2];
    if (ver !== 0x4d && ver !== 0x58) { this._resync(); return { type: 'error', code: 'bad-header' }; }
    if (dir !== 0x3e && dir !== 0x21) {
      this._resync();
      return { type: 'error', code: dir === 0x3c ? 'unexpected-request-echo' : 'bad-direction' };
    }
    const flagError = dir === 0x21;
    if (ver === 0x4d) {
      if (b.length < 4) return null;
      const size = b[3];
      if (size === 0xff) { this._resync(); return { type: 'error', code: 'jumbo-unsupported' }; }
      if (size > MAX_PAYLOAD) { this._resync(); return { type: 'error', code: 'oversize' }; }
      if (b.length < 6 + size) return null;
      const cmd = b[4];
      let sum = size ^ cmd;
      for (let i = 0; i < size; i++) sum ^= b[5 + i];
      if ((sum & 0xff) !== b[5 + size]) { this._resync(); return { type: 'error', code: 'bad-checksum' }; }
      const payload = Uint8Array.from(b.slice(5, 5 + size));
      this._drop(6 + size);
      return { type: 'frame', version: 1, cmd, payload, flagError };
    }
    // v2: '$' 'X' dir flag cmd(u16) size(u16) payload crc8
    if (b.length < 8) return null;
    const size = b[6] | (b[7] << 8);
    if (size > MAX_PAYLOAD) { this._resync(); return { type: 'error', code: 'oversize' }; }
    if (b.length < 9 + size) return null;
    const crc = crc8DvbS2(b.slice(3, 8 + size));
    if (crc !== b[8 + size]) { this._resync(); return { type: 'error', code: 'bad-checksum' }; }
    const cmd = b[4] | (b[5] << 8);
    const payload = Uint8Array.from(b.slice(8, 8 + size));
    this._drop(9 + size);
    return { type: 'frame', version: 2, cmd, payload, flagError };
  }
}

// ---- encoding helper used by tests and the mock transport (responses only; the app never sends these)
export function encodeResponseV1(cmd, payload = []) {
  const size = payload.length;
  let sum = size ^ cmd;
  for (const x of payload) sum ^= x;
  return Uint8Array.from([0x24, 0x4d, 0x3e, size, cmd, ...payload, sum & 0xff]);
}

// ---- decoders. Every decoder checks length first and throws MspError('short-payload') rather than guessing.
const need = (p, n, name) => { if (p.length < n) throw new MspError('short-payload', `${name}: need ${n} bytes, got ${p.length}`); };
const u16 = (p, o) => p[o] | (p[o + 1] << 8);
const i16 = (p, o) => { const v = u16(p, o); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (p, o) => (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) >>> 0;

export const DECODERS = Object.freeze({
  MSP_API_VERSION(p) { need(p, 3, 'API_VERSION'); return { protocol: p[0], major: p[1], minor: p[2], text: `${p[1]}.${p[2]}` }; },
  MSP_FC_VARIANT(p) { need(p, 4, 'FC_VARIANT'); return { variant: String.fromCharCode(...p.slice(0, 4)) }; },
  // Up to API 1.46 the three bytes are major.minor.patch. From API 1.47 (CalVer firmware) they are (year - 2000), month, patch,
  // followed by a length-prefixed version string. Source: docs/MOTOR_DIAGNOSTICS_MSP_COMPARISON.md.
  MSP_FC_VERSION(p, ctx = {}) {
    need(p, 3, 'FC_VERSION');
    const calver = ctx.apiMajor === 1 && ctx.apiMinor >= 47;
    const str = p.length > 3 && 4 + p[3] <= p.length ? String.fromCharCode(...p.slice(4, 4 + p[3])) : null;
    const text = calver ? `${2000 + p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}.${p[2]}`;
    return { b0: p[0], b1: p[1], b2: p[2], calver, text, versionString: str, stringMatches: str === null ? null : str === text };
  },
  MSP_BOARD_INFO(p) {
    // boardId(4) hwRev(u16) type(u8) caps(u8) targetNameLen+name, then optional boardName, manufacturer, 32-byte signature, mcuTypeId.
    need(p, 9, 'BOARD_INFO');
    const str = (o) => { const n = p[o]; return o + 1 + n <= p.length ? [String.fromCharCode(...p.slice(o + 1, o + 1 + n)), o + 1 + n] : [null, p.length]; };
    const [target, o1] = str(8);
    let boardName = null, manufacturer = null, mcuTypeId = null, o = o1;
    if (o < p.length) { [boardName, o] = str(o); }
    if (o < p.length) { [manufacturer, o] = str(o); }
    if (o + 33 <= p.length) mcuTypeId = p[o + 32];
    return { boardId: String.fromCharCode(...p.slice(0, 4)), hardwareRevision: u16(p, 4), boardType: p[6], targetName: target, boardName, manufacturer, mcuTypeId };
  },
  // date(11) time(8) short git revision(7), fixed-width ASCII. Nothing after these 26 bytes is interpreted (the build-option layout is not verified).
  MSP_BUILD_INFO(p) {
    need(p, 26, 'BUILD_INFO');
    const ascii = (a, b) => String.fromCharCode(...p.slice(a, b)).replace(/[^\x20-\x7e]/g, '').trim();
    return { buildDate: ascii(0, 11), buildTime: ascii(11, 19), gitRevision: ascii(19, 26), extraBytes: p.length - 26 };
  },
  // Receiver configuration, read only. Only the serial provider (byte 0) and the SPI protocol (byte 16) are taken; the SPI id at byte 17
  // is a transmitter-binding identifier and is deliberately never read.
  MSP_RX_CONFIG(p) {
    need(p, 1, 'RX_CONFIG');
    return { serialProvider: p[0], spiProtocol: p.length >= 17 ? p[16] : null };
  },
  MSP_UID(p) { need(p, 12, 'UID'); return { words: [u32(p, 0), u32(p, 4), u32(p, 8)], hex: [0, 4, 8].map((o) => u32(p, o).toString(16).padStart(8, '0')).join('') }; },
  MSP_FEATURE_CONFIG(p) { need(p, 4, 'FEATURE_CONFIG'); const raw = u32(p, 0); return { raw, threeD: ((raw >>> 12) & 1) === 1, escSensor: ((raw >>> 27) & 1) === 1 }; },
  MSP_MOTOR_CONFIG(p) {
    need(p, 10, 'MOTOR_CONFIG');
    return { minThrottle: u16(p, 0), maxThrottle: u16(p, 2), minCommand: u16(p, 4), motorCount: p[6], poleCount: p[7], dshotTelemetry: p[8] === 1, escSensor: p[9] === 1 };
  },
  MSP_ADVANCED_CONFIG(p) {
    // offsets identical in all candidate tags (20 bytes); the field NAMES changed in 2025.12.5 (see the comparison doc)
    need(p, 20, 'ADVANCED_CONFIG');
    return { pidProcessDenom: p[1], motorProtocol: p[3], motorPwmRate: u16(p, 4), debugMode: p[18], debugCount: p[19] };
  },
  MSP_ANALOG(p) {
    need(p, 9, 'ANALOG');
    return { legacyVoltage_dV: p[0], mAhDrawn: u16(p, 1), rssi: u16(p, 3), amperage_cA: i16(p, 5), voltage_cV: u16(p, 7) };
  },
  MSP_BLACKBOX_CONFIG(p) {
    need(p, 7, 'BLACKBOX_CONFIG');
    return { supported: p[0] === 1, device: p[1], rateDenom: p[3], pRatio: u16(p, 4), sampleRate: p[6], fieldsDisabledMask: p.length >= 11 ? u32(p, 7) : null, maskPresent: p.length >= 11 };
  },
  MSP_MOTOR_TELEMETRY(p) {
    need(p, 1, 'MOTOR_TELEMETRY');
    const count = p[0];
    need(p, 1 + count * 13, 'MOTOR_TELEMETRY');
    const motors = [];
    for (let i = 0; i < count; i++) {
      const o = 1 + i * 13;
      motors.push({ rpm: u32(p, o), invalidPct_centi: u16(p, o + 4), temperatureC: p[o + 6], voltage_cV: u16(p, o + 7), current_cA: u16(p, o + 9), consumption_mAh: u16(p, o + 11) });
    }
    return { count, motors };
  },
  MSP_MOTOR(p) { need(p, 16, 'MOTOR'); return { values: Array.from({ length: 8 }, (_, i) => u16(p, i * 2)) }; },
  MSP_STATUS_EX(p) {
    need(p, 15, 'STATUS_EX');
    const extra = p[15];
    const o = 16 + extra;
    need(p, o + 5, 'STATUS_EX');
    return { cycleTimeUs: u16(p, 0), flightModeFlags: u32(p, 6), pidProfileCount: p[13], ratesProfile: p[14], armingDisableCount: p[o], armingDisableFlags: u32(p, o + 1), extraFlagBytes: extra };
  },
  MSP_MOTOR_3D_CONFIG(p) { need(p, 6, 'MOTOR_3D_CONFIG'); return { deadbandLow: u16(p, 0), deadbandHigh: u16(p, 2), neutral: u16(p, 4) }; },
  MSP_DATAFLASH_SUMMARY(p) { need(p, 13, 'DATAFLASH_SUMMARY'); return { ready: (p[0] & 1) === 1, supported: (p[0] & 2) === 2, sectors: u32(p, 1), totalBytes: u32(p, 5), usedBytes: u32(p, 9) }; },
  MSP_SDCARD_SUMMARY(p) { need(p, 11, 'SDCARD_SUMMARY'); return { supported: (p[0] & 1) === 1, state: p[1], lastError: p[2], freeKB: u32(p, 3), totalKB: u32(p, 7) }; },
  MSP_BOXIDS(p) { return { permanentIds: Array.from(p) }; },
});

export const SD_STATE = Object.freeze({ 0: 'not present', 1: 'fatal', 2: 'card init', 3: 'filesystem init', 4: 'ready' });
export const BLACKBOX_DEVICE = Object.freeze({ 0: 'none', 1: 'dataflash', 2: 'sdcard', 3: 'serial', 4: 'virtual' });

// STATUS_EX flight-mode bit i corresponds to the i-th entry of the MSP_BOXIDS list, whose permanent id 0 is ARM
// (the ARMED state, not the switch position). If the list lacks id 0 or the flags are not 32-bit addressable the state is unknown.
export function armedFromStatus(statusEx, boxIds) {
  if (!statusEx || !boxIds) return null;
  const i = boxIds.permanentIds.indexOf(0);
  if (i < 0 || i > 31) return null;
  return ((statusEx.flightModeFlags >>> i) & 1) === 1;
}

export function decode(name, payload, ctx) {
  const d = DECODERS[name];
  if (!d) throw new MspError('not-allowlisted', `no decoder for ${name}`);
  return d(payload, ctx);
}
