# UAV Companion — Dashboard, Map Tools, Sessions & Marker UI Refinement

**Status:** OWNER-APPROVED TWO-WAVE DESIGN; RECONCILED WITH POI EXPLORER IMPLEMENTATION; UI IMPLEMENTATION NOT YET AUTHORIZED  
**Prepared:** 2026-11-14  
**Repository:** `muffinMonday/uav-companion`  
**Destination:** `Project_context/docs/DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md`  
**Scope:** Wave 1 approved frontend presentation and navigation; Wave 2 separately scoped visual backlog (NOT authorized for implementation in Wave 1). No changes to application code, commits, push, or deployment are authorized by this document alone.

## 1. Objective and non-negotiables

Reduce clutter and visual inconsistency across the dashboard, dashboard Help, left map controls, contextual legends, Flight Sessions hub, Sessions Map Explorer, and marker/point-check details. Preserve the map-first product, existing teal identity, light/dark support, safety and privacy semantics, user data, and current workflows. The target aesthetic is the restrained mock-up style discussed with the owner: compact purposeful layouts, grouped controls, soft surfaces, clear hierarchy, generous but economical spacing, low visual noise, and a single obvious primary action per context. **This is not a framework migration or a brand redesign.**

Approved decisions:

| Decision | Approved behavior |
|---|---|
| Dashboard density | Focused: tasks, relevant current context, attention items; reference material not permanently displayed |
| Quick actions | Always visible on the default dashboard |
| Help | Dashboard subview, accessible via existing Help entry |
| Left map controls | One **More tools** menu, with Zoom and Locate direct; Compass remains direct only when appropriate to rotation |
| More tools presentation | Anchored popover on roomy screens; compact safe-area-aware sheet on narrow phones |
| Legends | Contextual only, not a persistent dashboard legend |
| Explanations | Essential meaning immediately; detailed interpretation on demand |
| Full Sessions Discover card click | Open Map Explorer focused on the clicked session |
| Sessions Explorer card click | Select and center its session marker (existing behavior) |
| Redundant Map actions | Remove per-card Map buttons; retain global **Explore on map** entry in full hub |
| External place actions | Replace paired **Open in [provider]** + **Navigate in [provider]** with one **Navigate** action in marker and point-check panels; keep provider semantics |
| Delivery | Plan/specification only until owner explicitly authorizes build, commit, push, or deploy |

## 2. Source-of-truth and reconciliation

Read before editing: `CLAUDE.md`, `Project_context/AGENTS.md`, `Project_context/docs/{CURRENT_STATUS,MODULES,DESIGN,UX_DISCOVERABILITY_BACKLOG,SMALL_FIXES}.md`, and this specification. Verify against latest local HEAD, worktree status and current tests. Source code overrides stale documentation; update affected docs with the change. The previous `DESIGN.md` sections 16–18 and `UX_DISCOVERABILITY_BACKLOG.md` describe the *previous* Map/Open/Navigate controls and tag-label button; **this approved specification supersedes those presentation/interaction rules only**. Retain other design, accessibility and privacy rules.

Observed source ownership (verify current checkout):
- `src/dashboard.js`: dashboard card composition, Help toggle, Quick actions, route selection, What's New, check-ins, responsive peek/expanded/hidden states, park/unpark DOM nodes and live summaries.
- `src/dashstate.js`, `src/prefs.js`: dashboard state and persistent settings. Do not migrate/erase existing user data.
- `src/help-content.js`, `help-state.js`, `help-ui.js`, `help-wire.js`, `splash.js`: seven stable help topics, once-per-feature hints, replay, optional Quick Setup.
- `src/map-toolbar-help.js`, `map-tool-labels.js`, `main.js`: label decorator and map control registration; individual Leaflet controls live in `locate.js`, `crosshair.js`, `poi-ui.js`, `sessions-hub.js`, and map zoom in `map.js`.
- `src/sessions-hub.js`, `sessions-map-explorer.js`: hub cards, full-dialog Explore entry, explorer dock/card selection.
- `src/maplinks-ui.js`, `maplinks.js`: shared external map actions, provider/mode preference, Home privacy confirmation; `mapLinkIcons()` currently returns two external actions and `sessionMapActions()` returns internal Map + external Navigate.
- `src/styles.css`: single stylesheet; `Project_context/docs/DESIGN.md` contains typography, token, contrast, touch and layer constraints.
- Related existing tests: `tests/toolbar*`, `tests/discover*`, `tests/help*`, Sessions/Map Explorer, shell/responsive, map links, POI, and screenshot harness; locate actual scripts first.

## 3. Focused dashboard

**Default order:** (1) permanent compact task shortcuts: Check a location, Plan a trip, Save a place, Find sessions (only if feature available); (2) route-building card *while route selection is active* (must retain full controls and prominence); (3) current/next trip, including today/check-in actions; (4) actionable Friends/session invitations, upcoming sessions, backup/storage warnings and What's New where genuinely applicable; (5) minimal region navigation if useful. Avoid empty generic cards.

Consolidate the preexisting `actionsCard()` (Place at map centre, Place at my location, Select markers, Check my spot, Crosshair) with `taskShortcuts()` added by the recent UX pass. Keep four primary task shortcuts always visible. **Save a place must open the POI Explorer and deliberately expand the newly collapsed Add a marker section, using its supported interface; Find saved places must target saved-place search/browse, not creation.** Do not reset selected type, search, filters, hierarchy expansion or visibility preferences. Preserve access to the original operations in their owning POI/Map tools or appropriate secondary menu. Do **not** silently remove features or add extra steps to core operations without a documented alternative. `routeCard()` is a special task mode, not disposable clutter; preserve reorder, reverse, mode, links, and desktop/mobile behavior. Retain `tripCard()` checklist and check-in functionality.

Remove the default `guideCard()`, `keyCard()`, `layersCard()`, and full `dataCard()` from the dashboard presentation only after ensuring every displaced action and warning has an accessible destination. Data import/export/share and cloud status must remain discoverable in existing data/POI/account areas or a concise secondary entry. **Backup-due and storage-nearly-full warnings remain visible when actionable.** Do not change data storage or cloud behavior. Preserve What's New seen-state semantics: switching to Help must not mark unseen content read. Preserve dashboard scroll/selection when possible.

## 4. Dashboard Help subview

Reuse the existing dashboard Help (`?`) entry and dashboard container; do not introduce another modal, global navigation bar, backend, FAQ engine, or second help registry. Default dashboard and Help are mutually exclusive subviews. Help has a visible Back control and clear heading; opening and returning must preserve dashboard height, route state, current trip selection and reasonable scroll position. Use in-memory subview state, not a new preference. Existing external `help-open` entry should open dashboard directly into Help. Closing/collapsing the dashboard should not corrupt either view; Escape and focus return follow existing dashboard patterns.

Help topics: Getting started (optional Quick Setup), Map basics and location checking, Trips/POIs/Side Quests, Flight Sessions/Friends, Map settings, Data/privacy/safety. Reuse the existing stable help IDs and replay actions in `help-content.js`, **including the POI rollout entries `poi-types`, `trip-visibility`, and `newtype-shared` (the latter is an acknowledgement notice, not a routine tip)**. The earlier seven-topic count is obsolete. Reconcile `poi` help text and dashboard shortcuts with the new Explorer; do not duplicate Find saved places / Choose a marker type / Show or hide trip pins. Add only small declarative entries when actually necessary. Keep once-per-feature seen-state and replay semantics unchanged. Make category contents collapsible and keyboard accessible. Never hide mandatory flight-safety notices or privacy consent behind Help.

## 5. Single More tools menu

Direct left controls: Leaflet Zoom +/-; Locate; Compass only in the existing rotation-relevant state; one More tools trigger. More tools contains existing **Marker details**, **Side Quests**, **Trip markers**, **Crosshair**, and **Flight Sessions** (only where available). Global trip-marker and Side Quest toggles must respect POI Explorer precedence: `poi-show` is the overall POI layer gate; `hideTrips` globally overrides trip markers/routes/links; saved `tripHidden` and `unassignedHidden` are independently remembered in the POI Explorer and must never be reset by More tools. `tripFilter`/`showTrip` filter or navigate lists only; never turn them into map focus or a global visibility change. Do not add individual trip switches to More tools. Optionally expose a help/discoverability link within the menu; remove the now-redundant permanent tag-label toggle only after preserving replay and accessible naming. Do not add a second permanent toolbar control for legends.

Desktop/tablet: anchor popover adjacent to trigger without covering search or essential map area. Narrow phone: safe-area-aware sheet; handle short landscape and fold/unfold. Menu rows show label, current state and appropriate toggle/action semantics. Display toggles keep menu open; launching Flight Sessions closes it first. Outside click/Escape closes, restores focus where appropriate. Do not close on every harmless map redraw; close or suspend during marker placement, point picking, exclusive map modes, explorer overlays and conflicting dialogs. No persisted open state; reload starts closed.

**Implementation safety:** Leaflet controls are owned by separate modules and dynamically added/hidden. Inventory DOM and actions first. Prefer minimal adapters to owning control APIs; if delegation via original control activation is necessary, ensure one authoritative state/handler, no cloned functional controls, no duplicate listener, and correct ARIA. Preserve conditional compass, locate follow states, live sessions availability, and all map gestures. Refactor/retire `map-toolbar-help.js` conservatively; do not leave orphan labels or phantom rows.

## 6. Contextual legends and safety

No permanent dashboard Map key. Keep essential region-aware interpretation alongside point-check verdicts and marker zone verdicts; optional `What does this mean?` details show relevant symbols and coverage/semantics. For trip-route lines, offer contextual explanation when routes are displayed/selected. In Map Config, put short explanations next to relevant settings. Reuse existing `#legend`/`#regions-note` or their underlying source data carefully; do not lose event listeners when moving live DOM nodes. Do not hardcode one country's semantics: China `allow` suitable-flight grids differ from Singapore `restrict` layers. Outside data coverage, unknown is **not** permission. Preserve links to official sources and existing regulatory caveats; no flight advice or data changes.

## 7. Flight Sessions hub and Map Explorer

**Full hub Discover:** visually restyle search, filters, tabs and result cards with calmer hierarchy and consistent spacing. Keep existing filter/search semantics and all tabs, invitations, creation, recurrence, host/guest actions. Retain the top-level **Explore on map** action. Remove per-session Map button. **Clicking the card body** opens the existing Map Explorer focused on that session (reuse `explore(section, { focus: s.id })` or latest supported API). Separate **Details** and **Navigate** buttons remain and must stop propagation so they never trigger card selection. Card click target must be keyboard accessible, with visible focus and sensible ARIA; do not nest interactive controls inside a `<button>` or otherwise create invalid nested controls. Cards without a usable meeting point must not pretend they can center a marker: disable or substitute a clear Details fallback and explain why.

**Explorer:** remove redundant Map button from every session card; clicking/selecting the card already focuses/centers the map. Keep Details and Navigate as independent controls. Maintain selected-card highlight, dock/bottom-sheet adaptive layout, map free-area centering, manual pan respect, map markers, Escape, and hub-to-explorer round-trip state. Ensure sessions without coordinates are handled consistently. Avoid shifting map view when a user merely tabs through controls. Prevent click bubbling from Details/Navigate.

Use a single shared session card visual vocabulary (heading, date/time, location, capacity, status and actions) across hub and explorer, with density variants rather than separate designs. Public/private, host, invitation, availability and warnings must remain clear without loud competing badges.

## 8. Marker and point-check detail panels / external navigation

In marker details and point-check windows, replace `Open in Google Maps/Amap` and `Navigate in Google Maps/Amap` with one **Navigate** action. Preserve the existing Maps preference, routing mode, coordinate conversions, `target=_blank`/`rel=noopener noreferrer`, and privacy-confirmation behavior for Home markers. Keep a descriptive title/accessible name such as `Navigate to [place] in [provider]`; short visible label is `Navigate`. Ensure the user can still access the internal map via existing selection behavior. Do not remove map actions in unrelated workflows without inventory and approval.

Fix squashed navigation icon **centrally in `src/maplinks-ui.js` or shared CSS**: square SVG `viewBox`, explicit 16–18px width/height, `flex: none`/`flex-shrink: 0`, and appropriate alignment. Verify on narrow mobile cards, desktop and 200% text zoom. Use the existing icon family/visual stroke style; avoid new icon dependencies.

Style marker types using the **canonical 16-ID `TYPES` registry** in `src/poi.js`, not a second icon or classification table. Display stored `hotel` as Accommodation without changing its ID, distance/base behavior or flight implications; distinguish drone `home` from private `residence`. Preserve ordinary waypoint and Side Quest eligibility for the six new types. Restyle marker detail panels with stronger place-title hierarchy, quieter coordinates/metadata, grouped visit chips, compact navigation, and a distinct readable zone-verdict section. Preserve status colours, semantics, links, edit/visit controls and warnings; do not weaken red restriction warnings or hide official checks.

## 9. Visual styling contract

Use the approved mock-up direction as a **style guide**, not a pixel-for-pixel copy: clean cards, clear section hierarchy, restrained accents, grouped related actions, ample but efficient spacing, lighter visual chrome. Reuse `DESIGN.md` tokens: `--surface`, `--surface-2`, `--fg`, `--muted`, `--line`, `--accent`, `--accent-soft`, semantic verdict colours, radius/space/type tokens and established shadows. Preserve both themes and current brand teal. Avoid raw new colours, gradients, glows, extra shadow layers, `backdrop-filter`, CSS filter tricks, web fonts, frameworks or animation-heavy decoration.

- Section headings should be distinct from body/meta text; use established type roles.
- Cards: 12–16px interior spacing where practical, consistent gaps, soft surfaces and fewer unnecessary nested outlines.
- Buttons: clear primary vs secondary emphasis; consistent height and icon-text spacing; no rows of equally loud bordered buttons.
- Metadata: compact, muted, legible (sentence-case text >=12px on phones); dates, locations and capacity aligned consistently.
- Status badges: quiet but contrast-safe; do not encode meaning by colour alone.
- Touch targets: follow existing 44px coarse-pointer rules, keyboard focus, reduced-motion, screen-reader labels.
- Preserve existing `.dash.tall`, `.sidepanel.tall`, swipe, safe-area, z-index and overlay interactions.
- Design for 390x844, 412x915, 700x850, 850x700, 768x1024, 1440x900; include short landscape, dark/light, 200% zoom and at least one touch configuration.

## 10. Implementation stages and acceptance gates

**Phase 0 — bounded audit (no changes):** check `git status`/HEAD, read only relevant source sections, map all affected controls and current actions, identify exact shared components and tests. Verify two gates: (a) control delegation can be made safe without duplicate handlers; (b) contextual legend source can be reused without losing region semantics/safety text. If either fails, STOP and report precise blocker, do not improvise. Take focused baseline screenshots where feasible.

**Phase 1 — dashboard + Help:** consolidate quick actions; preserve route/Today/check-in, attention cards and data actions; implement Help subview and replay; remove default reference clutter. Targeted dashboard/help/shell tests and mobile screenshots.

**Phase 2 — More tools:** implement adaptive menu and retire tag control, preserve Leaflet behavior and help discoverability. Targeted toolbar, gestures, locate/compass, sessions availability and responsive tests.

**Phase 3 — sessions + navigation + marker visuals:** remove redundant Map actions, wire card-to-explorer selection, single Navigate action and fixed icon, polish hub/explorer/marker cards. Targeted sessions/explorer/maplinks/POI tests.

**Phase 4 — contextual legends + regression + docs:** relocate explanatory material while preserving safety, verify both regional semantics and unknown coverage; update `DESIGN.md`, `MODULES.md`, `CURRENT_STATUS.md`, and old backlog references if needed. Run targeted suites, then build/full tests as feasible; inspect before/after screenshots rather than blindly updating baselines. Document unrelated pre-existing failures separately. No production deploy.

Acceptance checks:
1. New and returning guest see permanent four-task Quick actions (Sessions conditional on feature availability); no duplicated Help/Tips/Map key cards.
2. Help opens/back works without losing trip, route, check-in, dashboard state or unseen update semantics.
3. Only one More tools trigger is permanently present beyond direct Zoom/Locate/conditional Compass; each action works once and states stay synchronized.
4. Menus/sheets do not block search, gestures, point picking, Flight Sessions explorer or mobile dashboard.
5. Discover card body opens explorer focused on that session; Details and Navigate do not trigger card selection; no per-card Map button.
6. Explorer card selects/centers session; Details and Navigate independent; no per-card Map button.
7. Marker/point-check have one short Navigate action with unsquashed icon; provider, privacy and routing behavior preserved.
8. Contextual explanations reflect `allow` vs `restrict` semantics, unknown coverage and mandatory warnings.
9. Both themes, touch, keyboard, screen reader semantics and responsive breakpoints remain usable.
10. No new backend, migrations, data publication, dependency or unrelated behavior change.

## 11. Stop conditions and release controls

Stop for: unclear control ownership, missing authoritative legend semantics, changes requiring database/RLS/privacy defaults, loss of existing functional actions, conflicts with other worktrees, failing safety-related tests, or significant unapproved scope expansion. Report issue, impacted file and minimal choices. **No commit, push, PR, deployment or live data change without separate owner authorization.** This document is a planning artifact and can be placed in the repository by the owner without authorizing execution.

## 12. Two-wave implementation decision (owner-approved, 2026-11-14)

**Wave 1 is the only implementation scope of the accompanying Claude Code handoff.** Sections 1–11 are the authoritative Wave 1 behavior specification: dashboard, Help subview, More tools, contextual legends, Sessions hub and explorer, marker/point-check panels, shared Navigate action, and directly necessary shared visual foundations. Wave 1 may make small reusable token/component CSS improvements *only when required by these surfaces*. Do not treat this document as permission to restyle every screen.

**Wave 2 is a separately scoped, deferred visual consistency backlog**, documented below for future owner review and authorization. Wave 2 must not be silently bundled into Wave 1. Wave 1 may update `DESIGN.md` with reusable patterns and note future adopters; it must not rewrite Wave 2 features. A later Wave 2 prompt should be issued only after Wave 1 is reviewed and its component patterns have stabilized.

### Wave 2 priority inventory (source ownership verified in GitHub default-branch review; verify local HEAD)

| Priority | Surface and source owners | Visual issues to audit / proposed changes | Preserve / acceptance |
|---|---|---|---|
| P1 | Trips and itinerary: `src/trips-ui.js`, `src/components/trips-panel.html`, relevant `src/styles.css` | Reduce visual competition among trip summaries, day headers, stop rows, Side Quests, checklists and edit controls; standardize cards, metadata, disclosure and action placement | Day/stop ordering, drag/hold gestures, Side Quest parentage, dates, check-in, warnings, trip edit and shared-trip behavior unchanged |
| P1 (visual harmonization only) | **Completed POI Explorer**: `src/poi-ui.js`, `src/poi-model.js`, `src/components/poi-panel.html`, relevant CSS | Audit only card/row spacing, taxonomy glyph alignment, selected/hover/focus states, secondary metadata and icon proportions against Wave 1 patterns. No redesign of picker, hierarchy, search or visibility. | Preserve 16 IDs, Accommodation label, grouped picker, all-store search, trip/day folding, saved per-trip/Unassigned visibility, bulk operations, Side Quest/reorder, hidden-marker reveal and all privacy/data rules |
| P1 | Map Config: `src/components/map-config.html`, `src/app/map-settings.js`, `src/app/region-ui.js` | Group basemap, zones, overlay visibility, units and advanced settings into legible sections; clarify labels and inline help; use shared field and disclosure patterns | All settings reachable without extra steps for routine tasks; region semantics, privacy defaults, provider choices and map redraws unchanged |
| P1 (small cross-cutting) | Shared side panel and rail: `src/panel.js`, `src/components/panel.html`, `src/components/dock.html` | Harmonize header spacing, tab treatment, icon alignment, section titles and phone-sheet chrome without replacing navigation | Existing tabs, rail, collapse/tall/fold states, gestures, keyboard and focus retained |
| P2 | Friends and social: `src/friends-ui.js`, `src/party-ui.js`, `src/profile-dialog.js`, `src/profile-popover.js` | Consistent avatar/person rows, sharing indicators, invitation emphasis, profile fields and secondary actions | Friend/party permissions, invitations, visibility and sharing opt-in unchanged |
| P2 | AI trip import and onboarding: `src/ai-ui.js`, `src/splash.js` | Improve step hierarchy, paste/preview validation, progress and primary actions; avoid lengthy instructional blocks | Import schema, validation, user confirmation, optional onboarding and skip flows unchanged |
| P2 | Account, sync and privacy: `src/account-ui.js`, `src/sync-ui.js`, `src/privacy-ui.js`, `src/components/privacy-panel.html` | Unify popover/dialog spacing, status/empty/error states; distinguish consent settings, backup actions and diagnostics | No change to consent, login, data deletion, cloud conflict resolution, export or privacy behavior |
| P2 | Progression and achievements: `src/progression-ui.js`, related profile UI | Refine rank/XP cards, achievement tiles and history information density | Preserve rarity/rank identity colors, progression calculations, unlock states and history behavior |
| P2 | Session creation and management: `src/sessions-create.js`, `src/sessions-hub.js` | Apply Wave 1 card/form styles to create/edit, invite and host-management forms not already polished by Wave 1 | Recurrence, location, capacity, host rights, validation and invitation flows unchanged |
| P3 | Weather, status feedback and notifications: `src/weather.js`, `src/main.js`, shared toast/banner CSS | Standardize compact status lines, loading/error/empty feedback and transient message spacing | Consent, forecast calculations, warnings, announcement behavior and dismissal unchanged |

These are **source-informed candidates**, not proof that every listed screen has a visual defect. Before any Wave 2 implementation, compare actual screenshots against Wave 1 design patterns and remove candidates that already meet the standard. `src/config-ui.js` is **not** a confirmed owner; Map Config is assembled from the HTML fragment and `src/app/` modules above.

### Wave 2 execution contract (future, not authorized)

1. Obtain explicit owner approval for Wave 2, with its own bounded task list and current-HEAD audit.
2. First inventory screens and capture representative before screenshots in light/dark, phone/desktop and short landscape. Identify actual inconsistency; avoid blanket CSS changes.
3. Adopt Wave 1's established typography, spacing, card, button, badge, form and icon patterns using existing `DESIGN.md` tokens. No new framework, web fonts, expensive effects or unrelated refactoring.
4. Implement in small feature slices: Trips/Map Config first, with POI **visual harmonization only** after the new Explorer is verified; social/account/import/progression second; low-priority status polish last. Prefer one slice per Claude session if budget is tight.
5. Run feature-specific tests and screenshots after each slice, plus a final build and one full test pass. Preserve gestures, touch targets, screen-reader names, mobile sheet behavior and all user-data/privacy/safety invariants.
6. Update `DESIGN.md`, `MODULES.md` and status notes with actual changes and deviations. Do not deploy, commit or push without separate authorization.

### Shared visual style guide (Wave 1 foundation; Wave 2 adoption)

- Retain the teal identity and existing light/dark semantic tokens. Follow `DESIGN.md` type scale, spacing, radii, contrast and z-index contracts.
- Use section headings for navigation, quiet metadata for supporting detail, one prominent action per context, and clear distinction between selection and navigation.
- Favor soft surfaces and restrained dividers over nested outlined boxes; consistent card padding (typically 12–16px) and vertical rhythm; avoid cramped labels or excessive whitespace on phones.
- Standardize primary/secondary/quiet/destructive button states, compact semantic badges, 16–18px square SVG icon geometry, consistent focus and hover states, and 44px touch targets on coarse pointers.
- Use grouped filters and clear form labels, validation messages and actionable empty/loading/error states. Progressive disclosure must not bury essential controls, regulatory interpretations or privacy warnings.
- Avoid gradients, glows, additional shadow layers, backdrop filters, decorative animations, new font dependencies and unnecessary bespoke tokens.
- Validate visually at existing baseline viewports (390x844, 412x915, 700x850, 850x700, 768x1024, 1440x900), both themes, and short landscape; record untested real-device/accessibility cases honestly.

## 13. Claude token-budget discipline

Use the provided spec as final product decisions. Avoid broad exploratory redesign, whole-repo rereads, repeated full test suites or speculative refactors. Inspect targeted files with searches/line ranges, preserve existing APIs and CSS tokens, reuse shared helpers, run impacted tests per phase, then one final build/full suite. Give a concise completion report: files changed, behavior, test results, screenshots, remaining risks, and exact approval needed for commit/deploy. If budget is low, prioritize functional correctness and the explicit behavioral changes over optional aesthetic polish; stop at a clean checkpoint rather than half-implementing a broad refactor.

## 14. Post-POI Explorer integration reconciliation (2026-11-14; binding override)

**Source inspection:** GitHub default-branch `Project_context/docs/POI_EXPLORER_BACKLOG.md`, `CURRENT_STATUS.md`, `src/poi.js`, `src/help-content.js` were re-read after the POI work. The current source includes the six added marker types and the new help entries. The status document reports eight implementation phases, local commits `a32388a`, `fc8c085`, `3238744`, `024225e`, `727f2eb`, `db00049`, successful full tests/build and screenshot comparison. **The status explicitly says local commits only, not pushed or deployed.** The handoff must verify its own local HEAD, working tree, branch and exact changes before editing; GitHub visibility is not evidence of production rollout.

### Source-of-truth precedence

1. `POI_EXPLORER_BACKLOG.md` and current implemented source govern POI taxonomy, list hierarchy, search, picker, visibility precedence, data semantics, shared-trip compatibility, POI help triggers and preserved workflows.
2. This document governs Wave 1 dashboard, Help presentation, More tools, contextual legends, Sessions, marker-panel appearance and navigation.
3. `DESIGN.md` governs existing tokens and accessibility; Wave 1 updates only conflicting older presentation rules after code changes are verified.
4. Where current code contradicts either spec, investigate and report rather than silently override the POI implementation.

### Confirmed POI contracts Wave 1 must preserve

- Exactly 16 stored marker type IDs: existing ten plus `food`, `attraction`, `shopping`, `nature`, `transport`, `meeting`. `hotel` displays as **Accommodation**; `home` (drone base) is distinct from private `residence`. Do not add an alternate type registry or change storage/sync/AI schema in a styling pass.
- The POI Explorer has a **collapsed Add a marker** card, grouped single-choice type picker, and Saved places organized by trip, day, main stop, Side Quest, Unscheduled, Outside trip dates, Unassigned and private Home. The Trips tab remains the itinerary editor.
- Search is over all saved POIs regardless of map visibility, viewport or collapsed groups. Expansion is in-memory and search clear restores prior state. Preserve keyboard/drag/bulk selection and map-to-list reveal.
- Map visibility: `poi-show` global POI gate; `hideTrips` global trip override; `tripHidden` and `unassignedHidden` device-local per-group preferences; Side Quest/route visibility follows eligible markers; `tripFilter` and `showTrip` are **list-only**. Home has separate privacy semantics. More tools must not toggle hidden groups or rewrite their saved preferences.
- Help includes `poi`, `poi-types`, `trip-visibility`, and `newtype-shared`. Preserve stable IDs, seen state, acknowledgement semantics and busy-state suppression. Reuse existing POI shortcuts; no duplicate automatic hints or new tooltip engine.
- Creating/importing a marker into a hidden group and opening hidden search results require the already implemented explicit feedback/reveal behavior; a dashboard shortcut must not bypass that contract.

### Specific Wave 1 integration tests / gates

1. **Dashboard:** Save a place opens and expands Add a marker; Find saved places opens search/browse; repeated use does not reset selected type, active query, expansion or preferences. No brittle click-by-ID if a supported POI API exists.
2. **Toolbar:** global switches and per-trip/Unassigned visibility remain independent. Test global-off/per-trip-on, global-on/per-trip-off, Side Quest and routes, Home exemption, hidden-marker selection, and reload. No new Focus on trip feature.
3. **Help:** all existing POI hint IDs are replayable; `newtype-shared` remains acknowledgement-based and cannot be automatically dismissed by the dashboard Help transition; no replay history reset.
4. **Marker UI:** all 16 type glyphs and labels survive marker details, search, edit, imports and selected states; `hotel` stored ID and private Home semantics unchanged. Navigation-only external map control retains privacy confirmation.
5. **Responsive:** new hierarchy, long labels and More tools sheet do not obstruct map picking, POI editing, drag selection or map-to-list reveal on phone/foldable layouts.
6. **Tests:** include new `poi-types-unit`, `poi-model-unit`, `visibility-unit`, `picker`, `hierarchy`, `poisearch`, `visibility`, `helppoi` alongside existing dashboard/help/toolbar/sessions/maplinks suites; run the full suite once near completion.

### Release blocker inherited from POI rollout

The POI status documents a **measured older-client shared-trip downcast**: an older client can receive one of the six new types and write it back as `other` on its next poll, even without a deliberate edit. No server guard or migration was authorized. **Do not deploy the UI overhaul or implicitly approve the POI rollout while this owner decision remains unresolved.** UI work may be developed and tested locally if explicitly authorized, but the Claude handoff must not push, merge or deploy. Do not attempt a backend mitigation as part of styling.

### Wave boundaries

Wave 1 may touch POI components only for the approved dashboard entry point, marker/point-check appearance, shared Navigate behavior, contextual explanation and directly required integration. Wave 2 POI work is **visual harmonization only**, not a second POI Explorer rebuild. Any broader POI behavioral change requires a new decision.

## 15. Implementation status (Wave 1, 2026-11-14; local only)
Wave 1 is built in the working tree (not committed, pushed or deployed); Wave 2 (section 12) is untouched. Behaviour and files: `DESIGN.md` section 20, `MODULES.md`, `CURRENT_STATUS.md`. Deviations: the greeting line stays above the task row; *Find saved places* and *Choose a marker type* are buttons in Help (Trips topic), the four dashboard tasks being Check a location, Plan a trip, Save a place, Find sessions; the zone map key lives in Help (Map basics) and the coverage note in Help (Data, privacy and safety) instead of beside every verdict; the folded explanation beside each verdict is generated from the same region data.

## 16. Implementation status (Wave 2, 2026-11-14)
Owner authorized Wave 2 (commit, push, one `deploy:live`). Slices: (1) Trips and itinerary done (soft secondary actions, flat members box, hairline sections); (4) shared panel header done (compact header at every width; fixes the collapse button clipped by 18px with the Friends tab); (2) Map Config and (3) POI Explorer visual harmonization examined on 9 viewports x 2 themes and **skipped**: they already meet the Wave 1 patterns. (5) P2 and (6) P3 not started (no inconsistency found in the audited screens; the remaining candidates were not screenshotted). Details and deviations: `DESIGN.md` section 21.
