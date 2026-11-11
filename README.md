# UAV Companion

Open-source, static web map of the suitable-flight (适飞) zones where small drones may fly, for travellers who cannot use the official UOM app. Currently covers Hubei, China. It is built to grow region by region, across China and then to Singapore and beyond.

Requirements and decisions: `docs/PROJECT.md`. Adding a region: `CONTRIBUTING.md`. Attributions: `docs/ATTRIBUTIONS.md`.

**This is not flight advice.** Check UOM (China) or the local official platform before every flight.

## Run

```
npm install
npm run build:data   # needs the raw shapefiles in data/regions/ (kept local, not in git)
npm run dev          # http://localhost:5173
npm run deploy       # build, then publish dist/ to the gh-pages branch (GitHub Pages)
```

Without the raw data, point the app at already-published data instead:
`VITE_DATA_BASE_URL=https://<user>.github.io/uav-companion/data/ npm run dev`

Geolocation only works on https or localhost, not from a `file://` page.

## How the data is organised

```
data/regions/<country>/country.json            name and map view box of the country
data/regions/<country>/<region>/source.json    id, format, crs, semantics, boundary, licence, source (in git)
data/regions/<country>/<region>/boundary.geojson   coverage polygon (in git)
data/regions/<country>/<region>/<raw files>    official data (local only)
data/places/<country>.txt                      offline search index
scripts/                                       build-data.js, verify-data.js, lib/ (readers, tiles, PMTiles writer, CRS)
public/data/                                   GENERATED: index.json, <country>/manifest.json, tiles, places (not in git)
src/                                           map, search, point check, location control
```

`public/data/` is rebuilt locally and published only to the `gh-pages` branch, so large tile files never enter the history of `main`. Each region is one PMTiles file; the app loads a region's tiles only when it is in view.

Saved places (the Points of Interest tab) are stored only in the visitor's browser (`localStorage`) and can be exported and imported as GeoJSON. They are not part of the generated data and never touch the server.

The search box takes place names, coordinates (decimal or degrees-minutes-seconds, also from a pasted Google Maps or Amap link) and shows the zone verdict for the picked spot, with buttons to open it in, or navigate to it with, Amap (in China) or Google Maps (set under Maps in Map Configs).

Weather and ground elevation come from Open-Meteo and are off until the visitor opts in under the shield button (privacy settings), where they can also choose whether weather uses an estimated (about 1 km) or precise location. Elevation always uses the exact location.

Markers can be grouped into **trips** (name, country, dates, description; own Trips tab) and carry their own dates. Each waypoint shows its straight-line distance to the nearest home point and hotel in its own trip whose dates overlap its own, and every marker shows its distance to the nearest Home, with units (km or miles) and an optional max range in the Points of Interest tab. The **Home** marker is the traveller's residence, distinct from the drone's **Home point**; it is kept out of share links and automatic lookups, and does not count toward the max range.

Any AI assistant can turn a travel itinerary into markers: the app publishes a prompt, JSON Schema and example under `ai/` (and `llms.txt`), and the Trips tab has a "Plan with an AI" paste-and-preview flow. See `docs/AI.md`.

Every region declares what its zones mean in `semantics`:
- `allow`: zones are where flying is permitted (China's 适飞 grid). Outside the zones is controlled.
- `restrict`: zones are restricted areas (the usual form elsewhere, e.g. Singapore). Outside the zones means no restriction in this data, which is not permission to fly.

**Singapore.** Its no-fly zones (CAAS, MHA and NParks, as published on OneMap) come in several classes (`layers[]` in `source.json`, format `onemap-themes`); the point check lists every zone containing the point and links to the official OneMap Drone Query. The data is approximate and was published before OneMap's terms were read. Sourced geo data is published by default; a region with `"publish": false` is built into `public/data-local/` (read only on localhost or a private network address) and stripped by `npm run deploy`.

**Check-in.** With the Check-in switch on (privacy settings, off by default), a marker's Check in button enables within 300 m of it and saves your position and the time on that marker, in your browser only. It is kept in exports and left out of share links.

## Licence

Code is MIT (`LICENSE`). The zone data comes from official sources with their own terms; see `docs/ATTRIBUTIONS.md` and `docs/regions/`.
