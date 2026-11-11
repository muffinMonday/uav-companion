# Current status (handover)

Last updated: 2026-11-11.

## Objectives
Open-source, static map of drone suitable-flight zones (Hubei live data; Singapore and wider China planned) with a traveller's toolkit: point check, search, opt-in weather/elevation, markers, trips, AI-itinerary import. Requirements: `../../docs/PROJECT.md`.

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
Agreed, not built yet:
1. **Trips tab upgrades** (layout agreed 2026-11-11: trip cards show countdown, a one-line warning summary and a weather strip, with a collapsed "Past trips" section; tapping a card opens a separate detail screen with a warnings list, day-by-day stops with distances and weather, then notes and one checklist per trip; the no-fly check on stops runs only on tap and is cached): day-by-day view with route distance per day; gaps and warnings (undated markers, days without a hotel, markers outside the trip dates, stops inside a no-fly zone); per-day weather glance from the rain outlook; archive of past trips ("Past" section); trip notes and a per-marker checklist; countdown on the trip card ("In 12 days", "Day 2 of 5"). Not chosen for now: duplicate trip, trip colours, whole-trip route button, GPX/KML export, printable summary, move markers between trips, search inside a trip.

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
