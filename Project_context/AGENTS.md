# AGENTS.md: UAV Companion
Vite + Leaflet JS app; static hosting plus optional Supabase (accounts, friends, shared trips).

**Start:** read only `CLAUDE.md`, this file, `docs/CURRENT_STATUS.md`, `docs/SMALL_FIXES.md`; run `git status`, `git log -3`; reconcile the checkpoint with them before editing. Never discard uncommitted work.

**Load on demand (`docs/`):** ARCHITECTURE (design, auth, flows), MODULES (code map), DATABASE (storage, Supabase, RLS), DEVELOPMENT (setup, tests, deploy), DECISIONS (why), PROJECT (features; large: grep the section), EFFICIENCY (polling, load test results, open items), PROGRESSION (XP, ranks, achievements, sessions, Steam: rules, how to extend, owner to-do). CHANGELOG: never at start.

**Skills (`.claude/skills/`):** `/change-workflow` for code changes, `/test-impact` to pick unit suites, `/supabase-change`, `/region-data`.

**Rules**
- Source code beats docs; fix a wrong doc in the same change; link, don't copy.
- Validate all stored/imported/shared data; DOM via `el()`/`textContent`. Nothing user-specific leaves the browser unless opted in; Home marker never shared. Keep `uavzones.` keys; shape change = version bump + `DATABASE.md` note.
- DB writes only via SQL functions, RLS on every table, new migration files only. Never commit secrets or `.env*.local`.
- Minimal root-cause changes. `npm run test:unit`; `npm test` (app on :5173) before committing `src/`, `index.html`, `public/ai/` changes; read results before saying done.
- Ask before commit, push or `npm run deploy`.

**Context:** update `CURRENT_STATUS.md` at each milestone and before stopping or clearing; say "saved" only after editing it. At about 65% context, finish the step and checkpoint; above 75%, no new large work. Claude cannot run `/clear`: checkpoint, then tell the user to run `/clear` (auto-compaction is fine; the checkpoint is the recovery source). Finished history goes to CHANGELOG, decisions to DECISIONS. Final message of a session: done, state, remaining, blockers, files, test results, next action.
