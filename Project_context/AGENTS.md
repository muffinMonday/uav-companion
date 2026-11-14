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


## UI and startup map
For any UI change, find the owner in `docs/MODULES.md` ("Component ownership map": feature -> HTML fragment -> JS -> CSS -> suites) before opening `index.html` or `main.js`. `index.html` is a shell; fragments are in `src/components/`; startup responsibilities are in `src/app/`. Refactor history: `docs/HTML_MAIN_REFACTOR_BACKLOG.md`.

## Future backlog (documentation only)
- `docs/COMMUNITY_FLYING_AREAS_PLAN.md`: approved product specification for locally saved, admin-reviewed community polygons. **Planned, not implemented**; its file paths should follow the component convention above. Do not start it, commit, push or deploy without owner authorization.

## Future backlog: Flight Sessions 2.0
- `docs/FLIGHT_SESSIONS_2_PLAN.md`: product decisions, unresolved questions, schema, phases and tests.
- `docs/FLIGHT_SESSIONS_2_AGENT_HANDOFF.md`: Claude must clarify open policies and obtain explicit feature-scoped authorization before autonomously implementing, committing, pushing or deploying. This backlog is not itself authorization.
- Keep Community Flying Areas separate.

## Backlog: Flight Sessions Map Explorer
- `docs/FLIGHT_SESSIONS_MAP_EXPLORER.md`: product and acceptance spec for the non-modal sessions explorer (left dock or bottom sheet beside the interactive map, card selection that centres the marker in the free map area, outlined Map / Navigate / Details actions, matching outlined buttons in marker and point-check windows). Frontend, tests and docs only; no database change. Owner authorized implementation, commit, push and `deploy:live` for this feature only (2026-11-14); status is in its "Implementation status" section and in `CURRENT_STATUS.md`.

## Backlog: UX & Discoverability
- `docs/UX_DISCOVERABILITY_BACKLOG.md`: product and acceptance spec for the expandable labelled map toolbar, optional Quick Setup orientation, once-per-feature contextual hints, and task shortcuts in the dashboard Help card. Frontend, tests and docs only; no database change. Owner authorized implementation, commit, push and `deploy:live` for this feature only (2026-11-14); status is in its "Implementation status" section and in `CURRENT_STATUS.md`.
