# Session Checkpoint

Updated: 2026-11-12
Task: Side Quest feature (sub-markers). Phases 5 and 1 done, uncommitted. Phases 2 to 4 not started.

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
- [x] Phase 1: data and plumbing. `poi.js` (`isSub`, `parentId`, `isMain`, `stopNo`, `NOT_SUB`; sanitize, export, import), `trips.js` (`parentOf`, `sideQuestMap`, `sideQuests`; `tripSequence` and `planDays` skip Side Quests), `checkin.js` (`visitedCount` main only, `sideVisitedCount`), `places.js`, `poi-ui.js` (stop labels, `chainOf`, `stopDates`, drag and reorder members skip Side Quests), `sharecompact.js` (slots 11 and 12), `aiimport.js` (`sideQuest`, `near`, `linkSideQuests`), `ai-ui.js` (preview tag, parent linking), `public/ai/{prompt.md,schema.json,example.geojson}`, `docs/AI.md`; tests `side-unit` (new, 55), `ai-unit`, `ai` (section 15), `db-trips-unit`, `sharedtrip-unit`
- [ ] Phase 2: create, convert, parent picker
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
- Branch: main (pushed `0bdcf36`; live site deployed 2026-11-12 with sign-in on, `gh-pages` `9812bd9`)
- Last commit: `0bdcf36`
- Uncommitted changes: Yes: phase 5 (`src/checkin-ui.js`, `src/styles.css`, `tests/checkin.mjs`) and phase 1 (`src/poi.js`, `trips.js`, `checkin.js`, `places.js`, `poi-ui.js`, `sharecompact.js`, `aiimport.js`, `ai-ui.js`, `public/ai/*`, `docs/AI.md`, tests above, `tests/run.mjs`), docs (`DATABASE.md`, `MODULES.md`, `DECISIONS.md`, `PROJECT.md`, this file)
- Tests/build: full `npm test` passed after phase 1 (71 suites, 372 s, 2026-11-12); `npm run build` not run. A dev server is running on :5173 (started this session)

## Blockers
None.

## Next Action
Owner reviews phases 5 and 1 and says whether to commit. Then phase 2: the "Add as side quest" button in the point-check window (`main.js` `showCheck`), the Side Quest toggle and "Near:" picker in the placement and edit forms (`poi-ui.js` `editForm`), "Make side quest" / "Make main stop" with 10 s Undo (marker window bar, Select mode, `store.setMany`), hidden for hotel, home, residence; tests in a new browser suite `side`.

## Relevant Files
`src/poi.js`, `src/trips.js`, `src/distance.js`, `src/sharecompact.js`, `src/aiimport.js`, `public/ai/`, `src/poi-ui.js` (`makeIcon` l.29, `chainOf`, list `renderGroup`, reorder l.204), `src/reorder.js`, `src/reorder-ui.js`, `src/trips-ui.js` (plan rows l.216), `src/tripweather.js` l.36
