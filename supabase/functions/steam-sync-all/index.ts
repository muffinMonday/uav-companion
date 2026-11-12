// Supabase edge function: the daily Steam sync for everyone whose last sync is old. Called by a scheduler with the x-cron-secret header (see supabase/README.md).
// verify_jwt is off: the caller is a scheduler, not a person, and is identified by STEAM_CRON_SECRET. Secrets: STEAM_API_KEY, STEAM_CRON_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleAll } from '../steam-sync/handler.js';
import { fetchOwnedGames } from '../_shared/steam.js';

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: apps } = await admin.from('steam_apps').select('app_id').eq('active', true);
  const appIds = (apps ?? []).map((a: { app_id: number }) => a.app_id);
  return handleAll(req, {
    getUser: async () => null,
    rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw new Error(error.message); return data; },
    getSteamId: async (userId: string) => { const { data } = await admin.from('steam_links').select('steam_id').eq('user_id', userId).maybeSingle(); return data?.steam_id ?? null; },
    fetchGames: (steamId: string) => fetchOwnedGames({ steamId, key: Deno.env.get('STEAM_API_KEY') ?? '', appIds, fetchFn: fetch }),
    env: { cronSecret: Deno.env.get('STEAM_CRON_SECRET') ?? '' },
  });
});
