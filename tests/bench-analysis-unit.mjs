// Live MSP/DShot analysis layer: pure-function tests (collector, metrics, result, history, local store). Synthetic samples only;
// no controller, no transport, no hardware. The controller-level collection tests are in bench-analysis-controller-unit.mjs.
import assert from 'node:assert/strict';
import { createLiveCollector } from '../src/benchtest/live-collector.js';
import { computeSweepMetrics, _internals } from '../src/benchtest/metrics.js';
import { buildBenchResult, CATEGORY, CATEGORY_TEXT, DISCLAIMER } from '../src/benchtest/result.js';
import { buildEvidenceExport, buildHistoryRecord, identityForRecord } from '../src/benchtest/history.js';
import { ANALYSIS_SCHEMA_VERSION, METRIC_RULES, PEER_COMPARISON, SAMPLE_LIMITS } from '../src/benchtest/analysis-constants.js';
import { EXPECTED_POSITIONS, MOTOR } from '../src/benchtest/constants.js';
import * as store from '../src/aircraft-diag-data.js';
import { memoryStorage } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);

// ---- a synthetic sweep builder (no timing model beyond the controller's: 400 ms dwell, 1 s validation, 2 s plateau, 40 ms frames)
function sample(t, phase, cmd, rpm, motor, extra = {}) {
  const r = [0, 0, 0, 0]; r[motor] = rpm;
  const cmds = [1000, 1000, 1000, 1000]; cmds[motor] = cmd;
  return { t, phase, motor, cmd, cmds, rb: null, rbAgeMs: null, rbCurrent: null, rpm: r, inv: [0, 0, 0, 0], temp: [null, null, null, null], v_cV: 1480, vAt: 1000 + Math.floor(t / 500), armed: false, armedAgeMs: 10, telAgeMs: 5, fresh: true, ack: 'ok', ...extra };
}
function mkSweep(motor, { threshold = 1030, perUnit = 40, ended = 'completed', reason = null, stopProof = true, position, voltageBefore = 1480, noPlateau = false, mutate } = {}) {
  const S = []; let t = 0;
  for (let cmd = 1020; cmd <= threshold; cmd += 5) {
    const last = cmd === threshold;
    const dur = last ? 1000 : 400;
    for (let k = 0; k < dur / 40; k++) { S.push(sample(t, last ? 'validate' : 'ramp', cmd, cmd >= threshold ? (cmd - 1000) * perUnit : 0, motor)); t += 40; }
  }
  if (!noPlateau) { const pc = threshold + 15; for (let k = 0; k < 50; k++) { S.push(sample(t, 'plateau', pc, (pc - 1000) * perUnit, motor)); t += 40; } }
  for (let k = 0; k < 20; k++) { S.push(sample(t, 'stop', 1000, 0, motor)); t += 40; }
  if (mutate) mutate(S);
  return {
    id: motor + 1, motor, samples: S, gaps: [], unavailable: [], truncated: false, droppedSamples: 0, status: ended,
    meta: { voltageBefore_cV: voltageBefore, expectedPosition: EXPECTED_POSITIONS[motor], controllerThreshold: threshold },
    end: { status: ended, reason, stopProofComplete: ended === 'completed' ? stopProof : null, reportedPosition: position === undefined ? EXPECTED_POSITIONS[motor] : position },
  };
}
const four = (over = {}) => [0, 1, 2, 3].map((m) => mkSweep(m, over[m] || {}));
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach((x) => strings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, out)); return out; };

// ================= collector
{
  let clock = 0;
  const c = createLiveCollector({ clockNow: () => clock, mono: () => clock });
  const tel = (rpm = 0, extra = {}) => ({ motors: [0, 1, 2, 3].map((i) => ({ rpm: i === 0 ? rpm : 0, invalidPct_centi: 0, temperatureC: 0, ...extra })) });
  const base = (at) => ({ phase: 'ramp', commands: [1020, 1000, 1000, 1000], readback: { values: [1020, 1000, 1000, 1000, 1000, 1000, 1000, 1000], at, current: true }, telemetry: tel(100), telemetryAt: at, armed: false, armedAt: at, voltage_cV: 1480, voltageAt: at, ack: { ok: true, kind: 'output' } });
  c.begin({ motor: 0, voltageBefore_cV: 1480, expectedPosition: 'rear right' });
  clock = 40; assert.equal(c.sample(base(40)), true);
  assert.equal(c.sample(base(40)), false, 'the same telemetry frame is never recorded twice');
  clock = 80; assert.equal(c.sample({ ...base(40), telemetryAt: 40 }), false, 'a repeated frame (nothing new) is not a sample');
  clock = 400; assert.equal(c.sample({ ...base(80), telemetryAt: 80 }), false, 'a frame older than the stale limit is not a sample');
  clock = 440; assert.equal(c.sample(base(440)), true);
  const sw = c.sweeps()[0];
  assert.equal(sw.samples.length, 2, 'only genuine frames became samples');
  assert.equal(sw.unavailable.length, 1, 'the stale stretch is listed as an unavailable episode');
  assert.equal(sw.gaps.length, 1, 'the 400 ms between frames is listed as a gap');
  assert.equal(sw.gaps[0].ms, 400);
  assert.deepEqual(sw.samples[0].temp, [null, null, null, null], 'temperature 0 is "not reported", never a reading');
  const first = sw.samples[0];
  assert.equal(first.cmd, 1020); assert.equal(first.ack, 'ok'); assert.equal(first.armed, false); assert.equal(first.rbCurrent, true); assert.equal(first.fresh, true);
  assert.equal(first.rpm.length, 4); assert.equal(first.inv.length, 4);
  clock = 480; c.sample({ ...base(480), telemetry: { motors: [0, 1, 2, 3].map(() => ({ rpm: 5, invalidPct_centi: 10000, temperatureC: 55 })) } });
  const last = sw.samples[2];
  assert.deepEqual(last.inv, [null, null, null, null], 'the 100 % sentinel is unavailable, not a measurement');
  assert.deepEqual(last.temp, [55, 55, 55, 55]);
  c.end('incomplete', { reason: 'user-stop' });
  assert.equal(sw.status, 'incomplete'); assert.equal(sw.end.reason, 'user-stop');
  assert.equal(c.sample(base(520)), false, 'nothing is recorded with no active sweep');
  pass('collector: one sample per new fresh frame; stale, repeated and unavailable readings become explicit episodes and gaps, never samples; sentinel and 0 °C are unavailable');
}
{
  let clock = 0;
  const c = createLiveCollector({ clockNow: () => clock, limits: { maxSamplesPerSweep: 5, maxSweeps: 3, stopPhaseMaxMs: 100 } });
  const mk = (at, phase = 'ramp') => ({ phase, commands: [1020, 1000, 1000, 1000], readback: null, telemetry: { motors: [0, 1, 2, 3].map(() => ({ rpm: 1, invalidPct_centi: 0, temperatureC: 0 })) }, telemetryAt: at, armed: false, armedAt: at, voltage_cV: null, voltageAt: null, ack: null });
  c.begin({ motor: 0 });
  for (let i = 1; i <= 20; i++) { clock = i * 40; c.sample(mk(clock)); }
  const sw = c.sweeps()[0];
  assert.equal(sw.samples.length, 5, 'never more than the limit'); assert.equal(sw.truncated, true); assert.equal(sw.droppedSamples, 15);
  c.end('incomplete', { reason: 'x' });
  for (let i = 0; i < 6; i++) { c.begin({ motor: i % 4 }); c.end('completed'); }
  assert.ok(c.sweeps().length <= 3, 'retained sweeps are bounded');
  c.begin({ motor: 1 }); clock = 1000;
  for (let i = 0; i < 10; i++) { clock += 40; c.sample(mk(clock, 'stop')); }
  assert.ok(c.sweeps().at(-1).samples.length <= 4, 'stop-phase samples are bounded in time');
  assert.equal(c.sweeps().at(-1).stopSamplesTruncated, true);
  assert.ok(SAMPLE_LIMITS.maxSamplesPerSweep <= 2000 && SAMPLE_LIMITS.maxSweeps <= 12);
  pass('bounded memory: sample count, retained sweeps and stop-phase samples are capped, and a capped sweep says so');
}

// ================= metrics
{
  const sw = mkSweep(0, { threshold: 1030 });
  const m = computeSweepMetrics(sw);
  assert.equal(m.startThresholdConfirmed, true); assert.equal(m.startThreshold, 1030); assert.equal(m.thresholdAgreesWithController, true);
  assert.equal(m.plateauCommand, 1045);
  assert.equal(m.plateauDurationMs, 49 * 40);
  assert.equal(m.plateauRpm.median, 1800); assert.equal(m.plateauRpm.range, 0); assert.equal(m.plateauRpm.mad, 0); assert.equal(m.plateauRpm.min, 1800); assert.equal(m.plateauRpm.max, 1800);
  assert.ok(m.plateauUsableSamples >= METRIC_RULES.minPlateauSamples && m.plateauUsableSamples <= 50 - METRIC_RULES.plateauSettleMs / 40 + 1);
  assert.equal(m.plateauMissingSamples, 50 - m.plateauUsableSamples);
  const firstNonzeroT = 0, plateauT = sw.samples.find((s) => s.phase === 'plateau').t;
  assert.equal(m.timeToStableRotationMs, plateauT - firstNonzeroT);
  assert.equal(m.dshot.motor.maxPct, 0); assert.equal(m.dshot.motor.medianPct, 0); assert.equal(m.dshot.motor.excessiveFraction, 0);
  assert.equal(m.voltage.before_V, 14.8); assert.equal(m.voltage.min_V, 14.8); assert.equal(m.voltage.drop_V, 0);
  assert.equal(m.temperature.selectedMaxC, null, 'temperature not reported is unavailable'); assert.ok(m.unavailable.some((u) => /temperature/.test(u)));
  assert.equal(m.stopProofComplete, true); assert.equal(m.positionMatches, true); assert.equal(m.completed, true);
  assert.ok(m.rpmByCommand[1030] && m.rpmByCommand[1045], 'RPM is recorded per command level');
  assert.equal(m.rpmByCommand[1020], undefined, 'levels with no rotation have no RPM entry');
  pass('metrics: start threshold, time to stable rotation, plateau command, duration, RPM median/spread/min/max, usable and missing counts, DShot, voltage, stop proof and position');
}
{
  // spread: a known jittery plateau, checked against the documented robust measures
  const sw = mkSweep(0, { mutate: (S) => { let k = 0; for (const s of S) if (s.phase === 'plateau') { s.rpm[0] = 1800 + [0, 20, -20, 10, -10][k++ % 5]; } } });
  const m = computeSweepMetrics(sw);
  assert.equal(m.plateauRpm.median, 1800); assert.equal(m.plateauRpm.min, 1780); assert.equal(m.plateauRpm.max, 1820);
  assert.ok(m.plateauRpm.range > 0 && m.plateauRpm.range <= 40); assert.equal(m.plateauRpm.mad, 10);
  assert.equal(_internals.median([3, 1, 2]), 2); assert.equal(_internals.median([1, 2, 3, 4]), 2.5); assert.equal(_internals.percentile([0, 10], 50), 5); assert.equal(_internals.mad([1, 1, 2, 2, 4, 6, 9]), 1);
  pass('metrics: median, percentile range and MAD match hand-computed values');
}
{
  // gaps, stale samples and contiguity: a gap in the middle of the plateau limits the window; nothing is bridged
  const sw = mkSweep(0, { mutate: (S) => { const p = S.filter((s) => s.phase === 'plateau'); for (let i = 20; i < 30; i++) { p[i].fresh = false; p[i].rpm = [null, 0, 0, 0]; } } });
  const m = computeSweepMetrics(sw);
  const whole = computeSweepMetrics(mkSweep(0));
  assert.ok(m.plateauUsableSamples < whole.plateauUsableSamples, 'the stale stretch is not used');
  assert.ok(m.plateauMissingSamples >= 10, 'the stale samples are counted as missing');
  // too few contiguous samples: no plateau statistics at all, and the reason is listed
  const bad = computeSweepMetrics(mkSweep(0, { mutate: (S) => { S.filter((s) => s.phase === 'plateau').forEach((s, i) => { if (i % 4 !== 0) { s.fresh = false; s.rpm = [null, 0, 0, 0]; } }); } }));
  assert.equal(bad.plateauRpm.median, null); assert.ok(bad.unavailable.some((u) => /plateau-rpm/.test(u)));
  // a gap larger than the limit splits the window (never resampled)
  const split = computeSweepMetrics(mkSweep(0, { mutate: (S) => { const p = S.filter((s) => s.phase === 'plateau'); for (let i = 25; i < p.length; i++) p[i].t += 500; } }));
  assert.ok(split.plateauUsableSamples < whole.plateauUsableSamples);
  // no stable rotation: the sweep never reached the plateau
  const none = computeSweepMetrics(mkSweep(0, { noPlateau: true, ended: 'incomplete', reason: 'no-stable-rotation-by-cap', mutate: (S) => S.forEach((s) => { s.rpm[0] = 0; }) }));
  assert.equal(none.startThreshold, null); assert.equal(none.startThresholdConfirmed, false); assert.equal(none.plateauCommand, null); assert.ok(none.unavailable.some((u) => /start-threshold/.test(u)));
  // rotation that did not last the validation window is not a confirmed threshold
  const brief = computeSweepMetrics(mkSweep(0, { mutate: (S) => { S.filter((s) => s.phase === 'validate').forEach((s, i) => { if (i > 5) s.rpm[0] = 0; }); } }));
  assert.equal(brief.startThresholdConfirmed, false);
  pass('metrics: stale and gapped samples are excluded and counted; short windows give no statistics; no rotation gives no threshold; nothing is resampled');
}
{
  // DShot: usable, unavailable, excessive
  const dsh = (fn) => computeSweepMetrics(mkSweep(0, { mutate: (S) => S.forEach((s, i) => { s.inv = fn(i); }) })).dshot;
  assert.equal(dsh(() => [20, 0, 0, 0]).motor.maxPct, 0.2);
  const none = dsh(() => [null, null, null, null]); assert.equal(none.motor.maxPct, null); assert.equal(none.motor.usableSamples, 0);
  const exc = dsh((i) => [i % 2 ? 150 : 10, 0, 0, 0]); assert.equal(exc.motor.maxPct, 1.5); assert.ok(exc.motor.excessiveFraction >= 0.4);
  // voltage and temperature observations
  const vt = computeSweepMetrics(mkSweep(0, { voltageBefore: 1500, mutate: (S) => S.forEach((s, i) => { s.v_cV = i === 40 ? 1420 : 1480; s.vAt = i === 40 ? 9999 : 5; s.temp = [i === 30 ? 61 : null, null, 70, null]; }) }));
  assert.equal(vt.voltage.before_V, 15); assert.equal(vt.voltage.min_V, 14.2); assert.equal(vt.voltage.drop_V, 0.8);
  assert.equal(vt.voltage.reads, 2, 'a slowly read value is counted once per read, not once per frame');
  assert.equal(vt.temperature.selectedMaxC, 61); assert.equal(vt.temperature.anyMaxC, 70);
  assert.match(vt.voltage.label, /not a battery/i);
  const nov = computeSweepMetrics(mkSweep(0, { voltageBefore: null, mutate: (S) => S.forEach((s) => { s.v_cV = null; }) }));
  assert.equal(nov.voltage.drop_V, null); assert.ok(nov.unavailable.some((u) => /voltage/.test(u)));
  // read-back mismatch, peer rotation and armed samples as evidence
  const rb = computeSweepMetrics(mkSweep(0, { mutate: (S) => { S[10].rb = [1000, 1000, 1000, 1000]; S[10].rbCurrent = true; S[10].cmds = [1050, 1000, 1000, 1000]; } }));
  assert.equal(rb.readbackMismatchSamples, 1);
  const stale = computeSweepMetrics(mkSweep(0, { mutate: (S) => { S[10].rb = [1000, 1000, 1000, 1000]; S[10].rbCurrent = false; S[10].cmds = [1050, 1000, 1000, 1000]; } }));
  assert.equal(stale.readbackMismatchSamples, 0, 'a read-back older than the last command is not a mismatch');
  assert.equal(computeSweepMetrics(mkSweep(0, { mutate: (S) => { S[12].rpm[2] = 300; } })).peerRotationSamples, 1);
  assert.equal(computeSweepMetrics(mkSweep(0, { mutate: (S) => { S[12].armed = true; } })).armedSamples, 1);
  pass('metrics: DShot usable/unavailable/excessive, voltage drop (per read), temperature, read-back mismatch (current reads only), peer rotation and arming evidence');
}
{
  // missing optional fields: nothing throws, everything optional is unavailable
  const sw = mkSweep(0, { mutate: (S) => S.forEach((s) => { s.temp = null; s.inv = null; s.v_cV = null; s.vAt = null; s.rb = null; s.cmds = null; s.armed = null; }) });
  const m = computeSweepMetrics(sw);
  assert.equal(m.dshot.motor.maxPct, null); assert.equal(m.temperature.selectedMaxC, null); assert.equal(m.voltage.min_V, null);
  assert.equal(m.plateauRpm.median, 1800, 'the required measurement (RPM) is unaffected by missing optional fields');
  const empty = computeSweepMetrics({ motor: 0, samples: [], gaps: [], unavailable: [], status: 'incomplete', meta: {}, end: null });
  assert.equal(empty.sampleCount, 0); assert.equal(empty.startThreshold, null);
  pass('metrics: missing optional fields and empty sweeps are handled without a result being invented');
}

// ================= result categories and wording
{
  const completed = buildBenchResult(four({ 0: { threshold: 1030 }, 1: { threshold: 1030 }, 2: { threshold: 1030 }, 3: { threshold: 1030 } }));
  assert.equal(completed.category, CATEGORY.COMPLETED);
  assert.equal(completed.headline, 'Completed — no issue observed in the live checks');
  assert.equal(completed.completedCount, 4);
  assert.ok(completed.motors.every((m) => m.status === 'completed'));
  assert.deepEqual(completed.range, { startCommand: 1020, capCommand: 1100, step: 5, stopCommand: 1000, note: 'External motor values; 1000 is stop.' });
  assert.match(completed.reminder, /propeller-free/);
  assert.equal(completed.comparison.sharedCommand, 1045, 'identical sweeps are compared at a shared command');
  pass('result: four identical complete sweeps give "Completed — no issue observed in the live checks"');

  const diff = buildBenchResult(four({ 0: { threshold: 1030 }, 1: { threshold: 1030 }, 2: { threshold: 1030 }, 3: { threshold: 1060 } }));
  assert.equal(diff.category, CATEGORY.DIFFERENCE); assert.equal(diff.headline, 'Difference observed — inspect and monitor');
  assert.equal(diff.motors[3].status, 'difference'); assert.ok(diff.reasons.some((r) => /start threshold 1060/.test(r.text)));
  assert.ok(diff.reasons.every((r) => /provisional/.test(r.text)), 'every difference states that its limit is provisional');
  assert.notEqual(diff.category, CATEGORY.INSPECT, 'a peer outlier alone never produces Inspection recommended');
  pass('result: a start-threshold outlier is "Difference observed", labelled provisional, and never "Inspection recommended"');

  // RPM at a shared command: one motor responds with much lower RPM at the same command
  const rpmDiff = buildBenchResult(four({ 2: { perUnit: 20 } }));
  assert.equal(rpmDiff.category, CATEGORY.DIFFERENCE);
  assert.ok(rpmDiff.comparison.differences.some((d) => d.kind === 'rpm-at-shared-command' && d.motor === 2));
  // raw RPM at different commands is not compared as if equivalent
  const sepa = buildBenchResult(four({ 0: { threshold: 1030 }, 1: { threshold: 1040 }, 2: { threshold: 1050 }, 3: { threshold: 1070 } }));
  assert.ok(!sepa.comparison.differences.some((d) => d.kind === 'rpm-at-shared-command'), 'plateau RPM measured at different commands is not compared');
  assert.ok(sepa.motors.every((m) => m.metrics.plateauRpm.median !== null), 'each motor still shows its own plateau command and RPM');
  assert.equal(sepa.comparison.classified, true);
  // not enough motors: measurements shown, nothing classified
  const two = buildBenchResult([mkSweep(0), mkSweep(1)]);
  assert.equal(two.comparison.classified, false); assert.match(two.comparison.reason, /no comparison is made/);
  assert.equal(two.category, CATEGORY.INCOMPLETE);
  assert.ok(two.motors[0].metrics && two.motors[1].metrics && two.motors[2].status === 'not-run');
  pass('result: RPM is compared only at a shared command level; otherwise the values are shown separately; fewer than three motors are not classified');
}
{
  const reasonCases = {
    'no-stable-rotation-by-cap': [CATEGORY.INSPECT, /stable rotation/],
    'motor-position-mismatch': [CATEGORY.INSPECT, /other than the expected/],
    'peer-motor-rpm': [CATEGORY.INSPECT, /not being tested reported rotation/],
    'dshot-errors-excessive': [CATEGORY.INSPECT, /DShot error/],
    'telemetry-stale-or-unavailable': [CATEGORY.INSPECT, /telemetry became unavailable/],
    'readback-mismatch': [CATEGORY.INSPECT, /read-back/],
    'arming-state-changed': [CATEGORY.INSPECT, /armed/],
    'temperature-fault': [CATEGORY.INSPECT, /temperature/],
    'voltage-fault': [CATEGORY.INSPECT, /voltage/],
    'stop-proof-incomplete': [CATEGORY.INSPECT, /stop proof could not be completed/],
    'user-stop': [CATEGORY.INCOMPLETE, /user-stop/],
    'transport-lost': [CATEGORY.INCOMPLETE, /transport-lost/],
    'reconnect-grace-expired': [CATEGORY.INCOMPLETE, /did not complete/],
    'something-unknown': [CATEGORY.INCOMPLETE, /something-unknown/],
  };
  for (const [reason, [cat, re]] of Object.entries(reasonCases)) {
    const sw = [mkSweep(0, { ended: 'incomplete', reason, noPlateau: true }), mkSweep(1), mkSweep(2), mkSweep(3)];
    const r = buildBenchResult(sw);
    assert.equal(r.category, cat, reason);
    assert.ok(r.reasons.some((x) => re.test(x.text)), `${reason}: the exact observed reason is stated (${JSON.stringify(r.reasons)})`);
  }
  // a completed sweep whose stop proof is not recorded, or whose confirmed position differs, is direct evidence
  assert.equal(buildBenchResult([mkSweep(0, { stopProof: false }), mkSweep(1), mkSweep(2), mkSweep(3)]).category, CATEGORY.INSPECT);
  assert.equal(buildBenchResult([mkSweep(0, { position: 'front left' }), mkSweep(1), mkSweep(2), mkSweep(3)]).category, CATEGORY.INSPECT);
  // an unexpected peer rotation in the samples alone, or persistent DShot errors in the samples alone
  assert.equal(buildBenchResult(four({ 1: { mutate: (S) => { S[12].rpm[0] = 200; } } })).category, CATEGORY.INSPECT);
  assert.equal(buildBenchResult(four({ 1: { mutate: (S) => S.forEach((s) => { s.inv = [0, 200, 0, 0]; }) } })).category, CATEGORY.INSPECT);
  // direct evidence wins over a missing motor, and the missing motor is still mentioned
  const mixed = buildBenchResult([mkSweep(0, { ended: 'incomplete', reason: 'no-stable-rotation-by-cap', noPlateau: true })]);
  assert.equal(mixed.category, CATEGORY.INSPECT); assert.ok(mixed.notes.some((n) => /not fully measured/.test(n)));
  // no sweeps at all, a cancelled run, a motor missing
  assert.equal(buildBenchResult([]).category, CATEGORY.INCOMPLETE);
  assert.equal(buildBenchResult([mkSweep(0), mkSweep(1), mkSweep(2)]).category, CATEGORY.INCOMPLETE);
  // a later cancelled attempt never hides a completed one; a completed retry replaces a failed attempt
  const keep = buildBenchResult([...four(), mkSweep(1, { ended: 'incomplete', reason: 'user-stop', noPlateau: true })]);
  assert.equal(keep.category, CATEGORY.COMPLETED);
  const retry = buildBenchResult([mkSweep(0, { ended: 'incomplete', reason: 'user-stop', noPlateau: true }), ...four()]);
  assert.equal(retry.category, CATEGORY.COMPLETED);
  // a truncated buffer is not a normal result
  assert.equal(buildBenchResult(four({ 2: { mutate: null } }).map((s, i) => (i === 2 ? { ...s, truncated: true } : s))).category, CATEGORY.INCOMPLETE);
  pass('result: every hard fault maps to "Inspection recommended" with its exact reason; cancelled, interrupted, unknown and truncated evidence is "Test incomplete"');
}
{
  // wording: no safe / healthy / airworthy / passed claim except in the single disclaimer that denies them
  const BANNED = /safe to fly|safe\b|healthy|airworth|certif|pre-?flight|passed|\bpass\b|fault-free|guarantee/i;
  const results = [buildBenchResult(four()), buildBenchResult(four({ 3: { threshold: 1060 } })), buildBenchResult([mkSweep(0, { ended: 'incomplete', reason: 'no-stable-rotation-by-cap', noPlateau: true })]), buildBenchResult([])];
  for (const r of results) {
    const copy = JSON.parse(JSON.stringify(r)); delete copy.disclaimer;
    for (const s of strings(copy)) assert.ok(!BANNED.test(s), `a result string makes a banned claim: ${s}`);
    assert.equal(r.disclaimer, DISCLAIMER);
  }
  for (const t of Object.values(CATEGORY_TEXT)) for (const s of Object.values(t)) assert.ok(!BANNED.test(s), s);
  assert.equal(Object.keys(CATEGORY).length, 4, 'exactly four categories: no separate safe, healthy, passed or airworthy state');
  assert.deepEqual(Object.values(CATEGORY).sort(), ['completed-no-issue', 'difference-observed', 'inspection-recommended', 'test-incomplete']);
  assert.match(DISCLAIMER, /does not mean/); assert.match(DISCLAIMER, /motor direction/); assert.match(DISCLAIMER, /subtle vibration/);
  assert.ok(PEER_COMPARISON.provisional === true);
  pass('result wording: four categories only; no "safe", "healthy", "passed pre-flight" or "airworthy" outside the one disclaimer that states what the result does not mean');
}

// ================= history record, evidence export, local store
const IDENT = { variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'SYNTH', boardId: 'SYN1', escFamily: 'Bluejay', escModel: 'synthetic', motorProtocol: 'DSHOT600', uidHex: '0123456789abcdef01234567' };
{
  const sweeps = four();
  const result = buildBenchResult(sweeps);
  const rec = buildHistoryRecord({ result, identity: IDENT, now: Date.UTC(2026, 10, 17, 3, 0, 0) });
  assert.equal(rec.schemaVersion, 1); assert.equal(rec.analysisSchemaVersion, ANALYSIS_SCHEMA_VERSION); assert.equal(rec.date, '2026-11-17'); assert.equal(rec.samplesRetained, false);
  assert.equal(rec.firmware.firmware, '2025.12.5'); assert.equal(rec.firmware.escFamily, 'Bluejay'); assert.equal(rec.association.kind, 'fc-esc-identity');
  assert.equal(rec.constants.motor.cap, MOTOR.cap); assert.equal(rec.constants.peerComparison.provisional, true); assert.ok(rec.constants.metricRules.gapMs);
  assert.equal(rec.motors.length, 4); assert.ok(rec.motors[0].metrics.plateauRpm);
  assert.ok(!JSON.stringify(rec).includes('"samples"'), 'a derived record carries no live samples');
  assert.ok(!JSON.stringify(rec).includes(IDENT.uidHex), 'a derived record has no UID');
  const ev = buildEvidenceExport({ sweeps, result, identity: IDENT, now: 0 });
  const text = JSON.stringify(ev);
  assert.ok(!text.includes(IDENT.uidHex) && !/uid/i.test(Object.keys(ev.identity).join()), 'the export never includes the flight-controller UID');
  assert.equal(ev.format, 'uav-companion.motor-bench-evidence'); assert.equal(ev.schemaVersion, ANALYSIS_SCHEMA_VERSION);
  assert.equal(ev.constants.motor.cap, MOTOR.cap); assert.ok(ev.constants.sampleLimits); assert.ok(ev.units.cmd);
  assert.equal(ev.sweeps.length, 4); assert.ok(ev.sweeps[0].samples.length > 50); assert.equal(ev.sweeps[0].complete, true);
  assert.equal('uidHex' in identityForRecord(IDENT), false);
  const incomplete = buildEvidenceExport({ sweeps: [mkSweep(0, { ended: 'incomplete', reason: 'user-stop' })], result: buildBenchResult([]), identity: IDENT });
  assert.equal(incomplete.sweeps[0].complete, false, 'an incomplete sweep is identifiable as incomplete in the export');
  pass('export: schema version, constants and units are included; the UID is excluded; incomplete sweeps are flagged; a derived record holds no samples');

  // local store
  const st = memoryStorage();
  assert.deepEqual(store.listRecords(st), { available: true, records: [], corrupt: false });
  assert.equal(store.approxSize(st).totalBytes, 0);
  let r = store.saveRecord(rec, null, st);
  assert.equal(r.ok, true);
  assert.equal(st.getItem(store.SAMPLES_KEY), null, 'live-sample retention is off by default');
  assert.equal(store.listRecords(st).records.length, 1);
  const size1 = store.approxSize(st); assert.ok(size1.recordBytes > 500 && size1.sampleBytes === 0 && size1.records === 1);
  const rec2 = buildHistoryRecord({ result, identity: IDENT, now: 1000, id: 'second', samplesRetained: true });
  r = store.saveRecord(rec2, ev, st); assert.equal(r.ok, true);
  assert.ok(store.approxSize(st).sampleBytes > 10000); assert.equal(store.loadSampleSet('second', st).format, 'uav-companion.motor-bench-evidence');
  // bounds: records and sample sets
  for (let i = 0; i < 30; i++) store.saveRecord(buildHistoryRecord({ result, identity: IDENT, now: 5000 + i, id: 'b' + i, samplesRetained: true }), { format: 'x', n: i }, st);
  assert.ok(store.listRecords(st).records.length <= store.LIMITS.maxRecords);
  assert.ok(Object.keys(JSON.parse(st.getItem(store.SAMPLES_KEY)).sets).length <= store.LIMITS.maxSampleSets);
  assert.equal(store.loadSampleSet('b29', st).n, 29, 'the newest sample set is the one kept');
  // deletion: both keys, confirmed
  assert.equal(store.deleteAll(st), true); assert.equal(st.getItem(store.RECORDS_KEY), null); assert.equal(st.getItem(store.SAMPLES_KEY), null); assert.equal(store.approxSize(st).totalBytes, 0);
  assert.equal(store.deleteAll(memoryStorage({ ignoreRemove: true })), true, 'nothing stored: nothing to delete');
  const stuck = memoryStorage({ ignoreRemove: true }); store.saveRecord(rec, null, stuck); assert.equal(store.deleteAll(stuck), false, 'a deletion that did not happen is reported as such');
  assert.equal(store.deleteAll(memoryStorage({ failRemove: true })), false);
  // failures: never throw
  assert.equal(store.saveRecord(rec, null, memoryStorage({ failWrite: true })).ok, false);
  assert.equal(store.saveRecord(rec, null, memoryStorage({ corruptWrite: true })).ok, false, 'a write that does not read back is a failure');
  assert.equal(store.saveRecord({ id: 'x' }, null, memoryStorage()).ok, false, 'an invalid record is refused');
  assert.equal(store.listRecords(memoryStorage({ failRead: true })).available, false);
  assert.equal(store.saveRecord(rec, { big: 'x'.repeat(store.LIMITS.maxBytes) }, memoryStorage()).ok, false, 'an oversized sample set is refused and no record is written');
  assert.equal(store.listRecords(st).records.length, 0);
  // compatibility: stored data is untrusted; unknown versions and junk are ignored, never trusted, never crash
  const junk = memoryStorage(); junk.setItem(store.RECORDS_KEY, '{not json'); assert.deepEqual(store.listRecords(junk), { available: true, records: [], corrupt: true });
  junk.setItem(store.RECORDS_KEY, JSON.stringify({ v: 99, records: [rec] })); assert.equal(store.listRecords(junk).corrupt, true);
  junk.setItem(store.RECORDS_KEY, JSON.stringify({ v: 1, records: [rec, { id: 5 }, null, 'x', { ...rec, schemaVersion: 2 }] })); assert.equal(store.listRecords(junk).records.length, 1, 'only well-formed v1 records are kept');
  assert.equal(store.deleteAll(junk), true, 'unreadable data can still be deleted');
  assert.ok(store.RECORDS_KEY.startsWith('uavzones.') && store.SAMPLES_KEY.startsWith('uavzones.') && store.RECORDS_KEY.endsWith('.v1'));
  pass('local store: derived records only by default; samples only on request; bounded; confirmed deletion of both keys; failures reported; junk and unknown versions never trusted');
}

// ---- isolation: the store is reached only through its own module; export, sharing and sync never touch it
{
  const fsx = await import('node:fs'), pathx = await import('node:path');
  const walk = (d) => fsx.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(pathx.join(d, e.name)) : [pathx.join(d, e.name)]));
  const files = walk('src').filter((f) => f.endsWith('.js')).map((f) => [f.split('\\').join('/'), fsx.readFileSync(f, 'utf8')]);
  assert.deepEqual(files.filter(([, t]) => /aircraftdiag/.test(t)).map(([f]) => f), ['src/aircraft-diag-data.js'], 'only the store module knows the keys');
  assert.deepEqual(files.filter(([, t]) => /from '[^']*aircraft-diag-data/.test(t)).map(([f]) => f).sort(), ['src/benchtest/controller.js', 'src/privacy-ui.js'], 'only the bench controller and the Privacy panel import the store');
  assert.ok(!/^import /m.test(files.find(([f]) => f === 'src/aircraft-diag-data.js')[1]), 'the store imports nothing, so no motor code reaches the main bundle through it');
  pass('isolation: the aircraft diagnostic store is reachable only from the bench controller and the Privacy panel; no export, sharing or sync file references it');
}

console.log('ALL OK');
