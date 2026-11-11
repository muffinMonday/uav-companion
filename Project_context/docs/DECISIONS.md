# Decisions

Newest last. Format: context, decision, reasoning, alternatives, consequences. Product-level settled/open decisions are also in `../../docs/PROJECT.md` section 8.

## Date approximations
Where the transcript gave no exact date, entries carry the session's month (2026-11).

### 2026-11: Rebuild as an open-source static app with PMTiles
- Context: the earlier prototype embedded Hubei data in one HTML file; the aim is nationwide coverage, public use.
- Decision: Vite + Leaflet; zones as vector tiles in PMTiles, one file per region, built by a local Node script.
- Reasoning: only tiles in view load; adding a region needs no code change; static hosting.
- Alternatives: one large GeoJSON (too heavy); tile server (needs hosting).
- Consequences: build pipeline and own PMTiles writer in `scripts/lib`; host must support range requests.

### 2026-11: Region folders with `source.json` and semantics
- Decision: `data/regions/<country>/<region>/` with `source.json` (format, CRS, `allow` or `restrict` semantics, licence) and a committed boundary; raw data stays local.
- Reasoning: China publishes where flying is allowed, most others publish restrictions; wording and colours must follow. Raw files are large and licence is often unconfirmed.
- Consequences: Singapore may need two restriction classes, not supported yet.

### 2026-11: No CI; manual deploy to `gh-pages`
- Decision: `npm run deploy` publishes `dist/` as a single commit; built data kept out of `main`.
- Reasoning: owner chose to avoid CI; keeps large tile files out of history.
- Consequences: publishing is a deliberate manual, public action; needs owner approval each time.

### 2026-11: Public repo, MIT, Hubei data published with licence unconfirmed
- Decision: owner accepted publishing the Hubei tiles before the licence is confirmed, to be fixed if needed.
- Consequences: risk stays open (see `CURRENT_STATUS.md`).

### 2026-11: Privacy by default
- Decision: weather, elevation and name lookup are opt-in; weather location can be rounded to about 1 km; elevation always precise; Home (residence) marker never sent automatically and never in share links.
- Reasoning: the app is for travellers; exact locations are sensitive.
- Consequences: export files contain the Home marker and must be treated as private.

### 2026-11: Markers stored in the browser; GeoJSON export as the backup
- Decision: `localStorage` only, validated on load, in-memory fallback.
- Alternatives: accounts and a backend (rejected: static, open-source, no user data held).

### 2026-11: AI itinerary import is generic, lenient to parse, strict to accept
- Decision: published prompt, schema and example for any AI; parser accepts prose, fences, arrays, Features; everything is sanitized, previewed and flagged `unverified` when looked up; `(0,0)` treated as missing; swapped lat/lon corrected; share links `#import=z.<deflate-raw base64url>`. Day, order and dates stay optional.
- Reasoning: models invent coordinates; the user must see what is added.

### 2026-11: Distances and dates
- Decision: straight-line distances; start and end dates per marker, independent of day/order; waypoint measured to nearest Home point and Hotel whose dates overlap (undated counts for every date).

### 2026-11: Renamed to UAV Companion; storage prefix kept
- Decision: name and repo `uav-companion`; keys keep `uavzones.` and export flag `uavzones: 1`.
- Reasoning: existing browsers' saved data must keep loading.

### 2026-11-11: Trips
- Context: markers needed grouping per journey and distances should not cross trips.
- Decision: a trip (name, optional country, dates, description) has its own Trips tab; markers carry an optional `tripId`. Home (residence) markers never have a trip. Waypoint to Home point and Hotel only within the same trip (no trip means only bases with no trip). Date overlap still applies inside a trip. Every marker except Home shows distance to nearest Home, ignoring trip and dates. Deleting a trip keeps its markers. Date outside trip dates is a warning only. AI import accepts a top-level `trip`.
- Alternatives: trip as a field inside Points of Interest only (rejected: a tab fits create, edit, fit-to-trip and browse).
- Consequences: new key `uavzones.v1.trips`; export has `trips`; the earlier rule that hotels and home points show no distance line is gone, and tests were updated.

### 2026-11-11: Tests live in the repo
- Decision: suites moved into `tests/` with a runner (`npm test`, `npm run test:unit`), shared paths in `tests/lib.mjs`.
- Consequences: they need the app on port 5173 and Edge; `tests/out/` is git-ignored.

### 2026-11-11: Persistent project context in `Project_context/`
- Decision: `AGENTS.md` plus six docs; a one-line root `CLAUDE.md` points to `AGENTS.md` so Claude Code loads it automatically.
- Reasoning: new sessions start without memory of earlier ones.

### 2026-11-11: Plan with an AI moves to the Trips tab; two new marker types; bulk delete
- Context: an AI reply can create a trip, and the Points of Interest tab was crowded.
- Decision: the "Plan with an AI" card lives in the Trips tab. New types `train` (Train station) and `airport` (Airport) are waypoints, not distance bases; the Hazard hint no longer mentions airports. Bulk delete is a Select mode in the list with All/None, by-trip and by-type shortcuts limited to shown markers, a confirmation that gives the count and tells the user to export first, and a 10 s Undo message backed by in-memory `store.removeMany`/`restore`.
- Reasoning: storage is the only copy of a user's markers, so a bulk delete needs a pre-delete backup prompt and a short-lived undo.
- Alternatives: a delete-trip-with-markers button (not needed: select by trip covers it); a persistent trash (rejected: extra stored state).
- Consequences: Undo does not survive a reload. Type ids `train` and `airport` are now part of the stored and exchanged format (prompt, schema, example list them).

### 2026-11-11: Settings block, modern controls, phone layout, day/stop labels
- Context: weather/backup had leaked under every tab through a markup error; native number/date inputs and scroll bars looked dated; on phones the search box overlapped the dock and a marker window could fill the screen.
- Decision: weather/elevation and backup stay in Points of Interest only, in a dashed "Settings and backup" block. Number and date inputs stay native but are wrapped by `controls.js` (− / +, clear button) and styled; scroll bars use `scrollbar-width: thin`. The dock is icons-only below 760 px and the search box fits the space left. On phones the marker window keeps its Leaflet popup but is capped at 45% of the screen height and scrolls inside, instead of becoming a separate bottom card. Pins show a day/stop label.
- Alternatives: a custom calendar widget (rejected: more code, worse on phones than the OS picker); a pinned bottom card for the marker on phones (not built: the capped popup solves the blocked map with less change).
- Consequences: date and number fields in new code should be plain inputs (they are enhanced automatically); add `data-plain` to opt out.

### 2026-11-11: Hold to check a spot; centre instead of auto-pan
- Context: any click on the map opened a point check, so panning by touch or aiming at pins often opened windows by accident, and windows pushed the map around to fit.
- Decision: a click on blank map only closes windows; a 2 s hold (the owner's choice), a right-click or Enter checks a spot. Opening a marker or a check centres the map on its coordinate; windows have `autoPan` off and a max height of the space above the centred point (half the map minus pin offset, tip and search row), scrolling inside beyond that.
- Alternatives: 1 s hold (suggested, owner chose 2 s); keeping auto-pan with a height cap.
- Consequences: windows are shorter (about 280 px of content on an 800 px screen) and scroll; popups must not rely on Leaflet's close-on-click, so `closeOnClick:false` and a manual close in `main.js`. Tests that need a point check use a real 2.3 s hold.

### 2026-11-11: Welcome screen on every visit, with an opt-out
- Context: new users get no explanation of the app, and a traveller with a trip planned has no reason-to-return cue.
- Decision: a modal `<dialog>` opens on every visit (the owner's choice) with a 4-step guide and, when a trip is coming up or under way, a countdown card. "Don't show again" is stored as `uavzones.v1.welcome` (separate from the settings entry, so clearing or rewriting settings does not bring it back); "How it works" in Map Configs reopens it and can turn it back on. Share links skip it.
- Alternatives: first visit only (would not show the countdown on later visits); showing only when a trip is near (rejected by the owner).
- Consequences: a modal covers the page on load, so test suites switch it off via `tests/lib.mjs`.

### 2026-11-11: Expanded marker window by default on desktop
- Context: centring the pin left only about 280 px above it, too short for the window's content.
- Decision: the marker window can be expanded (centred on the coordinate, covering the pin, up to 85% of the map height) or collapsed (above the pin). Desktop opens expanded, phones open collapsed (owner's choice), with a remembered toggle; expanded is capped at 60% on phones so the map stays draggable.
- Alternatives: marker pushed to the right edge with the window to its left (rejected: the side panel and phone widths leave no room).
- Consequences: the expanded window hides the pin, so tests that need to press a pin collapse the window first; tall windows scroll inside.

### 2026-11-11: Each visit to a place is its own marker
- Context: a landmark visited on day 1 and day 3 was impossible to keep: the AI import skipped the second one as a duplicate, and two markers at one spot hid each other.
- Decision: keep one marker per visit (own date, day, stop, trip). Markers within 15 m are shown as one place: a ×N badge, a strip of visit chips in the window, and an Add visit button. The AI import calls a repeat a duplicate only when the dates match or either has none; different dates make it another visit.
- Alternatives: one marker holding a list of visits (rejected: reworks distances, date and trip rules, export and the AI format); spreading overlapping pins apart on the map (not needed with the chips).
- Consequences: no data-model change or migration; weather and elevation lookups are shared per spot.

### 2026-11-11: Reorder by holding a row; a move rewrites date, day and stop
- Context: markers could only be reordered by editing each one's date, day and stop by hand.
- Decision: press-and-hold 1 s then drag a row within its group (a trip, or no trip), in dated or day-numbered lists only (the owner's rules). A drop sets the date and day of the heading it lands under and renumbers stops. A hotel gets the new date as its start and the next trip day as its end (the last trip day: start = end). Undo for 10 s; Alt+arrows for the keyboard. Plain lists cannot be dragged.
- Alternatives: a drag handle on each row (rejected: the hold matches the map and keeps rows uncluttered); drops across trips (not allowed).
- Consequences: the logic is pure (`reorder.js`) and unit-tested; the drag layer must not redraw the touched row while dragging.

### 2026-11-11: Map-app links built from the apps' documented URL formats
- Context: travellers want to open a marker, or a route between markers, in Google Maps or Amap.
- Decision: plain links, no API keys. Amap first then Google Maps inside China; Google Maps only elsewhere (owner's choice). Multi-stop routes in Select mode; limits from the official docs (Google: 9 stops between, 3 on mobile; Amap: one `via`, driving only), with longer routes opened as parts. Amap navigation has no coordinate setting, so coordinates are converted to GCJ-02 in the app; the marker link uses `coordinate=wgs84`. The Home marker asks before any link opens. "In China" is a coarse Natural Earth outline (not Taiwan; Hong Kong and Macao by box).
- Alternatives: map-provider APIs (need keys, quotas); sending WGS-84 to Amap navigation unconverted (would be about 500 m off).
- Consequences: new static data file (about 14 KB) and a generator script; links are only checked for form, not against the live apps.

### 2026-11-11: Search results open the point-check window; coordinates never leave the browser
- Context: a search result only dropped a pin with its name. Travellers also have coordinates (typed, or in map links) and want the zone verdict for them.
- Decision: the search box reads coordinates and pasted Google/Amap links in the browser (never sent to an online search). Inside China, typed coordinates give two rows, as typed (GPS) and converted from GCJ-02, because coordinates copied from Amap would otherwise land about 500 m off. Any picked result drops a blue pin and opens the point-check window above it. Add as marker and Remove pin go in that window (owner's choice for Add as marker).
- Alternatives: pins for every candidate at once (owner chose the picked result only); resolving short links (not possible from the browser).
- Consequences: the check window is now the one place for verdict, links, Add as marker; `showCheck` takes options (offset, zoom, remove-pin).

### 2026-11-11: The day is worked out from the date; trip dates are required
- Context: the day was typed in separately from the date, so a marker's day and date could disagree.
- Decision: Day N = date − trip start + 1; the Day box is removed; trips need a start and end date (owner's choices); a date outside the trip has no day; stored days are dropped or turned into dates at start-up and whenever they could conflict, without a backup (owner's choice). Old markers with a day and no way to work it out keep it read-only. Reordering only works on dated lists.
- Alternatives: keep Day as an editable fallback (rejected: that is how they drifted apart); count from the earliest dated marker when a trip has no start (day 1 would shift).
- Consequences: AI days become dates on import; trip dates are needed to create a trip from an AI reply.

### 2026-11-11: One Open and one Navigate button; tools in a bar at the top of the window
- Decision: a single app per place (Automatic: Amap in China, Google Maps elsewhere; changeable in the Maps card with a default travel mode) and two buttons; Edit, Add visit and Delete become icons in a top bar (⋯ menu on phones), Delete confirms on a second press; shorter disclaimer; weather privacy sentence as a tooltip.
- Reasoning: the bottom of the window held three rows of buttons; most visitors use one map app.
- Consequences: routes follow the same app choice; the earlier two-app rows are gone.

### 2026-11-11: Policy: sourced geo data is published on the public site (supersedes the local-only rule below)
- Decision (owner): any geo data we source is published on the public site, like the Hubei data, even before its licence is confirmed; to be removed if the data's owner objects. Singapore's OneMap layers are published on that basis. `publish: false` stays available for a region the owner wants kept local, and `npm run deploy` still strips those.
- Reasoning: the owner prefers openness and one behaviour for every region; the data is shown with its source, date and a link to the official map, and is labelled approximate.
- Consequences: OneMap's terms are still unread; each region's licence status is kept in its `source.json` and in `docs/ATTRIBUTIONS.md`. Raw source files stay out of git; only the built tiles are published.

### 2026-11-11: Singapore no-fly zones are built locally and never deployed (superseded by the policy above: now published)
- Context: the owner saved OneMap's theme responses (aerodrome 5 km, danger, prohibited, restricted, MHA protected areas, NParks, UAFA pins) for a small FPV group; OneMap's terms are unread and the group does not approach CAAS.
- Decision: a region may have `layers[]` (one zone class each, with label, colour, severity, summary) and `publish: false`; it is built into `public/data-local` (gitignored), merged by the app only on localhost/private addresses, and removed from `dist` by `scripts/strip-local.js` inside `npm run deploy` (which fails if a local region remains). Temporary restricted areas are ignored. Point check returns every zone containing the point; coverage uses a 1.5 km margin around the Natural Earth outline.
- Alternatives: publish publicly (rejected until the terms are read); rebuild from AIP tables (not needed once OneMap data was available).
- Consequences: sharing the Singapore layer with the group needs a later decision (possibly a backend). Raw files and tiles stay local; accuracy is "as published on OneMap", with a button to the official map.

### 2026-11-11: Trip plan screen: forecast per day and an on-tap no-fly check
- Decision: the trip detail screen shows an Open-Meteo daily forecast for the first non-hotel stop of each day (up to 16 days ahead), only while automatic weather is on; and a button that checks every stop against the local zone tiles. The Distances settings moved into the privacy settings (owner's request).
- Reasoning: reuses the existing weather opt-in and coordinate rounding, so no new consent step; the zone check needs no network, so it is safe to run on demand.
- Consequences: one more Open-Meteo request per upcoming trip (at most 6 trips, reused for 3 hours); the forecast cache is cleared when weather is switched off.

### 2026-11-11: Map links as icons beside the coordinates; distance rows only when they exist
- Decision (owner): Open and Navigate are icons next to the coordinates (marker window) or the title (point check); the Home marker's icons ask on a second tap; hotel and Home point rows with no distance are not shown.
- Consequences: the sharing sentence is a tooltip plus a line in the Maps card (tooltips do not show on phones).

### 2026-11-11: Trip days as a flip card
- Decision (owner): the trip detail screen shows one day at a time on a card with ‹ and ›, instead of a long stack of days.
- Consequences: no stops on the list-level trip cards; the card opens on today's day for a trip under way; no automatic map movement when turning pages (a Fit map button on each page).

### 2026-11-11: Search folds into a magnifying glass; the side panel rolls up
- Decision (owner): the search box is collapsed when not in use; a ^ button at the bottom of the side panel rolls it up to its header strip because the cross at the top right is awkward to reach.
- Consequences: tests that type in the search box open it first; the rolled state is remembered; the cross still hides the panel to the dock.

### 2026-11-11: The welcome dialog becomes a dashboard
- Decision (owner): a drawer along the bottom of the map replaces the modal welcome screen: expanded, one-line strip, or a ^ tab; it carries What's new, the next trip with ‹ ›, a backup reminder, region buttons and a guide. "Do not show for today" drops it to the strip; a new What's new entry overrides that once; a switch in the Help card turns the start display off.
- Reasoning: it does not block the map, and its content (countdown, warnings, backup) stays useful after the first minute.
- Alternatives: keep the modal and add the cards to it (rejected: still blocks the map and cannot be glanced at).
- Consequences: on phones the dashboard and the side panel take turns; the old "Don't show again" choice is not carried over.

### 2026-11-11: The route builder moves to the dashboard; welcome line; Navigate this day
- Decision (owner): the Route block leaves the Points of Interest tab and becomes a card on the dashboard, shown while selecting markers (opens the dashboard at the second stop on a desktop; a strip on a phone). A welcome line tops the dashboard. Each day of a trip gets a Navigate this day route.
- Reasoning: the route is built while looking at the map, and tapping pins already selects; the dashboard sits under the map and a phone no longer detours through the panel. Navigate this day needs no selecting.
- Alternative considered and dropped: a flip card for the Points of Interest list (it would hide days from drag-and-drop and from select-all).

### 2026-11-11: Check-in at markers (opt-in, local)
- Decision (owner): a Check in button on each marker row enables within 300 m and records position and time. Rules chosen with the owner: an opt-in privacy switch, a 150 m accuracy limit, one check-in per marker (cleared with an ✕), exported but not shared, and "visited" counts on the trip cards.
- Reasoning: enabling a button as someone walks needs continuous location, so it follows the same consent model as weather and elevation; the position is read only while markers are on show and never leaves the browser.
- Consequences: export files contain where the owner was; share links never do.

### 2026-11-11: Motion is opt-out, in CSS, subtle; the test suite runs with reduced motion
- Decision (owner): add basic animations to the app's interactions; centre the dashboard like its strip.
- Rules: 0.12 to 0.3 s, ease-out, transform/scale/opacity only; every new rule sits under `prefers-reduced-motion: no-preference`; individual `translate`/`scale` properties are used so they never clash with the transforms that centre the banner, toast and Leaflet's own positioning.
- Consequences: the browser tests emulate reduced motion (lib.mjs) so nothing is mid-move when clicked; `motion.mjs` turns motion on and checks the key animations and the glide.

### 2026-11-11: Marker click can skip the details window; a selected marker shows its day
- Decision (owner): a switch (map button plus Points of Interest tab, remembered) makes a marker click select instead of open the window, so the displacement lines stay visible; a selected marker also shows its day's route with bold arrows into and out of it.
- Consequences: a name tag with an ⓘ keeps the window one tap away; the chain ignores hotels (they keep their dashed displacement lines).

### 2026-11-11: Eye in the window, v hides into the ⓘ, fixed map controls, larger greeting
- Decision (owner): an eye in the marker window's bar mirrors the details setting (synchronised with the map button and the Points of Interest switch); with details off the window's v button hides it into the name tag's ⓘ; the dashboard no longer lifts the scale bar and attribution (it stands above them on a common baseline, with the strip and tab); the greeting is a large "Welcome back!" with a trip sentence beneath.

### 2026-11-11: Marker window order: conditions before distances
- Decision (owner): elevation and weather matter more than the distance to the hotel or Home, so they come straight after the zone verdict, with the Show weather here button in the same place, and the distance rows move below, side by side. Elevation stays one of the four tiles (the 2x2 layout).
