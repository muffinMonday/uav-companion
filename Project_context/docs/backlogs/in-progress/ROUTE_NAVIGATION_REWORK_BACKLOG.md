# UAV Companion --- Route Visualization & Driving Navigation Rework

**Status:** IMPLEMENTED ON `main` (2026-11-21), NOT DEPLOYED. Migration not applied, HeiGIT secret not set, function not deployed (owner steps below).\
**Prepared:** 2026-11-21\
**Repository:** `muffinMonday/uav-companion`\
**Review baseline:** `main` observed at
`b35af34814d12051554ad8c7cc50aa80e11fa956` (re-check HEAD before
implementation)\
**Scope:** itinerary route data, server-side driving routing,
shared/private route caching, Leaflet route rendering, overlap handling,
coincident-marker spidering, fallback behavior, tests, docs.\
**Out of scope during backlog preparation:** modifying code, migrations,
Supabase configuration, secrets, or production deployment.

## 1. Product outcome

Replace the current straight-line itinerary arrows with useful, readable
driving navigation while retaining deterministic offline/degraded
behavior.

Locked owner preferences:

-   Directional route band: **balanced** --- broad enough to read,
    restrained enough not to obscure the basemap.
-   Direction indication: **repeated chevrons fitted inside the band**,
    not a single floating arrowhead.
-   Opposite-direction overlaps: **parallel lanes**.
-   Route distance labels: **always visible**, subject to
    collision/readability handling.
-   Coincident markers from different trips: **spider on interaction**;
    preserve independent marker records.
-   Travel mode: **driving**.
-   Same-country eligible itinerary legs: use hosted **HeiGIT
    openrouteservice (ORS)** driving routing.
-   Routing failure with no valid cached route: **straight-line
    displacement fallback**, rendered as a **dashed directional band**
    and explicitly distinguishable from a road route.
-   Overnight transition: **segmented directional band**.
-   Implementation scope: **all approved behavior**, delivered in gated
    phases.
-   Shared trips: calculated route results should be reusable by
    authorized trip participants rather than recalculated per viewer.
-   Accommodation/Home-point reference links remain **straight-line
    FPV/base references**, not navigation routes.

## 2. Verified current implementation

The following was verified against the repository and should be treated
as existing behavior, not proposed behavior.

### 2.1 Itinerary route drawing (`src/poi-ui.js`)

-   `chainOf(tripId, date)` builds the ordered main-stop chain for a
    trip/date. Hotels and the private Home/residence marker are
    excluded.
-   `drawSeg()` currently draws a straight two-coordinate Leaflet
    `L.polyline`.
-   Normal route segments are approximately `weight: 2.5`,
    `opacity: 0.4`; selected-adjacent segments are approximately
    `weight: 6`, `opacity: 0.95`.
-   Overnight/cross-day links use `dashArray: '12 9'`.
-   Direction is currently communicated by one SVG arrow marker around
    62% along the segment.
-   The arrow is suppressed for very short on-screen segments.
-   Selected/bold legs show a Haversine distance label around 36% along
    the segment when sufficiently long on screen.
-   `zoomend` redraws routes because arrow orientation depends on
    projected screen geometry.
-   Routes follow existing trip visibility (`tripDrawn`) and do not
    intentionally outlive hidden trips.
-   Cross-day logic connects the end/start of days through an applicable
    accommodation where present, otherwise adjacent-day stops.

### 2.2 Base/displacement links (`src/distance.js`, `src/poi-ui.js`)

This is a separate semantic system and must remain separate from
navigation.

-   `BASE_TYPES` are Home point (`home`), Accommodation (`hotel` stored
    ID), and private Home/residence (`residence`).
-   `nearestBases()` uses Haversine distance.
-   Home point and Accommodation candidates are scoped to the same trip
    and overlapping dates; undated bases/waypoints can match broadly
    according to current rules.
-   The closest qualifying base by displacement is selected.
-   Bearing is already calculated and returned.
-   The private Home/residence has separate semantics and does not count
    toward max launch-base range.
-   `relink()` currently renders applicable base links as 3 px dashed
    straight polylines (`dashArray: '7 7'`) with a midpoint distance
    badge.
-   Existing distance-to-base/max-range semantics are intentionally
    straight-line/FPV-oriented.

**Approved treatment:** keep these as thin, dotted/nondirectional
spatial reference links. Do not route them through ORS. Keep
straight-line distance on-map; bearing may be surfaced in marker
details. Existing cached road data may be displayed as supplemental
detail only if already available; do not make an ORS request solely for
a base-reference link.

### 2.3 Shared-trip backend (`supabase/migrations/20261111140000_shared_trips.sql`)

-   A shared trip is one versioned JSON document containing the trip and
    markers.
-   `shared_trips.doc` is capped at 1,000,000 bytes and a shared trip at
    500 markers.
-   `trip_members` contains owner/editor roles and invited/joined
    status.
-   Direct table access is revoked from `anon` and `authenticated`; RLS
    is enabled with no direct-access policy.
-   Access is through security-definer functions that derive the caller
    from `auth.uid()` and check membership/role.
-   Joined editors can edit shared trip/marker content; owner-only
    operations govern membership/deletion.
-   Home/residence and check-in data are rejected from shared-trip
    documents.
-   Existing backend tests cover shared-trip database rules,
    merge/store/engine behavior, browser party behavior, and live hosted
    rules.

**Constraint:** route-cache access must preserve this authorization
model. Do not expose cached shared-trip geometry through a broadly
readable table or trust a client-supplied user/trip relationship.

### 2.4 Current marker overlap behavior

No repository evidence reviewed for this backlog establishes an existing
spiderfy implementation. Treat **spidering coincident markers as new
behavior** and audit the current marker stacking/click behavior before
changing it.

## 3. External routing constraints to verify at implementation time

Use the current HeiGIT endpoint, not the deprecated
`api.openrouteservice.org`.

Expected service:
`POST https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson`

-   Authentication uses a HeiGIT API key in the `Authorization` header.
-   Keep the key server-side; never embed it in the Vite/browser bundle
    or shared-trip document.
-   Coordinates sent to ORS are longitude/latitude.
-   ORS returns route geometry plus distance/duration suitable for
    caching and rendering.
-   Quotas, maximum route distance, waypoint limits,
    acceptable-use/caching terms, attribution, and plan/commercial-use
    restrictions are external and may change. **Sonnet must re-check the
    owner's active HeiGIT plan/current official documentation before
    hard-coding limits.**
-   Treat HTTP 429, 4xx routing failures, 5xx, timeout/network failure,
    malformed response and "no route" as controlled failures.
-   The public service has had maintenance/outage periods; cached route
    and fallback paths are required product behavior.

Do not assume a historical quota number is contractual. Implement local
request throttling/budgeting below the verified account limits.

## 4. Proposed architecture

### 4.1 Separation of concerns

Introduce narrow modules rather than expanding `poi-ui.js` into a
routing client:

1.  **Leg derivation** --- converts existing trip/day/overnight
    semantics into logical directed legs.
2.  **Route identity/cache key** --- stable identity from trip,
    endpoints, coordinates, profile and routing-schema/provider version.
3.  **Routing adapter** --- browser-facing API for "get route for leg";
    no provider secret.
4.  **Server routing function** --- validates authorization/input,
    checks cache, calls HeiGIT on cache miss, validates response,
    persists result.
5.  **Route renderer** --- renders road geometry or fallback geometry,
    chevrons, labels and overlap offsets.
6.  **Base-reference renderer** --- retains current displacement
    semantics separately.

Keep the existing trip sequencing rules authoritative. Routing changes
geometry/distance/duration, not itinerary order.

### 4.2 Eligibility

Initial navigation profile is `driving-car`.

Request a road route only when: - the logical itinerary leg is eligible
under current trip visibility/sequence rules; - both endpoints have
valid coordinates; - endpoints are determined to be in the same country
under a reliable existing/new country resolver; - the request is within
verified ORS constraints.

Do not infer "same country" from trip name. Define and test
border/unknown-country behavior. If eligibility cannot be established,
use straight-line fallback without calling ORS.

Same-country is a product gate, not proof of road connectivity. Islands,
disconnected road networks and inaccessible coordinates may still fall
back.

### 4.3 Cache design

**Recommended:** a separate normalized Supabase route-cache table for
shared trips, plus a bounded local cache for private/local-only trips.

Do not put full route geometry into `shared_trips.doc`: it would inflate
revisions, create merge conflicts, and compete with the existing 1 MB
document limit.

Suggested shared cache fields (final names/schema to follow repo
conventions): - `id` - `trip_id` - `from_marker_id` - `to_marker_id` -
endpoint coordinate fingerprints or normalized endpoint coordinates -
`profile` (`driving-car`) - `provider` / routing schema version -
encoded/GeoJSON geometry - `distance_m` - `duration_s` - `created_at` /
`updated_at` - optional provider response metadata needed for
attribution/debugging, excluding secrets/personal identifiers

Use a uniqueness constraint covering the route identity. Prevent
duplicate concurrent misses from creating duplicate cache rows.

For local/private trips, use a bounded device-local cache where
practical; failure to persist must not break fallback rendering.

### 4.4 Shared-trip access control

Follow the existing RPC-first security posture:

-   RLS enabled.
-   Revoke direct `anon`/`authenticated` table access unless an
    explicitly reviewed policy requires otherwise.
-   A joined trip member may retrieve route-cache entries only for that
    trip.
-   Invited-but-not-joined users must not receive geometry.
-   Route generation must verify the caller is authorized for the trip
    before forwarding coordinates to HeiGIT.
-   Writes should occur through a narrowly scoped server/RPC/Edge
    Function path; clients must not be able to forge a cache entry for a
    trip they cannot access.
-   Decide whether any joined editor can cause a cache miss/provider
    request (likely yes, with rate limiting) while keeping
    administrative operations owner-scoped.
-   Deleting a shared trip should cascade-delete its route cache.
-   Leaving/removal should immediately remove future cache access.
-   Never include `residence`/private Home coordinates in this cache.
-   Never log API keys; minimize coordinate logging.

If a Supabase Edge Function is used for the provider call, store the
HeiGIT key in server-side secrets and validate the authenticated
caller/trip membership before use.

### 4.5 Cache invalidation

A cached leg is valid only when all route-defining inputs still match.

Invalidate/recompute the affected leg(s) when: - either endpoint
moves; - a marker is deleted; - stop order changes, creating/removing
directed adjacency; - marker date/day changes alter the chain; -
accommodation dates/assignment alter overnight legs; - a marker
enters/leaves a trip; - routing profile/provider/schema version
changes; - trip edits change which logical legs exist.

Do **not** invalidate unrelated legs.

Prefer identity-based staleness (coordinate/profile fingerprint
mismatch) plus cleanup of orphaned rows. Never serve a route whose
endpoints no longer correspond to the current marker coordinates.

Cached data remains usable during provider outage if its identity is
valid. Do not discard valid cache merely because HeiGIT is unavailable.

## 5. Fallback state machine

For each eligible logical leg:

1.  Derive current directed leg and route identity.
2.  Use valid local/shared cached road route if present.
3.  On authorized cache miss, request server-side HeiGIT route.
4.  If successful and valid, cache and render road route.
5.  If routing fails/no route/times out/rate-limited and no valid cache
    exists, render straight-line displacement fallback.
6.  Never present fallback distance as driving distance.

Fallback UI must remain functional offline.

Recommended status semantics: - **Road:** road geometry + driving
distance + duration. - **Cached road:** same normal presentation;
optional nonintrusive freshness/debug state, not a warning. -
**Fallback:** straight directed line + displacement distance; explicit
"straight-line" semantics where detail text is shown.

## 6. Leaflet visual specification

### 6.1 Balanced directional band

Road routes: - Use a medium/broad route band in trip color, visually
"balanced": readable but not dominant over markers/airspace. - Initial
tuning target: roughly 8--10 CSS px normal; selected/emphasized leg may
be roughly 10--12 px. Treat values as tuning targets, not immutable
constants. - Use existing design tokens/identity colors; follow
`Project_context/docs/DESIGN.md`. - Repeated chevrons sit **inside the
width of the band**. - Chevron spacing is screen-space based,
approximately 70--90 px as an initial target. - Chevrons rotate to local
route tangent, not overall endpoint bearing. - Suppress/adjust chevrons
on tiny segments and pathological sharp bends. - Preserve upright
labels/markers under the app's custom map rotation behavior. - Recompute
pattern placement/orientation on relevant zoom/rotation/view changes
without rerouting.

Avoid a new heavy mapping framework if Leaflet primitives/panes/SVG
renderer and a small purpose-built pattern renderer suffice. Do not add
a dependency without justification and bundle/performance review.

### 6.2 Labels --- always

Owner preference: route distance labels are always shown.

For road routes, label should communicate at least driving distance;
include duration in the compact label if it remains readable,
e.g. `9.8 km · 18 min`.

"Always" means the renderer should attempt to keep one label for each
logical visible leg, not blindly stack unreadable labels. Implement
deterministic collision handling: - prefer a stable position along the
leg; - shift along geometry if the preferred point collides with
markers/another route label; - avoid duplicate labels on shared
geometry; - if the viewport physically cannot accommodate all labels,
use a defined degradation rule rather than uncontrolled overlap, and
document/test it.

For fallback, show displacement and distinguish it as straight-line in
details/accessible text.

Respect metric/imperial settings.

### 6.3 Overnight transition

Overnight/cross-day travel remains semantically distinct: - road
geometry when available; - **segmented broad directional band** with
embedded chevrons; - distance/duration label always; - fallback remains
dashed/segmented but must still be distinguishable as straight-line
fallback (do not rely on dash pattern alone---use accessible text/state
and, if needed, a secondary visual treatment).

### 6.4 Opposite-direction overlap --- parallel lanes

When two visible route portions use the same/near-same road in opposite
directions: - render them as close **parallel directional lanes**; -
each lane retains its own chevrons and direction; - preserve trip color;
selected route gets visual priority; - offset only the overlapping
portion where feasible, then merge smoothly back to the true road
geometry; - use screen-space offsets so readability is stable across
zoom.

Implementation may ship in stages: 1. robust exact/near-exact reverse
geometry; 2. partial-overlap detection/splitting; 3. complex multi-route
overlap only if needed.

Do not permanently offset entire non-overlapping routes.

Same-direction duplicates may share visual geometry when doing so does
not erase trip identity; selection/details must still expose each
logical leg.

### 6.5 Base-reference links

Accommodation/Home point/private Home reference lines: - remain
Haversine displacement; - thin dotted line; - no chevrons; - visually
subordinate to navigation bands; - keep compact distance label; -
preserve existing applicability, trip/date matching and max-range
calculations; - expose existing bearing/compass information in marker
details where appropriate.

Do not send these coordinates to HeiGIT merely to enhance this link.

## 7. Coincident markers --- spider interaction

New behavior.

When two or more independently stored markers resolve to the
same/near-identical on-screen point: - keep all records independent;
never merge data because coordinates coincide; - clicking/tapping the
stack spiders markers into a small radial/fanned arrangement with
connector stems; - each spidered marker remains identifiable by its
trip/type badge/color and opens its own existing marker behavior; -
collapse on map/background interaction, zoom/pan as appropriate, or
after choosing a marker; - keyboard-accessible equivalent must allow
selecting each marker; - respect marker visibility: hidden trips must
not leak markers into the spider; - Side Quest and selection modes must
not become ambiguous; - map rotation must not displace hit targets from
visual markers.

Audit current "top marker"/stacked-visit/select-mode behavior before
implementation and preserve intentional semantics.

## 8. Performance and lifecycle

-   Never reroute on map pan/zoom/rotation.
-   Route requests should be driven by logical trip-data changes or
    first need, not rendering events.
-   Deduplicate in-flight requests.
-   Bound concurrency and add timeout/backoff behavior.
-   Do not automatically retry a persistent 4xx/no-route condition on
    every render.
-   Respect provider quota with a server-side/request-layer budget and
    429 handling.
-   Simplify geometry for rendering only if visual fidelity remains
    acceptable; retain enough canonical geometry for stable cache reuse.
-   Clean up Leaflet layers/listeners on redraw to prevent accumulation.
-   Ensure PMTiles/basemap behavior is unaffected.
-   Consider a maximum number of simultaneously patterned visible routes
    before simplifying at low zoom.

## 9. Privacy, attribution and failure messaging

-   HeiGIT key server-side only.
-   Only send coordinates required for the requested itinerary leg.
-   Do not send marker names, notes, user IDs, friend IDs, or trip
    descriptions to HeiGIT.
-   Verify current HeiGIT/ORS terms concerning coordinate data, caching,
    attribution, commercial use and retention before production.
-   Add required attribution without obscuring existing
    Leaflet/OSM/airspace attribution.
-   Provider failure must not imply the route is impossible; use neutral
    wording such as "Driving route unavailable; showing straight-line
    distance."
-   A fallback is a planning approximation, not a driving instruction.

## 10. Tests and regression gates

### 10.1 Pure/unit

-   logical leg derivation from existing date/order/accommodation rules;
-   route identity/key stability;
-   invalidation for move/delete/reorder/date/trip/profile changes;
-   unaffected-leg preservation;
-   same-country eligibility and unknown/border cases;
-   ORS response validation and coordinate order;
-   fallback selection;
-   metric/imperial formatting;
-   overlap direction/tolerance classification;
-   chevron placement/tangent calculations;
-   label collision/degradation;
-   coincident-marker grouping/spider layout.

### 10.2 Supabase/database

Extend the established PGlite/database suites: - joined member can
read/use own trip cache; - invited/nonmember/blocked unrelated user
cannot; - no direct table bypass; - unauthorized route generation
rejected before provider call; - delete trip cascades cache; - member
removal/leave revokes access; - duplicate route identities cannot race
into duplicates; - invalid/malformed geometry rejected; - private
Home/residence cannot enter shared route cache; - rate/budget controls
cannot be bypassed through obvious concurrent calls.

### 10.3 Routing adapter / Edge Function

Mock HeiGIT: - success; - cache hit causes no provider request; - 400/no
route; - 401/403 key/config failure; - 429; - timeout/network failure; -
5xx/malformed response; - stale identity never served; - valid cache
survives provider outage.

### 10.4 Browser/Leaflet

At desktop and phone widths, light/dark themes and reduced motion: -
broad band + embedded repeated chevrons; - chevrons remain correct
through zoom and custom map rotation; - road geometry follows mocked
route; - fallback is visually/semantically distinct; - overnight
segmented band; - labels visible and collision handling deterministic; -
opposite-direction parallel lanes; - selected-route emphasis; - hidden
trip produces no route/label/spider entry; - base-reference lines retain
old displacement behavior; - coincident markers spider and each remains
selectable; - popup/details and marker selection modes still work; - no
route layers survive marker/trip deletion.

### 10.5 Existing regression suites

Run the full repository suite and specifically protect: - POI/trip
ordering and Side Quests; - sharedtrip unit/store/engine and DB tests; -
party/browser shared-trip tests; - map rotation/touch/locate tests; -
trip visibility/completed-trip behavior; - marker details and
distance/max-range behavior; - GeoJSON/import/share behavior; -
production build.

Do not weaken tests merely to accommodate the rework.

## 11. Phased implementation plan

### Phase 0 --- Reconcile and baseline

-   Re-check HEAD and all applicable `AGENTS.md`, `CURRENT_STATUS.md`,
    design/module/development docs.
-   Trace current route layers, marker visibility, shared-trip adapters
    and test helpers.
-   Verify current HeiGIT plan/terms/limits.
-   Record any conflict with this backlog before coding. **Gate:**
    baseline tests green; no behavior change.

### Phase 1 --- Route domain + deterministic fallback

-   Extract logical leg derivation and route result model.
-   Preserve current sequence/overnight semantics.
-   Implement explicit road/fallback states without provider
    integration.
-   Keep base-reference subsystem untouched except approved
    styling/detail changes. **Gate:** unit tests and existing route
    regressions green.

### Phase 2 --- Secure server routing + caches

-   Add shared normalized cache migration/RPC/Edge Function following
    current auth model.
-   Add bounded local/private cache.
-   HeiGIT secret server-side.
-   Implement cache-first routing, validation, quota/error handling and
    invalidation. **Gate:** DB + mocked provider + shared-trip tests
    green.

### Phase 3 --- Road geometry and balanced directional bands

-   Render cached/returned GeoJSON geometry in Leaflet.
-   Implement broad band, repeated embedded chevrons, always-on labels,
    selected emphasis and segmented overnight styling.
-   Implement dashed straight-line fallback. **Gate:** browser tests at
    phone/desktop + rotation/zoom + dark theme.

### Phase 4 --- Overlap lanes

-   Implement reverse overlap detection and parallel screen-space
    offsets.
-   Add partial overlap handling where practical. **Gate:**
    deterministic overlap tests and visual/browser regression.

### Phase 5 --- Coincident-marker spider

-   Audit current stacked marker behavior.
-   Add accessible spider interaction without merging records or
    bypassing visibility. **Gate:** mouse/touch/keyboard + map
    rotation + selection-mode tests.

### Phase 6 --- Base-reference polish

-   Thin dotted nondirectional links.
-   Preserve displacement/max-range.
-   Add bearing to details.
-   Optional cached road info only if already present; no new request.
    **Gate:** distance.js behavior unchanged except approved
    presentation.

### Phase 7 --- Integration, docs and production-readiness review

-   Full suite/build.
-   Attribution/privacy/help copy.
-   Verify quota/terms again.
-   Review cache cleanup and provider outage behavior.
-   Update project docs/status/changelog according to repo workflow.
    **Gate:** owner review before deployment.

## 12. Acceptance criteria

The feature is complete only when:

1.  Eligible same-country itinerary legs normally show road-following
    driving geometry.
2.  Valid cached geometry is reused across authorized shared-trip
    viewers.
3.  Provider secrets never reach the browser.
4.  Provider failure never removes the route: valid cache wins;
    otherwise straight-line fallback appears.
5.  Road and fallback distances are never mislabeled.
6.  Direction can be read from any substantial visible portion of a
    route via embedded repeated chevrons.
7.  Opposite-direction shared roads are readable as parallel lanes.
8.  Overnight travel remains visually distinct.
9.  Each visible logical leg has a usable distance label under the
    defined collision policy.
10. Coincident markers can be individually selected through spidering.
11. Accommodation/Home-point reference lines remain straight-line
    FPV/base references and do not consume routing requests.
12. Existing max-range, trip visibility, Side Quest, shared-trip, map
    rotation, import/export and privacy behavior remains intact.
13. All new backend access is membership-authorized and covered by
    negative access tests.
14. Full repository tests and production build pass.
15. No deployment occurs without explicit owner authorization.

## 13. Explicit non-goals / deferred choices

-   No walking/cycling/transit profiles in this build.
-   No turn-by-turn navigation UI.
-   No continuous GPS navigation.
-   No route optimization/reordering of itinerary stops.
-   No routing of private Home/residence.
-   No self-hosted ORS in this phase.
-   No sophisticated traffic/live ETA claims.
-   No automatic conversion of base-reference displacement into road
    distance.
-   Do not broaden routing to cross-country legs until separately
    approved.

## 14. Sonnet implementation discipline

This backlog authorizes the full scope but **not a monolithic rewrite**.
Sonnet should work phase-by-phase, inspect before editing, preserve
current semantics, and stop for owner clarification only when a material
conflict cannot be resolved from code/docs/spec. Commit logical phases
separately. Do not deploy unless the owner explicitly authorizes
deployment after review.

## 15. Implementation status (2026-11-21)

**Commits (phase by phase):** Phase 0/1 `c0e968a` (route domain, leg derivation extracted from poi-ui); Phase 2 `9993f08` (migration `20261121100000_trip_routes.sql`, `route-leg` edge function, shared rules, client router); Phase 3 `6569d72` (bands, chevrons, labels, road and fallback rendering); Phase 4 `00de92b` (parallel lanes); Phase 5 `71c5381` (coincident-marker fan); Phase 6 `7ae8f73` (base-reference links); Phase 7 credit, privacy note and forget button, then documentation and a fix for blocked storage. See `git log` for the exact list.

**Where:** `src/route/`, `src/spider.js`, `supabase/functions/route-leg/`, `supabase/functions/_shared/route-rules.js` and `route-polyline.js`, `supabase/migrations/20261121100000_trip_routes.sql`. Code map: MODULES.md; schema: DATABASE.md; decisions: DECISIONS.md.

**Verified HeiGIT facts (read 2026-11-21; the owner's own plan could not be inspected):** endpoint `POST https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson` (the old `api.openrouteservice.org` is deprecated, per HeiGIT's announcement; quota there is cut and the host shuts down 2026-09-28 per the search snippet, which now lies in the past). Hosted API restrictions page: driving profiles maximum distance 6,000 km, route waypoints 50. Terms page: results are licensed CC-BY 4.0 and must credit "openrouteservice.org by HeiGIT" and OpenStreetMap contributors (implemented as the map credit while a road is drawn). Quota figures seen only in a search summary, not confirmed for any plan: 2,000 requests per day and 40 per minute for the free tier; the budgets (150/user/day, 1,500/day, 30/minute) sit below them. **Not verified, owner to check on account.heigit.org (the pages need a JavaScript browser):** the authorization header format (the function sends the key as `Authorization: <key>`, the documented ORS convention, not confirmed here), your active plan's daily and per-minute limits, and the terms on storing results (the app stores routes on the device and, for a shared trip, in the database).

**Tests:** new unit suites `route-core-unit` (91), `route-geometry-unit` (38), `route-overlap-unit` (26), `route-router-unit` (46), `route-leg-unit` (50, mocked HeiGIT wired to the real SQL), `db-routes-unit` (57), `spider-unit` (16); browser `routes` (about 50) and `spider` (28). Updated `dayroute` (new markup, dates made relative because it failed on a past date before this work, assertions by count not DOM order) and `trip` (class selectors for the base link). Full `node tests/run.mjs`: 176 suites ok, 7 failed, none caused by this work: `region-labels-unit`, `country-groups-unit`, `country-buttons`, `splash`, `prefs` (local `public/data` holds more regions than the tests list; known from earlier status entries) and `poi2` (fails identically on the unchanged baseline, a TimeoutError). The run also found `opacity` failing with blocked storage because of this work; fixed (`safeStorage`) and rerun clean. `npm run build` ok. `npm run test:unit`: only the known two data-environment failures.

**Owner actions needed before this works on the live site:** (1) apply the migration (`npx supabase db push --remote --dry-run`, then for real); (2) `npx supabase secrets set HEIGIT_API_KEY=<key> --project-ref <ref>`; (3) `npx supabase functions deploy route-leg --project-ref <ref>`; (4) check plan limits, header format and storage terms (above); (5) deploy the front end when satisfied. Until (1) to (3) are done, guests and signed-in users see straight-line fallbacks (the function call fails and is remembered), and everything else works as before.

**Residual risks / manual checks:** not checked against the real HeiGIT service or a real hosted database (mocked provider, in-memory Postgres); country outlines are deliberately coarse and conservative; lane detection is tuned for same-road reversals, complex multi-route overlaps are not specially handled; labels degrade by the documented order and a leg shorter than 40 px on screen has none; the fan covers stacks that mix trips only (same-trip visits keep the window's visit chips); no real phone test; the routing credit shows only while a road is drawn; per-user budget counters hold the user id for up to two days; `.route-arrow` CSS is now unused.

**Not done / deferred:** hidden-trip and marker-deletion removal of route layers in the browser are covered by the leg derivation unit tests and the window-close test, not a dedicated browser deletion test; no deployment.

## 16. Selection fix and performance pass (2026-11-21)

**Selection fix (`8e5fb4a`).** A numbered Accommodation is a stop of its day's chain (it used to be skipped, so stop 2's route ran to stop 4 and an overnight leg ran from stop 4 back to a hotel that was stop 3). Overnight links stay for other days of a stay and for an unnumbered hotel; a last stop does not link back to a hotel that is already one of its day's stops. DECISIONS records the change.

**Performance pass (`327e338`, `33b4f1f`, `ddf7038`).** Measured with a phone viewport (390x844, device scale 2, 4x CPU throttle), cached roads and a mocked provider, geometries of 120 to 3,000 points per leg; headless Edge. Medians of ten forced redraws:

| Scenario (cached roads) | Redraw before | after | SVG paths before | after |
|---|---|---|---|---|
| 6 short urban legs, z14 | 16 ms | 11 ms | 28 | 18 |
| 10 medium legs, z11 | 28 ms | 15 ms | 34 | 30 |
| 4 long legs of 3,000 points, z9 | 56 ms | 10 ms | 21 | 12 |
| the same, z13 | 69 ms | 23 ms | 35 | 10 |
| out and back (opposite lanes), z12 | 23 ms | 13 ms | 39 | 15 |
| 6 legs, z17 | 26 ms | 13 ms | 39 | 14 |

Draws while answers arrive (10 legs, answers 40 to 100 ms apart): 11 before, 5 after; 359 polylines created before, 150 after. Heap kept after drawing: 0.9 to 2.7 MB before, 0.9 to 2.2 MB after.

What was done: (1) route answers share a draw (`redrawSoon` in `poi-ui.js`: first at once, later ones within 150 ms together; any other draw is immediate and cancels a pending one); (2) the router keeps the decoded road per stored row; (3) each geometry is projected once (Web Mercator is linear in 2^zoom) and thinned to 0.5 px once per zoom (`simplifyIdx`; a pan moves points by whole pixels so it keeps the same ones), the band uses the matching stored coordinates (nothing unprojected unless the leg is in a lane), the canonical geometry, distance, duration and cache keys are untouched; (4) overlap grids are built once per path, numeric keys, samples outside the other path's box skipped; (5) a leg's chevrons are one compound path.

**Investigated, not changed.** Incremental keyed reuse of route layers (P2): after the above, Leaflet layer creation is roughly half of a draw (3 to 5 ms real on this machine) and a worst case is 23 ms at 4x throttle; the saving did not justify state for every band, label and chevron path. Skipping a redraw after a small pan: labels sit on the visible part of a leg and would drift off screen. Pin collision filtering and marker lookups: not in the profile. Culling off-screen points before thinning: chevron positions are measured from the start of the whole path, so the full path length must stay.

**Remaining risks.** Very long days (over about 20 legs of high detail) have not been measured; the draw is still O(visible legs) on every zoom and pan; the 150 ms gap delays a road that arrives right after another by up to that long; low-end Android was not tried, only the throttled desktop browser.
