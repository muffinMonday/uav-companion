// Motor bench test: per-sweep derived metrics (live MSP/DShot analysis layer). Pure functions over collected samples.
//
// Rules that keep missing data from becoming a normal-looking result:
//  - only FRESH samples count; a gap larger than METRIC_RULES.gapMs ends a contiguous window, it is never bridged;
//  - nothing is resampled, interpolated or carried forward (the voltage is read slowly, so it is de-duplicated by read time);
//  - every metric that cannot be established is null and the reason is listed in `unavailable`.
// Units: ms, external command units, RPM, centi-percent DShot errors (also given as percent), centivolts (also volts), degrees C.
import { METRIC_RULES } from './analysis-constants.js';
import { BENCH_TIMINGS, DSHOT_STATS, MOTOR } from './constants.js';

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// linear-interpolated percentile of a non-empty array, p in 0..100
const percentile = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), k = (p / 100) * (s.length - 1), lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
};
const mad = (a) => { const m = median(a); return m === null ? null : median(a.map((x) => Math.abs(x - m))); };
const round = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

// The longest run of samples that satisfy `ok`, with no gap larger than gapMs between neighbours. `samples` are in time order.
function longestContiguous(samples, ok, gapMs = METRIC_RULES.gapMs) {
  let best = [], cur = [];
  for (const s of samples) {
    if (!ok(s)) { if (cur.length > best.length) best = cur; cur = []; continue; }
    if (cur.length && s.t - cur[cur.length - 1].t > gapMs) { if (cur.length > best.length) best = cur; cur = []; }
    cur.push(s);
  }
  return cur.length > best.length ? cur : best;
}

const mode = (a) => { const c = new Map(); let best = null, n = 0; for (const v of a) { const k = (c.get(v) || 0) + 1; c.set(v, k); if (k > n) { n = k; best = v; } } return best; };

export function computeSweepMetrics(sweep) {
  const m = sweep.motor;
  const unavailable = [];
  const S = Array.isArray(sweep.samples) ? sweep.samples : [];
  const usable = (s) => s.fresh === true && Array.isArray(s.rpm) && Number.isFinite(s.rpm[m]);
  const out = {
    motor: m, sampleCount: S.length, truncated: sweep.truncated === true, droppedSamples: sweep.droppedSamples || 0,
    gapCount: Array.isArray(sweep.gaps) ? sweep.gaps.length : 0, unavailableEpisodes: Array.isArray(sweep.unavailable) ? sweep.unavailable.length : 0,
    startThreshold: null, startThresholdConfirmed: false, controllerThreshold: sweep.meta ? sweep.meta.controllerThreshold : null, thresholdAgreesWithController: null,
    timeToStableRotationMs: null,
    plateauCommand: null, plateauDurationMs: null, plateauSampleCount: 0, plateauUsableSamples: 0, plateauMissingSamples: null, plateauGapCount: 0,
    plateauRpm: { median: null, p10: null, p90: null, range: null, mad: null, min: null, max: null },
    rpmByCommand: {},
    dshot: { motor: { maxPct: null, medianPct: null, usableSamples: 0, unavailableSamples: 0, excessiveFraction: null }, anyMotorMaxPct: null },
    voltage: { before_V: null, min_V: null, drop_V: null, reads: 0, label: 'Bench-load observation with the propellers removed. Not a battery assessment.' },
    temperature: { selectedMaxC: null, anyMaxC: null },
    readbackMismatchSamples: 0, peerRotationSamples: 0, armedSamples: 0,
    stopProofComplete: sweep.end ? sweep.end.stopProofComplete : null,
    expectedPosition: sweep.meta ? sweep.meta.expectedPosition : null,
    reportedPosition: sweep.end ? sweep.end.reportedPosition : null,
    positionMatches: null,
    ended: sweep.status, faultReason: sweep.end ? sweep.end.reason : null, completed: sweep.status === 'completed',
    unavailable,
  };

  // ---- start threshold: the command at which rotation was confirmed for the validation window, from the samples
  const firstNonzero = S.find((s) => Number.isFinite(s.cmd) && s.cmd > MOTOR.stopValue);
  const plateau = S.filter((s) => s.phase === 'plateau');
  if (plateau.length) {
    const idx = S.indexOf(plateau[0]);
    const before = S.slice(0, idx).filter((s) => s.phase === 'validate' || s.phase === 'ramp');
    const lastBefore = before.length ? before[before.length - 1] : null;
    if (lastBefore && Number.isFinite(lastBefore.cmd)) {
      const level = lastBefore.cmd;
      const run = longestContiguous(before, (s) => s.cmd === level && usable(s) && s.rpm[m] > 0);
      const span = run.length ? run[run.length - 1].t - run[0].t : 0;
      if (span >= MOTOR.candidateValidationMs - METRIC_RULES.gapMs) {
        out.startThreshold = level; out.startThresholdConfirmed = true;
        if (firstNonzero) out.timeToStableRotationMs = Math.round(plateau[0].t - firstNonzero.t);
      } else unavailable.push('start-threshold: rotation was not seen continuously for the validation window');
    } else unavailable.push('start-threshold: no samples before the plateau');
  } else unavailable.push('start-threshold: the sweep did not reach the plateau');
  if (out.startThreshold !== null && Number.isFinite(out.controllerThreshold)) out.thresholdAgreesWithController = out.startThreshold === out.controllerThreshold;

  // ---- plateau
  if (plateau.length) {
    out.plateauCommand = mode(plateau.map((s) => s.cmd).filter(Number.isFinite));
    out.plateauDurationMs = Math.round(plateau[plateau.length - 1].t - plateau[0].t);
    out.plateauSampleCount = plateau.length;
    const t0 = plateau[0].t + METRIC_RULES.plateauSettleMs;
    const win = longestContiguous(plateau, (s) => s.t >= t0 && usable(s) && s.cmd === out.plateauCommand);
    out.plateauUsableSamples = win.length;
    out.plateauGapCount = (sweep.gaps || []).filter((g) => g.to > plateau[0].t && g.from < plateau[plateau.length - 1].t).length;
    out.plateauMissingSamples = plateau.length - win.length;
    if (win.length >= METRIC_RULES.minPlateauSamples) {
      const v = win.map((s) => s.rpm[m]);
      const p10 = percentile(v, 10), p90 = percentile(v, 90);
      out.plateauRpm = { median: round(median(v)), p10: round(p10), p90: round(p90), range: round(p90 - p10), mad: round(mad(v)), min: Math.min(...v), max: Math.max(...v) };
      out.plateauWindowMs = Math.round(win[win.length - 1].t - win[0].t);
    } else unavailable.push(`plateau-rpm: only ${win.length} usable contiguous samples (needs ${METRIC_RULES.minPlateauSamples})`);
  } else unavailable.push('plateau: not reached');

  // ---- RPM by command level (for comparing motors only at a shared command)
  const levels = new Map();
  for (const s of S) { if (s.phase === 'stop' || !Number.isFinite(s.cmd) || s.cmd <= MOTOR.stopValue) continue; if (!levels.has(s.cmd)) levels.set(s.cmd, []); levels.get(s.cmd).push(s); }
  for (const [level, arr] of levels) {
    const t0 = arr[0].t + METRIC_RULES.levelSettleMs;
    const use = arr.filter((s) => s.t >= t0 && usable(s) && s.rpm[m] > 0);
    if (use.length >= METRIC_RULES.minLevelSamples) out.rpmByCommand[level] = { median: round(median(use.map((s) => s.rpm[m]))), n: use.length };
  }

  // ---- DShot errors (selected motor and any motor)
  const inv = S.filter((s) => s.fresh === true && Array.isArray(s.inv));
  const selInv = inv.map((s) => s.inv[m]);
  const usableInv = selInv.filter((v) => v !== null);
  out.dshot.motor.usableSamples = usableInv.length;
  out.dshot.motor.unavailableSamples = selInv.length - usableInv.length;
  if (usableInv.length) {
    out.dshot.motor.maxPct = Math.max(...usableInv) / 100;
    out.dshot.motor.medianPct = median(usableInv) / 100;
    out.dshot.motor.excessiveFraction = usableInv.filter((v) => v >= DSHOT_STATS.excessiveErrors_centi).length / usableInv.length;
  } else unavailable.push('dshot: no usable DShot error readings for this motor');
  const allInv = inv.flatMap((s) => s.inv).filter((v) => v !== null);
  if (allInv.length) out.dshot.anyMotorMaxPct = Math.max(...allInv) / 100;

  // ---- voltage (distinct reads only) and temperature
  const seen = new Set(); const volts = [];
  for (const s of S) if (s.v_cV !== null && Number.isFinite(s.v_cV)) { const key = Number.isFinite(s.vAt) ? s.vAt : `t${s.t}`; if (!seen.has(key)) { seen.add(key); volts.push(s.v_cV); } }
  out.voltage.reads = volts.length;
  const before = sweep.meta ? sweep.meta.voltageBefore_cV : null;
  if (Number.isFinite(before) && before > 0) out.voltage.before_V = before / 100; else unavailable.push('voltage-before: not read before the sweep');
  if (volts.length) out.voltage.min_V = Math.min(...volts) / 100; else unavailable.push('voltage: no readings during the sweep');
  if (out.voltage.before_V !== null && out.voltage.min_V !== null) out.voltage.drop_V = round(out.voltage.before_V - out.voltage.min_V, 2);
  const temps = S.filter((s) => s.fresh === true && Array.isArray(s.temp));
  const selT = temps.map((s) => s.temp[m]).filter((v) => v !== null), anyT = temps.flatMap((s) => s.temp).filter((v) => v !== null);
  if (selT.length) out.temperature.selectedMaxC = Math.max(...selT); else unavailable.push('temperature: not reported for this motor');
  if (anyT.length) out.temperature.anyMaxC = Math.max(...anyT);

  // ---- direct safety-relevant observations (the state machine already faults on these; recorded here as evidence)
  for (const s of S) {
    if (s.armed === true) out.armedSamples++;
    if (s.fresh === true && Array.isArray(s.rpm)) for (let i = 0; i < s.rpm.length; i++) if (i !== m && Number.isFinite(s.rpm[i]) && s.rpm[i] > 0) { out.peerRotationSamples++; break; }
    if (s.rbCurrent === true && Array.isArray(s.rb) && Array.isArray(s.cmds)) {
      for (let i = 0; i < MOTOR.enabledMotors; i++) {
        const want = s.cmds[i], got = s.rb[i];
        if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
        const tol = want === MOTOR.stopValue ? 0 : BENCH_TIMINGS.readbackToleranceNonzero;
        if (Math.abs(got - want) > tol) { out.readbackMismatchSamples++; break; }
      }
    }
  }
  if (out.expectedPosition && out.reportedPosition) out.positionMatches = out.expectedPosition === out.reportedPosition;
  return out;
}

export const _internals = { median, percentile, mad, longestContiguous };
