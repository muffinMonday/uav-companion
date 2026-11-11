// Helpers for the database tests: an in-memory Postgres (PGlite) that looks enough like Supabase for the access rules to be tested for real.
// Each call to makeDb() is a fresh, private database, so database suites can run side by side with anything else.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ROOT } from './lib.mjs';

/** What Supabase provides around our tables: the three roles, auth.users, auth.uid(), and the default grants a new table gets. */
const PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase hands every new table and function in public to these roles; the migration has to take back what it does not want to give
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  -- what "Automatic RLS" adds on a hosted project: a SECURITY DEFINER function for an event trigger, executable by the API roles by default
  create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path = '' as $$ begin null; end $$;
`;

export const A = '11111111-1111-1111-1111-111111111111';
export const B = '22222222-2222-2222-2222-222222222222';
export const C = '33333333-3333-3333-3333-333333333333';
export const D = '44444444-4444-4444-4444-444444444444';

/** A new database with the prelude and every migration in supabase/migrations applied in order, and four users, A to D. */
export async function makeDb() {
  const db = new PGlite();
  await db.exec(PRELUDE);
  const dir = path.join(ROOT, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test'), ('${D}', 'd@example.test')`);
  return db;
}

/** Runs sql as a signed-in user (uid) or, with no uid, as the anonymous role. Returns the rows. The role is always reset afterwards. */
export async function as(db, uid, sql, params = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

/** Runs sql as that user and returns the error message if it fails, or null if it works. */
export async function refused(db, uid, sql, params = []) {
  try { await as(db, uid, sql, params); return null; } catch (e) { return String(e.message || e); }
}

/** save_user_data as a user; the result is the jsonb the function returns. */
export async function save(db, uid, doc, baseRev = null, device = 'test', force = false) {
  const rows = await as(db, uid, 'select public.save_user_data($1::jsonb, $2::bigint, $3, $4) as r', [JSON.stringify(doc), baseRev, device, force]);
  return rows[0].r;
}

/** A small valid document with n markers and m trips. */
export const doc = (n = 1, m = 0, extra = {}) => ({ v: 1, items: Array.from({ length: n }, (_, i) => ({ id: 'i' + i, name: 'Marker ' + i })), trips: Array.from({ length: m }, (_, i) => ({ id: 't' + i, name: 'Trip ' + i })), ...extra });
