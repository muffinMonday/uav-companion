# Backend (Supabase)

The optional cloud side of UAV Companion. The app works fully without it (everything stays in the browser); this folder holds what a signed-in user's cloud copy needs. Nothing here is loaded unless a project address is configured (see `.env.development.local` below).

## What is here
- `migrations/`: the database as SQL, applied in file-name order. The same files run on a local database, in the tests and on the hosted project.
  - `20261111120000_user_data.sql`: one document per user (markers, trips, a few settings) with a revision number, the previous versions kept for 30 days (at most 20), row-level security, and the functions that are the only way to write (`save_user_data`, `list_user_data_versions`, `restore_user_data_version`, `delete_user_data`).
  - `20261111130000_friends.sql`: profiles (display name, friend code), friendships (request, accepted) and blocks, with the functions that are the only way in (`ensure_profile`, `set_accepts_requests`, `regenerate_friend_code`, `request_friend`, `respond_friend`, `remove_friendship`, `list_friends`, `block_user`, `list_blocked`, `unblock`, `delete_profile`). Tested in `tests/db-friends-unit.mjs`.
  - `20261111140000_shared_trips.sql`: shared trips (one document per trip with a revision), their members (owner, invited, party members), earlier versions kept 30 days (at most 20), and the functions that are the only way in (`share_trip`, `invite_to_trip`, `list_invitable_friends`, `respond_trip_invite`, `leave_trip`, `remove_member`, `delete_shared_trip`, `list_my_trips`, `list_trip_members`, `get_shared_trip`, `save_shared_trip`, `list_shared_trip_versions`, `restore_shared_trip_version`). Tested in `tests/db-trips-unit.mjs`.
  - `20261111150000_presence.sql`: online status (`touch_presence`, `set_show_online`, and the status columns of `list_friends` and `list_trip_members`). Tested in `tests/db-presence-unit.mjs`.
  - `20261111160000_live_locations.sql`: the latest position of each party member who is sharing (`live_locations`, one row per person and trip, no history), and `share_location`, `stop_sharing_location`, `stop_all_sharing`, `list_live_locations`; leaving or removal deletes the position. Tested in `tests/db-live-unit.mjs`.
  - `20261112100000_live_device.sql`: a `device` on each position; the device that starts sharing takes the position over, an older one is told `moved`. Tested in `tests/db-live-unit.mjs` and `tests/live-engine-unit.mjs`.
  - `20261113110000_profile_named.sql`: `profiles.named` (false for a new profile, true for existing ones and once a name is given or changed), returned by `ensure_profile`; `choose_name(text)` for the first-sign-in question (a name, or null to keep the default). Tested in `tests/db-profile-unit.mjs`.
  - `20261112110000_profile.sql`: `avatar` (a key of a fixed list), `bio` (160), `location` (60, typed), `interests` (up to 5 keys of a fixed list) and `share_profile` on `profiles`; `update_profile(jsonb)`; the new fields in `ensure_profile`, `list_friends`, `list_trip_members`; the editor's avatar in `list_shared_trip_versions`. Lists: `profile_avatars()`, `profile_interests()`.
  - `20261113100000_delete_account.sql`: `delete_profile` now also hands trips on and removes positions and trip places; `delete_account` adds the cloud copy and its versions; the internal `leave_all_trips`. A trip the caller owns goes to the member who joined first, or is deleted when nobody else joined.
  - `20261111121000_harden_api_exposure.sql`: takes the API roles' access away from the platform's own `rls_auto_enable()` function.
- `functions/delete-account/`: the edge function that deletes an account (`handler.js` holds the rules and is unit tested; `index.ts` is the Deno entry point). It calls `delete_account` as the user, then removes the `auth.users` row with the service-role key, which the platform supplies to the function as a secret and which is never in the repository or the browser. Deploy: `npx supabase functions deploy delete-account --project-ref <ref>`.
- `config.toml`: settings for the local stack (used only if the local stack is ever started).

## Access rules in one paragraph
Row-level security is on for every table. A signed-in user can read their own row and nothing else; the anonymous role has no access at all; **nobody can write to a table directly**. Writes go through the functions, which read the caller from `auth.uid()` and check the size (about 2 MB), the shape and the revision. A save made from an older revision than the server's is refused with `status: "conflict"` and the server's current revision, time, device name and counts, so the app can ask the user which copy to keep. These rules are tested on a real Postgres in `tests/db-unit.mjs`.

## Security advisor: accepted warnings
`supabase db advisors --remote` reports "Signed-in users can execute SECURITY DEFINER function" for every function in the migrations (the cloud-copy ones and the friends ones). That is intended: they are the only write path, each one refuses a caller who is not signed in, none can be executed by the anonymous role, and each touches only the caller's own rows. Any other warning is a finding to look at.

## Working with it
- **Tests (no Docker, no network):** `node tests/db-unit.mjs`. It builds a fresh in-memory Postgres (PGlite), adds the roles and `auth.uid()` that Supabase provides, applies every migration and checks the rules as different users.
- **Apply migrations to the hosted project:** `npx supabase db push --remote --dry-run` shows what would run; `npx supabase db push --remote --yes` applies it. The database password is read from the environment variable `SUPABASE_DB_PASSWORD` (set it once in your Windows account; never put it in a file in this repository).
- **Read-only look at the hosted database:** `npx supabase db query --remote --read-only "select ..."`.
- **Live checks as throwaway users** (they create and delete their own users; need the CLI login): `node tests/cloud-live.mjs` (cloud copy) and `node tests/friends-live.mjs` (friends) and `node tests/trips-live.mjs` (shared trips).
- **Security check:** `npx supabase db advisors --remote`.
- **The link to the project** is stored in `supabase/.temp/` (ignored by git), created by `npx supabase login` and `npx supabase link --project-ref <ref>`.

## What must never be committed
The secret (service-role) key, the database password, the access token. `.env`, `supabase/.env` and `supabase/.temp/` are ignored by git. The project address and the publishable key are public by design and live in `.env.development.local` (read by `npm run dev` only, not by `npm run build` or `npm run deploy`, so the live site does not show sign-in until it is switched on on purpose).

## Environments
The one project created so far is tagged "production" by the platform but is used as the development project while there are no real users. Before real users arrive, create a second project, apply the same migrations there, close public sign-ups, turn email confirmation on, and point the production build at it.
