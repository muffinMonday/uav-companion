// Motor bench test: the combined observational result (live MSP/DShot analysis layer). Pure functions.
//
// This is a statement of what the app directly observed during a low-output, propeller-free sweep. It is NOT a health
// certification: there is no "safe", "healthy", "passed" or "airworthy" state and no category may be read that way. Peer
// differences are observational comparisons using PROVISIONAL thresholds (analysis-constants.js); a peer difference alone never
// produces "Inspection recommended". Only direct evidence (a hard fault, no rotation by the cap, a wrong motor, ...) does.
//
// Categories, in priority order: inspection-recommended > incomplete > difference-observed > completed.
import { HARD_FAULT_REASONS, PEER_COMPARISON, ANALYSIS_SCHEMA_VERSION } from './analysis-constants.js';
import { DSHOT_STATS, EXPECTED_POSITIONS, MOTOR } from './constants.js';
import { METRIC_RULES } from './analysis-constants.js';
import { computeSweepMetrics } from './metrics.js';
import { COMBINED_ANOMALY_TEXT } from './combined.js';

export const CATEGORY = Object.freeze({
  COMPLETED: 'completed-no-issue',
  DIFFERENCE: 'difference-observed',
  INSPECT: 'inspection-recommended',
  INCOMPLETE: 'test-incomplete',
});

export const CATEGORY_TEXT = Object.freeze({
  [CATEGORY.COMPLETED]: { headline: 'Completed — no issue observed in the live checks', summary: 'All four sweeps and stop proofs were completed, and no hard failure and no telemetry failure was observed.' },
  [CATEGORY.DIFFERENCE]: { headline: 'Difference observed — inspect and monitor', summary: 'All four sweeps were completed. At least one motor differs from its peers in a measured value. The thresholds used are provisional, so this is an observation to look at, not a confirmed fault.' },
  [CATEGORY.INSPECT]: { headline: 'Inspection recommended', summary: 'Something was directly observed that calls for a physical inspection. The exact observation is listed below.' },
  [CATEGORY.INCOMPLETE]: { headline: 'Test incomplete', summary: 'The evidence is incomplete, so no conclusion is drawn about the motors that were not fully measured.' },
});

// The only place the limits of the statement are spelled out. Tests allow the words "safe to fly" and "healthy" ONLY here.
export const DISCLAIMER = 'This is a record of what UAV Companion observed during a low-output, propeller-free check using live flight-controller and bidirectional DShot data. It does not mean a motor is mechanically healthy, that a bell, shaft or bearing is fault-free, that the battery is healthy, or that the aircraft is safe to fly. It cannot show motor direction, and it cannot rule out subtle vibration faults.';
export const REMINDER = 'The test was propeller-free and used only a low output. Results at this output do not describe behaviour under flight load.';

const HARD_TEXT = HARD_FAULT_REASONS;
const positionOf = (motor) => EXPECTED_POSITIONS[motor] || `motor ${motor + 1}`;

// Latest attempt per motor: a completed sweep wins over a later incomplete one only if it is the latest completed.
function pickPerMotor(sweeps) {
  const by = new Map();
  for (const s of sweeps) {
    if (!Number.isInteger(s.motor) || s.status === 'collecting') continue;
    const prev = by.get(s.motor);
    if (!prev) { by.set(s.motor, s); continue; }
    if (s.status === 'completed' || prev.status !== 'completed') by.set(s.motor, s); // a later attempt replaces; a later incomplete never hides a completed one
  }
  return by;
}

function classifyMotor(sweep, metrics) {
  const hard = []; // direct evidence: calls for inspection
  const gaps = []; // reasons the evidence is incomplete
  const reason = sweep.end && sweep.end.reason;
  if (reason && HARD_TEXT[reason]) hard.push(HARD_TEXT[reason]);
  else if (reason && sweep.status !== 'completed') gaps.push(`The sweep did not complete (${reason}).`);
  if (sweep.status !== 'completed' && !reason) gaps.push('The sweep did not complete.');
  if (sweep.status === 'completed') {
    if (metrics.stopProofComplete !== true) hard.push('The stop proof could not be completed.');
    if (metrics.positionMatches === false) hard.push(HARD_TEXT['motor-position-mismatch']);
  }
  if (metrics.readbackMismatchSamples > 0) hard.push(HARD_TEXT['readback-mismatch']);
  if (metrics.peerRotationSamples > 0) hard.push(HARD_TEXT['peer-motor-rpm']);
  if (metrics.armedSamples > 0) hard.push(HARD_TEXT['arming-state-changed']);
  const exf = metrics.dshot.motor.excessiveFraction;
  if (exf !== null && exf >= METRIC_RULES.dshotExcessiveFractionPersistent) hard.push(HARD_TEXT['dshot-errors-excessive']);
  if (metrics.truncated) gaps.push('The sample buffer filled, so part of this sweep was not recorded.');
  if (sweep.status === 'completed') {
    if (!metrics.startThresholdConfirmed) gaps.push('The start threshold could not be confirmed from the samples.');
    if (metrics.plateauRpm.median === null) gaps.push('The plateau RPM could not be established from enough contiguous fresh samples.');
    if (metrics.dshot.motor.usableSamples === 0) gaps.push('No usable DShot error readings were available.');
  }
  const uniq = (a) => [...new Set(a)];
  const status = hard.length ? 'inspect' : sweep.status === 'completed' && !gaps.length ? 'completed' : 'incomplete';
  return { hard: uniq(hard), gaps: uniq(gaps), status };
}

// ---- peer comparison: observational, provisional, and only where the data supports it
function medianOf(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function compare(done) { // done: [{ motor, metrics }]
  const c = { provisional: true, classified: false, reason: '', rows: [], differences: [], sharedCommand: null };
  if (done.length < PEER_COMPARISON.minMotors) { c.reason = `Fewer than ${PEER_COMPARISON.minMotors} motors have a complete sweep, so no comparison is made. The measurements are shown without classification.`; return c; }
  c.classified = true;
  const peersOf = (motor, pick) => done.filter((d) => d.motor !== motor).map(pick).filter((v) => v !== null && v !== undefined);

  // start threshold (command units): shown for every motor, flagged when far from the peer median
  for (const d of done) {
    const peers = peersOf(d.motor, (x) => x.metrics.startThreshold);
    const med = medianOf(peers);
    if (d.metrics.startThreshold !== null && med !== null && Math.abs(d.metrics.startThreshold - med) >= PEER_COMPARISON.startThresholdDifference) {
      c.differences.push({ motor: d.motor, kind: 'start-threshold', text: `${positionOf(d.motor)}: start threshold ${d.metrics.startThreshold} against a peer median of ${med} (command units; provisional limit ${PEER_COMPARISON.startThresholdDifference}).` });
    }
  }
  // RPM at one shared command level: the highest level at which at least minMotors have valid samples
  const counts = new Map();
  for (const d of done) for (const k of Object.keys(d.metrics.rpmByCommand)) counts.set(Number(k), (counts.get(Number(k)) || 0) + 1);
  const shared = [...counts.entries()].filter(([, n]) => n >= PEER_COMPARISON.minMotors).map(([k]) => k).sort((a, b) => b - a)[0];
  if (shared !== undefined) {
    c.sharedCommand = shared;
    for (const d of done) {
      const mine = d.metrics.rpmByCommand[shared];
      const peers = done.filter((x) => x.motor !== d.motor && x.metrics.rpmByCommand[shared]).map((x) => x.metrics.rpmByCommand[shared].median);
      const med = medianOf(peers);
      if (mine && med) {
        const rel = Math.abs(mine.median - med) / med;
        if (rel >= PEER_COMPARISON.rpmRelativeDifference) c.differences.push({ motor: d.motor, kind: 'rpm-at-shared-command', text: `${positionOf(d.motor)}: ${mine.median} RPM against a peer median of ${med} RPM at command ${shared} (provisional limit ${Math.round(PEER_COMPARISON.rpmRelativeDifference * 100)} %).` });
      }
    }
  } else c.sharedNote = 'No command level has enough valid samples on three motors, so RPM is not compared between motors. Start threshold, plateau command and plateau RPM are shown separately.';
  // DShot error percentage: maximum per motor against the peers' median maximum
  for (const d of done) {
    const mine = d.metrics.dshot.motor.maxPct;
    const med = medianOf(peersOf(d.motor, (x) => x.metrics.dshot.motor.maxPct));
    if (mine !== null && med !== null && (mine - med) * 100 >= PEER_COMPARISON.dshotDifference_centi) {
      c.differences.push({ motor: d.motor, kind: 'dshot-errors', text: `${positionOf(d.motor)}: maximum DShot error ${mine.toFixed(2)} % against a peer median of ${med.toFixed(2)} % (provisional limit ${(PEER_COMPARISON.dshotDifference_centi / 100).toFixed(2)} percentage points).` });
    }
  }
  return c;
}

// sweeps: collector.sweeps(). opts.sessionNotes: strings about the session (for example a missing powered state).
export function buildBenchResult(sweepsIn, opts = {}) {
  const sweeps = Array.isArray(sweepsIn) ? sweepsIn : [];
  const picked = pickPerMotor(sweeps);
  const motors = [];
  for (let m = 0; m < MOTOR.enabledMotors; m++) {
    const sw = picked.get(m);
    if (!sw) { motors.push({ motor: m, position: positionOf(m), status: 'not-run', metrics: null, hard: [], gaps: ['This motor has not been tested.'] }); continue; }
    const metrics = computeSweepMetrics(sw);
    const cls = classifyMotor(sw, metrics);
    motors.push({ motor: m, position: positionOf(m), status: cls.status, ended: sw.status, metrics, hard: cls.hard, gaps: cls.gaps });
  }
  const complete = motors.filter((x) => x.status === 'completed');
  const allDone = complete.length;
  const comparison = compare(complete.map((x) => ({ motor: x.motor, metrics: x.metrics })));
  const hardAll = motors.flatMap((x) => x.hard.map((t) => ({ motor: x.motor, text: `${x.position}: ${t}` })));
  for (const d of comparison.differences) { const mo = motors[d.motor]; if (mo && mo.status === 'completed') mo.status = 'difference'; mo.differences = [...(mo.differences || []), d.text]; }
  const incompleteAll = motors.filter((x) => x.status === 'incomplete' || x.status === 'not-run').map((x) => ({ motor: x.motor, text: `${x.position}: ${x.gaps[0] || 'incomplete'}` }));
  let category;
  let reasons;
  if (hardAll.length) { category = CATEGORY.INSPECT; reasons = hardAll; }
  else if (incompleteAll.length) { category = CATEGORY.INCOMPLETE; reasons = incompleteAll; }
  else if (comparison.differences.length) { category = CATEGORY.DIFFERENCE; reasons = comparison.differences.map((d) => ({ motor: d.motor, text: d.text })); }
  else { category = CATEGORY.COMPLETED; reasons = []; }
  // the combined four-motor confirmation: an anomaly there is direct evidence too, but never names a motor, ESC or battery
  const cmb = opts.combined && typeof opts.combined === 'object' ? opts.combined : null;
  if (cmb && cmb.status === 'inspection-recommended' && (category === CATEGORY.COMPLETED || category === CATEGORY.DIFFERENCE)) { category = CATEGORY.INSPECT; reasons = [...reasons, { motor: null, text: `Combined motor confirmation: ${COMBINED_ANOMALY_TEXT}` }]; }
  else if (cmb && cmb.status === 'inspection-recommended') reasons = [...reasons, { motor: null, text: `Combined motor confirmation: ${COMBINED_ANOMALY_TEXT}` }];
  const notes = [];
  if (cmb && cmb.status === 'incomplete') notes.push('The combined motor confirmation did not finish, so it adds no evidence.');
  if (hardAll.length && incompleteAll.length) notes.push('Some motors were also not fully measured: ' + incompleteAll.map((x) => x.text).join(' '));
  if (!comparison.classified && complete.length) notes.push(comparison.reason);
  if (comparison.sharedNote) notes.push(comparison.sharedNote);
  for (const s of opts.sessionNotes || []) notes.push(s);
  const t = CATEGORY_TEXT[category];
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    category, headline: t.headline, summary: t.summary,
    reasons, notes, disclaimer: DISCLAIMER, reminder: REMINDER,
    range: { startCommand: MOTOR.startValue, capCommand: MOTOR.cap, step: MOTOR.step, stopCommand: MOTOR.stopValue, note: 'External motor values; 1000 is stop.' },
    dshotLimit_centi: DSHOT_STATS.excessiveErrors_centi,
    motors, comparison,
    completedCount: allDone,
  };
}
