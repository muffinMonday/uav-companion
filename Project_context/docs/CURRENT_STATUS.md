# Session Checkpoint

Updated: 2026-11-14
Task: Progression system (XP, ranks, achievements, flight sessions, Steam). **Phases 1 to 6 are built, tested, committed, pushed and deployed; the work is finished apart from the owner's set-up steps below.** Standing rule from the owner: after each finished, tested phase commit, push and deploy (hosted `db push`, function deploy, `deploy:live`) and move on without asking again (memory `commit-deploy-each-phase`); it does not cover unrelated work, live checks that create real users, or secrets.

## Read first
`docs/PROGRESSION.md` (design, rules, how to extend, owner to-do, gaps). Per-migration detail: `supabase/README.md`. Feature text: `PROJECT.md` F49 (ranks, achievements, cards, map ring), F50 (sessions), F51 (Steam). Module map: `MODULES.md`.

## State
- Branch `main`, clean and pushed (last code commit `f16aa66`; the handover commit that follows it changes docs only). Hosted Supabase project has all migrations through `20261114140000_steam.sql` and the functions `delete-account`, `steam-link`, `steam-sync`, `steam-sync-all`. Front end published with `deploy:live` after phase 6.
- Phases and commits: 1 ledger/ranks/roles `9470fd0`; 2 achievements `e2408b6`; 3 read API, cards `de1e8b8`; 4 map rank ring `047bdaa`; 5 sessions/RSVP/attendance `d079a94`; 6 Steam `f16aa66`.
- Tests: full `npm test` passed after phase 6 (38 unit + 54 browser suites, about 430 s with 4 at once). `node .claude/skills/test-impact/impact.mjs` runs the affected unit suites (about 20 s).
- Steam is **switched off** (`progression_settings.steam_enabled` = 0) and was **never run against the real Steam** (no key). Unauthenticated smoke test of the deployed functions: steam-link 503, steam-sync 401, steam-sync-all 401.

## Owner to-do (blocks real use; nothing here is done)
1. Insert the first administrator row (SQL in `supabase/README.md`); until then nobody can create sessions, grant roles or adjust XP.
2. Steam: set secrets `STEAM_API_KEY`, `STEAM_STATE_SECRET`, `STEAM_CRON_SECRET`, `STEAM_RETURN_ORIGINS` (`npx supabase secrets set ... --project-ref tgptrtcuaryyyfzhrffm`), then `update public.progression_settings set value = 1 where key = 'steam_enabled';`.
3. Schedule the daily call to `steam-sync-all` with header `x-cron-secret` (pg_cron + pg_net, or a scheduled GitHub Actions workflow; snippets in `supabase/README.md`).
4. First live Steam check with a chosen account (ask before running; it creates a real link).
5. Decide: should `delete_profile` also wipe XP? (today only account deletion does).
6. Release checklist before real users (unchanged): second Supabase project for production, closed sign-ups, email confirmation, outside email sender (`DEVELOPMENT.md`).

## Not built / ideas
- Phase 7: the four real-world flying achievements need a flight-logging feature first (nothing records a flight today). Not started.
- No admin screen (XP adjust, grant/revoke role, revoke attendance outside the Sessions card are RPC/SQL); no rate limit on walk-in friend-code lookups; Sessions and Steam cards sit in the Friends tab (a tab of their own is a small change).
- Optional follow-ups carried over: try drag-reorder on a real phone; Trips-tab drop index assumes every stop of a day has an `order`.

## Findings worth keeping
- Hubei CRS unverified; licences unconfirmed (owner decision); not tested on real phones; no offline mode.
- `prefs` suite crashed once with a timeout in a 5-job run, then passed alone and under load (load flake). `live` is timing sensitive: put new checks after the movement checks, not before (see `lessons.md`).
- Full-suite wall time is about 7 minutes; run `node tests/run.mjs <words>` while iterating.

## Working State
- A dev server may be running on :5173 (browser suites need it: `npm run dev`).
- `.env.development.local` holds the project URL and publishable key (not committed). Never print the DB password, service-role key or Steam key.

## Blockers
None.

## Next Action
Ask the owner which to-do item to start. If they want more progression work: the flight-logging feature (then phase 7 achievements), an admin screen, or moving the Sessions/Steam cards to their own tabs. After any change: `/change-workflow`, `/supabase-change` for SQL, `/test-impact`, then full `npm test` before committing `src/` changes.

## Relevant Files
`Project_context/docs/PROGRESSION.md`, `supabase/migrations/20261114*.sql`, `supabase/functions/steam-*`, `supabase/functions/_shared/steam.js`, `src/progression*.js`, `src/sessions*.js`, `src/steam*.js`, `src/livemap.js` (rank ring), `src/friends-ui.js` (hosts the cards), `src/profile-popover.js`, `tests/db-progression*-unit.mjs`, `tests/db-sessions-unit.mjs`, `tests/db-steam-unit.mjs`, `tests/{progression,sessions,steam}.mjs`
