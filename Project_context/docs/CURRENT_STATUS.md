# Session Checkpoint

Updated: 2026-11-14 (late)
Task: Progression system (XP, ranks, achievements, flight sessions, Steam). **Phases 1 to 6 are built, tested, committed, pushed and deployed; the work is finished apart from the owner's set-up steps below.** Standing rule from the owner: after each finished, tested phase commit, push and deploy (hosted `db push`, function deploy, `deploy:live`) and move on without asking again (memory `commit-deploy-each-phase`); it does not cover unrelated work, live checks that create real users, or secrets.

## Latest work: six small fixes (done; full npm test passed, 422 s)
- No keyboard on open for touch screens (`src/touch.js`: `focusField`, `showModalQuiet`; Edit profile, account pane, name/delete dialogs, splash). Edit profile: no Clear buttons, Save profile under Preview and Cancel. Preview now uses the popover body (`profileContent`), no XP history. Swipe down dismisses the profile, achievements, account and name/delete dialogs (`onDialogSwipe`, `swipe.js`). Launch fix now draws the blip (`locate.showFix`, no tracking; first button press starts tracking). No blue tap rectangle on panel tabs and the rail (CSS).
- Tests changed: `friends` (no Clear, Save position, preview body, phone keyboard and swipe), `launchloc` (blip, then tracking on press), `locatemode`. Not tested on a real phone (keyboard, finger swipes, tap highlight).

## Earlier work: profile pane (done, pushed, deployed)
- Progression and Steam cards moved from the Friends tab into the account pane (avatar popover, `account-ui.js`: collapsible sections, no email shown). Friends keeps friend code, Sessions card, requests, lists. Edit profile dialog: grouped fields, optional labels, empty-name validation, saving state, unsaved-changes confirm on Cancel/Escape. No server change.
- Commits on `main`: pane move, then editor polish; `deploy:live` run after each. Full `npm test` passed after the first; after the second only `sessions` failed once ("marking an RSVP present" reads `.ses-message` too early under load) and passed alone: a flake, worth a wait-for in that test.
- Not done: avatar upload (none exists, presets only); a unit-level test for the pane lifecycle.

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
- **ON HOLD (owner, efficiency review): retention job with pg_cron.** Purge stale `live_locations` (rows are only purged inside `share_location`, so they stay when nobody sends), `user_data_versions` and `shared_trip_versions` older than 30 days (pruned only on write, so inactive users keep 20 versions), and then drop the purge from `share_location`. Not started: revisit with real users or a second Supabase project. Interim: the `share_location` purge is indexed and runs about 1 call in 20.
- **Efficiency review work (owner approved, retention job excluded): built and tested, phases 1 to 5.** 1 client robustness (`src/backoff.js`: back-off with jitter, no overlapping polls, offline pause, `SIGNED_OUT` noticed, one friends/profile load at a time). 2 migration `20261115100000_efficiency.sql` (date columns, `live_active`, cheap position clean-up, indexes). 3 adaptive polling (live poll only while `live_active` > 0; trip poll 10 s -> 20 s -> 30 s when quiet; `eng.nudge()` on return to the page). 4 `20261115110000_version_coalesce.sql` (autosave bursts keep one version) and server-applied shared changes upload to the cloud copy 30 s later. 5 `20261115120000_steam_queue.sql` (batched hours, attempt-ordered daily list) and `steam-sync-all` 5 at a time with a 100 s budget. `scripts/loadtest.mjs` written (see `DEVELOPMENT.md`), **not run**: it creates real throwaway users on the hosted project (free tier: capped at 50 users, throttled seeding, stops itself on errors, cleans up on Ctrl-C), ask first. Phase 0/6 (baseline and re-measure with the harness, `EXPLAIN` on realistic data) are still to do.
- Full `npm test`: all passed except `poi2` once (`new position saved`, a marker-drag check unrelated to this work); it passed twice alone: a load flake.
- Phase 7: the four real-world flying achievements need a flight-logging feature first (nothing records a flight today). Not started.
- No admin screen (XP adjust, grant/revoke role, revoke attendance outside the Sessions card are RPC/SQL); no rate limit on walk-in friend-code lookups; Sessions card sits in the Friends tab.
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
`Project_context/docs/PROGRESSION.md`, `supabase/migrations/20261114*.sql`, `supabase/functions/steam-*`, `supabase/functions/_shared/steam.js`, `src/progression*.js`, `src/sessions*.js`, `src/steam*.js`, `src/livemap.js` (rank ring), `src/account-ui.js` (account pane: Progression, Steam), `src/friends-ui.js` (Sessions card), `src/profile-popover.js`, `tests/db-progression*-unit.mjs`, `tests/db-sessions-unit.mjs`, `tests/db-steam-unit.mjs`, `tests/{progression,sessions,steam}.mjs`
