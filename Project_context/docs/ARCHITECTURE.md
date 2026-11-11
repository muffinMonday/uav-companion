# Architecture

A static site. No server code, no database, no accounts. Everything the user creates stays in their browser.

## Components
| Component | Responsibility |
|---|---|
| Build pipeline (`scripts/`, Node, run locally) | Reads official shapefiles/GeoJSON per region, reprojects, cuts vector tiles, writes one content-hashed PMTiles file per region plus manifests and a places index into `public/data/` |
| Static data (`public/data/`, generated, not in git) | `index.json`, `<country>/manifest.json`, `<region>.<hash>.pmtiles`, `places/` |
| Web app (`src/`, `index.html`) | Leaflet map, zone layer from PMTiles, point check, search, weather/elevation, markers, trips, AI import, privacy controls, side panel |
| Static AI assets (`public/ai/`, `public/llms.txt`) | Prompt, JSON Schema and example any AI assistant can use to produce importable itineraries |
| Hosting | GitHub Pages from the `gh-pages` branch (built `dist/`), published manually with `npm run deploy`; no CI |

## Data flow
1. `npm run build:data`: `data/regions/<country>/<region>/{source.json, raw files, boundary.geojson}` to `public/data/`.
2. App start (`main.js`): read prefs, create map, load `index.json` then each country manifest, add the PMTiles zone layer (`map.js`), restore the saved view/basemap/country.
3. Point check (`pointcheck.js`): at max zoom, reads the tile under the point; result is inside / outside within the region boundary / no data; wording depends on region `semantics` (`allow` or `restrict`).
4. Markers and trips: UI (`poi-ui.js`, `trips-ui.js`) call the store in `poi.js`, which validates, persists to `localStorage` and notifies listeners; lists, pins and distance lines re-render on change (also on the `storage` event from other tabs).
5. Distances (`distance.js`): pure function over the saved items; waypoint to nearest Home point and Hotel in its own trip (date-overlap rule), every non-Home marker to nearest Home.
6. AI import (`aiimport.js`, `ai-ui.js`): paste text or open `#import=z.<deflate-raw base64url>` link, parse leniently, sanitize strictly, preview, geocode name-only rows (opt-in), add to store flagged `unverified` where the location came from lookup.

## External integrations (all browser-side, all optional except basemaps)
| Service | Used for | Sent | Gate |
|---|---|---|---|
| Basemap tile hosts (OpenStreetMap, OpenStreetMap France for Humanitarian and CyclOSM, OpenTopoMap) | Map imagery | Tile coordinates, IP | Always |
| Open-Meteo forecast | Weather | Coordinates, rounded to ~1 km unless "precise" | Opt-in |
| Open-Meteo elevation | Ground elevation | Coordinates to 4 decimals | Opt-in |
| Photon, then Nominatim | Online place search and name lookup for AI rows | Query text | Search on use; AI lookup opt-in |
| `gh-pages` host | The app and tiles | n/a | n/a |

The Home (residence) marker is never sent to any of them automatically and is excluded from share links; it is included in the user's own export file.

## Constraints
- Static hosting only; tiles are read with HTTP range requests, so the host must support them.
- Browser storage is per browser and can be blocked or cleared; the store falls back to memory and says so. Export is the only backup.
- Hubei data: CRS declared WGS84 but unverified (could be GCJ-02); licence unconfirmed (published by the owner's decision).
- Zone data is a planning aid; official platforms are authoritative.
- Offline support (service worker) is not built.
- Tests run in Microsoft Edge via Playwright against `localhost:5173` with the three external APIs mocked.
