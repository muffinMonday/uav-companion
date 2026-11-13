# Efficiency and scalability review (2026-11-13)

What was reviewed, what was found, what was changed, what was measured, and what is left. Source code beats this file; the numbers are from the code at commit `3f104f3` and the load runs below. **V** = verified in code, **A** = assumption (platform limits, plan shapes, real document sizes).

## Setting
- One hosted Supabase project (`tgptrtcuaryyyfzhrffm`) serves development and the live site. Free tier, **Nano** compute (shared CPU, 60 connections). No real users yet, but a small group will use it (owner, Nov 2026).
- No Realtime anywhere (V); everything is polling, only while the page is visible, no request when signed out.

## Request load per open, visible client (before the changes, V)
| Call | Pace | Source |
|---|---|---|
| `list_live_locations` | 5 s | `src/live.js` |
| `list_my_trips` | 10 s | `src/sharedtrip/engine.js` |
| `touch_presence` | 30 s | `src/presence.js` |
| `list_friends` + `list_sessions` + `my_roles` | 120 s (30 s on the Friends tab) | `src/friends-ui.js` |
| `share_location` (sharers only) | 5 s (move 5 m or keepalive 15 s) | `src/live.js` |

About 10 req/min with no shared trip, 22-24 with three shared trips, 32-36 while sharing and moving. Startup about 8 requests, plus about 4 on every return to the page.

## Findings and what happened to each
| # | Finding | Status |
|---|---|---|
| 1 | Polling not adaptive (live poll runs even when nobody shares) | **Fixed**: `live_active` from `list_my_trips`; live poll only while above 0; trip poll 10 -> 20 -> 30 s when quiet (`eng.nudge()` resets it) |
| 2 | `list_my_trips` and `share_location` read the whole trip document (up to 1 MB) for two dates | **Fixed**: `shared_trips.start_date/end_date` columns (`20261115100000_efficiency.sql`) |
| 3 | `share_location` scanned and deleted old positions on every call, unindexed | **Mitigated**: index on `updated_at`, delete only when old rows exist. Stale rows still stay when nobody sends: see "On hold" |
| 4 | No back-off, overlapping polls, retry storms, duplicate loads, cross-tab sign-out ignored | **Fixed**: `src/backoff.js` and its uses (see `tests/backoff-unit.mjs`) |
| 5 | Every save copies the whole document into a version row; server-applied shared changes re-uploaded the cloud copy | **Fixed**: bursts keep one version (`20261115110000_version_coalesce.sql`); server-applied changes upload after 30 s |
| 6 | Steam: one `award_xp` plus a full achievement check per hour (up to 500), daily run blocked by failing links, serial | **Fixed**: batched, `last_attempt_at` ordering, 5 at a time with a 100 s budget (`20261115120000_steam_queue.sql`). Steam is still switched off |
| 7 | Missing indexes (steam queue, RSVPs, attendance, FKs followed on account deletion) | **Fixed** in the efficiency and steam migrations |
| 8 | `list_progression` N+1 and a quadratic array build | **Left on purpose**: at most 100 ids, so the quadratic part is trivial; the per-person queries are cheap. Revisit if `pg_stat_statements` shows it |
| 9 | Hot-row churn (`profiles.last_seen`, `live_locations`, `user_xp`), no autovacuum tuning | **Open, unmeasured** (A) |
| 10 | RLS cost | **Not an issue**: no table policies except `user_data` (uses `(select auth.uid())`); access is through `security definer` functions |

## On hold (owner decision)
**Retention job (pg_cron)**: purge stale `live_locations`, `user_data_versions` and `shared_trip_versions` older than 30 days (pruned only on write today, so inactive users keep 20 versions), then drop the purge from `share_location`. Revisit with real users or a second project. Also in `CURRENT_STATUS.md` and `DECISIONS.md`.

## Realtime: why not (decision in `DECISIONS.md`)
Postgres Changes needs select policies on tables that have none by design; Broadcast needs a new private-channel membership rule that the PGlite tests cannot exercise; Broadcast fan-out (5 s sends x up to 10 members) reaches the Free message limit (A, from memory) sooner than polling reaches anything. Revisit only if measured load still needs it after the changes above.

## Measured (hosted, free-tier Nano, `scripts/loadtest.mjs`, 0 errors in every run, p50 about 95 ms)
| Run | Requests | Rate |
|---|---|---|
| 3 users live, 1 min | 75 | 1.2/s |
| 10 users live, 3 min | 705 | 3.9/s (model said 3.7) |
| 25 users live, 5 min, baseline | 2,933 | 9.8/s (model said 11) |
| 25 users live, 5 min, `--adaptive` | 2,339 | 7.8/s (-20%: every party had a sharer, worst case for the saving) |
| 25 users idle, 3 min, baseline | 1,589 | 8.8/s |
| 25 users idle, 3 min, `--adaptive` | 586 | 3.3/s (**-63%**: live poll -99%, trip poll -28% in 3 min) |

Dashboard during the early runs: CPU 2-4%, connections 13/60, database 28 MB, disk IO balance 99%, **RAM 63-65%** (the figure to watch on Nano). Egress rose about 6 MB for the 10-user run (rough: 3 decimals, other activity mixed in).

Modelled load at other sizes (rate x users, all foregrounded): idle with three trips about 0.37 req/s per user; 50 users about 18 req/s, 100 about 37, 250 about 92. 100 and 250 are not realistic on this tier; the harness caps at 50.

## Free-tier budget (A: limits from memory, check the usage page)
Tests so far used about 1% of the 5 GB monthly egress; the rest of the plan below about 3%. **Real users matter more**: about 1,300 requests an hour per active user, so roughly 1-10 MB per user-hour depending on the real bytes per request (not measured). Measure it before relying on either figure. Rule for test runs: note month-to-date egress first and stop if it is above about 10% of the allowance.

## Still to do (in order)
1. Measure real bytes per request (egress delta over a known number of idle-user requests) to size the user budget.
2. `EXPLAIN (ANALYZE, BUFFERS)` of `list_my_trips`, `list_live_locations`, `share_location` on realistic data (documents of 50 and 500 markers), and `pg_stat_statements` top queries during a run.
3. Remaining request floor for an idle adaptive user: presence 2/min (about a quarter of what is left), friends + sessions 1/min, trip poll 2-6/min. Candidates: fetch sessions only when the Sessions card is shown; longer presence interval when the tab is idle.
4. Optional runs: `--scenario mixed` (edits), one 50-user run near the end of the month.
5. Watch RAM on the dashboard as users grow; hot-row churn (finding 9) if CPU or IO balance start to move.

## How to run the load test
`Project_context/docs/DEVELOPMENT.md` ("Load test"). It creates real throwaway users on the hosted project: ask the owner first; step up gradually (3 users 1 min, 10 x 3, 25 x 5); `--cleanup` removes leftovers.
