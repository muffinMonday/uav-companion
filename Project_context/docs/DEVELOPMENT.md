# Development

## Prerequisites
- Node.js (verified with v24.19) and npm (11.17). Windows 11 is the dev machine; commands are shell-neutral.
- Microsoft Edge for the browser tests (Playwright uses the installed browser via `channel`); `BROWSER_CHANNEL=chrome` switches to Chrome. `playwright-core` downloads no browser.
- Raw shapefiles in `data/regions/<country>/<region>/` only to rebuild tiles (kept local, not in git).

## Setup and run
```
npm install
npm run build:data     # needs raw data; writes public/data/ (already present on this machine)
npm run dev            # http://localhost:5173 (the tests expect this port)
```
Without raw data, use published data: `VITE_DATA_BASE_URL=https://<user>.github.io/uav-companion/data/ npm run dev`.
Geolocation needs https or localhost.

## Build, verify, deploy
- `npm run build`: production bundle to `dist/`. Production check: `npm run build && npx vite preview --port 5173 --strictPort`, then run the tests.
- `npm run verify:data`: shapefile cells versus tiles.
- `npm run deploy`: build and publish `dist/` to `gh-pages` as a single commit. Public. Do not run without the owner's approval; GitHub Pages must be set to the `gh-pages` branch in repo settings.

## Tests (`tests/`)
```
npm run test:unit                 # ai-unit, trip-unit, trips-unit, rain-unit, places-unit, reorder-unit, maplinks-unit, coordparse-unit: Node only, about 1 s
npm test                          # all suites; needs the app on :5173
node tests/run.mjs trips ai       # only suites whose name contains these words
node tests/trips.mjs              # one suite directly; prints PASS/FAIL lines
```
- Suites: unit `ai-unit`, `trip-unit` (Home marker, distance and date rules, AI assets), `trips-unit` (trips model, store, scoping, export/import, bulk delete), `rain-unit` (rain outlook and request parsing), `places-unit` (same-place groups, duplicate vs another visit), `reorder-unit` (what a move changes), `maplinks-unit` (China outline, GCJ-02, link formats and limits), `coordparse-unit` (coordinate and link parsing); browser `days` (day from the date, required trip dates, start-up fix, AI days to dates), `search` (coordinates, pin and window, Add as marker), `maplinks` (marker and check buttons, routes), `reorder` (hold and drag, Undo, Alt+arrows, touch), `visits` (badge, chips, Add visit, import, shared weather request), `window` (expanded/collapsed marker window), `welcome` (welcome screen and countdown), `hold` (hold to check, centring, scrolling window), `rain` (rain block), `ui` (tab contents, controls, search/dock, phone window, day and stop), `bulk` (select and delete), `poi1`, `poi2`, `edit`, `prefs`, `opacity`, `mw`, `priv`, `ai`, `trip`, `trips`, `smoke`.
- Browser suites mock Open-Meteo, Photon and Nominatim; screenshots go to `tests/out/` (git-ignored). `lib.mjs` supplies paths, the browser channel and a `chromium` wrapper that switches the welcome screen off in every new context (import `chromium` from `./lib.mjs`; `welcome.mjs` uses playwright-core directly to see the real thing).
- The runner counts lines starting with `PASS`/`FAIL`; `smoke` prints none, so it shows 0 pass and passes if it does not crash or log console errors.
- Last full run (this document's date, 2026-11-11): all 30 suites passed on the dev server; counts in `CURRENT_STATUS.md`.

## Debugging
- A failing browser test prints its message and the first error lines; rerun that suite alone. Screenshots in `tests/out/`.
- Leaflet pitfalls seen here: removing the clicked button mid-click closes the popup (defer DOM swaps with `setTimeout`); popups fade for 200 ms (wait before asserting); Leaflet uses `lng`, not `lon`; the scale control builds only its initial unit (replace the control to switch units).
- Dates in tests: use real ISO dates; `<input type=date>` ignores invalid values.
