# Progression: XP, ranks, achievements, sessions, Steam

The design as built (phases 1 to 6, 2026-11-14). Load this when a task touches progression; user-facing description is `PROJECT.md` F49 to F51, table and function lists are in `supabase/README.md` (one entry per migration), the module map is `MODULES.md`. The approved plan lived outside the repo; this file replaces it.

## What it is
Members earn **XP**; XP gives a **rank** (10 tiers, Rookie 0 XP to Ace 3,500; more XP keeps counting, rank stays Ace); milestones unlock **achievements** (16 at launch, four rarities, no XP of their own). XP sources: **offline flight-session attendance** (50 XP, only when an organiser marks the person present) and **approved Steam simulator playtime** (10 XP per completed hour). Everything is decided by the database; the app only draws.

## Rules that must keep holding
- **XP is an append-only ledger** (`xp_ledger`, unique `(user_id, source, ref)`); the only inserter is the internal `award_xp` (no client role can call it). `user_xp` (total, `peak_tier`) is kept by a trigger in the same transaction. **Rank is never stored**: `rank_for(xp)` reads `progression_ranks`. Thresholds and rates are rows (`progression_ranks`, `progression_settings`), not code.
- Refs: simulator `hour:<n>`, attendance `session:<id>`, reversal `session:<id>:rev`, admin a fresh id. A repeat or concurrent award changes nothing.
- XP never drops below zero: a deduction records the applied amount and `meta.requested`. Deductions come only from administrators (reason required, not on yourself) or `revoke_attendance`.
- **Achievements are permanent** (`user_achievements`, trigger refuses update/delete), first unlock time kept, never revoked by a deduction. Criteria are monotonic milestones: `sim_hours` and `attendance_verified_count` count positive ledger rows, `peak_tier` is the high-water mark, `shared_trips_created` and `steam_linked_ever` are counters/rows that are never deleted. `evaluate_achievements` runs in the transaction that changes a metric and is safe to rerun.
- **Visibility** (`progression_viewable`, the single rule): the caller sees someone's progression only if it is themselves, or an accepted friend / a joined member of a trip the caller joined, **and** their `share_profile` is on, **and** no block exists in either direction. Hidden, blocked, pending and unknown all return the same `{visible: false}`. People are named by `('friend', friendship id)` or `('member', party member id)`, never a user id. Others never see unlock times, the XP ledger, the Steam id or who an administrator was; only the owner sees their history (admin reasons included).
- Map rank ring: only on pins already visible under the party sharing rules; pin visibility is unchanged. `list_friends`, `list_trip_members`, `list_live_locations` were deliberately **not** extended: the app asks `list_progression` for the ids it shows (30 s cache).
- **Sessions**: organisers/administrators (roles in `app_roles`, granted only by an administrator; the first administrator is inserted by the owner with SQL) create and manage sessions; an organiser manages only their own. RSVP gives no XP and can be withdrawn only before the start. Marking present: from the start until closed, never yourself, by RSVP handle or friend code (walk-ins), XP once per person per session. Revoking a mark: administrators only, reversal row, attendance row kept, achievements kept, re-marking awards nothing.
- **Steam**: only the edge functions talk to Steam (Web API key is a function secret); the app never sends minutes. Linking = Steam OpenID checked with Steam + a baseline (no retroactive XP; requires a readable, i.e. public, Game details). Sync adds `max(new - last, 0)` per approved game, one ledger row per completed hour, at most 500 hours per sync, fractions kept. `steam_links` survives unlinking so hours are never awarded twice and relinking takes a new baseline. Manual Sync now has a 60 minute cooldown, claimed atomically and given back on failure; the daily run (`steam-sync-all`, `x-cron-secret`) does not use it. The approved list is data (`steam_apps`).

## Where things are
| Part | Database | App |
|---|---|---|
| Ledger, ranks, roles, admin adjust | `20261114100000_progression_core.sql` | none (admin calls are SQL/RPC only; there is no admin screen) |
| Achievements, featured | `20261114110000_achievements.sql` | `progression.js` (pure), `progression-api.js`, `progression-ui.js` |
| Read API | `20261114120000_progression_read.sql` | own card in the account pane (`account-ui.js`), others' card in `profile-popover.js`, `livemap.js` ring |
| Sessions | `20261114130000_flight_sessions.sql` | `sessions.js`, `sessions-ui.js` (Friends tab) |
| Steam | `20261114140000_steam.sql`, `supabase/functions/{steam-link,steam-sync,steam-sync-all,_shared}` | `steam.js`, `steam-ui.js` (Friends tab) |

Tests: `db-progression-unit`, `db-progression-read-unit`, `db-sessions-unit`, `db-steam-unit` (PGlite); `progression-unit`, `sessions-unit`, `steam-unit` (edge logic), `steamui-unit`; browser `progression`, `sessions`, `steam`, and the rank checks in `live`.

## How to extend
- **New achievement**: insert a row in a new migration (`achievements`: key, category, name, description, rarity, icon key, metric, threshold, sort; optional `season`, `starts_at`, `ends_at`). Icon keys map to emoji in `progression.js` `GLYPHS`. A **new kind of rule** = a new branch in `user_metric` (`create or replace`, copy the latest body from `20261114140000_steam.sql`) and a call to `evaluate_achievements` where the metric changes. Metrics must only ever go up.
- **Rank or rate change**: update `progression_ranks` / `progression_settings` in a migration (a trigger keeps thresholds rising).
- **Approve a Steam game**: insert into `steam_apps` in a migration (App ID verified against the Steam store API first). A game missing from a person's baseline counts in full when first seen.
- **New XP source**: add the source to the ledger check and to `award_xp`'s allowed list (new migration), give it a unique `ref` scheme, award only from a security-definer function.

## Owner to-do (nothing below is done)
1. Insert the first administrator (`supabase/README.md`); then administrators grant organiser roles with `grant_role`.
2. Switch Steam on: set secrets `STEAM_API_KEY`, `STEAM_STATE_SECRET`, `STEAM_CRON_SECRET`, `STEAM_RETURN_ORIGINS`, then set `steam_enabled` to 1. The functions are already deployed.
3. Schedule the daily call to `steam-sync-all` (pg_cron + pg_net or a scheduled GitHub Actions workflow; snippets in `supabase/README.md`).
4. First live check against real Steam with a chosen account (never done: built and tested only against fakes).
5. Decide whether `delete_profile` should also wipe XP (today only deleting the account does).

## Known gaps and risks
- Real-world flying achievements (Maiden Flight, Back in the Air, Weekend Warrior, Frequent Flyer) are not defined: nothing records a flight yet (check-ins are local, live positions have no history). Needs a flight-logging feature (phase 7, not started).
- No admin screen: XP adjustments, role grants and attendance revocation of other sessions' marks beyond the Sessions card are RPC/SQL. Walk-in friend-code lookup is not rate limited (organiser/administrator role only).
- Steam playtime can be idled or inflated and is cumulative only; a very late offline upload is credited in full (no per-sync cap by design, only the 500-hour pace). The Steam OpenID and sync paths are untested against the real service.
- Blocked members still see each other's pins and party lists (existing behaviour, unchanged); only progression is hidden for them.
- The Steam card sits in the account pane (avatar popover) with Progression; only the Sessions card is in the Friends tab.
