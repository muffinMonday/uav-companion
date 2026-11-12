---
name: supabase-change
description: Procedure for changing the Supabase backend (new migration, SQL function, RLS, edge function) and proving it with the in-memory Postgres tests. Use when a task touches supabase/ or a db-*-unit suite.
---

# supabase-change

Rules are in `Project_context/AGENTS.md` (writes only via SQL functions, RLS on every table, new migration files only, no secrets). Details: `supabase/README.md` and `Project_context/docs/DATABASE.md`; read only the part you need.

1. Never edit an applied migration. Add `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` later than the newest file.
2. Functions: `security definer`, check `auth.uid()`, validate size and shape; grant to `authenticated` only, never `anon`.
3. Extend the matching suite (`tests/db-<area>-unit.mjs`; they apply every migration on PGlite via `tests/lib-db.mjs`): the allowed case, a refused case, a different user.
4. Run `node .claude/skills/test-impact/impact.mjs`. All `db-*` suites must pass.
5. Edge function change: `node tests/delete-account-unit.mjs` (rules live in `handler.js`).
6. Update `supabase/README.md` (migration list) and `DATABASE.md` in the same change.
7. Ask the owner before `npx supabase db push --remote --yes` or `functions deploy`. `db push --remote --dry-run` is fine to run first.
8. Live checks (`tests/*-live.mjs`) create real throwaway users on the hosted dev project: ask first.

Never print or commit the DB password, service-role key or `.env*.local`.
