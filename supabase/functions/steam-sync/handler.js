// The logic of the steam-sync (a person's own "Sync now") and steam-sync-all (the daily run) edge functions, free of Deno and Supabase so Node tests can run it (tests/steam-unit.mjs).
// Both read a player's playtime from Steam and hand it to apply_steam_playtime, which does the counting. The manual sync claims its cooldown first (the database refuses it inside
// the hour) and gives it back if Steam does not answer or the profile is private, so a failure does not cost the person their sync. The daily run has no cooldown.
// `deps`: getUser(authorization), rpc(fn, args) (service role), getSteamId(userId) -> the person's linked SteamID or null, fetchGames(steamId) -> { status, totals }, env: { cronSecret }.
import { SteamError, sameSecret } from '../_shared/steam.js';
import { logEvent, classify, requestId } from '../_shared/log.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-cron-secret', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

/** One person's sync. Returns { status: 'ok' | 'private' | 'error' | 'not_linked', result? }. Failures are logged as a classification only (no user id, no message). */
async function syncOne(userId, deps, fn = 'steam-sync') {
  const steamId = await deps.getSteamId(userId);
  if (!steamId) return { status: 'not_linked' };
  let games;
  try { games = await deps.fetchGames(steamId); }
  catch (e) {
    logEvent('warn', fn, 'steam_read_failed', { code: classify(e) }, deps.logOut);
    await deps.rpc('apply_steam_playtime', { p_user: userId, p_totals: {}, p_status: 'error' }).catch((e2) => logEvent('error', fn, 'status_write_failed', { code: classify(e2) }, deps.logOut));
    return { status: 'error', code: e instanceof SteamError ? e.code : 'unavailable' };
  }
  if (games.status === 'private') { await deps.rpc('apply_steam_playtime', { p_user: userId, p_totals: {}, p_status: 'private' }); return { status: 'private' }; }
  const result = await deps.rpc('apply_steam_playtime', { p_user: userId, p_totals: games.totals, p_status: 'ok' });
  return { status: result?.status === 'ok' ? 'ok' : (result?.status ?? 'error'), result };
}

/** POST with the person's session: "Sync now". */
export async function handleManual(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'use POST' });
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return json(401, { error: 'not signed in' });
  let user = null;
  try { user = await deps.getUser(authorization); } catch { user = null; }
  if (!user?.id) return json(401, { error: 'not signed in' });
  let claim;
  try { claim = await deps.rpc('claim_manual_sync', { p_user: user.id }); } catch (e) { logEvent('error', 'steam-sync', 'claim_failed', { code: classify(e) }, deps.logOut); return json(500, { error: 'Could not start the sync.' }); }
  if (!claim?.allowed) {
    if (claim?.reason === 'cooldown') return json(429, { reason: 'cooldown', retry_after_seconds: claim.retry_after_seconds });
    return json(409, { reason: claim?.reason ?? 'not_available' });
  }
  const release = () => deps.rpc('release_manual_sync', { p_user: user.id, p_previous: claim.previous ?? null }).catch(() => {});
  let out;
  try { out = await syncOne(user.id, deps); } catch (e) { logEvent('error', 'steam-sync', 'sync_failed', { code: classify(e) }, deps.logOut); await release(); return json(500, { error: 'The sync failed. Try again.' }); }
  if (out.status === 'ok') return json(200, { status: 'ok', hours_added: out.result?.hours_added ?? 0, hours: out.result?.hours ?? 0 });
  await release();
  if (out.status === 'private') return json(200, { status: 'private' });
  if (out.status === 'not_linked') return json(409, { reason: 'not_linked' });
  return json(502, { status: 'error', error: 'Steam did not answer. Try again in a little while.' });
}

/** POST with the project's cron secret in x-cron-secret: the daily run over everyone whose last sync is old. Returns the counts only. */
export async function handleAll(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'use POST' });
  if (!deps.env.cronSecret || !sameSecret(req.headers.get('x-cron-secret'), deps.env.cronSecret)) return json(401, { error: 'not allowed' });
  let due = [];
  const req_ = requestId();
  try { due = (await deps.rpc('list_steam_due', { p_limit: 200 })) ?? []; } catch (e) { logEvent('error', 'steam-sync-all', 'list_failed', { code: classify(e), req: req_ }, deps.logOut); return json(500, { error: 'Could not list who is due.' }); }
  const counts = { due: due.length, ok: 0, private: 0, error: 0, skipped: 0, left: 0 };
  // a few people at a time, and no new person once the time budget is used (the function has a wall-clock limit); the ones left are due again at the next run
  const now = deps.now ?? Date.now, budgetMs = deps.budgetMs ?? 100000, started = now();
  let next = 0;
  async function worker() {
    while (next < due.length && now() - started < budgetMs) {
      const d = due[next++];
      try {
        const o = await syncOne(d.user_id, deps, 'steam-sync-all');
        if (o.status === 'ok') counts.ok++; else if (o.status === 'private') counts.private++; else if (o.status === 'not_linked') counts.skipped++; else counts.error++;
      } catch (e) { counts.error++; if (counts.error <= 20) logEvent('error', 'steam-sync-all', 'sync_failed', { code: classify(e), req: req_ }, deps.logOut); } // at most 20 lines a run
    }
  }
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 5, due.length) }, worker));
  counts.left = due.length - next;
  logEvent(counts.error || counts.left ? 'warn' : 'info', 'steam-sync-all', 'run_done', { ...counts, ms: now() - started, req: req_ }, deps.logOut);
  return json(200, counts);
}
