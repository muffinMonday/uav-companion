// The logic of the steam-link edge function (linking a Steam account), free of Deno and Supabase so Node tests can run it (tests/steam-unit.mjs).
// POST with the person's session: returns the Steam sign-in address. GET is Steam sending the browser back: the state proves who started it, Steam confirms the SteamID,
// the owned games are read once and credited (hours played before linking count) (a player whose game details are private is told to make them public), and the link is recorded with the service role.
// `deps`: getUser(authorization) -> { id } or null; rpc(fn, args) -> data (service role; throws on error); fetchFn; env: { secret, key, callbackUrl, origins, appIds }; now().
import { SteamError, signState, verifyState, allowedReturn, withResult, authUrl, verifyAssertion, fetchOwnedGames } from '../_shared/steam.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const text = (status, body) => new Response(body, { status, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } });
const go = (url) => new Response(null, { status: 302, headers: { location: url } });

export async function handle(req, deps) {
  const env = deps.env, now = deps.now ? deps.now() : Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.secret || !env.key || !env.callbackUrl || !env.origins?.length) return json(503, { error: 'Steam linking is not set up yet.' });

  if (req.method === 'POST') {
    const authorization = req.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+/i.test(authorization)) return json(401, { error: 'not signed in' });
    let user = null;
    try { user = await deps.getUser(authorization); } catch { user = null; }
    if (!user?.id) return json(401, { error: 'not signed in' });
    let body = null;
    try { body = await req.json(); } catch { body = null; }
    const returnUrl = allowedReturn(body?.return, env.origins);
    if (!returnUrl) return json(400, { error: 'that return address is not allowed' });
    const state = await signState({ userId: user.id, returnUrl, now }, env.secret);
    return json(200, { url: authUrl({ callbackUrl: env.callbackUrl, state }) });
  }

  if (req.method !== 'GET') return json(405, { error: 'use GET or POST' });
  const params = new URL(req.url).searchParams;
  let who;
  try { who = await verifyState(params.get('state'), env.secret, now); }
  catch (e) { return text(400, e?.code === 'expired' ? 'This link has expired. Start again from the app.' : 'This link is not valid. Start again from the app.'); }
  const back = (result) => go(withResult(who.returnUrl, result));
  try {
    const steamId = await verifyAssertion(params, { callbackUrl: env.callbackUrl, fetchFn: deps.fetchFn });
    const games = await fetchOwnedGames({ steamId, key: env.key, appIds: env.appIds, fetchFn: deps.fetchFn });
    if (games.status === 'private') return back('private');
    await deps.rpc('steam_link', { p_user: who.userId, p_steam_id: steamId, p_totals: games.totals });
    return back('linked');
  } catch (e) {
    if (e instanceof SteamError) return back('error');
    return back(/already linked to another account/.test(String(e?.message)) ? 'taken' : 'error');
  }
}
