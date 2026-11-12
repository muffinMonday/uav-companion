# Session Checkpoint

Updated: 2026-11-12
Task: Side Quest feature (sub-markers). Phases 5 and 1 committed and deployed (`f96f3be`); phase 2 done, uncommitted. Phases 3 and 4 not started.

## Objective
Side Quests are optional nearby stops attached to a main stop: hidden by default (a "+N" badge on the parent pin, a "▾ N" chip on the parent card), revealed when the parent is opened or expanded, draggable like main cards.

## Agreed design (owner, 2026-11-12)
- Data: `isSub: true` plus optional `parentId` (id of a non-base main marker; default nearest main stop in the trip; if the parent goes, fall back to the nearest). Only for non-base types (never hotel, home, residence). Side quests reuse `order` as position among siblings; every label and list using `order` must skip them. Written only when true: old data, exports and `z2.` links unchanged.
- One predicate `isMain` (in `trips.js`) used by `chainOf`, `tripSequence`, `planDays`, `forecastSpots`, `trips-ui`, dashboard day stops, `seqBadge`, `tripLabel`, `summarise`.
- `z2.` share link: new slots `r[11]` (side quest flag) and `r[12]` (parent as row index); `v` stays 2. No SQL change (`check_trip_doc` and the merge are generic): add test cases.
- Side quests keep distance lines but never act as bases; no date warnings; visit grouping unchanged; check-in "visited" counted separately.
- AI: optional `"sideQuest": true` and `"near": "<main stop name>"` in `public/ai/*`, `aiprompt.js`, `aiimport.js`.
- Map: hidden by default, shown (small dashed pins, dotted connectors) only for the open main stop; pref "Show all side quests" off by default. Lists: tap a card opens the marker and expands its side quests; one expanded card per list; orphans in "Other side quests".
- Reorder: new pure `planSideMove` (siblings, adopt onto a main card, or drop on a day heading as orphan; a side quest takes its parent's date); `planMove` cascades a main card's date to its side quests; side quests collapse while their parent is dragged. POI tab: full. Trips tab: drag within a day page only (option A); today only the POI tab has drag.
- Create/convert: "Add as side quest" in the point-check window, toggle and "Near:" picker in forms, "Make side quest"/"Make main stop" with 10 s Undo, also in Select mode.

## Progress
- [x] Phase 5: check-in restyle. `checkin-ui.js` (icon button `.checkin-btn`, plain green ✓ with the time in its tooltip, new exported `checkinStamp` with the two-step ✕ in the marker window), `styles.css`, `poi-ui.js`; `tests/checkin.mjs` updated; `PROJECT.md` F37 updated
- [x] Phase 1 (committed): data and plumbing. `poi.js` (`isSub`, `parentId`, `isMain`, `stopNo`, `NOT_SUB`; sanitize, export, import), `trips.js` (`parentOf`, `sideQuestMap`, `sideQuests`; `tripSequence` and `planDays` skip Side Quests), `checkin.js` (`visitedCount` main only, `sideVisitedCount`), `places.js`, `poi-ui.js` (stop labels, `chainOf`, `stopDates`, drag and reorder members skip Side Quests), `sharecompact.js` (slots 11 and 12), `aiimport.js` (`sideQuest`, `near`, `linkSideQuests`), `ai-ui.js` (preview tag, parent linking), `public/ai/{prompt.md,schema.json,example.geojson}`, `docs/AI.md`; tests `side-unit` (new, 55), `ai-unit`, `ai` (section 15), `db-trips-unit`, `sharedtrip-unit`
- [x] Phase 2: create and convert. `trips.js` (`defaultParent`, `sideQuestPatch`, `mainStopPatch`), `poi-ui.js` (`addAt(latlng, name, { sub })`, `convert`, `convertMany`, edit form Side Quest box and "Near" picker `.near-lab`, window caption and "Make Side Quest" tool), `main.js` ("Add as Side Quest" in the point-check window), `index.html` (`#sel-side`, `#sel-main`), `cards.js` (flag icon), `styles.css`; tests: new browser suite `tests/side.mjs` (24), `side-unit` (65), `tools.mjs` updated; `PROJECT.md` F45
- [ ] Phase 3: collapsed display on map and in both tabs
- [ ] Phase 4: reorder (`planSideMove`, cascade, POI tab, Trips tab in-day)
- [ ] Docs per phase: F45 in `PROJECT.md`, `DATABASE.md` item shape, `MODULES.md`, `DECISIONS.md`, a What's new entry; browser suite `side`

## Findings
- Until phase 3 there is no UI to create a Side Quest and imported ones show as normal pins and rows in the POI list (no nesting, no "+N" yet); the Trips plan screen does not list them at all (`planDays` skips them; use `sideQuests(items, tripId)` and `sideQuestMap` there).
- `tests/ai.mjs` sections 1 to 14 use the example without its Side Quest row (filtered in the test); section 15 uses the full example.
- Check-in button names kept (`.checkin-btn`, `.checkin-done`, accessible name "Check in at <name>") so tests need small changes only. The row no longer has a ✕; clearing is in the marker window (the window is static, so `checkinStamp` removes its own line when cleared).
- Hubei CRS unverified; licences unconfirmed (owner decision); not tested on real phones; no offline mode.
- Before real users: second Supabase project, closed sign-ups, email confirmation, outside email sender.

## Working State
- Branch: main (pushed `f96f3be`; live site deployed 2026-11-12 with sign-in on, `gh-pages` `f1a98d5`)
- Last commit: `f96f3be`
- Uncommitted changes: Yes, phase 2: `src/trips.js`, `poi-ui.js`, `main.js`, `cards.js`, `styles.css`, `index.html`, `tests/side.mjs` (new), `side-unit.mjs`, `tools.mjs`, `run.mjs`, `PROJECT.md`, `MODULES.md`, this file
- Tests/build: full `npm test` after phase 2: all passed except `tools`, which was then updated and passes (17); phase 1 full run passed (371 s). `npm run build` not run. A dev server is running on :5173 (started this session)

## Blockers
None.

## Next Action
Owner reviews phase 2 and says whether to commit and deploy. Then phase 3: hide Side Quests by default. Map: "+N" badge on the parent pin (bottom-left, `makeIcon` in `poi-ui.js`; the ×N visit badge is bottom-right), small dashed pins with dotted connectors only for the open main stop, pref "Show all side quests" (off). Lists: "▾ N" chip on the parent card in the POI list (`renderGroup`, `renderItem`) and the Trips plan screen (`trips-ui.js` `stopRow`, use `sideQuestMap`), a tap opens the marker and expands (one card at a time), orphans under "Other side quests"; the marker window gets a "Side Quests (N)" section with jump buttons.

## Relevant Files
`src/poi.js`, `src/trips.js`, `src/distance.js`, `src/sharecompact.js`, `src/aiimport.js`, `public/ai/`, `src/poi-ui.js` (`makeIcon` l.29, `chainOf`, list `renderGroup`, reorder l.204), `src/reorder.js`, `src/reorder-ui.js`, `src/trips-ui.js` (plan rows l.216), `src/tripweather.js` l.36
