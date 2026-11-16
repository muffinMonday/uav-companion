// Motor diagnostics: build-time feature flag. Backlog section 12 ("Feature flag").
// Defaults OFF. It is read once from the build (VITE_PREFLIGHT_DIAGNOSTICS=1 at build or dev-server start).
// It is NOT a user preference: nothing is stored in localStorage, a cookie or the URL.
// A test override exists, is explicit (a named function call), lives only in memory and is gone on reload.
let override = null; // null = no override

const buildValue = () => {
  try { return !!(import.meta.env && import.meta.env.VITE_PREFLIGHT_DIAGNOSTICS === '1'); } catch { return false; }
};

export function preflightEnabled() {
  return override === null ? buildValue() : override === true;
}

// Explicit, non-persistent. Returns a function that removes the override. Never call this from application code.
export function overrideFlagForTests(value) {
  override = value === true ? true : value === false ? false : null;
  return () => { override = null; };
}
