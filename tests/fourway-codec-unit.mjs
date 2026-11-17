// 4-way ESC identification: codec, allowlist, parser, identification, scan-result. Pure; no transport.
import assert from 'node:assert/strict';
import { ACK, FOURWAY_CMD, FourWayParser, FourWayRefused, PROHIBITED_CMD, buildEnterFrame, buildRequest, crc16Xmodem, encodeResponse, parseEnterReply } from '../src/fourway/codec.js';
import { classifyInit, parseIdentity, readPlan } from '../src/fourway/identify.js';
import { buildScanResult, compareToReference, sanitizeEscObservation } from '../src/fourway/scan-result.js';

const pass = (t) => console.log('PASS  ' + t);
const refused = (fn) => assert.throws(fn, (e) => e instanceof FourWayRefused);
const ascii = (s, n) => { const o = new Array(n).fill(0); for (let i = 0; i < Math.min(s.length, n); i++) o[i] = s.charCodeAt(i); return o; };

// ---- CRC and framing
assert.equal(crc16Xmodem(Uint8Array.from([...'123456789'].map((c) => c.charCodeAt(0)))), 0x31c3);
assert.equal(crc16Xmodem([]), 0);
pass('CRC16 XMODEM known answer 0x31C3');

{
  const r = buildRequest({ cmd: FOURWAY_CMD.DEVICE_READ, addr: 0x1a00, params: [0x70] });
  assert.deepEqual([...r.slice(0, 6)], [0x2f, 0x3a, 0x1a, 0x00, 1, 0x70]);
  const c = crc16Xmodem(r.slice(0, 6));
  assert.equal(r[6], c >> 8); assert.equal(r[7], c & 0xff);
  const p = new FourWayParser();
  const ev = p.push(encodeResponse({ cmd: 0x3a, addr: 0x1a00, params: [1, 2, 3], ack: 0 }));
  assert.deepEqual(ev.map((e) => [e.type, e.cmd, e.addr, [...e.params], e.ack]), [['frame', 0x3a, 0x1a00, [1, 2, 3], 0]]);
  const big = encodeResponse({ cmd: 0x3a, addr: 0, params: new Array(256).fill(7) });
  assert.equal(big.length, 8 + 256); assert.equal(big[4], 0);
  const e2 = new FourWayParser().push(big);
  assert.equal(e2[0].params.length, 256);
  pass('encode/decode round trip, including 256-byte (PARAM_LEN 0) frames');
}

// ---- allowlist
{
  const allowed = new Set(Object.values(FOURWAY_CMD));
  assert.equal(allowed.size, 8);
  for (const cmd of allowed) {
    const spec = cmd === 0x3a ? { cmd, addr: 0x100, params: [16] } : { cmd, params: [cmd === 0x35 || cmd === 0x37 ? 2 : 0] };
    const f = buildRequest(spec);
    assert.equal(f[0], 0x2f); assert.equal(f[1], cmd);
  }
  for (const v of Object.values(PROHIBITED_CMD)) refused(() => buildRequest({ cmd: v }));
  assert.equal(Object.keys(PROHIBITED_CMD).length, 8);
  let refusedCount = 0;
  for (let c = 0; c < 256; c++) {
    if (allowed.has(c)) continue;
    refused(() => buildRequest({ cmd: c, params: [0] })); refused(() => buildRequest({ cmd: c, addr: 0x1a00, params: [16] }));
    refusedCount++;
  }
  assert.equal(refusedCount, 248);
  for (const bad of [-1, 256, 1.5, NaN, '48', null, undefined]) refused(() => buildRequest({ cmd: bad }));
  assert.ok(Object.isFrozen(FOURWAY_CMD) && Object.isFrozen(PROHIBITED_CMD) && Object.isFrozen(ACK));
  pass('only the 8 allowlisted commands encode; the 8 prohibited and all other 248 byte values throw');
}
{
  const T = FOURWAY_CMD;
  for (const bad of [[], [0, 0], [8], [-1], [1.5], ['1']]) { refused(() => buildRequest({ cmd: T.DEVICE_INIT_FLASH, params: bad })); refused(() => buildRequest({ cmd: T.DEVICE_RESET, params: bad })); }
  refused(() => buildRequest({ cmd: T.DEVICE_RESET, addr: 1, params: [0] }));
  refused(() => buildRequest({ cmd: T.DEVICE_INIT_FLASH, addr: 1, params: [0] }));
  assert.doesNotThrow(() => buildRequest({ cmd: T.DEVICE_RESET, addr: 0, params: [7] }));
  for (const len of [0, 256, -1, 1.5]) refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: 0x1a00, params: [len] }));
  refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: 0xffff, params: [16] }));
  refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: 0x10000, params: [16] }));
  refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: -1, params: [16] }));
  refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: 1.5, params: [16] }));
  refused(() => buildRequest({ cmd: T.DEVICE_READ, addr: 0, params: [16, 17] }));
  for (const cmd of [T.TEST_ALIVE, T.PROTOCOL_GET_VERSION, T.INTERFACE_GET_NAME, T.INTERFACE_GET_VERSION, T.INTERFACE_EXIT]) {
    refused(() => buildRequest({ cmd, params: [1] })); refused(() => buildRequest({ cmd, addr: 4, params: [0] })); refused(() => buildRequest({ cmd, params: [] }));
    assert.deepEqual([...buildRequest({ cmd }).slice(0, 6)], [0x2f, cmd, 0, 0, 1, 0]);
  }
  assert.equal(buildRequest({ cmd: T.TEST_ALIVE, params: Uint8Array.from([0]) }).length, 8);
  pass('parameter validation: channel 0..7, reset addr 0, read length 1..255, read addr 0..0xFFFE, single-byte params');
}

// ---- parser
{
  const good = encodeResponse({ cmd: 0x37, addr: 0, params: [0xb2, 0xe8, 1, 1] });
  const p = new FourWayParser();
  let ev = [];
  for (const b of good) ev.push(...p.push([b]));
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'frame');
  const p2 = new FourWayParser();
  assert.deepEqual(p2.push(good.slice(0, 4)), []); assert.deepEqual(p2.push(good.slice(4, good.length - 1)), []);
  assert.equal(p2.push(good.slice(good.length - 1))[0].type, 'frame');
  const trunc = new FourWayParser();
  assert.deepEqual(trunc.push(good.slice(0, good.length - 3)), []);
  pass('parser: split frames across pushes, a truncated frame waits and emits nothing');

  const bad = Uint8Array.from(good); bad[bad.length - 1] ^= 1;
  const p3 = new FourWayParser();
  ev = p3.push([...bad, ...good]);
  assert.deepEqual(ev.map((e) => e.type === 'error' ? e.code : e.type), ['bad-crc', 'frame']);
  ev = new FourWayParser().push([0x00, 0x11, 0x22, ...good]);
  assert.deepEqual(ev.map((e) => e.type === 'error' ? e.code : e.type), ['bad-start', 'frame']);
  ev = new FourWayParser({ maxParams: 2 }).push(good);
  assert.equal(ev[0].code, 'oversize');
  assert.ok(!ev.some((e) => e.type === 'frame'));
  pass('parser: bad CRC and garbage prefix resynchronise on 0x2E, oversize is reported');
}

// ---- enter frame and reply
{
  assert.deepEqual([...buildEnterFrame()], [0x24, 0x4d, 0x3c, 0x00, 0xf5, 0xf5]);
  assert.deepEqual(parseEnterReply([0x24, 0x4d, 0x3e, 1, 245, 4, 1 ^ 245 ^ 4]), { ok: true, escCount: 4, length: 7 });
  assert.equal(parseEnterReply([0x24, 0x4d, 0x3e, 1, 245, 4, 0]).reason, 'bad-checksum');
  assert.equal(parseEnterReply([0x24, 0x4d, 0x21, 0, 245, 245]).reason, 'msp-error');
  assert.equal(parseEnterReply([0x24, 0x4d, 0x3e, 2, 245, 4, 4, 0]).reason, 'bad-size');
  assert.equal(parseEnterReply([0x24, 0x4d, 0x3e, 1, 244, 4, 1 ^ 244 ^ 4]).reason, 'bad-cmd');
  assert.equal(parseEnterReply([0x24, 0x4d, 0x3e, 1, 245]).reason, 'short');
  assert.equal(parseEnterReply([0x25, 0x4d, 0x3e]).reason, 'bad-header');
  assert.equal(parseEnterReply(null).reason, 'short');
  pass('enter frame bytes exact; enter reply good, bad checksum, error flag, wrong length, short');
}

// ---- identification fixtures
const settings = (len, o) => { const b = new Array(len).fill(0); for (const [off, bytes] of Object.entries(o)) bytes.forEach((v, i) => { b[Number(off) + i] = v; }); return Uint8Array.from(b); };
const silabsBlock = (main, sub, layout, mcu, name) => settings(0x70, { 0: [main, sub, 33], 64: ascii(layout, 16), 80: ascii(mcu, 16), 96: ascii(name, 16) });
{
  const init = classifyInit([0xb2, 0xe8, 1, 1]);
  assert.deepEqual(init, { ok: true, mode: 'silabs', signature: 0xe8b2, bootChar: 1, mcu: 'EFM8BB21x' });
  assert.deepEqual(readPlan(init), [{ tag: 'settings', addr: 0x1a00, len: 0x70 }]);
  assert.deepEqual(readPlan(classifyInit([0xb5, 0xe8, 1, 1])), [{ tag: 'settings', addr: 0x3000, len: 0x70 }]);
  const s = parseIdentity(init, { settings: silabsBlock(16, 7, '#S_H_50#', '#BLHELI$EFM8B21#', '') });
  assert.equal(s.state, 'identified'); assert.equal(s.family, 'BLHeli_S'); assert.equal(s.version, '16.7'); assert.equal(s.target, '#S_H_50#'); assert.equal(s.signature, '0xE8B2'); assert.equal(s.mode, 'silabs'); assert.equal(s.mcu, 'EFM8BB21x');
  const bj = parseIdentity(init, { settings: silabsBlock(0, 21, '#S_H_50#', '#BLHELI$EFM8B21#', 'Bluejay') });
  assert.equal(bj.family, 'Bluejay'); assert.equal(bj.version, '0.21'); assert.equal(bj.name, 'Bluejay');
  assert.equal(parseIdentity(init, { settings: silabsBlock(1, 2, 'zzzz', 'qqqq', 'Mystery') }).state, 'unavailable');
  assert.equal(parseIdentity(init, { settings: silabsBlock(1, 2, 'zzzz', 'qqqq', 'Mystery') }).reason, 'family-not-recognised');
  assert.equal(parseIdentity(init, { settings: new Uint8Array(0x70).fill(0xff) }).reason, 'settings-blank');
  assert.equal(parseIdentity(init, { settings: new Uint8Array(10) }).reason, 'short-read');
  assert.equal(parseIdentity(init, {}).reason, 'no-data');
  assert.equal(parseIdentity(classifyInit([0x34, 0x12, 1, 1]), {}).reason, 'unsupported-interface');
  pass('identify: SiLabs BLHeli_S and Bluejay, unrecognised, blank, short');
}
{
  const am = classifyInit([0x06, 0x1f, 0x06, 4]);
  assert.deepEqual(readPlan(am), [{ tag: 'fileName', addr: 0x7c00 - 32, len: 16 }, { tag: 'settings', addr: 0x7c00, len: 0xb0 }]);
  assert.deepEqual(readPlan(classifyInit([0x06, 0x35, 0x14, 4])).map((x) => x.addr), [0xf800 - 32, 0xf800]);
  const id = parseIdentity(am, { fileName: Uint8Array.from(ascii('AM32_TEST_F051', 16)), settings: settings(0xb0, { 0: [1, 2, 6, 2, 19, ...ascii('MYESC', 12)] }) });
  assert.equal(id.family, 'AM32'); assert.equal(id.version, '2.19'); assert.equal(id.target, 'AM32_TEST_F051'); assert.equal(id.name, 'MYESC'); assert.equal(id.signature, '0x1F06'); assert.equal(id.mode, 'arm');
  const noFile = parseIdentity(am, { fileName: new Uint8Array(16), settings: settings(0xb0, { 0: [1, 2, 6, 2, 19, ...ascii('MYESC', 12)] }) });
  assert.equal(noFile.target, 'MYESC');
  const unk = classifyInit([0x06, 0x1f, 0x01, 4]);
  assert.deepEqual(readPlan(unk), []);
  const u = parseIdentity(unk, {});
  assert.equal(u.state, 'unavailable'); assert.equal(u.family, null); assert.equal(u.reason, 'family-not-recognised'); assert.equal(u.signature, '0x1F06'); assert.equal(u.mcu, 'STM32F051');
  assert.notEqual(parseIdentity(unk, { settings: settings(0xb0, { 0: [1, 2, 3, 4, 5, ...ascii('BLHeli_32', 12)] }) }).family, 'BLHeli_32');
  assert.equal(parseIdentity(classifyInit([0x99, 0x99, 0x06, 4]), {}).reason, 'unsupported-interface');
  assert.equal(parseIdentity(am, {}).reason, 'no-data');
  pass('identify: AM32 accepted only with a boot pin id; other ARM bootloaders have family null and are never called BLHeli_32');
}
{
  const a = parseIdentity(classifyInit([0x07, 0x93, 0, 2]), {});
  assert.deepEqual([a.state, a.reason, a.mode, a.signature, a.family], ['unavailable', 'unsupported-interface', 'atmel', '0x9307', null]);
  const s = parseIdentity(classifyInit([0x07, 0x93, 0, 3]), {});
  assert.deepEqual([s.state, s.reason, s.mode], ['unavailable', 'unsupported-interface', 'stk500']);
  assert.deepEqual(readPlan(classifyInit([0x07, 0x93, 0, 2])), []);
  assert.equal(parseIdentity(classifyInit([1, 2, 3, 9]), {}).mode, 'unknown');
  for (const g of [undefined, null, 5, 'x', [], [1], [1, 2, 3], {}, { ok: true }, { ok: true, mode: 'silabs', signature: 0xe8b2 }, { ok: true, mode: 'arm', signature: 0x1f06, bootChar: 6 }]) {
    assert.doesNotThrow(() => { classifyInit(g); readPlan(g); const r = parseIdentity(g, null); assert.equal(r.state, 'unavailable'); });
  }
  assert.doesNotThrow(() => parseIdentity(classifyInit([0xb2, 0xe8, 1, 1]), { settings: 'junk' }));
  assert.doesNotThrow(() => parseIdentity(classifyInit([0xb2, 0xe8, 1, 1]), { settings: [1, 2, 3] }));
  const nonAscii = parseIdentity(classifyInit([0xb2, 0xe8, 1, 1]), { settings: silabsBlock(1, 1, '#' + '\u0001x'.repeat(2), '#BLHELI#', 'Bluejay') });
  assert.ok(/^[\x20-\x7e]*$/.test(nonAscii.target || ''));
  assert.ok(parseIdentity(classifyInit([0xb2, 0xe8, 1, 1]), { settings: silabsBlock(0, 1, '#' + 'A'.repeat(15), '#BLHELI#', 'Bluejay') }).target.length <= 24);
  pass('identify: Atmel and STK report signature and mode only; garbage and short input never throw');
}

// ---- scan-result
const raw = (i, over = {}) => ({ channel: i, init: classifyInit([0xb2, 0xe8, 1, 1]), blocks: { settings: silabsBlock(0, 21, '#S_H_50#', '#BLHELI$EFM8B21#', 'Bluejay') }, error: null, ...over });
{
  const all = buildScanResult({ reportedCount: 4, channels: [0, 1, 2, 3].map((i) => raw(i)), entered: true, exit: { ok: true, reason: null }, now: 5 });
  assert.equal(all.status, 'identified'); assert.equal(all.consistent, true); assert.equal(all.channels.length, 4); assert.deepEqual(all.channels.map((c) => c.channel), [1, 2, 3, 4]);
  assert.deepEqual(all.warnings, []); assert.equal(all.expected, 4); assert.equal(all.note, 'Retail model cannot be independently verified'); assert.equal(all.exit.ok, true);

  const mixed = buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [raw(0), raw(1), raw(2), raw(3, { blocks: { settings: silabsBlock(16, 7, '#S_H_50#', '#BLHELI$EFM8B21#', '') } })] });
  assert.equal(mixed.consistent, false); assert.equal(mixed.channels[3].state, 'mismatch'); assert.equal(mixed.status, 'partial');
  assert.ok(mixed.warnings.some((w) => /families/.test(w)) && mixed.warnings.some((w) => /versions/.test(w)));
  const tgt = buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [raw(0), raw(1), raw(2), raw(3, { blocks: { settings: silabsBlock(0, 21, '#O_H_50#', '#BLHELI$EFM8B21#', 'Bluejay') } })] });
  assert.ok(tgt.warnings.some((w) => /targets/.test(w)));

  const part = buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [raw(0), raw(1), raw(2), raw(3, { init: null, blocks: {}, error: 'timeout' })] });
  assert.equal(part.status, 'partial'); assert.equal(part.channels[3].state, 'unavailable'); assert.equal(part.channels[3].reason, 'timeout'); assert.equal(part.consistent, false);
  assert.ok(part.warnings.some((w) => /channel 4/.test(w)));

  const none = buildScanResult({ reportedCount: 4, entered: true, exit: { ok: true }, channels: [0, 1, 2, 3].map((i) => raw(i, { init: null, blocks: {}, error: 'timeout' })) });
  assert.equal(none.status, 'unavailable'); assert.equal(none.consistent, null);
  const notRun = buildScanResult({});
  assert.equal(notRun.status, 'not-run'); assert.equal(notRun.consistent, null); assert.equal(notRun.channels.length, 4);
  const failed = buildScanResult({ error: 'enter-timeout' });
  assert.equal(failed.status, 'unavailable');
  const live = buildScanResult({ entered: true, reportedCount: 4, channels: [raw(0)] });
  assert.deepEqual(live.channels.map((c) => c.state), ['identified', 'waiting', 'waiting', 'waiting']);
  const three = buildScanResult({ entered: true, reportedCount: 3, exit: { ok: false, reason: 'timeout' }, channels: [0, 1, 2].map((i) => raw(i)) });
  assert.ok(three.warnings.some((w) => /reported 3/.test(w)) && three.warnings.some((w) => /did not confirm/.test(w)));
  pass('scan-result: consistent true/false/null, partial, waiting, unavailable, warnings');

  assert.deepEqual(compareToReference(all, 'Bluejay'), []);
  assert.equal(compareToReference(all, 'BLHeli_S').length, 4);
  assert.deepEqual(compareToReference(all, null), []);
  assert.deepEqual(compareToReference(null, 'Bluejay'), []);
  pass('compareToReference warns when the family differs from the approval');

  const s = sanitizeEscObservation({ ...all, uid: 'DEADBEEF', secret: 1, channels: [...all.channels.map((c) => ({ ...c, uid: 'AB', family: 'Bluejay', target: 'x'.repeat(100) })), { channel: 5 }] });
  assert.equal(s.channels.length, 4); assert.equal(s.channels[0].target.length, 24);
  assert.ok(!('uid' in s) && !('secret' in s)); assert.ok(s.channels.every((c) => !('uid' in c)));
  assert.ok(!JSON.stringify(s).includes('DEADBEEF') && !JSON.stringify(s).includes('"AB"'));
  assert.deepEqual(Object.keys(s.channels[0]).sort(), ['channel', 'family', 'mcu', 'mode', 'reason', 'signature', 'state', 'target', 'version']);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
  for (const bad of [null, undefined, 5, 'x', [], true, {}, { status: 'weird' }]) assert.equal(sanitizeEscObservation(bad), null);
  const g = sanitizeEscObservation({ status: 'partial', channels: [null, 5, { state: 'bogus', family: 'BLHeli_32', channel: 99 }], warnings: [1, 'ok', 'y'.repeat(500)], reportedCount: 'x', consistent: 'yes', exit: 'z' });
  assert.equal(g.channels[2].family, null); assert.equal(g.channels[2].state, 'unavailable'); assert.equal(g.channels[2].channel, 3);
  assert.equal(g.reportedCount, null); assert.equal(g.consistent, null); assert.equal(g.warnings.length, 2); assert.equal(g.warnings[1].length, 120);
  assert.equal(sanitizeEscObservation({ status: 'partial', get channels() { throw new Error('boom'); } }), null);
  pass('sanitizeEscObservation: whitelist, clipping, no uid, rejects non-objects, tolerates garbage');
}
