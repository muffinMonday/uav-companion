# HTML and main.js Refactoring — Backlog and Implementation Plan

**Status:** PLANNED — NOT IMPLEMENTED.  
**Decision date:** 2026-11-13.  
**Authorization:** This plan is documentation only. Ask the owner before implementation, commit, push, migration or deployment.  
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

This is a backlog, not an active task. When the owner authorizes a phase, read the current `AGENTS.md`, `CURRENT_STATUS.md`, `MODULES.md`, relevant design docs and latest source; inspect the working tree and recent commits. Follow `.claude/skills/change-workflow`, `test-impact`, and relevant project rules. Ask before committing, pushing or deploying. Do not apply the progression-specific standing deploy permission to this refactor.
