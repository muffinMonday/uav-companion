# Data storage

There is no database or server-side storage. Data is (1) static files generated at build time and (2) per-user browser `localStorage`. Key names were verified against `src/`.

## Browser storage (`localStorage`)
All reads are validated; damaged entries fall back to defaults. If storage is blocked the app works from memory (`poi.js` probes it first).

| Key | Owner | Shape | Notes |
|---|---|---|---|
| `uavzones.v1.pois` | `poi.js` | `{ v: 1, items: [Item] }` | Item: `id`, `type` (home, hotel, takeoff, landing, photo, train, airport, hazard, residence, other), `name` (<= 80), `note` (<= 500), `lat`, `lon`, `created`, optional `day`, `order`, `date`, `endDate` (ISO), `unverified`, `tripId`. `tripId` is dropped for `residence` and when it names no saved trip |
| `uavzones.v1.trips` | `poi.js` | `{ v: 1, trips: [Trip] }` | Trip: `id`, `name` (<= 80), `created`, `color` (from `TRIP_COLORS`), optional `country` (ISO code), `startDate`, `endDate`, `description` (<= 500). Max 200 trips |
| `uavzones.v1.prefs` | `prefs.js` | flat object | `basemap`, `country`, `opacity` (0.1 to 0.9), `popupOpacity` (0.5 to 1), `units`, `maxRangeM` (100 to 200000), `currentTrip`, `autoWeather`, `weatherPrecision`, `fetchAltitude`, `lookupNames`, `view {lat, lon, zoom}` |
| `uavzones.v1.wxcache` | `markerweather.js` | `{ v: 1, lastBulk, items: { [markerId]: { t, temp, wind, gust, n, start, tz, ... } } }` | Weather cache; 30 min refresh interval, outdated after 3 h |
| `uavzones.v1.elevcache` | `elevation.js` | `{ v: 1, items }` | Per-marker ground elevation |
| `uavzones.v1.lastBackup` | `poi.js` | ISO timestamp string | Set when the user exports |
| `uavzones.windLimit` | `weather.js` | number as string | Wind limit; older key without `v1`, kept as is |

Limits: import file 2 MB, 5000 items per import.

## Export / import file (GeoJSON, `uavzones: 1`)
`FeatureCollection` of Points (`[lon, lat]`) with `properties` id, type, name, note, created, optional day, order, date, endDate, unverified, tripId; optional top-level `trips` array (id, name, country, startDate, endDate, description, color). Import merges by id: existing ids are skipped, markers whose trip is not in the file arrive untagged. Home markers are included in export (private file) and excluded from share links.

## Static data (generated, `public/data/`, not in git)
- `index.json`: list of countries. `<country>/manifest.json`: regions with content-hashed PMTiles file names, bounds, semantics, licence info. `places/`: offline search index.
- Region PMTiles: vector tiles of rectangular grid cells (Hubei: 84,863 cells). Verified identical to the source shapefile by `npm run verify:data`.
- Sources of truth in git: `data/regions/<country>/country.json`, `<region>/source.json`, `boundary.geojson` (Natural Earth), `data/places/<country>.txt`.

## Migration notes
- The `uavzones.` prefix and `uavzones: 1` export flag predate the rename to UAV Companion and are kept so existing users' data still loads.
- Trips (added with `uavzones.v1.trips` and `tripId`) needed no migration: old files without them load unchanged.
- If a stored shape changes incompatibly, bump `v`, write a loader that reads the old version, and add a line here.
