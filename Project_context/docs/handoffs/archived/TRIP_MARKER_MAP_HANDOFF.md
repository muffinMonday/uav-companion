# Claude Handoff — Trip Marker Map Visibility and Disambiguation

**Status: ACTIVE — discussion first; implementation is not yet authorized.**

**Prepared:** 2026-11-15

**Related backlog:** [`../../backlogs/for-review/TRIP_MARKER_MAP_VISIBILITY_AND_DISAMBIGUATION_BACKLOG.md`](../../backlogs/for-review/TRIP_MARKER_MAP_VISIBILITY_AND_DISAMBIGUATION_BACKLOG.md)

Use the linked backlog as the product and UX specification. This handoff is an execution guide, not permission to commit, push or deploy.

## Mission

Review, discuss and eventually implement the trip-marker map visibility and disambiguation improvements described in the related backlog:

- temporary map isolation when a trip is explicitly viewed;
- restoration of global map visibility when the trip view is cleared or the POI tab is opened;
- text-based trip context for otherwise duplicate compact marker labels;
- default handling of completed trips;
- upcoming/active status presentation in the Trips and POI panels.

## Phase 0 — Reconcile before editing

Read, in this order:

1. `CLAUDE.md`
2. `Project_context/AGENTS.md`
3. `Project_context/docs/CURRENT_STATUS.md`
4. `Project_context/docs/SMALL_FIXES.md`
5. `Project_context/docs/DESIGN.md`
6. `Project_context/docs/MODULES.md`
7. `Project_context/docs/DECISIONS.md` sections relevant to POI, Trips and map visibility
8. the related backlog in `docs/backlogs/for-review/`

Then inspect:

- `git status`
- `git log -3 --oneline`
- current branch and remote state;
- `src/poi-ui.js`, especially marker creation, `shownOnMap()`, visibility application, routes, Side Quest links, popups and public POI APIs;
- `src/trips-ui.js` and `src/trips.js`;
- `src/panel.js` and the POI/Trips component fragments;
- existing POI/trip visibility, popup, responsive and screenshot tests.

Never discard uncommitted work. Do not assume GitHub's default branch represents the user's local HEAD.

## Phase 1 — Discussion and decision gate

Do not modify application code yet.

Produce a concise review that:

1. confirms whether the proposed architecture still matches the current HEAD;
2. identifies the exact current behavior and source owners;
3. explains how the temporary active-trip map state can coexist with `currentTripId`, `hideTrips`, `tripHidden` and `unassignedHidden`;
4. identifies any conflicts with POI list filtering, Side Quests, routes, map popups, shared trips or mobile sheets;
5. reviews current screenshots or creates a small baseline if the local test harness supports it;
6. confirms the placement of each proposed control and status element;
7. asks one consolidated set of material owner decisions, using the backlog's recommended defaults;
8. presents a bounded implementation plan and test-impact list.

Wait for explicit owner approval of the decisions and implementation scope before editing code.

## Phase 2 — Implementation after approval

After explicit approval:

1. Move the backlog from `docs/backlogs/for-review/` to `docs/backlogs/in-progress/` with `git mv`.
2. Update the backlog status header and `CURRENT_STATUS.md`.
3. Implement the smallest coherent slice, preserving the existing plain-DOM and Leaflet architecture.
4. Keep temporary map-view state separate from persisted map visibility preferences and `currentTripId`.
5. Reuse existing `tripStatus`, `trip-dot`, badge, popup, name-tag, panel and CSS token patterns.
6. Do not add permanent map controls or long trip names to every marker icon.
7. Add regression tests before broad visual refinement.
8. Run targeted tests after each slice and inspect both themes and documented responsive viewports.
9. Update `DESIGN.md`, `MODULES.md` or `CURRENT_STATUS.md` only when the implementation creates a verified reusable pattern or changes documented ownership/behavior.

## Required acceptance behavior

- Viewing one trip isolates its markers, routes and Side Quest links.
- Clearing that view or opening POI restores global visibility.
- Persisted hidden-group settings are not rewritten by temporary trip viewing.
- Completed trips are hidden globally only if the approved policy says so, but explicitly selected completed trips remain viewable.
- Duplicate compact labels reveal the trip name in popup, selected name tag and accessible metadata.
- The map remains compact; trip status belongs in the Trips/POI UI, not on every map pin.
- Existing POI, Trips, Side Quest, route, drag, popup, accessibility and responsive behavior remains intact.

## Verification

Run the impacted suites first. Before claiming completion, run the required project checks:

```text
npm run test:unit
npm test
npm run build
```

Use the project's `/test-impact` workflow where available. Capture and inspect representative light/dark screenshots at the documented desktop, tablet, phone and short-landscape sizes. Report untested real-device, Safari and screen-reader behavior.

## Commit, push and deployment boundary

This handoff does not authorize commit, push, merge, PR creation or production deployment.

After implementation and verification, stop with:

- files changed;
- exact behavior implemented;
- tests and build results;
- screenshots/visual checks;
- remaining risks;
- suggested commit message;
- the exact authorization still required for commit, push and `npm run deploy:live`.

Only proceed with commit, push or deployment after the owner provides explicit authorization for this backlog. Do not inherit authorization from completed POI, Trips, dashboard or Flight Sessions work.
