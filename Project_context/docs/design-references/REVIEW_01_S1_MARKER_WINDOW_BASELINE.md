# Review 01, S1 baseline: the marker window today (2026-11-21)

Part of [UAV_COMPANION_UI_UX_REVIEW_01_PROPOSED_BACKLOG.md](../backlogs/for-review/UAV_COMPANION_UI_UX_REVIEW_01_PROPOSED_BACKLOG.md), step S1. Measured on `main` at `cd70661` with no code change. Status: evidence, not a specification.

## 1. Method

- Capture script (local, git-ignored): `tests/out/review01-baseline/capture.mjs`; raw numbers in `baseline.json`; 40 screenshots in the same folder (about 19 MB, not committed). Dev server on :5173, Microsoft Edge through Playwright, Hubei view, reduced motion.
- Fixture: one trip (dates in December 2026), stops Bravo (day 2, stop 1, has a Side Quest) and Charlie (unverified), a hotel and a Home marker. Bravo is the measured window: live zone verdict, distances, note, Side Quest link, previous / next. The Home window was captured too (marker `Flat` in `baseline.json`).
- Ten viewports, each expanded and collapsed: 320x640, 360x740, 390x844, 430x932, 520x800, 660x800, 760x900 (touch), 1080x800, landscape 640x360, and 640x400 (the area left at 200% zoom on a 1280x800 window).
- Not covered: a real phone, dark theme, a rotated map, the point-check window, the Sessions explorer, TalkBack and VoiceOver.

## 2. Geometry (Bravo)

| Viewport | State | Window (px) | Of map width | Of map height | Pin | Content | Attribution height |
|---|---|---|---|---|---|---|---|
| w320 | expanded | 289 x 384 | 90% | 60% | covered | scrolls | 50 px |
| w320 | collapsed | 289 x 192 | 90% | 30% | clear | scrolls | 50 px |
| w360 | expanded | 329 x 444 | 91% | 60% | covered | scrolls | 50 px |
| w360 | collapsed | 329 x 242 | 91% | 33% | clear | scrolls | 50 px |
| w390 | expanded | 341 x 506 | 87% | 60% | covered | scrolls | 50 px |
| w390 | collapsed | 341 x 294 | 87% | 35% | clear | scrolls | 50 px |
| w430 | expanded | 341 x 559 | 79% | 60% | covered | scrolls | 34 px |
| w430 | collapsed | 341 x 338 | 79% | 36% | clear | scrolls | 34 px |
| w520 | expanded | 341 x 480 | 66% | 60% | covered | scrolls | 34 px |
| w520 | collapsed | 341 x 272 | 66% | 34% | clear | scrolls | 34 px |
| w660 | expanded | 341 x 570 | 52% | 71% | covered | fits | 34 px |
| w660 | collapsed | 341 x 272 | 52% | 34% | clear | scrolls | 34 px |
| w760touch | expanded | 341 x 570 | 45% | 63% | covered | fits | 34 px |
| w760touch | collapsed | 341 x 322 | 45% | 36% | clear | scrolls | 34 px |
| w1080 | expanded | 341 x 568 | 32% | 71% | covered | fits | 17 px |
| w1080 | collapsed | 341 x 272 | 32% | 34% | clear | scrolls | 17 px |
| land640x360 | expanded | 341 x 306 | 53% | 85% | covered | scrolls | 34 px |
| land640x360 | collapsed | 341 x 160 | 53% | 44% | clear | scrolls | 34 px |
| zoom200 | expanded | 341 x 340 | 53% | 85% | covered | scrolls | 34 px |
| zoom200 | collapsed | 341 x 160 | 53% | 40% | clear | scrolls | 34 px |

## 3. Findings

1. **The phone window is a floating card, not edge to edge.** It is 66 to 91% of the map width at 320 to 520 px (341 px at most), centred. This is the layout the owner wants replaced by a full-width sheet.
2. **The caption is cramped.** At 390 px the toolbar caption truncates to "PHOTO SPOT · DAY 2 ·…" because three icon buttons plus the collapse and close buttons share the row; the trip name then appears again on its own line.
3. **Expanded hides the pin at every width.** It is centred on the coordinate and covers it by design (`.leaflet-popup.is-expanded`). The preferred direction reverses this: the pin stays visible in the free area (MD-07). This is an intentional behaviour change.
4. **Heights.** Expanded is 60% of the map on phones up to 520 px (the `expandedMaxHeight` rule), 63 to 71% on wider screens (content-limited, cap 85%), 85% in landscape and at 200% zoom. Collapsed is 30 to 44%.
5. **Collapsed almost always scrolls** for a full trip stop (verdict, distances, note, Side Quests, previous / next).
6. **Small targets.** Every button inside the window measured under 44 px high (12 or 13 of 12 or 13), including at touch widths. `DESIGN.md` section 9 asks for 44 px on touch. The new action row must meet it.
7. **Attribution is 17 to 50 px tall** (three lines at 390 px and below). A bottom sheet or a right-hand panel covers it. MD-08 now says so for both layouts (backlog updated).
8. **The live verdict uses real wording**, for example "Suitable-flight zone, below 120 m true height" with its source and effective date. U-01 now says the panel keeps that wording and adds none of its own (backlog updated).
9. **Window sections, in order:** collapse and close buttons, toolbar, head (type badge, name, trip line, date, coordinates, Navigate), zone verdict, elevation and weather tiles, weather button, distance rows, note, Side Quest links, disclaimer, previous / next bar. Unverified, outside-dates and visit strips appear conditionally.
10. **No horizontal overflow** at any viewport; no page errors.

## 4. Fixture traps for later suites

- A trip whose dates are in the past is a completed trip and its markers are hidden on the map. Use future dates.
- Markers a few pixels apart fan out on the first click (`spider.js`), so the click opens nothing. Space them out or press the pin programmatically.

## 5. Popup-test triage (53 suites)

A text search of `tests/`, to be refined suite by suite in S3 to S9. **A** = reads marker-window content or clicks its buttons (selector change when the host moves). **B** = tests popup behaviour or geometry (expanded / collapsed, swipe, tip, wrapper, theme): needs a rewritten assertion against the new host. **C** = mentions popups incidentally (point check, closing, map tests): usually unchanged while point check stays a popup (U-02).

| Suite | Class | `poi-pop` | `leaflet-popup` | toggle / expanded | wrapper / tip | close |
|---|---|---|---|---|---|---|
| ai | A | 29 | 3 | 0 | 0 | 7 |
| tools | A | 25 | 0 | 0 | 0 | 0 |
| side | A | 24 | 5 | 0 | 0 | 2 |
| edit | A | 20 | 3 | 0 | 0 | 0 |
| poi1 | A | 19 | 1 | 0 | 0 | 0 |
| visits | A | 17 | 3 | 0 | 0 | 0 |
| snow | A | 15 | 1 | 0 | 0 | 1 |
| days | A | 14 | 2 | 0 | 0 | 1 |
| trips | A | 14 | 0 | 0 | 0 | 0 |
| maplinks | A | 13 | 2 | 0 | 0 | 0 |
| sidelist | A | 10 | 1 | 0 | 0 | 1 |
| poi2 | A | 8 | 4 | 0 | 0 | 3 |
| picker | A | 7 | 13 | 0 | 0 | 5 |
| helppoi | A | 6 | 6 | 0 | 0 | 6 |
| checkin | A | 5 | 2 | 0 | 0 | 2 |
| rain | A | 3 | 4 | 0 | 0 | 2 |
| bulk | A | 2 | 0 | 0 | 0 | 0 |
| dashboard | A | 2 | 7 | 0 | 0 | 3 |
| mapsel | A | 2 | 1 | 0 | 0 | 0 |
| tripplan | A | 2 | 0 | 0 | 0 | 0 |
| motion | A | 1 | 2 | 0 | 0 | 2 |
| visibility | A | 1 | 6 | 0 | 0 | 1 |
| airspace-integration.test | A | 0 | 0 | 0 | 0 | 0 |
| db-steam-unit | A | 0 | 0 | 0 | 0 | 0 |
| trip | B | 49 | 3 | 2 | 0 | 22 |
| priv | B | 24 | 10 | 2 | 1 | 10 |
| ui | B | 22 | 3 | 0 | 2 | 0 |
| popswipe | B | 16 | 17 | 1 | 10 | 0 |
| mw | B | 15 | 1 | 2 | 0 | 9 |
| stops | B | 10 | 10 | 4 | 2 | 3 |
| hold | B | 7 | 12 | 1 | 1 | 3 |
| window | B | 5 | 11 | 16 | 2 | 2 |
| search | B | 3 | 6 | 0 | 3 | 0 |
| cardsel | B | 1 | 0 | 1 | 0 | 0 |
| dayroute | B | 0 | 32 | 3 | 0 | 8 |
| popup-theme | B | 0 | 16 | 4 | 12 | 1 |
| sg | B | 0 | 2 | 0 | 1 | 0 |
| tripstouch | B | 0 | 3 | 1 | 0 | 7 |
| fly-in | C | 0 | 0 | 0 | 0 | 0 |
| locatemode | C | 0 | 1 | 0 | 0 | 0 |
| logstore-unit | C | 0 | 0 | 0 | 0 | 0 |
| maprotate | C | 0 | 6 | 0 | 0 | 2 |
| poisearch | C | 0 | 2 | 0 | 0 | 0 |
| reorder | C | 0 | 2 | 0 | 0 | 0 |
| responsive | C | 0 | 0 | 0 | 0 | 0 |
| routes | C | 0 | 8 | 0 | 0 | 5 |
| shell | C | 0 | 1 | 0 | 0 | 0 |
| smoke | C | 0 | 3 | 0 | 0 | 0 |
| spider | C | 0 | 14 | 0 | 0 | 3 |
| splash | C | 0 | 1 | 0 | 0 | 0 |
| theme | C | 0 | 2 | 0 | 0 | 0 |
| tripview | C | 0 | 2 | 0 | 0 | 0 |
| zones-lifecycle | C | 0 | 0 | 0 | 0 | 0 |

Notes: `popup-theme` builds the production CSS and must be adapted so the new surface keeps popup opacity and blur (U-10). `popswipe` becomes a sheet and panel gesture suite. `window` is replaced by the new `marker-host` geometry suite. `sessions-explorer` and `session-preview` must stay green through the free-area extraction.

## 6. Existing suites run before any change

Command: `node tests/run.mjs --jobs 2 window popswipe popup-theme hold mw stops trip priv ui cardsel search dayroute tripstouch poi1 poi2 edit visits side sidelist spider maprotate sessions-explorer session-preview`. The name filter is a substring match, so it also ran related suites (for example sidedrag, poisearch, fourway-ui, combined-ui, tripview, motor-diagnostics-ui).

Result: **41 suites passed, 1,729 assertions, 0 failed** (820 s). `popswipe` and `cardsel` were also run directly (25 and 32 passes). Log: `tests/out/review01-baseline/suites.log`. The five known data-environment suites listed in CURRENT_STATUS were not in this selection.
