# UAV Companion: Project Requirements

## 1. Purpose

An interactive, browser-based map showing where small drones can fly (or where they are restricted) under official zone data, starting with the suitable-flight (适飞空域) grid for Hubei, China, in force from 14 May 2026. It displays the official zones over a standard basemap, with search, a point check ("what does the data say about this spot?") and the user's own location.

Planned coverage within the next year: China (province by province, as official data is obtained) and Singapore. The structure is built for more.

This is a planning aid. It does not replace the UOM app (China) or any local official platform, which remain the authoritative checks before every flight.

## 2. Current state

| Item | Status |
|---|---|
| Data | Hubei (`data/regions/cn/hubei/`, 84,863 cells, `allow` semantics). Built locally into one PMTiles file per region. |
| App | Vite + Leaflet in `src/`. Zones, basemaps, search, point check (F4), location pin and re-centre, scale bar, markers, trips (F19), AI import, privacy controls. Browser-tested in Edge on desktop and phone widths. |
| Hosting | Source in the public GitHub repo `muffinMonday/uav-companion`. Published to the `gh-pages` branch with `npm run deploy` (no CI); GitHub Pages must be enabled in the repo settings (Source: `gh-pages`). |

Earlier layers (the Wuhan screenshot extraction and the province extraction from the provincial map image) are superseded by the official data and should not be used.

## 3. Data

### 3.1 Official flight grid, Hubei (`data/regions/cn/hubei/`; provenance in `docs/regions/cn-hubei.md`)
- Format: ESRI shapefile (`grid.shp`, `.shx`, `.dbf`, `.prj`, `.fix`). Original attachment name: `P020260512578795333014.zip`, folder `湖北/湖北适飞网格`.
- Geometry: about 85k cells, from roughly 130 to 150 m on the smallest size up to much larger cells at the edges. Each cell is a suitable-flight area.
- Attribute fields: `name` (a binary grid code, 21 to 35 digits depending on cell size, unique across all 84,863 cells) and `color_code` (constant `#01f4f4`). The geometry is the zone data; the build drops both fields. The grid code could support a geometry-free point check; not evaluated yet.
- Coordinate system: `grid.prj` declares WGS84 (EPSG:4326). The label does not rule out GCJ-02, so overlay the cells on a satellite basemap at a known landmark and then set `crsVerified` in `source.json`. Cells are axis-aligned rectangles.
- Licence: not stated in the attachment. Confirm terms before public redistribution.
- Reference status: the official grid is the reference. The earlier prototype layers (removed from the repo) overlapped it by about 86% (province) and 89% (Wuhan), so those layers are not authoritative.

### 3.2 Place index (`data/places/<country>.txt`)
- Editable source, one file per country; the build generates `public/data/places/<country>.<hash>.json`.
- Format: `local name|English name|lat|lon|kind` (`city`, `county` or `landmark`).
- Accuracy: coordinates for county seats and districts were compiled by hand and are approximate (roughly 1 to 3 km). Verify before relying on them for anything beyond finding the right area on the map.

### 3.3 Basemap tiles
- Not stored in the repo. Loaded at runtime from the provider.
- Attribution must stay visible (Esri, OpenStreetMap, OpenTopoMap, as applicable).
- Each provider has its own usage terms. Confirm before public deployment at volume.

## 4. Functional requirements

**F1. Zone display**
- Show the official flight grid as a semi-transparent polygon layer.
- Toggle visibility; adjust opacity.
- Fit the initial view to Hubei.

**F2. Basemap selection**
- Switch between at least Esri Streets, Esri Satellite and OpenTopoMap. OpenStreetMap is optional and needs http/https.
- Keep the zone layer on top of any basemap.

**F3. Search**
- Offline: match Chinese names and pinyin/English names from the place index, ranked by exact, prefix and substring matches, with a result limit.
- Online: query a geocoder (Photon first, Nominatim as fallback) when the user asks. Show a clear message if the request is blocked or fails.
- Selecting a result centres the map and places a marker with the name.
- Keyboard support: arrows to move through results, Enter to select, Escape to close.

**F4. Point check (built)**
- Pressing and holding on the map for 2 seconds (without moving), right-clicking it, pressing Enter on the focused map (checks its centre), or the user's location pin, answers from the same PMTiles the map draws, at the highest zoom. Three outcomes: `inside` a zone, `outside` the zones but within the region's coverage boundary, or `nodata`.
- Wording follows the region's `semantics`. `allow` (China): "Suitable-flight zone, below 120 m true height" / "Outside the suitable-flight zone (controlled airspace)". `restrict` (e.g. Singapore): "Restricted area" / "Not inside a restricted area in this data", never presented as permission to fly.
- Always shown with the standing disclaimer. Not legal advice.
- Checked against the source shapefile: 0 mismatches in 20,000 random points.

**F6. User location (built)**
- A "my location" button drops a pin with an accuracy circle and follows the position after the first press; pressing again re-centres. Nothing is requested until the button is pressed. Needs https or localhost.

**F7. Scale bar (built)**
- Metric scale bar, bottom-left.

**F8. Weather (built, opt-in)**
- Each point-check popup has a "Show weather here" button. Only that press contacts Open-Meteo (the popup says so); nothing loads automatically.
- Shows the next 12 local hours for the point: wind at 10 m, gusts, wind at 120 m (the height cap), rain, visibility, temperature, plus sunrise and sunset.
- Optional personal wind limit in the menu (m/s, stored in the browser only) turns wind values above it red. The app never states that conditions are safe to fly.
- Data: Open-Meteo forecast API (CC BY 4.0; the free tier is for non-commercial use only, under 10,000 calls a day per user). It is a regional model of roughly 10 to 25 km, and the card says so. Failures (offline, 429, server error) show a message and leave the rest of the app working.
- If the project ever becomes commercial, Open-Meteo needs a paid plan or this feature must be replaced.

**F10. Points of interest (built)**
- Ten marker types, each with its own glyph as well as colour, and a tooltip saying what it is for: **Home point** (the drone's home point, drawn as an "H"), Hotel, Takeoff spot, Landing spot, Photo spot, **Train station**, **Airport**, Hazard, **Home** (the traveller's actual residence, drawn as a house; type id `residence`) and Other. Home point and Home are easy to mix up, hence the different icon, colour and tooltip. The type ids are what is stored and exchanged, so they do not change.
- The Home (residence) marker is treated as private: it is never included in automatic weather or elevation lookups, never put in a share link, and an export that contains one says so in the Backup note. Waypoints show their distance to it (F18), but it does not count toward the max range. Explicit actions still work on it (opening its window, "Show weather here", the file export).
- Ways to add one: choose a type, then **Place on map** (tap the map; Escape or Cancel aborts), **At map centre**, **At my location**, all from the Points of Interest tab. A new marker's popup opens as an edit form so it can be named at once.
- Each marker stores `id`, `type`, `name`, `note`, `lat`, `lon`, `created`, and optional fields that are left out of the record when not set: `date` and `endDate` (the trip dates, see F17), `day` (itinerary day, whole number 1 to 999), `order` (position within the day, 1 to 999) and `unverified` (true when the location came from an AI or a name lookup and has not been checked). A marker without them is byte-for-byte what it was before they existed. `day` and `date` are independent: neither implies the other. Zone status is not stored: opening a marker's popup runs the live zone check and offers the weather button, so it can never be stale.
- The tab lists all markers; clicking one recentres the map on it (zoom 15 or closer, kept clear of the docked panel) and opens its popup. Order: newest first; or, once any marker has a `day`, grouped under "Day N" headings (by stop, then newest; no day last under "No day set"); or, once any marker has a `date`, grouped under date headings (by date, then day, then stop; no date last under "No date set"). Dates take precedence over days. Filter chips narrow by type. Unverified markers carry an "Unverified" badge. Each waypoint also shows its distances (F18).
- The popup edits the name, type, note, the optional start and end date, and the optional Day and Stop (empty means none; the browser refuses out-of-range values), and deletes (second press to confirm). An unverified marker's window shows a notice with a "Mark as checked" button.
- **Edit mode** locks the map. Press and hold a pin for about 0.4 s until it lifts, then drag it; release to save. Moving before the hold finishes does nothing, and a quick click still opens the popup. Works with mouse and touch. Pin moving is pointer-only: keyboard users can edit a marker's details but cannot drag it.
- Storage: `localStorage` in this browser (key `uavzones.v1.pois`), never uploaded. Persistent storage is requested on the first save. If storage is blocked (private window), markers work for the session and the panel says so. Other tabs stay in sync.
- Backup: **Export GeoJSON** (FeatureCollection of Points) and **Import** (this app's files or any GeoJSON with Point features; validated, 2 MB limit, ids already present are skipped, text is always shown as text). The panel shows the last backup date, because clearing site data (or Safari's storage clean-up) erases markers.
- Stored data is browser-and-device specific: moving markers to another device means export, then import.

**F9. Country shortcut (built)**
- A "Go to" menu re-centres the map on a country's `view` box (from `data/regions/<country>/country.json`). Currently China and Singapore. A country without zone data yet is listed as "(no zone data yet)" and shows a notice when chosen.
- The choice stays shown in the menu after it is made (and is remembered, see F11). Because choosing the same entry again does not fire a change, a **Centre** button next to the menu re-centres on the chosen country after panning away. Choosing the "Choose a country…" prompt clears the choice.

**F12. Automatic weather for markers (built, opt-in, off by default)**
- The switch lives in the privacy settings (F13). While off, nothing is sent and the marker window shows no weather tiles. The status line ("Weather last refreshed: 14:05 …") is at the top of the Weather section of the privacy settings.
- While on, each marker window shows the next 5 hours (the five hourly values from the current hour at the marker, in its own time zone): average temperature, average wind speed at 10 m, and peak gust. A peak above the user's wind limit is shown in red. It is a regional forecast, as in F8.
- When it is fetched: when a marker is placed or moved (that marker only); when the switch is turned on (all markers); on page load if the last bulk refresh is more than 30 minutes old (all markers); and on page load or import for any marker that has no weather yet. Requests are batched (one request for up to 50 markers, further batches one after another).
- Timestamps: the tab shows "Last refreshed" (the time of the most recent successful fetch, in the visitor's time), and each popup shows "Updated" for that marker. Values older than 3 hours are labelled outdated.
- Failure: earlier values stay, labelled "latest refresh failed", and a failed bulk refresh does not count, so the next page load tries again. With no earlier values the popup says weather is unavailable.
- Storage: weather is cached in its own key (`uavzones.v1.wxcache`), never on the marker records and never in the GeoJSON export. Turning the switch off deletes it. The switch itself is remembered (F11).
- Privacy: this is the one place marker locations leave the browser automatically once the user opts in (the Home marker, a residence, is never included). By default coordinates are rounded to 2 decimals (about 1 km) before sending; this does not change the result because the forecast grid is 10 to 25 km. The user can choose precise (4 decimals, about 10 m) instead (F13). The same setting applies to the on-demand weather card (F8).

**F13. Privacy settings (built)**
- A shield button in the panel header opens a sub-panel that slides over the side panel, with Back, Escape and its own close button. It holds three settings, all remembered in the browser (F11) and all defaulting to the most private choice:
  1. **Fetch weather for markers automatically** (off). See F12.
  2. **Location sent for weather**: *Estimated* (rounded to about 1 km, recommended) or *Precise* (about 10 m). It applies to automatic weather and to the "Show weather here" button, whose small print states which one is in force.
  3. **Fetch ground elevation** (off). See F14. Elevation always uses precise coordinates, independent of setting 2, because at 1 km the terrain can differ by hundreds of metres.
  4. **Look up places by name when importing** (off). Sends the names or addresses of places in an AI import that have no coordinates to Photon, then Nominatim, only when Add is pressed. See F16.
- The sub-panel also lists what leaves the browser: map tiles (the chosen basemap provider), place search (Photon or Nominatim, only when searching), weather and elevation (Open-Meteo, only as set), and says what is never sent (markers, notes, the wind limit, the settings themselves).
- Turning weather or elevation off deletes the cached values of that kind.

**F14. Ground elevation (built, opt-in, off by default)**
- Source: Open-Meteo's elevation endpoint (a terrain model of roughly 90 m resolution, approximate), requested with 4-decimal coordinates. One request per lookup, made when a marker window or a point-check popup (map click or the location pin) is opened, never in bulk.
- Shown as an "Elevation" tile in the marker window and the point-check popup; a failed lookup shows a dash and says so.
- Markers: the value is cached per marker in its own storage key (never on the marker record or in the export) and looked up again if the marker is moved. Other points are remembered for the page only. Turning the setting off clears everything.

**F16. Planning with an AI (built)**
- Trips tab, "Plan with an AI": **Copy AI prompt**, a paste box, **Preview…**. The prompt is `public/ai/prompt.md` (generic, not tied to any assistant), with `ai/schema.json`, `ai/example.geojson` and `llms.txt` published beside it. Full description in `docs/AI.md`.
- The AI replies with a GeoJSON FeatureCollection: `name` required; `type`, `note`, `date`, `endDate`, `day`, `order` optional (none of these is ever required, and each is dropped rather than guessed when invalid; the prompt tells the AI to give a date only when the itinerary states the full date including the year); `geometry` is a Point `[lon, lat]` or `null` with a `properties.query` to search. The prompt explains `home` (the drone's home point) versus `residence` (the traveller's own home, only if the itinerary asks for it, never a guessed address).
- Parsing is lenient about wrapping (prose, a code fence, a single Feature, a bare array) and strict about content: validated like saved markers, at most 200 places, `[0, 0]` treated as missing, swapped lat/lon corrected and reported, text only ever shown as text.
- A preview lists each place (type, day and stop, coordinates or what will be searched) with tick boxes, flags places already saved (same name within about 30 m), and adds nothing until **Add** is pressed. Added places are marked **unverified**, because AI coordinates are often wrong.
- Name lookup (places with a `query` and no coordinates) is opt-in under Privacy settings (F13), off by default: Photon first, then Nominatim (at least 1 s between its requests), at most 30 places per import, stoppable, results marked unverified. Only the queries and the map position (rounded to 2 decimals, as a bias) are sent.
- Share links: **Backup > Copy share link** copies `…#import=z.<compressed JSON>` (the fragment never reaches a server; a plain percent-encoded JSON fragment is also accepted). Opening one, including pasting it into a tab already showing the app, opens the panel on this tab with a preview. The fragment is removed from the address bar, so a refresh does not offer it again, and damaged or cut links give a readable message. Lists exported by this app keep their verified/unverified flags; anything else counts as AI output.

**F17. Trip dates (built)**
- Each marker may have a start date (`date`) and an end date (`endDate`), as calendar dates "YYYY-MM-DD" with no time and no time zone. The end date is for a stay of several days (a hotel) and only exists with a start date.
- Validation is strict and never guesses: only real dates in 2000 to 2100 (so 30 February is refused), an end on or before the start is just a single day (end dropped), an end before the start is dropped (the start is kept), an end without a start is dropped. In the edit form the end date stays disabled until there is a start date, its minimum is the start, and clearing the start clears the end.
- Shown under the name in the marker window ("Thu, Nov 12 – Sat, Nov 14", with the year when it is not this year) and as the list's headings (F10). The dates go into exports, share links and the AI import (`properties.date`, `properties.endDate`; a date-time keeps its date part).
- Not built: a time of day (use the note), and the forecast for a waypoint's date (the weather tiles are still the next 5 hours from now).

**F18. Distance to the nearest home point, hotel and Home (built)**
- Every waypoint (anything except a Home point, a Hotel or the Home marker itself) shows its straight-line (great-circle) distance and compass direction to the nearest **Home point** (the drone's), the nearest **Hotel** and the nearest **Home** (the traveller's residence), as separate lines for whichever of those are saved: in the marker window directly under the zone verdict, and as a short line in the list ("730 m to home point · 1.5 km to hotel · 8.2 km to home"). Straight-line because it is the figure that matters for a drone (line of sight and control range), works offline and sends nothing anywhere. Road distance is deliberately not offered.
- The Home marker is measured to, but it is not a launch base: it is left out of the max range check (below), because on a trip it is usually far from anywhere you would take off. Showing a distance to it is purely local; nothing about it is sent to any service.
- **Date rule.** Only bases whose dates overlap the waypoint's dates count (a range overlaps if they share at least one day, so a hotel's check-out day overlaps another's check-in day). A base with no dates applies to every date, and a waypoint with no dates is measured to the nearest base whatever its dates. When bases of a type exist but none overlaps, the window says "No hotel for these dates" (or "No home point …") instead of showing a wrong one.
- A distance is shown with "≈" and a note when either end is an unverified location. With neither base type saved, the window says what to add. Distances update at once when markers are added, moved, edited, deleted or imported.
- **On the map**, while a waypoint's window is open, dashed lines run to its nearest home point, hotel and Home in their pin colours, labelled with the distance; they disappear when the window closes.
- **Max range** (optional, Distances card in the Points of Interest tab): when the nearest home point or hotel that applies is farther than the limit, the waypoint's home point and hotel rows and list line turn red and the window says it is beyond the max range. The Home distance is shown but never counts toward, or turns red for, the range. Valid range 100 m to 200 km; anything else is refused with a message and the old value kept.
- **Units** (same card): kilometres and metres, or miles and feet. They apply to distances, the max range field and the map's scale bar. Elevation, height limits (120 m), wind and temperature stay metric, because the rules and forecast sources they relate to are metric. Both settings are remembered (F11).

**F15. Marker window design (built)**
- A card in the current light or dark theme: type badge, name and coordinates at the top; the zone verdict as a coloured status banner (green suitable, red controlled or restricted, amber no restriction found or no data); then large tiles for elevation, average temperature, average wind and peak gust (only the ones switched on, peak gust red above the wind limit) with one line saying when they were updated; the note set apart; then the "Show weather here" button, Edit and Delete, and the standing disclaimer. The point-check popup uses the same banner and tiles.
- On phones the window is sized to fit the screen. The mode banner (placing or edit mode) sits at the top under the search row so it never covers a pin.

**F19. Trips (built)**
- A trip has a name (required, up to 80 characters), an optional country (chosen from an ISO list, stored as its two-letter code), optional start and end dates (end only with a start, not before it; one day is start = end) and an optional description (up to 500). Up to 200 trips; stored in this browser under `uavzones.v1.trips`.
- Own **Trips** tab: list (country, dates, length, marker count), New trip / Edit / two-step Delete, **Show markers**, **Fit map**, **Use for new markers**. Deleting a trip keeps its markers and removes their tag.
- A marker has an optional `tripId`. **Home** (residence) markers never have a trip. Markers get the *current trip* when placed; the marker form has a Trip select with "New trip…". A trip-coloured dot marks tagged pins; the list is grouped by trip and can be filtered. A marker dated outside its trip's dates gets a soft warning, never a block.
- Distances: a waypoint's nearest hotel and home point are looked up **only inside its own trip** (a marker with no trip is measured only to bases with no trip); the date-overlap rule (F17) still applies inside a trip. **Every marker except Home also shows its distance to the nearest Home**, whatever the trip or dates.
- Export/import carry a top-level `trips` array and `properties.tripId`; the AI import accepts an optional top-level `trip` object (see `docs/AI.md`).

**F20. Delete several markers (built)**
- Points of Interest tab, **Select markers…**: every row gets a checkbox (a click anywhere on the row ticks it). A bar offers **All shown**, **None**, **Add a trip** (a trip or "No trip") and **Add a type**; the shortcuts add to what is already ticked and only reach markers the list currently shows (the type and trip filters apply). A filtered-out marker is dropped from the selection, so the count always matches what is visible.
- **Delete selected (N)** asks first: the count, that it cannot be undone once the Undo message disappears, and to export first (an **Export first** button downloads the GeoJSON and keeps the question open). After deleting, a message with **Undo** stays for 10 seconds and restores the markers in their original places and trips (a trip tag is dropped if that trip was deleted meanwhile). The Undo is held in memory only; a reload ends it. The Home marker can be deleted like any other.

**F21. Look and phone layout (built)**
- Backup lives at the bottom of the Points of Interest tab, in a dashed "Backup" block so it reads as separate from the tab's own cards. The weather and elevation card was removed from that tab: the privacy sub-panel (shield button) is the one place for those settings and the weather status line.
- Number fields have − / + buttons (the browser spinner is hidden); date fields are rounded, themed for light and dark, and have a clear button (the native date picker still opens). Scroll bars are thin and themed. The fields are enhanced by `src/controls.js`, including those in marker windows built later.
- Phones (up to 520 px): the search box and the dock never overlap (the dock is icons only below 760 px, the search box takes the space left, with a shorter hint). A marker window takes at most 45% of the screen height and scrolls inside; the map can be dragged around it.
- Day and stop: a pin shows a small label ("D2·3" day and stop, "D2" day only, "#3" stop only); list rows say "Day 2 · Stop 3" (only "Stop 3" under a "Day 2" heading); the marker window shows it under the type.

**F22. Frosted marker window (built)**
- Marker windows (and the point-check window) are frosted glass: about 80% opaque with a background blur, tiles inside see-through too, text and buttons opaque. A **Marker window opacity** slider in Map Configs (0.5 to 1, default 0.8; 1 is solid) changes open windows live and is remembered (`popupOpacity` in the settings). Browsers without background blur get a nearly solid window instead.

**F23. Rain chance in the marker window (built)**
- With automatic weather on, the marker window shows a rain block under the weather tiles: "Rain chance up to 70% around 16:00" and one bar per hour for the next 5 hours (percentage above each bar, hour below). The data is Open-Meteo's hourly precipitation probability, fetched in the same request as the other weather values (no extra coordinates, same opt-in).
- Not every forecast model gives a chance for every place. Then the block shows expected rain in millimetres ("Rain expected: 1.2 mm", bars in mm) or "No rain forecast", and if the model has neither, "Rain chance unavailable". Entries cached before this feature show no rain block until their next refresh. The Home marker still gets no automatic weather.

**F23. Rain chance in the marker window (built)**
- With automatic weather on, the marker window shows a rain block under the weather tiles: "Rain chance up to 70% around 16:00" and one bar per hour for the next 5 hours (percentage above each bar, hour below). The data is Open-Meteo's hourly precipitation probability, fetched in the same request as the other weather values (no extra coordinates, same opt-in).
- Not every forecast model gives a chance for every place. Then the block shows expected rain in millimetres ("Rain expected: 1.2 mm", bars in mm) or "No rain forecast", and if the model has neither, "Rain chance unavailable". Entries cached before this feature show no rain block until their next refresh. The Home marker still gets no automatic weather.

**F23. Rain chance in the marker window (built)**
- With automatic weather on, the marker window shows a rain block under the weather tiles: "Rain chance up to 70% around 16:00" and one bar per hour for the next 5 hours (percentage above each bar, hour below). The data is Open-Meteo's hourly precipitation probability, fetched in the same request as the other weather values (no extra coordinates, same opt-in).
- Not every forecast model gives a chance for every place. Then the block shows expected rain in millimetres ("Rain expected: 1.2 mm", bars in mm) or "No rain forecast", and if the model has neither, "Rain chance unavailable". Entries cached before this feature show no rain block until their next refresh. The Home marker still gets no automatic weather.

**F24. Hold to check, and centring (built)**
- A quick click or tap on blank map no longer opens anything: it closes any open window. The first time, a message explains how to check a spot (remembered as `holdHint`). Holding still for 2 s checks the spot (a ring fills under the pointer meanwhile, with a short vibration where supported); moving more than 8 px, a second finger, zooming or letting go early cancels it, and the release after a hold is not treated as a click. A right-click checks at once; on touch screens a long-press's context menu is suppressed instead. Holding does nothing while placing or editing markers, or on a pin, window or control.
- Opening a marker (click, tap, or from the list) or a point check centres the map on that coordinate, keeping the zoom (with the side panel open, in the part of the map it leaves uncovered; on a phone opening a marker first closes the sheet). Windows no longer pan the map to fit: one too tall for its space scrolls inside itself, so it always stays on screen. A point-check window sits above the spot; a marker window is described in F26.

**F25. Welcome screen and trip countdown (built)**
- A welcome dialog opens on every visit: a title, four short steps (check a spot by press and hold, plan a trip, see the conditions, your data stays in this browser), and a note that this is a planning aid, not flight advice, with the current coverage. **Get started** (or Escape, or a click on the dimmed backdrop) closes it; **Don't show again** closes it and stops it opening on later visits. It does not open when the page is opened from a share link.
- **How it works** (Map Configs, Help) reopens it at any time; when the opt-out is on, it offers **Show on start again**. The choice is stored under `uavzones.v1.welcome`.
- Countdown: when a trip is coming up or under way, a card at the top shows it: "12 days to go", "Tomorrow", "Today" (one-day trip) or "Day 2 of 3", with the trip's name, country, dates and length. Trips under way come first, then the soonest; past trips and trips without a start date are ignored. **Open trip** closes the screen and fits the map to the trip's markers; "+N more trips" opens the Trips tab. Dates are calendar dates counted in whole days against the visitor's local date.

**F26. Expanded and collapsed marker window (built)**
- A marker window has two sizes, switched by a chevron button beside its close button and remembered (`windowExpanded` in the settings). **Expanded** (the default on a desktop): a tall window centred on the coordinate that covers the pin, up to 85% of the map height, with no pointer tip. **Collapsed** (the default on a phone): the short window above the pin. Longer content scrolls inside either size.
- On a phone the expanded window is capped at 60% of the screen height so the map can still be dragged around it. The switch happens in place, so an open edit form or scroll position survives. The point-check window has no expanded size.

**F27. The same place on several dates (built)**
- Each visit is its own marker, with its own date, day, stop and trip, so distances and trip rules are unchanged. Markers within 15 m of each other (the Home marker excluded) are treated as one place.
- A pin of a shared place shows a small **×2** (×3, …) badge. The marker window gets a **visits here** strip: one chip per visit in date order ("Day 3 · Stop 1 · Sat, Nov 14", with the trip's name when it differs), the current one marked; tapping another switches the window to it.
- **Add visit** (beside Edit and Delete; not for the Home marker) saves the same place again in the same trip with the dates, day and stop cleared, and opens its form.
- AI import: the same name within about 30 m is a duplicate only when the dates match, or when either side has no date. Both dated with different dates is **another visit**: it is added and the preview says so. (Before, the second visit was silently skipped.)
- Visits at one spot share one weather request, and a visit at a spot with a known elevation reuses it.

**F28. Reorder saved places by holding (built)**
- In Points of Interest, press and hold a row for 1 second (a bar fills along it; moving earlier cancels, so scrolling is unaffected), then drag it. A copy follows the pointer, a line shows where it will land, the list scrolls near its edges, and Escape cancels. Letting go well outside its group changes nothing.
- It works inside one group: one trip's markers, or the ones with no trip. It needs a dated or day-numbered list: a plain list (no dates, no days) cannot be dragged, nor while a type filter is on or while selecting markers to delete. The Home marker is not draggable. While a row is lifted, the trip's dates with no markers yet appear as places to drop.
- What a drop changes: within the same date or day only the stops are renumbered (1, 2, 3). Into another date: the marker takes that date, the day of that group (or the day worked out from the trip's start date when the group has none and days are in use) and its stop; the group it left is renumbered if it had stops. A hotel moved to a new date starts then and ends on the next day of the trip (on the trip's last day it ends the same day, which is stored as that one date); another marker with a date range keeps its length. Dropped into "No date set", a marker loses its date, day and stop. In a list grouped by day, dropping under another day also changes the date to match (from that day's other markers or the trip's start date).
- **Undo**: a message ("Moved “Name” to Fri, Nov 13 · Day 2 · Stop 2") with Undo for 10 seconds puts every changed marker back. **Keyboard**: Alt + ↑ / ↓ on a focused row moves it one place, across days at the edges, and keeps the focus on it. A hint under the list says all this while rows can be dragged.

**F29. Open in Google Maps or Amap, and routes (built)**
- Every marker window and every point-check window has an **Open in** row and a **Directions here** row (with a travel mode choice: drive, public transport, walk, bike). Directions leave the start out, so both apps start from the device's location. Links open in a new tab (`noopener`) and share the place's coordinates with the map app only when tapped; a note says so.
- Which apps: a place inside China gets **Amap first, then Google Maps**; anywhere else **Google Maps only**. "Inside China" uses a coarse outline (mainland, Hong Kong, Macao; not Taiwan; about 3 km accuracy) built from Natural Earth by `scripts/make-china-outline.js` into `src/data/china-outline.js`.
- The Home marker (the residence) asks first: its buttons need a second tap ("Share Home location? Tap again").
- **Routes**: in the Points of Interest list, Select markers; with two or more ticked, a **Route** block lists them in the order they were ticked (numbers on the rows), with up, down and remove for each stop, **Reverse**, **Use itinerary order** (date, day, stop), and a travel mode. **Open in Amap** appears only when every stop is in China; otherwise only **Open in Google Maps**, with a note. Google Maps takes 9 stops between start and end (3 in a mobile browser); Amap takes one, for driving only, and none for public transport, walking or biking. A route over those limits opens as **parts** that join end to start, with a note. The Home marker in a route asks first. Up to 30 stops.
- Amap's marker link is sent with `coordinate=wgs84`; its navigation link has no coordinate setting, so coordinates are converted to GCJ-02 (`src/coords.js`, good to a few metres) before they are sent.
- Not testable here: whether the apps open and plan the route correctly on a phone.

**F30. Search by coordinates, and a window for every result (built)**
- The search box reads coordinates: decimal pairs (`30.5928, 114.3055`, with a comma, space, slash or semicolon, or a Chinese comma), with hemisphere letters before or after (`N30.59 E114.30`, `30.59N 114.30E`, any order), degrees-minutes-seconds (`30°35'34"N 114°18'20"E`, decimal minutes, plain spaces with letters). Without letters, latitude is first; if the first number is above 90 and the second is not, the pair is read longitude-first. Impossible values give a plain message in the list (latitude outside −90..90, longitude outside −180..180, minutes or seconds of 60 or more).
- It also reads pasted map links: Google Maps (`!3d!4d` pin, then `@lat,lon`, then `q`, `query`, `ll`, `destination`) and Amap (`position=lon,lat`, GCJ-02 unless `coordinate=wgs84`). Short links (maps.app.goo.gl, surl.amap.com and similar) cannot be opened from the browser, so they get an explanation.
- Typed or pasted coordinates inside China give **two rows**: as typed (GPS, WGS-84) and converted from GCJ-02, which is what Amap and other Chinese map apps show. Coordinates are read in the browser and never sent to an online search; text that is not coordinates still offers the online name search.
- Picking any result (coordinates, a link or a place name) centres the map on it (at its zoom, with the side panel in mind), drops a blue pin and opens the same point-check window a press and hold gives, above the pin: the zone verdict, elevation and weather button when on, Open in Amap / Google Maps, **Add as marker** and, for a searched spot, **Remove pin**. The pin stays until the next search; clicking it reopens the window, and a click on blank map only closes the window.
- **Add as marker** is in every point-check window (search, press and hold, right-click, Enter, your location): it saves the spot as a marker of the chosen type in the chosen trip, named after the place (or its coordinates), removes a search pin, and opens the marker's form.

**F31. The day follows from the date; trips need dates (built)**
- Trip dates are **required** when creating or editing a trip (start and end; one day is start = end). A trip saved earlier without dates keeps working, shows "No dates yet" on its card, and asks for dates the next time it is edited. An AI reply whose trip has no dates shows start and end boxes in the preview and will not add until they are filled (or "No trip" is chosen).
- A marker's **day is worked out**: Day N = its date minus the trip's start date, plus 1 (a stay of several nights is "Day 1–3"). There is no Day box in the marker form; it shows a line ("Day 2 of the trip (worked out from the date)") that updates as the date or trip changes. A date outside the trip's dates has no day. The pin label, list rows, marker window and visit chips all use it, so editing a trip's start date moves every day number.
- An old marker that has a day but no date (and no trip with a start date to work it out from) keeps its stored day, read-only.
- **One-time fix at start-up**: in a trip with a start date, a dated marker loses its stored day, and a day-only marker becomes a date (start + day − 1). A message says how many were corrected or turned into dates. The same happens when a trip gets dates later, and when markers are saved, imported or moved.
- AI import: with a trip that has dates, a place's day becomes a date; a reply's day beside a date is ignored. Export files still carry the day, now worked out. Reordering by dragging only works in dated lists; a move sets the date and stop (the day follows).

**F11. Remembered settings (built)**
- The last basemap, the country choice, the zone opacity, the distance units, the max range and the map position (centre and zoom) are saved in this browser (`localStorage`, key `uavzones.v1.prefs`) and restored on the next visit. The position is saved shortly after each move and when the page is closed.
- First visit (nothing saved): the map fits all covered regions. Later visits resume exactly where the user left off; the country choice only restores the menu, not the position.
- Saved values are validated on load (known basemap, plausible country code, coordinates and zoom in range). Anything damaged or unknown is ignored and the defaults are used. If storage is blocked, the app works and simply does not remember.
- Zone opacity: the slider updates the zones live while it is dragged, and the value is saved when it is released (not on every step). It is applied before the first zone layer is drawn, so there is no flash at the default. Accepted range is the slider's own, 0.1 to 0.9; anything else falls back to 0.45.
- The privacy choices (F13) are kept in the same entry. The wind limit and the saved markers are remembered separately. Not remembered yet: whether zones are shown, the open tab, and whether the panel is shown.

**F5. Side panel (built)**
- One hide-able side panel with three tabs: **Map Configs** (country shortcut, zone visibility and opacity, basemap, wind limit, legend, coverage and disclaimer), **Trips** and **Points of Interest**.
- While the panel is hidden, a dock of three buttons ("Map Configs", "Trips", "Points of Interest") opens it on the chosen tab. On phones the panel is a bottom sheet that starts hidden and closes itself when the map needs to be seen.
- Tabs are keyboard-operable (arrow keys); light and dark themes follow the system setting.

## 5. Non-functional requirements

- **Static delivery:** the app must run from static files with no server. Hosting on GitHub Pages or a similar static host must work.
- **Offline behaviour:** the target is that zones and offline search work without internet, with only basemap tiles and online search needing it. Not met yet: it needs a service worker caching the tiles.
- **Responsive:** usable on a phone and a desktop browser. Checked at 390 px and 1200 px wide in Edge; not on real devices.
- **Performance:** zones are served as vector tiles (PMTiles, range requests), so only the tiles in view are fetched. Not yet measured on mid-range phones.
- **Accessibility:** controls are keyboard-operable, have labels, and respect light and dark system themes.
- **Privacy:** the app sends no user data to any service other than the basemap provider, the geocoder for online search, and Open-Meteo, only when the user presses "Show weather here" (that point) or turns on automatic weather for markers (every marker's location on placement, move and refresh, rounded to about 1 km unless the user chooses precise), or turns on ground elevation (the exact location of a marker or point when its window or popup opens). or turns on name lookup for AI imports (the names or addresses of places that came without coordinates, to Photon and then Nominatim, when Add is pressed). All of these are off by default and controlled in the privacy settings. The wind limit and the saved markers never leave the browser (they are only written to local storage, or to a file when the user exports). If a future module ingests user files (for example flight logs), those files stay in the browser unless the user explicitly uploads them.
- **Licensing and attribution:** respect OpenStreetMap, Esri, OpenTopoMap, Leaflet (BSD-2 Clause), and echarts/china-map-geojson licences where their data is used. Record each in `docs/ATTRIBUTIONS.md` when the project is set up.

## 6. Architecture

Vite + Leaflet in plain JavaScript, with a Node build script. Full layout and the data model are in `README.md`; how to add a region is in `CONTRIBUTING.md`.

- **One region = one folder** (`data/regions/<country>/<region>/`) with a committed `source.json` and `boundary.geojson`, and local-only raw data. Adding coverage never needs a code change.
- **Semantics.** Each region is `allow` or `restrict`. This drives the fill colour, the legend and the point-check wording, because China publishes where flying is permitted while most other jurisdictions publish where it is restricted.
- **Coverage boundary.** A WGS84 polygon per region separates "outside the zones" from "no data here". Without one the dataset's bounding box is used.
- **Build.** `scripts/build-data.js` reads each region (readers in `scripts/lib/readers.js`: shapefile, GeoJSON), converts to WGS84 (`crs.js`: WGS84, GCJ-02), tiles it (`tiles.js`) and writes a PMTiles file with a content hash in the name (`pmtiles-writer.js`), plus a manifest per country and a root `index.json`. Stale files are pruned. Rebuilding is deterministic.
- **Data not in `main`.** `public/data/` is generated locally and published only to the `gh-pages` branch with `npm run deploy` (single commit, no history), so large tile files never bloat the repository. No CI: the maintainer builds and deploys.
- **Configurable data location.** The app reads everything under one base URL (`VITE_DATA_BASE_URL`, default `./data/`), so tiles can later move to object storage (for example Cloudflare R2) without code changes, and contributors can run the app against the published data.
- **Scale.** One PMTiles per region with per-country manifests works to a few hundred regions. GitHub Pages is limited to about 1 GB, so plan the move to object storage before nationwide coverage.

## 7. Known issues and limits

1. The Hubei CRS is declared WGS84 but not yet verified against imagery. A GCJ-02 mistake would shift every zone by a few hundred metres.
2. Esri and OpenStreetMap tiles may show a small offset against the official cells. Compare on a satellite basemap before assuming an error in the data.
3. Place coordinates are approximate, and only Hubei places exist.
4. Coverage boundaries are approximate. The Hubei one (Natural Earth 1:10m) can be off by about a kilometre at the border; see `docs/regions/cn-hubei.md`.
5. Zone tiles are simplified at low zoom (geojson-vt). Point checks always use the highest zoom, where cells keep their full shape.
6. Esri's street basemap has no tiles at the closest zooms in China ("Map data not yet available"). Use Esri Satellite there.
7. The build drops attributes, so per-zone classes or height limits are not supported yet.
8. The Hubei licence is unconfirmed, and the data is published on that basis.
9. No offline support yet (see section 5).
10. (Withdrawn: the earlier prototype was removed from the repo.)
11. Markers live in one browser on one device. Safari can clear site data after a period without use, so the app asks for persistent storage and prompts for backups, but only an export is a guarantee. On GitHub Pages the storage origin is shared by every site under the same `<user>.github.io`, so keys are prefixed `uavzones.`.
12. Marker popups keep light colours in the dark theme.
13. Edit mode and the hold-and-drag were tested with a mouse and with emulated touch events in Edge, not on physical phones.
14. AI-supplied coordinates are unreliable. The app cannot tell a correct coordinate from a plausible wrong one, so everything from an AI is marked unverified, and name lookups can also match the wrong place (Photon and Nominatim return their best guess). Check each one on the map.
15. The AI import was tested with mocked geocoders and pasted text, not against live assistants. How well a given assistant follows `ai/prompt.md` is untested.
16. A share link carries all markers in the address. About 40 places is roughly 800 characters; some chat and messaging apps cut links over about 4000 characters, which the app warns about. Export is the dependable route for large lists.
17. Distances are straight-line, not along roads or paths, and the dates are calendar dates without time zones or times of day. The hotel-by-date rule treats an undated hotel as covering every date, so forgetting to date a hotel can make it appear for a trip it does not belong to.
18. The AI prompt asks for full dates with the year, but how a given assistant handles a missing year is untested; the app drops anything that is not a real ISO date and never guesses one.
19. A Home marker is excluded from share links, automatic weather and automatic elevation, but it is stored in plain form in the browser and in any export file. Treat export files as private.

## 8. Decisions

Settled:
- Public, open-source repo (code MIT). Hubei data published with its licence unconfirmed.
- Name: UAV Companion, repository `uav-companion` (earlier called UAV Zones). Internal storage keys and the export flag keep the earlier `uavzones` prefix on purpose, so markers and settings already saved in a browser, and files exported before the rename, stay readable.
- Hosting: GitHub Pages from the `gh-pages` branch, no CI; built data stays out of `main`.
- Point checks use the same tiles as the display, at the highest zoom.
- Scope for the next year: China and Singapore.
- Contributors add regions through pull requests (`CONTRIBUTING.md`); the maintainer builds and deploys.

Open:
- Does the official zone change between announcements? If so, how is each update versioned? (The hashed file names make a re-publish safe; the history of old versions is not kept.)
- Online search provider: Photon (default) with Nominatim fallback, or Esri's geocoder (may need a token).
- Singapore source data and its terms (CAAS, data.gov.sg) and its `semantics` mapping: restricted versus prohibited areas may need two zone classes, which the build does not support yet.
- When to move tiles from GitHub Pages to object storage.

## 9. Future module: Betaflight log analyzer (not started)

A separate module that shares the app shell but not the map code.

- **Connection:** MSP over USB serial via the Web Serial API. Chromium-based browsers (Chrome, Edge) only. Requires a secure context: HTTPS or localhost, so a file opened from disk will not work.
- **Phase 1 (read-only):** connect, identify board and firmware, list blackbox logs on flash.
- **Phase 2:** download logs and parse them in the browser.
- **Phase 3:** analysis and charts. Evaluate existing open-source decoders (for example blackbox-log-viewer and blackbox-tools) for reuse; check their licences and current Betaflight compatibility first.
- **Phase 4 (last):** settings writes, each with explicit user confirmation.
- **Hosting:** fits GitHub Pages, as long as all processing runs in the browser.
- **Privacy:** flight logs can contain GPS history. Keep sample logs out of any public repo. Do not upload user logs anywhere.
- **Testing:** parsing can be unit-tested with sample logs. Connection and flashing need physical hardware testing.
- **Record:** the target Betaflight firmware version and supported board types, since MSP details vary between releases.

## 10. Glossary

- **适飞空域 (suitable-flight airspace):** areas where micro, light and small drones may fly below 120 m true height without prior reporting (blue zones on the official map). Other areas are controlled.
- **UOM:** the Unmanned Aircraft Operating Management platform, the official app and website for checking zones.
- **MSP:** MultiWii Serial Protocol, the flight-controller communication protocol used by Betaflight.
- **Blackbox:** Betaflight's on-board flight data logger.
