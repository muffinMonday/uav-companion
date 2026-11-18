// Motor bench test: the combined four-motor confirmation (pure functions: eligibility, sample recorder, summary, storage whitelist).
// It runs after the four individual sweeps, never above the same external cap (constants.js MOTOR.cap), and is observational like the
// rest of the analysis: it never names a faulty motor, ESC or battery. The state machine owns every safety decision about the run; this
// module only decides whether the OFFER is shown (eligibility) and how a finished or aborted run is described.
import { METRIC_RULES, PEER_COMPARISON } from './analysis-constants.js';
import { BENCH_TIMINGS, DSHOT_STATS, EXPECTED_POSITIONS, MOTOR } from './constants.js';

export const COMBINED_SCHEMA_VERSION = 1;
export const COMBINED_TITLE = 'Combined motor confirmation';
export const COMBINED_LOCKED_TEXT = 'Available after all four individual motor checks complete without anomalies.';
export const COMBINED_ANOMALY_TEXT = 'All motors passed individually, but their behaviour differed when operated together.';
export const COMBINED_NOT_REPORTED = 'Not reported by this ESC';
const MAX_SAMPLES = 1500;

// Reasons for which an abort is a direct observation about the motors together (inspection recommended). Everything else is incomplete.
const HARD = Object.freeze({
  'combined-motor-stopped': 'A motor stopped turning while all four were running.',
  'combined-not-rotating': 'Not every motor was turning once all four had reached the same command.',
  'dshot-errors-excessive': 'DShot error statistics reached the provisional limit while all four ran.',
  'dshot-statistics-unavailable': 'DShot error statistics became unavailable while all four ran.',
  'temperature-fault': 'An ESC reported a temperature at or above the fault limit.',
  'voltage-fault': 'The battery voltage dropped by more than the fault limit.',
  'rpm-above-plausibility-ceiling': 'A motor reported an RPM above the plausibility ceiling.',
  'readback-mismatch': 'The flight controller motor read-back did not match the command.',
});

// ---- eligibility for the offer. `result` is buildBenchResult output (or null). The machine independently refuses to start unless every
// interlock holds, so a wrong answer here can only hide the button, never run the motors.
export function combinedEligibility({ result, completedMotors, alreadyRan = false } = {}) {
  const why = [];
  const done = new Set(Array.isArray(completedMotors) ? completedMotors : []);
  if (alreadyRan) why.push('The combined confirmation has already been run in this session.');
  if (![0, 1, 2, 3].every((m) => done.has(m))) why.push('All four individual motor checks must be completed first.');
  if (!result || !Array.isArray(result.motors)) why.push('There is no individual result yet.');
  else {
    for (const m of result.motors) {
      const x = m.metrics;
      const name = `Motor ${m.motor + 1}`;
      // a start-threshold difference alone is not an RPM or DShot anomaly; an RPM or DShot peer difference is
      const blocking = m.status === 'difference' ? (result.comparison && Array.isArray(result.comparison.differences) ? result.comparison.differences.filter((d) => d.motor === m.motor && d.kind !== 'start-threshold') : [{ kind: 'unknown' }]) : [];
      const startOnly = m.status === 'difference' && !blocking.length; // eligible so far: only the start threshold differs
      if (m.status !== 'completed' && !startOnly) why.push(`${name}: ${m.status === 'inspect' ? 'inspection recommended' : m.status === 'difference' ? 'an RPM or DShot difference from its peers was observed' : m.status === 'not-run' ? 'not tested' : 'the check is incomplete'}.`);
      else if (!x || x.stopProofComplete !== true || x.startThresholdConfirmed !== true || x.plateauRpm.median === null || x.positionMatches !== true || x.faultReason) why.push(`${name}: the individual result is not complete.`);
    }
  }
  return { ok: why.length === 0, reasons: why };
}

// ---- recorder: one sample per fresh telemetry frame while the combined run is active (bounded; the overflow is flagged, never silent)
export function createCombinedRecorder() {
  let samples = [], dropped = 0, startedAt = null, lastTelAt = null, plateauAt = null, voltageBefore = null;
  return {
    begin({ at, voltageBefore_cV }) { samples = []; dropped = 0; startedAt = at; lastTelAt = null; plateauAt = null; voltageBefore = Number.isFinite(voltageBefore_cV) && voltageBefore_cV > 0 ? voltageBefore_cV : null; },
    active() { return startedAt !== null; },
    sample({ at, phase, cmd, telemetry, telemetryAt, voltage_cV }) {
      if (startedAt === null || !telemetry || !Number.isFinite(telemetryAt) || telemetryAt === lastTelAt) return;
      lastTelAt = telemetryAt;
      if (phase === 'plateau' && plateauAt === null) plateauAt = at - startedAt;
      if (samples.length >= MAX_SAMPLES) { dropped++; return; }
      const m = telemetry.motors || [];
      samples.push({ t: at - startedAt, phase, cmd, rpm: m.map((x) => x.rpm), inv: m.map((x) => x.invalidPct_centi), temp: m.map((x) => x.temperatureC), v_cV: Number.isFinite(voltage_cV) ? voltage_cV : null });
    },
    snapshot() { return { samples: samples.slice(), dropped, plateauAt, voltageBefore_cV: voltageBefore }; },
    clear() { samples = []; dropped = 0; startedAt = null; lastTelAt = null; plateauAt = null; voltageBefore = null; },
  };
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

// rec: recorder.snapshot(); end: { completed: boolean, reason: string|null }; stopProofComplete: true|false|null. Returns the stored/shown result.
export function summarizeCombined({ rec, end, stopProofComplete = null, targetCommand = null }) {
  const reasons = [];
  const plateau = rec.samples.filter((s) => s.phase === 'plateau' && rec.plateauAt !== null && s.t - rec.plateauAt >= METRIC_RULES.plateauSettleMs);
  const usable = plateau.filter((s) => s.rpm.length === MOTOR.enabledMotors && s.rpm.every((r) => Number.isFinite(r) && r > 0));
  let missing = 0;
  for (let i = 1; i < plateau.length; i++) { const gap = plateau[i].t - plateau[i - 1].t; if (gap > METRIC_RULES.gapMs) missing += Math.max(0, Math.round(gap / BENCH_TIMINGS.telemetryPollMs) - 1); }
  const motors = [0, 1, 2, 3].map((k) => {
    const rpms = usable.map((s) => s.rpm[k]);
    const invs = rec.samples.filter((s) => Number.isFinite(s.inv[k]) && s.inv[k] < DSHOT_STATS.unavailableSentinel_centi).map((s) => s.inv[k]);
    const temps = rec.samples.map((s) => s.temp[k]).filter((t) => Number.isFinite(t) && t > 0);
    return {
      motor: k, position: EXPECTED_POSITIONS[k], medianRpm: median(rpms), usableSamples: rpms.length,
      maxDshotInvalidPct: invs.length ? round(Math.max(...invs) / 100) : null,
      excessiveFraction: invs.length ? invs.filter((v) => v >= DSHOT_STATS.excessiveErrors_centi).length / invs.length : null,
      maxTempC: temps.length ? Math.max(...temps) : null, // null = not reported (never 0)
    };
  });
  // RPM peer difference: each motor against the median of the other three; the largest relative difference is the headline number
  let peerDiff = null;
  if (motors.every((m) => m.medianRpm !== null)) {
    peerDiff = Math.max(...motors.map((m) => { const o = median(motors.filter((x) => x !== m).map((x) => x.medianRpm)); return o ? Math.abs(m.medianRpm - o) / o : 0; }));
  }
  const volts = rec.samples.map((s) => s.v_cV).filter((v) => Number.isFinite(v) && v > 0);
  const minV = volts.length ? Math.min(...volts) : null;
  const before = rec.voltageBefore_cV;
  const voltage = { before_V: before === null ? null : round(before / 100), min_V: minV === null ? null : round(minV / 100), drop_V: before !== null && minV !== null ? round(Math.max(0, before - minV) / 100) : null };

  let status; let anomaly = false;
  if (!end.completed) {
    if (end.reason && HARD[end.reason]) { status = 'inspection-recommended'; anomaly = true; reasons.push(HARD[end.reason]); }
    else { status = 'incomplete'; reasons.push(`The combined run stopped before it finished${end.reason ? ` (${String(end.reason).slice(0, 60)})` : ''}.`); }
  } else {
    if (usable.length < METRIC_RULES.minPlateauSamples) { status = 'incomplete'; reasons.push('Too few fresh samples were collected at the common command to compare the motors.'); }
    else {
      if (peerDiff !== null && peerDiff >= PEER_COMPARISON.rpmRelativeDifference) { anomaly = true; reasons.push(`RPM differed between motors by ${(peerDiff * 100).toFixed(0)} % at the same command (provisional limit ${Math.round(PEER_COMPARISON.rpmRelativeDifference * 100)} %).`); }
      for (const m of motors) if (m.excessiveFraction !== null && m.excessiveFraction >= METRIC_RULES.dshotExcessiveFractionPersistent) { anomaly = true; reasons.push(`Motor ${m.motor + 1}: DShot errors stayed at or above the provisional limit.`); }
      if (stopProofComplete !== true) { anomaly = true; reasons.push('The stop proof could not be completed.'); }
      status = anomaly ? 'inspection-recommended' : 'completed';
    }
  }
  const headline = status === 'completed' ? 'Combined confirmation completed — no difference observed' : status === 'inspection-recommended' ? 'Inspection recommended' : 'Combined confirmation incomplete';
  const summary = anomaly ? COMBINED_ANOMALY_TEXT : status === 'completed' ? 'All four motors ran together at one low command. No difference between them was observed in the live checks.' : 'The combined run did not produce enough evidence to compare the motors.';
  return {
    schemaVersion: COMBINED_SCHEMA_VERSION, status, headline, summary, reasons, targetCommand, capCommand: MOTOR.cap, motors,
    rpmPeerDifferencePct: peerDiff === null ? null : round(peerDiff * 100, 1), dshotInvalidPctMax: (() => { const v = motors.map((m) => m.maxDshotInvalidPct).filter((x) => x !== null); return v.length ? Math.max(...v) : null; })(),
    usableSamples: usable.length, missingSamples: missing, droppedSamples: rec.dropped, voltage, stopProofComplete: stopProofComplete === true ? true : stopProofComplete === false ? false : null,
    note: 'Voltage change is a bench-load observation, not a battery assessment. This test does not point to a specific motor, ESC or battery.',
  };
}

const n0 = (v) => (Number.isFinite(v) ? v : null);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').slice(0, n) : '');
export function sanitizeCombined(x) {
  try {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    if (!['completed', 'inspection-recommended', 'incomplete'].includes(x.status)) return null;
    const v = x.voltage && typeof x.voltage === 'object' ? x.voltage : {};
    return {
      schemaVersion: COMBINED_SCHEMA_VERSION, status: x.status, headline: clip(x.headline, 100), summary: clip(x.summary, 240),
      reasons: (Array.isArray(x.reasons) ? x.reasons : []).filter((r) => typeof r === 'string').slice(0, 8).map((r) => clip(r, 200)),
      targetCommand: n0(x.targetCommand), capCommand: MOTOR.cap,
      motors: (Array.isArray(x.motors) ? x.motors : []).slice(0, 4).map((m, i) => ({ motor: i, position: EXPECTED_POSITIONS[i], medianRpm: n0(m && m.medianRpm), usableSamples: n0(m && m.usableSamples), maxDshotInvalidPct: n0(m && m.maxDshotInvalidPct), excessiveFraction: n0(m && m.excessiveFraction), maxTempC: n0(m && m.maxTempC) })),
      rpmPeerDifferencePct: n0(x.rpmPeerDifferencePct), dshotInvalidPctMax: n0(x.dshotInvalidPctMax), usableSamples: n0(x.usableSamples), missingSamples: n0(x.missingSamples), droppedSamples: n0(x.droppedSamples),
      voltage: { before_V: n0(v.before_V), min_V: n0(v.min_V), drop_V: n0(v.drop_V) }, stopProofComplete: x.stopProofComplete === true ? true : x.stopProofComplete === false ? false : null,
      note: clip(x.note, 200),
    };
  } catch { return null; }
}
