# Decisions

Newest last. Format: context, decision, reasoning, alternatives, consequences. Product-level settled/open decisions are also in `../../docs/PROJECT.md` section 8.

## Date approximations
Where the transcript gave no exact date, entries carry the session's month (2026-11).

### 2026-11: Rebuild as an open-source static app with PMTiles
- Context: the earlier prototype embedded Hubei data in one HTML file; the aim is nationwide coverage, public use.
- Decision: Vite + Leaflet; zones as vector tiles in PMTiles, one file per region, built by a local Node script.
- Reasoning: only tiles in view load; adding a region needs no code change; static hosting.
- Alternatives: one large GeoJSON (too heavy); tile server (needs hosting).
- Consequences: build pipeline and own PMTiles writer in `scripts/lib`; host must support range requests.

### 2026-11: Region folders with `source.json` and semantics
- Decision: `data/regions/<country>/<region>/` with `source.json` (format, CRS, `allow` or `restrict` semantics, licence) and a committed boundary; raw data stays local.
- Reasoning: China publishes where flying is allowed, most others publish restrictions; wording and colours must follow. Raw files are large and licence is often unconfirmed.
- Consequences: Singapore may need two restriction classes, not supported yet.

### 2026-11: No CI; manual deploy to `gh-pages`
- Decision: `npm run deploy` publishes `dist/` as a single commit; built data kept out of `main`.
- Reasoning: owner chose to avoid CI; keeps large tile files out of history.
- Consequences: publishing is a deliberate manual, public action; needs owner approval each time.

### 2026-11: Public repo, MIT, Hubei data published with licence unconfirmed
- Decision: owner accepted publishing the Hubei tiles before the licence is confirmed, to be fixed if needed.
- Consequences: risk stays open (see `CURRENT_STATUS.md`).

### 2026-11: Privacy by default
- Decision: weather, elevation and name lookup are opt-in; weather location can be rounded to about 1 km; elevation always precise; Home (residence) marker never sent automatically and never in share links.
- Reasoning: the app is for travellers; exact locations are sensitive.
- Consequences: export files contain the Home marker and must be treated as private.

### 2026-11: Markers stored in the browser; GeoJSON export as the backup
- Decision: `localStorage` only, validated on load, in-memory fallback.
- Alternatives: accounts and a backend (rejected: static, open-source, no user data held).

### 2026-11: AI itinerary import is generic, lenient to parse, strict to accept
- Decision: published prompt, schema and example for any AI; parser accepts prose, fences, arrays, Features; everything is sanitized, previewed and flagged `unverified` when looked up; `(0,0)` treated as missing; swapped lat/lon corrected; share links `#import=z.<deflate-raw base64url>`. Day, order and dates stay optional.
- Reasoning: models invent coordinates; the user must see what is added.

### 2026-11: Distances and dates
- Decision: straight-line distances; start and end dates per marker, independent of day/order; waypoint measured to nearest Home point and Hotel whose dates overlap (undated counts for every date).

### 2026-11: Renamed to UAV Companion; storage prefix kept
- Decision: name and repo `uav-companion`; keys keep `uavzones.` and export flag `uavzones: 1`.
- Reasoning: existing browsers' saved data must keep loading.

### 2026-11-11: Trips
- Context: markers needed grouping per journey and distances should not cross trips.
- Decision: a trip (name, optional country, dates, description) has its own Trips tab; markers carry an optional `tripId`. Home (residence) markers never have a trip. Waypoint to Home point and Hotel only within the same trip (no trip means only bases with no trip). Date overlap still applies inside a trip. Every marker except Home shows distance to nearest Home, ignoring trip and dates. Deleting a trip keeps its markers. Date outside trip dates is a warning only. AI import accepts a top-level `trip`.
- Alternatives: trip as a field inside Points of Interest only (rejected: a tab fits create, edit, fit-to-trip and browse).
- Consequences: new key `uavzones.v1.trips`; export has `trips`; the earlier rule that hotels and home points show no distance line is gone, and tests were updated.

### 2026-11-11: Tests live in the repo
- Decision: suites moved into `tests/` with a runner (`npm test`, `npm run test:unit`), shared paths in `tests/lib.mjs`.
- Consequences: they need the app on port 5173 and Edge; `tests/out/` is git-ignored.

### 2026-11-11: Persistent project context in `Project_context/`
- Decision: `AGENTS.md` plus six docs; a one-line root `CLAUDE.md` points to `AGENTS.md` so Claude Code loads it automatically.
- Reasoning: new sessions start without memory of earlier ones.

### 2026-11-11: Plan with an AI moves to the Trips tab; two new marker types; bulk delete
- Context: an AI reply can create a trip, and the Points of Interest tab was crowded.
- Decision: the "Plan with an AI" card lives in the Trips tab. New types `train` (Train station) and `airport` (Airport) are waypoints, not distance bases; the Hazard hint no longer mentions airports. Bulk delete is a Select mode in the list with All/None, by-trip and by-type shortcuts limited to shown markers, a confirmation that gives the count and tells the user to export first, and a 10 s Undo message backed by in-memory `store.removeMany`/`restore`.
- Reasoning: storage is the only copy of a user's markers, so a bulk delete needs a pre-delete backup prompt and a short-lived undo.
- Alternatives: a delete-trip-with-markers button (not needed: select by trip covers it); a persistent trash (rejected: extra stored state).
- Consequences: Undo does not survive a reload. Type ids `train` and `airport` are now part of the stored and exchanged format (prompt, schema, example list them).
