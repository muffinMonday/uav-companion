// Motor bench test (Phase 3): build-time feature flag, separate from the read-only lab's flag. Defaults OFF.
// Read once from the build (VITE_BENCH_PHASE3=1 at build or dev-server start). Not a user preference: nothing is stored,
// nothing is read from the URL. The test override is an explicit in-memory call and is gone on reload.
let override = null;

const buildValue = () => {
  try { return !!(import.meta.env && import.meta.env.VITE_BENCH_PHASE3 === '1'); } catch { return false; }
};

export function benchEnabled() {
  return override === null ? buildValue() : override === true;
}

// Returns a function that removes the override. Never call this from application code.
export function overrideBenchFlagForTests(value) {
  override = value === true ? true : value === false ? false : null;
  return () => { override = null; };
}

// ---- the 4-way ESC identification step (read-only scan): a SEPARATE build-time switch. Default OFF.
// VITE_BENCH_FOURWAY=1          the step runs for every transport (real hardware included);
// VITE_BENCH_FOURWAY=synthetic  the step runs only with the synthetic flight controller (the isolated lab's practice mode);
// anything else                 the step does not exist: the workflow goes from the powered-zero check straight to motor choice.
// Why real hardware is off: docs/MOTOR_DIAGNOSTICS_FOURWAY_IDENTIFICATION.md (Betaflight 2025.12.5 stops the motor outputs when
// 4-way starts and, by source reading, does not restart them on exit; the restoration proof would then fail closed).
let fwOverride = null;
const fwBuildValue = () => {
  try { return (import.meta.env && import.meta.env.VITE_BENCH_FOURWAY) || ''; } catch { return ''; }
};
export function fourwayEnabledFor(transportKind) {
  const v = fwOverride === null ? fwBuildValue() : fwOverride;
  return v === '1' || (v === 'synthetic' && transportKind === 'mock');
}
export function overrideFourwayFlagForTests(value) {
  fwOverride = value === null || value === undefined ? null : String(value);
  return () => { fwOverride = null; };
}
