# Trip Marker Map Visibility and Disambiguation

**Status: FOR REVIEW — discussion and owner decisions required.**

**Prepared:** 2026-11-15

**Related handoff:** [`docs/handoffs/active/TRIP_MARKER_MAP_HANDOFF.md`](../../handoffs/active/TRIP_MARKER_MAP_HANDOFF.md)

**Scope:** frontend behavior, UI, accessibility, tests and documentation only. No database schema, RLS, Supabase RPC, marker storage format or shared-trip protocol change is proposed.

**Execution authorization:** not granted by this document. Claude must discuss unresolved choices with the owner before editing code. Commit, push and deployment require separate explicit authorization.

## 1. Problem statement

The current POI/trip map behavior has three related discoverability problems:

1. Selecting a trip does not isolate the map to that trip's markers. The map can continue showing markers from every trip.
2. Short itinerary labels such as `D1·1` are not globally unique. Two trips can show identical labels, making the map ambiguous.
3. Completed trips can continue contributing markers to the global map, adding historical clutter. Upcoming and active trip status is clearer in the Trips panel than on the map.

The solution should preserve the project's map-first design, compact Leaflet controls, existing trip colors, existing POI visibility preferences, Side Quest behavior, touch affordances and privacy/data rules.

## 2. Current architecture to reconcile

Before implementation, verify the local HEAD against these source owners. Source code takes precedence over this document if it has changed.

- `src/poi-ui.js`
  - owns Leaflet marker creation and visibility;
  - currently has `hideTrips`, `tripHidden`, `unassignedHidden` and `shownOnMap()`;
  - currently has `showTrip(id)`, but that is primarily a POI list filter and opens the POI tab;
  - already adds a small trip-colour dot to marker icons;
  - owns routes, Side Quest links, selected marker name tags and popups.
- `src/trips-ui.js`
  - owns trip cards, trip details, status/countdown presentation and `Show markers` / `Fit map` actions;
  - already separates past trips into a `Past trips` section.
- `src/trips.js`
  - owns trip status/date helpers such as `tripStatus`, `countdownLabel`, `todayISO` and `isPastTrip`.
- `src/poi.js`
  - owns marker/trip data validation and the fixed trip colour palette.
- `src/panel.js`
  - owns tab changes and exposes the current tab/change hooks.
- `src/components/poi-panel.html` and `src/components/trips-panel.html`
  - own static panel markup; inspect before changing `index.html`.
- `src/styles.css`
  - owns the single stylesheet and existing design tokens.
- `tests/`
  - existing POI, visibility, trips, drag, responsive, popup and screenshot suites must be inventoried before adding coverage.

Important existing distinction:

- `currentTripId` means “trip used for newly created markers.”
- The proposed temporary map isolation must use separate page state, such as `activeTripViewId`. Do not conflate the two.

## 3. Design principles and constraints

Follow `Project_context/docs/DESIGN.md` and the project's existing patterns:

- Standardise and refine; do not redesign the map or panel.
- Keep the map compact by default and reveal context on interaction.
- Use the existing trip colour dot, but never use colour as the only meaning-bearing signal.
- Use the existing selected-state treatment: accent border/soft surface plus ARIA state.
- Keep primary actions distinct from navigation and secondary actions.
- Use existing buttons, badges, fields, cards, popups and panel sections before creating new primitives.
- Keep sentence-case readable text at 12 px or above; map labels may use the documented compact size.
- Preserve 44 px touch targets where applicable, keyboard focus, reduced motion, light/dark tokens and phone sheet behavior.
- Do not add a permanent map toolbar button unless the current inventory proves no existing action can expose the behavior.
- Do not add map-label blur, gradients, extra shadows, backdrop filters or a new tooltip system.
- Preserve all POI privacy semantics, Home-marker handling, shared-trip compatibility, Side Quest rules and marker visibility preferences.

## 4. Proposed product behavior

### 4.1 Temporary selected-trip map view

Introduce a temporary page-level map-view state separate from the saved visibility preferences:

```text
activeTripViewId: null | trip id
```

When a user explicitly chooses to view a trip's markers:

- show only markers belonging to that trip on the map;
- keep the trip's existing colour identity;
- show that trip's eligible routes and Side Quest links;
- allow completed trips to be viewed explicitly;
- do not modify `hideTrips`, `tripHidden`, `unassignedHidden` or any persisted preference;
- keep the selected trip identifiable in the source panel.

The temporary filter must apply consistently to:

- marker pins;
- trip routes and day routes;
- Side Quest connector lines;
- selected-marker name tags;
- open marker popups;
- marker centring and fit-map actions.

If a currently open marker belongs to a different trip after the filter changes, close its popup and clear the stale selection/tag.

### 4.2 Clearing the temporary view

Clear `activeTripViewId` and restore the normal global visibility rules when:

- the user explicitly deselects the trip;
- the user chooses the global/all-trips view;
- the user switches into the POI tab;
- the selected trip is deleted or becomes unavailable;
- the user leaves a trip-specific map explorer/detail context, if such a context is added during reconciliation.

Switching into the POI tab must restore global map visibility. The POI list filter and map visibility are separate concerns. The recommended default is to clear only the temporary map filter and leave any intentional POI list filter intact, unless current UX evidence shows that this is confusing.

### 4.3 Placement of trip-view controls

Reuse existing trip actions rather than adding another map control.

In the Trips tab:

- retain the existing `Show markers` action as the entry point;
- rename it to a contextually clear label such as `Show this trip` or `Show trip markers`;
- when active, expose a selected state using `aria-pressed` or equivalent and a clear label such as `Showing this trip`;
- keep `Fit map` separate because filtering and fitting are different actions;
- do not make clicking the whole card silently change the map filter unless the existing card interaction contract is deliberately revised and tested.

In the trip detail view:

- place the same trip-view action near the trip title/back/edit controls or in the existing detail action row;
- use identical wording and state semantics to the trip card;
- do not add a second floating map control.

In the POI tab:

- preserve the existing trip list filter;
- do not add a second trip-view selector unless implementation review shows that the user needs a visible way to return to all map markers;
- if needed, use a small inline hint near the existing filter: `The map shows all visible markers while browsing Points of Interest.`

### 4.4 Completed-trip visibility

Recommended global-map policy:

- active trips: visible;
- upcoming trips: visible;
- undated trips: visible;
- unassigned markers: unchanged and visible according to existing preferences;
- completed-trip markers: hidden by default in the global map view;
- explicitly selected trip: visible regardless of status.

Use one shared date-status helper:

```text
Upcoming: starts after today
Active: today is between start and end, inclusive
Completed: end date is before today
Undated: no complete usable date range
```

A trip ending today remains active until the next calendar day.

Do not remove, archive or alter completed-trip data. Completed trips remain available in the Trips tab and can be explicitly selected.

The preferred control placement for overriding the default is the existing POI/map-settings visibility area, not a new permanent map toolbar icon:

```text
Map visibility
[on] Show active and upcoming trip markers
[off] Show completed trip markers
```

Whether this setting is needed, and whether its default should be persisted in the existing local preferences, requires owner confirmation after Claude inspects the current controls and screenshots.

### 4.5 Marker label disambiguation

Keep the compact itinerary label on the map:

```text
D1·1
```

Do not place the full trip name directly in every map icon. Existing marker icons already carry type, sequence, trip colour, visit count and Side Quest indicators; adding long names would create clutter, especially on phones and for CJK names.

Use the existing trip-colour dot as a quick visual cue, but add text context wherever the user interacts:

- marker `title` and accessible name/alt should include marker name and trip name;
- marker popup should show the trip name in its metadata area;
- the selected name tag should show the marker's primary name and a secondary trip-name line when applicable;
- the popup/name tag must identify the trip in text, not colour alone.

Suggested popup hierarchy:

```text
D1·1 · Takeoff spot
Wuhan Weekend
30.61819, 114.31737
```

Suggested selected name tag hierarchy:

```text
D1·1
Wuhan Weekend
```

Keep the trip name as muted metadata, not the primary map label. Unassigned markers should not receive an empty trip line.

If markers overlap at the same coordinate, use the existing visit/stack interaction and popup/list context. Do not solve overlap by permanently lengthening every map label.

### 4.6 Upcoming and active status badges

Do not add an `Upcoming` badge to every map marker. It would compete with sequence, visit and Side Quest badges.

Use status in the Trips panel:

- trip-card header: beside the trip name and existing countdown/status;
- POI trip section heading: beside the existing trip colour dot and name, if useful after visual review.

Examples:

```text
● Wuhan Weekend   Upcoming
● Wuhan Weekend   Active
```

The existing `Past trips` grouping may be sufficient for completed trips; do not add redundant badges without screenshot evidence.

## 5. Owner decisions required before implementation

Claude must present one consolidated decision set and wait for explicit answers before editing code.

Recommended defaults:

1. **Trip-view entry point:** existing `Show markers` becomes the temporary selected-trip map view.
2. **Trip-card body:** remains navigation to trip details; it does not silently change map visibility.
3. **POI tab transition:** clears the temporary map filter and restores global visibility; preserves the POI list filter unless testing shows confusion.
4. **Completed trips:** hidden by default only in global map view; explicitly selected completed trips remain visible.
5. **Completed-trip override:** place in existing POI/map visibility settings; add only if the default cannot be understood or users need historical map access.
6. **Map labels:** compact sequence label plus trip colour dot; trip name appears in popup, selected name tag and accessible label.
7. **Status badges:** show Upcoming/Active in Trips cards and possibly POI trip headings; no status badge on map icons.
8. **Status wording:** use `Upcoming`, `Active`, `Completed` and `Undated`, with existing countdown/date details where available.

Claude should confirm whether these defaults fit the current HEAD and screenshots, identify any conflicts, and ask only the questions needed to resolve material ambiguity.

## 6. Edge cases

- A selected trip has no markers.
- A selected trip contains only completed markers.
- A trip is deleted while it is the active map view.
- A marker is retagged into or out of the active trip.
- A shared trip changes while its markers are being displayed.
- `hideTrips` is on while a trip-specific view is requested.
- A trip is manually hidden through `tripHidden` but explicitly selected.
- The selected marker belongs to a trip that is then filtered out.
- A marker has no trip, has no date, or is a private Home/residence marker.
- Two trips have identical names.
- Two trips contain the same sequence label.
- Long trip names, CJK text and narrow phone widths.
- Side Quests are folded, expanded, selected or connected to a hidden parent.
- POI list filters, search and map visibility must remain independent.
- Keyboard navigation, screen-reader names, touch targets, light/dark themes and reduced motion.
- The user opens the Trips tab on a phone where the map is partly or fully covered by the sheet.

## 7. Likely implementation shape

Prefer minimal changes around existing APIs:

- add temporary map-view state and a public setter/clearer in `poi-ui.js`;
- make `shownOnMap()` and related route/link predicates account for that state;
- expose a tab-change hook or use the existing `panel.onChange` contract to clear the temporary map view on POI-tab activation;
- update `trips-ui.js` actions and selected-state semantics;
- reuse `tripStatus`/date helpers rather than adding a second date calculation;
- extend popup/name-tag accessible metadata and secondary trip context;
- add completed-trip policy only after deciding whether it belongs in the existing `hideTrips`/preference model or a separate local preference;
- use existing CSS tokens, badge styles, trip dots and responsive rules;
- update documentation only after behavior is implemented and verified.

Do not change marker storage, GeoJSON shape, shared-trip schema, database migrations or the meaning of `currentTripId`.

## 8. Tests and acceptance criteria

### Unit tests

- trip status boundaries: upcoming, active today, completed yesterday, undated;
- selected-trip filtering does not mutate persisted hidden-group preferences;
- selected completed trip overrides global completed-trip hiding;
- clearing the selected trip restores normal visibility;
- invalid/deleted active trip clears safely;
- duplicate sequence labels retain distinct trip context;
- accessible marker labels include trip names when applicable and omit empty context.

### Browser tests

- Trips card/action activates only that trip's markers;
- `Fit map` still fits the correct trip;
- switching to POI restores global map visibility;
- switching between two trips updates pins, routes, Side Quest links and selection state;
- closing/deselecting the trip restores the global view;
- completed trips are hidden/shown according to the approved policy;
- explicitly opening a completed trip reveals its markers;
- duplicate labels are disambiguated in popup/name-tag context;
- long/CJK trip names do not overflow or obscure controls;
- phone, unfolded/foldable, tablet and desktop layouts remain usable;
- light/dark themes, keyboard focus, screen-reader semantics and reduced motion remain correct;
- existing POI, visibility, trips, drag/reorder, Side Quest, popup and responsive suites remain green.

### Release checks

Run targeted suites first, then:

```text
npm run test:unit
npm test
npm run build
```

Capture representative before/after screenshots at the project's documented viewports and both themes. Record real-device, Safari and screen-reader limitations honestly.

## 9. Documentation and lifecycle

If approved and implemented:

1. Move this file to `docs/backlogs/in-progress/` with `git mv`.
2. Update the status header with the date, branch, commit/PR and execution state.
3. Update `CURRENT_STATUS.md` at each milestone.
4. Update `DESIGN.md` only with reusable, verified patterns or decisions that belong in the design system.
5. Add a concise `CHANGELOG.md` entry only once the work is released.
6. Move this file to `docs/backlogs/completed/` only after implementation, tests, documentation and authorized release/deployment evidence are complete.
7. Archive the linked handoff only after execution is no longer actionable.

## 10. Explicit non-goals

- No new backend or database work.
- No marker deletion or automatic archival.
- No change to official airspace semantics or flight-safety warnings.
- No replacement of the existing POI Explorer or Trips architecture.
- No permanent trip-name text on every map icon.
- No new tooltip framework.
- No new map toolbar button unless current controls cannot support the approved behavior.
- No automatic commit, push or production deployment authorization.
