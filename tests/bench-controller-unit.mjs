// Phase 3 bench test: controller scenarios and fault injection against the SYNTHETIC flight controller (mocked transport,
// deterministic clock). No hardware, no browser. The hazard map is in docs/MOTOR_DIAGNOSTICS_FAULT_INJECTION_MATRIX.md.
import assert from 'node:assert/strict';
import { createBenchController } from '../src/benchtest/controller.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { parseMotorFrame } from '../src/benchtest/motor-control.js';
import { BATTERY_INSTRUCTION, BENCH_TIMINGS, CHECKLIST_ITEMS, EXPECTED_POSITIONS, MOTOR, RECOVERY_KEY, UNLOCK_PHRASE } from '../src/benchtest/constants.js';
import { STATE } from '../src/benchtest/state-machine.js';
import { FakeClock, REAL_ENTRY, makeHarness, memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const nonzero = (h, from = 0) => h.fc.received.slice(from).filter((v) => v.some((x) => x !== 1000));
const allStop = (v) => v.every((x) => x === 1000);

// state reachers returning a harness
const reach = {
  async ZERO() { const h = await makeHarness(); await h.toZeroVerification(); await h.adv(100); return h; },
  async READY() { const h = await makeHarness(); await h.toMotorReady(); return h; },
  async RUN() { const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(0); await h.adv(1500); return h; },
  async RUNFAULTY(fc) { const h = await makeHarness({ fc }); await h.toMotorReady(); await h.startMotor(0); await h.adv(100); return h; },
  async VERIFY() { const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(0); await h.adv(4700); return h; },
};

// ---------- the happy path really runs one motor to a plateau and back, with only that motor raised
{
  const h = await reach.READY();
  const r = await h.startMotor(0);
  assert.equal(r.ok, true);
  await h.adv(4700);
  assert.equal(h.state(), STATE.VERIFYING_STOP, h.faultReason());
  const raised = nonzero(h);
  assert.ok(raised.length > 0);
  assert.ok(raised.every((v) => v.slice(1).every((x) => x === 1000) && v[0] <= MOTOR.cap), 'only motor 0, never above 1100');
  const values = [...new Set(raised.map((v) => v[0]))];
  assert.deepEqual(values, [1020, 1025, 1030, 1045], 'ramp 1020, +5, stop at the start threshold 1030, plateau threshold + 15 = 1045');
  assert.ok(Math.max(...values) <= 1100);
  assert.equal(h.c.view().sweep, null);
  await h.finishStopProof(EXPECTED_POSITIONS[0]);
  assert.equal(h.state(), STATE.MOTOR_READY);
  assert.deepEqual(h.caps().completedMotors, [0]);
  assert.equal(allStop(h.fc.received.at(-1)), true, 'the run ends at external 1000');
  pass('a synthetic sweep ramps from 1020 in steps of 5, confirms rotation, holds a plateau at the threshold + 15 and returns to 1000 for one motor only');
}

// ---------- no unapproved hardware reaches a nonzero command
{
  const h = await makeHarness({ allowlist: [] }); await h.toReadiness();
  assert.equal(h.c.proceed().ok, false, 'mock without an allowlist entry cannot proceed');
  assert.equal(nonzero(h).length, 0);
  const h2 = await makeHarness({ fc: { firmware: '2026.6.2', api: '1.48' } }); await h2.toReadiness();
  assert.equal(h2.c.proceed().ok, false, 'a different firmware is not the allowlisted combination');
  const h3 = await makeHarness({ fc: { firmware: '4.4.3', api: '1.45' } }); await h3.toReadiness();
  assert.equal(h3.c.proceed().ok, false, 'an unsupported firmware is blocked by the gates');
  assert.ok(h3.caps().policy.blockers.some((b) => b.id === 'firmware' || b.id === 'bb-fields'));
  const h4 = await makeHarness({ fc: { motorCount: 3 } }); await h4.toReadiness();
  assert.equal(h4.c.proceed().ok, false, 'three motors');
  const h5 = await makeHarness({ fc: { threeD: true } }); await h5.toReadiness();
  assert.equal(h5.c.proceed().ok, false, '3D mode');
  const h6 = await makeHarness({ fc: { dshotTelemetry: false } }); await h6.toReadiness();
  assert.equal(h6.c.proceed().ok, false, 'bidirectional DShot off');
  const h7 = await makeHarness({ fc: { protocol: 0 } }); await h7.toReadiness();
  assert.equal(h7.c.proceed().ok, false, 'PWM protocol');
  const h8 = await makeHarness({ fc: { armed: true } }); h8.fc.inject.armed = true; await h8.toReadiness();
  assert.equal(h8.c.proceed().ok, false, 'armed');
  const h9 = await makeHarness({ fc: { blackbox: { supported: true, device: 0, rateDenom: 1, pRatio: 1, sampleRate: 0, mask: 0, maskPresent: true } } }); await h9.toReadiness();
  assert.equal(h9.c.machine.ctx.policy.nonzeroOk, true, 'Blackbox configuration is deferred and never a readiness blocker (no device, no mode attestation)');
  const h10 = await makeHarness(); await h10.c.connect(h10.t); // no attestations: arming, mode and battery are unknown
  assert.equal(h10.c.proceed().ok, false, 'attestations missing');
  for (const x of [h, h2, h3, h4, h5, h6, h7, h8, h10]) assert.equal(x.fc.received.length, 0, 'not one motor frame, not even a stop, before the readiness policy is met');
  pass('unapproved or unready hardware (no allowlist entry, other firmware, unsupported firmware, 3 motors, 3D, no bidirectional DShot, PWM, armed, missing attestations; a missing Blackbox device is no longer a blocker) never reaches a motor command');
}

// ---------- stop-validation-only mode on a "real" transport kind without an allowlist
{
  const h = await makeHarness(); h.t.kind = 'web-serial';
  await h.toReadiness();
  assert.equal(h.caps().mode, 'real');
  assert.equal(h.caps().policy.gatesOk, false, 'real hardware starts locked');
  assert.equal(h.c.startStopValidation().ok, false, 'locked: no stop validation either');
  assert.equal(h.c.unlock('wrong phrase', true).ok, false);
  assert.equal(h.c.unlock(UNLOCK_PHRASE, false).ok, false, 'the acknowledgement is required');
  assert.equal(h.caps().unlocked, false);
  assert.equal(h.c.unlock(UNLOCK_PHRASE, true).ok, true);
  assert.equal(h.caps().unlocked, true);
  assert.equal(h.caps().policy.nonzeroOk, false, 'no real combination is approved');
  assert.equal(h.caps().canProceed, false);
  assert.equal(h.c.proceed().ok, false);
  assert.equal(h.state(), STATE.READ_ONLY_READINESS);
  assert.equal(h.c.startStopValidation().ok, true);
  assert.equal(h.state(), STATE.STOP_VALIDATION_ONLY);
  assert.equal(h.caps().maxOutput, 1000);
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1020 }).ok, false, 'incapable of any value other than 1000');
  assert.equal(h.caps().canStart, false);
  await h.adv(3000);
  assert.equal(h.caps().proof.partsDone, true);
  assert.equal(h.c.finishStopValidation().ok, false, 'the user confirmation is required');
  h.c.confirmNoRotation();
  assert.equal(h.c.finishStopValidation().ok, true);
  assert.ok(h.fc.received.length >= 10 && h.fc.received.every(allStop), 'only external 1000 was ever sent');
  assert.equal(h.caps().usbStopValidated, true);
  pass('stop-validation-only: needs the unlock, sends only external 1000 (permission ceiling 1000), completes with the four-part proof; no nonzero path exists');

  // a real-transport entry on the allowlist is honoured only after the unlock
  const entry = { ...REAL_ENTRY };
  const g = await makeHarness({ allowlist: [entry] }); g.t.kind = 'web-serial'; await g.toReadiness();
  assert.equal(g.c.proceed().ok, false, 'locked first');
  g.c.unlock(UNLOCK_PHRASE, true);
  assert.equal(g.caps().policy.nonzeroOk, true, 'an exact owner entry plus the unlock plus the gates enable the path');
  const synthOnly = await makeHarness({ allowlist: [{ ...entry, synthetic: true }] }); synthOnly.t.kind = 'web-serial'; await synthOnly.toReadiness(); synthOnly.c.unlock(UNLOCK_PHRASE, true);
  assert.equal(synthOnly.caps().policy.nonzeroOk, false, 'a synthetic entry never authorizes a real transport');
  pass('an owner allowlist entry works only on the exact combination, after the unlock; synthetic entries never work on a real transport');
}

// ---------- session unlock expires on reload, reconnect, fault and page loss
{
  const real = async () => { const h = await makeHarness(); h.t.kind = 'web-serial'; await h.toReadiness(); h.c.unlock(UNLOCK_PHRASE, true); return h; };
  let h = await real(); assert.equal(h.caps().unlocked, true);
  const reloaded = createBenchController({ clock: h.clock, marker: h.marker });
  assert.equal(reloaded.view().caps.unlocked, false, 'reload');
  h.t.disconnect(); assert.equal(h.caps().unlocked, false, 'transport loss');
  const t2 = benchFcTransport(); t2.kind = 'web-serial'; await h.c.connect(t2); assert.equal(h.caps().unlocked, false, 'reconnect');
  h = await real(); h.c.notifyVisibilityLoss('hidden'); assert.equal(h.caps().unlocked, false, 'visibility loss');
  h = await real(); h.m.dispatch('FAULT', { now: 1, reason: 'x' }); assert.equal(h.caps().unlocked, false, 'fault');
  h = await real(); h.c.lock(); assert.equal(h.caps().unlocked, false, 'explicit lock');
  h = await real(); h.c.reset(); assert.equal(h.caps().unlocked, false, 'reset');
  // a mock session needs no unlock and cannot be unlocked
  const m = await makeHarness(); await m.toReadiness();
  assert.equal(m.c.unlock(UNLOCK_PHRASE, true).ok, false);
  assert.equal(m.caps().mode, 'mock');
  pass('the session unlock is never persisted: it expires on reload, reconnect, transport loss, fault, visibility loss, lock and reset');
}

// ---------- exact stop semantics, cadence and count (H7)
{
  const h = await reach.RUN();
  const frames = [];
  const orig = h.t._write.bind(h.t);
  h.t._write = (b) => { const v = parseMotorFrame(b); if (v) frames.push([h.clock.now(), v]); return orig(b); };
  const t0 = h.clock.now();
  const before = h.fc.received.length;
  h.c.stopAndZero();
  assert.equal(h.state(), STATE.LOCKED_FAULT);
  assert.equal(frames.length, 1, 'the first external 1000 is sent synchronously inside the Stop action');
  assert.ok(allStop(frames[0][1]) && frames[0][0] === t0);
  await h.adv(700);
  const stops = frames.filter(([, v]) => allStop(v));
  assert.ok(stops.length >= BENCH_TIMINGS.stopMinAttempts, `at least ${BENCH_TIMINGS.stopMinAttempts} stop attempts (${stops.length})`);
  const gaps = stops.slice(1, 11).map((f, i) => f[0] - stops[i][0]);
  assert.ok(gaps.every((g) => g === BENCH_TIMINGS.stopCadenceMs), `cadence is exactly ${BENCH_TIMINGS.stopCadenceMs} ms: ${gaps.join(',')}`);
  assert.ok(stops[9][0] - stops[0][0] >= 450, 'ten attempts span at least 450 ms');
  assert.ok(nonzero(h, before).length === 0, 'after the stop no nonzero frame is sent');
  pass('Stop & zero sends external 1000 synchronously, then every 50 ms for at least ten attempts; nothing nonzero follows');
}

// ---------- an acknowledgement alone is not stop proof; each proof part is required (H7)
{
  const cases = {
    'frozen RPM (a motor still reports rotation)': { rpmFrozen: [900, 0, 0, 0] },
    'read-back stuck at a nonzero value': { stuckReadback: [1030, 1000, 1000, 1000] },
    'stop acknowledged but ignored (read-back and RPM stay)': { ignoreStop: true },
  };
  for (const [name, inject] of Object.entries(cases)) {
    const h = await reach.RUN();
    Object.assign(h.fc.inject, inject);
    h.c.stopAndZero();
    await h.adv(15000);
    const p = h.caps().proof;
    assert.ok(p.acks >= 10, `${name}: acknowledgements arrived (${p.acks})`);
    assert.equal(p.partsDone, false, `${name}: acknowledgements alone are not stop proof`);
    assert.equal(h.caps().canConfirmNoRotation, false, `${name}: the user confirmation is not even offered`);
    assert.equal(h.c.confirmNoRotation().ok, false);
    assert.equal(h.caps().showBatteryInstruction, true);
    assert.equal(h.c.view().notes.proofFailed, true, `${name}: reported as incomplete`);
    assert.equal(h.state(), STATE.LOCKED_FAULT);
  }
  // the read-back check on its own: RPM zero and acks fine, read-back wrong
  const h = await reach.RUN(); h.fc.inject.stuckReadback = [1010, 1000, 1000, 1000]; h.c.stopAndZero(); await h.adv(3000);
  assert.equal(h.caps().proof.readbackOk, false); assert.equal(h.caps().proof.zeroOk, true); assert.equal(h.caps().proof.partsDone, false);
  pass('stop proof needs repeated 1000, FC read-back of exactly 1000 on all four motors, valid zero RPM for 1 s and the user: acknowledgement alone, read-back alone and zero RPM alone never complete it');
}

// ---------- stale or unavailable telemetry (H6)
{
  for (const [name, inject, states] of [
    ['silent', { telemetrySilent: true }, ['ZERO', 'READY', 'RUN']],
    ['error frames', { telemetryError: true }, ['ZERO', 'READY', 'RUN']],
  ]) {
    for (const s of states) {
      const h = await reach[s]();
      Object.assign(h.fc.inject, inject);
      await h.adv(500);
      assert.equal(h.state(), STATE.LOCKED_FAULT, `${name} telemetry in ${s}`);
      assert.equal(h.faultReason(), 'telemetry-stale-or-unavailable');
      assert.equal(h.caps().showBatteryInstruction, true);
    }
  }
  // stale: detection is within about 200 ms of the last good sample plus one poll
  const h = await reach.READY(); h.fc.inject.telemetrySilent = true;
  const t0 = h.clock.now(); await h.adv(160); assert.equal(h.state(), STATE.MOTOR_READY, 'not yet stale at 160 ms');
  await h.adv(120); assert.equal(h.state(), STATE.LOCKED_FAULT); assert.ok(h.clock.now() - t0 <= 300);
  // stale telemetry is never accepted as zero during a stop
  const s = await reach.RUN(); s.c.stopAndZero(); s.fc.inject.telemetrySilent = true; await s.adv(14000);
  assert.equal(s.caps().proof.zeroOk, false, 'stale RPM is never accepted as zero');
  assert.equal(s.caps().proof.partsDone, false);
  // a started run needs fresh telemetry: silent telemetry at start time refuses it
  const r = await reach.READY(); r.c.selectMotor(0); r.c.confirmTarget(0); r.m.ctx.facts = { ...r.m.ctx.facts, telemetryAt: r.clock.now() - 500 };
  assert.equal(r.c.startMotor(1000).ok, false);
  pass('silent or erroring telemetry in ZERO_VERIFICATION, MOTOR_READY and RUNNING locks the session within ~200 ms; stale RPM is never accepted as zero; a start needs fresh telemetry');
}

// ---------- unexpected RPM (H1)
{
  let h = await reach.RUNFAULTY({ startValue: [1030, 1040, 1035, 1045] });
  h.fc.inject.extraRpm = { index: 1, rpm: 300 }; await h.adv(200);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'peer-motor-rpm'], 'another motor rotates while motor 0 runs');
  h = await reach.RUNFAULTY({ rpmPerUnit: 1e6 }); await h.adv(1500);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'rpm-above-plausibility-ceiling'], 'selected motor above the plausibility ceiling');
  h = await reach.ZERO(); h.fc.inject.rpmFrozen = [0, 0, 5, 0]; await h.adv(200);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'rotation-during-zero-verification'], 'rotation during zero verification');
  h = await reach.READY(); h.fc.inject.extraRpm = { index: 3, rpm: 10 }; await h.adv(200);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'unexpected-rotation'], 'rotation while idle at MOTOR_READY');
  for (const x of [h]) assert.equal(nonzero(x).length, 0);
  pass('unexpected RPM on another motor, above the ceiling on the selected motor, during zero verification and while idle each lock the session');
}

// ---------- arming, voltage, temperature, read-back (H3, H8)
{
  for (const s of ['ZERO', 'READY', 'RUN']) {
    const h = await reach[s](); h.fc.inject.armed = true; await h.adv(400);
    assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'arming-state-changed'], `arming change in ${s}`);
  }
  let h = await reach.READY(); h.fc.inject.statusSilent = true; await h.adv(1500);
  assert.equal(h.state(), STATE.LOCKED_FAULT, 'an unreadable arming state fails closed (the shared read queue stalls, so telemetry may go stale first)');
  assert.ok(['arming-state-unavailable', 'telemetry-stale-or-unavailable'].includes(h.faultReason()));
  h = await reach.READY(); const ob = h.m.ctx.facts;
  h.m.dispatch('OBSERVE', { ...ob, now: h.clock.now(), armedAt: h.clock.now() - 2000 });
  assert.equal(h.faultReason(), 'arming-state-unavailable', 'an arming state older than 750 ms is unavailable');
  h = await reach.READY(); h.m.dispatch('OBSERVE', { ...h.m.ctx.facts, now: h.clock.now(), armed: null });
  assert.equal(h.faultReason(), 'arming-state-unavailable', 'an unknown arming state is a fault');
  h = await reach.RUNFAULTY({ inject: { sagOnNonzero_cV: 500 } }); await h.adv(1500);
  assert.equal(h.faultReason(), 'voltage-fault');
  h = await reach.READY(); h.fc.inject.tempC = 95; await h.adv(300);
  assert.equal(h.faultReason(), 'temperature-fault');
  h = await reach.RUNFAULTY({}); h.fc.inject.stuckReadback = [1000, 1000, 1000, 1000]; await h.adv(600);
  assert.equal(h.faultReason(), 'readback-mismatch', 'FC-side read-back differs from the commanded value');
  h = await reach.RUNFAULTY({}); h.m.dispatch('OBSERVE', { ...h.m.ctx.facts, now: h.clock.now(), readback: { values: [1020, 1000, 1000, 1000], at: h.clock.now() - 2000, current: true } });
  assert.equal(h.faultReason(), 'readback-unavailable', 'a read-back older than 1 s in RUNNING is a fault');
  pass('arming change (in three powered states), unreadable arming state, voltage sag, over-temperature, read-back mismatch and missing read-back each lock the session');
}

// ---------- disconnect at every powered state (H4)
{
  const where = { 'POWERED_ZERO_VERIFICATION': reach.ZERO, 'MOTOR_READY': reach.READY, 'RUNNING (nonzero output)': reach.RUN, 'VERIFYING_STOP': reach.VERIFY };
  for (const [name, fn] of Object.entries(where)) {
    const h = await fn();
    const n0 = h.fc.received.length;
    if (name.startsWith('RUNNING')) assert.ok(nonzero(h).length > 0 && h.caps().maxOutput === 1100, 'output was nonzero');
    h.t.disconnect();
    assert.equal(h.state(), STATE.LOCKED_FAULT, name);
    assert.equal(h.faultReason(), 'transport-lost', name);
    const c = h.caps();
    assert.equal(c.showBatteryInstruction, true);
    assert.equal(c.transportAvailable, false);
    assert.equal(c.proof.complete, false, 'never claims stopped');
    assert.equal(c.canConfirmNoRotation, false);
    await h.adv(3000);
    assert.equal(h.fc.received.length, n0, `${name}: nothing is sent into a lost transport`);
    assert.equal(h.c.confirmNoRotation().ok, false);
  }
  assert.equal(BATTERY_INSTRUCTION, 'Disconnect the flight battery now.');
  pass('USB loss in POWERED_ZERO_VERIFICATION, MOTOR_READY, RUNNING (nonzero) and VERIFYING_STOP locks the session, leads with "Disconnect the flight battery now." and never claims a stop');
}

// ---------- page visibility and focus (H5)
{
  for (const [name, fn] of Object.entries({ ZERO: reach.ZERO, READY: reach.READY, RUN: reach.RUN, VERIFY: reach.VERIFY })) {
    const h = await fn();
    h.c.notifyVisibilityLoss('hidden');
    assert.equal(h.state(), STATE.LOCKED_FAULT, name);
    assert.equal(h.faultReason(), 'visibility-or-focus-lost:hidden');
    assert.ok(allStop(h.fc.received.at(-1)), `${name}: a stop is attempted at once where execution survives`);
    assert.equal(h.caps().showBatteryInstruction, true);
  }
  // before power: the checklist expires; not a fault
  const h = await makeHarness(); await h.toChecklist();
  for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
  h.c.notifyVisibilityLoss('blur');
  assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
  assert.equal(h.caps().canFinalHold, false, 'the checklist is cleared');
  assert.equal(h.caps().canCompleteChecklist, false);
  // ready to power, battery not yet connected: back to the checklist
  const r = await makeHarness(); await r.toReadyToPower(); r.c.notifyVisibilityLoss('hidden');
  assert.equal(r.state(), STATE.SAFETY_CHECKLIST);
  // battery declared connected: a fault
  const p = await makeHarness(); await p.toReadyToPower(); p.c.declareBatteryConnected(); p.c.notifyVisibilityLoss('hidden');
  assert.equal(p.state(), STATE.LOCKED_FAULT);
  // read-only: nothing to stop
  const ro = await makeHarness(); await ro.toReadiness(); ro.c.notifyVisibilityLoss('hidden');
  assert.equal(ro.state(), STATE.READ_ONLY_READINESS);
  pass('visibility or focus loss while powered locks the session and attempts a stop; before power it expires the checklist');
}

// ---------- power-connect reconnect grace (H4)
{
  const asPowered = async () => { const h = await makeHarness(); await h.toReadyToPower(); h.c.declareBatteryConnected(); await h.adv(200); return h; };
  // inside the window
  let h = await asPowered();
  h.t.disconnect();
  assert.equal(h.state(), STATE.POWER_CONNECT_RECONNECT);
  assert.equal(h.caps().maxOutput, 1000, 'nonzero output stays prohibited');
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1020 }).ok, false);
  await h.adv(4000);
  const t2 = benchFcTransport();
  await h.c.connect(t2);
  assert.equal(h.state(), STATE.POWER_CONNECT_RECONNECT);
  await h.adv(1500);
  assert.equal(h.m.ctx.safeStateDone, true, 'safe-state initialization repeated after the reconnect');
  assert.ok(t2.fc.received.length >= 10 && t2.fc.received.every(allStop), 'external 1000 on the new session');
  await h.adv(5200);
  assert.equal(h.state(), STATE.POWERED_ZERO_VERIFICATION);
  await h.adv(3500);
  assert.equal(h.state(), STATE.MOTOR_READY);
  pass('a USB reset after the battery was declared connected, reconnected within 15 s, repeats the safe state and powered-zero verification and then reaches MOTOR_READY');
  // outside the window
  h = await asPowered(); h.t.disconnect(); await h.adv(16000);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'reconnect-grace-expired']);
  assert.equal(h.caps().showBatteryInstruction, true);
  const late = benchFcTransport(); await h.c.connect(late);
  assert.equal(h.state(), STATE.LOCKED_FAULT, 'a late reconnect does not resume');
  assert.equal(late.fc.received.length, 0, 'nothing is sent to a late reconnect outside the recovery flow');
  // a reconnect that arrives after the deadline but before the timer ran
  h = await asPowered(); h.t.disconnect(); h.clock.t += 16000; const late2 = benchFcTransport(); const r = await h.c.connect(late2);
  assert.equal(r.ok, false); assert.equal(h.state(), STATE.LOCKED_FAULT);
  // reconnect in a state that is not the grace state
  h = await reach.READY(); const other = benchFcTransport(); const r2 = await h.c.connect(other);
  assert.equal(r2.ok, false);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'reconnect-outside-grace']);
  // a different flight controller after the reset
  h = await asPowered(); h.t.disconnect(); await h.adv(1000); await h.c.connect(benchFcTransport({ uid: [9, 9, 9] })); await h.adv(100);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'different-flight-controller-after-reconnect']);
  // loss before the battery was declared: not the expected reset
  h = await makeHarness(); await h.toReadyToPower(); h.t.disconnect();
  assert.equal(h.state(), STATE.LOCKED_FAULT);
  // loss again while waiting in the grace state
  h = await asPowered(); h.t.disconnect(); await h.adv(500); const again = benchFcTransport(); await h.c.connect(again); again.disconnect();
  assert.equal(h.state(), STATE.POWER_CONNECT_RECONNECT);
  pass('reconnect outside the 15 s grace, outside the grace state, to a different flight controller, or before the battery was declared locks the session');
}

// ---------- durable recovery marker (H5)
{
  // write failure
  for (const [name, opts] of [['quota error', { failWrite: true }], ['write that does not read back', { corruptWrite: true }]]) {
    const h = await makeHarness({ storage: memoryStorage(opts) }); await h.toChecklist();
    for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
    const r = h.c.confirmChecklist(1000);
    assert.equal(r.ok, false, name);
    assert.equal(h.state(), STATE.SAFETY_CHECKLIST, `${name}: the battery step is not reachable`);
    assert.equal(h.caps().canDeclareBattery, false);
    assert.match(h.c.view().notes.markerError, /marker/);
  }
  // storage unavailable at start: read-only works, powered testing does not
  const blocked = memoryStorage({ failRead: true });
  const h = await makeHarness({ storage: blocked }); await h.toChecklist();
  for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
  assert.equal(h.caps().markerAvailable, false);
  assert.equal(h.c.confirmChecklist(1000).ok, false);
  assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
  // reload with the marker retained
  const s = memoryStorage();
  const a = await makeHarness({ storage: s }); await a.toReadyToPower();
  assert.ok(s.getItem(RECOVERY_KEY), 'the marker is set before battery connection is permitted');
  const clock = new FakeClock();
  const rel = createBenchController({ clock, marker: a.marker });
  assert.equal(rel.machine.state, STATE.UNCLEAN_EXIT_RECOVERY);
  assert.equal(rel.view().caps.showBatteryInstruction, true);
  assert.equal(rel.view().caps.maxOutput, 1000, 'stop value only'); assert.equal(rel.view().caps.canStart, false);
  assert.equal(rel.view().caps.canConnect, true);
  assert.equal(rel.machine.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  assert.equal(rel.machine.dispatch('READINESS_OK', { now: 1 }).ok, false, 'no ordinary navigation from recovery');
  // recovery: remove battery, reconnect, proof, confirm
  const t = benchFcTransport();
  await rel.connect(t);
  assert.equal(rel.machine.state, STATE.BATTERY_REMOVAL_RECOVERY);
  assert.ok(t.fc.received.length >= 1 && t.fc.received.every(allStop), 'external 1000 is sent on every new FC session regardless of the marker');
  await clock.advance(3000);
  assert.equal(rel.completeRecovery().ok, false, 'not before battery removal and the user confirmation');
  rel.confirmNoRotation();
  assert.equal(rel.completeRecovery().ok, false, 'the user confirmation alone is not enough');
  assert.ok(s.getItem(RECOVERY_KEY), 'marker still set');
  rel.confirmBatteryRemoved();
  assert.equal(rel.completeRecovery().ok, true);
  assert.equal(s.getItem(RECOVERY_KEY), null, 'cleared only after the stop proof and battery-removal confirmation');
  assert.equal(rel.machine.state, STATE.DISCONNECTED);
  pass('marker: a failed or unverifiable write blocks the battery step; blocked storage blocks powered testing; a retained marker leads with battery removal; it is cleared only after the stop proof and battery-removal confirmation');
}

// ---------- recovery after a fault needs battery-removal confirmation (H7)
{
  const s = memoryStorage();
  const h = await makeHarness({ storage: s }); await h.toMotorReady(); await h.startMotor(0); await h.adv(1500);
  h.c.stopAndZero(); await h.adv(3000);
  h.c.confirmNoRotation();
  assert.equal(h.state(), STATE.LOCKED_FAULT);
  assert.equal(h.caps().proof.complete, true);
  assert.equal(h.c.completeRecovery().ok, false, 'not from LOCKED_FAULT');
  h.c.beginBatteryRemoval();
  assert.equal(h.state(), STATE.BATTERY_REMOVAL_RECOVERY);
  assert.equal(h.c.completeRecovery().ok, false, 'a complete proof is not enough without battery removal');
  assert.ok(s.getItem(RECOVERY_KEY));
  h.c.confirmBatteryRemoved();
  assert.equal(h.c.completeRecovery().ok, true);
  assert.equal(s.getItem(RECOVERY_KEY), null);
  // a fault with the transport lost cannot be recovered in the same session without a fresh FC session and proof
  const g = await makeHarness({ storage: memoryStorage() }); await g.toMotorReady(); await g.startMotor(0); await g.adv(1500); g.t.disconnect();
  g.c.beginBatteryRemoval(); g.c.confirmBatteryRemoved();
  assert.equal(g.c.completeRecovery().ok, false, 'no stop proof exists');
  assert.ok(g.storage.getItem(RECOVERY_KEY));
  await g.c.connect(benchFcTransport()); await g.adv(3000); g.c.confirmNoRotation();
  assert.equal(g.c.completeRecovery().ok, true, 'a fresh session completes the proof');
  assert.equal(g.storage.getItem(RECOVERY_KEY), null);
  pass('recovery needs the four-part proof AND battery-removal confirmation; after a lost transport it needs a fresh FC session and proof');
}

// ---------- cancellation during ramp, validation and plateau (H1)
{
  for (const [name, at] of [['ramp', 100], ['candidate validation', 1700], ['plateau', 3000]]) {
    const h = await reach.READY(); await h.startMotor(0);
    await h.adv(at);
    const sweep = h.c.view().sweep;
    assert.equal(sweep.phase, name === 'candidate validation' ? 'validate' : name, `in ${name}`);
    h.c.stopAndZero();
    assert.ok(allStop(h.fc.received.at(-1)));
    assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'user-stop']);
    await h.adv(3000);
    assert.equal(h.caps().proof.partsDone, true, `${name}: the proof completes after the stop`);
    assert.equal(h.c.view().sweep, null);
    assert.equal(h.caps().maxOutput, 1000);
    const before = h.fc.received.length;
    await h.adv(2000);
    assert.ok(nonzero(h, before).length === 0, 'no further nonzero output');
  }
  pass('Stop & zero during the ramp, candidate validation and plateau returns to 1000, locks, and completes the proof');
}

// ---------- motor position (H1)
{
  for (const reported of ['front left', 'none', '', 'rear right ']) {
    const h = await reach.VERIFY(); await h.adv(3000); h.c.confirmNoRotation();
    assert.equal(h.caps().needsPosition, true);
    const r = h.c.reportPosition(reported);
    assert.equal(r.ok, false);
    assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'motor-position-mismatch'], `reported "${reported}"`);
    assert.equal(h.caps().completedMotors.length, 0);
  }
  // the position cannot be reported before the stop proof and the user confirmation
  const h = await reach.VERIFY();
  assert.equal(h.c.reportPosition(EXPECTED_POSITIONS[0]).ok, false);
  assert.equal(h.state(), STATE.VERIFYING_STOP, 'an early report is not a fault, and not accepted');
  pass('a physical-motor mismatch (wrong position, "none") locks the workflow; the position cannot be reported before the stop proof');
}

// ---------- no start by the cap aborts; timeout; command-path exception; handler exception
{
  const h = await makeHarness({ fc: { startValue: [9999, 9999, 9999, 9999] } }); await h.toMotorReady(); await h.startMotor(0); await h.adv(20000);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'no-stable-rotation-by-cap']);
  const top = Math.max(...h.fc.received.flat());
  assert.equal(top, 1100, 'the ramp reached the cap and did not exceed it');
  assert.ok(h.fc.received.every((v) => v.every((x) => x <= 1100)));
  assert.ok(allStop(h.fc.received.at(-1)));
  // the whole-run timeout
  const t = await reach.RUN(); t.c._sweepForTests().startedAt -= BENCH_TIMINGS.runTimeoutMs + 1; await t.adv(100);
  assert.deepEqual([t.state(), t.faultReason()], [STATE.LOCKED_FAULT, 'run-timeout']);
  // an uncaught error in the command path
  const e = await reach.READY(); e.c._obs.telemetry = { count: 4, motors: null }; await e.adv(100);
  assert.deepEqual([e.state(), e.faultReason()], [STATE.LOCKED_FAULT, 'uncaught-command-path-error']);
  assert.match(e.c.view().notes.error, /Internal error/);
  // an exception inside a machine handler
  const x = await reach.READY();
  const r = x.m.dispatch('SELECT_MOTOR', { now: x.clock.now(), get motor() { throw new Error('boom'); } });
  assert.equal(r.ok, false); assert.equal(x.state(), STATE.LOCKED_FAULT); assert.equal(x.faultReason(), 'handler-exception');
  // an uncaught error while stopping must not leave the machine in a state that permits output
  assert.equal(x.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  pass('reaching the cap without rotation aborts at 1100; a run timeout, a command-path exception and a handler exception each lock the session');
}

// ---------- stop-proof timeout fails closed
{
  const h = await reach.READY(); await h.startMotor(0); await h.adv(4700);
  assert.equal(h.state(), STATE.VERIFYING_STOP);
  h.fc.inject.rpmFrozen = [400, 0, 0, 0];
  await h.adv(BENCH_TIMINGS.stopProofTimeoutMs + 2000);
  assert.deepEqual([h.state(), h.faultReason()], [STATE.LOCKED_FAULT, 'stop-proof-incomplete']);
  assert.equal(h.caps().showBatteryInstruction, true);
  pass('a stop proof that does not complete within 10 s locks the session and shows the battery instruction');
}

// ---------- checklist expiry (H2)
{
  const full = async () => { const h = await makeHarness(); await h.toChecklist(); for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true); return h; };
  // an unticked item blocks the final hold
  let h = await full(); h.c.setChecklistItem('propsRemoved', false);
  assert.equal(h.c.confirmChecklist(1000).ok, false); assert.equal(h.caps().canFinalHold, false);
  // a short hold is refused
  h = await full(); assert.equal(h.c.confirmChecklist(300).ok, false); assert.equal(h.caps().canCompleteChecklist, false);
  // transport loss: reconnecting starts from nothing
  h = await full(); h.t.disconnect();
  assert.equal(h.state(), STATE.DISCONNECTED);
  await h.c.connect(benchFcTransport()); h.c.setAttestation({ armSwitchOff: true, throttleMin: true, batteryDisconnected: true });
  h.c.proceed(); await h.adv(1500);
  assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
  assert.equal(h.caps().canFinalHold, false, 'no item survived the reconnect');
  assert.equal(h.m.ctx.checklist.finalHold, false);
  // fault
  h = await full(); h.c.stopAndZero(); assert.deepEqual(h.m.ctx.checklist, { items: {}, finalHold: false });
  // unticking resets the final confirmation
  h = await full(); h.c.setChecklistItem('smokeStopper', false); h.c.setChecklistItem('smokeStopper', true); assert.equal(h.m.ctx.checklist.finalHold, false);
  // a reload is a new controller: blank
  h = await full(); const rel = createBenchController({ clock: h.clock, marker: h.marker }); assert.deepEqual(rel.machine.ctx.checklist, { items: {}, finalHold: false });
  pass('checklist confirmation expires on transport loss, fault, visibility loss, any untick and reload; a short or incomplete hold is refused');
}

// ---------- the user-facing instruction never claims a stop it cannot prove
{
  const h = await reach.RUN(); h.t.disconnect();
  const c = h.caps();
  assert.equal(c.proof.partsDone, false); assert.equal(c.fault.transportAvailable, false);
  assert.ok(c.showBatteryInstruction);
  pass('with the transport lost no stop-proof flag is ever set');
}

console.log('ALL OK');
