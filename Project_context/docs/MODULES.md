# Modules

Paths are from the project root. `main.js` is the entry point (`index.html` loads it). Pure = no DOM, importable from Node tests.

## Application (`src/`)
| Module | Purpose | Key interface | Depends on |
|---|---|---|---|
| `main.js` | Wiring and start-up order: createMap, initPanel, weather, locate, initPOI, initPrivacyUI, initTripsUI, initAI, then data load, zones, country menu | none | everything below |
| `map.js` | Leaflet map, basemaps, scale control, zone layer | `createMap` (map, switchBase, setScaleUnits), `createZones` | config, prefs |
| `config.js` | Data base URL (`VITE_DATA_BASE_URL`, default `./data/`) | `dataUrl` | none |
| `pointcheck.js` | Zone verdict for a point from tiles at max zoom | check function | pmtiles, vector-tile |
| `search.js` | Offline place index plus online Photon/Nominatim search | search UI | config |
| `locate.js` | Location pin, re-centre control | control, `request()` | none |
| `weather.js`, `markerweather.js` | Open-Meteo forecast for a point / cached per marker (30 min refresh, incl. rain chance) | `fetchForecast`, `fetchSummaries`, `rainOutlook` | privacy |
| `elevation.js` | Open-Meteo elevation, per-marker cache | `fetchElevations`, `lookupElevation` | none |
| `privacy.js`, `privacy-ui.js` | Opt-in switches and coordinate rounding; the privacy sub-panel | settings API | prefs |
| `prefs.js` | Validated remembered settings | load/save | none |
| `units.js` | km/mi formatting (pure) | format helpers | none |
| `panel.js` | Side panel, dock, tabs (generic over `[role=tab]`), phone bottom sheet | `initPanel` (`open`, `closeIfPhone`) | none |
| `poi.js` (pure) | Marker and trip model: types, sanitize, store, list sorting, GeoJSON export/import | `createStore` (incl. `removeMany`/`restore` for bulk delete and Undo), `TYPES`, `sanitize`, `sanitizeTrip`, `tripFields`, `toGeoJSON`, `parseGeoJSON`, `sortForList` | countries |
| `poi-ui.js` | Marker UI: place/edit/drag, list with trip groups and filter, select-and-delete mode, marker window, import/export | `initPOI` returns store, showTrip, fitTrip, get/setCurrentTrip, setNewTripHandler, tagMarker, handleMapClick, items, addMany, fitToItems | poi, distance, trips, cards, weather, elevation |
| `distance.js` (pure) | Nearest Home point/Hotel (own trip, date overlap) and nearest Home | `nearestBases`, `needsDistance`, `lineApplies`, `inSameTrip`, `beyondRange`, `BASE_TYPES` | none |
| `trips.js` (pure) | Trip length, labels, "outside trip dates" check, sort | `tripLength`, `tripSummary`, `outsideTrip`, `sortTrips` | poi, countries |
| `trips-ui.js` | Trips tab: list, form, delete, current trip | `initTripsUI` | poi, trips, countries, cards |
| `countries.js` (pure) | ISO country list, code/name/alias resolution | `COUNTRIES`, `countryCode`, `countryName` | none |
| `aiimport.js` (pure apart from geocode) | Lenient parse of AI text, sanitize, geocode, share-link encode/decode | `parseItinerary`, `isDuplicate`, `geocode`, `encodeShare`, `decodeShare` | poi |
| `ai-ui.js` | "Plan with an AI" (in the Trips tab): paste/preview/import, trip select, share link | `initAI` | aiimport, poi-ui |
| `controls.js` | Modern number (− / +) and date (clear button) fields; observer enhances fields created later | `initControls` | none |
| `cards.js` | Small DOM helper `el()` and card pieces | `el` | none |
| `styles.css` | All styling, light and dark themes via CSS variables | n/a | n/a |

## Build and data
| Path | Purpose |
|---|---|
| `scripts/build-data.js` | Region data to `public/data/` (entry for `npm run build:data`) |
| `scripts/verify-data.js` | Compares shapefile cells with tiles (`npm run verify:data`); 0 mismatches for Hubei |
| `scripts/lib/{crs,readers,tiles,pmtiles-writer}.js` | CRS conversion, shapefile/GeoJSON readers, tile cutting, own PMTiles v3 writer |
| `data/regions/<country>/country.json`, `<region>/source.json` + `boundary.geojson` | Region definitions committed to git; raw data stays local |
| `data/places/<country>.txt` | Offline search index source |

## Other
| Path | Purpose |
|---|---|
| `public/ai/{prompt.md,schema.json,example.geojson}`, `public/llms.txt` | Published AI assets; `tests/trip-unit.mjs` checks them against `TYPES` |
| `tests/` | Test suites and runner; see `DEVELOPMENT.md` |
| `docs/` | Product docs: `PROJECT.md`, `AI.md`, `ATTRIBUTIONS.md`, `regions/` |
