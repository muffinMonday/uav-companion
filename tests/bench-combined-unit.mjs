// Combined motor confirmation: eligibility, press-and-hold, identical commands to all four motors, the absolute cap, fail-closed aborts,
// full stop proof, result persistence. Synthetic flight controller and deterministic clock only; no hardware.
import assert from 'node:assert/strict';
import { MOTOR, BENCH_TIMINGS } from '../src/benchtest/constants.js';
import { STATE } from '../src/benchtest/state-machine.js';
import { startInterlocks } from '../src/benchtest/interlocks.js';
import { MotorBoundary, MotorCommandRefused, buildMotorFrame, parseMotorFrame } from '../src/benchtest/motor-control.js';
import { COMBINED_ANOMALY_TEXT, combinedEligibility, createCombinedRecorder, sanitizeCombined, summarizeCombined } from '../src/benchtest/combined.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { listRecords } from '../src/aircraft-diag-data.js';
import { EXPECTED_POSITIONS, makeHarness, memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const upTo = async (h, pred, maxMs = 40000, step = 100) => { for (let t = 0; t < maxMs && !pred(); t += step) await h.adv(step); return pred(); };
const raised = (f) => f.slice(0, 4).filter((v) => v !== 1000).length;
const combinedFrames = (h, from) => h.sentMotorFrames().slice(from).filter((f) => raised(f) > 0);

async function fourSweeps(h, n = 4) {
  for (let m = 0; m < n; m++) { await h.adv(5100); const r = await h.startMotor(m); assert.equal(r.ok, true, 'individual sweep starts: ' + r.reason); await h.adv(9000); const q = await h.finishStopProof(EXPECTED_POSITIONS[m]); assert.equal(q.ok, true); }
  await h.adv(5100);
}
const freshHarness = async (o) => { const h = await makeHarness(o); await h.toMotorReady(); return h; };

// ---- 1. locked until all four individual checks are complete; nothing is sent before eligibility
{
  const h = await freshHarness();
  assert.equal(h.c.combinedEligibility().ok, false); assert.equal(h.caps().combined.done, false);
  const before = h.sentMotorFrames().length;
  const r = h.c.startCombined(1000); assert.equal(r.ok, false); assert.equal(h.state(), STATE.MOTOR_READY);
  assert.equal(h.m.motorCommandPermission({ kind: 'output-all', value: 1050 }).ok, false, 'no combined output permission in MOTOR_READY');
  await fourSweeps(h, 3);
  assert.equal(h.c.combinedEligibility().ok, false, 'three of four is not enough'); assert.match(h.c.combinedEligibility().reasons.join(' '), /All four individual/);
  assert.equal(h.c.startCombined(1000).ok, false);
  assert.ok(h.sentMotorFrames().slice(before).every((f) => f.slice(0, 4).filter((v) => v !== 1000).length <= 1), 'only single-motor frames so far: no combined output before eligibility');
  assert.equal(h.sentMotorFrames().filter((f) => raised(f) > 1).length, 0);
  pass('locked until four individual checks are complete; no combined output before eligibility');
}

// ---- 2. a full combined run: hold required, identical commands, cap, stop proof, result and persistence
{
  const store = memoryStorage();
  const h = await freshHarness({ diagStorage: store, fc: { inject: { tempC: 0 } } }); await fourSweeps(h);
  assert.equal(h.c.combinedEligibility().ok, true, 'missing temperature (0 = not reported) does not block');
  assert.equal(h.caps().combined.interlocksOk, true);
  const short = h.c.startCombined(400); assert.equal(short.ok, false, 'a short hold is refused'); assert.match(short.reason, /hold/); assert.equal(h.state(), STATE.MOTOR_READY);
  const from = h.sentMotorFrames().length;
  const ok = h.c.startCombined(1000); assert.equal(ok.ok, true, ok.reason); assert.equal(h.state(), STATE.RUNNING);
  assert.equal(h.caps().combined.active, true); assert.equal(h.caps().selectedMotor, null);
  assert.ok(await upTo(h, () => h.state() === STATE.VERIFYING_STOP), 'the run finished: ' + h.faultReason());
  const cf = combinedFrames(h, from);
  assert.ok(cf.length >= 8, 'a ramp of several steps was sent');
  for (const f of cf) { assert.ok(f.slice(0, 4).every((v) => v === f[0]), 'identical value on all four motors'); assert.ok(f.slice(4).every((v) => v === 1000), 'slots 5 to 8 stay at 1000'); assert.ok(f[0] <= 1100 && f[0] >= 1020); }
  const values = [...new Set(cf.map((f) => f[0]))];
  assert.deepEqual(values, [1020, 1025, 1030, 1035, 1040, 1045, 1050, 1055, 1060], 'the ramp steps by the existing cadence to the highest individual plateau');
  assert.ok(Math.max(...values) <= MOTOR.cap);
  assert.deepEqual(h.sentMotorFrames().at(-1).slice(0, 4), [1000, 1000, 1000, 1000], 'the run ends at external 1000');
  assert.equal(h.caps().purpose, 'combined'); assert.equal(h.caps().needsPosition, false);
  assert.equal(h.c.completeCombined().ok, false, 'the stop proof is required before the combined test can finish');
  await h.adv(3000); assert.equal(h.c.completeCombined().ok, false, 'the user confirmation is part of the stop proof');
  assert.equal(h.c.confirmNoRotation().ok, true); assert.equal(h.caps().combined.canFinishStop, true);
  assert.equal(h.c.completeCombined().ok, true); assert.equal(h.state(), STATE.MOTOR_READY);
  const r = h.c.combinedResult();
  assert.equal(r.status, 'completed'); assert.equal(r.stopProofComplete, true); assert.equal(r.targetCommand, 1060); assert.equal(r.capCommand, 1100);
  assert.equal(r.motors.length, 4); assert.ok(r.motors.every((m) => m.medianRpm === 2400 && m.maxTempC === null), 'median RPM per motor; temperature not reported is null, never 0');
  assert.equal(r.rpmPeerDifferencePct, 0); assert.equal(r.dshotInvalidPctMax, 0); assert.ok(r.usableSamples >= 8);
  assert.deepEqual([r.voltage.before_V, r.voltage.min_V], [14.8, 14.8]); assert.match(r.note, /not a battery assessment/);
  assert.equal(h.c.combinedEligibility().ok, false, 'it cannot be run twice in one session'); assert.equal(h.c.startCombined(1000).ok, false);
  // persistence: saved record and export carry the result and the electronics profile
  const saved = h.c.saveAnalysis({ retainSamples: true }); assert.equal(saved.ok, true);
  const rec = listRecords(store).records.at(-1);
  assert.equal(rec.combinedConfirmation.status, 'completed'); assert.equal(rec.combinedConfirmation.motors.length, 4); assert.equal(rec.aircraftElectronics.flightController.firmwareVersion, '2025.12.5');
  assert.equal(h.c.exportEvidence().combinedConfirmation.status, 'completed'); assert.notEqual(h.c.analysisResult().category, 'inspection-recommended', 'a clean combined run adds no inspection reason');
  assert.ok(!JSON.stringify(rec).includes(h.c._rawUidHexForTests()), 'no UID in the saved record');
  pass('a combined run: hold required, identical commands, ramp capped at 1100, stop proof, result saved');
}

// ---- 3. fault paths: every one of them locks and requests external 1000
async function faultCase(name, inject, expected, { wait = 1500 } = {}) {
  const h = await freshHarness(); await fourSweeps(h);
  assert.equal(h.c.startCombined(1000).ok, true);
  await h.adv(wait);
  assert.equal(h.state(), STATE.RUNNING, name + ': running before the fault');
  await inject(h);
  await upTo(h, () => h.state() !== STATE.RUNNING, 20000, 50);
  assert.equal(h.state(), STATE.LOCKED_FAULT, name + ' -> LOCKED_FAULT (' + h.state() + ')');
  if (expected) assert.equal(h.faultReason(), expected, name);
  assert.equal(h.m.ctx.fault.combined, true, name + ': the fault records that it happened during the combined run');
  await h.adv(500);
  if (name !== 'usb') assert.deepEqual(h.sentMotorFrames().at(-1).slice(0, 4), [1000, 1000, 1000, 1000], name + ': external 1000 requested');
  assert.equal(h.m.motorCommandPermission({ kind: 'output-all', value: 1050 }).ok, false, name + ': no output after the fault');
  const r = h.c.combinedResult(); assert.ok(r, name + ': a combined result was recorded'); assert.notEqual(r.status, 'completed');
  return { h, r };
}
{
  await faultCase('usb', (h) => h.t.disconnect(), null);
  await faultCase('visibility', (h) => { h.c.notifyVisibilityLoss(); }, 'visibility-or-focus-lost:visibility');
  await faultCase('arming', (h) => { h.fc.inject.armed = true; }, 'arming-state-changed');
  await faultCase('stale telemetry', (h) => { h.fc.inject.telemetrySilent = true; }, 'telemetry-stale-or-unavailable');
  await faultCase('read-back', (h) => { h.fc.inject.stuckReadback = [1000, 1000, 1000, 1000]; }, 'readback-mismatch');
  const stopped = await faultCase('motor stopped', (h) => { h.fc.startValue[1] = 3000; }, 'combined-motor-stopped', { wait: 5600 }); assert.equal(stopped.r.status, 'inspection-recommended');
  const dshot = await faultCase('dshot', (h) => { h.fc.inject.invalidPct_centi = [0, 0, 150, 0]; }, 'dshot-errors-excessive'); assert.equal(dshot.r.status, 'inspection-recommended');
  const hot = await faultCase('over-temperature', (h) => { h.fc.inject.tempC = 90; }, 'temperature-fault'); assert.equal(hot.r.status, 'inspection-recommended');
  await faultCase('voltage', (h) => { h.fc.inject.voltage_cV = 1000; }, 'voltage-fault');
  await faultCase('missing rpm', (h) => { h.fc.inject.telemetryError = true; }, 'telemetry-stale-or-unavailable');
  await faultCase('stop pressed', (h) => { h.c.stopAndZero(); }, 'user-stop');
  const exc = await faultCase('controller exception', (h) => { h.c._obs.telemetry = { motors: null }; }, null);
  assert.ok(exc.h.faultReason());
  pass('USB loss, visibility, arming, stale or missing telemetry, read-back, a stopped motor, DShot, temperature, voltage, Stop & zero and an internal error all abort through the fail-closed path');
}

// ---- 4. the absolute cap, identical-value rule and permission, at every layer
{
  const h = await freshHarness(); await fourSweeps(h); h.c.startCombined(1000);
  const P = (v, k = 'output-all') => h.m.motorCommandPermission({ kind: k, value: v });
  assert.equal(P(1100).ok, true); assert.equal(P(1101).ok, false); assert.equal(P(2000).ok, false); assert.equal(P(1019).ok, false); assert.equal(P(1.5).ok, false);
  assert.equal(P(1000).ok, true, 'external 1000 is always permitted');
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false, 'a single-motor command is not allowed during the combined run');
  assert.equal(h.m.motorCommandPermission({ kind: 'output-all', value: 1050 }).maxValue, 1100);
  await h.c.stopAndZero();
  assert.equal(P(1050).ok, false, 'no output after a fault');
  // the boundary has its own limits whatever the machine says
  const t = benchFcTransport(); await t.open();
  const sent = []; const orig = t._write.bind(t); t._write = (b) => { sent.push(Uint8Array.from(b)); return orig(b); };
  const b = new MotorBoundary({ transport: t, authorize: () => ({ ok: true, maxValue: 5000, reason: '' }) });
  assert.throws(() => b.sendOutputAll(1101), (e) => e instanceof MotorCommandRefused); assert.throws(() => b.sendOutputAll(1010), (e) => e instanceof MotorCommandRefused); assert.throws(() => b.sendOutputAll(1.5), (e) => e instanceof MotorCommandRefused);
  b.sendOutputAll(1100); assert.deepEqual(parseMotorFrame(sent.at(-1)), [1100, 1100, 1100, 1100, 1000, 1000, 1000, 1000]);
  assert.throws(() => new MotorBoundary({ transport: t, authorize: () => ({ ok: true, maxValue: 1000, reason: '' }) }).sendOutputAll(1050), (e) => e instanceof MotorCommandRefused, 'the permission ceiling applies');
  assert.throws(() => b.sendOutput(0, 1101), (e) => e instanceof MotorCommandRefused);
  assert.throws(() => b._send({ kind: 'output', motor: 0, value: 1050 }, [1050, 1050, 1000, 1000, 1000, 1000, 1000, 1000]), (e) => e instanceof MotorCommandRefused, 'two raised motors are refused for a single-motor request');
  assert.throws(() => b._send({ kind: 'output-all', value: 1050 }, [1050, 1050, 1060, 1050, 1000, 1000, 1000, 1000]), (e) => e instanceof MotorCommandRefused, 'a mixed all-motor frame is refused');
  assert.throws(() => b._send({ kind: 'output-all', value: 1050 }, [1050, 1050, 1050, 1050, 1050, 1000, 1000, 1000]), (e) => e instanceof MotorCommandRefused, 'a fifth raised slot is refused');
  assert.throws(() => buildMotorFrame([1101, 1000, 1000, 1000, 1000, 1000, 1000, 1000]), (e) => e instanceof MotorCommandRefused);
  pass('absolute cap 1100, identical values, four motors only: enforced by the machine, the boundary and the frame builder');
}

// ---- 5. interlocks: temperature is optional, only a fresh over-temperature reading blocks
{
  const ctx = { mode: 'mock', unlocked: false, policy: { nonzeroOk: true }, motorCount: 4, safeStateDone: true, checklist: { items: Object.fromEntries(['propsRemoved', 'benchSecured', 'wiresClear', 'batteryReachable', 'smokeStopper', 'armSwitchOff'].map((k) => [k, true])), finalHold: true }, markerVerified: true,
    zeroVerified: true, esc: { enabled: false }, dshot: { status: 'usable', since: 0, lastAt: 5000 }, completedMotors: [0, 1, 2, 3], combinedDone: false, lastStopProofAt: null, transportAvailable: true, fault: null };
  const facts = (tempsC) => ({ armed: false, rpm: [0, 0, 0, 0], telemetryAt: 5000, commanded: [1000, 1000, 1000, 1000], readback: { values: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], at: 5000, current: true }, tempsC });
  const get = (f) => startInterlocks(ctx, f, 5050, { combined: true });
  assert.ok(get(facts([0, 0, 0, 0])).every((c) => c.ok), 'no temperature reported: nothing blocks');
  assert.ok(get(facts([55, 0, 61, 0])).every((c) => c.ok), 'a normal temperature does not block');
  assert.equal(get(facts([0, 90, 0, 0])).find((c) => c.id === 'no-over-temperature').ok, false, 'a fresh over-temperature reading blocks');
  assert.equal(get({ ...facts([0, 0, 0, 0]), commanded: [1000, 1000, 1050, 1000] }).find((c) => c.id === 'all-stopped-proven').ok, false);
  assert.equal(get({ ...facts([0, 0, 0, 0]), readback: { values: [1000, 1000, 1000, 1000, 0, 0, 0, 0], at: 1000, current: true } }).find((c) => c.id === 'all-stopped-proven').ok, false, 'a stale read-back does not prove the stop');
  assert.equal(get({ ...facts([0, 0, 0, 0]), rpm: [0, 0, 5, 0] }).find((c) => c.id === 'all-rpm-zero').ok, false);
  assert.equal(get({ ...facts([0, 0, 0, 0]), telemetryAt: 4000 }).find((c) => c.id === 'telemetry-fresh').ok, false, 'old telemetry is never carried forward');
  assert.equal(startInterlocks({ ...ctx, completedMotors: [0, 1, 2] }, facts([0, 0, 0, 0]), 5050, { combined: true }).find((c) => c.id === 'four-individual-complete').ok, false);
  assert.equal(startInterlocks({ ...ctx, fault: { reason: 'x' } }, facts([0, 0, 0, 0]), 5050, { combined: true }).find((c) => c.id === 'no-fault').ok, false);
  pass('temperature is optional (0 is not reported); a fresh over-temperature, stale data or a motor not proven at 1000 blocks');
}

// ---- 6. eligibility from the individual results, and the anomaly wording
{
  const motor = (i, over = {}) => ({ motor: i, status: 'completed', metrics: { stopProofComplete: true, startThresholdConfirmed: true, plateauRpm: { median: 2000 }, positionMatches: true, faultReason: null }, ...over });
  const mk = (motors, differences = []) => ({ motors, comparison: { differences } });
  const four = [0, 1, 2, 3];
  assert.equal(combinedEligibility({ result: mk(four.map((i) => motor(i))), completedMotors: four }).ok, true);
  for (const [name, bad] of [['inspect', { status: 'inspect' }], ['incomplete', { status: 'incomplete' }], ['not run', { status: 'not-run' }], ['no stop proof', { metrics: { stopProofComplete: false, startThresholdConfirmed: true, plateauRpm: { median: 1 }, positionMatches: true } }], ['fault', { metrics: { stopProofComplete: true, startThresholdConfirmed: true, plateauRpm: { median: 1 }, positionMatches: true, faultReason: 'peer-motor-rpm' } }], ['no rotation', { metrics: { stopProofComplete: true, startThresholdConfirmed: false, plateauRpm: { median: null }, positionMatches: true } }]]) {
    assert.equal(combinedEligibility({ result: mk(four.map((i) => (i === 2 ? motor(i, bad) : motor(i)))), completedMotors: four }).ok, false, name + ' blocks');
  }
  assert.equal(combinedEligibility({ result: mk(four.map((i) => (i === 1 ? motor(i, { status: 'difference' }) : motor(i))), [{ motor: 1, kind: 'rpm-at-shared-command' }]), completedMotors: four }).ok, false, 'an RPM peer difference blocks');
  assert.equal(combinedEligibility({ result: mk(four.map((i) => (i === 1 ? motor(i, { status: 'difference' }) : motor(i))), [{ motor: 1, kind: 'dshot-errors' }]), completedMotors: four }).ok, false, 'a DShot difference blocks');
  assert.equal(combinedEligibility({ result: mk(four.map((i) => (i === 1 ? motor(i, { status: 'difference' }) : motor(i))), [{ motor: 1, kind: 'start-threshold' }]), completedMotors: four }).ok, true, 'a start-threshold difference alone is not an RPM or DShot anomaly');
  assert.equal(combinedEligibility({ result: mk(four.map((i) => motor(i))), completedMotors: four, alreadyRan: true }).ok, false);
  assert.equal(combinedEligibility({ result: null, completedMotors: four }).ok, false); assert.equal(combinedEligibility({}).ok, false);
  pass('eligibility: inspection, incomplete, faulted, no stop proof, RPM or DShot differences and a missing result all block');
}

// ---- 7. peer anomaly in the combined run produces Inspection recommended with the agreed wording, and no diagnosis
{
  const h = await freshHarness({ diagStorage: memoryStorage() }); await fourSweeps(h); h.c.startCombined(1000);
  h.fc.inject.rpmFrozen = [2400, 2400, 2400, 1500]; // motor 4 turns slower than its peers when run together
  assert.ok(await upTo(h, () => h.state() === STATE.VERIFYING_STOP), 'run completes: ' + h.faultReason());
  h.fc.inject.rpmFrozen = null; await h.adv(3000); h.c.confirmNoRotation(); assert.equal(h.c.completeCombined().ok, true);
  const r = h.c.combinedResult();
  assert.equal(r.status, 'inspection-recommended'); assert.equal(r.summary, COMBINED_ANOMALY_TEXT); assert.ok(r.rpmPeerDifferencePct >= 20);
  assert.ok(!/motor 4 is|faulty|bad|failing|battery is|esc is/i.test(JSON.stringify(r.reasons) + r.summary), 'no specific motor, ESC or battery is diagnosed');
  const res = h.c.analysisResult();
  assert.equal(res.category, 'inspection-recommended'); assert.ok(res.reasons.some((x) => x.text.includes(COMBINED_ANOMALY_TEXT)));
  assert.equal(h.c.saveAnalysis().ok, true);
  pass('a combined anomaly gives Inspection recommended with the agreed wording and diagnoses nothing');
}

// ---- 8. recorder, summary and sanitizer
{
  const rec = createCombinedRecorder(); rec.begin({ at: 0, voltageBefore_cV: 1480 });
  for (let i = 0; i < 40; i++) rec.sample({ at: 100 + i * 40, phase: i < 10 ? 'settle' : 'plateau', cmd: 1060, telemetry: { motors: [0, 1, 2, 3].map(() => ({ rpm: 2400, invalidPct_centi: 0, temperatureC: 0 })) }, telemetryAt: 100 + i * 40, voltage_cV: 1470 - i });
  rec.sample({ at: 5000, phase: 'plateau', cmd: 1060, telemetry: { motors: [] }, telemetryAt: 100 + 39 * 40 }); // the same frame again is not a new sample
  const snap = rec.snapshot(); assert.equal(snap.samples.length, 40);
  const s = summarizeCombined({ rec: snap, end: { completed: true }, stopProofComplete: true, targetCommand: 1060 });
  assert.equal(s.status, 'completed'); assert.equal(s.motors[0].maxTempC, null); assert.equal(s.voltage.before_V, 14.8); assert.equal(s.voltage.min_V, 14.31);
  assert.equal(summarizeCombined({ rec: snap, end: { completed: true }, stopProofComplete: false }).status, 'inspection-recommended');
  assert.equal(summarizeCombined({ rec: { samples: [], dropped: 0, plateauAt: null, voltageBefore_cV: null }, end: { completed: true }, stopProofComplete: true }).status, 'incomplete');
  assert.equal(summarizeCombined({ rec: snap, end: { completed: false, reason: 'user-stop' } }).status, 'incomplete');
  assert.equal(sanitizeCombined({ ...s, motors: [{ medianRpm: 'x', serial: 'S' }], extra: 1 }).motors[0].medianRpm, null); assert.equal(sanitizeCombined({ status: 'bogus' }), null); assert.equal(sanitizeCombined(null), null);
  assert.ok(BENCH_TIMINGS.holdStartMs >= 1000);
  pass('recorder keeps one sample per fresh frame; summary and sanitizer behave');
}
// ---- 9. regression: reading the view (which asks for eligibility) while a sweep is collecting must not freeze a stale result
{
  const h = await freshHarness();
  for (let m = 0; m < 2; m++) {
    await h.adv(5100); await h.startMotor(m); await h.adv(2000);
    h.c.view(); h.c.combinedEligibility(); // the screen redraws mid-sweep
    await h.adv(7000); await h.finishStopProof(EXPECTED_POSITIONS[m]);
    const res = h.c.analysisResult();
    assert.notEqual(res.motors[m].status, 'not-run', 'motor ' + (m + 1) + ' appears in the result right after its sweep');
  }
  pass('the result is never one sweep behind after a mid-sweep redraw');
}
console.log('ALL OK');
