# UAV Companion — UX & Discoverability Backlog

**Status:** IMPLEMENTED AND RELEASED 2026-11-14 (see section 14)  
**Prepared:** 2026-11-14  
**Repository:** `muffinMonday/uav-companion`  
**Canonical destination:** `Project_context/docs/backlogs/completed/UX_DISCOVERABILITY_BACKLOG.md`  
**Scope:** Frontend UX discoverability, map toolbar labels, optional onboarding, contextual help, task-oriented navigation and selective progressive disclosure. No database or production changes are authorized by this document alone.

## 1. Purpose and success criteria

UAV Companion has accumulated powerful map tools, POIs, Trips, Friends, Flight Sessions, dashboard, account/privacy and map configuration. New visitors may struggle to understand icon-only controls, hidden gestures, and where to find features.

**Product goal:** A new guest should understand the basic map and discover the most common actions within the first minute, without burdening experienced users or cluttering the Leaflet map.

**Guiding principles**
- Preserve the map-first interface and existing control behavior.
- Teach by task and context, not by enumerating every feature at startup.
- Default to compact UI; reveal labels or advanced controls on demand.
- One hint at a time, never repeated after completion except on explicit replay.
- No forced signup, location prompt, tracking or new backend.
- Accessibility and existing safety/privacy confirmations take precedence over visual minimalism.

## 2. Owner-approved decisions

| Topic | Approved decision |
|---|---|
| Left map toolbar | Expandable labels; icons remain compact by default |
| Expansion persistence | Current page only; reset to collapsed after reload; no localStorage/sessionStorage persistence |
| Onboarding architecture | Integrate into existing Quick Setup, not a separate mandatory tour |
| Onboarding presentation | Optional orientation within Quick Setup; immediately skippable |
| Contextual hints | Once per feature, dismissible, replayable on request |
| Help/replay entry | Existing dashboard Help / Quick Setup, not a new permanent navigation button |
| Implementation authorization | **Not granted by this document**; owner must explicitly authorize Claude's execution/deployment |
| Community Flying Areas | Future feature; provide extensible help registry but do not implement it |

Interpret “once per feature” as one automatic presentation per browser profile after the feature is first meaningfully encountered; replay does not reset the seen state. Use local-only versioned persistence with in-memory fallback.

## 3. Repository reconciliation (verify against latest HEAD before editing)

At planning review, relevant source owners included:
- `src/locate.js`: dynamic Leaflet locate and compass controls; some titles/ARIA labels change with state and compass may be hidden when north-up.
- `src/crosshair.js`: dynamic Leaflet crosshair control and persistent crosshair preference.
- `src/main.js`: initializes map, map controls, panel, dashboard, Quick Setup, POIs, Trips and Sessions.
- `src/map.js`: Leaflet map creation, zoom and scale controls.
- `src/styles.css`: Leaflet control classes `.locate-btn`, `.compass-btn`, `.details-btn`, `.map-toggle`, `.cross-btn`, `.sessions-btn`, plus foldable/phone rules.
- `src/splash.js`: existing first-visit Quick Setup, task choices such as Plan a Trip / Plan a Flight, Continue as Guest and Skip.
- `src/dashboard.js`: existing guide/help card, Quick Setup replay action, task cards and Help button.
- `src/panel.js`: tab navigation, open/close and mobile bottom sheet.
- `src/prefs.js`: persistent application preferences in `localStorage`; do **not** add toolbar expansion here.
- `src/touch.js`: touch-friendly modal/focus utilities.
- `Project_context/docs/{MODULES,DESIGN,CURRENT_STATUS,SMALL_FIXES}.md`: source ownership, conventions and current state.

**Important:** Controls are built in several modules, not one toolbar. Inspect the actual DOM/control inventory and dynamic state before choosing how to attach labels. Avoid cloning controls or rebinding original handlers. Respect newer Map Explorer or other features if they have landed since this plan was written.

## 4. Phase 0 — UX inventory and baseline

Before editing, prepare a compact inventory of every left-side Leaflet control:
- Selector, module owner, visual icon, title, ARIA label, current action and on/off state.
- Visibility rules (including compass conditional visibility), location relative to Leaflet zoom controls and map overlays.
- Keyboard/touch behavior and any interaction with hold-to-check, map drag, rotation, location follow, point picking and Sessions Map Explorer.

Also inventory existing first-run and dashboard guide entry points and common tasks. Identify duplication and misleading terminology.

Capture baseline screenshots at 390×844, 412×915, 700×850, 850×700, 768×1024 and 1440×900; include light/dark and touch configurations. Record initial usability friction. Do not assume a user study has been conducted.

**Gate:** Owner-approved choices are compatible with latest code; no contradictory onboarding or duplicated controls.

## 5. Phase 1 — Expandable labelled map toolbar

### Behavior
- Default compact icon-only controls. Add one clearly labelled, keyboard-operable **Show map tool labels** toggle.
- When expanded, show readable labels beside *existing* Leaflet controls in their current order. The controls themselves retain their click handlers, hover/focus behavior and state.
- The toggle announces `aria-expanded` and `aria-controls`; expanded labels are visible text, not tooltip-only.
- Expanded state exists only in in-memory page state. Reload resets it; route/tab changes within the page need not reset it.
- Labels reflect actual **current action**, not static feature names, including:
  - Locate: “My location” / “Stop following” (verify exact semantics)
  - Compass: “Reset to north” (only if control visible)
  - Crosshair: “Show crosshair” / “Hide crosshair”
  - Marker details: “Show marker details” / “Hide marker details”
  - Map display/overlays: “Show map details” / “Hide map details” (verify exact behavior)
  - Flight Sessions: “Browse flight sessions”
  - Leaflet zoom controls: inventory and decide whether to include; do not duplicate or mislabel.
- Prefer an unobtrusive adjacent label flyout/decoration rather than moving/recreating Leaflet controls. Use DOM state observers or explicit state hooks sparingly; avoid continuous polling.
- If a control is hidden, its label must not remain as a phantom row.
- Preserve original accessible names even while collapsed.

### Layout
- Narrow phone: compact flyout, no blocking essential map controls, keyboard and map center.
- Unfolded foldable/tablet/desktop: vertical labelled tool strip sized to content.
- Short landscape: constrained height with scroll or alternate placement.
- Support safe areas, browser chrome, 200% text zoom, RTL-safe spacing where practical, touch targets and reduced motion.
- Dismiss via toggle, Escape where appropriate, or clear outside action; avoid stealing map clicks and do not auto-collapse on every normal control use unless needed for safety.
- In map point-picking or other exclusive interaction modes, temporarily hide or disable expanded labels if they obstruct instructions, without discarding state.

**Gate:** All existing control actions work identically; dynamic labels and hidden compass are correct; no map gesture regressions.

## 6. Phase 2 — Optional onboarding integrated into Quick Setup

Retain existing task-first Quick Setup (`src/splash.js`). Add a **Learn the map (optional)** path or short optional orientation reachable without disrupting Plan a Trip / Plan a Flight / Continue as Guest.

Suggested content:
1. Understand official map information; map coloring and overlays are not blanket authorization to fly.
2. Check a location; explain the actual point-check interaction and difference from saving a POI.
3. Find your tools; demonstrate expandable labels and show where Trips, POIs and Flight Sessions live.

Rules:
- Skip available immediately and at every step.
- Returning users who reopen Quick Setup can go directly to task selection; orientation is never mandatory.
- Preserve the selected Quick Setup task and inputs if entering/leaving orientation.
- Do not request geolocation, sign-in or notifications automatically.
- Never hide legal/restriction disclaimers or privacy confirmations behind tutorial completion.
- Replay from existing dashboard Help; no second splash system or competing help modal.

**Gate:** New guest, returning guest, signed-in user and replay journeys are correct, with no lost task state.

## 7. Phase 3 — Contextual help, once per feature

Create a small declarative registry with stable IDs, short user-facing text, target/trigger and optional action:
- `map-tools`: first meaningful map interaction / first map-tools discovery.
- `point-check`: first relevant map check journey.
- `poi`: first opening POIs.
- `trips`: first opening Trips; distinguish day, destination, Side Quest and hold-to-reorder.
- `sessions`: first opening Flight Sessions; Discover, My Sessions, Invitations.
- `friends`: first opening Friends; distinguish friendship from opt-in sharing.
- `map-config`: first opening Map Config; layers and map preferences.

Use an accessible, nonblocking inline hint or small anchored popover. Only **one** automatic hint at a time. Dismiss/complete both mark it seen. Do not queue a flood of missed hints. Explicit replay can show any item without changing completion state.

Store only a versioned set of seen hint IDs locally, separate from `uavzones.v1.prefs`; never store account IDs, coordinates or other sensitive data. Handle storage disabled/corrupt data with memory fallback. Version migrations should not replay everything accidentally.

Avoid automatic hints during modal dialogs, map pin picking, live-location consent, destructive confirmations, full-screen Sessions workflows or other sensitive actions.

**Gate:** Each hint appears once, can be dismissed/replayed, is accessible, and does not interrupt user actions.

## 8. Phase 4 — Task navigation and selective progressive disclosure

Add a task-oriented section within the existing dashboard Help card, **not** another persistent navigation bar:
- Check a flying location → existing point-check flow, with a clear instruction if it requires map interaction.
- Save a place → existing POI add/open flow.
- Plan a trip → existing Trips / Quick Setup trip flow.
- Find people to fly with → existing Flight Sessions Hub.
- Customize the map → Map Config.

Use existing panel and Sessions APIs; do not simulate brittle DOM clicks if public methods exist. Guest actions remain available where supported; explain sign-in only when actually needed.

Audit advanced settings in Map Config, Trips, POIs, Friends and Sessions. Hide secondary controls only when it improves clarity **without increasing steps for essential actions**. Prefer clear headings and optional disclosure over burying core actions.

Measure click/tap count for representative tasks before and after. Avoid changing business logic, permissions, database APIs or privacy defaults.

**Gate:** Each shortcut reaches its intended feature; common tasks are no harder to complete.

## 9. UX and technical edge cases

- Leaflet controls are separate dynamic DOM nodes; labels must survive conditional insertion/removal.
- Compass hidden at north-up; no orphan label.
- Dynamic locate/follow, crosshair and overlay labels update after changes made elsewhere in the UI.
- Map rotation, hold-to-check, marker placement, map panning, zoom and Sessions Map Explorer must not be blocked by the flyout.
- Fold/unfold, orientation, browser visual viewport, keyboard, screen-reader focus and 200% text zoom.
- Browser reload collapses toolbar; within-page navigation retains state.
- Guest→signed-in and sign-out transitions must not trigger repeated hints or expose private data.
- Storage unavailable or invalid: graceful memory-only behavior.
- Rapid tab switching: no stale or stacked hints.
- User has already completed old Quick Setup: do not force a new tutorial.
- Help replay does not reset user settings or hint completion.
- Regulatory and privacy confirmations remain mandatory and separate from dismissible help.
- Existing responsive and aesthetic refinements, Trips touch fix and Map Explorer (if present) remain intact.
- No telemetry or analytics added without separate privacy approval.

## 10. Proposed file changes

**New candidates (create only when justified):**
- `src/map-toolbar-help.js` — decorate existing Leaflet controls and manage expansion state.
- `src/help-content.js` — central stable-ID help registry.
- `src/help-state.js` — local-only seen state, versioning and fallback.
- `src/help-ui.js` — shared accessible hint presentation and replay.

**Likely edits:**
- `src/splash.js` — optional orientation within existing Quick Setup.
- `src/dashboard.js` — task-oriented Help and replay.
- `src/main.js` — minimal initialization/wiring.
- `src/styles.css` — label flyout, responsive hints and onboarding.
- `src/panel.js`, `src/locate.js`, `src/crosshair.js`, map-control modules — only small state hooks if necessary.
- Relevant existing tests and `tests/run.mjs`.
- `Project_context/docs/{DESIGN,MODULES,CURRENT_STATUS,CHANGELOG}.md`.

No new framework, server storage, Supabase migration, secrets or deployment setting changes.

## 11. Tests and acceptance matrix

**Unit tests**
- Help registry IDs unique; text and targets valid.
- Once-per-feature state, dismiss, replay, invalid storage, migration/version and fallback.
- Toolbar expansion reset on reload; dynamic labels and conditional visibility.

**Browser tests**
- All existing Leaflet buttons still perform original actions when collapsed and expanded.
- Keyboard tab order, focus return, Escape and screen-reader labels/states.
- First-run guest orientation, Skip, returning-user Quick Setup, selected task preservation.
- Hint once/dismiss/replay, rapid tab changes, guest/account transitions.
- Dashboard task shortcuts reach correct destinations.
- No blocked map taps, hold-to-check, drag, rotation or pin picker.
- Folded/unfolded/tablet/desktop, portrait/landscape, light/dark, reduced motion, large text.
- Existing Trips touch, POI, Sessions, map, dashboard and privacy regression suites remain green.

**Release checks:** targeted tests during implementation; then `npm run test:unit`, `npm test`, `npm run build`, relevant screenshots and visual inspection. Capture baseline and after screenshots; do not blindly replace baselines.

**Usability targets for later real-user evaluation (not automatable proof):**
- Find location check, POI creation and Flight Sessions within ~30 seconds each.
- Understand left map control meanings without guessing.
- Existing users complete common tasks without extra steps.

## 12. Phases and acceptance gates

0. Inventory controls, onboarding and task paths; baseline screenshots.
1. Expandable toolbar with dynamic labels; map interaction/accessibility tests.
2. Optional Quick Setup orientation; new/returning/guest tests.
3. Once-per-feature contextual hints and dashboard replay; persistence tests.
4. Task-oriented Help shortcuts and selective progressive disclosure; click-path tests.
5. Full regression, visual review, documentation and release verification.

Each phase requires targeted tests and a concise checkpoint. Prefer small commits. No implementation/deployment authorization is implied by the backlog itself.

## 13. Agent execution and safety

When explicitly authorized by the owner:
1. Read `CLAUDE.md`, `Project_context/AGENTS.md`, `Project_context/docs/{CURRENT_STATUS,SMALL_FIXES,MODULES,DESIGN}.md` and this plan; check `git status`, latest commits and current deployment state.
2. Inspect the real Leaflet control DOM and existing onboarding before implementation; source is authoritative where the plan lists candidates.
3. Work incrementally, run impacted tests, and record deviations.
4. Preserve current product behavior, accessibility, user data and all privacy/flight-safety warnings.
5. Commit/push tested work; deploy frontend with `npm run deploy:live` only after all release checks pass and authorization covers deployment.
6. Verify the live build and conduct non-destructive smoke tests; document any real-device limitations.

**Stop and consult the owner** if changes require backend permissions, migration, destructive operations, security-sensitive policy changes, conflicting agent work, unresolved test failures or an uncertain deployment target.

**Final handoff:** controls inventoried, UX changes, tests, screenshots, files/commits, deployment evidence, limitations and follow-ups.

## 14. Implementation status (2026-11-14)

Owner authorized implementation, commit, push and `deploy:live` for this feature only. Frontend, tests and docs; no database, RLS, secret or flag change.

**Phase 0 inventory (left-hand Leaflet controls, top to bottom):** zoom +/- (Leaflet; no `data-tool`, not labelled); `locate` (`locate.js`, three states, aria-label carries the action); `details` (`poi-ui.js`, marker details on/off); `side-quests` and `trips` (`poi-ui.js` `ToggleControl`, aria-pressed); `crosshair` (`crosshair.js`, aria-pressed); `sessions` (`sessions-hub.js`, added after the cloud code loads, only when accounts exist); `compass` (`locate.js`, hidden while north-up); then the new `labels` toggle. Existing guidance before the change: Quick Setup (`splash.js`: Plan a trip, Plan a flight, guest/profile, Skip), the dashboard Help card (four steps, "Run the quick setup again"), and a one-off toast about press-and-hold. Baseline screenshots: `~/UAV_UI_Screenshots/ux-before-20261114` (298).

**Built:** `map-toolbar-help.js` + `map-tool-labels.js` (phase 1), orientation in `splash.js` (phase 2), `help-content.js`, `help-state.js`, `help-ui.js`, `help-wire.js` (phase 3), task shortcuts and Tips list in `dashboard.js` (phase 4), CSS in `styles.css`, `data-tool` attributes on the controls, an `onOpen` callback on `initSessionsHub`.

**Deviations and decisions**
- The +/- zoom buttons are not labelled: their meaning is plain and their labels would sit under the search button.
- Label wording, checked against the code: the "map display" toggles are the Side Quests and trip-marker buttons, so the labels are Hide/Show Side Quests (off state: "Show all Side Quests") and Hide/Show trip markers; "Show/Hide marker details" belongs to the speech-bubble button. Locate reads My location, Follow me, Stop following.
- A hint counts as shown after 1.5 s on screen or when dismissed, so one flicked past by switching tabs is not used up. Replay never changes the seen list.
- `map-tools` is also marked seen when the visitor presses the tag button; `point-check` shows on the first point-check window.
- The Sessions hint sits under the hub's tabs (not for a deep link to one session). The orientation is a link under the task cards, not a fourth card, so the task choices stay primary.
- The Help card shows the sessions shortcut and the Friends/Sessions tips only where accounts exist.
- Short coarse screens (max-height 480 px): left buttons are 3 px apart so the extra button fits above the scale bar.
- Progressive-disclosure audit (Map Config, Trips, POI, Friends, Sessions): no secondary control was hidden. Each already sits under a clear heading and hiding any would add a step for a common action; the shortcuts and hints address discoverability instead. Click counts: check a location 2 (Help, shortcut) as before 0 steps of guidance; save a place 2; plan a trip 2 (the existing "Plan a trip" link stays at 1); customize 2; none of the existing paths gained a step.
- Test harness: `tests/lib.mjs` and `scripts/ui-baseline.mjs` mark hints as seen so other suites and the screenshot set are not shifted by a first-visit hint; `discover` starts without them.

**Tests:** unit `help-unit` (37); browser `toolbar` (74), `discover` (62); see `CURRENT_STATUS.md` for the full-run and screenshot results.

**Not verified:** a real foldable or phone, Safari, a screen reader, real 200% browser text zoom (only a larger root font was tested).

> **Superseded in part (Wave 1, 2026-11-14):** the tag button and its label layer were replaced by the More tools menu, and the dashboard Help card and Tips list by the Help subview. See `DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md` and `DESIGN.md` section 20. Hints, orientation and the once-per-feature rules are unchanged.
