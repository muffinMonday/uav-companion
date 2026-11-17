// Live MSP/DShot analysis through the controller, against the SYNTHETIC flight controller (mocked transport, deterministic
// clock). No hardware, no browser. Proves that sample collection happens during ramp, validation, plateau and stop, that it is
// passive (a failing collector never blocks or delays Stop & zero), and that incomplete, cancelled and faulted sweeps are
// identifiable. Blackbox removal from the live workflow is checked at the end.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateReadiness } from '../src/preflight/readiness.js';
import { CATEGORY } from '../src/benchtest/result.js';
import { EXPECTED_POSITIONS, MOTOR } from '../src/benchtest/constants.js';
import { STATE } from '../src/benchtest/state-machine.js';
import { RECORDS_KEY, SAMPLES_KEY } from '../src/aircraft-diag-data.js';
import { makeHarness, memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach((x) => strings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, out)); return out; };

async function sweepMotor(h, motor, { settle = 3500, report = EXPECTED_POSITIONS[motor] } = {}) {
  h.c.selectMotor(motor); h.c.confirmTarget(motor);
  const r = h.c.startMotor(1000);
  assert.equal(r.ok, true, 'the sweep starts: ' + r.reason);
  await h.adv(9000);
  assert.equal(h.state(), STATE.VERIFYING_STOP, 'the sweep reached the stop proof (' + h.faultReason() + ')');
  await h.adv(settle);
  h.c.confirmNoRotation();
  return h.c.reportPosition(report);
}

// ---------- exact collection during ramp, validation, plateau and stop; one completed sweep
{
  const h = await makeHarness({ fc: { inject: { tempC: 58 } } }); await h.toMotorReady();
  const r = await sweepMotor(h, 0);
  assert.equal(r.ok, true); assert.equal(h.state(), STATE.MOTOR_READY);
  const [sw] = h.c._collector.sweeps();
  assert.equal(sw.status, 'completed'); assert.equal(sw.motor, 0); assert.equal(sw.end.reportedPosition, 'rear right'); assert.equal(sw.end.stopProofComplete, true);
  const phases = [...new Set(sw.samples.map((s) => s.phase))];
  assert.deepEqual(phases, ['ramp', 'validate', 'plateau', 'stop'], 'every phase is sampled');
  assert.equal(sw.samples[0].cmd, 1000, 'the first sample is taken before any output is sent');
  const cmds = [...new Set(sw.samples.filter((s) => s.phase !== 'stop' && s.cmd > 1000).map((s) => s.cmd))];
  assert.deepEqual(cmds, [1020, 1025, 1030, 1045], 'commanded output is recorded at each step: ramp by 5 to the threshold, then the plateau');
  assert.ok(sw.samples.every((s) => s.cmd <= MOTOR.cap && s.cmd >= MOTOR.stopValue));
  assert.ok(sw.samples.filter((s) => s.phase === 'stop').every((s) => s.cmd === 1000), 'stop samples are at external 1000');
  assert.ok(sw.samples.every((s) => s.rpm.length === 4 && s.inv.length === 4 && s.temp.length === 4), 'RPM, DShot and temperature for all four motors');
  assert.ok(sw.samples.every((s) => s.fresh === true && s.telAgeMs !== null && s.telAgeMs <= 200), 'telemetry age recorded and fresh');
  assert.ok(sw.samples.every((s) => s.armed === false), 'arming state recorded');
  assert.ok(sw.samples.every((s) => s.ack === 'ok' || s.ack === 'none'), 'acknowledgement status recorded');
  assert.ok(sw.samples.some((s) => s.rbCurrent === true && Array.isArray(s.rb)), 'FC-side read-back recorded with its currency');
  assert.ok(sw.samples.every((s) => s.v_cV === 1480 || s.v_cV === null), 'battery voltage recorded');
  assert.ok(sw.samples.every((s) => s.temp[0] === 58 || s.temp[0] === null), 'ESC temperature recorded');
  const ts = sw.samples.map((s) => s.t); assert.ok(ts.every((t, i) => i === 0 || t > ts[i - 1]), 'timestamps are strictly increasing');
  assert.ok(sw.samples.length <= 40 * 25 && sw.samples.length > 100, `bounded and plausible (${sw.samples.length})`);
  assert.equal(sw.meta.controllerThreshold, 1030); assert.equal(sw.meta.expectedPosition, 'rear right');
  assert.ok(sw.meta.voltageBefore_cV === 1480 || sw.meta.voltageBefore_cV === null);
  assert.equal(h.c.view().analysis.sweeps, 1); assert.equal(h.c.view().analysis.collecting, false);
  // no sample is ever duplicated or invented: every sample has a distinct, real frame (timestamps differ by at least one poll)
  assert.ok(ts.every((t, i) => i === 0 || t - ts[i - 1] >= 30), 'no more than one sample per telemetry frame');

  const res = h.c.analysisResult(); const m = res.motors[0].metrics;
  assert.equal(m.startThreshold, 1030); assert.equal(m.plateauCommand, 1045); assert.equal(m.plateauRpm.median, 1800);
  assert.equal(m.temperature.selectedMaxC, 58); assert.equal(m.dshot.motor.maxPct, 0); assert.equal(m.stopProofComplete, true); assert.equal(m.positionMatches, true);
  assert.ok(m.timeToStableRotationMs > 1500 && m.timeToStableRotationMs < 3500, `time to stable rotation ${m.timeToStableRotationMs} ms`);
  assert.equal(res.category, CATEGORY.INCOMPLETE, 'one motor of four is an incomplete test');
  assert.equal(res.motors[1].status, 'not-run');
  pass('one completed sweep: samples in ramp, validation, plateau and stop with command, read-back, RPM, DShot, voltage, temperature, arming, freshness and acknowledgement; metrics derived');
}

// ---------- analysis is passive: a failing collector never blocks or delays Stop & zero, or the sweep
{
  const base = await makeHarness(); await base.toMotorReady(); await base.startMotor(0); await base.adv(1500);
  const n0 = base.fc.received.length; base.c.stopAndZero();
  const stopFramesNormal = base.fc.received.slice(n0)[0];
  const h = await makeHarness(); await h.toMotorReady();
  h.c._collector.sample = () => { throw new Error('collector failure'); };
  h.c._collector.begin = () => { throw new Error('collector failure'); };
  h.c._collector.end = () => { throw new Error('collector failure'); };
  const r = await h.startMotor(0); assert.equal(r.ok, true, 'the sweep still starts when the collector throws');
  await h.adv(1500);
  assert.equal(h.state(), STATE.RUNNING, 'the sweep keeps running');
  const n1 = h.fc.received.length;
  h.c.stopAndZero();
  const sent = h.fc.received.slice(n1);
  assert.ok(sent.length >= 1 && sent[0].every((v) => v === 1000), 'the first frame after Stop & zero is external 1000, sent synchronously');
  assert.deepEqual(sent[0], stopFramesNormal);
  assert.equal(h.state(), STATE.LOCKED_FAULT);
  await h.adv(3000);
  assert.ok(h.fc.received.slice(n1).length >= 10, 'the stop path continues at its normal cadence');
  assert.equal(h.c.view().notes.error, '', 'a collector failure is not reported as a command-path error');
  assert.equal(h.faultReason(), 'user-stop');
  // the analysis layer does not touch the machine's authority: no analysis data in machine context
  assert.ok(!/collector|rpmByCommand|plateauRpm|startThreshold|evidence/i.test(JSON.stringify(h.m.ctx)), 'the state machine holds no analysis data');
  pass('passive collection: a throwing collector neither blocks nor delays the sweep or Stop & zero; the machine holds no analysis data');
}

// ---------- cancelled sweep, no stable rotation, wrong motor
{
  const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(0); await h.adv(1500);
  h.c.stopAndZero(); await h.adv(500);
  const sw = h.c._collector.sweeps()[0];
  assert.equal(sw.status, 'incomplete'); assert.equal(sw.end.reason, 'user-stop');
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.INCOMPLETE); assert.ok(res.reasons.some((r) => /user-stop/.test(r.text)));
  assert.equal(res.motors[0].status, 'incomplete'); assert.equal(res.motors[0].metrics.completed, false);
  assert.equal(h.c.exportEvidence().sweeps[0].complete, false);
  pass('a cancelled sweep stays identifiable as incomplete, with its reason, in the result and the export');
}
{
  const h = await makeHarness({ fc: { startValue: [1200, 1200, 1200, 1200] } }); await h.toMotorReady(); await h.startMotor(0); await h.adv(12000);
  assert.equal(h.state(), STATE.LOCKED_FAULT); assert.equal(h.faultReason(), 'no-stable-rotation-by-cap');
  const sw = h.c._collector.sweeps()[0];
  assert.equal(sw.status, 'incomplete'); assert.ok(sw.samples.every((s) => s.rpm[0] === 0));
  assert.equal(Math.max(...sw.samples.map((s) => s.cmd)), MOTOR.cap, 'the ramp reached the cap and no further');
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.INSPECT);
  assert.ok(res.reasons.some((r) => /No stable rotation was established by the output cap/.test(r.text)));
  assert.equal(res.motors[0].metrics.startThreshold, null);
  pass('no stable rotation by the cap: samples recorded to the cap, no threshold invented, "Inspection recommended" with the exact reason');
}
{
  const h = await makeHarness(); await h.toMotorReady();
  const r = await sweepMotor(h, 0, { report: 'front left' });
  assert.equal(r.ok, false); assert.equal(h.faultReason(), 'motor-position-mismatch');
  const sw = h.c._collector.sweeps()[0];
  assert.equal(sw.status, 'incomplete'); assert.equal(sw.end.reportedPosition, 'front left');
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.INSPECT); assert.ok(res.reasons.some((x) => /other than the expected/.test(x.text)));
  assert.equal(res.motors[0].metrics.reportedPosition, 'front left'); assert.equal(res.motors[0].metrics.expectedPosition, 'rear right');
  pass('wrong motor confirmation: recorded as reported versus expected and shown as "Inspection recommended"');
}

// ---------- telemetry loss mid-sweep: samples stop, no sample is invented, the episode is listed
{
  const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(0); await h.adv(1500);
  const before = h.c._collector.sweeps()[0].samples.length;
  h.fc.inject.telemetrySilent = true; await h.adv(1000);
  const sw = h.c._collector.sweeps()[0];
  assert.equal(h.faultReason(), 'telemetry-stale-or-unavailable');
  assert.ok(sw.samples.length - before <= 6, 'no samples while telemetry was silent (only frames from before the stale limit)');
  assert.equal(sw.status, 'incomplete');
  assert.ok(sw.unavailable.length >= 1, 'the unavailable stretch is listed');
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.INSPECT); assert.ok(res.reasons.some((r) => /telemetry became unavailable/.test(r.text)));
  pass('telemetry silence mid-sweep: the sweep is incomplete, the gap is listed, nothing is fabricated, and the result states the exact observation');
}

// ---------- peer rotation, DShot errors, read-back mismatch (faults from the machine, recorded as evidence)
{
  const cases = [
    ['peer-motor-rpm', (h) => { h.fc.inject.extraRpm = { index: 1, rpm: 300 }; }, /not being tested reported rotation/],
    ['dshot-errors-excessive', (h) => { h.fc.inject.invalidPct_centi = [150, 0, 0, 0]; }, /DShot error statistics stayed/],
    ['dshot-statistics-unavailable', (h) => { h.fc.inject.invalidPct_centi = [10000, 10000, 10000, 10000]; }, /became unavailable/],
    ['readback-mismatch', (h) => { h.fc.inject.stuckReadback = [1100, 1000, 1000, 1000]; }, /read-back did not match/],
    ['arming-state-changed', (h) => { h.fc.inject.armed = true; }, /armed/],
    ['temperature-fault', (h) => { h.fc.inject.tempC = 90; }, /temperature/],
    ['voltage-fault', (h) => { h.fc.inject.voltage_cV = 1000; }, /voltage/],
  ];
  for (const [reason, inject, re] of cases) {
    const h = await makeHarness(); await h.toMotorReady(); await h.startMotor(0); await h.adv(1500);
    inject(h); await h.adv(800);
    assert.equal(h.faultReason(), reason, reason);
    const res = h.c.analysisResult();
    assert.equal(res.category, CATEGORY.INSPECT, reason); assert.ok(res.reasons.some((r) => re.test(r.text)), `${reason}: ${JSON.stringify(res.reasons)}`);
  }
  pass('peer rotation, DShot errors and unavailability, read-back mismatch, arming, temperature and voltage faults each produce "Inspection recommended" with their own reason');
}

// ---------- a full four-motor session: completed, then a difference; storage and retention off by default
async function fullSession(fc, diagStorage) {
  const h = await makeHarness({ fc, diagStorage }); await h.toMotorReady();
  for (let m = 0; m < 4; m++) { const r = await sweepMotor(h, m); assert.equal(r.ok, true, `motor ${m}: ${r.reason}`); await h.adv(5200); }
  return h;
}
{
  const dstore = memoryStorage();
  const h = await fullSession({ startValue: [1030, 1030, 1030, 1030] }, dstore);
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.COMPLETED, JSON.stringify(res.reasons)); assert.equal(res.completedCount, 4);
  assert.ok(res.motors.every((m) => m.status === 'completed' && m.metrics.plateauRpm.median === 1800));
  assert.equal(h.c.view().caps.completedMotors.length, 4);
  // nothing is stored unless asked
  assert.equal(dstore.getItem(RECORDS_KEY), null); assert.equal(dstore.getItem(SAMPLES_KEY), null);
  assert.ok(h.c.approxSampleBytes() > 10000, 'the size of the live samples is available before the user chooses');
  const saved = h.c.saveAnalysis();
  assert.equal(saved.ok, true); assert.equal(saved.sampleBytes, 0);
  assert.equal(dstore.getItem(SAMPLES_KEY), null, 'raw-sample retention is off by default');
  const rec = h.c.savedDiagnostics().records[0];
  assert.equal(rec.result.category, CATEGORY.COMPLETED); assert.equal(rec.firmware.firmware, '2025.12.5'); assert.equal(rec.motors.length, 4);
  assert.ok(!JSON.stringify(rec).includes(h.c.view().identity.uidHex), 'no UID in the stored record');
  const withSamples = h.c.saveAnalysis({ retainSamples: true });
  assert.equal(withSamples.ok, true); assert.ok(withSamples.sampleBytes > 10000); assert.notEqual(dstore.getItem(SAMPLES_KEY), null);
  const exported = JSON.stringify(h.c.exportEvidence());
  assert.ok(!exported.includes(h.c.view().identity.uidHex), 'the evidence export has no UID'); assert.ok(h.c.view().identity.uidHex.length > 8);
  assert.equal(JSON.parse(exported).sweeps.length, 4);
  assert.equal(h.c.deleteSavedDiagnostics(), true); assert.equal(dstore.getItem(RECORDS_KEY), null); assert.equal(dstore.getItem(SAMPLES_KEY), null);
  assert.equal(h.c.savedDiagnostics().records.length, 0);
  // finishing the bench keeps the result readable, and a new connection starts clean
  h.c.finishBench(); await h.adv(3000); h.c.confirmNoRotation(); h.c.completeFinish();
  assert.equal(h.state(), STATE.BENCH_COMPLETE); assert.equal(h.c.analysisResult().category, CATEGORY.COMPLETED);
  pass('four completed motors: "Completed — no issue observed"; derived record saved only on request, with no samples and no UID; samples kept only when chosen; deletion removes both');
}
{
  const h = await fullSession({ startValue: [1030, 1030, 1030, 1060] });
  const res = h.c.analysisResult();
  assert.equal(res.category, CATEGORY.DIFFERENCE); assert.equal(res.motors[3].status, 'difference');
  assert.ok(res.motors.slice(0, 3).every((m) => m.status === 'completed'));
  const noStore = h.c.saveAnalysis(); assert.equal(noStore.ok, false, 'with no browser storage (Node) a save reports failure instead of throwing'); assert.equal(noStore.reason, 'unavailable');
  pass('four completed motors with one late starter: "Difference observed", provisional, never an inspection result');
}

// ---------- the inter-sweep settle interval: not before the first motor, counted from the complete stop proof, no effect on stopping
{
  const { BENCH_TIMINGS } = await import('../src/benchtest/constants.js');
  assert.equal(BENCH_TIMINGS.interSweepSettleMs, 5000); assert.equal(BENCH_TIMINGS.minSweepGapMs, undefined, 'the old name is gone');
  const h = await makeHarness(); await h.toMotorReady();
  assert.equal(h.m.ctx.lastStopProofAt, null, 'nothing has been proven yet');
  h.c.selectMotor(0); h.c.confirmTarget(0);
  assert.ok(!h.c.view().caps.interlocks.some((i) => i.id === 'inter-sweep-settle' && !i.ok), 'the first motor is not delayed');
  assert.equal(h.c.startMotor(1000).ok, true);
  await h.adv(9000); await h.adv(3500); h.c.confirmNoRotation();
  const at = h.clock.now(); assert.equal(h.c.reportPosition(EXPECTED_POSITIONS[0]).ok, true);
  assert.equal(h.m.ctx.lastStopProofAt, at, 'the interval starts when the previous stop proof is complete and its position confirmed');
  h.c.selectMotor(1); h.c.confirmTarget(1);
  await h.adv(4000);
  const wait = h.c.view().caps.interlocks.find((i) => i.id === 'inter-sweep-settle');
  assert.equal(wait.ok, false); assert.equal(h.c.startMotor(1000).ok, false, 'the next motor cannot start inside the interval');
  assert.equal(h.state(), STATE.MOTOR_READY, 'a refused start is not a fault');
  await h.adv(1100);
  assert.equal(h.c.view().caps.interlocks.find((i) => i.id === 'inter-sweep-settle').ok, true);
  // stopping is never subject to it: Stop & zero inside the interval still sends 1000 at once
  const h2 = await makeHarness(); await h2.toMotorReady(); h2.c.selectMotor(0); h2.c.confirmTarget(0); h2.c.startMotor(1000); await h2.adv(9000); await h2.adv(3500); h2.c.confirmNoRotation(); h2.c.reportPosition(EXPECTED_POSITIONS[0]);
  const n = h2.fc.received.length; h2.c.stopAndZero();
  assert.ok(h2.fc.received.length > n && h2.fc.received[n].every((v) => v === 1000), 'Stop & zero sends 1000 inside the settle interval');
  assert.equal(h2.state(), STATE.LOCKED_FAULT);
  pass('inter-sweep settle: 5 s (provisional), not before the first motor, counted from the previous complete stop proof, and never delays or bypasses stopping');
}

// ---------- Blackbox is gone from the live workflow
{
  const h = await makeHarness({ fc: { blackbox: { supported: true, device: 0, rateDenom: 1, pRatio: 1, sampleRate: 0, mask: 0, maskPresent: true } } });
  await h.c.connect(h.t); h.c.setAttestation({ armSwitchOff: true, batteryDisconnected: true }); h.c.setManual({ escFamily: 'Bluejay', escModel: 'synthetic' });
  const ids = h.c.view().readiness.gates.map((g) => g.id);
  for (const gone of ['blackbox', 'bb-mode', 'bb-fields', 'bb-rate', 'storage']) assert.ok(!ids.includes(gone), `${gone} is not a gate of the live workflow`);
  assert.ok(!('blackboxMode' in h.c.view().attestations));
  assert.equal(h.c.proceed().ok, true, 'no Blackbox device, no mode and no storage: the live workflow still proceeds');
  // the deferred gates remain available only on request (kept for a future owner decision), and even then never block the bench policy
  const withBb = evaluateReadiness({ snapshot: h.c.view().snapshot, attestations: { armSwitchOff: true, batteryDisconnected: true }, transportKind: 'mock', includeBlackbox: true });
  assert.ok(withBb.gates.some((g) => g.id === 'bb-mode') && withBb.overall !== 'conditional');
  const g = await makeHarness(); await g.c.connect(g.t); g.c.setAttestation({ armSwitchOff: true, batteryDisconnected: true }); g.c.setManual({ escFamily: 'Bluejay', escModel: 'synthetic' });
  const { phase3Policy } = await import('../src/benchtest/interlocks.js');
  const rep = evaluateReadiness({ snapshot: g.c.view().snapshot, attestations: { armSwitchOff: true, batteryDisconnected: true }, transportKind: 'mock', includeBlackbox: true });
  const p = phase3Policy({ report: rep, combo: { entry: {} }, mode: 'mock', unlocked: false, transportKind: 'mock' });
  assert.ok(!p.blockers.some((b) => ['blackbox', 'bb-mode', 'bb-fields', 'bb-rate', 'storage'].includes(b.id)), 'Blackbox gates never block the bench policy');
  for (const f of ['controller.js', 'bench-ui.js', 'state-machine.js', 'result-ui.js', 'result.js', 'metrics.js', 'live-collector.js', 'history.js']) {
    assert.ok(!/blackbox|MOTOR_TEST/i.test(fs.readFileSync(new URL('../src/benchtest/' + f, import.meta.url), 'utf8')), `${f} has no Blackbox logic`);
  }
  assert.ok(fs.readFileSync(new URL('../src/benchtest/bench-ui.js', import.meta.url), 'utf8').includes('Begin active motor test'), 'the ambiguous readiness action is renamed');
  assert.ok(!fs.readFileSync(new URL('../src/benchtest/bench-ui.js', import.meta.url), 'utf8').includes('Continue to safe-state initialization'));
  pass('Blackbox: no gate, attestation or mode control in the live workflow; deferred gates only on request and never a bench blocker; the readiness action is "Begin active motor test"');
}

console.log('ALL OK');
