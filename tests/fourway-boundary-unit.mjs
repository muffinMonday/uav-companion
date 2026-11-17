// 4-way ESC identification boundary against the synthetic FC (MockTransport and the bench mock), FakeClock only.
import assert from 'node:assert/strict';
import { FourWayBoundary } from '../src/fourway/boundary.js';
import { FOURWAY_CMD, PROHIBITED_CMD } from '../src/fourway/codec.js';
import { FOURWAY_TIMINGS } from '../src/fourway/constants.js';
import { attachFourWay } from '../src/fourway/mock-fourway-fc.js';
import { buildScanResult } from '../src/fourway/scan-result.js';
import { MockTransport } from '../src/preflight/transport.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { FakeClock } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const mk = (scenario, { bench = false } = {}) => {
  const clock = new FakeClock();
  const t = bench ? benchFcTransport() : new MockTransport(() => null);
  attachFourWay(t, scenario);
  const b = new FourWayBoundary({ transport: t, clock });
  return { clock, t, b };
};
// Drive a promise to completion on the fake clock.
async function run(clock, p, maxMs = 120000) {
  let done = false, val;
  p.then((v) => { done = true; val = v; });
  for (let waited = 0; !done && waited <= maxMs; waited += 250) await clock.advance(250);
  assert.ok(done, 'promise did not settle');
  return val;
}
const bluejays = (n = 4) => Array.from({ length: n }, () => ({ kind: 'bluejay' }));
const scan = async (scenario, opts) => {
  const h = mk(scenario, opts);
  const e = await run(h.clock, h.b.enter());
  const res = e.ok ? await run(h.clock, h.b.identifyAll({ count: e.escCount })) : [];
  return { ...h, e, res };
};
const prohibited = new Set(Object.values(PROHIBITED_CMD));
const allowed = new Set(Object.values(FOURWAY_CMD));

// ---- happy path
{
  const h = await scan({ channels: [{ kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'bluejay' }] });
  assert.deepEqual([h.e.ok, h.e.escCount], [true, 4]);
  assert.equal(h.b.active, true);
  const r = buildScanResult({ reportedCount: 4, channels: h.res, entered: true });
  assert.equal(r.status, 'identified'); assert.equal(r.consistent, true);
  assert.deepEqual(r.channels.map((c) => [c.family, c.version, c.target]), Array(4).fill(['Bluejay', '0.21', '#S_H_50#']));
  const x = await run(h.clock, h.b.exit());
  assert.deepEqual(x, { ok: true, reason: null });
  assert.equal(h.b.active, false); assert.equal(h.t.fourway.exited, true);
  pass('happy path: four Bluejay channels identified, exit restores');
}
{
  const h = await scan({ channels: [{ kind: 'bluejay' }, { kind: 'blheli_s' }, { kind: 'am32' }, { kind: 'am32', fileName: 'AM32_OTHER', version: [2, 20] }] });
  const r = buildScanResult({ reportedCount: 4, channels: h.res, entered: true });
  assert.deepEqual(r.channels.map((c) => c.family), ['Bluejay', 'BLHeli_S', 'AM32', 'AM32']);
  assert.equal(r.consistent, false);
  assert.equal(r.channels[2].version, '2.19'); assert.equal(r.channels[2].target, 'AM32_SYNTH_F051');
  pass('mixed families identified per channel with fixture bytes for SiLabs and ARM');
}
{
  const h = await scan({ channels: [{ kind: 'arm-unknown' }, { kind: 'atmel' }, { kind: 'bluejay' }, { kind: 'bluejay' }] });
  const r = buildScanResult({ reportedCount: 4, channels: h.res, entered: true });
  assert.equal(r.channels[0].family, null); assert.equal(r.channels[0].reason, 'family-not-recognised'); assert.equal(r.channels[0].signature, '0x1F06');
  assert.equal(r.channels[1].reason, 'unsupported-interface'); assert.equal(r.channels[1].mode, 'atmel');
  assert.equal(r.status, 'partial');
  assert.deepEqual(h.res[0].blocks, {}); assert.equal(h.t.fourway.log.filter((l) => l.cmd === FOURWAY_CMD.DEVICE_READ && l.addr >= 0x7000 && l.addr < 0x7d00).length, 0, 'no reads for an unrecognised ARM bootloader');
  pass('unrecognised ARM and Atmel channels stay unavailable without guessed data');
}

// ---- per-channel failures are isolated
for (const kind of ['silent', 'init-fail', 'badcrc', 'garbage', 'read-timeout']) {
  const channels = bluejays(); channels[2] = { kind };
  const h = await scan({ channels });
  assert.equal(h.res.length, 4);
  assert.ok(h.res[2].error, `${kind}: error recorded`);
  for (const i of [0, 1, 3]) assert.equal(h.res[i].error, null, `${kind}: channel ${i} fine`);
  const r = buildScanResult({ reportedCount: 4, channels: h.res, entered: true });
  assert.equal(r.channels[2].state, 'unavailable'); assert.equal(r.channels[2].family, null); assert.equal(r.channels[2].version, null); assert.equal(r.channels[2].target, null);
  assert.equal(r.status, 'partial'); assert.equal(r.consistent, false);
  assert.ok(r.warnings.some((w) => /channel 3/.test(w)));
  assert.equal(h.b.active, true);
  if (kind === 'init-fail' || kind === 'silent') assert.equal(h.t.fourway.log.filter((l) => l.cmd === FOURWAY_CMD.DEVICE_INIT_FLASH && l.params[0] === 2).length, FOURWAY_TIMINGS.initAttempts, kind + ' retried');
  assert.equal(h.res[2].error === 'timeout' || /^ack-|bad-crc|read-timeout/.test(h.res[2].error), true, h.res[2].error);
}
pass('silent, init-fail, bad CRC, garbage and read-timeout channels isolate; others identified; init retried 5 times');

{
  const h = mk({ channels: bluejays() });
  await run(h.clock, h.b.enter());
  const res = await run(h.clock, h.b.identifyAll({ count: 4 }));
  assert.equal(h.t.fourway.log[0].cmd, FOURWAY_CMD.TEST_ALIVE);
  assert.deepEqual(h.t.fourway.log.slice(0, 3).map((l) => l.cmd), [FOURWAY_CMD.TEST_ALIVE, FOURWAY_CMD.PROTOCOL_GET_VERSION, FOURWAY_CMD.INTERFACE_GET_NAME]);
  assert.equal(res.length, 4);
  pass('probe commands run before any channel init');
}
{
  // a flight controller that does not speak 4-way after the enter: probe fails, all channels unavailable, nothing guessed
  const clock = new FakeClock(); const t = new MockTransport(() => null);
  t._write = (b) => { t.sent.push(b); if (b[4] === 245) queueMicrotask(() => t._emitData(Uint8Array.from([0x24, 0x4d, 0x3e, 1, 245, 4, 1 ^ 245 ^ 4]))); };
  const b = new FourWayBoundary({ transport: t, clock });
  assert.equal((await run(clock, b.enter())).ok, true);
  const res = await run(clock, b.identifyAll({ count: 4 }));
  assert.ok(res.every((r) => r.init === null && /^probe-/.test(r.error)));
  pass('a probe failure marks every channel unavailable');
}

// ---- enter
{
  const clock = new FakeClock(); const t = new MockTransport(() => null);
  attachFourWay(t, { enter: 'silent' });
  const b = new FourWayBoundary({ transport: t, clock });
  const e = await run(clock, b.enter());
  assert.deepEqual([e.ok, e.reason], [false, 'timeout']);
  assert.equal(b.active, true, 'unknown FC state keeps the boundary active so exit is attempted');
  const t2 = new MockTransport((id) => (id === 245 ? 'error' : null));
  const b2 = new FourWayBoundary({ transport: t2, clock: new FakeClock() });
  const e2 = await b2.enter(); await new Promise((r) => setImmediate(r));
  assert.ok(e2.ok === false);
  assert.equal(b2.active, false, 'an MSP error reply means the FC did not enter 4-way');
  pass('enter timeout stays active; MSP error reply releases');
}
{
  const h = mk({ escCount: 4, channels: bluejays() });
  await run(h.clock, h.b.enter());
  const second = await run(h.clock, h.b.enter());
  assert.deepEqual([second.ok, second.reason], [false, 'already-active']);
  assert.equal(h.t.fourway.log.length, 0);
  assert.equal(h.t.sent.filter((s) => s[4] === 245).length, 1, 'enter frame written once');
  pass('enter() is refused while active, without writing');
}

// ---- exit
for (const exit of ['no-reply', 'bad-crc', 'never']) {
  const h = await scan({ channels: bluejays(), exit });
  const x = await run(h.clock, h.b.exit());
  assert.equal(x.ok, false, exit);
  assert.equal(h.b.active, true, exit + ' stays active');
  assert.equal(h.t.fourway.exited, false);
  assert.equal(h.t.fourway.log.filter((l) => l.cmd === FOURWAY_CMD.INTERFACE_EXIT).length, FOURWAY_TIMINGS.exitAttempts);
  assert.equal((await run(h.clock, h.b.enter())).reason, 'already-active');
}
pass('exit no-reply, bad CRC and never: ok false after 3 attempts, active stays true');
{
  const h = await scan({ channels: bluejays(), exit: 'ok', afterExit: { motorsDisabled: true } }, { bench: true });
  assert.equal(h.t.fc.inject.telemetrySilent, false);
  assert.equal((await run(h.clock, h.b.exit())).ok, true);
  assert.equal(h.t.fc.inject.telemetrySilent, true);
  pass('afterExit.motorsDisabled silences the synthetic RPM telemetry');
}
{
  const h = await scan({ channels: [{ kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'stuck-in-bootloader' }, { kind: 'bluejay' }] }, { bench: true });
  assert.equal(h.res.length, 4);
  assert.equal((await run(h.clock, h.b.exit())).ok, true);
  assert.equal(h.t.fc.inject.telemetrySilent, true, 'stuck channel: rpm unavailable');
  const g = await scan({ channels: [{ kind: 'stuck-in-bootloader' }, ...bluejays(3)] }, { bench: true });
  assert.deepEqual(await run(g.clock, g.b.resetChannels([0])), [{ channel: 0, ok: true }]);
  assert.deepEqual(g.t.fourway.resets, [0]);
  await run(g.clock, g.b.exit());
  assert.equal(g.t.fc.inject.telemetrySilent, false, 'reset returned the ESC to the application');
  const s = await scan({ channels: bluejays(), resetEffect: 'stays-in-bootloader' }, { bench: true });
  await run(s.clock, s.b.resetChannels([1]));
  await run(s.clock, s.b.exit());
  assert.equal(s.t.fc.inject.telemetrySilent, true);
  const log = g.t.fourway.log.filter((l) => l.cmd === FOURWAY_CMD.DEVICE_RESET);
  assert.ok(log.every((l) => l.addr === 0 && l.params.length === 1));
  pass('stuck-in-bootloader and reset effects reach the synthetic telemetry; DeviceReset always uses address 0');
}

// ---- abort
{
  const h = mk({ channels: bluejays() });
  await run(h.clock, h.b.enter());
  let calls = 0;
  const p = h.b.identifyAll({ count: 4, shouldAbort: () => ++calls > 3 });
  const res = await run(h.clock, p);
  assert.ok(res.some((r) => r.error === 'aborted'));
  const initsAfter = h.t.fourway.log.length;
  assert.deepEqual(await run(h.clock, h.b.resetChannels([0])), [{ channel: 0, ok: false }]);
  assert.equal(h.t.fourway.log.length, initsAfter, 'after abort nothing but exit is written');
  const x = await run(h.clock, h.b.exit());
  assert.equal(x.ok, true); assert.equal(h.t.fourway.exited, true); assert.equal(h.b.active, false);
  assert.equal(h.t.fourway.log.at(-1).cmd, FOURWAY_CMD.INTERFACE_EXIT);
  pass('abort mid-scan stops scanning and still exits');
}
{
  const clock = new FakeClock(); const t = new MockTransport(() => null);
  attachFourWay(t, { channels: bluejays() });
  const b = new FourWayBoundary({ transport: t, clock, shouldAbort: () => true });
  await run(clock, b.enter());
  const res = await run(clock, b.identifyAll({ count: 4 }));
  assert.ok(res.every((r) => r.error === 'aborted' || /^probe-/.test(r.error) || r.error === 'aborted'));
  assert.equal((await run(clock, b.exit())).ok, true);
  pass('the constructor shouldAbort option is honoured');
}

// ---- overall deadline and transport close
{
  const h = mk({ channels: Array.from({ length: 4 }, () => ({ kind: 'silent' })) });
  await run(h.clock, h.b.enter());
  const res = await run(h.clock, h.b.identifyAll({ count: 4 }));
  assert.ok(res.some((r) => r.error === 'overall-timeout'), 'the overall budget stops the scan');
  assert.ok(h.clock.now() - 1_000_000 <= FOURWAY_TIMINGS.overallMs + FOURWAY_TIMINGS.initAttempts * (FOURWAY_TIMINGS.initAttemptMs + FOURWAY_TIMINGS.initSpacingMs) + 5000);
  const c = mk({ channels: bluejays() });
  await run(c.clock, c.b.enter());
  c.t.disconnect();
  assert.equal(c.b.active, false);
  pass('overall deadline bounds the scan; transport close releases the boundary');
}

// ---- counts
{
  const z = await scan({ escCount: 0, channels: bluejays() });
  assert.deepEqual(z.res, []);
  const r0 = buildScanResult({ reportedCount: 0, channels: z.res, entered: true, exit: { ok: true } });
  assert.equal(r0.status, 'unavailable'); assert.equal(r0.channels.length, 4);
  const big = await scan({ escCount: 12, channels: bluejays(12) });
  assert.equal(big.res.length, 4);
  assert.ok(big.t.fourway.log.every((l) => l.cmd !== FOURWAY_CMD.DEVICE_INIT_FLASH || l.params[0] <= 7));
  const rb = buildScanResult({ reportedCount: 12, channels: big.res, entered: true });
  assert.ok(rb.warnings.some((w) => /reported 12/.test(w)));
  const short = await scan({ escCount: 3, channels: bluejays(3) });
  assert.equal(short.res.length, 3);
  for (const bad of [undefined, -1, 1.5, NaN, '4']) assert.deepEqual(await run(short.clock, short.b.identifyAll({ count: bad })), []);
  pass('channel count 0, 3, 12 and invalid values are handled');
}

// ---- boundary-wide write discipline
{
  const runs = [];
  for (const scenario of [{ channels: bluejays() }, { channels: [{ kind: 'silent' }, { kind: 'init-fail' }, { kind: 'am32' }, { kind: 'badcrc' }] }, { channels: bluejays(), exit: 'no-reply' }, { escCount: 12, channels: bluejays(12) }]) {
    const h = await scan(scenario);
    await run(h.clock, h.b.resetChannels([0, 1]));
    await run(h.clock, h.b.exit());
    runs.push(h);
  }
  let frames = 0;
  for (const h of runs) {
    for (const l of h.t.fourway.log) { frames++; assert.ok(allowed.has(l.cmd), 'allowlisted'); assert.ok(!prohibited.has(l.cmd), 'not prohibited'); }
    assert.deepEqual(h.t.fourway.mspWhileFourWay, [], 'no MSP or motor bytes while in 4-way');
    for (const l of h.t.fourway.log) { if (l.cmd === FOURWAY_CMD.DEVICE_READ) assert.ok(l.params[0] >= 1 && l.addr !== 0xffff); }
  }
  assert.ok(frames > 20);
  pass(`all ${frames} written frames are allowlisted, none prohibited, no non-4-way bytes while active`);
}
