# Session Checkpoint

Updated: 2026-11-16 (logging work added at the top of "Latest work")
Task: Progression system (XP, ranks, achievements, flight sessions, Steam). **Phases 1 to 6 are built, tested, committed, pushed and deployed; the work is finished apart from the owner's set-up steps below.** Standing rule from the owner: after each finished, tested phase commit, push and deploy (hosted `db push`, function deploy, `deploy:live`) and move on without asking again (memory `commit-deploy-each-phase`); it does not cover unrelated work, live checks that create real users, or secrets.

## Latest work: local logging, error handling and audit trail (F53; built, tested (full npm test 435 s), committed `629fc86`, pushed, deployed 2026-11-13: migration pushed, four functions deployed, deploy:live run by the owner, live check passed)
- Owner-approved design (no Sentry, no remote service, $0): plan file `C:/Users/cy071/.claude/plans/golden-singing-flurry.md` plus decisions in `DECISIONS.md` (2026-11-13 entries). Three milestones, each tested on its own, then the full suite.
- M1 front end: `src/log.js`, `logscrub.js`, `logstore.js`, `errors.js`; `console.*` replaced; `createBackoff({name})` logs failure streaks; about 12 silent network/behaviour catches now log (presence, live, party, sync engine, search, trips, steam-ui, main); global handlers observe only. Tests: `logscrub-unit`, `logstore-unit`, browser `diag`.
- M2 backend: migration `supabase/migrations/20261116120000_audit_events.sql` (append-only `audit_events`, in-transaction events, tombstone, `admin_audit_events`, reason codes, settings trigger); `supabase/functions/_shared/log.js`; `delete-account` returns fixed messages and codes; Steam handlers log classified failures. Tests: `db-audit-unit`, additions in `db-steam-unit`, `db-sessions-unit`, `edgelog-unit`.
- M3: Diagnostics card in the privacy settings (`index.html`, `src/privacy-ui.js`), docs (README, DATABASE, DECISIONS, MODULES, PROJECT F53, CHANGELOG, lessons).
- **Deployed and checked (2026-11-13):** `20261116120000` is on the hosted project (a dry run listed only it; anon gets 42501 on `audit_events` and `admin_audit_events`, and `audit_log` is not exposed); `delete-account`, `steam-link`, `steam-sync`, `steam-sync-all` deployed (unauthenticated POST gives 401 on the three that were called); the live site serves the new bundle (Diagnostics card and the `uavzones-log` store are in the published files). **Real-account check run (2026-11-13, `node tests/audit-live.mjs`, two throwaway users, 19 checks passed):** a non-admin is refused; a real grant and revoke are recorded once each and read back by an administrator through `admin_audit_events` (friend codes, no ids); the deployed `delete-account` refuses a wrong word (400) and deletes both users (200), each adding one tombstone; afterwards no audit row names either user, the grant and revoke remain anonymised. It left permanent rows (append-only): 1 grant, 1 revoke, 2 `profile.delete` tombstones. Not exercised: a real Steam sync's log lines in the dashboard, a real attendance revoke, the settings trigger on the hosted project.
- Not verified: the log on a real phone; function log lines in the Supabase dashboard; free-plan limits are quoted from memory.

## Earlier: delete_profile wipes progression (done: commit 82067c6 pushed, migration 20261116110000 applied to the hosted project, deploy:live run, 2026-11-16; full npm test passed 423 s before the commit; not yet run against a real account)
- Owner decision 2026-11-16. Migration `20261116110000_delete_profile_wipes_progression.sql`: `delete_profile` also deletes XP ledger and total, achievements, featured, counters, attendance, Steam link and totals; roles and `steam_credited` stay. Ledger and achievement guards allow it through the transaction-local setting `uavzones.wipe_user` (honoured only when the calling role is not anon/authenticated/service_role). Confirm text in `src/friends-ui.js` now says XP etc. are wiped. Tests: `db-sessions-unit`, `db-steam-unit` extended. Docs updated.
- Owner state: first administrator row was crafted (user c9c57639-...), not confirmed run. Release checklist (to-do 6: second project, closed sign-ups, email confirmation, mail sender) is ON HOLD (owner, 2026-11-16).

## Dark/light/system theme (done: phases 1 to 5 committed, pushed, deployed; commits a1170e1, 9e679b6; full npm test passed 433 s)
- Built as planned (plan file `C:/Users/cy071/.claude/plans/i-want-to-finish-wondrous-globe.md`): `src/theme.js`, Appearance card, one dark CSS block, `baseTiles()` + CSS filter on the base layer, theme in the `user_data` document (last choice wins, `baseSig`, no chooser). Docs: PROJECT F52, DATABASE, DECISIONS, MODULES, CHANGELOG.
- Verified on the hosted project (2026-11-13, `node tests/cloud-live.mjs`, throwaway user): the `settings:doc->settings` select and that `save_user_data` keeps `settings`. The two-device engine flow is tested against the in-memory cloud only. Not verified: filter cost on a weak phone or rotated map; signed-in account/friends panes in dark (no screenshot). While a question is open nothing about the theme syncs.
- Owner state: first-administrator row and the release checklist as before.

## Earlier: Steam credits existing hours (done: commit 3ac7eb6 pushed, migration pushed, deploy:live run, 2026-11-16)
- Owner decision 2026-11-13: hours played before linking count (full, no cap beyond the 500 h per sync pace), paid out once per Steam account: unlink keeps the stored totals, and the new table `steam_credited` keeps the highest total ever counted per Steam account and game. Migration `20261116100000_steam_existing_hours.sql` (new column `steam_links.state_steam_id`, new table `steam_credited`; for existing links with nothing earned the stored totals are deleted so the next sync credits everything), card text in `src/steam-ui.js`, tests `db-steam-unit` (102) and browser `steam` (23) pass, docs updated (PROGRESSION, PROJECT F51, DECISIONS, DATABASE, supabase/README).
- Steam is live on the hosted project: four secrets set, `steam_enabled` on, workflow `.github/workflows/steam-daily.yml` (daily 03:00 UTC, needs repo secret STEAM_CRON_SECRET, added) pushed in `b2e86a9`. The owner linked their account on prod (baseline, 0 hours); after the migration is pushed their next Sync now should credit about 265 h (2,650 XP).
- Full `npm test`: all passed except `sessions` (RSVP present, a race that also failed on the old code; fixed with a wait-for, passes alone). Owner to do: press Sync now on the Steam card (cooldown on the row was cleared by SQL) and check about 265 h / 2,650 XP are credited, then run the workflow once by hand (Actions, Run workflow; expect HTTP 200). Not verified yet: the first real sync, the migration's seeding of steam_credited for existing links (only the owner exists, with nothing earned).

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
2. (DONE 2026-11-13) Steam: set secrets `STEAM_API_KEY`, `STEAM_STATE_SECRET`, `STEAM_CRON_SECRET`, `STEAM_RETURN_ORIGINS` (`npx supabase secrets set ... --project-ref tgptrtcuaryyyfzhrffm`), then `update public.progression_settings set value = 1 where key = 'steam_enabled';`.
3. (DONE: workflow steam-daily.yml, b2e86a9; run it once by hand) Schedule the daily call to `steam-sync-all` with header `x-cron-secret` (pg_cron + pg_net, or a scheduled GitHub Actions workflow; snippets in `supabase/README.md`).
4. (Linked on prod 2026-11-13; first credit pending Sync now) First live Steam check with a chosen account (ask before running; it creates a real link).
5. (DONE 2026-11-16) `delete_profile` wipes XP too.
6. ON HOLD (owner, 2026-11-16) Release checklist before real users (unchanged): second Supabase project for production, closed sign-ups, email confirmation, outside email sender (`DEVELOPMENT.md`).

## Not built / ideas
- **ON HOLD (owner, efficiency review): retention job with pg_cron.** Purge stale `live_locations` (rows are only purged inside `share_location`, so they stay when nobody sends), `user_data_versions` and `shared_trip_versions` older than 30 days (pruned only on write, so inactive users keep 20 versions), and then drop the purge from `share_location`. Not started: revisit with real users or a second Supabase project. Interim: the `share_location` purge is indexed and runs about 1 call in 20.
- **Efficiency review work: read `docs/EFFICIENCY.md` first (findings, status of each, measured results, what is left).** Owner approved, retention job excluded; built, tested, pushed and deployed (migrations pushed, functions and front end deployed). Summary:  1 client robustness (`src/backoff.js`: back-off with jitter, no overlapping polls, offline pause, `SIGNED_OUT` noticed, one friends/profile load at a time). 2 migration `20261115100000_efficiency.sql` (date columns, `live_active`, cheap position clean-up, indexes). 3 adaptive polling (live poll only while `live_active` > 0; trip poll 10 s -> 20 s -> 30 s when quiet; `eng.nudge()` on return to the page). 4 `20261115110000_version_coalesce.sql` (autosave bursts keep one version) and server-applied shared changes upload to the cloud copy 30 s later. 5 `20261115120000_steam_queue.sql` (batched hours, attempt-ordered daily list) and `steam-sync-all` 5 at a time with a 100 s budget. `scripts/loadtest.mjs` written (see `DEVELOPMENT.md`), **not run**: it creates real throwaway users on the hosted project (free tier: capped at 50 users, throttled seeding, stops itself on errors, cleans up on Ctrl-C), ask first. **Load test run (2026-11-15, hosted free-tier Nano, 0 errors in every run, p50 about 95 ms):** 10 users live 3 min 3.9 req/s; 25 users live 5 min 9.8 req/s (adaptive 7.8, -20%: every party had a sharer); 25 users idle 3 min 8.8 req/s -> adaptive 3.3 req/s (-63%; live poll -99%, trip poll -28% in 3 min). Egress rose about 6 MB for the 10-user run. Month-to-date budget rule: stop test runs if egress passes about 10% of the 5 GB. Not measured: server CPU/RAM per run (dashboard only: CPU stayed 2-4%, RAM 63-65% before), 50 users, the mixed scenario, `EXPLAIN` on realistic data. Remaining request floor for an idle adaptive user: presence 2/min, friends + sessions 1/min, trip poll 2-6/min.
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
Efficiency follow-ups are listed in `docs/EFFICIENCY.md` ("Still to do"); the progression to-do list above is unchanged. Ask the owner which to start. If they want more progression work: the flight-logging feature (then phase 7 achievements), an admin screen, or moving the Sessions/Steam cards to their own tabs. After any change: `/change-workflow`, `/supabase-change` for SQL, `/test-impact`, then full `npm test` before committing `src/` changes.

## Relevant Files
`Project_context/docs/PROGRESSION.md`, `supabase/migrations/20261114*.sql`, `supabase/functions/steam-*`, `supabase/functions/_shared/steam.js`, `src/progression*.js`, `src/sessions*.js`, `src/steam*.js`, `src/livemap.js` (rank ring), `src/account-ui.js` (account pane: Progression, Steam), `src/friends-ui.js` (Sessions card), `src/profile-popover.js`, `tests/db-progression*-unit.mjs`, `tests/db-sessions-unit.mjs`, `tests/db-steam-unit.mjs`, `tests/{progression,sessions,steam}.mjs`
