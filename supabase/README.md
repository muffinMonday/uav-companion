# Backend (Supabase)

The optional cloud side of UAV Companion. The app works fully without it (everything stays in the browser); this folder holds what a signed-in user's cloud copy needs. Nothing here is loaded unless a project address is configured (see `.env.development.local` below).

## What is here
- `migrations/`: the database as SQL, applied in file-name order. The same files run on a local database, in the tests and on the hosted project.
  - `20261111120000_user_data.sql`: one document per user (markers, trips, a few settings) with a revision number, the previous versions kept for 30 days (at most 20), row-level security, and the functions that are the only way to write (`save_user_data`, `list_user_data_versions`, `restore_user_data_version`, `delete_user_data`).
  - `20261111130000_friends.sql`: profiles (display name, friend code), friendships (request, accepted) and blocks, with the functions that are the only way in (`ensure_profile`, `set_accepts_requests`, `regenerate_friend_code`, `request_friend`, `respond_friend`, `remove_friendship`, `list_friends`, `block_user`, `list_blocked`, `unblock`, `delete_profile`). Tested in `tests/db-friends-unit.mjs`.
  - `20261111121000_harden_api_exposure.sql`: takes the API roles' access away from the platform's own `rls_auto_enable()` function.
- `config.toml`: settings for the local stack (used only if the local stack is ever started).

## Access rules in one paragraph
Row-level security is on for every table. A signed-in user can read their own row and nothing else; the anonymous role has no access at all; **nobody can write to a table directly**. Writes go through the functions, which read the caller from `auth.uid()` and check the size (about 2 MB), the shape and the revision. A save made from an older revision than the server's is refused with `status: "conflict"` and the server's current revision, time, device name and counts, so the app can ask the user which copy to keep. These rules are tested on a real Postgres in `tests/db-unit.mjs`.

## Security advisor: accepted warnings
`supabase db advisors --remote` reports "Signed-in users can execute SECURITY DEFINER function" for every function in the migrations (the cloud-copy ones and the friends ones). That is intended: they are the only write path, each one refuses a caller who is not signed in, none can be executed by the anonymous role, and each touches only the caller's own rows. Any other warning is a finding to look at.

## Working with it
- **Tests (no Docker, no network):** `node tests/db-unit.mjs`. It builds a fresh in-memory Postgres (PGlite), adds the roles and `auth.uid()` that Supabase provides, applies every migration and checks the rules as different users.
- **Apply migrations to the hosted project:** `npx supabase db push --remote --dry-run` shows what would run; `npx supabase db push --remote --yes` applies it. The database password is read from the environment variable `SUPABASE_DB_PASSWORD` (set it once in your Windows account; never put it in a file in this repository).
- **Read-only look at the hosted database:** `npx supabase db query --remote --read-only "select ..."`.
- **Live checks as throwaway users** (they create and delete their own users; need the CLI login): `node tests/cloud-live.mjs` (cloud copy) and `node tests/friends-live.mjs` (friends).
- **Security check:** `npx supabase db advisors --remote`.
- **The link to the project** is stored in `supabase/.temp/` (ignored by git), created by `npx supabase login` and `npx supabase link --project-ref <ref>`.

## What must never be committed
The secret (service-role) key, the database password, the access token. `.env`, `supabase/.env` and `supabase/.temp/` are ignored by git. The project address and the publishable key are public by design and live in `.env.development.local` (read by `npm run dev` only, not by `npm run build` or `npm run deploy`, so the live site does not show sign-in until it is switched on on purpose).

## Environments
The one project created so far is tagged "production" by the platform but is used as the development project while there are no real users. Before real users arrive, create a second project, apply the same migrations there, close public sign-ups, turn email confirmation on, and point the production build at it.
