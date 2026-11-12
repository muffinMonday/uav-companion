# Account and profile backlog

Goal: a pilot account foundation (guest and registered use, profile, safe local-to-cloud migration) that a later progression system can build on. Out of scope: XP, flight sessions, Steam, lobbies, achievements, avatar upload.

Decisions (owner, 2026-11-12): complete profile fields; onboarding inside the existing splash; automatic migration, ask only on conflict; sign-out wipes local markers and trips after offering a backup; preset avatars (no Storage); two devices sharing live location: newest device takes over.

Working rule: after each phase is built and tested (`npm run test:unit`, `npm test`), commit, push, deploy, then ask the owner before starting the next phase.

Audit findings that shaped this list: the Supabase backend, friends, shared trips, revisions and the local/cloud chooser already exist (`src/sync/core.js` `decide`, `src/sync-ui.js` `question`); sync uploads markers and trips only; `uavzones.v1.*` keys are global, so local data is not tied to an account; `live_locations` has no device id; `profiles` has no avatar, bio or location; `delete_profile` leaves `user_data`, trip membership and live locations.

## Phase A: data safety
### AC-1 Sign-out wipe
- Sign-out: if local data is unsynced, sync first or warn; offer a GeoJSON backup (reuse the chooser's export); then clear markers, trips, sync state and shared-trip cache; keep preferences.
- Files: `src/sync-ui.js`, `src/sync/engine.js`, clear helpers in `src/poi.js` and `src/trips.js`.
- Check: extend `tests/cloud.mjs`; new test: A signs out, B signs in, none of A's data reaches B's cloud.
### AC-2 Interrupted first upload
- A failed or interrupted `push-first` retries without duplicating or losing data; first sync counts as done only after the cloud revision is confirmed.
- Check: `tests/sync-engine-unit.mjs`.
### AC-3 Second device and conflict regressions
- Cloud has data and local is empty: pull. Both have data: ask. Failed upload keeps local data.
- Check: `tests/sync-unit.mjs`, `tests/cloud.mjs`.
### AC-3b Two devices, one account, live location
- Problem: `live_locations` is keyed `(trip_id, user_id)` with no device id. Two sharing devices overwrite each other (the marker jumps), share one 2 s rate limit, and a stop or sign-out on one device deletes the row the other still sends.
- Fix: migration adds `device text`; `share_location` and `stop_sharing_location` take a device id (random per browser); a send from a new device claims the row; a send or stop from a device that no longer holds it returns `status: 'moved'` and changes nothing; `stop_all_sharing` deletes only the calling device's rows. `live.js` stops on `moved` and shows "Sharing moved to your other device".
- Already per-device, no change: the sharing switch (memory only, off on open), preferences (not synced), `show_online` (one server value), data conflicts (existing chooser).
- Files: new migration, `src/live.js`, `src/social.js`, `src/party-ui.js`.
- Check: `tests/db-live-unit.mjs` (two devices, takeover, stale stop ignored), `tests/trips-live.mjs`.

## Phase B: account entrypoint
### AC-4 Persistent account button (built)
- In `.sp-head` and in `#dock`, phone included. Guest: not signed in, local-storage note, Sign in, export/import link. Signed in: avatar, name, friend code, sync status, Edit profile, Friends shortcut, email, sign out. Account content moves out of Privacy (`#cloud-card`).
### AC-5 Sign-in prompt for guests (built: all Sign in buttons open the popover)
- A guest opening Friends or shared-trip features gets a sign-in prompt.

## Phase C: onboarding
### AC-6 Splash account row
- Add "Continue as guest" and "Create a profile" below Plan a trip / Plan a flight; neither blocks. Remember the choice in `dashstate.js`. Reword `src/splash.js:105`. Check: extend `tests/splash.mjs`.

## Phase D: profile (additive migration)
### AC-7 Schema
- `profiles` gains `avatar` (preset key from a fixed list), `bio` (max 160), `location` (max 60, typed, no GPS), `interests` (text[] from a fixed tag list), per-field visibility. Extend `ensure_profile`, add `update_profile`; writes only through SQL functions; email never returned. Check: `tests/db-friends-unit.mjs`.
### AC-8 Edit UI
- Name, preset avatar picker, bio, location, interest tags, visibility, clear field.
### AC-9 Display
- Avatar and permitted fields in friend rows (`src/friends-ui.js`), party members (`src/party-ui.js`), shared-trip "updated by"; visibility enforced server-side.

## Phase E: identity, deletion, docs
### AC-10 Account deletion
- Extend `delete_profile` to remove `user_data`, trip membership and live locations. Removing the `auth.users` row needs an owner decision (edge function or documented manual step).
### AC-11 Progression-ready note
- `DECISIONS.md`: the auth UUID is the identity; progression gets its own table later; `profiles` stays social-only. No code.
### AC-12 Docs and release checks
- `PROJECT.md`, `DATABASE.md`, `ARCHITECTURE.md`, `MODULES.md`, `CURRENT_STATUS.md`. Before real users: second Supabase project, closed sign-ups.

## Regression list (from the original plan, to keep passing)
First visit offers both paths; guest can use everything; onboarding not repeated; Friends prompts a guest; guest account creation uploads when cloud is empty; existing account keeps its cloud data; conflict asks; failed upload keeps local data; sign-out backs up then clears; second device pulls; profile edits show for friends; two accounts on one browser do not leak; deleted profile follows the documented rules.
