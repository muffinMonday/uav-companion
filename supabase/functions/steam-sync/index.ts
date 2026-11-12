// Supabase edge function: a person's own "Sync now" for their Steam playtime. See handler.js for the rules and tests/steam-unit.mjs for the tests. verify_jwt is on.
// Secret: STEAM_API_KEY. The platform supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleManual } from './handler.js';
import { fetchOwnedGames } from '../_shared/steam.js';

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: apps } = await admin.from('steam_apps').select('app_id').eq('active', true);
  const appIds = (apps ?? []).map((a: { app_id: number }) => a.app_id);
  return handleManual(req, {
    getUser: async (authorization: string) => { const { data, error } = await createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }).auth.getUser(); return error ? null : data.user; },
    rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw new Error(error.message); return data; },
    getSteamId: async (userId: string) => { const { data } = await admin.from('steam_links').select('steam_id').eq('user_id', userId).maybeSingle(); return data?.steam_id ?? null; },
    fetchGames: (steamId: string) => fetchOwnedGames({ steamId, key: Deno.env.get('STEAM_API_KEY') ?? '', appIds, fetchFn: fetch }),
    env: { cronSecret: '' },
  });
});
