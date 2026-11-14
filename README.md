# UAV Companion

UAV Companion is an open-source, browser-based planning map for small-drone trips. It shows published flight-zone data, lets a traveller check a point on the map, and keeps personal places and itineraries organised around a trip.

The app is designed to be useful without an account: places, settings and backups stay in the browser by default. An optional Supabase build adds cloud backup, friends, shared trips, presence and live locations, with additional community and progression features available when those services are configured.

> **Important:** UAV Companion is a planning aid, not flight advice or a legal authority. Zone data may be approximate, incomplete, out of date, or subject to redistribution restrictions. Always check the official UOM app or the relevant local authority before every flight.

## What it does

### Flight-zone map

- Displays regional zone data on an interactive Leaflet map.
- Uses one PMTiles vector tile set per region and loads regional data as needed.
- Supports `allow` datasets, such as China's suitable-flight areas, and `restrict` datasets, such as no-fly or restricted-area layers.
- Performs a live point check against the same tile data used to draw the map. Results distinguish a point inside a zone, outside the zones but inside the coverage boundary, and outside available data.
- Includes China and Singapore country views, with regional coverage expandable through the data pipeline.
- Offers OpenStreetMap, Humanitarian, CyclOSM and OpenTopoMap basemaps.

### Search and location

- Searches an offline place index with Chinese names, pinyin and English names.
- Can use Photon and Nominatim for an explicitly requested online lookup.
- Accepts decimal coordinates, degrees/minutes/seconds, and pasted Google Maps or Amap links.
- Provides a three-step location control: show location, follow location, and return to normal north-up mode.
- Supports phone compass heading, map rotation, a north compass control, accuracy display and a scale bar.

### Weather and terrain, opt-in

- Shows a short local forecast for a checked point when requested.
- Can optionally refresh weather for saved markers.
- Can optionally look up ground elevation for a marker or checked point.
- Weather and elevation are disabled by default and are controlled from the privacy panel.
- The app does not label conditions as safe to fly.

### Places and trips

- Saves points such as home points, accommodation, takeoff and landing spots, photo spots, transport locations, hazards and general waypoints.
- Keeps the traveller's **Home** residence distinct from the drone's **Home point**. Residence markers are excluded from share links and automatic lookups.
- Supports marker notes, visit dates, multi-day stays, itinerary day/stop ordering, filters and drag-to-edit.
- Groups markers by date or itinerary day when that information is present.
- Organises markers into trips with a name, country, dates and description.
- Shows straight-line distances to relevant home points, accommodation and the traveller's residence.
- Offers GeoJSON export/import and compressed share links. Nothing is added from an import or link without preview and confirmation.

### Planning with an AI

The Trips tab can produce a prompt for any AI assistant. The assistant returns GeoJSON, which UAV Companion previews before anything is added.

- Coordinates may be supplied directly or represented as a place query.
- Optional place lookup is disabled until enabled in Privacy settings.
- Imported AI places are marked **Unverified** until checked by the user.
- The parser validates names, types, coordinates, dates and limits; it never treats an AI response as authoritative zone information.
- The format and examples are published under [`public/ai/`](public/ai/) and [`docs/AI.md`](docs/AI.md).

### Optional account and community features

When built with a configured Supabase project, the app can provide:

- cloud backup and versioned recovery of user data;
- profiles, friend requests, blocking and online status;
- shared trips and shared-trip live locations;
- optional friend live-location sharing;
- flight sessions with invitations, RSVPs and attendance;
- optional XP, ranks, achievements and approved Steam simulator playtime integration.

These features are not required for the map, search, point checks, local places or local backups to work.

## Data coverage and trust model

The repository currently contains published coverage for:

- **Hubei, China:** the official suitable-flight grid, represented as `allow` data. The dataset contains approximately 85,000 cells and includes a stated height context in its source metadata.
- **Singapore:** published OneMap-derived restricted/no-fly layers represented as `restrict` data. The map is approximate; the official OneMap Drone Query remains the authoritative check.

Each region declares its semantics, coordinate system, source authority, effective date, licence/terms, coverage boundary and publication policy in `source.json`. Region provenance is documented under [`docs/regions/`](docs/regions/).

The earlier Wuhan screenshot extraction and province image extraction are superseded and must not be treated as authoritative.

## Privacy defaults

Without an account, saved places and settings are stored in the current browser. They are not uploaded automatically.

The privacy panel controls the services that may receive data:

- map tiles, from the selected basemap provider;
- online place search, only when requested;
- weather, only when requested or when automatic marker weather is enabled;
- elevation, only when enabled;
- place-name lookup during AI import, only when enabled.

Weather coordinates are rounded to an estimated location by default. Residence markers, marker notes, wind limits and privacy settings are not sent as part of automatic lookups. Browser storage can be cleared by the browser or lost in private browsing, so export important places regularly.

## Development

### Requirements

- Node.js with npm
- Raw regional source files for data builds; these are intentionally kept out of Git
- A modern browser; geolocation requires HTTPS or `localhost`

### Install and run

```sh
npm install
npm run dev
```

The development server is normally available at `http://localhost:5173`.

### Build data and the application

```sh
npm run build:data   # builds public/data from local raw region files
npm run verify:data  # validates supported regional datasets
npm run build       # creates a production build in dist/
npm run preview     # serves the production build locally
```

`public/data/` is generated output. Large raw files and generated tiles should not be committed to the main source branch.

### Tests

```sh
npm test             # full test suite
npm run test:unit    # unit-focused suite
```

The test suite covers data validation, point checks, map/location behaviour, import/export validation, and the optional backend rules where applicable.

### Deployment

```sh
npm run deploy
```

This builds the app, removes local-only data, and publishes `dist/` to the `gh-pages` branch. Enable GitHub Pages to serve from that branch. The deployment script is intentionally separate from the source branch so generated tiles do not become part of normal Git history.

For a configured live Supabase build, use the project-specific deployment process described in [`supabase/README.md`](supabase/README.md). Never commit service-role keys, database passwords, access tokens or local environment files.

## Repository layout

```text
src/                         application, map, search, location, places and trips
scripts/                     data build, verification, CRS and tile tooling
data/regions/                region metadata, boundaries and local raw-data locations
data/places/                 editable offline place indexes
public/ai/                   AI prompt and GeoJSON schema/examples
public/data/                 generated data published with the deployment
docs/                        data provenance, AI and attribution documentation
supabase/                    optional database migrations, functions and backend tests
tests/                       application, data and backend tests
```

## Adding a region

Add one official dataset under `data/regions/<country>/<region>/`, describe its source and semantics in `source.json`, provide a WGS84 coverage boundary, and document provenance under `docs/regions/`. Raw files remain local and generated tiles are published only during deployment.

Before proposing a region, confirm its coordinate system, effective date, zone meaning, source terms and redistribution rights. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the complete workflow.

Attribute-dependent zone classes, such as different height limits within one dataset, are not currently supported by the generic build pipeline; raise an issue before adding such a dataset.

## Attributions and licences

The application code is licensed under the MIT licence. Zone data, basemap tiles, geocoding, weather and elevation services have separate sources and terms. See [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md) and the regional provenance documents before redistributing or operating the service at scale.

## Project documents

- [`Project_context/docs/PROJECT.md`](Project_context/docs/PROJECT.md) — detailed requirements and current architecture decisions
- [`CURRENT_STATUS.md`](CURRENT_STATUS.md) — current work and queue, when present in the checkout
- [`CHANGELOG.md`](CHANGELOG.md) — shipped history, when present in the checkout
- [`docs/AI.md`](docs/AI.md) — itinerary-to-marker format and safety rules
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — adding regional data
- [`supabase/README.md`](supabase/README.md) — optional cloud backend and deployment notes

