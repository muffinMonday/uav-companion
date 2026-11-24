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

## Backlog: UI/UX Review 01 (proposed, unapproved)
- `docs/backlogs/for-review/UAV_COMPANION_UI_UX_REVIEW_01_PROPOSED_BACKLOG.md`: premium redesign, four-destination shell and adaptive marker detail panel. **Revision 2 (2026-11-21) reconciled with the HTML prototype** `docs/design-references/uav_companion_review01_marker_panel_refined_v4.html`. Every item beyond S1-S9 is still PROPOSED / UNAPPROVED; open owner decisions are in its section 11 plus the G1 spec's U-13 to U-15. **S1 through S9 (marker-detail host) are merged to `main` and DEPLOYED (2026-11-22): the adaptive host is now the only saved-marker window in production**; see `CURRENT_STATUS.md`. 2026-11-22: owner expanded authorization to autonomous merge/feature-activation/deploy for the remainder of Review 01, subject to the exclusions in that status entry and memory `uiux-review01-autonomous-authorization`. **S10.2 through S10.10 (four-destination navigation shell, Map/Trips/Explore/Profile/Settings/Activity adapters, release rehearsal) are merged to `main` and DEPLOYED (2026-11-22) with `VITE_NEW_SHELL=1`: the new shell is now live in production for every visitor**; see `CURRENT_STATUS.md`. Still not authorized without further owner review: G01-G05 (Gamified Profile, Grouped Settings, Compact auth dialog, Central Activity sheet, Profile editing/data management - still UNAPPROVED content redesigns per the G1 spec), diagnostics safety-logic/state-machine changes, automatic Flight Session attendance, shared-trip authorization/sync semantic changes, route identity/cache semantic changes.
- `docs/backlogs/for-review/UAV_COMPANION_UI_UX_REVIEW_01_G1_DESIGN_SPECIFICATION.md` (2026-11-22): completes the G1 design reconciliation the main backlog left undone for everything except the marker panel — navigation shell, the rest of Map/Saved Places, Trips, Explore, Profile, Settings, Activity inbox, authentication/onboarding. Continues the main backlog's IDs (C-30+, AM-13+, U-13+) rather than renumbering them; breaks S10 into named sub-stages S10.1-S10.10. PROPOSED / UNAPPROVED; no code authorized. Needed before S10 or the G1 release gate can proceed.

## Future backlog (documentation only)
- `docs/COMMUNITY_FLYING_AREAS_PLAN.md`: approved product specification for locally saved, admin-reviewed community polygons. **Planned, not implemented**; its file paths should follow the component convention above. Do not start it, commit, push or deploy without owner authorization.

## Completed backlog: Flight Sessions 2.0
- `docs/backlogs/completed/FLIGHT_SESSIONS_2_PLAN.md`: product decisions, schema, phases and tests. Released 2026-11-14 (`a387936`, `0d4257b`, `7690262`; public sessions on).
- Its autonomous-execution handoff is archived at `docs/handoffs/archived/FLIGHT_SESSIONS_2_AGENT_HANDOFF.md`. Its authorization was for that feature only and has expired.
- Keep Community Flying Areas separate.

## Backlog: Flight Sessions Map Explorer
- `docs/backlogs/completed/FLIGHT_SESSIONS_MAP_EXPLORER.md`: product and acceptance spec for the non-modal sessions explorer (left dock or bottom sheet beside the interactive map, card selection that centres the marker in the free map area, outlined Map / Navigate / Details actions, matching outlined buttons in marker and point-check windows). Frontend, tests and docs only; no database change. **Released 2026-11-14** (`267da83`, pushed, deployed with `deploy:live`); status is in its "Implementation status" section and in `CURRENT_STATUS.md`.

## Backlog: POI Explorer & Marker Taxonomy
- `docs/backlogs/completed/POI_EXPLORER_BACKLOG.md`: spec and per-phase status (16 marker types, folded Add a marker and grouped picker, folding saved list, search, per-trip map visibility, hints). **Released 2026-11-14**: commits `a32388a` to `db00049`, merged in `0e706d8`, pushed and deployed with `deploy:live` (no database change). Residual risk accepted at deploy: an older app version re-saves a newer marker type as Other in a shared trip (see its section 12).

## Backlog: UX & Discoverability
- `docs/backlogs/completed/UX_DISCOVERABILITY_BACKLOG.md`: product and acceptance spec for the expandable labelled map toolbar, optional Quick Setup orientation, once-per-feature contextual hints, and task shortcuts in the dashboard Help card. Frontend, tests and docs only; no database change. **Released 2026-11-14**: commits `442ab90`, `8a64226`, `f89ef41`, merged in `b96657a`, deployed with `deploy:live`; status is in its "Implementation status" section and in `CURRENT_STATUS.md`.

## Backlog: Dashboard, Toolbar & Visual Refinement
- `docs/backlogs/completed/DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md`: two-wave visual spec. **Completed 2026-11-15.** Wave 1 (`4015de5`) and Wave 2 Trips and panel header (`0df811e`) were released on 2026-11-14; Wave 2 P2 and P3 were released 2026-11-15 (`99607ef`, merge `bd9b948`, deployed; evidence in its section 16; design record `DESIGN.md` sections 20 to 22). Residual risks are listed in its header.

## Backlog: Trip Marker Map Visibility
- `docs/backlogs/completed/TRIP_MARKER_MAP_VISIBILITY_AND_DISAMBIGUATION_BACKLOG.md`: trip-only map view, completed-trip policy, trip text on name tag and pin labels. Frontend only. Status and evidence in its section 11 and `CURRENT_STATUS.md`.

## Backlog: Mascot and Personality Integration
- `docs/backlogs/in-progress/MASCOT_PERSONALITY_INTEGRATION.md`: app icon, manifest, mascot on the splash, dashboard greeting, Help and three empty states. Phase 3 (thumbs-up) deferred (no server signal; section 11). Owner authorized commit, push and one `deploy:live` for this work only.

## Backlog: Flight Sessions Discover, Previews, People and Automatic Attendance
- `docs/backlogs/completed/FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG.md`: Today filter, tile-grid previews, participant list with Add friend, automatic attendance. **Completed 2026-11-15 with Wave E descoped by the owner** (more time needed to review the automatic-attendance architecture). Waves A, B1, B2, C, D are released (evidence in its section 14); `auto_attendance_enabled` stays 0 on the hosted project, so no automatic XP exists, and it must not be set to 1 without a new owner-approved plan. Residual risks in its section 13. The earlier commit/push/migration/deploy authorization was for waves A to D and has expired.

## Backlog: Automated Motor Diagnostics
- **ESC identification and workspace redesign 2026-11-17 (owner):** automatic read-only 4-way ESC identification is a default powered step; the manual ESC selector and model field are gone; the workspace and lab use the app's own styles and components. The 4-way step is **not enabled for real hardware** (build switch `VITE_BENCH_FOURWAY`, default off; blocker and the owner's check in `docs/MOTOR_DIAGNOSTICS_FOURWAY_IDENTIFICATION.md`). Not authorized: enabling it for hardware, any other 4-way command, MSP reboot.
- **User-facing beta 2026-11-17 (owner):** dashboard card and `/motor-diagnostics/` exist only in a build with `VITE_BENCH_PHASE3=1` (the kill switch); safety posture unchanged; deploy, allowlist or cap changes need the owner. See backlog section 0 and `docs/MOTOR_DIAGNOSTICS_LIVE_ANALYSIS.md` section 9.
- **Scope pivot 2026-11-17 (owner):** Blackbox decoding and flight-log analysis are **Deferred — not proportionate to pursue at present**; the current direction is the live MSP/DShot bench analysis (backlog section 0; `docs/MOTOR_DIAGNOSTICS_LIVE_ANALYSIS.md`). Blackbox gates and `MOTOR_TEST` are no longer bench requirements. The workspace stays behind `VITE_BENCH_PHASE3`; no unflagged entry, no deployment without owner approval.
- `docs/backlogs/in-progress/UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md`: **sole authoritative specification** (Addendum 1 merged 2026-11-16). `..._ADDENDUM_1.md` is superseded decision history; `..._PHASE0_RESEARCH.md` is evidence. Hazard analysis (mandatory Phase 3 entry gate): `docs/MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md`. Active handoff: `docs/handoffs/active/MOTOR_DIAGNOSTICS_PHASE1_2_HANDOFF.md`.
- **Authorized:** read-only Phase 1 and Phase 2. The lab page (`/tools/preflight-spike/`) is live with the build flag on by owner decision (2026-11-16, sole user); the main app stays unchanged. **Not authorized:** motor commands, CLI, configuration writes, log erasure, reflashing, 4-way interface, Phase 3, further deployment without owner instruction. No UI or report may claim "safe to fly", airworthiness, certification or definitive diagnosis. No UI or report may claim "safe to fly", airworthiness, certification or definitive diagnosis.

## Completed backlog: Malaysia airspace (ENR 5.1)
- `docs/backlogs/completed/MALAYSIA_AIRSPACE_ENR51_BACKLOG.md`: P/R/D areas for Malaysia, released 2026-11-24 (second pass 2026-11-24: 57 of 86 Malaysian-administered (SG and Brunei excluded)). Authorization was for that release only. Details in `docs/regions/my-enr51.md`.

## Completed backlog: Vietnam airspace (ENR 5.1)
- Vietnam P/R/D areas (VVP/VVR/VVD) from AIP Viet Nam ENR 5.1, 2026-10-01-AIRAC; released 2026-11-24 (71 of 74 areas; VVR19, VVD43, VVD45 unresolved). Authorization was for that release only. Details in `docs/regions/vn-enr51.md`.

## Backlog: Route Visualization & Driving Navigation Rework
- `docs/backlogs/in-progress/ROUTE_NAVIGATION_REWORK_BACKLOG.md`: approved spec and implementation status (driving-route bands with chevrons, always-on labels, HeiGIT routing through the `route-leg` edge function with a shared-trip cache, overlap lanes, coincident-marker fan, base-reference links kept straight). **Implemented and committed on `main` (not pushed unless stated in `CURRENT_STATUS.md`); not deployed, migration not applied, HeiGIT secret not set.** Deploying, applying `20261121100000_trip_routes.sql` or setting `HEIGIT_API_KEY` needs the owner. Source: `src/route/`, `src/spider.js`, `supabase/functions/route-leg/`.
