// Supabase edge function: link a Steam account. See handler.js for the rules and tests/steam-unit.mjs for the tests.
// verify_jwt is off for this function because Steam's redirect back carries no session; the POST checks the session itself and the GET checks the signed state.
// Secrets (supabase secrets set ...): STEAM_API_KEY, STEAM_STATE_SECRET (any long random string), STEAM_RETURN_ORIGINS (comma separated, for example https://example.github.io,http://localhost:5173).
// The platform supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. None of these is in the repository or the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: apps } = await admin.from('steam_apps').select('app_id').eq('active', true);
  return handle(req, {
    env: {
      secret: Deno.env.get('STEAM_STATE_SECRET') ?? '', key: Deno.env.get('STEAM_API_KEY') ?? '', callbackUrl: `${url}/functions/v1/steam-link`,
      origins: (Deno.env.get('STEAM_RETURN_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean), appIds: (apps ?? []).map((a: { app_id: number }) => a.app_id),
    },
    fetchFn: fetch,
    getUser: async (authorization: string) => { const { data, error } = await createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }).auth.getUser(); return error ? null : data.user; },
    rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw new Error(error.message); return data; },
  });
});
