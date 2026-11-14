# Flight Sessions Map Explorer — Implementation Backlog

**Status:** Planned; implementation authorized only by the owner's separate execution prompt.  
**Repository:** `muffinMonday/uav-companion`  
**Canonical path:** `Project_context/docs/backlogs/completed/FLIGHT_SESSIONS_MAP_EXPLORER.md`  
**Scope:** Frontend, tests, documentation and controlled deployment. No database, permissions or session business-rule changes.

## Approved decisions

- Adaptive docking: **left panel** on unfolded foldables/tablets/desktop, **bottom sheet** on folded/narrow phones; use viewport geometry and pointer capabilities, not device detection.
- In docked Explorer, **tapping a card selects its individual session occurrence and centers its marker in the unobstructed map region**. Scrolling must not trigger selection. Details remains a separate action.
- Each eligible session card has compact, outlined **Map** (focus internally on UAV Companion's Leaflet map) and **Navigate** (external directions) buttons, plus **Details**. Card action taps must not trigger card selection twice.
- Existing POI marker-detail and point-check popups adopt the **same icon + text outlined style**, but retain their existing **Open in Maps** (external) and **Navigate** (external) behavior. Distinguish internal Map from external Open in Maps in the labels.
- Reuse Google Maps/Amap provider choice, travel mode and existing link utilities. Preserve two-step confirmation for Home/residence location sharing.
- Keep the full modal Sessions Hub for creating, editing, invitations and management. Explorer is a **non-modal** browsing surface so the Leaflet map remains interactive.
- Entering Explorer from a general Discover action does **not** automatically select a card or pan the map. Entering via a specific card's Map action selects/focuses that card.
- Public sessions remain guest-discoverable; private sessions and coordinates only appear to authorized signed-in users. No new public RPC or Supabase permission changes.

## Current architecture to inspect and reconcile

At planning time, `src/sessions-hub.js` owns the `<dialog>`, `rowFor()`, `openDetail()`, `showOnMap(list, focus)`, session filters and scroll state. `showOnMap()` suspends the modal, creates a Leaflet marker layer and shows a floating bar; it cannot browse a docked list. `src/styles.css` has responsive `.ses-hub`, `.ses-row`, `.ses-bar` and `.sidepanel` rules. `src/maplinks-ui.js` owns `mapLinkIcons()` and existing marker actions; `src/maplinks.js` owns `placeUrl()`, `hereUrl()`, `resolveApp()` and provider/mode logic. `src/poi-ui.js` and `src/app/point-check.js` are integration points. `src/main.js` initializes the hub; `src/panel.js` manages the main side panel. Start with `tests/sessions.mjs`, `tests/responsive.mjs`, existing map-link/POI tests and `Project_context/docs/MODULES.md`. **Latest source wins if the code changed after this plan.**

## UX and layout specification

1. **Explore on map** action transitions from modal Hub to non-modal dock, preserving current tab, filters, pagination, list scroll and any session draft.
2. Side dock roughly 300–360 CSS px wide, capped around 42% of viewport. If it would leave insufficient map space, use bottom docking. Bottom sheet roughly 30–40% of visible height, scrolls independently, respects safe areas and keyboard.
3. Header offers **Expand** (restore full Hub), **Collapse** (compact handle) and **Close** (exit Explorer and clean up). Buttons have accessible labels and comfortable touch targets.
4. Compact cards show title, occurrence date/time, place, visibility and attendance/capacity. Selected card has visible focus/selection styling and semantic selected state. Separate actions: **Map**, **Navigate**, **Details**. Wrap gracefully on narrow widths.
5. Details from Explorer expands the full Hub focused on that occurrence. Expand otherwise restores the prior tab/filter/scroll. Fold/rotation changes dock location without losing selected ID.
6. Use one authoritative session state; do not create independent private/public caches with divergent permissions. Reuse the existing marker layer where practical and ensure no duplicated markers or listeners.

## Map positioning

- Keep the existing Leaflet map container unchanged for MVP. Measure map and dock rectangles via `getBoundingClientRect()` and compute the **unobstructed visible rectangle** (account for any other active overlays or controls).
- Use Leaflet's projection/container-point APIs or equivalent rotation-aware pixel offset to place the selected marker at the center of the visible map rectangle. Do not simply call `map.setView()` to the full-container center and assume the marker remains visible.
- On first explicit selection, choose a practical zoom (~14–15) if necessary; subsequent selections preserve user zoom. Honor reduced-motion preferences.
- Rapid card selection: latest selection wins, with stale animations and requests ignored. Manual map pan/zoom remains untouched until the next explicit selection.
- Recompute offset after dock transitions, resize, orientation/fold and visual viewport changes. Verify behavior when map rotation is enabled.
- Identical coordinates across recurring occurrences: keep separate selected session IDs and show the selected date/occurrence without indistinguishable duplicate marker clutter.
- Missing or invalid coordinates: Details remains available, but Map/Navigate are omitted or disabled with a clear explanation.

## Shared map action component

- Reuse `src/maplinks.js` and `src/maplinks-ui.js`; do not duplicate SVGs, navigation URLs, coordinate conversion or provider selection.
- Use a small shared outlined button pattern (e.g. `.map-action`) with icon + **visible text**, responsive wrapping, dark/light styling and keyboard focus indicators. Target at least 44×44 CSS px on touch devices.
- Sessions: **Map** is an internal `<button>`; **Navigate** is an external `<a target="_blank" rel="noopener noreferrer">` using the configured app/mode. Existing marker and point-check controls: **Open in Maps** and **Navigate**, both external links; preserve their semantics.
- Preserve Home/residence two-step sharing confirmation. External coordinates are shared only after explicit action.
- Avoid nested interactive elements: card selection must be keyboard-operable and independent from buttons/links; prevent accidental propagation.

## Privacy, state and edge cases

- Guests receive only public data; private coordinates are never fetched via public RPC. On sign-out, immediately remove private cards, markers, selected private state and stale async results.
- A cancelled, unpublished, blocked or newly unauthorized session disappears from Explorer on refresh; clear selection safely.
- Recurrent sessions are selected by occurrence ID, not series ID. Invitation scopes and attendance behavior remain unchanged.
- Preserve Hub search filters, tab, pagination, scroll, selected session, creation draft and focus on transitions. Explorer and map-point picker are mutually exclusive modes.
- If the main right-side panel obscures the map, temporarily close/collapse it without rewriting the user's saved preference.
- Close cleans up temporary layers, listeners and bar state. Escape/Back should behave predictably: details → Hub, Explorer → exit, and focus returns to the launching control.
- Render untrusted session titles/locations with text nodes, not unsafe HTML interpolation.

## Proposed files

| File | Expected changes |
|---|---|
| `src/sessions-map-explorer.js` (new) | Non-modal dock, selection, map centering, markers, cleanup |
| `src/sessions-hub.js` | Explorer integration, card actions, transitions, preserved state |
| `src/styles.css` | Adaptive dock, selected card and shared outlined action styles |
| `src/maplinks-ui.js` | Shared button presentation; preserve external links and Home confirmation |
| `src/poi-ui.js`, `src/app/point-check.js` | Only minimal integration if required for shared styling |
| `src/main.js` | Only if small initialization change is needed |
| `tests/sessions.mjs`, `tests/responsive.mjs` | Explorer, touch, keyboard, privacy, geometry, foldable tests |
| Map-links, POI, point-check test suites | Existing external URL/confirmation behavior and new styling |
| `Project_context/docs/{CURRENT_STATUS,CHANGELOG,MODULES,DESIGN}.md` | Agent handoff, ownership, design and release record |

## Test and acceptance criteria

- Test 390×844 folded, 700×850 and 850×700 unfolded, 768×1024 tablet, desktop, landscape, light/dark, touch and keyboard.
- Explorer does not make Leaflet inert; map pan/zoom and normal controls work while dock is open.
- Card selection centers the **marker screen position** within ~16 CSS px of the unobstructed map rectangle center after animation settles, including bottom/left dock and rotation. Checking `map.getCenter()` alone is insufficient.
- Map button focuses the correct occurrence; Navigate respects app and travel mode; Details opens the correct session without double activation.
- Rapid taps settle on the last selection; scrolling does not recenter; manual pan is respected.
- Same-location recurring occurrences remain distinguishable. Missing-coordinate cards remain usable without broken map actions.
- Public/guest and private/authenticated boundaries remain intact, including sign-out and stale asynchronous requests.
- Filters, scroll, selected ID, drafts, focus, Escape/Back and dock state survive appropriate transitions.
- Existing POI and point-check buttons show outlined icon + text with unchanged external behavior, URLs and Home consent.
- No regression in Trips touch, session creation/RSVP/invitations, map, POI, dashboard and responsive layouts.
- Run repo `/test-impact`, targeted suites, `npm run test:unit`, `npm test`, `npm run build`, and screenshot comparisons. Visually inspect intentional changes; report emulated versus physical-device checks.

## Autonomous implementation and release workflow

1. Read `CLAUDE.md`, `Project_context/AGENTS.md`, `Project_context/docs/CURRENT_STATUS.md`, `Project_context/docs/SMALL_FIXES.md`, `Project_context/docs/MODULES.md`, `Project_context/docs/DESIGN.md` and this plan. Inspect `git status`, recent commits and ongoing agent work.
2. Create this plan at its canonical path from the supplied file **before coding**. If a file exists there, reconcile rather than overwrite newer decisions. Register it in the existing backlog/agent navigation docs without deleting prior content.
3. Baseline current screens/tests. Implement incrementally: dock → map centering → shared card actions → POI/point-check visual consistency → state/privacy cleanup.
4. Test and document each increment. No Supabase migrations, database writes, feature-flag changes, secrets or unrelated feature work.
5. After all tests pass, update `CURRENT_STATUS.md`, `CHANGELOG.md`, `MODULES.md`, `DESIGN.md`, and commit/push verified code and docs. Use `npm run deploy:live` for the frontend; verify deployed assets and perform non-destructive guest smoke checks.
6. Stop for conflicting agent work, unexplained test failures, private-data exposure, destructive changes, missing credentials or uncertain deployment target. No force pushes or concealed failures.

**Final report:** root causes/design choices, changed files, before/after screenshots, test results, commit SHA, push/deploy verification, and any physical-device checks still outstanding.

## Implementation status (2026-11-14)

**Implemented**, tested, committed and deployed under the owner's feature-scoped authorization (frontend only; no migration, RLS, business-rule or flag change). Details, results and commit: `CURRENT_STATUS.md`; changelog entry "Flight Sessions map explorer"; design rules `DESIGN.md` section 17; code map `MODULES.md`.

Where the code deviates from, or interprets, this plan:
- **Dock threshold:** the side dock is used whenever the viewport leaves at least 320 px of map beside a dock of `clamp(36% of the width, 300, 360)` px (from about 620 px wide: unfolded phones, tablets, desktop); narrower viewports get the bottom sheet (`min(40%, max(180 px, 36%))` of the visual-viewport height). Chosen from viewport geometry only, no device detection. At 700 px the dock is 300 px (43%).
- **Labels:** marker and point-check windows keep the app-named labels from before (**Open in Amap** / **Open in Google Maps**, **Navigate in <app>**) because the app is picked from the Maps settings; session cards say **Map** (internal) and **Navigate**.
- **Entry points:** an **Explore on map** button on Discover, My sessions and Invitations (the list's own cards), a **Map** button on every card with a point, and the detail's "Show on the map". The old "Show these on the map" bar is gone; the picker bar stays.
- **"Back":** Escape closes the explorer (details to hub is the hub's own Back/Escape). No history entry is pushed for the explorer.
- **Several occurrences at one place:** one marker with a count badge; tapping it steps through the occurrences; the selected occurrence's date is in the marker's title.
- **Main side panel:** stays open unless it would leave under 320 x 200 px of free map; then it is hidden through `panel.suspend()` (not saved) and restored on close.
- **Popup button height:** inside marker and point-check windows the controls are compact (30 px) with a touch target grown by `::after`; session cards use 44 px on touch. The windows are about 20 px taller than before, so on a short phone the last row scrolls into view sooner.
- **Not verified:** a real foldable, a real phone, real Android toolbar and keyboard behaviour; Safari. Emulated only (Playwright touch and viewport sizes).
