// Motor diagnostics: a synthetic flight controller for tests and the lab page.
// It answers allowlisted READ requests only. All values are SYNTHETIC: this is not a record of any real aircraft.
// HARDWARE-UNVERIFIED: real boards may differ (backlog section 19).
import { ALLOWED_REQUESTS, encodeResponseV1 } from './msp-codec.js';
import { MockTransport } from './transport.js';

const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

export function defaultFc() {
  return {
    firmware: '2025.12.5', api: '1.47', variant: 'BTFL', uid: [0x11111111, 0x22222222, 0x33333333],
    threeD: false, motorCount: 4, poleCount: 14, dshotTelemetry: true, protocol: 7, debugMode: 0,
    blackbox: { supported: true, device: 1, rateDenom: 1, pRatio: 1, sampleRate: 0, mask: 0, maskPresent: true },
    dataflash: { ready: true, supported: true, sectors: 256, total: 16777216, used: 0 },
    sdcard: null,
    analog: { v_cV: 0, mAh: 0, amp_cA: 0 },
    armed: false, boxIds: [0, 1, 2, 3, 4], armingDisableFlags: 0,
    motors: [1000, 1000, 1000, 1000, 0, 0, 0, 0],
    telemetry: [0, 1, 2, 3].map(() => ({ rpm: 0, invalidPct: 0, temp: 0, volt: 0, cur: 0, cons: 0 })),
    silent: [], // message names that get no reply (timeout)
    rejected: [], // message names answered with an MSP error frame
  };
}

export function payloadFor(name, fc) {
  const [maj, min, pat] = fc.firmware.split('.').map(Number);
  const [amaj, amin] = fc.api.split('.').map(Number);
  switch (name) {
    case 'MSP_API_VERSION': return [0, amaj, amin];
    case 'MSP_FC_VARIANT': return [...fc.variant].map((c) => c.charCodeAt(0));
    case 'MSP_FC_VERSION': {
      if (amaj === 1 && amin >= 47) { const s = [...fc.firmware].map((c) => c.charCodeAt(0)); return [maj - 2000, min, pat, s.length, ...s]; }
      return [maj, min, pat];
    }
    case 'MSP_BOARD_INFO': { const t = [...(fc.target || 'SYNTH')].map((c) => c.charCodeAt(0)); return [...[...'SYN1'].map((c) => c.charCodeAt(0)), 0, 0, 0, 1, t.length, ...t]; }
    case 'MSP_UID': return fc.uid.flatMap(le32);
    case 'MSP_FEATURE_CONFIG': return le32((fc.threeD ? 1 << 12 : 0) >>> 0);
    case 'MSP_MOTOR_CONFIG': return [...le16(1070), ...le16(2000), ...le16(1000), fc.motorCount, fc.poleCount, fc.dshotTelemetry ? 1 : 0, 0];
    case 'MSP_ADVANCED_CONFIG': return [1, 1, 0, fc.protocol, ...le16(0), ...le16(0), 0, 0, 0, 0, 0, ...le16(0), ...le16(0), 0, fc.debugMode, 100].slice(0, 20);
    case 'MSP_MOTOR_3D_CONFIG': return [...le16(1406), ...le16(1514), ...le16(1460)];
    case 'MSP_ANALOG': return [0, ...le16(fc.analog.mAh), ...le16(0), ...le16(fc.analog.amp_cA & 0xffff), ...le16(fc.analog.v_cV)];
    case 'MSP_BLACKBOX_CONFIG': {
      const b = fc.blackbox;
      const head = [b.supported ? 1 : 0, b.device, 1, b.rateDenom, ...le16(b.pRatio), b.sampleRate];
      return b.maskPresent ? [...head, ...le32(b.mask >>> 0)] : head;
    }
    case 'MSP_DATAFLASH_SUMMARY': { const d = fc.dataflash; return [(d.ready ? 1 : 0) | (d.supported ? 2 : 0), ...le32(d.sectors), ...le32(d.total), ...le32(d.used)]; }
    case 'MSP_SDCARD_SUMMARY': { const s = fc.sdcard; return s ? [1, s.state, 0, ...le32(s.freeKB), ...le32(s.totalKB)] : [0, 0, 0, ...le32(0), ...le32(0)]; }
    case 'MSP_BOXIDS': return fc.boxIds;
    case 'MSP_STATUS_EX': {
      const i = fc.boxIds.indexOf(0);
      const flags = fc.armed && i >= 0 ? (1 << i) >>> 0 : 0;
      return [...le16(fc.cycleTimeUs ?? 250), ...le16(0), ...le16(0), ...le32(flags), 0, ...le16(10), 3, 0, 0, 32, ...le32(fc.armingDisableFlags), 0];
    }
    case 'MSP_MOTOR': return fc.motors.flatMap(le16);
    case 'MSP_MOTOR_TELEMETRY': return [fc.telemetry.length, ...fc.telemetry.flatMap((t) => [...le32(t.rpm), ...le16(t.invalidPct), t.temp, ...le16(t.volt), ...le16(t.cur), ...le16(t.cons)])];
    default: return null;
  }
}

export function mockFcTransport(fcIn = {}, opts = {}) {
  const fc = { ...defaultFc(), ...fcIn };
  const idToName = Object.fromEntries(Object.entries(ALLOWED_REQUESTS).map(([k, v]) => [v, k]));
  const t = new MockTransport((id) => {
    const name = idToName[id];
    if (!name || fc.silent.includes(name)) return null;
    if (fc.rejected.includes(name)) return 'error';
    const p = payloadFor(name, fc);
    return p ? encodeResponseV1(id, p) : null;
  }, opts);
  t.fc = fc;
  return t;
}
