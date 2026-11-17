// Phase 3 bench test: regression tests for the four review findings (powered stop validation, verified marker deletion,
// DShot error statistics policy, stop-validation evidence bound to the allowlist). Synthetic and mocked only; no hardware.
// Hazard map: docs/MOTOR_DIAGNOSTICS_FAULT_INJECTION_MATRIX.md ("Review findings" section).
import assert from 'node:assert/strict';
import { createBenchController } from '../src/benchtest/controller.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { MotorBoundary, MotorCommandRefused, buildMotorFrame, parseMotorFrame } from '../src/benchtest/motor-control.js';
import { BATTERY_INSTRUCTION, BENCH_TIMINGS, CHECKLIST_ITEMS, DSHOT_STATS, MOTOR, RECOVERY_KEY } from '../src/benchtest/constants.js';
import { EVIDENCE_FIELDS, OWNER_APPROVED, REQUIRED_FIELDS, SYNTHETIC_ALLOWLIST, isCalendarDate, matchAllowlist, validateEntry } from '../src/benchtest/allowlist.js';
import { dshotStatus, startInterlocks } from '../src/benchtest/interlocks.js';
import { STATE, createMachine } from '../src/benchtest/state-machine.js';
import { createMarkerStore } from '../src/benchtest/recovery-marker.js';
import { FakeClock, REAL_ENTRY, makeHarness, memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const allStop = (f) => f.slice(0, 8).every((v) => v === MOTOR.stopValue);
const STOP_CODE = (frames) => frames.every(allStop);

// drive a harness to the powered stop validation state (the whole flow, as the user would)
async function toPoweredValidation(h) {
  await h.toReadiness();
  assert.equal(h.c.startStopValidation().ok, true);
  await h.adv(3000); h.c.confirmNoRotation();
  assert.equal(h.c.finishStopValidation().ok, true, 'USB-only validation completes first');
  assert.equal(h.c.startPoweredStopValidation().ok, true);
  await h.adv(1500);
  for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
  assert.equal(h.c.confirmChecklist(1000).ok, true);
  assert.equal(h.state(), STATE.READY_TO_CONNECT_POWER);
  h.c.declareBatteryConnected(); await h.adv(5100); await h.adv(3500);
  return h;
}

// ======================================================================================================
// FINDING 1: powered stop validation goes through the complete physical-safety flow
// ======================================================================================================
{
  // 1a. USB-only validation is its own labelled state and records no powered evidence
  const h = await makeHarness(); await h.toReadiness();
  assert.equal(h.caps().batteryState, 'attested-disconnected');
  assert.equal(h.c.startStopValidation().ok, true);
  assert.equal(h.state(), STATE.STOP_VALIDATION_ONLY);
  assert.equal(h.caps().flow, 'usb-stopval');
  assert.equal(h.c.declareBatteryConnected().ok, false, 'no battery step exists in the USB-only state');
  pass('USB-only stop validation is a separate flow with the battery attested disconnected');
}
{
  // 1b. powered validation cannot be entered directly from read-only readiness
  const h = await makeHarness(); await h.toReadiness();
  assert.equal(h.caps().canPoweredStopValidation, false);
  const r = h.c.startPoweredStopValidation();
  assert.equal(r.ok, false); assert.match(r.reason, /USB-only stop validation first/);
  assert.equal(h.state(), STATE.READ_ONLY_READINESS);
  assert.equal(h.fc.received.length, 0, 'nothing was sent');
  // a USB-only validation that was left without recording does not count either
  h.c.startStopValidation(); h.c.leaveStopValidation();
  assert.equal(h.c.startPoweredStopValidation().ok, false);
  // and a USB-only validation in an earlier connection does not carry over to a new one
  await h.adv(3000); await h.t.disconnect();
  assert.equal(h.state(), STATE.DISCONNECTED);
  pass('powered stop validation cannot be entered directly from read-only readiness, nor after an unrecorded USB-only run');
}
{
  // 1c. the old shortcut is gone: no battery step, no marker, no checklist in any USB-only state
  const h = await makeHarness(); await h.toReadiness(); h.c.startStopValidation();
  assert.equal(h.marker.status(), 'absent');
  assert.equal(h.m._tableForTests[STATE.STOP_VALIDATION_ONLY].BATTERY_DECLARED, undefined);
  assert.equal(h.m._tableForTests[STATE.STOP_VALIDATION_ONLY].CHECKLIST_COMPLETE, undefined);
  pass('the USB-only state has no path to a powered state');
}
{
  // 1d. each missing checklist item blocks the way to "ready to connect power"
  for (const missing of CHECKLIST_ITEMS) {
    const h = await makeHarness(); await h.toReadiness();
    h.c.startStopValidation(); await h.adv(3000); h.c.confirmNoRotation(); h.c.finishStopValidation();
    h.c.startPoweredStopValidation(); await h.adv(1500);
    assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
    for (const i of CHECKLIST_ITEMS) if (i.key !== missing.key) h.c.setChecklistItem(i.key, true);
    assert.equal(h.caps().canFinalHold, false, `without ${missing.key} the final hold is not offered`);
    assert.equal(h.c.confirmChecklist(1000).ok, false, `without ${missing.key} the checklist cannot be confirmed`);
    assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
    assert.equal(h.marker.status(), 'absent', 'no marker is written for an incomplete checklist');
    assert.equal(h.c.declareBatteryConnected().ok, false);
  }
  // a short hold is refused
  const h = await makeHarness(); await h.toReadiness();
  h.c.startStopValidation(); await h.adv(3000); h.c.confirmNoRotation(); h.c.finishStopValidation(); h.c.startPoweredStopValidation(); await h.adv(1500);
  for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
  assert.equal(h.c.confirmChecklist(200).ok, false); assert.equal(h.state(), STATE.SAFETY_CHECKLIST);
  pass('powered stop validation is blocked by any missing checklist item and by a short final hold');
}
{
  // 1e. a failed or unverifiable marker write blocks it
  for (const bad of [{ failWrite: true }, { corruptWrite: true }]) {
    const h = await makeHarness({ storage: memoryStorage(bad) }); await h.toReadiness();
    h.c.startStopValidation(); await h.adv(3000); h.c.confirmNoRotation(); h.c.finishStopValidation();
    h.c.startPoweredStopValidation(); await h.adv(1500);
    for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true);
    const r = h.c.confirmChecklist(1000);
    assert.equal(r.ok, false); assert.match(h.c.view().notes.markerError, /marker/);
    assert.equal(h.state(), STATE.SAFETY_CHECKLIST, 'ready to connect power is not reached');
    assert.equal(h.c.declareBatteryConnected().ok, false);
  }
  const blocked = await makeHarness({ storage: null }); await blocked.toReadiness();
  blocked.c.startStopValidation(); await blocked.adv(3000); blocked.c.confirmNoRotation(); blocked.c.finishStopValidation();
  assert.equal(blocked.c.startPoweredStopValidation().ok, false, 'blocked storage refuses the powered flow at the start');
  pass('a failed, unverifiable or unavailable recovery marker blocks powered stop validation');
}
{
  // 1f. the full powered flow: marker set before power, battery tracked, only external 1000, four-part proof, marker kept until recovery
  const h = await makeHarness(); await toPoweredValidation(h);
  assert.equal(h.state(), STATE.POWERED_STOP_VALIDATION);
  assert.equal(h.marker.status(), 'present', 'marker written before the battery was declared');
  assert.equal(h.caps().batteryState, 'declared-connected');
  assert.equal(h.caps().flow, 'powered-stopval');
  assert.equal(h.caps().maxOutput, 1000, 'permission ceiling is exactly 1000');
  assert.equal(h.caps().canStart, false);
  await h.adv(1500);
  assert.ok(h.caps().proof.attempts >= BENCH_TIMINGS.stopMinAttempts, 'repeated external 1000');
  assert.equal(h.caps().proof.readbackOk, true, 'FC read-back');
  assert.equal(h.caps().proof.zeroOk, true, 'valid zero RPM');
  assert.equal(h.c.finishPoweredStopValidation().ok, false, 'the user no-rotation confirmation is required');
  assert.equal(h.caps().canConfirmNoRotation, true);
  h.c.confirmNoRotation();
  assert.equal(h.caps().canFinishPoweredStopValidation, true);
  assert.equal(h.c.finishPoweredStopValidation().ok, true);
  assert.equal(h.state(), STATE.BENCH_COMPLETE);
  assert.equal(h.caps().poweredStopValidated, true);
  assert.equal(h.marker.status(), 'present', 'the marker is kept until the battery is confirmed disconnected');
  assert.equal(h.caps().canReset, false);
  assert.ok(h.fc.received.length >= 10 && STOP_CODE(h.fc.received), 'only external 1000 was ever sent');
  assert.equal(h.m.ctx.flow, 'powered-stopval');
  h.c.confirmBatteryRemoved();
  assert.equal(h.marker.status(), 'absent'); assert.equal(h.caps().canReset, true);
  assert.equal(h.caps().batteryState, 'removed-confirmed');
  pass('powered stop validation: marker before power, battery declared, repeated 1000, read-back, zero RPM, no-rotation confirmation; marker kept until battery removal; only 1000 sent');
}
{
  // 1g. the state can never reach MOTOR_READY or send a nonzero value; the ceiling is exactly 1000 in both validation states
  const h = await makeHarness(); await toPoweredValidation(h);
  const perm = (v, k = 'output') => h.m.motorCommandPermission({ kind: k, motor: 0, value: v });
  for (const v of [1001, 1020, 1050, 1100, 1101, 2000]) assert.equal(perm(v).ok, false, `${v} refused in powered validation`);
  assert.equal(perm(1000).ok, true); assert.equal(perm(1000).maxValue, 1000);
  assert.equal(h.m.motorCommandPermission({ kind: 'stop' }).maxValue, 1000);
  const t = h.t; const boundary = new MotorBoundary({ transport: t, clock: h.clock, authorize: (req) => h.m.motorCommandPermission(req) });
  for (const v of [1020, 1050, 1100]) assert.throws(() => boundary.sendOutput(0, v), MotorCommandRefused, `the boundary refuses ${v} here`);
  assert.throws(() => boundary.sendOutput(0, 1100), /not permitted|permit/);
  assert.equal(h.m.dispatch('START_HOLD_COMPLETE', { holdMs: 5000, now: h.clock.now() }).ok, false);
  assert.equal(h.m.dispatch('ZERO_VERIFIED', { now: h.clock.now() }).ok, false);
  assert.notEqual(h.state(), STATE.MOTOR_READY); assert.notEqual(h.state(), STATE.RUNNING);
  for (const k of ['SELECT_MOTOR', 'CONFIRM_TARGET', 'FINISH_BENCH']) assert.equal(h.m._tableForTests[STATE.POWERED_STOP_VALIDATION][k], undefined, `${k} does not exist in powered validation`);
  assert.ok(STOP_CODE(h.fc.received), 'no nonzero frame reached the synthetic FC');
  // USB-only state: same ceiling
  const u = await makeHarness(); await u.toReadiness(); u.c.startStopValidation();
  assert.equal(u.caps().maxOutput, 1000);
  for (const v of [1001, 1020, 1100]) assert.equal(u.m.motorCommandPermission({ kind: 'output', motor: 0, value: v }).ok, false);
  assert.equal(u.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1000 }).maxValue, 1000);
  // a nonzero value cannot even be built outside 1000..1100, and parseMotorFrame sees only stop in everything sent
  assert.throws(() => buildMotorFrame([1101, 1000, 1000, 1000, 1000, 1000, 1000, 1000]), MotorCommandRefused);
  assert.ok(u.fc.received.every(allStop));
  void parseMotorFrame;
  pass('the permission ceiling is exactly 1000 in USB-only and powered validation; no nonzero value can be constructed or sent; MOTOR_READY is unreachable');
}
{
  // 1h. reload during powered validation enters unclean-exit recovery (the marker was set before power)
  const h = await makeHarness(); await toPoweredValidation(h);
  const reloaded = createBenchController({ clock: h.clock, marker: h.marker });
  assert.equal(reloaded.machine.state, STATE.UNCLEAN_EXIT_RECOVERY);
  const v = reloaded.view().caps;
  assert.equal(v.showBatteryInstruction, true); assert.equal(v.maxOutput, 1000, 'at most the stop value'); assert.equal(v.batteryState, 'unknown');
  assert.equal(reloaded.machine.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  // a crash during the powered ESC wait (battery declared, not yet verified) too
  const g = await makeHarness(); await g.toReadiness(); g.c.startStopValidation(); await g.adv(3000); g.c.confirmNoRotation(); g.c.finishStopValidation();
  g.c.startPoweredStopValidation(); await g.adv(1500); for (const i of CHECKLIST_ITEMS) g.c.setChecklistItem(i.key, true); g.c.confirmChecklist(1000); g.c.declareBatteryConnected();
  assert.equal(createBenchController({ clock: g.clock, marker: g.marker }).machine.state, STATE.UNCLEAN_EXIT_RECOVERY);
  pass('a reload or crash after the marker is set enters unclean-exit recovery (during the ESC wait and during powered stop validation)');
}
{
  // 1i. visibility loss, USB loss, stale telemetry, rotation and arming in the powered validation lead with the battery instruction
  const scenarios = {
    'visibility loss': async (h) => { h.c.notifyVisibilityLoss('hidden'); },
    'USB loss': async (h) => { await h.t.disconnect(); },
    'stale telemetry': async (h) => { h.fc.inject.telemetrySilent = true; await h.adv(600); },
    'rotation': async (h) => { h.fc.inject.extraRpm = { index: 2, rpm: 500 }; await h.adv(300); },
    'armed': async (h) => { h.fc.inject.armed = true; await h.adv(700); },
  };
  for (const [name, act] of Object.entries(scenarios)) {
    const h = await makeHarness(); await toPoweredValidation(h);
    assert.equal(h.state(), STATE.POWERED_STOP_VALIDATION, name);
    await act(h);
    assert.equal(h.state(), STATE.LOCKED_FAULT, `${name}: locked`);
    assert.equal(h.caps().showBatteryInstruction, true, `${name}: leads with ${BATTERY_INSTRUCTION}`);
    assert.equal(h.marker.status(), 'present', `${name}: the marker stays`);
    assert.equal(h.caps().proof.userNoRotation, false);
  }
  // a read-back that disagrees with the commanded 1000, injected once the battery is declared, ends in a lock as well
  const rb = await makeHarness(); await rb.toReadiness(); rb.c.startStopValidation(); await rb.adv(3000); rb.c.confirmNoRotation(); rb.c.finishStopValidation();
  rb.c.startPoweredStopValidation(); await rb.adv(1500); for (const i of CHECKLIST_ITEMS) rb.c.setChecklistItem(i.key, true); rb.c.confirmChecklist(1000);
  rb.c.declareBatteryConnected(); rb.fc.inject.stuckReadback = [1100, 1000, 1000, 1000]; await rb.adv(20000);
  assert.equal(rb.state(), STATE.LOCKED_FAULT); assert.equal(rb.caps().showBatteryInstruction, true);
  // a hidden page before power is not a fault; after power it is
  const pre = await makeHarness(); await pre.toReadiness(); pre.c.startStopValidation(); await pre.adv(3000); pre.c.confirmNoRotation(); pre.c.finishStopValidation();
  pre.c.startPoweredStopValidation(); await pre.adv(1500); for (const i of CHECKLIST_ITEMS) pre.c.setChecklistItem(i.key, true);
  pre.c.notifyVisibilityLoss('hidden');
  assert.equal(pre.state(), STATE.SAFETY_CHECKLIST); assert.equal(pre.m.ctx.checklist.finalHold, false);
  pass('visibility loss, USB loss, stale telemetry, rotation, arming and a stuck read-back lock the powered validation and lead with the battery instruction; the marker stays');
}
{
  // 1j. the 15 s USB-reset grace flow works in the powered validation workflow
  const h = await makeHarness(); await h.toReadiness(); h.c.startStopValidation(); await h.adv(3000); h.c.confirmNoRotation(); h.c.finishStopValidation();
  h.c.startPoweredStopValidation(); await h.adv(1500); for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true); h.c.confirmChecklist(1000);
  h.c.declareBatteryConnected(); await h.adv(100); await h.t.disconnect();
  assert.equal(h.state(), STATE.POWER_CONNECT_RECONNECT);
  assert.equal(h.caps().batteryState, 'declared-connected');
  const t2 = benchFcTransport(); await h.adv(2000); await h.c.connect(t2); await h.adv(7000); await h.adv(3500);
  assert.equal(h.state(), STATE.POWERED_STOP_VALIDATION, 'after the reconnect the powered-zero window leads to powered stop validation, never to MOTOR_READY');
  assert.ok(t2.fc.received.length > 0 && STOP_CODE(t2.fc.received));
  await h.adv(1500); h.c.confirmNoRotation(); assert.equal(h.c.finishPoweredStopValidation().ok, true);
  // an expired grace locks
  const g = await makeHarness(); await g.toReadiness(); g.c.startStopValidation(); await g.adv(3000); g.c.confirmNoRotation(); g.c.finishStopValidation();
  g.c.startPoweredStopValidation(); await g.adv(1500); for (const i of CHECKLIST_ITEMS) g.c.setChecklistItem(i.key, true); g.c.confirmChecklist(1000);
  g.c.declareBatteryConnected(); await g.adv(100); await g.t.disconnect(); await g.adv(16000);
  assert.equal(g.state(), STATE.LOCKED_FAULT); assert.equal(g.caps().showBatteryInstruction, true);
  pass('the 15-second USB-reset reconnect flow works in the powered stop validation; an expired grace locks');
}
{
  // 1k. the powered validation flow cannot be turned into the bench flow (and back)
  const h = await makeHarness(); await toPoweredValidation(h);
  h.m.ctx.flow = 'bench'; // even a corrupted flow flag: nonzero still needs RUNNING, which this state cannot reach
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  const b = await makeHarness(); await b.toMotorReady();
  b.m.ctx.flow = 'powered-stopval';
  assert.equal(b.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false, 'nonzero needs the bench flow');
  pass('nonzero output needs the bench flow as well as RUNNING');
}

// ======================================================================================================
// FINDING 2: marker deletion is a verified state transition
// ======================================================================================================
async function benchComplete(h) { // normal completion up to the proof; the battery-removal confirmation is the caller's
  await h.toMotorReady(); h.c.finishBench(); await h.adv(3000); h.c.confirmNoRotation(); h.c.completeFinish();
  assert.equal(h.state(), STATE.BENCH_COMPLETE);
}
async function recoveryAfterFault(h) { // a fault, then recovery up to the point where the app may complete recovery
  await h.toMotorReady(); h.c.stopAndZero(); await h.adv(3000); h.c.confirmNoRotation();
  h.c.beginBatteryRemoval(); h.c.confirmBatteryRemoved();
  const t2 = benchFcTransport(); await h.t.disconnect(); await h.c.connect(t2); await h.adv(4000); h.c.confirmNoRotation();
  assert.equal(h.state(), STATE.BATTERY_REMOVAL_RECOVERY); assert.equal(h.caps().canCompleteRecovery, true);
}
for (const [label, storageOpts] of [['removeItem throws', { failRemove: true }], ['the marker stays after removeItem', { ignoreRemove: true }]]) {
  // normal bench completion
  const h = await makeHarness({ storage: memoryStorage(storageOpts) }); await benchComplete(h);
  h.c.confirmBatteryRemoved();
  assert.equal(h.state(), STATE.BENCH_COMPLETE, `${label}: stays in BENCH_COMPLETE`);
  assert.equal(h.m.ctx.markerCleared, false, 'markerCleared is not set before deletion succeeds');
  assert.equal(h.caps().canReset, false, 'Reset is not enabled');
  assert.equal(h.c.reset().ok, false); assert.equal(h.state(), STATE.BENCH_COMPLETE);
  assert.equal(h.marker.status(), 'present');
  assert.equal(h.caps().markerClearFailed, true); assert.equal(h.caps().locked, true);
  assert.match(h.c.view().notes.markerError, /battery disconnected/); assert.match(h.c.view().notes.markerError, /cannot resume/);
  assert.equal(h.caps().canRetryMarkerClear, true);
  assert.equal(h.c.confirmBatteryRemoved().ok, false, 'the confirmation cannot be re-sent');
  assert.equal(h.c.retryMarkerClear().ok, true); assert.equal(h.caps().canReset, false, 'a second failure also stays locked');
  // the storage heals: the deliberate retry now succeeds and only then Reset is possible
  if (storageOpts.failRemove) { h.storage.removeItem = (k) => h.storage._map.delete(k); } else { h.storage.removeItem = (k) => h.storage._map.delete(k); }
  assert.equal(h.c.retryMarkerClear().ok, true);
  assert.equal(h.marker.status(), 'absent'); assert.equal(h.caps().canReset, true); assert.equal(h.caps().markerClearFailed, false);
  assert.equal(h.c.view().notes.markerError, '');
  assert.equal(h.c.reset().ok, true); assert.equal(h.state(), STATE.DISCONNECTED);

  // fault and unclean-exit recovery
  const f = await makeHarness({ storage: memoryStorage(storageOpts) }); await recoveryAfterFault(f);
  f.c.completeRecovery();
  assert.equal(f.state(), STATE.BATTERY_REMOVAL_RECOVERY, `${label}: recovery stays locked, never DISCONNECTED`);
  assert.equal(f.caps().showBatteryInstruction, true); assert.equal(f.caps().locked, true);
  assert.equal(f.caps().canConnect, false, 'no ordinary navigation (connect) from the locked recovery');
  assert.equal(f.marker.status(), 'present'); assert.equal(f.caps().markerClearFailed, true);
  assert.match(f.c.view().notes.markerError, /cannot resume/);
  assert.equal(f.c.reset().ok, false); assert.equal(f.c.completeRecovery().ok, false, 'completing again is refused; retry is the explicit action');
  assert.equal(f.caps().canRetryMarkerClear, true);
  f.storage.removeItem = (k) => f.storage._map.delete(k);
  assert.equal(f.c.retryMarkerClear().ok, true);
  assert.equal(f.state(), STATE.DISCONNECTED); assert.equal(f.marker.status(), 'absent');
}
pass('a failed marker deletion (removeItem throws, or the marker is still readable) keeps BENCH_COMPLETE and BATTERY_REMOVAL_RECOVERY locked, blocks Reset and navigation, shows the message, and a deliberate retry succeeds only when the marker is really gone');
{
  // the machine itself: nothing is cleared by the request, only by the result
  const m = createMachine({ markerPresent: false });
  m.dispatch('CONNECT', { transportKind: 'mock', now: 1 });
  assert.equal(m.dispatch('MARKER_CLEAR_RESULT', { ok: true, now: 2 }).ok, false, 'a result nobody asked for is refused');
  // unclean exit path: reload, recover, clear
  const h = await makeHarness(); await h.toReadyToPower();
  const r = createBenchController({ clock: h.clock, marker: h.marker });
  r.machine.dispatch('BATTERY_REMOVED_CONFIRMED', { now: 1 });
  await r.connect(benchFcTransport()); await h.clock.advance(4000); r.confirmNoRotation();
  assert.equal(r.view().caps.canCompleteRecovery, true);
  r.completeRecovery();
  assert.equal(r.machine.state, STATE.DISCONNECTED); assert.equal(h.marker.status(), 'absent');
  // result events: a result is trusted only when ok === true
  const k = await makeHarness(); await benchComplete(k); k.c.confirmBatteryRemoved();
  assert.equal(k.m.dispatch('MARKER_CLEAR_RESULT', { ok: true, now: 5 }).ok, false, 'no deletion pending after the result');
  pass('MARKER_CLEAR_RESULT is accepted only while a deletion is pending; unclean-exit recovery clears the marker and only then reaches DISCONNECTED');
}

// ======================================================================================================
// FINDING 3: DShot error statistics: fail closed for real nonzero testing
// ======================================================================================================
const unavailable = [10000, 10000, 10000, 10000];
{
  // classification: sentinel is unavailable (not a 100 % failure), malformed is unavailable, threshold is centralized
  assert.equal(dshotStatus([0, 0, 0, 0]), 'usable');
  assert.equal(dshotStatus(unavailable), 'unavailable');
  assert.equal(dshotStatus([0, 0, 0, 10000]), 'unavailable', 'one motor without statistics is enough');
  assert.equal(dshotStatus(null), 'unavailable'); assert.equal(dshotStatus([0, 0, 0]), 'unavailable'); assert.equal(dshotStatus([0, 0, 0, NaN]), 'unavailable');
  assert.equal(dshotStatus([0, 0, 0, -1]), 'unavailable'); assert.equal(dshotStatus([0, 0, 0, 10001]), 'unavailable'); assert.equal(dshotStatus([0, 0, 0, undefined]), 'unavailable');
  const t = DSHOT_STATS.excessiveErrors_centi;
  assert.equal(dshotStatus([0, 0, 0, t - 1]), 'usable'); assert.equal(dshotStatus([0, 0, 0, t]), 'excessive'); assert.equal(dshotStatus([t, t, t, t]), 'excessive');
  assert.equal(dshotStatus([t, 0, 0, 10000]), 'unavailable', 'unavailable wins over excessive');
  assert.ok(Object.isFrozen(DSHOT_STATS) && DSHOT_STATS.unavailableSentinel_centi === 10000);
  pass('DShot statistics are classified in one place: the sentinel is unavailable (not 100 % errors), malformed values fail closed, the error threshold is one provisional constant');
}
{
  // unavailable while USB-only does not block stop validation (and a build without statistics still passes it)
  const h = await makeHarness({ fc: { inject: { invalidPct_centi: unavailable } } }); await h.toReadiness();
  assert.equal(h.caps().canStopValidation, true);
  assert.equal(h.c.startStopValidation().ok, true);
  await h.adv(3000); h.c.confirmNoRotation();
  assert.equal(h.c.finishStopValidation().ok, true, 'USB-only validation completes without statistics');
  assert.equal(h.caps().usbStopValidated, true);
  assert.equal(h.caps().dshot.status, 'unknown', 'statistics are not even evaluated while the ESCs are unpowered');
  assert.equal(h.c.startPoweredStopValidation().ok, true, 'and the powered stop validation may start');
  await h.adv(1500); for (const i of CHECKLIST_ITEMS) h.c.setChecklistItem(i.key, true); h.c.confirmChecklist(1000); h.c.declareBatteryConnected(); await h.adv(5100); await h.adv(3500);
  assert.equal(h.state(), STATE.POWERED_STOP_VALIDATION, 'unavailable statistics do not block the powered stop validation either');
  assert.equal(h.caps().dshot.status, 'unavailable');
  await h.adv(1500); h.c.confirmNoRotation(); assert.equal(h.c.finishPoweredStopValidation().ok, true);
  pass('unavailable DShot statistics do not block USB-only or powered external-1000 stop validation; the powered state records "unavailable"');
}
{
  // unavailable after ESC power blocks nonzero, with an explanation; this is not a fault and not a verdict
  const h = await makeHarness({ fc: { inject: { invalidPct_centi: unavailable } } }); await h.toMotorReady();
  assert.equal(h.state(), STATE.MOTOR_READY, 'powered-zero verification itself is not blocked');
  assert.equal(h.caps().dshot.status, 'unavailable');
  h.c.selectMotor(0); h.c.confirmTarget(0); await h.adv(100);
  const il = h.caps().interlocks.find((i) => i.id === 'dshot-stats');
  assert.equal(il.ok, false); assert.match(il.why, /unavailable with the ESCs powered/); assert.match(il.why, /not a motor-health result/);
  assert.equal(h.caps().canStart, false);
  const r = h.c.startMotor(1000);
  assert.equal(r.ok, false); assert.match(r.reason, /dshot-stats/);
  assert.equal(h.state(), STATE.MOTOR_READY, 'a refused start is not a fault');
  assert.ok(h.fc.received.every(allStop), 'nothing nonzero was sent');
  // whichever motor lacks statistics
  const g = await makeHarness({ fc: { inject: { invalidPct_centi: [0, 0, 0, 10000] } } }); await g.toMotorReady(); g.c.selectMotor(0); g.c.confirmTarget(0); await g.adv(100);
  assert.equal(g.c.startMotor(1000).ok, false);
  pass('statistics still unavailable after the ESCs are powered keep nonzero testing blocked (explained, not a fault, nothing sent)');
}
{
  // valid low-error statistics permit the next interlock (and need a full usable period)
  const h = await makeHarness({ fc: { inject: { invalidPct_centi: [5, 0, 10, 99] } } }); await h.toMotorReady();
  h.c.selectMotor(0); h.c.confirmTarget(0); await h.adv(100);
  assert.equal(h.caps().dshot.status, 'usable');
  const il = h.caps().interlocks.find((i) => i.id === 'dshot-stats');
  assert.equal(il.ok, true);
  assert.equal(h.caps().canStart, true);
  // a fresh window is required after any non-usable reading (since resets)
  const g = await makeHarness(); await g.toMotorReady(); g.c.selectMotor(0); g.c.confirmTarget(0);
  g.fc.inject.invalidPct_centi = unavailable; await g.adv(200);
  assert.equal(g.caps().interlocks.find((i) => i.id === 'dshot-stats').ok, false);
  g.fc.inject.invalidPct_centi = null; await g.adv(300);
  assert.equal(g.caps().interlocks.find((i) => i.id === 'dshot-stats').ok, false, 'usable again, but not for long enough yet');
  await g.adv(DSHOT_STATS.usableForMs + 200);
  assert.equal(g.caps().interlocks.find((i) => i.id === 'dshot-stats').ok, true);
  // pure interlock: no statistics in the context is a failed check (fail closed)
  const bare = startInterlocks({ ...g.m.ctx, dshot: undefined }, g.m.ctx.facts, g.clock.now()).find((i) => i.id === 'dshot-stats');
  assert.equal(bare.ok, false);
  pass('valid low-error statistics pass the interlock after a full usable period; a gap restarts it; missing data fails closed');
}
{
  // excessive errors: block at start and abort during a run, with the one centralized provisional threshold
  const hi = DSHOT_STATS.excessiveErrors_centi;
  const h = await makeHarness({ fc: { inject: { invalidPct_centi: [0, hi, 0, 0] } } }); await h.toMotorReady();
  h.c.selectMotor(0); h.c.confirmTarget(0); await h.adv(100);
  assert.equal(h.caps().dshot.status, 'excessive');
  assert.equal(h.caps().canStart, false); assert.match(h.caps().interlocks.find((i) => i.id === 'dshot-stats').why, /provisional limit/);
  assert.equal(h.c.startMotor(1000).ok, false);
  // during a run
  const r = await makeHarness(); await r.toMotorReady(); await r.startMotor(0);
  assert.equal(r.state(), STATE.RUNNING); await r.adv(300);
  r.fc.inject.invalidPct_centi = [hi, 0, 0, 0]; await r.adv(200);
  assert.equal(r.state(), STATE.LOCKED_FAULT); assert.equal(r.faultReason(), 'dshot-errors-excessive');
  assert.equal(r.caps().showBatteryInstruction, true);
  assert.equal(r.fc.motors.slice(0, 4).every((v) => v === 1000), true, 'the abort returned every output to 1000');
  pass('excessive DShot errors block the start and abort a run to the stop path at the centralized provisional threshold');
}
{
  // statistics become unavailable during a sweep: fail-closed stop; stale statistics (telemetry) also abort
  const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(1);
  assert.equal(h.state(), STATE.RUNNING); await h.adv(300);
  h.fc.inject.invalidPct_centi = unavailable; await h.adv(200);
  assert.equal(h.state(), STATE.LOCKED_FAULT); assert.equal(h.faultReason(), 'dshot-statistics-unavailable');
  assert.equal(h.caps().showBatteryInstruction, true);
  assert.ok(h.fc.motors.slice(0, 4).every((v) => v === 1000));
  const s = await makeHarness(); await s.toMotorReady(); await s.startMotor(0); await s.adv(300);
  s.fc.inject.telemetrySilent = true; await s.adv(600);
  assert.equal(s.state(), STATE.LOCKED_FAULT); assert.equal(s.faultReason(), 'telemetry-stale-or-unavailable');
  pass('statistics becoming unavailable (or stale) during a sweep locks the session and returns every output to 1000');
}
{
  // a firmware build without statistics can never silently pass: every path to RUNNING needs the interlock
  const h = await makeHarness({ fc: { inject: { invalidPct_centi: unavailable } } }); await h.toMotorReady();
  h.c.selectMotor(2); h.c.confirmTarget(2); await h.adv(5000);
  assert.equal(h.c.startMotor(1000).ok, false);
  assert.equal(h.m.dispatch('START_HOLD_COMPLETE', { holdMs: 5000, now: h.clock.now() }).ok, false);
  assert.notEqual(h.state(), STATE.RUNNING);
  assert.ok(h.fc.received.every(allStop));
  // a tampered context cannot skip it either: the interlock list always contains it
  assert.ok(startInterlocks(h.m.ctx, h.m.ctx.facts, h.clock.now()).some((i) => i.id === 'dshot-stats' && !i.ok));
  pass('a build without DShot statistics never reaches RUNNING, however long it waits');
}

// ======================================================================================================
// FINDING 4: stop-validation evidence is bound to every real allowlist entry
// ======================================================================================================
{
  const id = { variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'SYNTH', boardId: 'SYN1', escFamily: 'Bluejay', escModel: 'synthetic', motorProtocol: 'DSHOT600' };
  assert.equal(OWNER_APPROVED.length, 1, 'OWNER_APPROVED holds the one reviewed entry');
  assert.deepEqual([...EVIDENCE_FIELDS], ['stopValidatedOn', 'stopValidatedBy', 'stopValidationTraceSha256', 'externalStopValue', 'poweredStopValidated']);
  assert.ok(![...REQUIRED_FIELDS, ...EVIDENCE_FIELDS].some((f) => /uid/i.test(f)), 'no raw flight-controller UID field');
  assert.equal(validateEntry(REAL_ENTRY), null, 'the fully formed fixture is valid');
  assert.ok(matchAllowlist(id, 'web-serial', [REAL_ENTRY]).entry, 'the fully formed fixture matches the exact identity');

  // identity-only real entries no longer match
  const identityOnly = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, REAL_ENTRY[f]]));
  assert.notEqual(validateEntry(identityOnly), null);
  assert.equal(matchAllowlist(id, 'web-serial', [identityOnly]).entry, null, 'an identity-only real entry never matches');
  for (const f of EVIDENCE_FIELDS) {
    const e = { ...REAL_ENTRY }; delete e[f];
    assert.equal(matchAllowlist(id, 'web-serial', [e]).entry, null, `a real entry without ${f} never matches`);
    assert.equal(matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, [f]: null }]).entry, null);
    assert.equal(matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, [f]: '' }]).entry, null);
  }
  // malformed dates, digest, stop value, flag
  const bad = (over) => matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, ...over }]).entry;
  for (const d of ['2026-13-01', '2026-02-30', '2026-1-5', '20261201', 'yesterday', '2026-12-01T00:00:00Z', 20261201, true]) {
    assert.equal(bad({ stopValidatedOn: d }), null, `stopValidatedOn ${String(d)} fails closed`);
    assert.equal(bad({ approvedOn: d }), null, `approvedOn ${String(d)} fails closed`);
  }
  assert.equal(bad({ stopValidatedOn: '2026-12-03' }), null, 'evidence reviewed after the approval date fails closed');
  assert.ok(bad({ stopValidatedOn: '2026-12-02' }), 'the same day is fine');
  for (const h of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ' ' + 'a'.repeat(63), 'sha256:' + 'a'.repeat(64), 123, true]) assert.equal(bad({ stopValidationTraceSha256: h }), null, `digest ${String(h).slice(0, 12)} fails closed`);
  for (const v of [0, 1, 1020, 1100, 999, 1001, '1000', NaN, 1000.5, true]) assert.equal(bad({ externalStopValue: v }), null, `externalStopValue ${String(v)} fails closed`);
  assert.equal(bad({ externalStopValue: MOTOR.stopValue }) !== null, true);
  for (const v of [false, 'true', 1, 0, undefined, null]) assert.equal(bad({ poweredStopValidated: v }), null, `poweredStopValidated ${String(v)} fails closed`);
  assert.equal(bad({ stopValidatedBy: '   ' }), null);
  assert.equal(bad({ synthetic: 'true' }), null, 'a truthy-but-not-true synthetic flag on a real entry is malformed');
  assert.ok(isCalendarDate('2026-02-28') && !isCalendarDate('2026-02-29') && isCalendarDate('2028-02-29'));
  pass('allowlist evidence: identity-only real entries, missing or malformed evidence, dates, digest, stop value and flag all fail closed; the fixture matches the exact identity; no raw UID field');

  // synthetic entries never authorize a real transport and never satisfy the evidence requirement
  assert.ok(matchAllowlist(id, 'mock', SYNTHETIC_ALLOWLIST).entry);
  assert.equal(matchAllowlist(id, 'web-serial', SYNTHETIC_ALLOWLIST).entry, null);
  assert.ok(SYNTHETIC_ALLOWLIST.every((e) => e.synthetic === true && EVIDENCE_FIELDS.every((f) => !(f in e))), 'synthetic entries carry no evidence');
  assert.equal(matchAllowlist(id, 'web-serial', [{ ...SYNTHETIC_ALLOWLIST[0], ...Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, REAL_ENTRY[f]])) }]).entry, null, 'a synthetic entry with copied evidence still never authorizes a real transport');
  assert.equal(matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, synthetic: true }]).entry, null);
  assert.equal(matchAllowlist(id, 'mock', [REAL_ENTRY]).entry, null, 'a real entry never authorizes the mock');
  const e2 = { ...REAL_ENTRY, synthetic: false }; assert.equal(validateEntry(e2), null); assert.ok(matchAllowlist(id, 'web-serial', [e2]).entry);
  pass('a synthetic entry never authorizes a real transport and cannot satisfy the evidence requirement');

  // changing any identity field prevents a match
  for (const f of ['variant', 'firmware', 'api', 'targetName', 'boardId', 'escFamily', 'escModel', 'motorProtocol']) {
    assert.equal(matchAllowlist({ ...id, [f]: id[f] + 'x' }, 'web-serial', [REAL_ENTRY]).entry, null, `a different ${f} does not match`);
    assert.equal(matchAllowlist({ ...id, [f]: '' }, 'web-serial', [REAL_ENTRY]).entry, null);
  }
  // the evidence fields are not part of the identity: they cannot be supplied by the aircraft
  assert.ok(matchAllowlist({ ...id, stopValidationTraceSha256: 'b'.repeat(64) }, 'web-serial', [REAL_ENTRY]).entry, 'identity matching ignores evidence fields; they only gate the entry');
  // a malformed entry before a good one does not hide the good one, and a good entry does not rescue a bad one
  assert.ok(matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, externalStopValue: 0 }, REAL_ENTRY]).entry);
  assert.equal(matchAllowlist(id, 'web-serial', [{ ...REAL_ENTRY, externalStopValue: 0 }]).entry, null);
  pass('changing any identity field prevents a match; a bad entry is skipped');
}
{
  // end to end through the controller: a real transport with an identity-only entry cannot proceed; with evidence it can (after the unlock)
  const identityOnly = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, REAL_ENTRY[f]]));
  const a = await makeHarness({ allowlist: [identityOnly] }); a.t.kind = 'web-serial'; await a.toReadiness(); a.c.unlock('UNLOCK BENCH TEST', true);
  assert.equal(a.caps().policy.nonzeroOk, false); assert.equal(a.c.proceed().ok, false);
  assert.match(a.caps().policy.comboReason, /evidence/);
  const b = await makeHarness({ allowlist: [REAL_ENTRY] }); b.t.kind = 'web-serial'; await b.toReadiness(); b.c.unlock('UNLOCK BENCH TEST', true);
  assert.equal(b.caps().policy.nonzeroOk, true);
  pass('through the controller: an identity-only real entry blocks the nonzero path; an entry with reviewed evidence enables it after the unlock');
}

// the marker key is unchanged (storage protocol note: the marker is written before power and removed only when confirmed absent)
assert.equal(RECOVERY_KEY, 'uavzones.benchtest.unclean.v1');
void FakeClock; void createMarkerStore;
console.log('ALL OK');
