// The new shell nav bar/rail's element id (Review 01 S10.2), split out from shell/nav.js into its own dependency-free module: shell/nav.js
// reads import.meta.env (a Vite-only feature), and several *-unit.mjs suites that transitively import marker-host.js/sessions-map-explorer.js
// run under plain Node, where import.meta.env is undefined. This file has no such dependency, so it is safe for either to import.
export const SHELL_NAV_ID = 'shell-nav';
