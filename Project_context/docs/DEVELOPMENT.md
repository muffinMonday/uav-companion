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

## Environment variables and secrets
| Name | Where | Purpose |
|---|---|---|
| `VITE_DATA_BASE_URL` | shell | Read zone data from elsewhere (default `./data/`) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.development.local` (git-ignored; read by `npm run dev` only) or the shell for one build | Public values; turn accounts on in a build |
| `SUPABASE_DB_PASSWORD` | Windows user environment | Only for `supabase db push`; never in a file |
| `BROWSER_CHANNEL` | shell | `chrome` instead of Edge for browser tests |
Never commit or print the service-role key, DB password or access token.

## Build, verify, deploy
- `npm run build`: production bundle to `dist/`. Production check: `npm run build && npx vite preview --port 5173 --strictPort`, then run the tests.
- `npm run verify:data`: shapefile cells versus tiles.
- `npm run deploy`: build and publish `dist/` to `gh-pages` as a single commit. Public. Do not run without the owner's approval; It runs `scripts/strip-local.js` after the build, so local-only regions (`publish: false`, built into `public/data-local`) never go out. GitHub Pages must be set to the `gh-pages` branch in repo settings.

## Tests (`tests/`)
```
npm run test:unit                 # the 38 Node-only suites (UNIT in tests/run.mjs), about 20 s
npm test                          # all suites (about 7 minutes at 4 at once); needs the app on :5173
node tests/run.mjs trips ai       # only suites whose name contains these words
node tests/run.mjs --jobs 1        # one suite at a time (default is 4 at once; --jobs auto picks from the CPU count)
node tests/trips.mjs              # one suite directly; prints PASS/FAIL lines
```
- Suites: the lists `UNIT` (38, logic and database rules on in-memory Postgres) and `BROWSER` (54) in `tests/run.mjs` are the authoritative inventory; a suite's subject is in its file header and name (`*-unit`, `db-*-unit`, `*-live` need no browser or the hosted dev project). Last full browser run: see `CURRENT_STATUS.md`.
- Browser suites mock Open-Meteo, Photon and Nominatim; screenshots go to `tests/out/` (git-ignored). `lib.mjs` supplies paths, the browser channel and a `chromium` wrapper that tucks the dashboard behind its tab in every new context (import `chromium` from `./lib.mjs`). It also emulates reduced motion in every context, so nothing is moving when a test clicks; pass `reducedMotion: 'no-preference'` to a context that needs the animations (see `motion.mjs`).
- The runner counts lines starting with `PASS`/`FAIL`; `smoke` prints none, so it shows 0 pass and passes if it does not crash or log console errors.

## Backend (`supabase/`)
**Edge functions:** `delete-account`, `steam-link`, `steam-sync` and `steam-sync-all` (shared code in `supabase/functions/_shared/`; per-function `verify_jwt` in `supabase/config.toml`) are deployed separately from the site and the migrations. The Supabase CLI refuses a hosted `db push` or `functions deploy` in an agent run without `--yes` (it treats that as the consent step); the owner's standing choice (memory `commit-deploy-each-phase`) covers it for phase work. Steam set-up (secrets, `steam_enabled`, daily scheduler) is in `supabase/README.md` and `PROGRESSION.md`. Original note: `supabase/functions/delete-account` is deployed separately from the site and the migrations: `npx supabase functions deploy delete-account --project-ref <ref>` (the owner approves each deploy). Its rules are tested without Deno (`node tests/delete-account-unit.mjs`).

**Before real users (release checklist):** a second Supabase project for production (this one is development); closed sign-ups (`enable_signup` off, invite or allow-list); email confirmation on; an outside email sender (the built-in one is rate limited); the Pages address in the redirect allow-list; the delete-account function deployed there.

See `supabase/README.md`: migrations, how the access rules are tested without Docker (`node tests/db-unit.mjs`, PGlite), how to push to the hosted project (`npx supabase db push --remote --dry-run`, then `--yes`; the password is read from the `SUPABASE_DB_PASSWORD` environment variable), and what must never be committed. The project address and publishable key are in `.env.development.local` (git-ignored, used by `npm run dev` only).

### Cloud copy in the app (`src/sync/`, `src/sync-ui.js`)
- `sync/core.js` holds the rules (what to push, pull or ask), `sync/engine.js` acts on them through an adapter, `sync/supabase.js` is the real adapter. The Supabase library is imported only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set, so the live site loads none of it.
- Tests: `sync-unit` and `sync-engine-unit` (the rules, and several simulated devices on an in-memory cloud, `tests/lib-sync.mjs`); `cloud` (browser, Supabase HTTP mocked by that same cloud); `node tests/cloud-live.mjs` (the real adapter and access rules on the hosted dev project, as a throwaway user the script creates and deletes; needs the CLI login; not in the default run).
- **Deploying with sign-in on: use `npm run deploy:live`** (`scripts/deploy-live.js`). It reads the two public values from `.env.development.local`, sets them for that one build, and refuses to deploy if either is missing. Plain `npm run deploy` builds with sign-in off. Background: the build includes the cloud copy only when the project address and publishable key are in the environment of the build. Plain `npm run deploy` leaves them out (sign-in off). To deploy with it on, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the public values in `.env.development.local`) in the shell for that one command. The sign-in link returns to the page the visitor came from, so that address must be listed under Supabase Authentication > URL Configuration > Redirect URLs.
- **Shared trips:** `db-trips-unit` (rules on an in-memory Postgres), `sharedtrip-unit` (the merge, with 600 random cases), `sharedstore-unit` (how the store treats a shared trip), `sharedtrip-engine-unit` (several simulated devices against the real database rules, `tests/lib-trips.mjs`) and `party` (browser, two users, the real SQL behind mocked HTTP); `node tests/trips-live.mjs` runs the same rules live on the dev project as throwaway users.
- **Live locations:** `db-live-unit` (rules: members only, validation, the 2 s limit, stale and deleted positions, a trip that ended, leaving), `live-engine-unit` (the sending side with a fake position source and clock against the real rules) and `live` (browser: Playwright's emulated geolocation, two users, the pins on the map); `tests/trips-live.mjs` covers them live. A switch that turns itself off (a refused permission) must be clicked, not `check()`ed, in a test.
- **Online status:** `db-presence-unit` (who sees whom, the 75 s window, hiding), plus checks in `friends` and `party` (a page wakes its heartbeat by dispatching `visibilitychange`).
- **Friends:** `db-friends-unit` (rules on an in-memory Postgres), `friends` (browser; the real friends SQL runs behind mocked HTTP so two simulated users are tested against the real access rules), and `node tests/friends-live.mjs` (live, throwaway users).
- The browser suites run against `npm run dev`, which reads `.env.development.local`, so the sign-in card is present in them.

### Turning the map and the locate button
- `heading-unit` (the compass maths and the sensor wrapper, with a fake window), `maprotate` (a real browser with real touch: the two-finger turn, pins on the spot they mark, popups upright, a hold and a drag at the right coordinates, tiles to the corners), `locatemode` (the three steps, the arrow, the wake lock, the permission paths) and `layers` (the four layers, each from its own host, remembered).
- Orientation events are dispatched as real `DeviceOrientationEvent`s (`deviceorientationabsolute`, `absolute: true`). The browser context must grant `accelerometer`, `gyroscope` and `magnetometer` as well as geolocation, because current Chromium answers `DeviceOrientationEvent.requestPermission()` from them (without them the app correctly reports a refused permission).
- Tile requests are answered with a tiny image so no network is needed; answer only the tile hosts (the dev server serves the marker icons as `.png?import` modules, which must go through untouched). Tiles have `pointer-events: none`, so find them by counting `img.leaflet-tile`, not by hit-testing.
- The dev server can reload the page mid-test if a source file is saved while a suite runs.

### Swipe gestures (`src/swipe.js`)
- `onSwipe(el, { direction, onDismiss, canStart, enabled, follow })` is built on touch events; it only takes a gesture over once it is clearly along the chosen direction, and never starts on a form control, `[data-no-swipe]`, the trip card flip, a sideways scroller, or while a row is being dragged (`body.reordering`). Put `data-no-swipe` on anything new that needs its own gestures.
- Tests use real touch events through the browser protocol (`ctx.newCDPSession(p)` and `Input.dispatchTouchEvent`, as in `tests/hold.mjs` and `tests/swipe.mjs`). The panel bodies scroll smoothly, so wait until `scrollTop` has arrived before measuring a control or starting a swipe.
- A first visit now shows the quick setup (`tests/splash.mjs`). Suites that need a clean first visit remove the `uavzones.v1.dash` key, then click `#splash-skip` (or Escape) before using the dashboard; `tests/lib.mjs` seeds `welcomed: true` for everything else. Chrome swallows the first synthetic tap after a drag that began on the folded rail circle (`tests/swipe.mjs` taps again).

## Load test (`scripts/loadtest.mjs`)
Virtual users that make the app's own requests at the app's own pace against the hosted project (it creates throwaway users `loadtest-...@example.test` and deletes them at the end; there is no second project, so it also loads the one the live site uses: run off-peak, start with `--users 3 --minutes 1`). `node scripts/loadtest.mjs --yes --users 25 --minutes 5 --scenario live`; add `--adaptive` to model the client after the efficiency review (live poll only while `live_active` > 0, slower trip poll when quiet) and compare the two runs; `--cleanup` removes leftovers. Reports requests/s, p50/p95/p99 per call and errors; read CPU, memory, disk IO and `pg_stat_statements` in the Supabase dashboard for the same period. Never run it without the owner's go-ahead.

## Writing tests that can run in parallel
The runner runs four suites side by side by default, so every new or changed suite follows these rules:
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
