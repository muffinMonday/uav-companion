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
- `npm run deploy`: build and publish `dist/` to `gh-pages` as a single commit. Public. Do not run without the owner's approval; It runs `scripts/strip-local.js` after the build, so local-only regions (`publish: false`, built into `public/data-local`) never go out. GitHub Pages must be set to the `gh-pages` branch in repo settings.

## Tests (`tests/`)
```
npm run test:unit                 # ai-unit, trip-unit, trips-unit, rain-unit, places-unit, reorder-unit, maplinks-unit, coordparse-unit, onemap-unit, plan-unit, dashstate-unit, checkin-unit: Node only, about 1 s
npm test                          # all suites; needs the app on :5173
node tests/run.mjs trips ai       # only suites whose name contains these words
node tests/run.mjs --jobs 1        # one suite at a time (default is 4 at once; --jobs auto picks from the CPU count)
node tests/trips.mjs              # one suite directly; prints PASS/FAIL lines
```
- Suites: unit `ai-unit`, `trip-unit` (Home marker, distance and date rules, AI assets), `trips-unit` (trips model, store, scoping, export/import, bulk delete), `rain-unit` (rain outlook and request parsing), `places-unit` (same-place groups, duplicate vs another visit), `reorder-unit` (what a move changes), `maplinks-unit` (China outline, GCJ-02, link formats and limits), `coordparse-unit` (coordinate and link parsing), `plan-unit` (trip days, distances, warnings, past trips, notes and checklist), `checkin-unit` (the 300 m rule, accuracy limit, record, export and restore), `dashstate-unit` (dashboard start rules, What's new, backup reminder), `onemap-unit` (OneMap parser, overlapping/hole zone reads from tiles, strip-local); browser `stops` (previous / next stop), `days` (day from the date, required trip dates, start-up fix, AI days to dates), `search` (coordinates, pin and window, Add as marker), `maplinks` (marker and check buttons, routes), `reorder` (hold and drag, Undo, Alt+arrows, touch), `visits` (badge, chips, Add visit, import, shared weather request), `window` (expanded/collapsed marker window), `dayroute` (the day's route with bold arrows, the details switch and the eye, the name tag and the v button that hides into it, route while a day is on show), `motion` (centring of the dashboard with and without the panel, the animations with motion on and none with reduced motion), `checkin` (fake geolocation: enabling near a marker, recording, rows, trip counts, opt-in and watch only while markers show), `dashboard` (states, start rules, cards, trip arrows, route card, quick actions, layers, data, map key, checklist, today with check-in, forecast, welcome line, phone and panel), `hold` (hold to check, centring, scrolling window), `rain` (rain block), `ui` (tab contents, controls, search/dock, phone window, day and stop), `bulk` (select and delete), `poi1`, `poi2`, `edit`, `prefs`, `opacity`, `mw`, `priv`, `ai`, `trip`, `trips`, `tripplan` (cards, Past trips, detail screen with the flip card, notes, checklist, forecast per day, no-fly check of stops), `shell` (collapsible search, rolled-up side panel), `mapsel` (tapping pins to select, numbers, filter, stacked visits, phone banner), `tools` (icon bar, two-step Delete, phone menu, Open/Navigate buttons), `sg` (Singapore layer; skips when `public/data-local` is absent), `smoke`.
- Browser suites mock Open-Meteo, Photon and Nominatim; screenshots go to `tests/out/` (git-ignored). `lib.mjs` supplies paths, the browser channel and a `chromium` wrapper that tucks the dashboard behind its tab in every new context (import `chromium` from `./lib.mjs`). It also emulates reduced motion in every context, so nothing is moving when a test clicks; pass `reducedMotion: 'no-preference'` to a context that needs the animations (see `motion.mjs`).
- The runner counts lines starting with `PASS`/`FAIL`; `smoke` prints none, so it shows 0 pass and passes if it does not crash or log console errors.
- Last full run (this document's date, 2026-11-11): see CURRENT_STATUS for the latest count on the dev server; counts in `CURRENT_STATUS.md`.

## Backend (`supabase/`)
See `supabase/README.md`: migrations, how the access rules are tested without Docker (`node tests/db-unit.mjs`, PGlite), how to push to the hosted project (`npx supabase db push --remote --dry-run`, then `--yes`; the password is read from the `SUPABASE_DB_PASSWORD` environment variable), and what must never be committed. The project address and publishable key are in `.env.development.local` (git-ignored, used by `npm run dev` only).

### Cloud copy in the app (`src/sync/`, `src/sync-ui.js`)
- `sync/core.js` holds the rules (what to push, pull or ask), `sync/engine.js` acts on them through an adapter, `sync/supabase.js` is the real adapter. The Supabase library is imported only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set, so the live site loads none of it.
- Tests: `sync-unit` and `sync-engine-unit` (the rules, and several simulated devices on an in-memory cloud, `tests/lib-sync.mjs`); `cloud` (browser, Supabase HTTP mocked by that same cloud); `node tests/cloud-live.mjs` (the real adapter and access rules on the hosted dev project, as a throwaway user the script creates and deletes; needs the CLI login; not in the default run).
- The browser suites run against `npm run dev`, which reads `.env.development.local`, so the sign-in card is present in them.

## Writing tests that can run in parallel
The runner runs four suites side by side by default (see the "Faster tests" item in `CURRENT_STATUS.md`), so every new or changed suite follows these rules:
- **Self-contained.** A suite seeds everything it needs itself (an `addInitScript` that writes `localStorage`, guarded by `sessionStorage.__seeded` so a reload keeps the state) and never depends on another suite having run, or on the order.
- **Own browser context, own state.** Open a context per scenario and close it. Do not share a page between scenarios, and never rely on anything left in the browser profile.
- **No shared files.** Write screenshots and downloads to `tests/out/` with the suite's name in the file name (`<suite>-<what>.png`), never a name two suites could both use. Do not write to the repository, `public/` or `dist/` from a test.
- **No shared ports, no global mocks.** The only shared thing is the app server. Stand-ins for outside services are installed on the context (`ctx.route`), permissions such as geolocation and clipboard on the context, never globally.
- **Deterministic time and data.** Build dates relative to today in the test (see `iso()` in `tripplan.mjs`) and seed coordinates; do not depend on the real network. Compare against values computed in the test, not constants that depend on the day.
- **Wait for a condition, not for a time.** Use `waitForSelector`, `waitForFunction` or an assertion that retries; a fixed `waitForTimeout` is only for a deliberate delay (a hold gesture, a retry interval) and should be commented. Fixed waits are what make a suite slow and flaky under load.
- **Reduced motion.** The context wrapper in `lib.mjs` emulates reduced motion; ask for motion back only in suites about animation (`motion.mjs`).
- **Keep a suite short** (aim for under 60 s and one subject). Split a long one by subject rather than growing it.
- **Register it** in `tests/run.mjs` (`UNIT` for logic that needs no browser, `BROWSER` otherwise). A suite that truly cannot run beside others is marked serial in the runner, with the reason beside it.
- **Prefer a unit suite** for anything that is pure logic: it takes milliseconds and has none of these concerns.
- While iterating, run only the suites that cover the change (`node tests/run.mjs <words>`); run the full set before every deploy.

## Debugging
- A failing browser test prints its message and the first error lines; rerun that suite alone. Screenshots in `tests/out/`.
- Leaflet pitfalls seen here: removing the clicked button mid-click closes the popup (defer DOM swaps with `setTimeout`); popups fade for 200 ms (wait before asserting); Leaflet uses `lng`, not `lon`; the scale control builds only its initial unit (replace the control to switch units).
- Dates in tests: use real ISO dates; `<input type=date>` ignores invalid values.
