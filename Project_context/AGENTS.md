# AGENTS.md: UAV Companion
Vite + Leaflet JS app; static hosting plus optional Supabase (accounts, friends, shared trips).

**Start:** read only `CLAUDE.md`, this file, `docs/CURRENT_STATUS.md`, `docs/SMALL_FIXES.md`; run `git status`, `git log -3`; reconcile the checkpoint with them before editing. Never discard uncommitted work.

**Load on demand (`docs/`):** DESIGN (UI tokens, component rules, screenshot baseline: read before any styling change), ARCHITECTURE (design, auth, flows), MODULES (code map), DATABASE (storage, Supabase, RLS), DEVELOPMENT (setup, tests, deploy), DECISIONS (why), PROJECT (features; large: grep the section), EFFICIENCY (polling, load test results, open items), PROGRESSION (XP, ranks, achievements, sessions, Steam: rules, how to extend, owner to-do). CHANGELOG: never at start.

**Skills (`.claude/skills/`):** `/change-workflow` for code changes, `/test-impact` to pick unit suites, `/supabase-change`, `/region-data`.

**Rules**
- Source code beats docs; fix a wrong doc in the same change; link, don't copy.
- Validate all stored/imported/shared data; DOM via `el()`/`textContent`. Nothing user-specific leaves the browser unless opted in; Home marker never shared. Keep `uavzones.` keys; shape change = version bump + `DATABASE.md` note.
- DB writes only via SQL functions, RLS on every table, new migration files only. Never commit secrets or `.env*.local`.
- Dates in docs are calendar dates from `git log` / `date`, never copied from a migration file name (those run ahead).
- Minimal root-cause changes. `npm run test:unit`; `npm test` (app on :5173) before committing `src/`, `index.html`, `public/ai/` changes; read results before saying done.
- Ask before commit, push or `npm run deploy`.

**Context:** update `CURRENT_STATUS.md` at each milestone and before stopping or clearing; say "saved" only after editing it. At about 65% context, finish the step and checkpoint; above 75%, no new large work. Claude cannot run `/clear`: checkpoint, then tell the user to run `/clear` (auto-compaction is fine; the checkpoint is the recovery source). Finished history goes to CHANGELOG, decisions to DECISIONS. Final message of a session: done, state, remaining, blockers, files, test results, next action.

## Backlog lifecycle and documentation hygiene

All backlog and implementation-plan Markdown files belong under:

- `docs/backlogs/for-review/` — proposed or approved specifications awaiting implementation, owner decisions, or execution authorization.
- `docs/backlogs/in-progress/` — actively being implemented, tested, reviewed, or deployed.
- `docs/backlogs/completed/` — implementation and agreed release work are complete, with tests and deployment/release status recorded.

When a backlog changes lifecycle state:

1. Move the Markdown file to the correct lifecycle folder with `git mv`.
2. Update every repository reference to its new path, including `AGENTS.md`, `CURRENT_STATUS.md`, `CHANGELOG.md`, README files, handoff prompts, and related documentation.
3. Update the backlog header with:
   - current status;
   - date of the status change;
   - relevant commit, PR, branch, deployment or release evidence;
   - tests and verification completed;
   - known residual risks or deferred items.
4. Update `CURRENT_STATUS.md` immediately if the change affects the active work state.
5. Add a concise entry to `CHANGELOG.md` when the backlog reaches a released/completed state.
6. Do not mark a backlog completed merely because code exists. Confirm the implementation, relevant tests, documentation, and—where applicable—authorized deployment or release evidence.
7. Do not silently delete historical status information. Preserve it in the backlog’s status history or in `CHANGELOG.md`.
8. Source code, tests and deployment records take precedence over stale backlog wording. Correct stale documentation in the same documentation-only change.
9. A backlog may remain in `completed/` with an explicit residual-risk section. Residual risks do not require reopening the backlog unless they represent unfinished scope.
10. Do not move or rewrite backlog files during feature implementation unless the lifecycle change is part of the approved task.

## Handoff documents

Handoff prompts are separate from backlog specifications.

Store actionable handoffs under `docs/handoffs/active/` and completed, superseded or no-longer-actionable handoffs under `docs/handoffs/archived/`.

Every handoff must link to its related backlog. Moving a backlog between lifecycle folders does not automatically mean its handoff is complete: update or archive the handoff only when its execution instructions are no longer needed.

When a backlog is completed, archive its handoff and update all references. Archived handoffs keep a status header with the date, release evidence and a link to the related backlog.

## UI and startup map
For any UI change, find the owner in `docs/MODULES.md` ("Component ownership map": feature -> HTML fragment -> JS -> CSS -> suites) before opening `index.html` or `main.js`. `index.html` is a shell; fragments are in `src/components/`; startup responsibilities are in `src/app/`. Refactor history: `docs/backlogs/completed/HTML_MAIN_REFACTOR_BACKLOG.md`.

## Future backlog (documentation only)
- `docs/COMMUNITY_FLYING_AREAS_PLAN.md`: approved product specification for locally saved, admin-reviewed community polygons. **Planned, not implemented**; its file paths should follow the component convention above. Do not start it, commit, push or deploy without owner authorization.

## Completed backlog: Flight Sessions 2.0
- `docs/backlogs/completed/FLIGHT_SESSIONS_2_PLAN.md`: product decisions, schema, phases and tests. Released 2026-11-14 (`a387936`, `0d4257b`, `7690262`; public sessions on).
- Its autonomous-execution handoff is archived at `docs/handoffs/archived/FLIGHT_SESSIONS_2_AGENT_HANDOFF.md`. Its authorization was for that feature only and has expired.
- Keep Community Flying Areas separate.

## Backlog: Flight Sessions Map Explorer
- `docs/backlogs/completed/FLIGHT_SESSIONS_MAP_EXPLORER.md`: product and acceptance spec for the non-modal sessions explorer (left dock or bottom sheet beside the interactive map, card selection that centres the marker in the free map area, outlined Map / Navigate / Details actions, matching outlined buttons in marker and point-check windows). Frontend, tests and docs only; no database change. Owner authorized implementation, commit, push and `deploy:live` for this feature only (2026-11-14); status is in its "Implementation status" section and in `CURRENT_STATUS.md`.

## Backlog: POI Explorer & Marker Taxonomy
- `docs/backlogs/completed/POI_EXPLORER_BACKLOG.md`: spec and per-phase status (16 marker types, folded Add a marker and grouped picker, folding saved list, search, per-trip map visibility, hints). Implemented locally in eight commits (2026-11-14); **not pushed or deployed**; owner decision on the old-client downcast risk is required first (see its section 12).

## Backlog: UX & Discoverability
- `docs/backlogs/completed/UX_DISCOVERABILITY_BACKLOG.md`: product and acceptance spec for the expandable labelled map toolbar, optional Quick Setup orientation, once-per-feature contextual hints, and task shortcuts in the dashboard Help card. Frontend, tests and docs only; no database change. Owner authorized implementation, commit, push and `deploy:live` for this feature only (2026-11-14); status is in its "Implementation status" section and in `CURRENT_STATUS.md`.

## Backlog: Dashboard, Toolbar & Visual Refinement
- `docs/backlogs/completed/DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md`: two-wave spec. **Wave 1** (focused dashboard, Help subview, More tools, Sessions cards, single Navigate, legends) is committed and deployed (`4015de5`). **Wave 2** (section 12) was run on a separate owner prompt for Trips and the shared panel header only (section 16); Map Config and POI were audited and left unchanged; P2 and P3 remain backlog and need a new owner prompt.
