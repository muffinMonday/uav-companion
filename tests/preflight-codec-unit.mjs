// Motor diagnostics Phase 1: read-only MSP codec, allowlist, parser fail-closed behaviour, decoders, transport write guard.
import assert from 'node:assert/strict';
import { ALLOWED_REQUESTS, MspParser, MspError, armedFromStatus, decode, encodeRequest, encodeResponseV1, isAllowedRequestFrame } from '../src/preflight/msp-codec.js';
import { MockTransport } from '../src/preflight/transport.js';
import { defaultFc, payloadFor } from '../src/preflight/mock-fc.js';

const pass = (t) => console.log('PASS  ' + t);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof MspError && e.code === code);

// ---- allowlist: only read requests can be encoded
for (const [name, id] of Object.entries(ALLOWED_REQUESTS)) assert.deepEqual([...encodeRequest(name)], [0x24, 0x4d, 0x3c, 0, id, id]);
pass(`all ${Object.keys(ALLOWED_REQUESTS).length} allowlisted requests encode as payload-free MSP v1 reads`);
const forbidden = { MSP_SET_MOTOR: 214, MSP_SET_4WAY_IF_or_4WAY: 245, MSP_DATAFLASH_ERASE: 72, MSP_DATAFLASH_READ: 71, MSP_SET_RAW_RC: 200, MSP_EEPROM_WRITE: 250, MSP_SET_PASSTHROUGH: 245, MSP_REBOOT: 68, MSP_SET_BLACKBOX_CONFIG: 81, MSP_SET_ADVANCED_CONFIG: 91 };
for (const [n, id] of Object.entries(forbidden)) { throwsCode(() => encodeRequest(id), 'not-allowlisted'); throwsCode(() => encodeRequest(n), 'not-allowlisted'); }
for (const id of [0, 6, 45, 100, 255, -1, 1.5, NaN, '1']) throwsCode(() => encodeRequest(id), 'not-allowlisted');
pass('MSP_SET_MOTOR (214), 4-way (245), dataflash erase/read, reboot, EEPROM write and every other id are not encodable');
assert.ok(!Object.keys(ALLOWED_REQUESTS).some((k) => /SET|ERASE|WRITE|REBOOT|4WAY|PASSTHROUGH/.test(k)));
assert.ok(!Object.values(ALLOWED_REQUESTS).includes(214) && !Object.values(ALLOWED_REQUESTS).includes(245) && !Object.values(ALLOWED_REQUESTS).includes(72));
pass('allowlist names and ids contain no write, erase, reboot or 4-way entry');

// ---- isAllowedRequestFrame
assert.ok(isAllowedRequestFrame(encodeRequest('MSP_MOTOR')));
const setMotor = Uint8Array.from([0x24, 0x4d, 0x3c, 16, 214, ...new Array(16).fill(0), 214 ^ 16]);
assert.ok(!isAllowedRequestFrame(setMotor));
assert.ok(!isAllowedRequestFrame(Uint8Array.from([0x23, 0x0d])));                       // CLI entry '#'
assert.ok(!isAllowedRequestFrame(Uint8Array.from([...'get blackbox_mode\r'].map((c) => c.charCodeAt(0)))));
assert.ok(!isAllowedRequestFrame(Uint8Array.from([0x24, 0x4d, 0x3c, 0, 104, 0])));      // bad checksum
assert.ok(!isAllowedRequestFrame(Uint8Array.from([0x24, 0x4d, 0x3c, 1, 104, 0, 104 ^ 1]))); // payload not allowed
assert.ok(!isAllowedRequestFrame(null) && !isAllowedRequestFrame(new Uint8Array(0)));
pass('the frame guard rejects motor writes, CLI bytes, bad checksums, payloads and empty input');

// ---- transport: a write is refused unless it is an allowlisted read
const t = new MockTransport(() => null);
assert.throws(() => t.write(setMotor), (e) => e.code === 'write-blocked');
assert.throws(() => t.write(Uint8Array.from([0x23])), (e) => e.code === 'write-blocked');
assert.equal(t.sent.length, 0);
t.write(encodeRequest('MSP_API_VERSION'));
assert.equal(t.sent.length, 1);
pass('Transport.write blocks everything except allowlisted reads, even when called directly');

// ---- parser
const frame = encodeResponseV1(104, [1, 2, 3, 4]);
let p = new MspParser();
let ev = p.push(frame);
assert.equal(ev.length, 1);
assert.deepEqual([ev[0].type, ev[0].cmd, ev[0].version, ev[0].flagError, [...ev[0].payload]], ['frame', 104, 1, false, [1, 2, 3, 4]]);
pass('v1 response frame parses');
p = new MspParser(); const got = [];
for (const b of frame) got.push(...p.push([b]));
assert.equal(got.length, 1);
pass('a frame split into single bytes parses once');
p = new MspParser(); ev = p.push([...frame, ...frame]);
assert.equal(ev.length, 2);
pass('two back-to-back frames parse');
const bad = Uint8Array.from(frame); bad[bad.length - 1] ^= 0xff;
p = new MspParser(); ev = p.push([...bad, ...frame]);
assert.equal(ev[0].type, 'error'); assert.equal(ev[0].code, 'bad-checksum');
assert.equal(ev.filter((e) => e.type === 'frame').length, 1);
pass('a bad checksum is an error, and the parser resyncs to the next good frame');
p = new MspParser(); ev = p.push([0, 1, 2, 3, 0xff, ...frame]);
assert.equal(ev.filter((e) => e.type === 'frame').length, 1);
pass('garbage before a frame is skipped');
p = new MspParser(); ev = p.push([0x24, 0x4d, 0x3e, 0xff, 1, 2, 3]);
assert.equal(ev[0].code, 'jumbo-unsupported');
pass('a jumbo v1 frame is rejected, not guessed');
p = new MspParser(); ev = p.push([0x24, 0x58, 0x3e, 0, 1, 0, 0xff, 0xff, 0]);
assert.equal(ev[0].code, 'oversize');
pass('an oversize v2 length is rejected');
p = new MspParser(); ev = p.push(encodeRequest('MSP_MOTOR'));
assert.equal(ev[0].code, 'unexpected-request-echo');
pass('a request echo from the FC side is an error');
p = new MspParser(); ev = p.push([0x24, 0x4d, 0x21, 0, 104, 104]);
assert.equal(ev[0].type, 'frame'); assert.equal(ev[0].flagError, true);
pass('an MSP error frame is reported with flagError');
p = new MspParser(); ev = p.push(frame.slice(0, frame.length - 2));
assert.equal(ev.length, 0);
pass('a truncated frame yields nothing until completed');
// v2 frame with a known CRC-8 DVB-S2 (computed by an independent loop)
const v2body = [0, 104, 0, 2, 0, 9, 8];
let crc = 0; for (const b of v2body) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff; }
p = new MspParser(); ev = p.push([0x24, 0x58, 0x3e, ...v2body, crc]);
assert.deepEqual([ev[0].type, ev[0].version, ev[0].cmd, [...ev[0].payload]], ['frame', 2, 104, [9, 8]]);
p = new MspParser(); ev = p.push([0x24, 0x58, 0x3e, ...v2body, crc ^ 1]);
assert.equal(ev[0].code, 'bad-checksum');
pass('v2 frames check CRC-8 DVB-S2');

// ---- decoders (synthetic payloads built by the mock FC)
const fc = defaultFc();
const D = (n, x = fc, ctx) => decode(n, Uint8Array.from(payloadFor(n, x)), ctx);
assert.deepEqual(D('MSP_API_VERSION'), { protocol: 0, major: 1, minor: 47, text: '1.47' });
assert.equal(D('MSP_FC_VARIANT').variant, 'BTFL');
assert.equal(D('MSP_FC_VERSION', fc, { apiMajor: 1, apiMinor: 47 }).text, '2025.12.5');
assert.equal(D('MSP_FC_VERSION', fc, { apiMajor: 1, apiMinor: 47 }).stringMatches, true);
const old = { ...fc, firmware: '4.5.5', api: '1.46' };
assert.equal(D('MSP_FC_VERSION', old, { apiMajor: 1, apiMinor: 46 }).text, '4.5.5');
pass('API version, variant and firmware version decode (CalVer from API 1.47, SemVer before)');
assert.equal(D('MSP_UID').hex, '111111112222222233333333');
assert.equal(D('MSP_FEATURE_CONFIG').threeD, false);
assert.equal(D('MSP_FEATURE_CONFIG', { ...fc, threeD: true }).threeD, true);
const mc = D('MSP_MOTOR_CONFIG'); assert.deepEqual([mc.motorCount, mc.poleCount, mc.dshotTelemetry], [4, 14, true]);
const adv = D('MSP_ADVANCED_CONFIG'); assert.deepEqual([adv.motorProtocol, adv.debugMode], [7, 0]);
assert.equal(D('MSP_ADVANCED_CONFIG', { ...fc, debugMode: 53 }).debugMode, 53);
const bb = D('MSP_BLACKBOX_CONFIG'); assert.deepEqual([bb.supported, bb.device, bb.maskPresent, bb.fieldsDisabledMask], [true, 1, true, 0]);
const bbOld = D('MSP_BLACKBOX_CONFIG', { ...fc, blackbox: { ...fc.blackbox, maskPresent: false } }); assert.deepEqual([bbOld.maskPresent, bbOld.fieldsDisabledMask], [false, null]);
assert.deepEqual(D('MSP_MOTOR').values.slice(0, 4), [1000, 1000, 1000, 1000]);
const tel = D('MSP_MOTOR_TELEMETRY'); assert.equal(tel.count, 4); assert.equal(tel.motors[0].rpm, 0);
assert.equal(D('MSP_ANALOG', { ...fc, analog: { v_cV: 1660, mAh: 5, amp_cA: -3 } }).amperage_cA, -3);
const df = D('MSP_DATAFLASH_SUMMARY'); assert.deepEqual([df.ready, df.supported, df.totalBytes], [true, true, 16777216]);
const sd = D('MSP_SDCARD_SUMMARY', { ...fc, sdcard: { state: 4, freeKB: 100, totalKB: 200 } }); assert.deepEqual([sd.supported, sd.state, sd.freeKB], [true, 4, 100]);
assert.equal(D('MSP_BOARD_INFO').boardId, 'SYN1'); assert.equal(D('MSP_BOARD_INFO').targetName, 'SYNTH');
pass('every other decoder reads its synthetic payload correctly');
for (const n of Object.keys(ALLOWED_REQUESTS)) {
  if (n === 'MSP_BOXIDS') continue; // an empty list is valid
  throwsCode(() => decode(n, new Uint8Array(0)), 'short-payload');
}
throwsCode(() => decode('MSP_MOTOR_TELEMETRY', Uint8Array.from([4, 0, 0])), 'short-payload');
throwsCode(() => decode('MSP_SET_MOTOR', new Uint8Array(0)), 'not-allowlisted');
pass('a short payload throws for every decoder; no default is invented');

// ---- armed state is read from STATUS_EX through the BOXIDS order, never a fixed bit
const st = D('MSP_STATUS_EX'), boxes = D('MSP_BOXIDS');
assert.equal(armedFromStatus(st, boxes), false);
const armedFc = { ...fc, armed: true };
assert.equal(armedFromStatus(D('MSP_STATUS_EX', armedFc), D('MSP_BOXIDS', armedFc)), true);
const shifted = { ...fc, armed: true, boxIds: [1, 2, 0, 3] }; // ARM (id 0) is the third active box -> flag bit 2
assert.equal(armedFromStatus(D('MSP_STATUS_EX', shifted), D('MSP_BOXIDS', shifted)), true);
assert.equal(armedFromStatus(D('MSP_STATUS_EX', { ...shifted, armed: false }), D('MSP_BOXIDS', { ...shifted, armed: false })), false);
assert.equal(armedFromStatus(st, { permanentIds: [1, 2, 3] }), null);
assert.equal(armedFromStatus(null, boxes), null);
pass('armed state follows the BOXIDS order; a missing ARM box or missing data is unknown (null), not false');

console.log('ALL OK');
