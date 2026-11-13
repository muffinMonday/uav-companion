# Decisions

Current, constraining decisions only; superseded ones are removed (history: git, `CHANGELOG.md`). Grouped by area. "Owner" means the project owner chose it. Product-level open questions: `PROJECT.md` section 8.

## Platform and data
**Account deletion (owner, 2026-11-13).** The sign-in record is removed by an edge function (service-role key kept as a function secret), after `delete_account` has removed the app data in one transaction. A trip the deleter owns passes to the member who joined first; with nobody else joined it is deleted. Confirmation is typing DELETE; a backup of the device is offered; markers and trips on the device are kept (they are then the only copy). "Delete my profile and friends" stays as the lighter option and keeps the cloud copy.

**Identity and progression (owner, 2026-11-12; built 2026-11-14).** The auth user id (UUID) is the identity. Progression has its own tables keyed by it; `profiles` stays social-only, so deleting a profile and deleting progression are separate: `delete_profile` withdraws session RSVPs but keeps XP, attendance and achievements; only deleting the account removes them. Whether `delete_profile` should wipe XP is still open (owner).

**Progression is server-authoritative and auditable (owner, 2026-11-14).** XP is an append-only ledger with a unique key per award; the only inserter is an internal function; rank is derived from total XP (never stored); thresholds and rates are data. Administrators add or remove XP only with a reason, never below zero, never on themselves; the ledger records who and why. Full rules: `PROGRESSION.md`.

**Progression is visible to friends and party members only, and respects the profile switch and blocks (owner, 2026-11-14).** The owner's first wish was public visibility; the decision was: no public profile discovery, no friend-code lookup, no new exposure of locations. So one rule (`progression_viewable`) decides: accepted friend or joined co-member, `share_profile` on, no block either way, with one identical "not shown" answer for every other case. The shared `share_profile` switch now also hides rank, XP, achievements and the map ring. Others never see unlock times, XP transactions or Steam ids; the owner sees their own history. Consequence: lists were not extended with XP columns; the app asks `list_progression` for the ids on screen.

**Achievements are permanent milestones (owner, 2026-11-14).** Once unlocked an achievement is never revoked and keeps its first time, even after an XP deduction that lowers the rank; every metric only goes up (rank achievements use the peak tier). Achievements give no XP. Rarity is fixed by difficulty (16 launch achievements: 6 common, 5 rare, 3 epic, 2 legendary). The four real-world flying achievements are not defined until a flight-logging feature exists; trip creation or check-ins are not accepted as evidence.

**Attendance XP needs an organiser (owner, 2026-11-14).** RSVP gives no XP; only an organiser or administrator of that session marking the person present does (50 XP, once per person per session, never yourself, from the start until closed). Organiser and administrator roles are granted only by an administrator, and the first administrator is added by the owner with SQL. Walk-ins are marked by friend code. A mistaken mark is undone only by an administrator with a reversal row; achievements stay and re-marking does not award again. Sessions are created by organisers and administrators only.

**Steam playtime (owner, 2026-11-14).** Only approved simulators count (Liftoff®: FPV Drone Racing 410340, Liftoff®: Micro Drones 1432320, FPV LOGIC 2398030, Uncrashed 1682970, The Drone Racing League Simulator 641780, TRYP FPV 1881200; VelociDrone is not on Steam). 10 XP per completed hour, no weekly or monthly cap, no retroactive XP (baseline at link), Game details must be public, the Web API key is an edge-function secret, sync once a day plus Sync now with a 60 minute cooldown (scheduled runs ignore the cooldown). The app never sends minutes and the Steam id is never shown. Not yet run against real Steam.

**One profile switch, not one per field (owner, 2026-11-12).** `share_profile` shows or hides bio, location and interests together, to accepted friends and joined party members; the name and avatar are always shown to them. Reason: simple to explain and to enforce in SQL. Avatars are a fixed list of drawn icons (FPV platforms, photography drones, travel), no upload and no Storage; interests a fixed list of tags with FPV flying styles. Replaces the backlog's per-field visibility.

**Static app, PMTiles, one file per region.** Reason: only tiles in view load; adding a region needs no code; static hosting. Consequences: local Node build with own PMTiles writer (`scripts/lib`); host must support range requests.

**Region folders with `source.json` and `allow`/`restrict` semantics; optional `layers[]`.** Reason: China publishes where flying is allowed, most others where it is restricted; wording and colours follow. Consequences: point check returns every zone containing the point; raw data stays local, only `source.json` and `boundary.geojson` are in git; coverage uses a boundary (Singapore: 1.5 km margin).

**Sourced geo data is published on the public site by default (owner, 2026-11-11), `publish: false` keeps a region local.** Reason: openness, one behaviour for all regions. Consequences: Hubei and Singapore (OneMap) published with licence unconfirmed/unread, to be removed if the owner of the data objects; `npm run deploy` runs `strip-local.js` and fails if a local region would go out; Singapore temporary restricted areas ignored.

**No CI; manual `npm run deploy` to `gh-pages` as a single commit, only with owner approval.** Reason: owner's choice; keeps tiles out of `main`. Consequences: publishing is deliberate and public.

**Public MIT repo; GPL code is not shipped.** Reason: bundle licence. Consequences: map rotation written in-house (`maprotate.js`, wraps Leaflet 1.9 internals; tests reveal breakage on upgrade); MSP code for diagnostics must be written from the protocol.

**Map layers: OpenStreetMap family only (OSM default, Humanitarian, CyclOSM, OpenTopoMap); no satellite (owner, 2026-11-12).** Consequences: a saved Esri/satellite choice falls back to OSM.

**Name UAV Companion; storage prefix `uavzones.` and export flag `uavzones: 1` kept.** Reason: existing saved data and files must load.

## Privacy and data handling
**Privacy by default.** Weather, elevation, name lookup, check-in are opt-in (the one exception: the launch location fix, on by default with a Privacy switch, never sent anywhere, 2026-11-13); weather location rounded (~1 km) unless "precise"; elevation precise. The Home (residence) marker is never sent automatically and never in share links or shared trips. Consequences: export files and the personal cloud copy contain Home; treat exports as private.

**Validate everything on load and import; AI import is generic, lenient to parse, strict to accept.** Published prompt, schema, example; everything sanitized, previewed, flagged `unverified` when looked up; `(0,0)` is missing; swapped lat/lon corrected; dates must be real ISO dates. Reason: models invent coordinates.

**Share links `#import=z2.…` compact and exact; no third-party shortener (owner).** Consequences: notes, checklists, trip colour, Home and check-ins are not in links; old `z.` links still read.

**Check-in is opt-in, local, 300 m / 150 m accuracy, one per marker, exported but never shared (owner).**

## Accounts and backend
**Optional accounts on Supabase; the static, cache-driven app is untouched without them (owner, 2026-11-11).** Reason: data should follow a user across devices without changing the offline-friendly app. Alternatives not chosen: SQLite then Supabase; Django on PythonAnywhere (fallback if full control is ever wanted). Consequences: browser holds only project address and publishable key; signed-out users load no backend code; development uses a hosted dev project plus PGlite for rule tests (no Docker).

**Database writes only through `security definer` functions; no direct table access; RLS on every table.** Reason: rules are testable and enforced regardless of the client. Consequences: new tables need RLS, revoked grants and a `tests/db-*-unit.mjs` check; the advisor's "signed-in users can execute SECURITY DEFINER function" warnings are accepted.

**Cloud copy is local-first with revisions; a true conflict asks the user, after offering a backup of the side that would be overwritten; 20 versions or 30 days kept.** Consequences: nothing is silently overwritten.

**Friends by friend code only; no search or user listing; one answer for every failed code.** Reason: privacy, no probing. Consequences: no function returns another user's id.

**Shared trips: party members may edit the trip and its markers; only the owner deletes it or manages members; field-level three-way merge in the client (edit beats delete); 30-day versions; leaving keeps a private copy (owner).** Alternatives not chosen: CRDT library, whole-document last-writer-wins. Consequences: limits 10 people, 500 markers, 20 shared trips per owner; Home and check-ins refused by the database.

**Updates by polling, not Realtime** (shared trips 10 s, live locations 5 s, presence 30 s). Reason: testable with the same access rules. Realtime remains a later option. Efficiency review (2026-11-15): polling is kept; it was made cheaper instead (adaptive polling driven by `live_active`, back-off after failures, one request at a time, no document reads in the poll calls). Realtime would need select policies on tables that have none by design, or a new private-channel access rule, and its message limits are reached sooner by a party sharing positions than by polling; revisit only if measured load still needs it (`CURRENT_STATUS.md`).

**Retention job (pg_cron) on hold** (owner, 2026-11-15): stale `live_locations` rows and old versions are still removed only by writes; a scheduled clean-up waits for real users or a second project.

**Online status is symmetric: hiding yours hides theirs from you.** **Live location sharing is per trip, off on every app start, never resumed, ends a day after the trip, latest position only.**

**Before real users:** second Supabase project, closed sign-ups, email confirmation, outside email sender. Public flight sessions will show an approximate area; moderation and a privacy policy come first. Diagnostics run only in the browser (Web Serial, desktop Chrome/Edge); the motor test is built last with props-off safeguards.

## Trips, markers, dates
**Trips:** markers carry optional `tripId`; Home never has one; waypoint-to-Home point/Hotel distance only within the same trip and date overlap; every non-Home marker also shows distance to nearest Home; straight-line distances; deleting a trip keeps markers.

**The day is derived: Day N = date minus trip start plus one; trips need start and end dates; no Day box (owner).** Stored days are converted at start-up. Reordering works only on dated lists.

**Each visit to a place is its own marker; markers within 15 m display as one place (×N, chips, Add visit).** An AI repeat is a duplicate only when dates match or are missing.

**Reorder by hold (1 s) then drag within a group; a drop rewrites date, day, stop, hotel end; Undo 10 s.** **Bulk delete = Select mode with a backup prompt and in-memory 10 s Undo (does not survive reload).**

**Overnight route arrows pass through the hotel covering the night; hotels take no part in the thin day chain.**

**Side Quests (owner, 2026-11-12):** optional nearby stops hung from a main stop. Stored as `isSub: true` plus optional `parentId`, written only when true; never for home, hotel, residence. Reason: collapse optional detours out of the route without a second data model. Consequences: a Side Quest reuses `order` as position among siblings, so labels use `stopNo()`, and every list that numbers, chains or counts stops uses `isMain` (Previous/Next, route chain, day plan, forecast, visited counts, reorder); it keeps its distance lines but is never a base; no date warnings; a missing or invalid parent falls back to the nearest main stop of the trip (`parentOf`); `z2.` link slots 11 and 12; no SQL change (documents are generic JSON). Older app versions drop the unknown fields, so Side Quests appear there as main stops. Display (phase 3): folded by default; a pin is hidden with a CSS class (kept in `markers`, so windows, selection and fitting still work); a Side Quest with no parent is never hidden; one card is unfolded at a time, shared by the Points of Interest and Trips lists (`sideState`); a tap on a main card opens it and unfolds its Side Quests, the chip only toggles. Dragging (phase 4): `planSideMove` (reorder.js) pins a dragged Side Quest to its new parent with `parentId` and `order`, and `planMove` re-pins a moved main stop's Side Quests (`parentId` = that stop, its date) so the nearest-stop fallback cannot hand them to another stop; a drop on a day heading clears `parentId` and sets the date (the fallback then prefers the main stop on that date), because a Side Quest cannot be an orphan while its trip has a main stop. The Trips tab drags within one day page only (option A: a day change stays in the Points of Interest tab); both tabs share `initReorder` (`flat` mode) and the poi-ui move rules (`moveStop`, `stepStop`).

## Interaction and layout
**A map click only closes windows; a 2 s hold, right-click or Enter checks a spot (owner).** Popups use `closeOnClick:false`; never replace a clicked element's children mid-click inside a popup (Leaflet closes it).

**Marker window: expanded by default on desktop, collapsed on phones; conditions (weather, elevation) before distances; a details switch makes a click select instead.** Open and Navigate are icons using one chosen map app (Amap in China, Google Maps elsewhere; coordinates converted to GCJ-02 for Amap navigation).

**Search reads coordinates and pasted map links in the browser, never sent online; inside China typed coordinates give two rows (as typed, converted from GCJ-02); every picked result opens the point-check window.**

**Dashboard replaces the welcome dialog; it holds backup actions (export, import, share link), Map key, route builder, forecast, check-in; first visit shows the quick setup (owner).** **The side panel collapses sideways to a rail; swipe gestures dismiss sheets (`swipe.js`; put `data-no-swipe` on anything needing its own gestures).**

**Motion is subtle, CSS, opt-out:** 0.12 to 0.3 s, transform/opacity only, under `prefers-reduced-motion: no-preference`; browser tests run with reduced motion.

**Weather extras appear only when they apply** (snow, cold-battery hint); centimetres for snow.

**New number/date inputs are plain inputs; `controls.js` enhances them (`data-plain` opts out).**

## Testing and process
**Tests live in `tests/`; browser suites need the dev server on :5173 and Edge; external services mocked; Supabase tests run the real SQL on PGlite.** Suites must be parallel-safe (rules in `DEVELOPMENT.md`).

**Documentation:** `Project_context/` is the persistent context; `CURRENT_STATUS.md` is the only handover/checkpoint; history goes to `CHANGELOG.md` (2026-11-12 restructure).
