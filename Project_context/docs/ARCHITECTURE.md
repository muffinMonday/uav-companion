# Architecture

A static front end (GitHub Pages) that works fully without a server, plus an **optional** Supabase backend used only when the build has a project address. No server code of our own: the browser talks to Supabase directly.

## Components
| Component | Responsibility |
|---|---|
| Build pipeline (`scripts/`, Node, local) | Region shapefiles/GeoJSON/OneMap themes to one content-hashed PMTiles per region, manifests, places index in `public/data/` |
| Static data (`public/data/`, generated, not in git) | `index.json`, `<country>/manifest.json`, `tiles/<country>/<region>.<hash>.pmtiles` (under `tiles/` so the CDN never serves a stale Range response for an old path), `places/`. Browser: each archive is downloaded whole, checked against its name's hash, and kept in the Cache API (`uavzones-pmtiles-v1`, with a last-use index); older hash-named archives are kept, and one is evicted only when a save hits a full store (`src/pmtiles-source.js`) |
| Web app (`src/`, `index.html`) | Leaflet map, zones from PMTiles, point check, search, opt-in weather/elevation, markers, trips, AI import, dashboard, privacy; side panel tabs Map Configs, Trips, Points of Interest, and Friends (only in a build with accounts) |
| Static AI assets (`public/ai/`, `public/llms.txt`) | Prompt, schema, example for any AI assistant |
| Supabase (`supabase/migrations/`) | Auth (email link), Postgres with RLS, SQL functions as the only write path. See `DATABASE.md` |
| Hosting | GitHub Pages `gh-pages` branch, manual `npm run deploy`, no CI |

## Front end
- Local-first: `poi.js` store (markers, trips) persists to `localStorage` and notifies listeners; the UI re-renders from it. Signed-out users never touch the network except basemaps and opted-in services.
- Pure logic modules (no DOM) are unit-tested in Node; `*-ui.js` modules hold DOM. Module map: `MODULES.md`.
- Startup (`main.js`, with `src/app/` modules): theme and preferences, map, panel, POI/trips/AI/dashboard; `initSyncUI` starts without being awaited (only if configured and signed in does it start presence, party and friends) while the region data, country menu, pins, zones and legend load concurrently.

## Backend integration
- **Gating:** `sync/supabase.js` `configured()` requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. `.env.development.local` supplies them to `npm run dev` only; `npm run build`/`deploy` omit them unless set in the shell, so the live site shows no sign-in by default. `@supabase/supabase-js` is a dynamic import, never downloaded when unconfigured.
- **Auth:** email magic link (`signInWithOtp`) and Google (`signInWithOAuth`, default identity scopes, returns to the same `redirectTo`); implicit flow for both (decision D1), session persisted by supabase-js. A failed or cancelled Google return that reaches the app carries `error` in the address; `takeAuthReturnError` (`sync-ui.js`) reads it once, clears it and the account popover opens with a message. Denying Google's own consent screen stays on Google's page and never returns. Supabase links Google to an existing user with the same verified email; the app never matches by email. The redirect URL must be in Supabase's allow-list (`supabase/config.toml` lists localhost and the Pages address). The browser holds only the project address and publishable key; the service-role key and DB password never enter the repo.
- **Client to server:** one read, `select` on `user_data` (RLS: own row). Everything else is an RPC to a `security definer` SQL function that reads `auth.uid()` and validates role, size and shape. No table is writable directly; no function returns another user's id.

## Data flows
| Flow | Modules | Cadence and rule |
|---|---|---|
| Cloud copy (markers + trips as one document) | `sync/core.js` rules, `sync/engine.js`, `sync/supabase.js`, `sync-ui.js` | Push about 2.5 s after a change; revision per device (`baseRev`, `dirty`); true conflict asks the user (backup of the losing side offered); 20 versions or 30 days kept. Check-ins excluded unless the user opts in. Sign-out (`signOut({ wipe: true })`) syncs first, then clears this device's markers and trips (data stays in the cloud copy); it refuses while changes are unsynced or check-ins exist only here, and a forced sign-out downloads a backup first. Identical data on a never-synced device and the cloud is adopted without a question |
| Friends | `social.js`, `friends-ui.js` | Friend code, no search; tab refreshes every 30 s while shown, badge every 2 min |
| Shared trips | `sharedtrip/{api,core,engine}.js`, `party-ui.js` | One document per trip with revision; poll every 10 s (every 20 s after about a minute with nothing new, every 30 s after about three; back to 10 s on a change, an edit or coming back to the page; a failed poll waits longer each time), save about 2 s after a change; three-way field-level merge in the client (edit beats delete); owner-only delete and membership; Home markers and check-ins refused by the database |
| Online status | `presence.js` | Heartbeat every 30 s while signed in and visible; online within 75 s; hideable (symmetric) |
| Live locations | `live.js`, `livemap.js`, `party-ui.js` | Per-trip switch, off on every app start; send at most every 5 s; others polled every 5 s, and only while `list_my_trips` says someone else in the party is sharing (`live_active`); server keeps latest row only (stale 2 min, deleted after 10 min; ends a day after the trip) |
| Zones and point check | `map.js`, `zones.js`, `pointcheck.js`, `pmtiles-source.js` | Each archive is downloaded whole, when its bounds meet the view (see Fly In regions); check reads the max-zoom tile |
| AI import | `aiimport.js`, `ai-ui.js` | Lenient parse, strict sanitize, preview; optional name geocoding |

## Fly In regions
The dashboard's **Fly in** card is a dropdown with one choice per region archive. Choosing one fits the map to that region's bounds (`app/region-ui.js`, `goToArea`). The zone layers then load only the archives whose bounds meet the visible map (`map.js` `createZones`, on every `moveend`), so a region outside the view is not downloaded. The index and manifests are small JSON and load first; no archive is fetched by them.

Options, in the order shown (Title Case, as in the dropdown):
- Chongqing
- Guangdong
- Hubei
- Hunan
- Jilin
- Ningxia
- Sichuan
- Singapore

The label of each region ID is in `src/app/region-labels.js` (`REGION_LABELS`); a region with no entry would show its manifest name instead:

| Region ID | Fly In label |
|---|---|
| `cn-chongqing` | Chongqing |
| `cn-guangdong` | Guangdong |
| `cn-hubei` | Hubei |
| `cn-hunan` | Hunan |
| `cn-jilin` | Jilin |
| `cn-ningxia` | Ningxia |
| `cn-sichuan` | Sichuan |
| `sg-nofly` | Singapore |

**Keep in sync:** whenever a region's shape archive is added or removed, check the Fly in options, `REGION_LABELS` and this list in the same change. `tests/region-labels-unit.mjs` fails when a region in `public/data` has no label, a label has no region, or the choices differ from its expected list (update that list with the change). `tests/fly-in.mjs` checks the dropdown and the downloads in the browser.

The header's country menu is separate: it centres on a whole country, and a country view loads every archive it touches (China: all of them).

## External services (browser side)
| Service | Use | Sent | Gate |
|---|---|---|---|
| OpenStreetMap, OSM France (Humanitarian, CyclOSM), OpenTopoMap | Tiles | Tile coordinates, IP | Always |
| Open-Meteo forecast / elevation | Weather / ground height | Coordinates (about 1 km rounded unless precise; elevation 4 decimals) | Opt-in |
| Photon, then Nominatim | Place search, AI name lookup | Query text | On use; lookup opt-in |
| Supabase | Accounts, cloud copy, friends, shared trips | Signed-in user's data as described above | Build config plus sign-in |
| Google Maps, Amap | Links only (opened by the user) | Coordinates in the URL | User click |

## Boundaries and constraints
- The Home (residence) marker is never sent automatically, never in share links or shared trips; it is in the user's own export and, if they sign in, in the personal cloud copy.
- Client checks are convenience; the database functions enforce permissions and limits.
- Hosting must support HTTP range requests; GitHub Pages is limited (about 1 GB per site).
- `localStorage` can be blocked or cleared (falls back to memory); export or cloud copy is the backup.
- Not built: offline mode (service worker), realtime push (polling is used), flight sessions/lobby (W6), diagnostics (W7 to W10).
- Tests run in Edge via Playwright against `localhost:5173`; Open-Meteo, Photon, Nominatim and Supabase HTTP are mocked (Supabase calls run the real SQL on in-memory Postgres, PGlite).
