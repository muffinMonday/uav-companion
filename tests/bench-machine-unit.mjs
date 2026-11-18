// Phase 3 bench test: the authoritative state machine. Pure machine tests plus a transition-coverage check against the
// harness scenarios. Synthetic and mocked only. See docs/MOTOR_DIAGNOSTICS_FAULT_INJECTION_MATRIX.md for the hazard map.
import assert from 'node:assert/strict';
import { ALL_STATES, STATE, createMachine } from '../src/benchtest/state-machine.js';
import { MOTOR } from '../src/benchtest/constants.js';
import { startInterlocks } from '../src/benchtest/interlocks.js';
import { CHECKLIST_ITEMS, EXPECTED_POSITIONS, makeHarness, memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const seen = new Set(); // "FROM|EVENT|TO" of every accepted transition observed in any scenario
const harnesses = [];
const mk = async (o) => { const h = await makeHarness(o); harnesses.push(h); return h; };
const collect = () => { for (const h of harnesses) for (const e of h.m.trace) if (e.ok) seen.add(`${e.from}|${e.event}|${e.to}`); };

// ---------- 1. every permitted transition (coverage of the machine's own table by driven scenarios)
{
  const A = await mk(); await A.toMotorReady(); await A.startMotor(0); await A.adv(30000); await A.finishStopProof(EXPECTED_POSITIONS[0]);
  A.c.finishBench(); await A.adv(3000); A.c.confirmNoRotation(); A.c.completeFinish(); A.c.confirmBatteryRemoved(); A.c.reset(); // BENCH_COMPLETE -> DISCONNECTED
  const B = await mk(); await B.toReadiness(); B.c.lock(); B.c.reset(); // lock then reset
  const B2 = await mk(); await B2.toReadiness(); B2.t.disconnect(); // read-only readiness lost
  const C = await mk({ }); await C.toReadiness(); C.c.startStopValidation(); await C.adv(3000); C.c.confirmNoRotation(); C.c.finishStopValidation();
  C.c.startStopValidation(); C.c.leaveStopValidation(); C.c.startStopValidation(); await C.t.disconnect();
  // unlock path needs the real transport kind: simulated by changing the kind field of the synthetic transport
  const D = await mk(); D.t.kind = 'web-serial'; await D.toReadiness(); D.c.unlock('UNLOCK BENCH TEST', true); D.c.lock();
  const E = await mk(); await E.toSafeState(); await E.t.disconnect();                          // SAFE_STATE_INIT lost
  const E2 = await mk(); await E2.toReadiness(); E2.c.proceed(); await E2.t.disconnect();           // right after proceed
  const F = await mk(); await F.toChecklist(); F.c.setChecklistItem('propsRemoved', true); F.c.notifyVisibilityLoss(); await F.t.disconnect(); // checklist lost
  const G = await mk(); await G.toReadyToPower(); G.c.notifyVisibilityLoss(); // READY -> SAFETY_CHECKLIST
  const H = await mk(); await H.toReadyToPower(); await H.t.disconnect(); // READY, battery not declared: LOCKED_FAULT (guard refuses, generic fault)
  const I = await mk(); await I.toReadyToPower(); I.c.declareBatteryConnected(); await I.adv(100); await I.t.disconnect(); await I.adv(16000); // RECONNECT then GRACE_EXPIRED
  const J = await mk(); await J.toReadyToPower(); J.c.declareBatteryConnected(); await J.adv(100); await J.t.disconnect();
  const t2 = (await import('../src/benchtest/mock-bench-fc.js')).benchFcTransport(); await J.adv(2000); await J.c.connect(t2); await J.adv(1500); t2.disconnect(); // reconnect, then lost again in the grace state
  await J.adv(100);
  const K = await mk(); await K.toReadyToPower(); K.c.declareBatteryConnected(); await K.adv(100); await K.t.disconnect();
  const t3 = (await import('../src/benchtest/mock-bench-fc.js')).benchFcTransport(); await K.adv(2000); await K.c.connect(t3); await K.adv(6500); // ESC_READY after safe state, then zero verification
  const L = await mk(); await L.toMotorReady(); await L.startMotor(0); await L.adv(200); await L.t.disconnect();      // RUNNING lost
  const M = await mk({ fc: { startValue: [9999, 9999, 9999, 9999] } }); await M.toMotorReady(); await M.startMotor(0); await M.adv(30000); // RUN_ABORTED (no start by cap)
  M.c.beginBatteryRemoval(); M.c.confirmBatteryRemoved();                                                          // LOCKED_FAULT -> recovery
  M.c.confirmBatteryRemoved();
  const t4 = (await import('../src/benchtest/mock-bench-fc.js')).benchFcTransport(); await M.t.disconnect(); await M.c.connect(t4); await M.adv(4000); M.c.confirmNoRotation(); M.c.completeRecovery();
  const N = await mk(); await N.toMotorReady(); await N.t.disconnect(); N.c.beginBatteryRemoval(); await N.t.disconnect(); // lost in recovery
  const O0 = await mk(); await O0.toMotorReady(); O0.c.stopAndZero(); await O0.adv(3000); O0.c.confirmNoRotation(); O0.t.disconnect(); // LOCKED_FAULT proof confirmed, then the cable is lost
  const O = await mk(); await O.toMotorReady(); await O.startMotor(0); await O.adv(30000); await O.adv(3000); O.c.confirmNoRotation();
  await O.t.disconnect();                                                                                          // VERIFYING_STOP lost
  const P = await mk(); await P.toMotorReady(); await P.t.disconnect();                                            // fault, then LOCKED_FAULT lost
  await P.adv(10);
  const Q = await mk(); await Q.toMotorReady(); await Q.startMotor(0); await Q.adv(30000); await Q.adv(3000); Q.c.confirmNoRotation(); Q.c.finishBench();
  const R = await mk(); await R.toMotorReady(); R.c.finishBench(); await R.adv(3000); R.c.confirmNoRotation(); R.c.completeFinish(); await R.t.disconnect(); // BENCH_COMPLETE lost
  // unclean recovery path (reload): marker present at construction
  const S1 = await mk(); await S1.toReadyToPower();
  const { createBenchController } = await import('../src/benchtest/controller.js');
  const reloaded = createBenchController({ clock: S1.clock, marker: S1.marker });
  const t5 = (await import('../src/benchtest/mock-bench-fc.js')).benchFcTransport();
  reloaded.machine.dispatch('BATTERY_REMOVED_CONFIRMED', { now: 1 });
  await reloaded.connect(t5); await S1.clock.advance(4000); reloaded.confirmNoRotation();
  harnesses.push({ m: reloaded.machine });
  // powered stop validation flow (review finding 1) and verified marker deletion (finding 2)
  const V = await mk(); await V.toReadiness(); V.c.startStopValidation(); await V.adv(3000); V.c.confirmNoRotation(); V.c.finishStopValidation();
  V.c.startPoweredStopValidation(); await V.adv(1500); for (const i of CHECKLIST_ITEMS) V.c.setChecklistItem(i.key, true); V.c.confirmChecklist(1000);
  V.c.declareBatteryConnected(); await V.adv(5100); await V.adv(3500); await V.adv(1500); V.c.confirmNoRotation(); V.c.finishPoweredStopValidation();
  const W = await mk({ storage: memoryStorage({ failRemove: true }) }); await W.toMotorReady(); W.c.finishBench(); await W.adv(3000); W.c.confirmNoRotation(); W.c.completeFinish();
  W.c.confirmBatteryRemoved(); W.c.retryMarkerClear(); W.storage.removeItem = (k) => W.storage._map.delete(k); W.c.retryMarkerClear(); W.c.reset(); // BENCH_COMPLETE: failed clear, retry fails, retry succeeds
  const X = await mk({ storage: memoryStorage({ failRemove: true }) }); await X.toMotorReady(); X.c.stopAndZero(); await X.adv(3000); X.c.confirmNoRotation(); X.c.beginBatteryRemoval(); X.c.confirmBatteryRemoved();
  const tX = (await import('../src/benchtest/mock-bench-fc.js')).benchFcTransport(); await X.t.disconnect(); await X.c.connect(tX); await X.adv(4000); X.c.confirmNoRotation();
  X.c.completeRecovery(); X.storage.removeItem = (k) => X.storage._map.delete(k); X.c.retryMarkerClear(); // recovery: failed clear keeps the lock, retry succeeds
  // ESC identification (4-way scan): unavailable with MSP restored (warning, acknowledgement, restore), and 4-way exit unproven
  const spin = async (hh, n) => { for (let i = 0; i < n; i++) { await hh.adv(250); await new Promise((r) => setTimeout(r, 8)); } };
  const Y = await mk({ fourway: { channels: [{ kind: 'bluejay' }, { kind: 'silent' }, { kind: 'bluejay' }, { kind: 'bluejay' }] } }); await Y.toZeroVerification(); await spin(Y, 220); Y.c.acknowledgeEscWarning(); await spin(Y, 60);
  const Z = await mk({ fourway: { exit: 'never' } }); await Z.toZeroVerification(); await spin(Z, 200);
  // combined four-motor confirmation: all four individual sweeps, then the combined run and its stop proof
  const KC = await mk(); await KC.toMotorReady();
  for (let m = 0; m < 4; m++) { await KC.adv(5100); await KC.startMotor(m); await KC.adv(9000); await KC.finishStopProof(EXPECTED_POSITIONS[m]); }
  await KC.adv(5100); KC.c.startCombined(1000); await KC.adv(16000); await KC.adv(3500); KC.c.confirmNoRotation(); KC.c.completeCombined();
  collect();
  const table = createMachine()._tableForTests;
  const missing = [];
  for (const [from, events] of Object.entries(table)) {
    for (const [ev, spec] of Object.entries(events)) {
      const tos = spec.to === 'SELF' ? [from] : [spec.to];
      if (!tos.some((to) => seen.has(`${from}|${ev}|${to}`))) missing.push(`${from} ${ev} -> ${tos[0]}`);
    }
  }
  // transitions that need a fault or a window the scenarios above only reach indirectly are listed explicitly; none may be silently missing
  const allowedMissing = new Set(['POWERED_ZERO_VERIFICATION ZERO_VERIFIED -> MOTOR_READY']); // reached through the observation path, traced as ZERO_VERIFIED
  const real = missing.filter((m) => !allowedMissing.has(m));
  assert.deepEqual(real, [], 'transitions never exercised: ' + real.join('; '));
  pass(`every permitted transition in the machine's table was exercised by a scenario (${Object.values(table).reduce((a, e) => a + Object.keys(e).length, 0)} entries)`);
}

// ---------- 2. every invalid transition is rejected and never grants output
{
  const EVENTS = ['CONNECT', 'READINESS_UPDATE', 'UNLOCK', 'LOCK', 'READINESS_OK', 'ENTER_STOP_VALIDATION', 'STOP_VALIDATION_DONE', 'LEAVE_STOP_VALIDATION', 'SAFE_STATE_DONE', 'CHECKLIST_ITEM',
    'FINAL_HOLD_DONE', 'MARKER_RESULT', 'CHECKLIST_COMPLETE', 'BATTERY_DECLARED', 'ESC_READY', 'RECONNECTED', 'GRACE_EXPIRED', 'ZERO_VERIFIED', 'SELECT_MOTOR', 'CONFIRM_TARGET',
    'START_HOLD_COMPLETE', 'FINISH_BENCH', 'RUN_COMPLETE', 'RUN_ABORTED', 'USER_CONFIRMS_NO_ROTATION', 'POSITION_REPORTED', 'FINISH_STOP_DONE', 'BEGIN_BATTERY_REMOVAL',
    'BATTERY_REMOVED_CONFIRMED', 'RECOVERY_COMPLETE', 'RESET', 'ENTER_POWERED_STOP_VALIDATION', 'ZERO_VERIFIED_STOPVAL', 'POWERED_STOP_VALIDATION_DONE', 'MARKER_CLEAR_RESULT', 'RETRY_MARKER_CLEAR', 'FOURWAY_FINISHED', 'FOURWAY_UNPROVEN', 'RESTORE_IDENTITY', 'RESTORE_COMPLETE', 'ESC_ACK', 'NOT_AN_EVENT', 'constructor', '__proto__', 'toString', 'hasOwnProperty', ''];
  const FAULTING = new Set([STATE.STOP_VALIDATION_ONLY, STATE.SAFE_STATE_INIT, STATE.SAFETY_CHECKLIST, STATE.READY_TO_CONNECT_POWER, STATE.POWER_CONNECT_RECONNECT,
    STATE.POWERED_ZERO_VERIFICATION, STATE.ESC_IDENTIFICATION, STATE.POST_SCAN_RESTORE, STATE.POWERED_STOP_VALIDATION, STATE.MOTOR_READY, STATE.RUNNING, STATE.VERIFYING_STOP]);
  const table = createMachine()._tableForTests;
  let checked = 0;
  for (const st of ALL_STATES) {
    for (const ev of EVENTS) {
      if (Object.prototype.hasOwnProperty.call(table[st], ev)) continue;
      if (ev === 'RECONNECTED') continue; // generic: tested in the reconnect scenarios
      const m = createMachine();
      m._corruptStateForTests(st);
      const r = m.dispatch(ev, { now: 5 });
      assert.equal(r.ok, false, `${st} + ${ev} must be rejected`);
      assert.ok(m.state === st || (FAULTING.has(st) && m.state === STATE.LOCKED_FAULT), `${st} + ${ev} ended in ${m.state}`);
      if (FAULTING.has(st)) assert.equal(m.state, STATE.LOCKED_FAULT, `${st} + ${ev} (invalid in a state where a motor could be energised) must fault`);
      assert.equal(m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false, 'no nonzero permission after an invalid event');
      checked++;
    }
  }
  pass(`${checked} invalid (state, event) pairs are rejected; in energised-capable states they lock the session; none grants a nonzero output`);

  // unknown / corrupt state fails closed
  for (const bad of ['NOPE', undefined, null, 42, '__proto__', 'constructor']) {
    const m = createMachine();
    m._corruptStateForTests(bad);
    const r = m.dispatch('START_HOLD_COMPLETE', { now: 1, holdMs: 5000 });
    assert.equal(r.ok, false);
    assert.equal(m.state, STATE.LOCKED_FAULT, `unknown state ${String(bad)} fails closed`);
    assert.equal(m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  }
  const m0 = createMachine(); m0._corruptStateForTests('NOPE');
  assert.equal(m0.motorCommandPermission({ kind: 'stop' }).ok, false, 'an unknown state has no motor path at all');
  pass('an unknown or corrupt state locks the session and grants nothing, not even a stop');
}

// ---------- 3. permission matrix: nonzero only in RUNNING, only the selected motor, never above the cap
{
  for (const st of ALL_STATES) {
    const m = createMachine(); m._corruptStateForTests(st);
    const stop = m.motorCommandPermission({ kind: 'stop' });
    const nz = m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 });
    assert.equal(nz.ok, false, `${st}: no nonzero output without an authorized run`);
    if (st === STATE.DISCONNECTED || st === STATE.READ_ONLY_READINESS || st === STATE.ESC_IDENTIFICATION) assert.equal(stop.ok, false, `${st} has no motor path (in 4-way mode not even a stop can be delivered)`);
    else assert.deepEqual([stop.ok, stop.maxValue], [true, 1000], `${st}: stop only`);
  }
  const h = await mk(); await h.toMotorReady();
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false, 'MOTOR_READY is not RUNNING');
  await h.startMotor(2);
  assert.equal(h.state(), STATE.RUNNING);
  const P = (motor, value) => h.m.motorCommandPermission({ kind: 'output', motor, value });
  assert.equal(P(2, 1050).ok, true);
  assert.equal(P(2, 1100).ok, true);
  assert.equal(P(2, 1101).ok, false, 'above 1100');
  assert.equal(P(2, 2000).ok, false);
  assert.equal(P(2, 1019).ok, false, 'below the start value but above stop');
  assert.equal(P(2, 1050.5).ok, false);
  assert.equal(P(1, 1050).ok, false, 'another motor');
  assert.equal(P(4, 1050).ok, false);
  assert.equal(P(-1, 1050).ok, false);
  assert.equal(P('2', 1050).ok, false);
  assert.equal(P(2, '1050').ok, false);
  assert.equal(P(2, 1000).ok, true, 'external 1000 on any motor is a stop');
  assert.equal(h.m.motorCommandPermission(null).ok, false);
  assert.equal(h.m.motorCommandPermission({ kind: 'bogus' }).ok, false);
  pass('motor permission: nonzero only in RUNNING, only the selected motor, 1020..1100; stop (1000) only elsewhere; nothing in DISCONNECTED or READ_ONLY_READINESS');
}

// ---------- 4. no nonzero output before all interlocks: each missing condition refuses the start
{
  const base = async () => { const h = await mk(); await h.toMotorReady(); h.c.selectMotor(1); h.c.confirmTarget(1); await h.adv(1000); return h; };
  const cases = {
    'allowlist not satisfied': (h) => { h.m.ctx.policy = { ...h.m.ctx.policy, nonzeroOk: false }; },
    'three motors': (h) => { h.m.ctx.motorCount = 3; },
    'safe state not done': (h) => { h.m.ctx.safeStateDone = false; },
    'checklist incomplete': (h) => { h.m.ctx.checklist = { items: {}, finalHold: false }; },
    'final hold missing': (h) => { h.m.ctx.checklist.finalHold = false; },
    'marker unverified': (h) => { h.m.ctx.markerVerified = false; },
    'zero verification missing': (h) => { h.m.ctx.zeroVerified = false; },
    'armed': (h) => { h.m.ctx.facts = { ...h.m.ctx.facts, armed: true }; },
    'arming unknown': (h) => { h.m.ctx.facts = { ...h.m.ctx.facts, armed: null }; },
    'no motor selected': (h) => { h.m.ctx.selectedMotor = null; },
    'target not confirmed': (h) => { h.m.ctx.targetConfirmed = null; },
    'other motor confirmed': (h) => { h.m.ctx.targetConfirmed = 2; },
    'telemetry stale': (h) => { h.m.ctx.facts = { ...h.m.ctx.facts, telemetryAt: h.clock.now() - 1000 }; },
    'telemetry missing': (h) => { h.m.ctx.facts = { ...h.m.ctx.facts, rpm: null }; },
    'a motor already turning': (h) => { h.m.ctx.facts = { ...h.m.ctx.facts, rpm: [0, 5, 0, 0] }; },
    'inter-sweep settle interval': (h) => { h.m.ctx.lastStopProofAt = h.clock.now() - 1000; },
    'transport unavailable': (h) => { h.m.ctx.transportAvailable = false; },
    'locked': (h) => { h.m.ctx.fault = { reason: 'x' }; },
    'DShot statistics unavailable': (h) => { h.m.ctx.dshot = { status: 'unavailable', since: null, lastAt: h.clock.now() }; },
    'DShot errors excessive': (h) => { h.m.ctx.dshot = { status: 'excessive', since: null, lastAt: h.clock.now() }; },
    'DShot statistics not usable for long enough': (h) => { h.m.ctx.dshot = { status: 'usable', since: h.clock.now() - 100, lastAt: h.clock.now() }; },
    'DShot statistics never observed': (h) => { h.m.ctx.dshot = { status: 'unknown', since: null, lastAt: null }; },
    'real mode but locked': (h) => { h.m.ctx.mode = 'real'; h.m.ctx.unlocked = false; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const h = await base();
    const before = h.fc.received.length;
    mutate(h);
    const r = h.m.dispatch('START_HOLD_COMPLETE', { now: h.clock.now(), holdMs: 1000 });
    assert.equal(r.ok, false, `start must be refused: ${name}`);
    assert.equal(h.state(), STATE.MOTOR_READY, `${name}: stays MOTOR_READY (a refused start is not a fault)`);
    assert.ok(h.fc.received.slice(before).every((v) => v.every((x) => x === 1000)), `${name}: no nonzero frame`);
  }
  // hold too short
  const h = await base();
  assert.equal(h.m.dispatch('START_HOLD_COMPLETE', { now: h.clock.now(), holdMs: 500 }).ok, false);
  assert.equal(h.m.dispatch('START_HOLD_COMPLETE', { now: h.clock.now() }).ok, false);
  // and the all-clear case really is clear
  const ok = await base();
  assert.ok(startInterlocks(ok.m.ctx, ok.m.ctx.facts, ok.clock.now()).every((c) => c.ok));
  assert.equal(ok.m.dispatch('START_HOLD_COMPLETE', { now: ok.clock.now(), holdMs: 1000 }).ok, true);
  pass(`${Object.keys(cases).length + 2} single-condition failures each refuse the start without a nonzero frame; the all-clear case starts`);
}

// ---------- 5. UI capabilities come from the machine (the UI has no rules of its own)
{
  const r0 = await mk(); await r0.toReadiness();
  assert.equal(r0.caps().canStart, false);
  assert.equal(r0.caps().stopButton, false, 'no Stop & zero in read-only readiness (nothing can be energised)');
  const h = await mk(); await h.toMotorReady();
  const caps = h.caps();
  assert.equal(caps.stopButton, true);
  assert.equal(caps.maxOutput, 1000);
  h.c.selectMotor(0); h.c.confirmTarget(0);
  assert.equal(h.caps().canStart, true);
  await h.startMotor(0);
  assert.equal(h.caps().maxOutput, MOTOR.cap);
  pass('capabilities (stop button, max output, canStart) are derived from the machine state and interlocks');
}

console.log('ALL OK');
