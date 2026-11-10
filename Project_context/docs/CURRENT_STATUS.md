# Current status (handover)

Last updated: 2026-11-11.

## Objectives
Open-source, static map of drone suitable-flight zones (Hubei live data; Singapore and wider China planned) with a traveller's toolkit: point check, search, opt-in weather/elevation, markers, trips, AI-itinerary import. Requirements: `../../docs/PROJECT.md`.

## Recent work
- Trips feature complete (F19): Trips tab, `tripId` on markers, trip-scoped distances, every non-Home marker shows distance to nearest Home, AI `trip` object, export/import of trips. Details in `DECISIONS.md`.
- Tests moved into `tests/`; trips unit and browser suites written; stale expectations updated.
- Docs updated for trips (`PROJECT.md` F19, `AI.md`, `README.md`); this `Project_context/` set created; root `CLAUDE.md` points to `AGENTS.md`.
- Initial git commit prepared for `https://github.com/muffinMonday/uav-companion` (`main`); see "Outstanding" for push state.

## Tests (2026-11-11, dev server on :5173)
All 14 suites pass: ai-unit 60, trip-unit 81, trips-unit 46, poi1 29, poi2 29, edit 10, prefs 20, opacity 18, mw 43, priv 46, ai 73, trip 105, trips 29, smoke (no PASS lines, no errors). Production build (`npm run build`) succeeds; browser suites were not rerun against the preview build.

## In progress
Nothing.

## Outstanding
- Push to GitHub: needs the user's git credentials on this machine; if the push failed, sign in (Git Credential Manager prompt) and run `git push -u origin main`.
- Not deployed: `npm run deploy` publishes the app and Hubei tiles; enable GitHub Pages (Source: `gh-pages`) afterwards. Ask the owner first.
- Run the browser suites against `vite preview` (production build) for the trips work.
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
1. Confirm the push; enable Pages and deploy once the owner approves.
2. Real-device check (touch long-press drag, phone tabs), live AI-assistant test.
3. Verify the Hubei CRS; confirm the licence; start Singapore data (`data/regions/sg/` has only `country.json`).
