# Session Checkpoint

Updated: 2026-11-12
Task: Side Quest feature (sub-markers). All five phases (5, 1, 2, 3, 4) built; phase 4 committed, pushed and deployed with this checkpoint. Standing rule: commit, push and deploy after every phase (memory `commit-deploy-each-phase`).

## Next feature
Account and profile milestone: backlog in `docs/ACCOUNT_BACKLOG.md` (phases A to E). Phase A (data safety: AC-1 sign-out wipe, AC-2 identical-data adoption after a lost upload answer, AC-3b one device shares live location) is built and tested; migration `20261112100000_live_device.sql` pushed to the hosted project on 2026-11-12; AC-3 test-only items covered in `tests/sync-engine-unit.mjs`. Phase B (AC-4 account button and popover in the panel header and on the rail, AC-5 every Sign in button opens it; `src/account-ui.js`, PROJECT F46) is built, tested (`test:unit`, `npm test` all pass), committed, pushed and deployed. Phone header: tab strip shrinks and icon buttons are 30 px under 520 px so the close button stays on screen. Phase C (AC-6 splash account row: `src/splash.js`, `dashstate.account`, PROJECT F44) is built and tested (unit and `npm test` pass); Phase D (profile: AC-7 migration `20261112110000_profile.sql`, AC-8 editor, AC-9 display; `src/avatars.js`, `src/profile-ui.js`, PROJECT F47) is built and unit and browser tested, pushed to the hosted project and deployed with `deploy:live` on 2026-11-13; Phase E (AC-10 migration `20261113100000_delete_account.sql`, edge function `supabase/functions/delete-account`, delete dialog in the account popover; AC-11 DECISIONS; AC-12 release checklist in DEVELOPMENT.md; PROJECT F48) is built, tested, applied (migration), deployed (edge function `delete-account`, version 1, ACTIVE, verify_jwt on) and published with `deploy:live` on 2026-11-13. Smoke-tested without a real account: no token 401, GET 405, publishable key as token 401, preflight 204; the full delete path was not run against the hosted project. The milestone's code is complete; remaining before real users is the release checklist; after each phase: test, commit, push, deploy, then ask the owner.

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
- [x] Phase 3: folded display. `poi-ui.js` (`computeSide`, `sideHidden`, `sideOf`, `setExpanded`, `drawSideLinks`, nested rows `li.side-row[data-sub]`, `.side-chip`, window section `.pop-side`, switch `#poi-showside`, `sideState` export), `trips-ui.js` (`stopRow` chip and `.plan-group`/`.plan-side`, orphans under the day card, `poi.sideState.onChange(render)`), `reorder-ui.js` (`slotsFor` skips `[data-sub]`), `prefs.js` (`showSide`), `index.html`, `styles.css`; tests: new browser suite `tests/sidelist.mjs` (30), `side.mjs` adjusted (25)
- [x] Phase 4: reorder. `reorder.js` (`planSideMove`, `stepSideIndex`, `planMove` `sides` cascade), `reorder-ui.js` (Side Quest slots, fold on lift, `flat` mode, any `[data-drag]` element), `poi-ui.js` (`applySideMove`, `dropRow`, `stepRow`, exported `moveStop`/`stepStop`), `trips-ui.js` (day pages draggable within the day), `styles.css`, `whatsnew.js` entry; tests: `reorder-unit` (48), new browser suite `sidedrag` (30), `sidelist` adjusted
- [x] Small fixes (`docs/SMALL_FIXES.md`): SF-1 name tag clears the seq badge (`styles.css` `.name-tag`); SF-2 POI cards keep one width, chip inside the card (`poi-ui.js` `.poi-card`, `styles.css`, `tests/sidelist.mjs` width check). Trips-tab day cards not changed.
- [x] Small fix SF-3 (2026-11-12): swipe to close the marker window and the point-check window (`onPopupSwipe` in `swipe.js`; `poi-ui.js`, `main.js`); not in edit mode; test `tests/popswipe.mjs`. The whole pane moves with the finger (`translate`, `onSwipe` `css` option); committed and deployed with the follow-up.
- [x] Small fix SF-4 (locate icon off-centre, 5 px high): the icon's wrapper span is now a centring flex box (`styles.css` `.locate-btn .locate-icon`); check in `tests/locatemode.mjs`. Committed in the same commit as the code.
- [x] Small fix SF-5 (popup swipe): fades with the drag and dismisses without snapping back (`swipe.js` `fade` option and `finish`; `tests/popswipe.mjs` fade block). Committed `b326b14` and deployed.
- [x] Items 2 and 3 of the 2026-11-12 round (committed with the code): clicking a marker scrolls the open panel to its card (POI list, or the trip's day card, turning to its day; a Side Quest unfolds its parent), and the selected marker's card is highlighted in both panels, the parent card too while a Side Quest is selected (`poi-ui.js` `cardIds`/`markCard`/`paintCards`/`revealCard`, `cards` API; `trips-ui.js` `revealStop`; `styles.css` `.is-sel`); new browser suite `tests/cardsel.mjs` (32).- [x] Docs: F45 in `PROJECT.md`, `MODULES.md`, `DECISIONS.md` (`DATABASE.md` item shape already covered; stored shape unchanged)

## Findings
- Until phase 3 there is no UI to create a Side Quest and imported ones show as normal pins and rows in the POI list (no nesting, no "+N" yet); the Trips plan screen does not list them at all (`planDays` skips them; use `sideQuests(items, tripId)` and `sideQuestMap` there).
- `tests/ai.mjs` sections 1 to 14 use the example without its Side Quest row (filtered in the test); section 15 uses the full example.
- Check-in button names kept (`.checkin-btn`, `.checkin-done`, accessible name "Check in at <name>") so tests need small changes only. The row no longer has a ✕; clearing is in the marker window (the window is static, so `checkinStamp` removes its own line when cleared).
- Hubei CRS unverified; licences unconfirmed (owner decision); not tested on real phones; no offline mode.
- Before real users: second Supabase project, closed sign-ups, email confirmation, outside email sender.

## Working State
- Branch: main. Phase 4 commit follows the status in git log
- Tests/build: `npm run test:unit` and full `npm test` all passed before the What's new entry; `dashboard`, `shell`, `smoke`, `sidedrag` re-run after it and pass
- A dev server may be running on :5173

## Blockers
None.

## Next Action
Feature complete. Optional follow-ups: try the drag on a real phone (not tested on touch devices); in the Trips tab the drop index assumes every stop of the day has an `order` (ties are broken differently in `planDays` and `sortForList`); move the Side Quest notes in this file to CHANGELOG.

## Relevant Files
`src/poi.js`, `src/trips.js`, `src/distance.js`, `src/sharecompact.js`, `src/aiimport.js`, `public/ai/`, `src/poi-ui.js` (`makeIcon` l.29, `chainOf`, list `renderGroup`, reorder l.204), `src/reorder.js`, `src/reorder-ui.js`, `src/trips-ui.js` (plan rows l.216), `src/tripweather.js` l.36
