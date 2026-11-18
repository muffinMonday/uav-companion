// Motor diagnostics: the read-only flight-controller profile (identity, board, motor configuration, receiver).
// Pure: it only reads values from a snapshot the session already collected (no extra request, no write). Nothing here can carry the raw
// UID or any other stable unique hardware identifier: MSP_UID is never read by this module, and the SPI receiver id is never decoded.
//
// Receiver information is three separate concepts and is never merged:
//   1. configured receiver protocol (mode + serial provider or SPI protocol, as configured in the firmware),
//   2. compiled receiver support (build-option flags; only where a verified, version-gated mapping exists),
//   3. receiver hardware (never identified: a wire protocol does not name a brand or model).
// Code tables come from the public Betaflight enumerations (clean-room, not hardware-verified). A code outside the table, or outside the
// API range a mapping is valid for, stays "Unknown" and keeps its raw number. It is never mapped to the closest known value.
export const PROFILE_SCHEMA_VERSION = 1;
export const RECEIVER_HARDWARE_TEXT = 'Receiver hardware not independently identified';
export const COMPILED_NOT_REPORTED_TEXT = 'Compiled receiver support not reported by this firmware.';

const apiNum = (api) => (api && Number.isInteger(api.major) && Number.isInteger(api.minor) ? api.major * 1000 + api.minor : null);
const ok = (snap, n) => (snap && snap.reads && snap.reads[n] && snap.reads[n].ok ? snap.reads[n].value : null);
const str = (v, n = 64) => (typeof v === 'string' && v ? v.replace(/[^\x20-\x7e]/g, '').trim().slice(0, n) || null : null);

const VARIANT_NAMES = Object.freeze({ BTFL: 'Betaflight', CLFL: 'Cleanflight', INAV: 'INAV', EMUF: 'EmuFlight', QUIC: 'Quicksilver' });
const MCU_NAMES = Object.freeze({ 0: 'Simulator', 1: 'STM32F103', 2: 'STM32F303', 3: 'STM32F40x', 4: 'STM32F411', 5: 'STM32F446', 6: 'STM32F722', 7: 'STM32F745', 8: 'STM32F746', 9: 'STM32F765', 10: 'STM32H750' });

// [code, label, first API (major*1000+minor) at which the code is valid]
const SERIAL_PROVIDERS = Object.freeze([
  [0, 'Spektrum 1024', 0], [1, 'Spektrum 2048', 0], [2, 'SBUS', 0], [3, 'SUMD', 0], [4, 'SUMH', 0], [5, 'XBUS Mode B', 0], [6, 'XBUS Mode B RJ01', 0],
  [7, 'IBUS', 0], [8, 'JETI EX Bus', 0], [9, 'CRSF', 0], [10, 'SRXL', 0], [11, 'Custom', 0], [12, 'FPORT', 1041], [13, 'SRXL2', 1043], [14, 'GHST', 1043],
]);
const SPI_PROTOCOLS = Object.freeze([
  [0, 'NRF24 V202 250K'], [1, 'NRF24 V202 1M'], [2, 'NRF24 SYMA X'], [3, 'NRF24 SYMA X5C'], [4, 'NRF24 CX10'], [5, 'NRF24 CX10A'], [6, 'NRF24 H8 3D'],
  [7, 'NRF24 INAV'], [8, 'FrSky D'], [9, 'FrSky X'], [10, 'Flysky'], [11, 'Flysky 2A'], [12, 'KN'], [13, 'SFHSS'], [14, 'Redpine'], [15, 'FrSky X LBT'],
]);
const SPI_FIRST_API = 1043;

// feature bits (Betaflight feature_e)
const RX_FEATURES = Object.freeze([['PPM', 0], ['Serial', 3], ['Parallel PWM', 13], ['MSP', 14], ['SPI', 25]]);

// Build-option flag mappings, one table per API range. NO verified mapping exists yet (the layout of build options in MSP_BUILD_INFO has not
// been established from the firmware source), so this list is empty and the profile reports "not reported". A table is {apiMin, apiMax, bits:{name:bit}}.
export const COMPILED_RECEIVER_TABLES = Object.freeze([]);

export function decodeCompiledReceivers(flags, api, tables = COMPILED_RECEIVER_TABLES) {
  const a = apiNum(api);
  const none = { status: 'not-reported', protocols: [], note: COMPILED_NOT_REPORTED_TEXT };
  if (!Number.isInteger(flags) || a === null) return none;
  const table = tables.find((t) => a >= t.apiMin && a <= t.apiMax);
  if (!table) return none;
  const protocols = Object.entries(table.bits).filter(([, bit]) => ((flags >>> bit) & 1) === 1).map(([name]) => name);
  return { status: 'reported', protocols, note: '' };
}

export function decodeSerialProvider(code, api) {
  if (!Number.isInteger(code)) return { code: null, label: null };
  const a = apiNum(api);
  const row = SERIAL_PROVIDERS.find((r) => r[0] === code);
  return { code, label: row && a !== null && a >= row[2] ? row[1] : 'Unknown' };
}
export function decodeSpiProtocol(code, api) {
  if (!Number.isInteger(code)) return { code: null, label: null };
  const a = apiNum(api);
  const row = SPI_PROTOCOLS.find((r) => r[0] === code);
  return { code, label: row && a !== null && a >= SPI_FIRST_API ? row[1] : 'Unknown' };
}

export function receiverModeOf(featureRaw) {
  if (!Number.isInteger(featureRaw)) return { mode: null, label: null };
  const on = RX_FEATURES.filter(([, bit]) => ((featureRaw >>> bit) & 1) === 1).map(([n]) => n);
  if (on.length === 1) return { mode: on[0].toLowerCase().replace(/ /g, '-'), label: on[0] };
  return on.length === 0 ? { mode: 'none', label: 'None configured' } : { mode: 'multiple', label: 'Unknown (more than one receiver mode set)' };
}

// snapshot: the object ReadOnlySession.collectSnapshot returns. Returns the flightController part of aircraftElectronics.
export function buildFcProfile(snapshot, tables = COMPILED_RECEIVER_TABLES) {
  const api = ok(snapshot, 'MSP_API_VERSION'), fv = ok(snapshot, 'MSP_FC_VERSION'), vr = ok(snapshot, 'MSP_FC_VARIANT'), bi = ok(snapshot, 'MSP_BOARD_INFO');
  const bd = ok(snapshot, 'MSP_BUILD_INFO'), mc = ok(snapshot, 'MSP_MOTOR_CONFIG'), adv = ok(snapshot, 'MSP_ADVANCED_CONFIG'), feat = ok(snapshot, 'MSP_FEATURE_CONFIG'), rx = ok(snapshot, 'MSP_RX_CONFIG');
  if (!snapshot || !snapshot.reads || (!api && !fv && !vr && !bi)) return null;
  const protoNames = { 0: 'PWM', 1: 'ONESHOT125', 2: 'ONESHOT42', 3: 'MULTISHOT', 4: 'BRUSHED', 5: 'DSHOT150', 6: 'DSHOT300', 7: 'DSHOT600', 8: 'PROSHOT1000', 9: 'DISABLED' };
  const mode = receiverModeOf(feat ? feat.raw : null);
  const serial = rx ? decodeSerialProvider(rx.serialProvider, api) : { code: null, label: null };
  const spi = rx && rx.spiProtocol !== null ? decodeSpiProtocol(rx.spiProtocol, api) : { code: null, label: null };
  let configuredProtocol = null, configuredProtocolCode = null, configuredProtocolKind = null;
  if (mode.mode === 'serial' && serial.label) { configuredProtocol = serial.label; configuredProtocolCode = serial.code; configuredProtocolKind = 'serial'; }
  else if (mode.mode === 'spi' && spi.label) { configuredProtocol = spi.label; configuredProtocolCode = spi.code; configuredProtocolKind = 'spi'; }
  const compiled = decodeCompiledReceivers(null, api, tables); // flags are not read until a verified layout exists
  const variant = vr ? str(vr.variant, 4) : null;
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    firmwareVariant: variant, firmwareVariantName: variant ? VARIANT_NAMES[variant] || null : null,
    firmwareVersion: fv ? str(fv.versionString) || str(fv.text) : null,
    mspProtocolVersion: api ? api.protocol : null, mspApiVersion: api ? str(api.text, 12) : null,
    buildDate: bd ? str(bd.buildDate, 11) : null, buildTime: bd ? str(bd.buildTime, 8) : null, gitRevision: bd ? str(bd.gitRevision, 7) : null,
    boardIdentifier: bi ? str(bi.boardId, 4) : null, targetName: bi ? str(bi.targetName) : null, boardName: bi ? str(bi.boardName) : null,
    manufacturer: bi ? str(bi.manufacturer) : null,
    hardwareRevision: bi && Number.isInteger(bi.hardwareRevision) && bi.hardwareRevision > 0 ? bi.hardwareRevision : null,
    mcu: bi && Number.isInteger(bi.mcuTypeId) ? (MCU_NAMES[bi.mcuTypeId] || 'Unknown') : null,
    mcuTypeId: bi && Number.isInteger(bi.mcuTypeId) ? bi.mcuTypeId : null,
    boardType: bi && Number.isInteger(bi.boardType) ? bi.boardType : null,
    motorProtocol: adv ? protoNames[adv.motorProtocol] || 'Unknown' : null, motorProtocolCode: adv ? adv.motorProtocol : null,
    motorCount: mc ? mc.motorCount : null,
    bidirectionalDshot: mc ? mc.dshotTelemetry === true : null,
    motorPoles: mc ? mc.poleCount : null,
    receiver: {
      configuredMode: mode.label, configuredModeCode: mode.mode,
      configuredProtocol, configuredProtocolCode, configuredProtocolKind,
      configuredUart: null, configuredUartNote: 'Not reported (no stable read-only message exposes it)',
      compiledProtocols: compiled.protocols, compiledProtocolsStatus: compiled.status, compiledProtocolsNote: compiled.note,
      hardwareIdentification: RECEIVER_HARDWARE_TEXT,
    },
  };
}

// Stored or imported data is untrusted: whitelist every field, clip every string, no unknown key survives.
const sStr = (v, n = 64) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').trim().slice(0, n) || null : null);
const sInt = (v) => (Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);
export function sanitizeFcProfile(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x.receiver && typeof x.receiver === 'object' ? x.receiver : {};
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    firmwareVariant: sStr(x.firmwareVariant, 4), firmwareVariantName: sStr(x.firmwareVariantName, 24), firmwareVersion: sStr(x.firmwareVersion, 32),
    mspProtocolVersion: sInt(x.mspProtocolVersion), mspApiVersion: sStr(x.mspApiVersion, 12),
    buildDate: sStr(x.buildDate, 11), buildTime: sStr(x.buildTime, 8), gitRevision: sStr(x.gitRevision, 7),
    boardIdentifier: sStr(x.boardIdentifier, 4), targetName: sStr(x.targetName), boardName: sStr(x.boardName), manufacturer: sStr(x.manufacturer), hardwareRevision: sInt(x.hardwareRevision),
    mcu: sStr(x.mcu, 24), mcuTypeId: sInt(x.mcuTypeId), boardType: sInt(x.boardType),
    motorProtocol: sStr(x.motorProtocol, 16), motorProtocolCode: sInt(x.motorProtocolCode), motorCount: sInt(x.motorCount),
    bidirectionalDshot: x.bidirectionalDshot === true ? true : x.bidirectionalDshot === false ? false : null, motorPoles: sInt(x.motorPoles),
    receiver: {
      configuredMode: sStr(r.configuredMode, 48), configuredModeCode: sStr(r.configuredModeCode, 24),
      configuredProtocol: sStr(r.configuredProtocol, 24), configuredProtocolCode: sInt(r.configuredProtocolCode), configuredProtocolKind: r.configuredProtocolKind === 'serial' || r.configuredProtocolKind === 'spi' ? r.configuredProtocolKind : null,
      configuredUart: null, configuredUartNote: sStr(r.configuredUartNote, 100),
      compiledProtocols: (Array.isArray(r.compiledProtocols) ? r.compiledProtocols : []).filter((p) => typeof p === 'string').slice(0, 24).map((p) => sStr(p, 16)).filter(Boolean),
      compiledProtocolsStatus: r.compiledProtocolsStatus === 'reported' ? 'reported' : 'not-reported', compiledProtocolsNote: sStr(r.compiledProtocolsNote, 100),
      hardwareIdentification: RECEIVER_HARDWARE_TEXT, // never taken from stored data
    },
  };
}
