# HTML and main.js Refactoring — Backlog and Implementation Plan

**Status:** Phase 0, duplicate-ID correction and Phase 1 complete and verified. Phases 2–5 not implemented. Authorized publication is in progress.

**Decision date:** 2026-11-13.

**Authorization:** Owner authorized Phase 1 and subsequently commit/push/deploy on 2026-11-14. Further implementation phases and database changes still require owner authorization.
**Priority:** Complete and verify this refactor before implementing Community Flying Areas.

## 1. Objectives and scope

Refactor `index.html` (currently about 333 lines) and `src/main.js` (currently about 328 lines) to make features discoverable and reduce the amount of unrelated source that agents must read. Maintain Vite, vanilla JavaScript, Leaflet and the existing static GitHub Pages deployment. No React/Vue migration and no intended functional or visual changes.

Success means: (a) a feature has an obvious HTML and JS owner, (b) agents can locate the right files using `docs/MODULES.md`, (c) runtime behavior and DOM remain equivalent, and (d) future feature work such as Community Flying Areas can use the new organization.

Smaller files do not automatically save tokens. The intended savings come from targeted file inspection guided by the component map.

## 2. Build-time HTML assembly

The **source** `index.html` becomes a small shell containing explicit component includes. HTML fragments live under `src/components/`. A local Vite `transformIndexHtml` plugin (or similarly small documented implementation) assembles them during `npm run dev` and `npm run build`. Production `dist/index.html` contains the complete DOM and is published to `gh-pages` as before. No runtime fetching, additional HTML network requests, or manual build step.

The development server must correctly reload/retransform the page when a fragment changes. Support nested includes only if necessary, with cycle detection and useful errors. Resolve includes against a fixed repository directory; avoid arbitrary filesystem paths. Keep the early inline theme script executing before first paint, and retain `/src/main.js` as the entry point.

**Proposed fragments (confirm boundaries against the current source):**

| Path | Ownership |
|---|---|
| `src/components/search.html` | Search field and result list |
| `src/components/dock.html` | Collapsed panel rail |
| `src/components/panel.html` | Side-panel shell, tabs and content insertion points |
| `src/components/map-config.html` | Map Configs tab |
| `src/components/trips-panel.html` | Trips and AI import markup |
| `src/components/poi-panel.html` | POI tab |
| `src/components/privacy-panel.html` | Privacy subpanel |
| `src/components/dashboard.html` | Dashboard shell |

Keep dynamically generated DOM in existing JavaScript owners. Preserve all IDs, classes, ARIA attributes, tab relationships, `hidden` and checked defaults, ordering, nesting, focus behavior and selectors. No duplicate IDs.

## 3. main.js responsibility split

Keep `src/main.js` as the readable application entry point and orchestrator. Move responsibilities only where cohesion and testing improve; avoid extracting tiny functions solely to reduce line count.

**Candidate modules (not mandatory until reviewed):**

| Path | Responsibility |
|---|---|
| `src/app/point-check.js` | Point-check popup composition, decoration, marker actions |
| `src/app/map-settings.js` | Basemap, opacity, map links, weather limit and preferences wiring |
| `src/app/region-loader.js` | Region manifests, place data, local/private region data and errors |
| `src/app/region-ui.js` | Country selector, coverage notes, map legend |
| `src/app/bootstrap.js` | Dependency wiring and startup/lifecycle coordination, only if it improves clarity |

Prefer moving functionality into an existing module where ownership already fits. In particular, do not duplicate logic in `map.js`, `pointcheck.js`, `prefs.js`, `panel.js`, `trips-ui.js` or `poi-ui.js`.

Preserve the actual dependency order: theme/preferences first; map and panel; POI, trips, AI and dashboard; optional cloud/accounts/social initialization; geographic data loading and overlays. Do not force independent async work into a sequential pipeline. Preserve error handling, diagnostics, and unconfigured Supabase behavior.

## 4. Phase plan and gates

### Phase 0 — Baseline and dependency audit
- Inspect `git status`, last three commits and current `CURRENT_STATUS.md`; preserve any uncommitted changes.
- Record the existing rendered DOM (including attribute/ID inventory), startup and build behavior, current test results and screenshot baseline.
- Inspect `scripts/ui-baseline.mjs` and the existing design-system checkpoint.
- Identify selectors and startup dependencies before choosing exact fragment boundaries.
- **Gate:** owner reviews extraction boundaries and baseline; no source refactor yet.

### Phase 1 — HTML extraction
- Add the local Vite HTML assembly mechanism and fragment files.
- Ensure development HMR/reload and production build produce equivalent HTML.
- Keep original static structure, early theme script, panel behavior and initial state.
- **Gate:** DOM/ID equivalence, deterministic screenshot comparison, build and affected browser suites pass.

### Phase 2 — JavaScript responsibility extraction
- Extract one coherent `main.js` responsibility at a time.
- Preserve initialization, async behavior, callbacks, map gestures and errors.
- Add focused tests where existing tests do not cover the seam.
- **Gate:** affected tests pass after each extraction; no startup or feature regression.

### Phase 3 — Component ownership map
- Update `Project_context/docs/MODULES.md` with a table mapping UI feature -> HTML -> JS -> CSS -> tests.
- Document dynamic UI components that intentionally have no static HTML fragment.
- **Gate:** a new agent can find the right owner for major UI changes without reading all of `index.html` or `main.js`.

### Phase 4 — Agent navigation
- Update `Project_context/AGENTS.md` with a short link to the component map and this backlog.
- Preserve its minimal-read startup policy; do not require agents to read all docs every time.
- **Gate:** guidance is accurate, concise and not duplicative.

### Phase 5 — Regression and handoff
- Run `npm run build`, `npm run test:unit`, and `npm test` with the app available on `:5173`; inspect all results.
- Compare deterministic screenshots using the existing screenshot workflow.
- Check mobile touch, map rotation, point-check, location, panel/dock/tab/swipe, POIs, trips, privacy, theme, dashboard, auth/cloud and signed-out behavior.
- Request owner's real-device review and approval before commit/push/deploy.
- **Gate:** no intended DOM, visual or behavior differences; documented exceptions must be explicitly approved.

## 5. Required acceptance criteria

- No new UI framework and no runtime fragment fetching.
- Identical public DOM structure and attributes except insignificant formatting.
- No changed element IDs or duplicate IDs.
- Theme script still runs before first paint, without flashes.
- Vite dev and build produce equivalent markup.
- Existing CSS, event handlers, tab selection, focus and accessibility semantics preserved.
- Existing local storage keys, cloud schema and Supabase security unchanged.
- No change to regulatory zone data, map point-check or Leaflet rotation.
- No new build/deployment step required for the owner.
- Full test results and screenshot comparison recorded before claiming completion.

## 6. Planned source changes

**New:** `src/components/*.html` listed above; a small local Vite HTML assembly implementation (likely `vite.config.js` and a build helper if needed); candidate `src/app/*.js`; targeted DOM/build regression tests.

**Modify:** `index.html`, `src/main.js`, `tests/run.mjs` where tests are registered, `Project_context/docs/MODULES.md`, `DEVELOPMENT.md`, `ARCHITECTURE.md`, `CURRENT_STATUS.md`, `CHANGELOG.md`, and a minimal pointer in `Project_context/AGENTS.md`.

**Avoid:** unrelated UI redesign, POI/trip/cloud schema changes, dependencies without justification, edits to generated `dist/` as source, and unrequested deployment.

## 7. Future Community Flying Areas integration

After refactoring, review `Project_context/docs/COMMUNITY_FLYING_AREAS_PLAN.md` and update its planned UI paths to the new component convention (for example, a dedicated `src/components/areas-panel.html`). This is a separate future decision and does **not** authorize implementation of Community Flying Areas.

## 8. Agent handoff

Phase 1 is active within the owner's authorization recorded above. When the owner authorizes a phase, read the current `AGENTS.md`, `CURRENT_STATUS.md`, `MODULES.md`, relevant design docs and latest source; inspect the working tree and recent commits. Follow `.claude/skills/change-workflow`, `test-impact`, and relevant project rules. Ask before committing, pushing or deploying. Do not apply the progression-specific standing deploy permission to this refactor.

## 9. Phase 0 audit (2026-11-14; implementation awaiting owner approval)

This section records the original Phase 0 baseline. Section 10 records the separately approved duplicate-ID correction and its replacement baseline; use that corrected baseline for Phase 1.

Only Phase 0 is authorized. No application source, test suite, configuration, dependency, data or schema is being changed. Phase 1 and later remain proposals. This section and the session checkpoint record the audit; generated evidence is untracked/ignored or in the temporary directory.

### Working tree and baseline identity

- Branch `main`, HEAD `e16eac1` (2026-11-13, "Status: automatic sharing deployed"). Previous commits: `c258b39` (future-backlog documentation), `1627ae9` (automatic location sharing). Local branch and `origin/main` agree according to the existing local remote-tracking ref; no fetch/push was performed.
- Twelve files were already modified: `Project_context/docs/{CURRENT_STATUS,PROJECT}.md`, `docs/AI.md`, `public/ai/{example.geojson,prompt.md,schema.json}`, `public/llms.txt`, `src/{ai-ui.js,aiimport.js,styles.css}`, `tests/{ai-unit,ai}.mjs`. They belong to the pending AI lookup work, including its address-input CSS. Preserve all of them. This baseline includes that work, not just HEAD.
- During the audit, another session committed the existing AI work as `2d03dc8` (2026-11-14, "Plan with AI: batch lookups, keep unresolved places, English queries") and updated its checkpoint. Application/test content hashes remain identical to the captured baseline. Final Git state must be read again before handoff; no Git mutation was performed by this audit.
- The newest checkpoint describes the AI changes accurately; older "clean and pushed" and migration/deployment statements conflict with newer entries. Git and source take precedence. No hosted state was inspected.
- Actual source sizes: `index.html` 338 lines; `src/main.js` 327 lines. Existing dependencies and Node 24.19.0/npm 11.17.0 were available. The existing Vite development server on `:5173` was reused. A temporary production preview on `:4173` was started for this audit only.
- Evidence directory: `tests/out/refactor-phase0-20261114/` (git-ignored). It contains original HTML/main/config/build HTML copies, SHA-256 hashes of tracked files, parsed source/production element and attribute inventories, rendered development/production DOM and startup observations, test logs, and an audit-only capture script. None of those files is application source or a registered test.
- Source DOM: 405 elements, 139 ID occurrences, 138 distinct IDs. The built document has 408 elements (Vite adds head asset links); its body is byte-identical to the parsed source body. Inventory includes element order, parents, every attribute, and direct text. Rendered snapshots also record runtime attributes, document requests and local resource requests.
- Existing duplicate: `mw-status` occurs at both Map Configs and Privacy. `poi-ui.js` uses `getElementById`, so the first occurrence is significant. This conflicts with the original absolute "no duplicate IDs" criterion. Proposed refactor gate: preserve this exact existing pair and introduce no additional duplicates, **only if the owner explicitly accepts the exception**. Otherwise a separately authorized fix and refreshed baseline are required first; do not silently rename either ID during extraction.

### Confirmed HTML boundaries and ownership

Line references below are to the captured pre-refactor `index.html`. Move complete nodes without wrappers or reparenting. Keep existing whitespace initially; assembly should reproduce the original content rather than format it.

| Proposed file | Exact original boundary | JavaScript owners / regression suites |
|---|---|---|
| `src/components/search.html` | Lines 16-22: complete `#search` | `search.js`; `search`, `shell`, `mapsel` |
| `src/components/dock.html` | Lines 25-49: complete `#dock` | `panel.js`, dynamic account button in `account-ui.js`; `shell`, `swipe`, `tabpill`, `friends` |
| `src/components/panel.html` | Lines 51-304: complete `aside#panel`, replacing only its three tab sections and Privacy node with nested includes | `panel.js`; `shell`, `ui`, `paneltall`, `swipe`, `tabpill` |
| `src/components/map-config.html` | Lines 69-136: complete `section#pane-config` | Main settings/region wiring, `theme.js`, dashboard mirrors; `prefs`, `layers`, `opacity`, `mapsel`, `theme`, `dashboard` |
| `src/components/trips-panel.html` | Lines 139-176: complete `section#pane-trips`, including AI input/preview anchors | `trips-ui.js`, `ai-ui.js`; `trip`, `trips`, `tripplan`, `ai`, `sidelist`, `sidedrag` |
| `src/components/poi-panel.html` | Lines 179-218: complete `section#pane-poi` | `poi-ui.js`, selection/reorder owners; `poi1`, `poi2`, `bulk`, `edit`, `stops`, `days`, `cardsel`, `side` |
| `src/components/privacy-panel.html` | Lines 223-303: complete `#privacy`; remains inside the aside, after its main `.sp-body` | `panel.js`, `privacy-ui.js`, dynamically inserted cloud card; `priv`, `mw`, `rain`, `diag`, `autoshare`, `cloud` |
| `src/components/dashboard.html` | Lines 320-334: `section#dash` plus its sibling `#dash-peek` and `#dash-tab` buttons | `dashboard.js`, `splash.js`; `dashboard`, `dashtall`, `dayroute`, `splash`, `swipe` |

`index.html` retains the complete head (including the early inline theme script and `/src/main.js` entry), `#map`, all top-level ordering, `#keystore`, `#datastore`, `#weather`, `#banner` and `#toast`. In particular, keep the two hidden stores before the weather/banner/dashboard nodes. Dashboard code moves the original legend, coverage and export/import/share nodes between those stores and cards; their identity and handlers must survive.

Friends tabs, accounts, party members, sessions, progression, Steam, dialogs, splash, popups and dashboard card bodies remain dynamically generated by their existing JS owners. No static fragment should copy their DOM. All styling continues to belong to `src/styles.css`; the eventual ownership map should link its relevant selectors, without a CSS refactor.

Assembly proposal: explicit `<!-- include: panel.html -->` directives resolved only through a fixed map of these eight names under `src/components/`. Nested includes are needed for the panel, with a recursion stack/cycle error and unknown/missing-file errors naming the include chain. Reject traversal, absolute paths and unexpanded directives. A local Vite plugin runs `transformIndexHtml` before Vite processes module scripts, in both dev and build; it adds fragment watches and sends a full page reload on fragment edit/add/remove. Read fresh content when transforming, with no stale assembled cache. No runtime HTML fetch, new dependency, owner command or deployment step.

### JavaScript dependency audit and proposed extractions

Actual startup, including concurrency (not a new pipeline):

1. Static module imports evaluate first; then debug parameter/error handlers; preferences and theme initialization; Appearance radios; map and scale listener; panel and controls; responsive search hint; popup/base/view settings.
2. Weather card controller and map-app/wind settings; popup helper declarations; rotation and locate controls. The optional launch fix starts without being awaited, with shared `launchCentred`/`userMoved` flags.
3. POI store/UI, migration toast, Privacy, Trips, AI. Read `#import=` before `ai.fromHash()` clears it. Then crosshair, compass, dashboard, splash and quick-setup callbacks. The dashboard/cloud object is shared by reference.
4. `initSyncUI(...).then(...)` starts without being awaited. When a handle exists: assign `cloud.handle`, register change callback, presence, party, `trips.setParty`, friends, account, splash refresh and cloud refresh, in that order. A missing configuration returns null. Keep the existing diagnostic catch. This runs concurrently with region loading; do not await cloud before loading data, or vice versa.
5. Register hold/map-click handlers, then begin the top-level awaited data block. Load public index; optionally merge private/local manifests (failure tolerated); load all public country manifests and places concurrently with the existing nested `Promise.all`. Then initialize point checking and search, country UI/dashboard region actions, point pins, zone layers and legend/coverage.
6. Point-pin loads are currently awaited in region order and failures are logged per region; zones still initialize afterwards. Preserve this ordering/error policy for this refactor. Apply remembered opacity before zone sync. Read the current launch-centering flag when deciding whether to fit zones, not a captured earlier boolean. Preserve debounce and `pagehide` view saving.

| New module | Exact source responsibility and interface proposal | Constraints |
|---|---|---|
| `src/app/point-check.js` | Main lines 115-161: `showWeather`, `decorate`, `showCheck`; factory `createPointCheckUI({ map, panel, weather, addAt })` returns `{ showCheck, showWeather }` | Supply `addAt` through a deferred callback to the initialized POI API. Preserve deferred pin actions, popup sizing/centering, altitude privacy, official links, swipe borders and all error propagation. `pointcheck.js` keeps verdict/data logic; no reverse import of `main.js`. |
| `src/app/map-settings.js` | Main lines 68-74, 82-113: Appearance controls, popup/base settings, map view persistence, map-app/mode and wind controls | Three cohesive entry functions called at the existing stages: `initAppearanceSettings()` after `initTheme()`, `initMapSettings({ map, switchBase, prefs })` before `initWeather()`, `initWeatherSettings({ weather })` immediately after it. Leave scale subscription, responsive search hint and async zone-specific listeners in main. Reuse prefs/theme/weather/maplinks APIs and storage keys. |
| `src/app/region-loader.js` | Main lines 59-63 and 225-247: `loadRegionData()` returns `{ index, regions, places }` | Data loading only; use existing `config.js` URL helpers. Preserve local merge semantics, public failure propagation and concurrent country requests. No map/UI/cloud import and no eager fetch at module evaluation. |
| `src/app/region-ui.js` | Main lines 251-274 and 300-323: `initRegionUI({ map, panel, dash, prefs, index, regions, toast })` returns `{ clearOfPanel }` | Preserve country sorting/defaults, panel-aware bounds, notices, dashboard callbacks, legend and coverage text. Keep separate `renderRegionInfo({ index, regions })` call at the original end of the data block so coverage/error timing does not move before overlays. |

`main.js` keeps diagnostics, toast, explicit startup order, control/launch/POI/trips/AI/dashboard/splash/cloud wiring, gesture registration, the top-level data try/catch, point-pin drawing and zone attachment. Keep `launchCentred` live in that scope. Do not add `bootstrap.js`: the remaining entry point is the useful dependency map. Do not change `map.js`, `pointcheck.js`, `prefs.js`, `panel.js`, `trips-ui.js` or `poi-ui.js` merely to redistribute lines. Extract one responsibility at a time in the order point-check, settings, loader, region UI, rerunning the applicable suites after each.

### Exact proposed implementation file set (not applied)

| Phase | Create | Modify |
|---|---|---|
| 1: HTML | The eight `src/components/*.html` files above; `scripts/html-components.js`; `tests/html-components-unit.mjs`; `tests/html-dom.mjs`; `tests/fixtures/html-dom-baseline.json` | `index.html`, `vite.config.js`, `tests/run.mjs`, `Project_context/docs/DEVELOPMENT.md`, this backlog and `CURRENT_STATUS.md` |
| 2: JavaScript | The four `src/app/*.js` modules above; `tests/region-loader-unit.mjs` | `src/main.js`, `tests/run.mjs`, `tests/cloud.mjs` (delayed optional-cloud startup seam), `tests/launchloc.mjs` (launch/data timing seam), this backlog and `CURRENT_STATUS.md` |
| 3: Ownership map | None | `Project_context/docs/MODULES.md`, `Project_context/docs/ARCHITECTURE.md`, this backlog and `CURRENT_STATUS.md` |
| 4: Navigation | None | `Project_context/AGENTS.md` (short pointer only if the current pointer needs adjustment), this backlog and `CURRENT_STATUS.md` |
| 5: Handoff | Generated test/screenshot evidence only | This backlog, `Project_context/docs/CURRENT_STATUS.md`, `Project_context/docs/CHANGELOG.md` when work is finished |

No `package.json`/lockfile, CSS, data, migration, Supabase function, shared storage format or deployment script changes are proposed. Phase-specific checkpoint edits are documentation only. Existing uncommitted AI changes are not part of the extraction patch. The table names the intended full refactor; approval of Phase 1 alone would authorize only its row.

New checks have specific purposes: assembly unit tests cover fixed-root resolution, missing/unknown includes, traversal/cycles, dev/build expansion and fragment reload using isolated temporary fixture projects; DOM browser tests compare original canonical element/attribute/text inventory with assembled source, dev and production output; loader unit tests stub fetch for public concurrency, local merging/missing-local fallback and public failures. Browser/build tests must use temporary output directories and isolated ports; never edit the running app's fragment files while other suites run. Keep the original inline-theme unit test and add no test solely for file sizes or line counts.

### Risks and acceptance gates

- **DOM/selectors:** preserve complete ancestry, sibling order, text, SVG attributes, `hidden`, checked/selected/disabled values, ARIA ID references, tab defaults and focus targets. Normalize only irrelevant formatting and Vite-generated asset paths/head links. Freeze the original fixture before extraction; never generate the expected inventory from the extracted output.
- **Existing duplicate-ID conflict:** owner must accept the narrowly described `mw-status` baseline exception or authorize its separate correction before the HTML phase can claim acceptance. No other ID change or duplicate is permitted.
- **Build integration:** normal `npm run dev` and `npm run build` assemble all fragments, keep the inline theme script before first paint and the same module entry, leave no include markers in served output, and work under the existing relative `base: './'`. Fragment edit/add/delete updates dev output or produces a useful error; cycles and path escapes fail clearly. No extra HTML network request or user command.
- **Initialization/closures:** factories do no work at import time. Preserve the POI callback's late binding, mutable cloud object, `#import` capture, live location flags, map click/hold consumption, control insertion order, view debounce and pagehide flush. Verify delayed cloud and delayed geolocation/data paths instead of imposing a new await chain.
- **Data/errors:** preserve public/local URL policy, public manifest/place parallelism, local failure tolerance, per-point-region warning and outer zone-data diagnostic/user message. Unconfigured production remains usable without account/cloud UI or Supabase requests. No regulatory interpretation, storage key/shape, privacy/consent, schema or rotation change.
- **Regression evidence:** run affected existing suites after each extraction, then build, full unit and full `npm test` before handoff; inspect errors, not only process exit codes (several suites print `FAIL` without exiting nonzero). Resolve baseline failures separately or get explicit owner acceptance of recorded exceptions. No new failures are acceptable.
- **Visual gate:** the fresh Phase 0 screenshots, not an older design-system snapshot, are the before set. Compare on the same machine/browser, all five viewports/both themes, with zero unexplained changed pixels, missing captures or size mismatches. The existing comparison command reports differences but exits zero, so inspect its report. Record any repeat-run rendering instability before using a threshold; do not silently waive differences.
- **Discoverability:** the component map links each feature to its actual HTML/static or dynamic JS owner, CSS selectors and suites; entry code shows startup dependencies without hiding them in a generic bootstrap. No token-saving percentage is claimed without measuring a navigation task.
- **Owner review:** real-phone keyboard, touch/gesture, rotation and dark-theme behavior remain an owner check; existing design-system tap-target/forced-colors issues are unchanged. No commit, push or deploy is authorized.

### Baseline execution results

| Check | Observed result |
|---|---|
| `npm run build` | Passed; Vite 8.3.7, 149 modules, build reports 982 ms. Existing >500 kB chunk warning (main JS 659.76 kB); no bundle change proposed. |
| `npm run test:unit` | 46/47 suites passed in 33 s. `places-unit`: 22 assertions pass, one fails because expected `Day 1 · Stop 2 · Thu, Nov 12` differs from actual `Day 1 · Stop 2 · Thu, 12 Nov`. `poi.js` uses `Intl.DateTimeFormat(undefined, ...)`; this is a pre-existing host-locale assumption in the test. |
| `npm test` | All 47 unit + 57 browser suites executed; 94/104 suites passed, 10 failed, 761 s. Original result remains a failed run; do not describe it as a full pass. See `tests/out/refactor-phase0-20261114/full-tests.utf8.log`. |
| Resource-error retries | The initial `ui`, `bulk`, `poi1`, `poi2`, `edit`, `trips`, `smoke` failures had console/resource errors. Unrestricted retries passed all seven: `node tests/run.mjs ui` (also selects `steamui-unit`, 46 s), `node tests/run.mjs bulk poi1 poi2 edit trips` (also selects `trips-unit`/`db-trips-unit`, 22 s), `node tests/run.mjs smoke` (14 s). No app edits or test-mock changes. |
| Timing retry | Initial `live`: 30 assertions passed, two failed (Bea's pin moves/disappears). `node tests/run.mjs live --jobs 1`: all selected suites passed, including `live` 32/32 assertions, 55 s total. This matches the checkpoint's existing load-sensitive pin behavior; the initial full run also overlapped screenshot capture, so its elapsed time is not a performance baseline. |
| Remaining failures | `places-unit` (one assertion) and browser `visits` (three assertions), all expecting month-before-day labels while this machine renders day-before-month. Neither is fixed or waived. Across the full run and targeted retries, 102/104 distinct suites demonstrated a passing result; no single green full-suite run is claimed. |
| Parsed DOM/build | 405 source elements / 408 built elements; 139 ID occurrences / 138 unique IDs, duplicate pair `mw-status`. No missing static `for`/`list`/ARIA ID references. Parsed source and built body are byte-identical. |
| Rendered startup | Development desktop/light (1440x900), phone/dark (390x844), production desktop/light: coverage initialized, zero page exceptions. Expected desktop panel/phone rail state and chosen theme observed. Unconfigured production had no cloud/account UI; configured development did. External traffic was blocked in these snapshot contexts. Preview on :4173 stopped; pre-existing dev server :5173 left running. |
| Screenshot matrix | 298/298 captures succeeded; five viewports, light/dark, `msedge 157.0.4341.57`, fixed browser date `2026-11-13T02:00:00.000Z` (the existing tool's seed, not the audit date). Command: `node scripts/ui-baseline.mjs --out "$env:TEMP/UAV_UI_Screenshots" --label refactor-phase0-20261114 --jobs 3`. |
| Screenshot evidence | `C:/Users/cy071/AppData/Local/Temp/UAV_UI_Screenshots/refactor-phase0-20261114/index.html` is the contact sheet; adjacent `manifest.json` records every shot. A manifest copy and capture log are in the ignored evidence directory. Desktop/light point-check and phone/dark Config captures were visually inspected as representative samples; this is not an owner review of all 298 images. |
| Prior design baseline | Existing `~/UAV_UI_Screenshots/baseline`: 258 successful images on Edge 157.0.4341.46; `after-p8`: 298 successful images on Edge 157.0.4341.57. Read only. Use the fresh refactor label for the later before/after comparison because the current tree includes the AI changes. No refactor comparison exists yet. |
| Workspace integrity | Tracked-file SHA-256 comparison: only `CURRENT_STATUS.md` and this backlog differ from the capture. Application, tests and config match the original captured bytes. `git diff --check` passed. Windows sandbox account later failed with error 1909; approved unrestricted commands completed the remaining read-only checks/test retries. |

**Phase 0 complete; Phase 1 has not started.** Final HEAD observed: `2d03dc8`; local branch and remote-tracking ref agree. Only the checkpoint and this backlog are modified by this audit; ignored build/test evidence is retained. No application source edit, commit, push or deploy was performed by this audit. Before Phase 1: owner reviews the boundaries/file set, chooses treatment of the duplicate-ID conflict and the existing locale-sensitive test failures, and explicitly authorizes the next phase. Real-device checks, error-path coverage identified above, assembly/HMR tests and before/after screenshot comparison remain future phase work.

## 10. Separate duplicate-ID correction (2026-11-14)

The owner approved correcting the duplicate before Phase 1. This is a small behavior fix, not a refactor acceptance exception: Privacy should display the same weather/elevation status as Map Configs. The original Phase 0 evidence remains unchanged.

Exact patch:
- `index.html`: rename only the Privacy status element to `pv-mw-status`; retain `mw-status` in Map Configs.
- `src/poi-ui.js`: keep both status elements and write one shared status string to both through the existing update path; correct its stale POI-tab comment. No new listeners, requests, preference keys, CSS or data changes.
- `tests/mw.mjs`: assert all rendered IDs are unique and both scoped status lines agree when disabled, refreshing, refreshed, restored from cache, failed with cached data, and failed without cached data.
- `tests/priv.mjs`: read the visible Privacy status itself; replace the old always-true elevation-status assertion with a check that both lines restore the saved elevation choice.
- `tests/ui.mjs`: update the structural assertion to require the two distinct status IDs in their respective panels.
- This backlog, `CURRENT_STATUS.md` and `CHANGELOG.md`: record verification, the corrected baseline and completed fix history. No commit, push or deploy.

Before the application edit, a browser probe reproduced two `mw-status` nodes with Config text populated and Privacy text empty. Afterwards, the captured source DOM still has 405 elements, now with 139 distinct IDs and no duplicates. The only changed static element attribute is Privacy's ID. Production has 408 elements, the same 139 distinct IDs, and a body identical to source. Desktop/light, phone/dark and unconfigured production startup have no page exceptions or duplicate runtime IDs.

Evidence is in `tests/out/duplicate-id-20261114/` (ignored). Build passed; targeted `mw` 46/46 and `priv` 48/48 assertions passed. The targeted `ui` suite had 37 passing assertions but sandbox resource errors. The original sandbox `/test-impact` selected all 47 unit suites because no unit suite maps `src/poi-ui.js`: 46 passed and `places-unit` failed on the known date expectation; its printed verdict was "unit suites FAILED; not done." Those original results are retained.

Unrestricted verification: full `npm test` passed all 104 suites in 471 s, including modified `mw` (46 assertions), `priv` (48), `ui` (37), plus `visits` (20) and `live` (32). Rerunning `/test-impact` unrestricted passed all 47 unit suites in 30 s; its verdict was "unit part passed; browser suites still to run (--browser or npm test)." The full browser run independently satisfies that requirement.

The locale discrepancy is confirmed: sandbox Node reports `en-SG`, producing `Day 1 · Stop 2 · Thu, 12 Nov`; unrestricted Node reports `en-US`, producing `Day 1 · Stop 2 · Thu, Nov 12`. No production or test date-formatting code was changed. The previous sandbox date failures are explained by execution locale and are not silently waived; the full unrestricted run is green. The existing tests remain locale-sensitive outside the verified environment.

Refreshed screenshots: all **298/298 succeeded**, all five viewports/both themes, Edge **157.0.4341.57**, matching the Phase 0 browser version. Command: `node scripts/ui-baseline.mjs --out "$env:TEMP/UAV_UI_Screenshots" --label refactor-prephase1-20261114 --jobs 3`. The existing fixed clock/seed and locale remain unchanged.

Comparison command: `node scripts/ui-baseline.mjs --out "$env:TEMP/UAV_UI_Screenshots" --compare refactor-phase0-20261114 refactor-prephase1-20261114`. Inspected report: **288 identical, exactly 10 changed**, all named `*-privacy.png` (each viewport/theme). These are the intended addition of the previously blank status text and resulting vertical flow in Privacy; no other screenshots differ. No missing captures or image-size mismatches. Representative desktop/light and phone/dark Privacy captures were visually inspected. No comparison threshold or baseline exception was introduced.

- Corrected baseline contact sheet: `C:/Users/cy071/AppData/Local/Temp/UAV_UI_Screenshots/refactor-prephase1-20261114/index.html`.
- Before/after report: `C:/Users/cy071/AppData/Local/Temp/UAV_UI_Screenshots/compare_refactor-phase0-20261114_vs_refactor-prephase1-20261114/index.html`.
- Local evidence copies: `tests/out/duplicate-id-20261114/{screenshot-manifest.json,screenshot-diff.json,dom-diff.json}`, original source/build/runtime inventories and UTF-8 logs. `dom-diff.json` records the single static ID-attribute change. The original Phase 0 baseline was not overwritten.

**Duplicate-ID correction verified; Phase 1 has not started.** Use the new 139-unique-ID DOM inventory and `refactor-prephase1-20261114` images as the Phase 1 baseline. The strict no-duplicate-ID criterion is restored. Source changes are limited to `index.html` and `src/poi-ui.js`, plus the three browser suites listed above and documentation. No fragment files, Vite plugin, startup extraction, dependency, CSS, schema or data changes. No commit, push or deploy. The temporary production preview was stopped; the existing :5173 dev server remains running.

## 11. Phase 1 implementation and validation (2026-11-14)

Owner authorization: "start phase 1". Phase 2 and all commit/push/deploy actions remain unauthorized. Section 10 is the frozen before state; the following work supersedes its "Phase 1 has not started" handoff.

Implemented:
- Eight approved `src/components/*.html` fragments at the section 9 boundaries; a 41-line root shell keeps the original head/theme/entry, map, hidden shared stores, weather/banner/toast and top-level ordering. Panel includes the three tab sections and Privacy. Dynamic UI stays in its original JS owners.
- `scripts/html-components.js`, enabled by `vite.config.js`: eight registered names under the fixed component directory, recursive standalone include comments, explicit chain errors for unknown/missing/malformed/cyclic includes, pre-Vite HTML transformation in dev and build. No runtime fetching or new dependencies/commands. Registered fragment changes/additions/deletions send a full reload; every transform reads fresh files.
- Frozen `tests/fixtures/html-dom-baseline.json` **before extraction**, recording the complete corrected source digest (LF) and 405-element ancestry/attribute/text inventory. New assembly unit suite (19 checks) and browser/build/reload suite (8 checks), registered in `tests/run.mjs` (48 unit, 58 browser suites). Tests edit only disposable projects and use private caches, dynamic ports and temporary builds; no writes to live fragments or `dist/` from tests.
- `DEVELOPMENT.md` documents include syntax, registration, reloads and fixture policy. Small status corrections in `MODULES.md` and `AGENTS.md` remove claims that the now-existing fragment paths do not exist. This is documentation accuracy required by the repository rules; the full component ownership map and navigation changes remain Phases 3/4.

Verification so far:
- Exact source reconstruction (LF) against the original HTML saved in `tests/out/refactor-phase1-20261114/index-before.html` and the frozen source digest.
- Source, Vite dev and actual production preview match the original 405-element/139-unique-ID DOM after normalizing only Vite-generated head assets. Real browser reload verified on a nested fragment edit. Deletion triggers a reload and clear 500 error on request; recreation triggers a reload and restores successful responses without a Vite restart. An isolated production fixture build expands the nested includes too.
- `npm run build`: passed, 149 modules, same JS/CSS asset hashes as section 10. Production HTML is identical to the section 10 build after removing CR characters (338 in the earlier Windows serialization, none now); no other serialization difference. `main.js`, `poi-ui.js`, `styles.css`, package and lockfile hashes match the corrected baseline.
- `/test-impact` unrestricted: full selection, all **48 unit suites passed (29 s)**; verdict: "unit part passed; browser suites still to run (--browser or npm test)." Full unrestricted `npm test` subsequently passed **all 106 suites in 481 s**, including 19 assembly and 8 DOM/reload checks. Preserve the earlier sandbox locale/resource diagnosis.

Evidence: `tests/out/refactor-phase1-20261114/` (ignored), including pre-test source hashes, original HTML, extraction reconstruction check, built HTML and build/unit/full-test logs. The original shared :5173 Vite server serves the assembled DOM after its normal config reload. No JavaScript startup extraction, CSS, data, storage, schema, deploy-script or dependency change.

Final screenshot gate:
- Command: `node scripts/ui-baseline.mjs --out "$env:TEMP/UAV_UI_Screenshots" --label refactor-phase1-20261114 --jobs 3`; **298/298 captures succeeded**, five viewports and both themes.
- Compared against section 10's `refactor-prephase1-20261114` using the existing `--compare` workflow. **298/298 identical, zero changed/missing/resized captures**. Independent SHA-256 file comparison also found **298 byte-identical PNGs**, so no threshold or rendering exception was needed. Both manifests record Edge **157.0.4341.57** and the existing fixed clock/seed.
- Contact sheet: `C:/Users/cy071/AppData/Local/Temp/UAV_UI_Screenshots/refactor-phase1-20261114/index.html`.
- Comparison: `C:/Users/cy071/AppData/Local/Temp/UAV_UI_Screenshots/compare_refactor-prephase1-20261114_vs_refactor-phase1-20261114/index.html`.
- Copies: `screenshot-manifest.json`, `screenshot-diff.json`, `screenshot-summary.json` and UTF-8 capture/comparison logs in the ignored evidence directory. `verification.json` records production HTML equivalence ignoring CR characters, unchanged runtime/dependency hashes and no implementation changes after tests.

**Phase 1 complete; all Phase 1 gates passed.** The 41-line shell, eight fragments, compiler and registered tests are implemented and verified. The original duplicate-ID correction is intact. Minimal AGENTS/MODULES status corrections keep documentation accurate; full Phase 3/4 work is still pending. Phase 2 has not started. Owner subsequently authorized commit/push/deploy of this release and a Claude handover; publication results follow after success. Original :5173 development server remains running, and integration-test servers/builds/caches were disposed of.
