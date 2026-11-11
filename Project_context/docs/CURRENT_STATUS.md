# Current status (handover)

Last updated: 2026-11-11.

## Objectives
Open-source, static map of drone suitable-flight zones (Hubei live data; Singapore and wider China planned) with a traveller's toolkit: point check, search, opt-in weather/elevation, markers, trips, AI-itinerary import. Requirements: `../../docs/PROJECT.md`.

## Work board
The one place to see what is being built, what is queued and what is waiting. Statuses: **In progress** (being built now; the date it started), **Queued** (agreed, not started), **Waiting on owner** (needs a decision before work can start), **Planned** (discussed, later phase), **Parked** (ideas not chosen), **Done** (shipped, with the commit). Details of each item are in "Feature backlog and queue" below. Updated whenever work starts, stops or finishes.

| ID | Item | Status | Since | Notes |
|---|---|---|---|---|
| W1 | Backend phase 1: accounts and cloud persistence | **In progress** | 2026-11-11 | Done: database, access rules, 42 tests, both migrations on the dev project (`e4e0206`). Now: the sync logic (pure, tested against a fake server) → sync adapter → sign-in and conflict-prompt interface (hidden unless a project address is set) → end-to-end tests on the dev project. |
| W2 | Check-in discoverability (options A to D) | **Waiting on owner** | 2026-11-11 | Needs the owner's choice of A (show the button even when off), B (button in the marker window), C (manual "mark as visited"), D (What's new entry). |
| W3 | Faster tests: run them in parallel | **Queued** | 2026-11-11 | Plan and the rules for writing parallel-safe tests are in `DEVELOPMENT.md`. |
| W4 | Optimization backlog (storage readout, orphan cache cleanup, import ceiling) | **Queued** (none urgent) | 2026-11-11 | See "Optimization backlog". |
| W5 | Backend phase 2: profiles and friends | **Planned** | after W1 | About 1 week solo; see the decision of 2026-11-11. |
| W6 | Backend phase 3: flight sessions, invitations, public lobby | **Planned** | after W5 | Approximate area for public sessions; moderation and privacy policy first. |
| W7 | Diagnostics 4a: USB connection to a flight controller (MSP), read-only | **Planned** | after W1 or in parallel | Browser only (Web Serial, desktop Chrome and Edge); `PROJECT.md` section 9. |
| W8 | Diagnostics 4b: blackbox log parsing and analysis | **Planned** | after W7 | Needs sample logs from real flights. |
| W9 | Diagnostics 4c: tuning writes (rates, PID) with snapshot and revert | **Planned** | after W8 | Explicit confirmation on every write. |
| W10 | Diagnostics 4d: motor test and pre-flight rules | **Planned** (last) | after W9 | Props-off safeguards and a safety review before it ships. |
| W11 | Ideas not chosen: duplicate trip, trip colours, whole-trip route button, GPX/KML export, printable summary, move markers between trips, search inside a trip, undo for share-link imports | **Parked** | 2026-11-11 | |

**Done 2026-11-11** (newest first; commit in brackets): backend database and rules (`e4e0206`); crosshair and tight dashboard grid (`5c5e963`); fuller dashboard (`33f91f1`); overnight arrows through the hotel and the second animations (`b3f1025`); snow and compact share links (`6bc09bf`); cross-day arrows and conditions-before-distances (`156a7c3`); eye in the window, scale bar fixed, larger greeting (`f2eee70`); marker details switch and the day's route (`24505ef`); centred dashboard and basic animations (`91c2d30`); check-in (`aea6d31`); route builder on the dashboard (`d692323`); dashboard (`2e1f701`); collapsible search and roll-up panel (`209ae6f`); trip days as a flip card (`95e09e2`); map links as icons (`2be5931`); trip forecast and no-fly check (`da0b00e`); trip plan screen (`ade7810`); map selection (`03e3b7d`); window tidy-up and Singapore published (`f8ffc85`); Singapore zones (`498eff8`). The map legend above the scale bar (asked earlier) is superseded by the dashboard's Map key.

## Recent work
- Trips feature complete (F19): Trips tab, `tripId` on markers, trip-scoped distances, every non-Home marker shows distance to nearest Home, AI `trip` object, export/import of trips. Details in `DECISIONS.md`.
- Tests moved into `tests/`; trips unit and browser suites written; stale expectations updated.
- "Plan with an AI" moved to the Trips tab; new marker types Train station and Airport; bulk delete (F20: select mode, shortcuts, export reminder, 10 s Undo). Tests: new `tests/bulk.mjs`, store checks added to `trips-unit`, `ai`/`trip` suites updated for the moved card.
- UI pass (F21): fixed my markup error from the AI-card move (weather/backup leaked under every tab; phone panel squeezed); weather/backup back in Points of Interest in a dashed settings block; modern number/date fields and scroll bars (`controls.js`); phone search/dock overlap fixed; phone marker window capped at 45% height; day/stop on pins and list rows. New `tests/ui.mjs`.
- Weather and elevation card removed from Points of Interest; its status line moved into the privacy sub-panel (`#mw-status`); Backup block renamed. Tests `mw`, `priv`, `ui` updated.
- Frosted marker window + opacity slider (F22, `popupOpacity` pref); `ui` suite extended.
- Rain block in the marker window (F23): peak chance + 5-hour strip, mm fallback; new `rain-unit` and `rain` suites. Marker windows are now height-capped on desktop too (a tall window pushed its own pin off screen).
- Hold-to-check (2 s) + right-click + Enter; blank click only closes windows; markers/checks centre the map and tall windows scroll (F24). New `hold` suite; `smoke`/`priv` use a hold for point checks. Popups use `closeOnClick:false` (Leaflet closes on the release that ends a hold otherwise); `main.js` closes them on a real map click.
- Welcome screen with trip countdown, "Don't show again", How it works in Map Configs (F25). New `welcome` suite; all suites import `chromium` from `tests/lib.mjs` (welcome off by default).
- Expanded/collapsed marker window (F26): tall centred window over the pin by default on desktop, collapsed on phones, chevron toggle remembered. New `window` suite. Gotcha: never replace the clicked element's children mid-click inside a popup (Leaflet closes the popup); the chevron uses two always-present SVGs.
- Same place on several dates (F27): ×N pin badge, visit chips, Add visit, AI import treats a different date as another visit, shared weather/elevation per spot. New `places-unit` and `visits` suites.
- Reorder saved places by holding 2 s and dragging (F28), with date/day/stop/hotel-end recalculation, Undo and Alt+arrows. New `reorder-unit` and `reorder` suites. Gotcha: a touch drag must not re-render the touched row (the touch loses its target and the browser scrolls); drop-only dates are inserted in place.
- Open in Google Maps/Amap + routes (F29): buttons in marker and check windows, Route block in Select mode, Amap first inside China, Home asks first. New `maplinks-unit` and `maplinks` suites; `coords.js`, China outline. The apps themselves are untested on a real phone.
- Search by coordinates (F30): coordinate and map-link parsing, two rows inside China, blue pin + point-check window for every result, Add as marker and Remove pin in check windows. New `coordparse-unit` and `search` suites.
- The day follows from the date and trips need dates (F31): `dayInfo`, one-time fix of stored days, no Day box, AI days become dates, required trip dates. New `days` suite; `trips-unit` extended.
- Previous / next stop bar in the marker window (F32): `tripSequence`, sticky bar, tooltips naming the destination. New `stops` suite.
- Docs updated for trips (`PROJECT.md` F19, `AI.md`, `README.md`); this `Project_context/` set created; root `CLAUDE.md` points to `AGENTS.md`.
- Initial commit `11aa7ce` pushed to `https://github.com/muffinMonday/uav-companion` (`main`, identity muffinMonday, repo-local git config).

## Tests (2026-11-11, dev server on :5173)
All 16 suites pass: ai-unit 60, trip-unit 81, trips-unit 56, ui 30, bulk 31, poi1 29, poi2 29, edit 10, prefs 20, opacity 18, mw 43, priv 46, ai 73, trip 105, trips 29, smoke (no PASS lines, no errors). Production build (`npm run build`) succeeds; browser suites were not rerun against the preview build.

## In progress
Nothing.

## Outstanding
- Deployed with the UI pass (owner asked). `npm run deploy` publishes the app and Hubei tiles; enable GitHub Pages (Source: `gh-pages`) afterwards. Ask the owner first.
- Run the browser suites against `vite preview` (production build) for the trips work.
- Typing in Max range then clicking a list row can swallow the click: the field's `change` fires on blur and re-renders the list mid-click (existing behaviour).
- Weak assertion in `tests/trips.mjs` ("Home marker's form has no Trip field" passes on either of two conditions); tighten it.

## Feature backlog and queue
Done and published 2026-11-11: window tidy-up, map selection, Singapore no-fly zones (open: OneMap terms unread; coarse 10 m boundary with a 1.5 km margin; temporary restricted areas ignored by choice).
Agreed, to be done:
1. **Backend for data persistence** (phase 1 started 2026-11-11: the cloud database is built and pushed, see the progress note below; the app side is next). Staged: level 1 cloud backup (upload and restore of the export; 3 to 5 days), level 2 live sync across devices (local-first, newest edit wins, deletions synced; about 10 to 15 working days, or 2.5 to 3.5 weeks with Django), level 3 groups and shared datasets (1 to 2 more weeks). Options discussed: a managed service (Supabase: hosted Postgres, sign-in and row-level security; browser talks to it directly with the public key) or Django REST on PythonAnywhere (the GitHub Pages site can call it with HTTPS, CORS for https://muffinmonday.github.io and http://localhost:5173, and token sign-in because cookies would be third-party). Security notes: the project address and the public (anon) key are public by design; protection is row-level security on every table with tests (signed-out sees nothing, user A cannot read user B), never commit the service-role key or database password (VITE_ values are in the browser bundle), public sign-up off and invite-only, size limits in the database, no reliance on CORS, token storage hygiene (no third-party scripts, textContent, CSP), redirect allow-list for sign-in links, keep check-in positions on the device unless decided otherwise, free-tier quotas stop rather than bill, secret-scan check, rule tests in the suite. Decisions pending from the owner: who it is for (one person or the FPV group, and whether the Singapore layer is shared), sign-in method, whether check-ins sync, service (managed or Django), level to start with.
   Progress 2026-11-11: decisions made by the owner (all yes): optional accounts with the static, cache-driven app untouched; a prompt to choose which copy to keep on a true conflict, with a backup of the other side first; Supabase as the service, developed against a hosted dev project (no Docker) plus PGlite for the access-rule tests; email sign-in; approximate area for public sessions later; desktop Chrome and Edge only for diagnostics; motor test last, with props-off safeguards. Done: `supabase/` folder (two migrations: `user_data` with revisions, 20 versions or 30 days of history, row-level security and the four write functions; hardening of the platform's `rls_auto_enable`), 42 checks in `tests/db-unit.mjs` on PGlite, both migrations pushed to the linked project `tgptrtcuaryyyfzhrffm` (tagged production by the platform; used as the dev project), advisor clean apart from the four accepted write-function warnings, live API verified to refuse an anonymous visitor everywhere. Next: the sync logic (pure, tested against a fake server), the sync adapter, the sign-in and conflict-prompt interface (hidden unless a project address is configured), then end-to-end tests against the dev project. Later phases (friends, sessions and lobby, flight-controller diagnostics) as planned in the conversation of 2026-11-11.
2. **Check-in discoverability** (asked 2026-11-11, awaiting the owner's choices): A show the Check in button even when check-in is off (disabled, tooltip, opens the privacy card); B a Check in button in the marker window's bar; C an optional manual "Mark as visited" without a position; D a What's new entry. Recommended A, B, D.
3. **Map legend** (superseded 2026-11-11 by the dashboard's Map key, which shows the zone legend and samples of the four line types): a card above the scale bar explaining the line types drawn (thin day chain, bold into/out of the selected stop, bold dashed overnight, dashed links to hotel and Home), shown only for the kinds on the map, foldable to an info button, lifting above the open dashboard only when they overlap.
4. **More on the dashboard** (done 2026-11-11, `33f91f1` and `5c5e963`): the dashboard looks empty; candidates are a Today card with check-in, a Map key (zone legend and line legend), quick layer controls, a Data card (export, import, share link, last backup), quick actions (place a marker at the centre or here, select markers, check my spot) and the next trip's checklist.
5. **Faster tests: run them in parallel** (queued 2026-11-11, not started). Measured 2026-11-11: 45 suites run one after another take about 960 s; the slowest are `trip` 131 s, `mw` 63 s, `ai` 63 s, `priv` 56 s, `hold` 44 s, `ui` 43 s; there are 556 fixed `waitForTimeout` pauses. Plan, in order: (a) a parallel runner (`node tests/run.mjs --jobs N`, a worker pool over the browser suites; unit suites first and quickly; output kept per suite and printed in order; a suite marked `serial` if it ever needs to run alone), aiming for about 4 to 5 minutes for the full set and roughly flat as suites are added; (b) serve a built copy (`vite preview`) for the tests so edits to `src/` do not reload the page under a running suite and the tests see what visitors get; (c) a map from source file to the suites that cover it, so a change is checked by the relevant suites in seconds while the full set stays the gate before every deploy; (d) replace fixed waits with waits on a condition, starting with the slowest suites; (e) split `trip.mjs` (105 checks, 131 s) into several suites; (f) reuse one browser per worker. Risks: timing-sensitive tests may fail under load (expect a short shake-out), and four to six browsers need a few GB of memory. Rules for writing tests that can run this way are in `DEVELOPMENT.md` ("Writing tests that can run in parallel") and apply to every new suite from now on.
Nothing agreed and waiting. Ideas not chosen: duplicate trip, trip colours, whole-trip route button, GPX/KML export, printable summary, move markers between trips, search inside a trip, undo for share-link imports.
Trips tab upgrades (day-by-day plan, forecast per day, no-fly check of stops, notes, checklist, Past trips, countdown) built and deployed 2026-11-11.

## Optimization backlog (later, none urgent)
Measured 2026-11-11: a marker is about 360 bytes (810 at its limits), a weather cache entry about 170, an elevation entry about 70; 100 markers with caches are about 60 KB of the browser's roughly 5 MB. The app bundle is 417 KB (about 130 KB compressed); the Hubei zone file is 6.7 MB, read in small pieces.
- Show storage use in the Backup card ("Using 62 KB of about 5 MB") with a warning past about 80%.
- At start-up, drop weather and elevation cache entries whose marker no longer exists (delete already forgets them; another tab or an import could leave strays).
- Lower the import ceiling from 5,000 markers to about 2,000: 5,000 markers at their maximum size with caches would exceed the quota (the app already warns when the browser refuses to store).
- When more regions arrive (Singapore, a second Chinese province): keep one zone file per region; revisit moving tiles to object storage if bandwidth grows (GitHub Pages: 1 GB per site, 100 MB per file).

## Known issues and risks
- Hubei CRS declared WGS84, not verified (GCJ-02 would shift zones by up to a few hundred metres).
- Hubei licence unconfirmed, yet published by the owner's decision.
- Distances are straight-line; dates are calendar dates without time zones.
- No offline support (service worker); not tested on real phones; live AI assistants (Gemini, ChatGPT) not tested against the prompt.
- Full list: `../../docs/PROJECT.md` section 7.

## Open questions
- Update cadence and versioning of the official zones; online search provider choice; Singapore source and restricted vs prohibited classes; when to move tiles off GitHub Pages (`PROJECT.md` section 8).

## Relevant files
`src/poi.js`, `src/distance.js`, `src/trips.js`, `src/trips-ui.js`, `src/poi-ui.js`, `src/aiimport.js`, `src/ai-ui.js`, `index.html`, `public/ai/`, `tests/trips*.mjs`, `tests/trip*.mjs`.

## Next steps
1. Enable GitHub Pages (Source: `gh-pages`) if not yet on, and redeploy once the owner approves.
2. Real-device check (touch long-press drag, phone tabs), live AI-assistant test.
3. Verify the Hubei CRS; confirm the licence; start Singapore data (`data/regions/sg/` has only `country.json`).
