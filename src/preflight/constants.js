// Motor diagnostics: frozen constants. Backlog sections 17.2 and 23.
// EVERY timing and ratio here is PROVISIONAL: approved only as a value to measure, never measured yet.
// Phases 1 and 2 are read-only. Nothing here is used to send a motor command, and no nonzero motor value exists in this module.
const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(o); };

export const PROVISIONAL = true;

// "Zero" means external value 1000 for non-3D DShot (finding F4), never 0.
export const STOP_EXTERNAL_VALUE = 1000;

export const TIMINGS = deepFreeze({
  holdToStartPointerMs: 1000,
  holdToStartKeyboardMs: 1000,
  mspReadTimeoutMs: 250,
  mspReadRetries: 1,
  motorAckTimeoutMs: 150,
  motorAckConsecutiveFailuresFault: 2,
  telemetryPollMs: 40, // 25 Hz
  staleTelemetryFaultMs: 200, // 5 missed polls
  stopCadenceMs: 50,
  stopMinAttempts: 10,
  reconnectGraceMs: 15000,
  escReadyWaitMs: 5000,
  poweredZeroObservationMs: 3000,
  poweredZeroMinSamples: 60,
  startThresholdWindowMs: 1000,
});

export const RESOLVABILITY = deepFreeze({
  usableFraction: 0.8, // u, provisional; validate against recorded logs
  sanityFloorHz: 1000, // configured logged rate floor for the bench gate
});

export const READINESS = deepFreeze({
  poleCountMin: 6, // provisional plausibility range
  poleCountMax: 28,
  requiredMotorCount: 4,
  featureThreeDBit: 12, // FEATURE_3D = 1 << 12 (finding F14)
});

// Import size caps (backlog section 12), provisional.
export const IMPORT_CAPS = deepFreeze({ androidBytes: 64 * 1024 * 1024, desktopBytes: 256 * 1024 * 1024 });

// Per-request MSP read timeout used by the read-only session. The same value as TIMINGS.mspReadTimeoutMs.
export const MSP_READ_TIMEOUT_MS = TIMINGS.mspReadTimeoutMs;
