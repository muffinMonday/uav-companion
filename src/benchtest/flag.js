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
