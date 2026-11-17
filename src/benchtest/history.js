// Motor bench test: derived diagnostic records and the evidence export (live MSP/DShot analysis layer).
// Builds plain-JSON objects only. Storage is done by ../aircraft-diag-data.js (the only module that knows the keys), so this
// bench module never touches browser storage. No raw flight-controller UID is ever included: identity here is built from named
// fields, and `uidHex` is never read.
import { ANALYSIS_PROVISIONAL, ANALYSIS_SCHEMA_VERSION, EVIDENCE_FORMAT, METRIC_RULES, PEER_COMPARISON, SAMPLE_LIMITS } from './analysis-constants.js';
import { BENCH_TIMINGS, DSHOT_STATS, MOTOR } from './constants.js';
import { sanitizeEscObservation } from '../fourway/scan-result.js';

// The identity used by the allowlist, and nothing else. The aircraft-profile integration is not mature, so this FC/ESC
// identity is the temporary association (a clean adapter point: replace `association` here, nothing else changes).
export function identityForRecord(identity) {
  const i = identity || {};
  const pick = (k, n = 120) => (typeof i[k] === 'string' ? i[k].slice(0, n) : null);
  // fcFingerprint is a derived, non-reversible 12-hex digest (fingerprint.js); the raw UID never reaches a record. The ESC is
  // not part of the identity any more: scanned ESC metadata is stored separately as observation (escObservation).
  const fp = typeof i.fcFingerprint === 'string' && /^[0-9a-f]{12}$/.test(i.fcFingerprint) ? i.fcFingerprint : null;
  return { variant: pick('variant'), firmware: pick('firmware'), api: pick('api'), targetName: pick('targetName'), boardId: pick('boardId'), motorProtocol: pick('motorProtocol'), fcFingerprint: fp };
}
export function associationOf(identity) {
  const i = identityForRecord(identity);
  return { kind: 'fc-identity', key: [i.variant, i.firmware, i.api, i.targetName, i.boardId, i.motorProtocol, i.fcFingerprint].map((v) => v || '?').join('|') };
}

// The constants that shaped one run, recorded with it so a later reader knows what the numbers mean.
export function constantsSnapshot() {
  return {
    provisional: ANALYSIS_PROVISIONAL,
    motor: { stopValue: MOTOR.stopValue, startValue: MOTOR.startValue, step: MOTOR.step, cap: MOTOR.cap, dwellMs: MOTOR.dwellMs, candidateValidationMs: MOTOR.candidateValidationMs, plateauOffset: MOTOR.plateauOffset, plateauMaxMs: MOTOR.plateauMaxMs },
    timings: { staleTelemetryFaultMs: BENCH_TIMINGS.staleTelemetryFaultMs, telemetryPollMs: BENCH_TIMINGS.telemetryPollMs, readbackToleranceNonzero: BENCH_TIMINGS.readbackToleranceNonzero, rpmCeiling: BENCH_TIMINGS.rpmCeiling },
    dshot: { unavailableSentinel_centi: DSHOT_STATS.unavailableSentinel_centi, excessiveErrors_centi: DSHOT_STATS.excessiveErrors_centi },
    metricRules: { ...METRIC_RULES }, peerComparison: { ...PEER_COMPARISON }, sampleLimits: { ...SAMPLE_LIMITS },
  };
}

const recordId = (now) => 'r' + Math.round(now).toString(36) + Math.floor(Math.random() * 1679616).toString(36);

// result: buildBenchResult(...). Derived data only: metrics and categories, never samples.
export function buildHistoryRecord({ result, identity, now = Date.now(), id, samplesRetained = false, esc = null }) {
  return {
    id: id || recordId(now),
    schemaVersion: 1,
    analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
    savedAt: new Date(now).toISOString(),
    date: new Date(now).toISOString().slice(0, 10),
    firmware: identityForRecord(identity),
    association: associationOf(identity),
    escObservation: sanitizeEscObservation(esc),
    result: { category: result.category, headline: result.headline, summary: result.summary, reasons: result.reasons.map((r) => ({ motor: r.motor, text: r.text })), notes: result.notes.slice() },
    motors: result.motors.map((m) => ({ motor: m.motor, position: m.position, status: m.status, hard: m.hard.slice(), gaps: m.gaps.slice(), differences: (m.differences || []).slice(), metrics: m.metrics ? stripMetrics(m.metrics) : null })),
    comparison: { classified: result.comparison.classified, reason: result.comparison.reason || '', sharedNote: result.comparison.sharedNote || '', sharedCommand: result.comparison.sharedCommand, differences: result.comparison.differences.map((d) => ({ motor: d.motor, kind: d.kind, text: d.text })) },
    range: result.range,
    constants: constantsSnapshot(),
    samplesRetained: samplesRetained === true,
  };
}
function stripMetrics(m) { const { unavailable, ...rest } = m; return { ...rest, unavailable: unavailable.slice() }; }

// Explicit export of the live samples. `sweeps` come from the collector. Never includes a UID.
export function buildEvidenceExport({ sweeps, result, identity, now = Date.now(), esc = null }) {
  return {
    format: EVIDENCE_FORMAT,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    provisional: ANALYSIS_PROVISIONAL,
    note: 'Live samples from a propeller-free, low-output bench sweep. Observations only; not a health certification. No flight-controller UID is included.',
    units: { t: 'ms since the sweep started (monotonic)', cmd: 'external motor value, 1000 = stop', rpm: 'RPM from the flight controller', inv: 'DShot invalid, hundredths of a percent; null = unavailable', temp: 'degrees C; null = not reported', v_cV: 'centivolts, read about every 500 ms', rb: 'flight-controller motor read-back, external units' },
    identity: identityForRecord(identity),
    association: associationOf(identity),
    escObservation: sanitizeEscObservation(esc),
    constants: constantsSnapshot(),
    result: { category: result.category, headline: result.headline },
    sweeps: sweeps.map((s) => ({
      id: s.id, motor: s.motor, status: s.status, complete: s.status === 'completed', end: s.end, meta: s.meta,
      truncated: s.truncated, droppedSamples: s.droppedSamples, stopSamplesTruncated: s.stopSamplesTruncated,
      gaps: s.gaps, unavailable: s.unavailable, samples: s.samples.map(({ motor, ...rest }) => rest),
    })),
  };
}

export function approxBytes(obj) { try { return JSON.stringify(obj).length; } catch { return 0; } }
