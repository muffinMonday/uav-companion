// Aircraft electronics profile (flight controller + ESCs): parsing, receiver mapping (configured / compiled / hardware kept apart),
// version gating, unknown codes, sanitizing of stored data, privacy (no UID, no serial number), history and export, old records.
// Synthetic and mocked only; no hardware.
import assert from 'node:assert/strict';
import { ReadOnlySession } from '../src/preflight/session.js';
import { ALLOWED_REQUESTS, MspError, decode, encodeRequest, isAllowedRequestFrame } from '../src/preflight/msp-codec.js';
import { COMPILED_RECEIVER_TABLES, buildFcProfile, decodeCompiledReceivers, decodeSerialProvider, decodeSpiProtocol, receiverModeOf, sanitizeFcProfile } from '../src/preflight/fc-profile.js';
import { buildAircraftElectronics, buildEscProfile, sanitizeElectronics } from '../src/benchtest/electronics.js';
import { buildScanResult } from '../src/fourway/scan-result.js';
import { buildEvidenceExport, buildHistoryRecord } from '../src/benchtest/history.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { makeHarness } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const api = (minor) => ({ major: 1, minor, protocol: 0, text: `1.${minor}` });
const snapOf = (reads) => ({ reads: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, { ok: true, value: v }])) });
const BASE = { MSP_API_VERSION: api(47), MSP_FC_VARIANT: { variant: 'BTFL' }, MSP_FC_VERSION: { text: '2025.12.5', versionString: '2025.12.5' } };

// ---- 1. the current supported fixture, read through the real session from the synthetic FC
{
  const t = benchFcTransport({ mcuTypeId: 6, manufacturer: 'FLCO', boardName: 'FLYCOLORF7MICRO' });
  const s = new ReadOnlySession(t); await t.open();
  const snap = await s.collectSnapshot();
  const fc = buildFcProfile(snap);
  assert.equal(fc.firmwareVariant, 'BTFL'); assert.equal(fc.firmwareVariantName, 'Betaflight'); assert.equal(fc.firmwareVersion, '2025.12.5');
  assert.equal(fc.mspApiVersion, '1.47'); assert.equal(fc.mspProtocolVersion, 0);
  assert.deepEqual([fc.buildDate, fc.buildTime, fc.gitRevision], ['Nov 18 2025', '12:00:00', 'abc1234']);
  assert.deepEqual([fc.boardIdentifier, fc.targetName, fc.boardName, fc.manufacturer], ['SYN1', 'SYNTH', 'FLYCOLORF7MICRO', 'FLCO']);
  assert.equal(fc.mcu, 'STM32F722'); assert.equal(fc.mcuTypeId, 6);
  assert.deepEqual([fc.motorProtocol, fc.motorProtocolCode, fc.motorCount, fc.bidirectionalDshot, fc.motorPoles], ['DSHOT600', 7, 4, true, 14]);
  const r = fc.receiver;
  assert.deepEqual([r.configuredMode, r.configuredProtocol, r.configuredProtocolCode, r.configuredProtocolKind], ['Serial', 'CRSF', 9, 'serial']);
  assert.equal(r.configuredUart, null);
  assert.deepEqual([r.compiledProtocols, r.compiledProtocolsStatus], [[], 'not-reported']);
  assert.equal(r.compiledProtocolsNote, 'Compiled receiver support not reported by this firmware.');
  assert.equal(r.hardwareIdentification, 'Receiver hardware not independently identified');
  const json = JSON.stringify(fc);
  assert.ok(!/uid|serial number/i.test(json.replace(/serialProvider|"Serial"|serial"/gi, '')), 'no UID field');
  assert.ok(!json.includes('11111111') && !json.includes('22222222') && !json.includes('33333333'), 'the raw UID value is nowhere in the profile');
  // no second identity request: only allowlisted, payload-free reads were written
  assert.ok(t.sent.every((b) => isAllowedRequestFrame(b)), 'every request was an allowlisted read');
  pass('FC profile from the supported fixture: firmware, board, build, MCU, motor and receiver fields; no UID');
}

// ---- 2. the two new reads are allowlisted reads; the allowlist stayed read-only
{
  assert.equal(ALLOWED_REQUESTS.MSP_BUILD_INFO, 5); assert.equal(ALLOWED_REQUESTS.MSP_RX_CONFIG, 44);
  assert.deepEqual([...encodeRequest('MSP_BUILD_INFO')], [0x24, 0x4d, 0x3c, 0, 5, 5]);
  for (const bad of [45, 46, 214, 245, 6]) assert.throws(() => encodeRequest(bad), (e) => e.code === 'not-allowlisted');
  assert.throws(() => decode('MSP_BUILD_INFO', new Uint8Array(10)), (e) => e instanceof MspError && e.code === 'short-payload');
  const rx = decode('MSP_RX_CONFIG', Uint8Array.from([9, ...Array(15).fill(0), 9, 1, 2, 3, 4, 0, 0, 0]));
  assert.deepEqual(Object.keys(rx).sort(), ['serialProvider', 'spiProtocol'], 'the SPI receiver id is never decoded');
  assert.equal(decode('MSP_RX_CONFIG', Uint8Array.from([2])).spiProtocol, null, 'a short older payload has no SPI protocol');
  pass('MSP_BUILD_INFO and MSP_RX_CONFIG are allowlisted reads; short payloads throw; the SPI id is not read');
}

// ---- 3. receiver: configured provider mapping, serial and SPI, unknown codes, version gating
{
  const serial = (code, minor = 47) => buildFcProfile(snapOf({ ...BASE, MSP_API_VERSION: api(minor), MSP_FEATURE_CONFIG: { raw: 1 << 3 }, MSP_RX_CONFIG: { serialProvider: code, spiProtocol: 0 } })).receiver;
  for (const [code, label] of [[2, 'SBUS'], [7, 'IBUS'], [9, 'CRSF'], [13, 'SRXL2'], [14, 'GHST'], [12, 'FPORT']]) assert.equal(serial(code).configuredProtocol, label, label);
  assert.equal(serial(13, 42).configuredProtocol, 'Unknown', 'SRXL2 is not mapped on an API that predates it'); assert.equal(serial(13, 42).configuredProtocolCode, 13, 'the raw code is kept');
  assert.equal(serial(200).configuredProtocol, 'Unknown', 'an unknown code is not mapped to the closest protocol'); assert.equal(serial(200).configuredProtocolCode, 200);
  assert.deepEqual(decodeSerialProvider(200, api(47)), { code: 200, label: 'Unknown' });
  assert.deepEqual(decodeSerialProvider(14, api(42)), { code: 14, label: 'Unknown' });
  const spi = (code, minor = 47) => buildFcProfile(snapOf({ ...BASE, MSP_API_VERSION: api(minor), MSP_FEATURE_CONFIG: { raw: 1 << 25 }, MSP_RX_CONFIG: { serialProvider: 9, spiProtocol: code } })).receiver;
  assert.deepEqual([spi(9).configuredMode, spi(9).configuredProtocol, spi(9).configuredProtocolKind], ['SPI', 'FrSky X', 'spi']);
  assert.equal(spi(10).configuredProtocol, 'Flysky'); assert.equal(spi(99).configuredProtocol, 'Unknown'); assert.equal(spi(9, 41).configuredProtocol, 'Unknown');
  assert.deepEqual(decodeSpiProtocol(99, api(47)), { code: 99, label: 'Unknown' });
  // the serial provider is ignored when the receiver mode is not serial, and the other way round
  assert.equal(buildFcProfile(snapOf({ ...BASE, MSP_FEATURE_CONFIG: { raw: 1 << 25 }, MSP_RX_CONFIG: { serialProvider: 9, spiProtocol: null } })).receiver.configuredProtocol, null);
  assert.equal(receiverModeOf(0).label, 'None configured'); assert.equal(receiverModeOf((1 << 3) | (1 << 25)).mode, 'multiple'); assert.equal(receiverModeOf(1 << 14).label, 'MSP'); assert.equal(receiverModeOf(null).mode, null);
  const noRx = buildFcProfile(snapOf({ ...BASE, MSP_FEATURE_CONFIG: { raw: 1 << 3 } })).receiver;
  assert.equal(noRx.configuredProtocol, null, 'no receiver configuration read: not reported, not guessed');
  pass('receiver provider mapping: serial and SPI, unknown codes stay Unknown, version-gated, mode-aware');
}

// ---- 4. compiled receiver support is separate, version-gated and absent without a verified mapping
{
  assert.deepEqual(COMPILED_RECEIVER_TABLES, [], 'no unverified mapping ships');
  const table = [{ apiMin: 1047, apiMax: 1049, bits: { CRSF: 0, SBUS: 1, IBUS: 4 } }, { apiMin: 1043, apiMax: 1046, bits: { CRSF: 3, SBUS: 0 } }];
  assert.deepEqual(decodeCompiledReceivers(0b10011, api(47), table), { status: 'reported', protocols: ['CRSF', 'SBUS', 'IBUS'], note: '' });
  assert.deepEqual(decodeCompiledReceivers(0b1001, api(44), table).protocols, ['CRSF', 'SBUS'], 'an older API uses its own table');
  assert.equal(decodeCompiledReceivers(0b1, api(41), table).status, 'not-reported', 'no table for this API: not reported');
  assert.equal(decodeCompiledReceivers(0b1, api(50), table).status, 'not-reported');
  for (const flags of [null, undefined, 'x', 1.5]) assert.equal(decodeCompiledReceivers(flags, api(47), table).status, 'not-reported');
  assert.equal(decodeCompiledReceivers(0, api(47), table).status, 'reported'); assert.deepEqual(decodeCompiledReceivers(0, api(47), table).protocols, []);
  const fc = buildFcProfile(snapOf({ ...BASE, MSP_FEATURE_CONFIG: { raw: 8 }, MSP_RX_CONFIG: { serialProvider: 9, spiProtocol: 0 }, MSP_BUILD_INFO: { buildDate: 'Nov 18 2025', buildTime: '12:00:00', gitRevision: 'abc1234', extraBytes: 12 } }));
  assert.equal(fc.receiver.compiledProtocolsStatus, 'not-reported', 'trailing build bytes are not interpreted without a verified layout');
  assert.ok(!/ELRS|ExpressLRS|Crossfire|Tracer/i.test(JSON.stringify(fc)), 'CRSF is never turned into a receiver brand');
  assert.equal(fc.receiver.hardwareIdentification, 'Receiver hardware not independently identified');
  pass('compiled receiver support: its own gated mapping, not reported without one, never confused with configured protocol or hardware');
}

// ---- 5. build info unavailable and unreadable profiles
{
  const fc = buildFcProfile(snapOf(BASE));
  assert.deepEqual([fc.buildDate, fc.gitRevision, fc.mcu, fc.motorProtocol, fc.receiver.configuredMode], [null, null, null, null, null]);
  assert.equal(buildFcProfile({ reads: { MSP_API_VERSION: { ok: false } } }), null, 'nothing read: no profile');
  assert.equal(buildFcProfile(null), null);
  assert.equal(buildFcProfile(snapOf({ ...BASE, MSP_BOARD_INFO: { boardId: 'SYN1', targetName: 'T', hardwareRevision: 0, mcuTypeId: 99, boardType: 2, boardName: null, manufacturer: null } })).mcu, 'Unknown', 'an unknown MCU id stays Unknown');
  pass('missing reads leave fields null; unknown MCU id stays Unknown');
}

// ---- 6. ESC profile: BLHeli_S/Bluejay decoding that exists, BLHeli_32 left unavailable, partial and mixed scans, malformed data, no serial
{
  const good = (ch, over = {}) => ({ channel: ch, init: { ok: true, mode: 'silabs', signature: 0xe8b2, bootChar: 1, mcu: 'EFM8BB21x' }, blocks: { settings: settings(over) }, error: null });
  const settings = ({ main = 0, sub = 21, layout = '#S_H_50#', mcu = '#BLHELI$EFM8B21#', name = 'Bluejay' } = {}) => { const b = new Array(0x70).fill(0); b[0] = main; b[1] = sub; const put = (o, s) => [...s].forEach((c, i) => { b[o + i] = c.charCodeAt(0); }); put(64, layout); put(80, mcu); put(96, name); return b; };
  const all = buildEscProfile(buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [0, 1, 2, 3].map((i) => good(i)) }));
  assert.equal(all.scanStatus, 'identified'); assert.equal(all.consistency, 'matching'); assert.equal(all.channels.length, 4);
  assert.deepEqual([all.channels[0].status, all.channels[0].firmwareFamily, all.channels[0].firmwareVersion, all.channels[0].firmwareTarget, all.channels[0].mcuFamily, all.channels[0].bootloader], ['identified', 'Bluejay', '0.21', '#S_H_50#', 'EFM8BB21x', 'SiLabs bootloader']);
  assert.match(all.channels[0].evidenceSource, /read-only/); assert.equal(all.retailModel, 'Retail model not independently verifiable');
  // mixed versions and targets
  const mixed = buildEscProfile(buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [good(0), good(1), good(2), good(3, { sub: 22, layout: '#S_H_60#' })] }));
  assert.equal(mixed.consistency, 'mixed'); assert.equal(mixed.channels[3].firmwareVersion, '0.22'); assert.equal(mixed.channels[3].status, 'identified');
  // BLHeli_32 style ARM bootloader: the family is NOT guessed
  const arm = { channel: 1, init: { ok: true, mode: 'arm', signature: 0x1f06, bootChar: 0x01, mcu: 'STM32F051' }, blocks: {}, error: null };
  const b32 = buildEscProfile(buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [0, 1, 2, 3].map((i) => ({ ...arm, channel: i })) }));
  assert.equal(b32.scanStatus, 'unavailable');
  for (const c of b32.channels) { assert.equal(c.status, 'unsupported'); assert.equal(c.firmwareFamily, null); assert.equal(c.firmwareVersion, null); assert.equal(c.firmwareTarget, null); assert.equal(c.mcuFamily, 'STM32F051'); assert.equal(c.bootloader, 'ARM bootloader'); assert.match(c.failureReason, /not decoded/); assert.match(c.failureReason, /nothing is guessed/); }
  // partial: one silent channel, one truncated settings block, one malformed init
  const partial = buildEscProfile(buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [good(0), { channel: 1, init: null, blocks: {}, error: 'timeout' }, { channel: 2, init: { ok: true, mode: 'silabs', signature: 0xe8b2, bootChar: 1, mcu: 'EFM8BB21x' }, blocks: { settings: [1, 2, 3] }, error: null }, { channel: 3, init: null, blocks: {}, error: 'probe-bad-crc' }] }));
  assert.equal(partial.scanStatus, 'partial'); assert.deepEqual(partial.channels.map((c) => c.status), ['identified', 'unavailable', 'unavailable', 'unavailable']);
  assert.ok(partial.channels.slice(1).every((c) => c.firmwareFamily === null && c.firmwareVersion === null), 'no value is invented for a channel that could not be read');
  assert.equal(partial.consistency, 'unknown');
  // not run
  for (const none of [null, undefined, {}, { status: 'not-run' }]) assert.deepEqual(buildEscProfile(none), { scanStatus: 'not-run', consistency: 'unknown', channels: [], retailModel: 'Retail model not independently verifiable' });
  // no serial number or UID survives, even if a caller passed one
  const dirty = buildEscProfile({ status: 'identified', consistent: true, channels: [0, 1, 2, 3].map((i) => ({ channel: i + 1, state: 'identified', family: 'Bluejay', version: '0.21', target: '#S_H_50#', mcu: 'EFM8BB21x', mode: 'silabs', serial: 'SN123456', uid: 'DEADBEEF', serialNumber: 'X' })) });
  assert.ok(!/SN123456|DEADBEEF|serial|uid/i.test(JSON.stringify(dirty)), 'no serial number or UID in an ESC profile');
  pass('ESC profile: decoded families, BLHeli_32 left unsupported without a guess, partial and mixed scans, malformed data, no serial number');
}

// ---- 7. stored data is untrusted and old records load
{
  assert.equal(sanitizeElectronics(undefined), null); assert.equal(sanitizeElectronics('x'), null); assert.equal(sanitizeElectronics([]), null); assert.equal(sanitizeElectronics({}), null);
  const hostile = { schemaVersion: 9, flightController: { firmwareVersion: 'x'.repeat(500), uid: 'DEADBEEF', uidHex: 'FF', boardSerial: 'S1', receiver: { configuredProtocol: 'CRSF', hardwareIdentification: 'RadioMaster ELRS', compiledProtocols: ['CRSF', 5, 'X'.repeat(100)], compiledProtocolsStatus: 'reported' } }, escs: { scanStatus: 'identified', channels: [{ motorIndex: 7, status: 'weird', serial: 'SN1', firmwareFamily: 'Bluejay' }, 1, null, {}, {}] } };
  const s = sanitizeElectronics(hostile);
  assert.ok(s.flightController.firmwareVersion.length <= 32); assert.equal(s.flightController.receiver.hardwareIdentification, 'Receiver hardware not independently identified', 'stored text can never claim a receiver model');
  assert.ok(!/DEADBEEF|"FF"|S1|SN1|uid|serial"/i.test(JSON.stringify(s).replace(/receiver/g, '')), 'unknown keys are dropped');
  assert.equal(s.escs.channels.length, 4); assert.equal(s.escs.channels[0].motorIndex, 0); assert.equal(s.escs.channels[0].status, 'unavailable');
  assert.deepEqual(s.flightController.receiver.compiledProtocols.length, 2);
  assert.equal(sanitizeFcProfile(null), null);
  pass('stored electronics data is whitelisted; old or hostile data cannot add a UID, serial number or receiver model');
}

// ---- 8. history record and evidence export carry the profile; the raw UID is nowhere
{
  const t = benchFcTransport({ mcuTypeId: 6 }); const s = new ReadOnlySession(t); await t.open();
  const snap = await s.collectSnapshot();
  const electronics = buildAircraftElectronics({ snapshot: snap, scan: null });
  const result = { category: 'completed-no-issue', headline: 'h', summary: 's', reasons: [], notes: [], motors: [], comparison: { classified: false, differences: [] }, range: {} };
  const rec = buildHistoryRecord({ result, identity: { variant: 'BTFL' }, electronics, now: 1e12 });
  assert.equal(rec.aircraftElectronics.flightController.firmwareVersion, '2025.12.5'); assert.equal(rec.aircraftElectronics.escs.scanStatus, 'not-run'); assert.equal(rec.schemaVersion, 1);
  const ev = buildEvidenceExport({ sweeps: [], result, identity: { variant: 'BTFL' }, electronics, now: 1e12 });
  assert.equal(ev.aircraftElectronics.flightController.mspApiVersion, '1.47');
  for (const j of [JSON.stringify(rec), JSON.stringify(ev)]) assert.ok(!/11111111|22222222|33333333/.test(j), 'no UID words in the record or export');
  assert.equal(buildHistoryRecord({ result, identity: {}, now: 1e12 }).aircraftElectronics, null, 'a record built without a profile stores null (shown as not recorded)');
  pass('history record and evidence export include the versioned profile; old shapes stay valid');
}

// ---- 9. through the controller: the live result carries the profile and the saved record has it
{
  const h = await makeHarness({ fc: { mcuTypeId: 6 } }); await h.toMotorReady();
  const e = h.c.electronics();
  assert.equal(e.flightController.firmwareVersion, '2025.12.5'); assert.equal(e.flightController.mcu, 'STM32F722'); assert.equal(e.escs.scanStatus, 'not-run');
  assert.ok(!JSON.stringify(h.c.view()).includes(h.c._rawUidHexForTests()), 'the view never carries the raw UID');
  assert.ok(!JSON.stringify(e).includes(h.c._rawUidHexForTests()));
  pass('controller exposes the profile without the UID');
}
console.log('ALL OK');
