# Current status (handover)

Last updated: 2026-11-11.

## Objectives
Open-source, static map of drone suitable-flight zones (Hubei live data; Singapore and wider China planned) with a traveller's toolkit: point check, search, opt-in weather/elevation, markers, trips, AI-itinerary import. Requirements: `../../docs/PROJECT.md`.

## Recent work
- Trips feature complete (F19): Trips tab, `tripId` on markers, trip-scoped distances, every non-Home marker shows distance to nearest Home, AI `trip` object, export/import of trips. Details in `DECISIONS.md`.
- Tests moved into `tests/`; trips unit and browser suites written; stale expectations updated.
- "Plan with an AI" moved to the Trips tab; new marker types Train station and Airport; bulk delete (F20: select mode, shortcuts, export reminder, 10 s Undo). Tests: new `tests/bulk.mjs`, store checks added to `trips-unit`, `ai`/`trip` suites updated for the moved card.
- UI pass (F21): fixed my markup error from the AI-card move (weather/backup leaked under every tab; phone panel squeezed); weather/backup back in Points of Interest in a dashed settings block; modern number/date fields and scroll bars (`controls.js`); phone search/dock overlap fixed; phone marker window capped at 45% height; day/stop on pins and list rows. New `tests/ui.mjs`.
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
