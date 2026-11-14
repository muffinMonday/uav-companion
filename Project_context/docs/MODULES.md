# Modules

Navigation index; read the file for exports and details. Paths under `src/` unless stated. **pure** = no DOM, importable from Node tests. Entry: `index.html` loads `main.js` (wires everything in start-up order; its larger responsibilities live in `src/app/`).

## Map and zones
| File | Responsibility | Depends on |
|---|---|---|
| `map.js` | Leaflet map, four OSM-family basemaps (`baseTiles()` is the one place a dark tile source would plug in; dark today = CSS filter on `.base-tiles`), scale, zone layer | `config.js`, `prefs.js` |
| `config.js` | Data base URL (`VITE_DATA_BASE_URL`) | - |
| `zones.js` (pure), `pointcheck.js` | Zones at a point from PMTiles; verdict wording by region semantics | pmtiles, vector-tile |
| `holdcheck.js` | 2 s hold, right-click, Enter to check a spot | - |
| `crosshair.js` | Centre crosshair and coordinates | `prefs.js` |
| `view.js` | Centre map aware of the panel; popup heights | - |
| `locate.js`, `heading.js` (pure maths), `maprotate.js` | Locate button steps, compass, own map rotation (not `leaflet-rotate`: GPL) | Leaflet |
| `search.js`, `coordparse.js` (pure), `coords.js` (pure, WGS-84/GCJ-02, `inChina`) | Offline and online search, coordinate/map-link parsing | `config.js` |
| `maplinks.js` (pure), `maplinks-ui.js` | Google Maps / Amap links and routes | `coords.js` |

## Markers and trips (local model)
| File | Responsibility | Depends on |
|---|---|---|
| `poi.js` (pure) | Types, sanitize, store, GeoJSON export/import, limits; Side Quest helpers `isMain`, `isSub`, `stopNo`, `NOT_SUB` | `countries.js` |
| `poi-ui.js` | Marker list, window, edit, select/delete, import/export; Side Quest folding (`+N` badge, nested rows, `sideState` shared with the Trips tab) and convert actions; selected-card highlight (`cardIds`, `markCard`, `paintCards`; `cards` shared with the Trips tab) and `revealCard`, which scrolls the open panel to a clicked marker's card | `poi`, `distance`, `trips`, `cards` |
| `trips.js` (pure), `trips-ui.js` | Trip rules (days, warnings, status); Side Quest lookup `parentOf`, `defaultParent`, `sideQuestMap`, `sideQuests` and the conversions `sideQuestPatch`, `mainStopPatch`; Trips tab and plan screen | `poi` |
| `tripweather.js` | Daily forecast per trip | `weather`, `privacy` |
| `distance.js` (pure) | Nearest Home point/Hotel, nearest Home | - |
| `places.js`, `reorder.js` (pure: `planMove`, `planSideMove`, `stepSlot`, `stepSideIndex`), `reorder-ui.js` | Same-spot visits; reorder by hold and drag (Points of Interest list; `flat` mode for the Trips day pages); Side Quest moves | `poi`, `trips` |
| `checkin.js` (pure), `checkin-ui.js` | Check-in rules (300 m, 150 m accuracy), watcher | `privacy` |
| `countries.js`, `dates.js`, `units.js` (pure) | Helpers | - |

## AI import and sharing
| File | Responsibility |
|---|---|
| `aiimport.js` (pure apart from geocode), `ai-ui.js` | Parse, sanitize, preview, add; share links `z.`/`z2.`; `linkSideQuests` finds each Side Quest's parent after import |
| `aiprompt.js` (pure), `splash.js` | Quick-setup prompts and first-visit dialog |
| `sharecompact.js` | Compact `z2.` share-link format |
| `public/ai/` | Published prompt, schema, example (`trip-unit` checks them against `TYPES`) |

## Accounts, social, shared trips (need `VITE_SUPABASE_*`)
| File | Responsibility | Interface |
|---|---|---|
| `sync/core.js` (pure) | Cloud-copy rules: `decide`, `buildDoc`, `diffDocs`, synced settings (`cleanSettings`, `mergeSettings`), `contentSig` | - |
| `sync/engine.js` | Acts on the rules through an adapter; state in `uavzones.v1.sync`; optional `settings` hooks (theme: adopt newer, upload ours alone, `checkSettings` on tab focus) | adapter |
| `sync/supabase.js` | Real adapter; dynamic-imports supabase-js; `configured()` | `client` |
| `sync-ui.js` | Cloud copy card (status, sync, versions), sign-in form and sign-out flow, conflict prompt; returns the handle used below | `initSyncUI` |
| `account-ui.js` (also the delete-account dialog) | Account button (panel header and rail) and its popover: guest note and sign-in, or name, friend code, sync state, Edit profile, Friends, Sign out | handle |
| `avatars.js` (pure lists, `avatarEl`), `profile-ui.js` | Preset avatars and interest tags; the Profile card and the bio/location lines | `avatarEl`, `profileBits` |
| `steam.js` (pure + API wrapper), `steam-ui.js` | Steam: validation, wording, reading the sign-in result, the Steam card (link, sync, unlink) | `createSteam`, `cleanSteam`, `createSteamCard`, `announceSteamReturn` |
| `sessions.js` (pure + API wrapper) | Flight sessions 2.0: validation of every RPC reply (`cleanSession`, `cleanPublic`, `cleanInvitation`, `cleanNotice`, `cleanInviteList`), which controls to offer (`sessionState`), the wording that separates hosting from "can verify attendance for XP" (`roleText`), link helpers | `createSessions`, `sessionState`, `roleText`, `capacityText` |
| `sessions-recurrence.js` (pure) | Dates a repeat gives (weekly, every two weeks, monthly with clamping), the Saturday preset, the preview text; mirrors the SQL `session_occurrence_date` | `occurrenceDates`, `previewSeries`, `nextSaturday` |
| `sessions-create.js` | The New session form (layout classes `.ses-narrow` `.ses-field` `.ses-sec`: DESIGN section 16; map pin, saved-marker shortcut, repeat preview, private by default, public confirmation, capacity); the draft lives in memory only; pure `draftToRequest` | `createSessionForm`, `draftToRequest` |
| `sessions-hub.js` | The Sessions hub dialog (Discover, My sessions, Invitations, detail, host tools, invitations and private links, reporting), the map button, the point picker and "show on the map" bar, the `#session=` link handler, the summary the dashboard and Friends card read (`cloud.sessions`) | `initSessionsHub` |
| `sessions-ui.js` | The short Flight sessions card in the Friends tab: a summary and a button that opens the hub | `createSessionsCard`, `summaryLines` |
| `progression.js` (pure), `progression-api.js`, `progression-ui.js` | Rank progress, validation of what the database returns, a short cache, and the rank badge, progression card, achievement collection and XP history | `cleanProgression`, `rankProgress`, `getProgression`, `mountProgression`, `rankBadge`, `progressionMini` (map pin card; `livemap.js` `setRanks`) |
| `social.js` | Friends and profile RPC wrappers | `createSocial` |
| `friends-ui.js` | Friends tab (friend code, add a friend, lists, Sessions card), invitations, badge; rows open the profile popover | handle |
| `profile-dialog.js` | The Edit profile dialog (name, avatar, bio, location, interests, share switch, preview); opened only by Edit profile buttons | `createProfileDialog` |
| `profile-popover.js` | Small read-only profile popover for friend and party rows; `profileContent` is the body it shares with the Edit profile preview | `profileTrigger`, `showProfile`, `profileContent` |
| `touch.js` | No keyboard on open for touch screens: `focusField`, `showModalQuiet` (profile, account and splash screens) | `coarse`, `focusField`, `showModalQuiet` |
| `presence.js` | 30 s heartbeat | `initPresence` |
| `sharedtrip/api.js`, `core.js` (pure merge), `engine.js` | Shared-trip RPCs, three-way merge, polling | `createTripsApi`, `createSharedTrips` |
| `party-ui.js` | Party Members, invitations, live-location switch | handle, store |
| `live.js` (pure rules), `livemap.js` | Sending positions (trips and the `FRIENDS` scope); pins on the map (friends drawn as rounded squares) | `createLive`, `createLiveLayer` |
| `autoshare.js` (pure) | Decides when to start and stop sharing by itself (consent, who is online, by-hand stops); wired in `party-ui.js` | `createAutoShare` |

## Shell and settings
| File | Responsibility |
|---|---|
| `panel.js`, `swipe.js` | Side panel, rail, tabs (generic over `[role=tab]`), phone sheet; swipe gestures (sheets, dashboard, the map popups via `onPopupSwipe`, and the profile, achievement and account dialogs via `onDialogSwipe`) |
| `dashboard.js`, `dashstate.js` (pure), `whatsnew.js` | Bottom dashboard and its start rules; What's new entries (add one to announce a change) |
| `prefs.js`, `privacy.js`, `privacy-ui.js` | Validated settings; opt-in switches and rounding |
| `log.js`, `logscrub.js`, `logstore.js`, `errors.js` | Local diagnostics: the logger (levels, `?debug=1`, repeat counting), privacy scrubbing (allow-list), the IndexedDB ring buffer with rotation and JSON export, and the observe-only global error handlers. `backoff.js` (`name`) logs the start and end of a failure streak | none (`privacy-ui.js` shows the Diagnostics card) |
| `theme.js` | System / Light / Dark: resolves the choice, sets `<html data-theme>`, follows the device and other tabs (`index.html` has a matching before-first-paint script) | `prefs.js` |
| `weather.js`, `markerweather.js`, `elevation.js` | Open-Meteo forecast, per-marker caches, elevation |
| `controls.js`, `motion.js`, `cards.js`, `styles.css` | Number/date fields; animation helpers; `el()` DOM helper; all styling (rules and tokens: `DESIGN.md`) |

## Build, data, tests
| Path | Responsibility |
|---|---|
| `scripts/build-data.js` (+ `lib/{crs,readers,tiles,pmtiles-writer,onemap}.js`) | Regions to `public/data/` |
| `scripts/verify-data.js`, `strip-local.js`, `make-china-outline.js` | Tile check; remove local-only regions before deploy; China outline for `src/data/` |
| `data/regions/<country>/<region>/{source.json,boundary.geojson}`, `data/places/` | Committed region definitions; raw data local |
| `supabase/migrations/`, `supabase/README.md` | Database; see `DATABASE.md` |
| `tests/` (`run.mjs`, `lib*.mjs`) | Suites; see `DEVELOPMENT.md` |
| `docs/` | `AI.md`, `ATTRIBUTIONS.md`, `regions/` |

## Start-up modules (`src/app/`, refactor Phase 2)
| File | Responsibility |
|---|---|
| `app/point-check.js` | `createPointCheckUI({ map, panel, weather, addAt })` returns `{ showCheck, showWeather }`: the point-check popup (elevation, weather button, map links, official map link, Add as marker/Side Quest, swipe). `addAt` is late-bound to the POI module |
| `app/map-settings.js` | `initAppearanceSettings` (theme radios), `initMapSettings` (popup opacity, basemap, zone opacity value, saved view), `initWeatherSettings` (map app/mode, wind limit) |
| `app/region-loader.js` | `loadRegionData({ dataUrl, localUrl, mayHaveLocalData })` returns `{ index, regions, places }`; local-only regions merged, tolerated if missing; unit test `region-loader-unit` |
| `app/region-ui.js` | `initRegionUI` (country menu, Centre button, dashboard Fly in, returns `clearOfPanel`), `renderRegionInfo` (legend, coverage note) |

`main.js` keeps the start-up order, toast, launch-location flags, POI/Trips/AI/dashboard/splash/cloud wiring (cloud starts without being awaited, concurrently with region loading), map click and hold handlers, flying-area pins and zone layers.

## HTML components (Phase 1)

Canonical plan and validation: `HTML_MAIN_REFACTOR_BACKLOG.md`. Static HTML fragments:
`src/components/search.html`, `dock.html`, `panel.html`, `map-config.html`,
`trips-panel.html`, `poi-panel.html`, `privacy-panel.html`, `dashboard.html`.

`index.html` is the shell; `scripts/html-components.js` assembles these files through the Vite plugin in `vite.config.js`, in dev and production. `panel.html` includes its three tab sections and Privacy. Startup/wiring: `src/main.js` with `src/app/` (above). `tests/html-components-unit.mjs` and `tests/html-dom.mjs` cover assembly and DOM/reload behavior. Setup and include rules: `DEVELOPMENT.md`.

### Component ownership map (UI feature -> HTML -> JS -> CSS -> tests)

All CSS is in `src/styles.css` (tokens and rules: `DESIGN.md`); find a feature's rules by its root id or class. Fragments are under `src/components/`; "dynamic" means built by the JS owner with `el()`, with no static fragment.

| Feature | HTML | JS owner | CSS root | Suites |
|---|---|---|---|---|
| Search box | `search.html` (`#search`) | `search.js` | `.search`, `.results` | `search`, `shell`, `mapsel` |
| Panel rail | `dock.html` (`#dock`) | `panel.js`; account button from `account-ui.js` | `.dock` | `shell`, `swipe`, `tabpill`, `friends` |
| Side panel shell, tabs, phone sheet | `panel.html` (`aside#panel`, includes the four below) | `panel.js`, `swipe.js` | `.sp-`, `.tabs`, `.pbody` | `shell`, `ui`, `paneltall`, `swipe`, `tabpill` |
| Map Configs (basemap, opacity, country, units, map app, wind limit, Appearance) | `map-config.html` (`#pane-config`) | `app/map-settings.js`, `app/region-ui.js`, `theme.js`, `weather.js`, `poi-ui.js` (status lines) | `.switch`, `.radio`, `.status` | `prefs`, `layers`, `opacity`, `mapsel`, `theme`, `dashboard`, `mw` |
| Trips and Plan with AI | `trips-panel.html` (`#pane-trips`) | `trips-ui.js`, `ai-ui.js` | `.trip-card`, `.plan-name` | `trip`, `trips`, `tripplan`, `tripstouch`, `ai`, `sidelist`, `sidedrag` |
| Points of Interest | `poi-panel.html` (`#pane-poi`) | `poi-ui.js`, `reorder-ui.js` | `.poi-list`, `.poi-item` | `poi1`, `poi2`, `bulk`, `edit`, `stops`, `days`, `cardsel`, `side` |
| Privacy and Diagnostics | `privacy-panel.html` (`#privacy`) | `privacy-ui.js`, `panel.js`; cloud card from `sync-ui.js` | `.pv-`, `.switch` | `priv`, `mw`, `rain`, `diag`, `autoshare`, `cloud` |
| Dashboard and quick setup | `dashboard.html` (`#dash`, `#dash-peek`, `#dash-tab`) | `dashboard.js`, `splash.js` | `.dash`, `.dash-card`, `.dash-peek`, `.splash` | `dashboard`, `dashtall`, `dayroute`, `splash`, `swipe` |
| Point-check popup, hold/click check | dynamic | `app/point-check.js`, `pointcheck.js`, `holdcheck.js` | `.pop`, `.leaflet-popup` | `hold`, `popswipe`, `search`, `side` |
| Marker windows, name tags, pins | dynamic | `poi-ui.js`, `livemap.js` | `.poi-pin`, `.name-tag`, `.live-pin` | `poi1`, `poi2`, `popswipe`, `live` |
| Legend, coverage note, zone layers | `map-config.html` nodes moved by `dashboard.js` | `app/region-ui.js` (`renderRegionInfo`), `map.js` | `.legend` | `dashboard`, `prefs`, `smoke` |
| Locate, compass, rotation | dynamic Leaflet controls | `locate.js`, `maprotate.js` | `.locate-btn` | `launchloc`, `locatemode`, `maprotate` |
| Friends, party, sessions, account pane, progression, Steam | dynamic | `friends-ui.js`, `party-ui.js`, `sessions-ui.js`, `account-ui.js`, `progression-ui.js`, `steam-ui.js` | `.fr-`, `.ses-`, `.account-pop`, `.profile-dialog` | `friends`, `party`, `live`, `sessions`, `responsive`, `progression`, `steam`, `autoshare` |
| Toast, banner, weather card | `index.html` (`#toast`, `#banner`, `#weather`) | `main.js` (toast), `weather.js`, `whatsnew.js` | `.toast`, `.wx` | `smoke`, `mw`, `rain` |

The two weather/elevation status lines are `#mw-status` (Map Configs) and `#pv-mw-status` (Privacy); `poi-ui.js` writes both.

Future Community Flying Areas plan: `COMMUNITY_FLYING_AREAS_PLAN.md`.
