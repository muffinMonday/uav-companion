# UAV Companion — POI Explorer & Marker Taxonomy Backlog

**Status:** APPROVED PRODUCT SPECIFICATION — IMPLEMENTATION IN PROGRESS (local commits only; see section 12)  
**Prepared:** 2026-11-14  
**Repository:** `muffinMonday/uav-companion`  
**Canonical destination:** `Project_context/docs/POI_EXPLORER_BACKLOG.md`  
**Review baseline:** `main` at `23c80e8` (verify HEAD again before implementation)  
**Scope:** Frontend POI explorer, marker taxonomy, AI contract, contextual help, tests and documentation. No database migration planned.  
**Authority:** This file describes the agreed product decisions; current code and repository-wide instructions govern how they are implemented. Record any conflict rather than silently altering product behavior.

## 1. Problem, outcome and boundaries

Saved user POIs primarily support travel and drone trip planning. A long POI list is difficult to navigate; available marker types insufficiently describe ordinary travel places. Improve the existing **Points of Interest** tab as a **POI Explorer**, not a second itinerary-planning workspace or a globally maintained POI catalogue.

The POI Explorer's primary tasks are **save a place, find a place, identify its trip/day, select it on the map, and control trip-level map visibility**. The **Trips** tab remains the primary editor for trip metadata, daily itineraries, routing/stop sequencing, notes, checklists and collaboration. Preserve existing POI editing, bulk selection, reordering and Side Quest operations even when those overlap with Trips.

**Locked decisions:**

- Add a marker is compact and collapsed by default, but its current placement actions remain obvious and accessible.
- Saved places browse the **existing itinerary hierarchy**: Trip → date/day → main stop → Side Quest, with Unscheduled, Outside trip dates, Unassigned and private Home sections when applicable.
- Search across **all saved POIs**, irrespective of viewport, collapse state and map visibility.
- Map visibility is remembered at **trip level and Unassigned level** only. Existing global controls continue functioning.
- **Temporary “Focus on trip” is deferred**, as are day-level and individual-marker visibility.
- Use the existing local POI/trip model. Do not create arbitrary persistent groups or a parallel itinerary model.
- Expand the 10 existing marker IDs to **16 IDs** by adding exactly six types; broaden `hotel`'s visible name to **Accommodation** without changing its ID or behavior.
- Grouped marker-type selection is a **presentation-only classification**, not a new stored property.
- Reuse the already released UX & Discoverability infrastructure, not a new tooltip or onboarding engine.
- Preserve local-first, privacy and shared-trip behavior; no Supabase schema change or new RPC is authorized by this specification.

**Out of scope:** new map dock, custom folders, geocoded POI catalogue, clustering, route optimization, user-defined type definitions, marker favorites/recent algorithm, forced onboarding, temporary trip focus, new database schema, and deployment without separate authorization.

## 2. Repo architecture and required inspection

The last read-only review found these integration points (verify them at execution time):

| Component | Current contract / proposed work |
|---|---|
| `src/poi.js` | Authoritative `TYPES`, `typeOf`, `sanitize`, `NOT_SUB`, POI/trip store, GeoJSON. Preserve `uavzones.v1.pois` and `uavzones.v1.trips`; extend registry only. |
| `src/poi-ui.js` | Large Leaflet/DOM owner with `renderList`, `renderTypes`, `tripFilter`, `showTrip`, `fitTrip`, `hideTrips`, `showAllSide`, `addAt`, `addMany`, `flyToItem`, Side Quest expansion, bulk selection and reorder. Refactor narrowly. |
| `src/components/poi-panel.html` | Existing Add a marker and Saved places cards and controls. Compact picker and search/hierarchy additions. |
| `src/trips.js`, `src/trips-ui.js` | `sortTrips`, `dayInfo`, `planDays`, `outsideTrip`, `sideQuestMap`, trips and day views. Reuse date/day and Side Quest rules; do not duplicate Trips UI. |
| `src/reorder.js`, `src/reorder-ui.js`, `src/places.js` | Stop/Side Quest reordering, touch/keyboard drag, same-place visits; preserve. |
| `src/distance.js` | `BASE_TYPES` includes `home`, `hotel`, `residence`; `hotel` is distance/night-coverage base. Keep stored semantics; adjust user-facing wording carefully. |
| `src/prefs.js` | Sanitized `uavzones.v1.prefs`; extend validation for bounded per-trip visibility, with safe defaults and memory fallback. |
| `src/sync/core.js`, `src/sharedtrip/` | Cloud data documents and shared-trip merging. Current synced-settings path is theme-specific; do not put personal visibility into shared trip data. |
| `src/help-content.js`, `help-state.js`, `help-ui.js`, `help-wire.js` | Stable IDs, once-per-feature hints, one-at-a-time display and dashboard replay. Reuse. |
| `src/splash.js`, `src/dashboard.js`, `src/panel.js` | Optional Learn the map, Help shortcuts and tab navigation; keep current UX structure. |
| `src/sessions-map-explorer.js`, `src/view.js` | Responsive/rotation-aware map-centering conventions; borrow principles, not another dock. |
| `public/ai/prompt.md`, `public/ai/schema.json`, `public/ai/example.geojson`, `docs/AI.md`, published `llms.txt` source | Update supported types and explanatory terminology. Discover actual `llms.txt` source location rather than assuming a path. |
| `src/aiimport.js`, `src/ai-ui.js`, `src/aiprompt.js`, `src/sharecompact.js` | AI parsing, preview, source IDs, share links. Audit for type handling and round trips. |
| `src/styles.css`, `Project_context/docs/DESIGN.md`, `MODULES.md`, `DEVELOPMENT.md`, `CURRENT_STATUS.md` | Styling/test conventions and checkpoint documentation. |

Read applicable `AGENTS.md` entrypoints and the latest relevant backlog/status documents before touching code. The previously verified main HEAD was `23c80e8`; the source may have changed.

**Specific existing interactions that must remain distinguishable:**
- `poi-show`: overall POI marker Leaflet layer; do not silently repurpose or change default persistence.
- `hideTrips`: existing global trip-marker/route/Side Quest link hide preference.
- `tripFilter`: **list filter**, not map visibility.
- `showTrip(id)`: opens POI tab filtered to a trip; **not** a temporary map-isolation operation.
- `showAllSide` / `expandedParent`: conditional Side Quest marker visibility and list nesting.
- `showDay`: Trips tab's day route presentation; not new trip/day visibility.
- `ensureVisible()`: existing creation and navigation reveal behavior; audit carefully against new per-trip preferences.

## 3. Final type taxonomy and semantics

### 3.1 Canonical mapping

All IDs are stored and exchanged as lowercase stable strings. Preserve the existing 10 unchanged IDs:

| Stored ID | New visible label | Picker group | Semantics |
|---|---|---|---|
| `home` | Home point | Drone & Safety | Drone flight base; prohibited Side Quest |
| `hotel` | **Accommodation** | Travel & Places | Existing hotel/stay base; prohibited Side Quest; **ID unchanged** |
| `takeoff` | Takeoff spot | Drone & Safety | Ordinary waypoint; existing behavior |
| `landing` | Landing spot | Drone & Safety | Ordinary waypoint; existing behavior |
| `photo` | Photo spot | Drone & Safety | Photo/drone viewpoint; not generic attraction |
| `train` | Train station | Transportation | Train or metro station; existing behavior |
| `airport` | Airport | Transportation | Airport; existing behavior |
| `hazard` | Hazard | Drone & Safety | Caution/location to avoid; existing behavior |
| `residence` | Home (residence) | Special | Private actual home; never trip-linked or Side Quest |
| `other` | Other | Special | Generic fallback |

Add **exactly six** new stored types:

| Stored ID | Visible label | Picker group | Typical examples |
|---|---|---|---|
| `food` | Food & Drink | Travel & Places | Restaurants, cafés, food courts |
| `attraction` | Attraction | Travel & Places | Museums, monuments, general sights |
| `shopping` | Shopping | Travel & Places | Malls, markets, commercial areas |
| `nature` | Nature & Outdoors | Travel & Places | Parks, lakes, trails, nature reserves |
| `transport` | Other Transport | Transportation | Bus stops/terminals, ferry piers, car parks; **not** train/airport |
| `meeting` | Meeting Point | Travel & Places | Gathering/rendezvous locations |

The exact set is **16 IDs**. Do not rename `hotel` to `accommodation` at storage level. Preserve `home` versus `residence` distinction. For new types, use distinguishable glyphs plus adequate color/contrast (do not rely solely on color). Proposed colors are not contractual; follow existing marker SVG style and accessible palette. Keep `typeOf`/`TYPES` canonical; avoid a divergent type-ID registry.

### 3.2 Behavioral constraints

- All six new types behave like ordinary waypoints: optional trip/date/order, may be main stops or Side Quests, and participate in current generic display, search, check-in, distance-to-base and shared-trip behavior.
- Do **not** add the six to `NOT_SUB`, `BASE_TYPES` or special residence/home rules.
- Type never automatically implies Side Quest status, itinerary priority, or permission to fly.
- `hotel` continues to behave as the existing hotel base (date-overlap, lodging-night coverage, distance/max-range logic, cannot become Side Quest). Change user-facing text to Accommodation where appropriate but preserve calculations. A lodging marker is **not** an assertion of legal/suitable launch space.
- The special `residence` stays outside trip membership, automatic sharing/lookups and Side Quest conversion, following existing privacy protections.
- Editing a POI's type must preserve its ID, coordinates, notes, trip/date/order and other valid fields unless the new type's existing explicit semantic constraints require sanitization; warn/confirm where a conversion would remove Side Quest status.

## 4. Compact Add a marker / grouped type picker

Retain the current two-card organization. On a fresh page load, **Add a marker** is collapsed by default; **Saved places** is visible below. The collapsed header must plainly signal how to create a POI and should offer a quick expand affordance. On expand, preserve the placement methods (`Place on map`, `At map centre`, `At my location`), current-trip selector and mode controls without additional confirmation steps.

Marker selection uses one chosen type with four **picker-only categories**:

1. **Travel & Places:** Accommodation (`hotel`), Food & Drink, Attraction, Shopping, Nature & Outdoors, Meeting Point.
2. **Transportation:** Train station, Airport, Other Transport.
3. **Drone & Safety:** Home point, Takeoff spot, Landing spot, Photo spot, Hazard.
4. **Special:** Home (residence), Other.

Use either segmented categories, accessible tabs or a lightweight group selector as consistent with the existing design; **do not show all 16 full-size buttons at once**. Retain the single-choice semantics of current `#poi-types`. The chosen type is page-session state; when editing an existing POI, reveal the correct category/type and do not accidentally replace the stored value. Default group may be Travel & Places; preserve an existing selected type when reopening. Avoid an extra permanent “recently used” dataset.

Do **not** hide vital placement/edit-mode exit controls inside a collapsed panel during an active operation. Preserve mobile panel behavior, keyboard focus, reduced motion and touch targets.

## 5. Saved places hierarchy

Derive, do not persist, the hierarchy:

```
Saved places
├── Trip A
│   ├── Day/date group
│   │   ├── Main stop
│   │   │   └── Side Quest(s)
│   │   └── Main stop
│   ├── Unscheduled
│   └── Outside trip dates (when applicable)
├── Trip B
├── Unassigned POIs
└── Home (residence; private)
```

Use existing `sortTrips`, `dayInfo`, `listMode`, `sortForList`, `outsideTrip`, `sideQuestMap` and related helpers. Dates are authoritative over legacy day fields; do not create dates while rendering. Preserve day-only trips, trips with partial dates, no-date POIs, multi-day lodging, repeated visits and Side Quest/orphan fallback rules. Empty trips may remain visible if discoverability justifies it. Count labels must distinguish descendant POI count from day count; avoid double-counting Side Quests.

Trips and days are collapsed by default on reload; expansion is **in-memory per page** and survives switching app tabs. Side Quest expand/collapse preserves existing `expandedParent` coordination with Trips. Collapse affects only list rows, **not Leaflet visibility**. Selecting a marker on the map must reveal its ancestors, focus/scroll to its row, and preserve current selection/popup semantics.

### Search and filtering

Search the *entire store*, not rendered DOM or visible map: name, note, type label and trip name; case-insensitive. Show helpful trip/day context in results. It must find POIs in collapsed or map-hidden trips and Unassigned/Home as authorized by existing privacy rules (no cross-user data exposure). Clearing search restores expansion state from before search. Search must never mutate store records, visibility, or the chosen trip. Keep existing type and trip filters distinct, clearly indicate active filters, and provide a reliable clear/reset action. Searching for a category label should resolve appropriate types only if consistent with explicit matching rules.

### Bulk selection and ordering

Preserve `Select markers`, bulk type/trip changes, Side Quest conversion, deletion/export and Undo. Selection rules must be explicit: “All shown” means items in the active query/filter scope, not only expanded DOM rows; count and confirmation state always match target IDs. When selecting, reveal relevant hierarchy or switch to a stable selection representation; do not drop selected IDs invisibly. Prevent or defer collapse/rerender during an active drag; preserve current `reorder.js` semantics and Alt+arrow behavior. Ensure check-in bindings, focus, animations, selected-card highlighting and map-to-list reveal survive rerenders.

## 6. Remembered trip-level visibility

**Granularity:** saved visibility for each `tripId`, and one saved setting for unassigned markers **excluding `residence`**. No day-level, per-marker or “focus trip” feature in this release. Use validated, size-bounded device-local preferences via `src/prefs.js`, with visible-by-default fallback for missing entries. Stale IDs should be pruned without damaging other preferences. Storage failures must degrade gracefully for the current page.

**Precedence contract:**

- `poi-show` continues to gate the entire POI Leaflet layer, and its existing persistence semantics are not silently changed.
- `hideTrips` remains the global override for trip marker/route/link visibility; per-trip preferences cannot bypass it.
- When global controls permit drawing, the trip's remembered setting (or Unassigned setting) determines whether that category's markers participate.
- Existing `showAllSide`, main-stop selection/folding and `showDay` route logic still apply *within the eligible set*; route lines and Side Quest links must not outlive hidden owning markers/trips.
- Home/residence follows its current special visibility/privacy rules, not Unassigned visibility.
- `tripFilter` and `showTrip` remain **list-only**; no implicit map focus.

The UI must explain when a trip's per-trip toggle is “on” but overridden by a global switch; toggling a trip should not silently reverse `hideTrips` or `poi-show`. No false eye-state indicators. On creation/import into a hidden trip, provide immediate, temporary marker feedback/reveal or an explicit message without permanently changing the trip preference or revealing the rest of the hidden trip; define/test the exact lifecycle during implementation review. Clicking a hidden search result should provide a deliberate, understandable reveal path rather than invisibly resetting preferences.

Do not insert visibility settings into POI or trip documents or the shared-trip sync payload. `src/sync/core.js` currently has theme-only synchronized settings; no expansion to settings sync is in scope.

## 7. AI import, published schema and legacy behavior

The published schema's `properties.type` enum must accept the canonical 16 IDs:

```json
["home", "hotel", "takeoff", "landing", "photo", "train", "airport", "hazard", "residence", "other", "food", "attraction", "shopping", "nature", "transport", "meeting"]
```

Update `public/ai/schema.json` and `public/ai/prompt.md` together, plus appropriate example(s), `docs/AI.md`, published `llms.txt` source and relevant tests. Retain `hotel` in every machine-readable example and clarify that its displayed label is Accommodation. Explicitly distinguish `transport` from `train`/`airport`, `attraction` from `photo`, and `home` from `residence`. Demonstrate a food stop and optional Side Quest in prompt/examples without changing the envelope contract.

AI preview and parsing must continue to treat unknown types conservatively, validate all names/coordinates/dates, preserve unverified status, allow missing coordinates with lookup consent and never infer flight permission. Keep GeoJSON `uavzones: 1`, current share links, trip matching and check-in rules. No new saved grouping field and no schema version bump is required solely for new enum values.

**Older clients:** existing `sanitize()` maps unrecognized type IDs to `other`; an old client importing/syncing new types can irreversibly downcast them when saving. Do not claim reverse compatibility. Include explicit old-client/shared-trip conflict tests and an owner-visible risk note or mitigation proposal before rollout. Do not change the old-client reality by adding speculative backend migrations. Updated clients must round-trip all 16 IDs.

## 8. UX & Discoverability integration (mandatory)

The previously shipped infrastructure includes:
`src/help-content.js`, `help-state.js`, `help-ui.js`, `help-wire.js`, `splash.js`, `dashboard.js`, `panel.js`, with the `uavzones.v1.help` seen state. Reuse the system, not another tooltip engine.

- Update the existing stable `poi` hint text to explain the redesigned explorer, search and expandable trips to people who have not seen that hint. **Never reset their already-seen state** to replay edited copy.
- Add stable, distinct feature hint IDs for the newly introduced trip visibility control and grouped type picker. Trigger at the first *meaningful* interaction; one-at-a-time, once automatically, dismissible, dashboard-replayable.
- Accommodation/Hotel naming guidance should be inline or optional Help rather than an unsolicited fourth popup.
- Extend existing Dashboard Help/Tips with **Find saved places**, **Choose a marker type**, and **Show/hide trip pins** using existing replay/navigation APIs; do not create another permanent navigation menu.
- The existing optional **Learn the map** should retain its short, skippable structure. Adjust the POI/Trips explanation without adding mandatory steps.
- Suppress/defer new hints during marker placement, marker dragging, bulk selection, active popups requiring action and critical privacy/safety warnings. Do not reclassify required warnings as tips.
- Verify keyboard, reduced motion, screen-reader labels, dark theme, phone bottom-sheet and unfolded/foldable geometry. Existing toolbar labels and help seen-history must be unaffected.

## 9. Implementation phases and review gates

Work in **small, reversible phases**; do not undertake a broad rewrite of `poi-ui.js`. Planning and implementation permissions are separately granted.

| Phase | Work | Exit gate |
|---|---|---|
| 0. Baseline | Verify latest HEAD and module contracts; inspect project docs, tests, screenshots, existing states and sync flows; record user-visible behavior. | Baseline/report ready before code. |
| 1. Taxonomy | Six `TYPES` additions, glyph/color, `hotel` display rename, semantic audit. | Type/side quest/distance and legacy data tests pass. |
| 2. AI contract | Publish type enum/prompt/docs/examples, import/export/shared-trip compatibility tests. | All 16 IDs round-trip on updated client; old-client risk documented. |
| 3. Picker | Collapsible Add a marker, grouped single-choice picker, existing placement/edit controls. | Mobile/keyboard/placement tests pass. |
| 4. Hierarchy | Pure view model where justified, collapsible trips/days, no-date/outside/Unassigned/Home/Side Quest correctness, stable reorder/selection. | Every record reachable; reorder and bulk operations intact. |
| 5. Search | All-POI query, contextual results, filter coexistence, marker reveal and expansion restoration. | Hidden/collapsed matches findable; no data/visibility mutations. |
| 6. Visibility | Validated remembered per-trip/Unassigned preferences; shared resolver; Leaflet markers/routes/links; global override reconciliation. | Reload, overlays, creation and sync cases pass. |
| 7. UX tips | Extend existing hints/onboarding/Help without duplicates; accessibility and responsive polish. | One-time/replay/history/active-mode tests pass. |
| 8. Validation | Build, focused and full relevant tests, screenshot comparisons, risk review, docs/checkpoint. | Criteria satisfied or exceptions documented; separate owner approval for deploy. |

**Implementation authorization boundary:** this document is a specification, not authorization to commit, push, migrate or deploy. Initial Claude handoff should be **read-only planning** unless owner separately instructs implementation.

## 10. Acceptance criteria and test matrix

### Taxonomy / data
- [ ] Exactly 16 canonical IDs; six additions; `hotel` ID unchanged, shown as Accommodation.
- [ ] New glyphs are distinguishable by shape and readable in light/dark modes without relying on color alone.
- [ ] New types are ordinary waypoints and allowed Side Quests; special bases and Home privacy unchanged.
- [ ] Accommodation distance, date overlap, lodging coverage, max-range and Side Quest restrictions remain correct.
- [ ] Existing persisted POIs load without schema migration or silent type changes.
- [ ] All 16 types survive edit, bulk edit, GeoJSON export/import, AI import/preview, share-link and current-client shared-trip round trip.
- [ ] AI schema, prompt, types registry, examples and docs are consistent; associated tests detect drift.
- [ ] Old-client unknown-type downcast risk has an explicit regression demonstration and rollout mitigation decision.

### Picker / explorer
- [ ] Collapsed Add a marker is obvious and expandable; creation/placement/edit/exit actions remain functional.
- [ ] Four picker groups expose every type; only one type selected; proper accessible labels and keyboard operation.
- [ ] Saved places are discoverable without trip preselection, including undated trips, outside dates, Side Quests, Unassigned and Home.
- [ ] Trip/day collapse is list-only, resets on reload and persists across tab navigation in the same page.
- [ ] Map selection reveals hierarchy ancestors and the right POI row, without changing stored POIs.
- [ ] Search finds POIs across hidden/collapsed trips and shows trip/day context; clear restores prior expansion.
- [ ] Existing type/trip filtering and bulk selection remain accurate (counts and targets match).
- [ ] Desktop, touch and Alt+arrow reorder preserve semantics; no list DOM replacement interrupts an active drag.

### Visibility / map
- [ ] Per-trip and Unassigned visibility retained across reload with safe defaults and corrupt-storage fallback.
- [ ] `poi-show` and `hideTrips` retain their precedence, meaning, and current persistence behavior.
- [ ] Side Quest links, trip routes and day presentations never leave orphan overlays for hidden trips.
- [ ] Home is unaffected by Unassigned visibility and remains private as before.
- [ ] New/imported markers in hidden trips give understandable immediate feedback without resetting saved preferences.
- [ ] `showTrip` remains list navigation; no temporary focus feature introduced.
- [ ] Per-trip visibility is device-local and absent from shared-trip payloads.

### UX / release
- [ ] Existing `poi` help seen-state preserved; new feature hints shown once and available via dashboard replay.
- [ ] Hints are suppressed/deferred during drag, placement, bulk selection and critical confirmations.
- [ ] Existing optional Learn the map flow remains short/skippable and directs users correctly to POIs versus Trips.
- [ ] Screens at desktop, phone portrait/landscape, unfolded phone/tablet, light/dark, reduced motion and keyboard pass.
- [ ] Existing POI, Trips, AI, shared-trip, reorder, help, toolbar and responsive tests pass; build succeeds.
- [ ] Screenshot diff reviewed, relevant new tests added, known flakiness distinguished from regressions.
- [ ] Implementation status, deviations, tests and rollback notes recorded in project docs.

## 11. Known risks and decision policy

1. **Unknown type on old client:** old `sanitize` downgrades it to `other`; special attention to shared-trip edit/merge. Owner approves any mitigation that changes the release policy.
2. **`hotel` semantics:** UI rename must not alter the distance/base rules or imply drone-launch authorization.
3. **High coupling in `poi-ui.js`:** its list renderer is tightly linked to Side Quest expansion, selection, check-ins and reorder; extract *only* narrow pure helpers, not a wholesale rewrite.
4. **Visibility versus existing switches:** do not conflate `poi-show`, `hideTrips`, `tripFilter` and conditional Side Quest drawing.
5. **Expanded type grid:** grouping is essential to avoid making compact Add a marker more overwhelming.
6. **UI hints:** avoid overwhelming new or returning users; keep seen state and maintain warning separation.
7. **Shared and local state:** only POI data travels with shared trips; map presentation remains device-local.
8. **Saved data safeguards:** no silent deletes, resets, ID regeneration or schema migration of existing trips/POIs.

When a requirement contradicts live code or an existing project-level decision, report the conflict, choose the least destructive compatible behavior for planning, and request owner approval before changing any consequential product decision.

## 12. Implementation status

Owner authorization (2026-11-14): implement all approved phases autonomously; local commits at verified checkpoints; no push, PR, deploy, migration or production data change without separate approval. Plan: `C:Userscy071.claudeplanspasted-content-id-94a6-uav-companion-silly-grove.md` (decisions A, B, C and the six listed decisions approved).

### Phases 1 and 2: taxonomy and AI contract (2026-11-14, local commit)
- **Changed:** `src/poi.js` (six types appended after `other`; `hotel` label Accommodation; `typeOf` falls back to `other` by id; `TYPE_GROUPS` and `groupOf`, presentation only), `src/sharecompact.js` (frozen `SHARE_TYPE_ORDER`; an unknown type is written as `other`, not `home` as before), `src/distance.js` (label and short wording), Accommodation wording in `poi-ui.js`, `trips.js`, `trips-ui.js`, `dashboard.js`, `privacy-panel.html`, `trips-panel.html`; `public/ai/{schema.json,prompt.md,example.geojson}`, `public/llms.txt`, `docs/AI.md`. Stored ids, `NOT_SUB`, `BASE_TYPES` ids and all calculations are untouched.
- **Share links:** types are encoded as a position, so the six are appended and the order is frozen; links made before open identically (tested against hand-built old rows). An older build decodes a new position to `other`.
- **Tests:** new `poi-types-unit` (40); `share-unit` (frozen table, all 16 through a real link), `ai-unit` (llms.txt and AI.md drift, wording), `trip-unit`, `plan-unit`, `sharedtrip-engine-unit` (new block), browser `trip`, `tripplan`, `poi1`, `mapsel`, `ai` wording updates. `tests/fixtures/html-dom-baseline.json`: two paragraph texts and the digest updated on purpose (Hotel to Accommodation; element count and ids unchanged).
- **Old-client risk, now measured (worse than assumed in the plan):** `sharedtrip-engine-unit` simulates a build that knows only ten types. It receives `food` as `other`, and **on its next poll, with no edit, saves the downcast type back to the server** (the stored copy differs from the last synced document, so `syncTrip` calls `push`). The marker's `updated` stamp is not bumped, but nothing stops the push. So one older client in a shared trip silently turns the new types into Other for everyone. Mitigations available without a migration: the approved once-per-browser notice when a new type is used in a shared trip (Phase 7), and rolling out only after every member has the new build. A server-side guard would need a migration and was not authorized. **Owner decision needed before deployment:** accept this, or ask for a guard.
- **Not verified:** the six new pin glyphs on screen (checked with the picker in Phase 3), real devices.


### Phase 3: collapsible Add a marker and grouped picker (2026-11-14, local commit)
- **Changed:** `src/components/poi-panel.html` (Add a marker is a `<details id="poi-add">`, folded on every load, header "Tap to choose a type and place it on the map"; the display switches stay inside it as before), `src/poi-ui.js` (four group buttons with `aria-pressed` over 16 radio buttons kept in `#poi-types`, only the open group shown, "Chosen: X" line, one `setSelectedType` used by clicks and by Side Quest creation; default type Accommodation; edit form and Side Quest note; `setMode` opens the card), `src/styles.css`.
- **Decision C implemented:** a Side Quest made while Accommodation, Home point or Home is chosen switches the picker to Other, with a message, and it stays Other until changed. The old silent conversion in `addAt` is gone. In the edit form a Side Quest whose type is changed to one of those three shows a note that saving makes it a main stop.
- **Deviation:** the group buttons are plain buttons (`aria-pressed`, like the filter chips), not `role=tab`: `role=tab` is the panel's own tab pattern and tests and code query it. Arrow keys between groups were not added; Tab reaches each button.
- **Tests:** new browser suite `picker` (about 55 checks: folded on load, header text, one-row height, keyboard open, all groups, one choice across groups, banner, edit mode opens the card, Side Quest switch, six new types as Side Quests, grouped edit form, reload, phone portrait, phone landscape dark, tablet dark with touch). `tests/lib.mjs`: contexts open the card unless `addFolded: true`; `pickType()` helper. `poi1`, `trip` use it. HTML DOM fixture regenerated on purpose (one `div.card` became `details > summary > span` and `div.add-body`; 405 to 408 elements, one new id).
- **Screenshots:** `tests/out/picker-*.png` (viewed: desktop open, phone). Pins of all 16 types are distinguishable by glyph in the grid.

### Phase 4: folding hierarchy (2026-11-14, local commit)
- **Changed:** new pure `src/poi-model.js` (scopes, counts, fold state, reveal, prune, unlinked Side Quests); `src/poi-ui.js` `renderList` (trip and day `.sec-toggle` buttons, folded rows get `hidden` and stay in the page, header counts, "outside trip dates" tag, Unlinked Side Quests subheading, Home as its own scope, redraw held while `body.reordering`, creation/import/map selection open the row's trip and day); `src/styles.css`.
- **Behaviour:** trips and days fold on load, state in memory only (survives tab switches). Selecting markers, a type filter or a trip filter shows everything (fold buttons disabled) and gives the folds back after. Folding is list-only; map and records untouched.
- **Deviations:** "No date set" kept as the Unscheduled label (existing tests and reorder wording); "No trip" kept as the Unassigned label; empty trips stay hidden as before; Unassigned has no day folds.
- **Tests:** new `poi-model-unit` (29), browser `hierarchy` (about 50 checks incl. phone, landscape dark, tablet dark with touch). `tests/lib.mjs` presses every fold button unless `listFolded: true`. Full `npm test` all suites passed (630 s).
