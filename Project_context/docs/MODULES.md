# Modules

Navigation index; read the file for exports and details. Paths under `src/` unless stated. **pure** = no DOM, importable from Node tests. Entry: `index.html` loads `main.js` (wires everything in start-up order).

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
| `sessions.js` (pure + API wrapper), `sessions-ui.js` | Flight sessions: validation, which controls to offer, the card with RSVP and the organiser's manage panel | `createSessions`, `sessionState`, `createSessionsCard` |
| `progression.js` (pure), `progression-api.js`, `progression-ui.js` | Rank progress, validation of what the database returns, a short cache, and the rank badge, progression card, achievement collection and XP history | `cleanProgression`, `rankProgress`, `getProgression`, `mountProgression`, `rankBadge`, `progressionMini` (map pin card; `livemap.js` `setRanks`) |
| `social.js` | Friends and profile RPC wrappers | `createSocial` |
| `friends-ui.js` | Friends tab (friend code, add a friend, lists, Sessions card), invitations, badge; rows open the profile popover | handle |
| `profile-dialog.js` | The Edit profile dialog (name, avatar, bio, location, interests, share switch, preview); opened only by Edit profile buttons | `createProfileDialog` |
| `profile-popover.js` | Small read-only profile popover for friend and party rows; `profileContent` is the body it shares with the Edit profile preview | `profileTrigger`, `showProfile`, `profileContent` |
| `touch.js` | No keyboard on open for touch screens: `focusField`, `showModalQuiet` (profile, account and splash screens) | `coarse`, `focusField`, `showModalQuiet` |
| `presence.js` | 30 s heartbeat | `initPresence` |
| `sharedtrip/api.js`, `core.js` (pure merge), `engine.js` | Shared-trip RPCs, three-way merge, polling | `createTripsApi`, `createSharedTrips` |
| `party-ui.js` | Party Members, invitations, live-location switch | handle, store |
| `live.js` (pure rules), `livemap.js` | Sending positions; pins on the map | `createLive`, `createLiveLayer` |

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
