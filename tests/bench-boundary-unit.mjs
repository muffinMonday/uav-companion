// Phase 3 bench test: the guarded motor boundary, the allowlist and the recovery marker, on mocked transports only.
import assert from 'node:assert/strict';
import { MotorBoundary, MotorCommandRefused, MSP_SET_MOTOR_ID, buildMotorFrame, parseMotorFrame } from '../src/benchtest/motor-control.js';
import { MockTransport, Transport } from '../src/preflight/transport.js';
import { OWNER_APPROVED, REQUIRED_FIELDS, SYNTHETIC_ALLOWLIST, matchAllowlist, validateEntry } from '../src/benchtest/allowlist.js';
import { createMarkerStore } from '../src/benchtest/recovery-marker.js';
import { BENCH_TIMINGS, MOTOR, RECOVERY_KEY } from '../src/benchtest/constants.js';
import { STATE, createMachine } from '../src/benchtest/state-machine.js';
import { FakeClock, memoryStorage, makeHarness } from './bench-helpers.mjs';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { encodeRequest, encodeResponseV1 } from '../src/preflight/msp-codec.js';

const pass = (t) => console.log('PASS  ' + t);
const throwsRefused = (fn, msg) => assert.throws(fn, (e) => e instanceof MotorCommandRefused, msg);

const permissive = () => ({ ok: true, maxValue: 5000, reason: '' }); // even a permissive authorizer cannot widen the boundary's own limits
const mkBoundary = (authorize = permissive, tOpts = {}) => {
  const clock = new FakeClock();
  const t = benchFcTransport({}, tOpts);
  const acks = [];
  const b = new MotorBoundary({ transport: t, authorize, clock, onAck: (a) => acks.push(a) });
  return { clock, t, b, acks };
};

// ---------- frame construction
{
  const f = buildMotorFrame([1000, 1020, 1000, 1000, 1000, 1000, 1000, 1000]);
  assert.equal(f.length, 22);
  assert.equal(f[4], MSP_SET_MOTOR_ID);
  assert.deepEqual(parseMotorFrame(f), [1000, 1020, 1000, 1000, 1000, 1000, 1000, 1000]);
  for (const bad of [[1000], Array(8).fill(999), Array(8).fill(1101), Array(8).fill(2000), Array(8).fill(0), [...Array(7).fill(1000), 1000.5], [...Array(7).fill(1000), '1000'], null]) {
    throwsRefused(() => buildMotorFrame(bad), `frame refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(parseMotorFrame(Uint8Array.from([...f.slice(0, 21), f[21] ^ 1])), null, 'bad checksum');
  // the read-only transport path still refuses the frame: write() is the read-only gate
  const t = new MockTransport(() => null);
  assert.throws(() => t.write(f), (e) => e.code === 'write-blocked');
  assert.ok(Transport.prototype.write.toString().includes('isAllowedRequestFrame'));
  pass('motor frames: eight values in 1000..1100 only; the read-only transport write() still refuses them');
}

// ---------- hard limits independent of the state machine
{
  const { b, t } = mkBoundary();
  for (const [m, v] of [[0, 1101], [0, 1200], [0, 2000], [0, 0], [0, 999], [0, 1019], [0, 1001], [0, -5], [0, 1050.5], [0, '1050'], [0, NaN], [0, Infinity], [4, 1050], [-1, 1050], [1.5, 1050], ['0', 1050], [undefined, 1050]]) {
    throwsRefused(() => b.sendOutput(m, v), `refused motor ${m} value ${v}`);
  }
  assert.equal(t.sent.length, 0, 'nothing reached the transport');
  const r = await b.sendOutput(0, 1100);
  assert.equal(r.ok, true);
  assert.deepEqual(parseMotorFrame(t.sent[0]), [1100, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
  pass('the boundary refuses any value above 1100, below 1020 (unless exactly 1000), non-integers and motors outside the four, even with a permissive authorizer');
}

// ---------- one motor at a time
{
  const { b, t } = mkBoundary();
  await b.sendOutput(1, 1040);
  await b.sendOutput(3, 1040); // the machine would refuse this; the boundary itself still never raises two slots in one frame
  for (const f of t.sent) assert.ok(parseMotorFrame(f).filter((v) => v !== 1000).length <= 1, 'at most one raised slot per frame');
  assert.deepEqual(parseMotorFrame(t.sent[1]), [1000, 1000, 1000, 1040, 1000, 1000, 1000, 1000], 'switching motors drops the previous one to 1000 in the same frame');
  assert.deepEqual(b.commandedValues(), [1000, 1000, 1000, 1040]);
  // slots 5..8 are always 1000
  assert.ok(t.sent.every((f) => parseMotorFrame(f).slice(4).every((v) => v === 1000)));
  pass('one motor at a time: every frame carries at most one value above 1000; slots 5 to 8 stay at 1000');
}

// ---------- authorization: the machine's answer is required and its ceiling is binding
{
  const calls = [];
  const { b, t } = mkBoundary((req) => { calls.push(req); return { ok: false, maxValue: 0, reason: 'denied by the machine' }; });
  throwsRefused(() => b.sendStop());
  throwsRefused(() => b.sendOutput(0, 1020));
  assert.equal(calls.length, 2);
  assert.equal(t.sent.length, 0);
  throwsRefused(() => new MotorBoundary({ transport: t, authorize: null }));
  const stopOnly = mkBoundary(() => ({ ok: true, maxValue: 1000, reason: '' }));
  await stopOnly.b.sendStop();
  throwsRefused(() => stopOnly.b.sendOutput(0, 1020), 'a stop-only permission cannot send 1020');
  throwsRefused(() => stopOnly.b.sendOutput(0, 1100));
  await stopOnly.b.sendOutput(0, 1000); // external 1000 is allowed
  for (const f of stopOnly.t.sent) assert.ok(parseMotorFrame(f).every((v) => v === 1000));
  pass('the boundary needs the machine\'s permission and obeys its ceiling: a stop-only permission can only ever send external 1000');
}

// ---------- exact external-1000 semantics
{
  const { b, t } = mkBoundary();
  await b.sendStop();
  assert.deepEqual(parseMotorFrame(t.sent[0]), Array(8).fill(1000));
  assert.ok(!t.sent.some((f) => parseMotorFrame(f).includes(0)), 'never the raw 0 used by other protocols');
  assert.equal(MOTOR.stopValue, 1000);
  pass('stop means external 1000 on all eight slots, never 0');
}

// ---------- acknowledgement: 150 ms timeout, two consecutive failures, and an ack is never stop proof
{
  const { b, clock, acks } = mkBoundary(permissive, {});
  const p = mkBoundary(permissive);
  p.t.fc.inject.silentSetMotor = true;
  const r1 = p.b.sendOutput(0, 1020);
  await p.clock.advance(149); assert.equal(p.acks.length, 0, 'not failed before 150 ms');
  await p.clock.advance(2);
  assert.deepEqual((await r1), { ok: false, consecutiveFailures: 1 });
  p.b.sendOutput(0, 1020); await p.clock.advance(200);
  assert.deepEqual(p.acks.map((a) => [a.ok, a.consecutiveFailures]), [[false, 1], [false, 2]], 'two consecutive failures are reported');
  p.t.fc.inject.silentSetMotor = false;
  await p.b.sendOutput(0, 1020);
  assert.equal(p.acks.at(-1).consecutiveFailures, 0, 'a success resets the count');
  p.t.fc.inject.rejectSetMotor = true;
  const r = await p.b.sendOutput(0, 1020);
  assert.equal(r.ok, false, 'an MSP error frame is a failure');
  void b; void clock; void acks;
  pass('motor acknowledgement: 150 ms timeout, consecutive failures counted and reset, MSP error frames count as failures');
}

// ---------- the machine decides on two consecutive ack failures; one failure is tolerated
{
  const h = await makeHarness(); await h.toMotorReady();
  await h.startMotor(0);
  h.fc.inject.silentSetMotor = true;
  await h.adv(450); // the next ramp step is sent and not acknowledged
  assert.equal(h.state(), STATE.RUNNING, 'one acknowledgement failure is tolerated');
  await h.adv(900);
  assert.equal(h.state(), STATE.LOCKED_FAULT);
  assert.equal(h.faultReason(), 'acknowledgement-failure');
  pass('two consecutive acknowledgement failures lock the session; one does not');
}

// ---------- allowlist
{
  assert.equal(OWNER_APPROVED.length, 0, 'no real FC/ESC combination is approved by default');
  assert.ok(Object.isFrozen(OWNER_APPROVED) && Object.isFrozen(SYNTHETIC_ALLOWLIST));
  const id = { variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'SYNTH', boardId: 'SYN1', escFamily: 'Bluejay', escModel: 'synthetic', motorProtocol: 'DSHOT600' };
  assert.ok(matchAllowlist(id, 'mock', SYNTHETIC_ALLOWLIST).entry, 'the synthetic entry matches the mock');
  assert.equal(matchAllowlist(id, 'web-serial', SYNTHETIC_ALLOWLIST).entry, null, 'a synthetic entry never authorizes a real transport');
  assert.equal(matchAllowlist(id, 'web-serial').entry, null, 'the empty owner list approves nothing');
  assert.equal(matchAllowlist(id, 'mock').entry, null);
  for (const f of ['variant', 'firmware', 'api', 'targetName', 'boardId', 'escFamily', 'escModel', 'motorProtocol']) {
    assert.equal(matchAllowlist({ ...id, [f]: f === 'firmware' ? '2026.6.2' : 'other' }, 'mock', SYNTHETIC_ALLOWLIST).entry, null, `a different ${f} does not match`);
    assert.equal(matchAllowlist({ ...id, [f]: '' }, 'mock', SYNTHETIC_ALLOWLIST).entry, null, `an unknown ${f} does not match`);
  }
  const real = { ...id, targetName: 'REAL', boardId: 'REAL', approvedBy: 'owner', approvedOn: '2026-12-01' };
  const entry = { variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'REAL', boardId: 'REAL', escFamily: 'Bluejay', escModel: 'x', motorProtocol: 'DSHOT600', approvedBy: 'owner', approvedOn: '2026-12-01' };
  assert.equal(validateEntry(entry), null);
  assert.ok(matchAllowlist({ ...id, targetName: 'REAL', boardId: 'REAL', escModel: 'x' }, 'web-serial', [entry]).entry, 'an owner entry matches exactly');
  assert.equal(matchAllowlist({ ...id, targetName: 'REAL', boardId: 'REAL', escModel: 'x' }, 'mock', [entry]).entry, null, 'a real entry never authorizes the mock');
  for (const f of REQUIRED_FIELDS) assert.notEqual(validateEntry({ ...entry, [f]: '' }), null, `an entry without ${f} is invalid`);
  assert.notEqual(validateEntry({ ...entry, approvedOn: 'yesterday' }), null);
  assert.equal(matchAllowlist({ ...id, targetName: 'REAL', boardId: 'REAL', escModel: 'x' }, 'web-serial', [{ ...entry, approvedBy: '' }]).entry, null, 'a malformed entry never matches');
  void real;
  pass('allowlist: empty by default; exact match on eight identity fields; synthetic entries are mock-only; malformed entries never match');
}

// ---------- recovery marker
{
  const s = memoryStorage();
  const m = createMarkerStore(s);
  assert.equal(m.status(), 'absent');
  assert.equal(m.set(123), true);
  assert.equal(m.status(), 'present');
  assert.deepEqual(JSON.parse(s.getItem(RECOVERY_KEY)), { v: 1, unclean: true, at: 123 });
  assert.equal(m.clear(), true);
  assert.equal(m.status(), 'absent');
  assert.equal(createMarkerStore(memoryStorage({ failWrite: true })).set(), false, 'write failure');
  assert.equal(createMarkerStore(memoryStorage({ corruptWrite: true })).set(), false, 'a write that does not read back identically is not verified');
  assert.equal(createMarkerStore(memoryStorage({ failRead: true })).status(), 'unavailable');
  assert.equal(createMarkerStore(null).set(), false, 'no storage');
  assert.equal(createMarkerStore(null).status(), 'unavailable');
  assert.equal(createMarkerStore(memoryStorage({ failRemove: true })).clear(), false, 'a failed clear is reported');
  const throwing = { get getItem() { throw new Error('blocked'); } };
  assert.equal(createMarkerStore(throwing).status(), 'unavailable');
  pass('recovery marker: written then read back; any storage failure or mismatch is reported as not set');
}

// ---------- machine unit: marker presence at boot, storage unavailable
{
  assert.equal(createMachine({ markerPresent: true }).state, STATE.UNCLEAN_EXIT_RECOVERY);
  assert.equal(createMachine({ markerPresent: false }).state, STATE.DISCONNECTED);
  const m = createMachine({ markerPresent: true });
  assert.equal(m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  assert.equal(m.capabilities().showBatteryInstruction, true);
  void BENCH_TIMINGS; void encodeRequest; void encodeResponseV1;
  pass('a retained marker starts the machine in UNCLEAN_EXIT_RECOVERY with the battery instruction and no nonzero permission');
}

console.log('ALL OK');
