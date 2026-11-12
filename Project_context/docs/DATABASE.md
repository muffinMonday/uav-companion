# Data storage

Three layers: (1) static files built at build time, (2) per-browser `localStorage`, (3) optional Supabase Postgres for signed-in users. Verified against `src/` and `supabase/migrations/` on 2026-11-12. Migrations are the source of truth for layer 3.

## 1. Supabase (Postgres, `public` schema; `supabase/migrations/`, applied in order)
**Access model:** RLS on every table. The only policy is `user_data_select_own` (select, `authenticated`, `user_id = auth.uid()`). `anon` and `authenticated` have all table privileges revoked (select on `user_data` granted back). All writes and all other reads are `security definer` functions (`set search_path = ''`) that read `auth.uid()`, reject anonymous callers, and never return another user's id (people are named by friendship, member or trip ids). Execute is revoked from `anon` on every function. No triggers of our own; no cron (cleanup happens inside functions). `20261111121000_harden_api_exposure.sql` revokes API access to the platform's `rls_auto_enable()`.

| Table | Key and columns | Constraints and notes |
|---|---|---|
| `user_data` | PK `user_id` to `auth.users` (cascade); `doc jsonb`, `rev bigint`, `updated_at`, `device` (<= 80), `markers`, `trips` | `rev >= 1`; doc is an object, <= 2 MB. One personal cloud copy per user |
| `user_data_versions` | PK `(user_id, rev)`; doc, counts, device | No policy (functions only). Kept 30 days, at most 20 |
| `profiles` | PK `user_id`; `display_name` (1 to 40), `friend_code` unique (10 hex), `accepts_requests`, `last_seen`, `show_online` | Functions only |
| `friendships` | `id`; `requester`, `addressee` to `auth.users`; `status` pending or accepted; `responded_at` | `requester <> addressee`; unique index on the unordered pair; indexes on both sides |
| `blocks` | `id`; `blocker`, `blocked`; unique pair | Blocking ends the friendship; the blocked person is not told |
| `shared_trips` | PK `id` (the client's trip id); `owner`; `doc` (`{v, trip, items}`), `rev`, `members_rev`, `name` (1 to 80), `markers`, `updated_by` | Doc <= 1 MB, <= 500 markers; index on `owner` |
| `shared_trip_versions` | PK `(trip_id, rev)` | Cascade from trip; 30 days, at most 20 |
| `trip_members` | `id`; `trip_id`, `user_id`; `role` owner or editor; `status` invited or joined; `invited_by` | Unique `(trip_id, user_id)`; index on `user_id` |
| `live_locations` | PK `(trip_id, user_id)`; `lat`, `lon`, `accuracy`, `updated_at`, `device` (nullable, 1-64 chars) | Range checks; latest position only; one device holds it (migration `20261112100000_live_device.sql`) |

**Functions (callable by `authenticated` only; the helpers `clean_display_name`, `check_trip_doc` and `is_party_member` by nobody)**
- Cloud copy: `save_user_data(p_doc, p_base_rev, p_device, p_force)` returns `ok` or `conflict` with the server's revision; `list_user_data_versions`, `restore_user_data_version`, `delete_user_data`.
- Friends: `ensure_profile`, `set_accepts_requests`, `regenerate_friend_code`, `request_friend(code)` (one answer for every failure reason; limits 50 pending, 200 friends), `respond_friend`, `remove_friendship`, `list_friends`, `block_user`, `list_blocked`, `unblock`, `delete_profile`.
- Shared trips: `share_trip` (owner, at most 20 per owner), `invite_to_trip` (accepted friends only; at most 10 people), `list_invitable_friends`, `respond_trip_invite`, `leave_trip`, `remove_member`, `delete_shared_trip` (owner-only), `list_my_trips`, `list_trip_members`, `get_shared_trip`, `save_shared_trip(p_trip, p_doc, p_base_rev)` (members; conflict on stale revision), `list_shared_trip_versions`, `restore_shared_trip_version`. `check_trip_doc` refuses Home markers, check-ins and over-limit docs.
- Presence: `touch_presence` (writes `last_seen` at most every 15 s), `set_show_online`; status columns in `list_friends` and `list_trip_members` are null unless the viewer is an accepted friend or joined co-member and both show status.
- Live: `share_location` (joined members; at most one per 2 s; `ended` a day after the trip's `endDate`; deletes rows older than 10 min), `stop_sharing_location`, `stop_all_sharing`, `list_live_locations`. Each takes an optional device id (`p_device`, a random string the page makes at load); `share_location` also takes `p_claim` (first position after sharing is turned on). The device that claims takes the row over; another device's later send returns `moved` and changes nothing, and its stops delete nothing. No device id = old behaviour (rows under 2 min old, joined members only). `leave_trip` and `remove_member` delete the person's position.

**Ownership:** a user owns their `user_data`, `profiles`, `blocks`; a friendship belongs to both sides; a shared trip belongs to its owner and is editable by joined members, deletable only by the owner. Deleting an `auth.users` row cascades.
**Hosted project:** link in `supabase/.temp/` (git-ignored); the one project doubles as dev. See `supabase/README.md` for tests, pushing and advisor warnings (the "signed-in can execute SECURITY DEFINER" warnings are accepted).

## 2. Browser storage (`localStorage`)
All reads are validated; damaged entries fall back to defaults. If storage is blocked the app runs from memory (`poi.js` probes first).

| Key | Owner | Shape and notes |
|---|---|---|
| `uavzones.v1.pois` | `poi.js` | `{ v: 1, items: [Item] }`. Item: `id`, `type` (home, hotel, takeoff, landing, photo, train, airport, hazard, residence, other), `name` (<= 80), `note` (<= 500), `lat`, `lon`, `created`; optional `day`, `order`, `date`, `endDate`, `unverified`, `tripId`, `checkin {at, lat, lon, acc}` (never on Home; exported, not shared), `updated` (shared-trip markers), `isSub: true` (a Side Quest; written only when true; never on home, hotel, residence) and `parentId` (its main stop; only with `isSub`; a preference, validated at use by `parentOf` in `trips.js`). A Side Quest's `order` is its position among its siblings, not a stop number (`stopNo`). `tripId` dropped for `residence` or an unknown trip. Import ceiling 2,000 items (`MAX_ITEMS`) |
| `uavzones.v1.trips` | `poi.js` | `{ v: 1, trips: [Trip] }`. Trip: `id`, `name` (<= 80), `created`, `color`, optional `country`, `startDate`, `endDate`, `description` (<= 500), notes/checklist, and for shared trips `shared {owner, ownerName}`, `updated`. Max 200 |
| `uavzones.v1.prefs` | `prefs.js` | Flat object: `basemap`, `country`, `opacity`, `popupOpacity`, `mode` (trip/flight), UI flags (`keyOpen`, `railFolded`, `panelTall`, `dashTall`, `panelCollapsed`, `windowExpanded`, `holdHint`, `markerDetails`, `crosshair`, `showSide`), privacy (`checkIn`, `autoWeather`, `weatherPrecision`, `fetchAltitude`, `lookupNames`), `units`, `maxRangeM`, `currentTrip`, `view {lat, lon, zoom}`. Authoritative list: `prefs.js` |
| `uavzones.v1.wxcache`, `.elevcache`, `.tripwx` | `markerweather.js`, `elevation.js`, `tripweather.js` | Caches; weather refresh 30 min, outdated after 3 h; orphans pruned at start; never synced |
| `uavzones.v1.dash` | `dashstate.js` | `{ v: 1, showOnStart, hideUntil, seen, welcomed, account }` (`account`: `'guest'`, `'profile'` or absent; optional, added with the quick setup's account row, so no version bump) |
| `uavzones.v1.lastBackup` | `poi.js` | ISO time of last export |
| `uavzones.v1.sync` | `sync/engine.js` | `{ baseRev, dirty, lastSyncedAt }` for the personal cloud copy |
| `uavzones.v1.shared` | `sharedtrip/engine.js` | `{ v: 1, bases: { [tripId]: { rev, doc } } }`: last synced version per shared trip (merge base); not exported or shared |
| `uavzones.v1.sharedwho` | `party-ui.js` | Email of whoever was signed in at last shared sync; a different person resets the links (trips stay) |
| `uavzones.v1.livehide` | `party-ui.js` | Trip ids whose party is hidden on the map. Sharing one's own location is never stored |
| `uavzones.windLimit` | `weather.js` | Older key without `v1`, kept |
| supabase-js session | supabase-js | Stored by the library under its own `sb-…` key |

Limits: import file 2 MB; 2,000 items.

## 3. Files
- **Export/import (GeoJSON, `uavzones: 1`):** Points `[lon, lat]` with `properties` (id, type, name, note, created, optional day/order/date/endDate/unverified/tripId/isSub/parentId/checkin), optional top-level `trips`. Import merges by id; existing ids skipped; markers of unknown trips arrive untagged. Home markers are exported, never put in share links.
- **Share links:** `#import=z.<deflate-raw base64url>` and compact `z2.` (`sharecompact.js`; row slots 11 = Side Quest flag, 12 = parent row number, both absent on main stops, so older links and rows are unchanged); no Home, check-ins, notes, checklists.
- **Static data (`public/data/`, not in git):** `index.json`, `<country>/manifest.json`, hashed PMTiles per region, `places/`. Sources in git: `data/regions/<country>/country.json`, `<region>/source.json` + `boundary.geojson`, `data/places/<country>.txt`. Hubei: 84,863 cells, verified against the shapefile by `npm run verify:data`.

## Migration notes
- The `uavzones.` prefix and `uavzones: 1` flag predate the rename and stay so old data loads.
- Stored days are converted to dates at start-up (see `DECISIONS.md`, day from date).
- A changed stored shape: bump `v`, add a loader for the old one, add a line here. A new SQL change: a new migration file, never edit an applied one; add a `tests/db-*-unit.mjs` check.
