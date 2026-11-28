// Test tiers for tests/run.mjs (`--tier fast|release`; no tier = everything, which is what `npm test` runs).
//   fast     change-impact: the suites that name the changed files (.claude/skills/test-impact/impact.mjs --json) plus a canary set; widens to `release` for shared
//            infrastructure and runs every unit suite for a file nothing maps. Never fewer suites than the mapping finds.
//   release  every unit suite (they are cheap and carry the RLS, authentication, privacy, account deletion, XP, shared data, airspace and motor/preflight logic) plus
//            representative browser workflows, listed below with the reason each is there.
//   full     everything in tests/run.mjs: unit + all browser suites (`npm test`).
// Browser suites open the whole app, so no file-to-suite map can be exhaustive: that is why `fast` is for development and `release` / `full` decide a release.

/** Browser suites in the release tier. One per area of behaviour; the longest suites of an area stay in the full run only. */
export const RELEASE_BROWSER = [
  'areas', 'areas-admin', 'areas-admin-keyboard', 'areas-public',  // community areas: authoring, moderation (the keyboard regression), public layer
  'layers', 'theme', 'map-attribution', 'popup-theme',             // basemaps, CARTO dark source and fallback, credits, theming
  'zones-lifecycle', 'my-enr51', 'vn-enr51', 'maprotate',          // airspace layers and point-check, rotation (these report "data absent" where public/data is not built)
  'priv', 'aircraft-diag-privacy', 'storage', 'google-signin',     // privacy and storage promises, authentication
  'cloud', 'progression', 'sessions', 'trips', 'marker-host',      // signed-in account, XP, flight sessions, trips and shared data, marker window
  'toolbar', 'shell-nav', 'dashboard', 'search', 'gestures',       // navigation shell, dashboard, search, touch gestures
  'preflight-lab', 'motor-diagnostics-ui',                         // preflight and motor diagnostics workspaces (safety logic itself is in the unit suites)
];

/** Cheap browser suites run by `fast` whatever changed under src/ (a canary that the app still starts, themes and draws its map). */
export const CANARY_BROWSER = ['theme', 'map-attribution', 'toolbar'];

/** Changed file (prefix or exact path) -> browser suites that must run with it. Used where a suite exercises a module without naming its file. */
export const OWNERS = [
  ['src/map.js', ['layers', 'theme', 'map-attribution', 'popup-theme', 'maprotate', 'zones-lifecycle']],
  ['src/theme.js', ['theme', 'popup-theme', 'layers']],
  ['src/areas/', ['areas', 'areas-admin', 'areas-admin-keyboard', 'areas-public']],
  ['src/sessions', ['sessions', 'sessions-explorer', 'session-preview', 'session-arrival']],
  ['src/preflight/', ['preflight-lab']],
  ['src/benchtest/', ['bench-lab', 'motor-diagnostics-ui']],
  ['src/privacy', ['priv', 'storage']],
];
