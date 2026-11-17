// Motor bench test: constants of the LIVE MSP/DShot analysis layer (collector, metrics, result, history).
// Every number here is PROVISIONAL: nothing has been validated against a faulty-motor fixture, so none of these values is a
// diagnostic limit. They exist so that the comparison code has one place to change and one place to label.
// This module holds no output value and no safety limit: the physical limits live in constants.js and are never read from here.
//
// Units (also repeated where a value is shown):
//   time          milliseconds (ms), measured on a monotonic clock relative to the start of that sweep
//   command       external DShot-style motor value (1000 = stop); NOT a percentage and NOT a throttle fraction
//   RPM           mechanical RPM as reported by the flight controller in MSP_MOTOR_TELEMETRY (electrical RPM / pole pairs, done by the FC)
//   DShot errors  `invalidPct` is reported in hundredths of a percent (centi-percent); shown as percent = centi / 100.
//                 10000 (100.00 %) is the "statistics unavailable" sentinel, never a measurement
//   voltage       centivolts (cV) from MSP_ANALOG; shown as volts = cV / 100; it is read about every 500 ms, so it is repeated across samples
//   temperature   degrees Celsius from MSP_MOTOR_TELEMETRY; 0 means "not reported"
const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(o); };

export const ANALYSIS_PROVISIONAL = true;
export const ANALYSIS_SCHEMA_VERSION = 1;
export const EVIDENCE_FORMAT = 'uav-companion.motor-bench-evidence';

// Bounds on memory (the collector never grows past these; anything beyond is dropped and flagged, never silently truncated).
export const SAMPLE_LIMITS = deepFreeze({
  maxSamplesPerSweep: 2000, // run timeout is 60 s and telemetry arrives at most every 40 ms, so 1500 is the practical ceiling
  maxSweeps: 12, // retained attempts in one session (four motors plus retries)
  maxGapsPerSweep: 200,
  stopPhaseMaxMs: 6000, // samples after the output returned to stop are kept for this long only
  maxRecords: 20, // derived history records kept in this browser
  maxRetainedSampleSets: 2, // opt-in sample sets kept in this browser
  maxStoredBytes: 1500000, // refuse to store more than this per key (localStorage quota is shared with the app)
});

// How samples are turned into metrics.
export const METRIC_RULES = deepFreeze({
  gapMs: 120, // two consecutive telemetry frames further apart than this are a gap (three poll periods); never bridged
  plateauSettleMs: 500, // plateau samples in the first 500 ms after the step are not used for the plateau statistics
  minPlateauSamples: 8, // fewer usable contiguous samples than this: no plateau statistics (shown as unavailable, not as a normal result)
  levelSettleMs: 200, // per-command comparison: ignore the first 200 ms at each command level
  minLevelSamples: 3, // per-command comparison: usable samples needed at a level
  dshotExcessiveFractionPersistent: 0.2, // a sweep with at least 20 % of usable DShot readings at or above DSHOT_STATS.excessiveErrors_centi counts as persistent
});

// Peer comparison. NO validated faulty-motor fixture exists: these are observational comparisons only.
export const PEER_COMPARISON = deepFreeze({
  provisional: true,
  minMotors: 3, // completed sweeps needed before any comparison is made
  startThresholdDifference: 10, // command units between a motor's start threshold and the median of its peers
  rpmRelativeDifference: 0.2, // fraction (20 %) between a motor's RPM and the median of its peers, at one shared command level
  dshotDifference_centi: 25, // 0.25 percentage points above the median of its peers' maximum DShot error percentage
});

// Fault reasons recorded by the state machine, mapped to how the result treats them. Anything not listed is "incomplete":
// an unknown reason is never shown as benign.
export const HARD_FAULT_REASONS = deepFreeze({
  'no-stable-rotation-by-cap': 'No stable rotation was established by the output cap.',
  'motor-position-mismatch': 'A motor other than the expected one moved, or no motor was reported moving.',
  'peer-motor-rpm': 'A motor that was not being tested reported rotation.',
  'unexpected-rotation': 'A motor reported rotation when none was commanded.',
  'rotation-during-zero-verification': 'A motor reported rotation when none was commanded.',
  'dshot-errors-excessive': 'DShot error statistics stayed at or above the provisional limit.',
  'dshot-statistics-unavailable': 'DShot error statistics became unavailable during the run.',
  'telemetry-stale-or-unavailable': 'Motor telemetry became unavailable or stale during the run.',
  'readback-unavailable': 'The flight controller motor read-back became unavailable during the run.',
  'readback-mismatch': 'The flight controller motor read-back did not match the command.',
  'arming-state-changed': 'The aircraft reported armed during the run.',
  'arming-state-unavailable': 'The arming state became unavailable during the run.',
  'temperature-fault': 'An ESC reported a temperature at or above the fault limit.',
  'voltage-fault': 'The battery voltage dropped by more than the fault limit.',
  'rpm-above-plausibility-ceiling': 'A motor reported an RPM above the plausibility ceiling.',
  'stop-proof-incomplete': 'The stop proof could not be completed.',
  'safe-state-incomplete': 'The stop proof could not be completed.',
});
