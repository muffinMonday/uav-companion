// Edge function logging (supabase/functions/_shared/log.js) and where the handlers use it: allow-listed fields only, errors reduced to a classification, no raw error
// text in a log line or in an answer to the caller. The platform, the database and Steam are stubbed. No browser, no network.
import { classify, safeFields, buildLine, logEvent, requestId } from '../supabase/functions/_shared/log.js';
import { handle as deleteAccount } from '../supabase/functions/delete-account/handler.js';
import { handleManual, handleAll } from '../supabase/functions/steam-sync/handler.js';
import { handle as steamLink } from '../supabase/functions/steam-link/handler.js';
import { SteamError, signState } from '../supabase/functions/_shared/steam.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const SECRET = 'hunter2-SECRET';
const NASTY = new Error(`duplicate key value violates unique constraint "x" DETAIL: Key (user_id)=(3f2b8c1e-9d4a-4b6f-8a1c-0e5d7f9a2b34) password=${SECRET} https://x.supabase.co/rest/v1?apikey=sb_secret_abc Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijk 76561198000000001`);
const dump = (lines) => JSON.stringify(lines);
const clean = (lines) => !/hunter2|SECRET|sb_secret|eyJ|3f2b8c1e|76561198|apikey|Bearer|duplicate key|supabase\.co/i.test(dump(lines));

// ---------- classification
{
  const c = (o) => classify(Object.assign(new Error(NASTY.message), o));
  ok(c({ name: 'AbortError' }) === 'timeout' && c({ name: 'TimeoutError' }) === 'timeout', 'abort and timeout errors are timeout');
  ok(classify(new SteamError('unavailable')) === 'steam_unavailable' && classify(new SteamError('bad_state')) === 'steam_other' && c({ code: 'not_verified' }) === 'steam_other', 'Steam errors are classified by their code');
  ok(c({ status: 401 }) === 'auth' && c({ status: 403 }) === 'auth' && c({ code: '42501' }) === 'auth' && c({ code: '28000' }) === 'auth', 'auth failures, from HTTP status or SQLSTATE');
  ok(c({ status: 429 }) === 'rate_limited' && c({ status: 503 }) === 'network' && classify(new TypeError('fetch failed')) === 'network', 'rate limits and network failures');
  ok(c({ code: '23505' }) === 'validation' && c({ code: '22023' }) === 'validation' && c({ code: 'XX000' }) === 'db' && c({ code: 'P0001' }) === 'db', 'SQLSTATE classes: data and integrity errors are validation, the rest db');
  ok(classify(null) === 'unknown' && classify(undefined) === 'unknown' && classify('text') === 'unknown' && classify({ message: NASTY.message }) === 'unknown', 'anything else is unknown, and the message is never read');
  ok(!/hunter2|SECRET/.test([NASTY, new SteamError('unavailable', NASTY.message)].map(classify).join()), 'a classification never contains message text');
}

// ---------- fields and lines
{
  const f = safeFields({ status: 502.4, code: 'timeout', req: 'ab12cd34', ms: 120, due: 3, user: 'u1', message: NASTY.message, authorization: 'Bearer x', steam_id: '1', count: Infinity, extra: { a: 1 } });
  ok(JSON.stringify(f) === JSON.stringify({ status: 502, code: 'timeout', req: 'ab12cd34', ms: 120, due: 3 }), 'only allow-listed fields with number or slug values survive: ' + JSON.stringify(f));
  ok(Object.keys(safeFields({ code: 'Has Spaces And Caps', req: 'x'.repeat(50) })).length === 0 && Object.keys(safeFields({ code: NASTY.message })).length === 0, 'a string that is not a short slug is dropped, so a message cannot be smuggled in as a code');
  ok(safeFields(null) && Object.keys(safeFields('x')).length === 0, 'non-objects give nothing');
  ok(buildLine('warn', 'steam-sync', 'sync_failed', { code: 'network' }).event === 'sync_failed' && buildLine('debug', 'a', 'b', {}) === null && buildLine('warn', 'a b', 'ok_event', {}) === null && buildLine('warn', 'steam-sync', 'Has Spaces', {}) === null, 'a line needs a known level and slug names');
  const out = []; logEvent('error', 'steam-sync', 'x_failed', { code: classify(NASTY), message: NASTY.message }, (l) => out.push(l));
  ok(out.length === 1 && out[0].lvl === 'error' && clean(out), 'logEvent writes one line and nothing sensitive');
  let threw = false; try { logEvent('error', 'a', 'b', {}, () => { throw new Error('sink down'); }); logEvent('warn', null, null, null); } catch { threw = true; }
  ok(!threw, 'a failing sink never throws');
  ok(/^[0-9a-f]{8}$/.test(requestId()) && requestId() !== requestId(), 'request ids are short random hex');
}

// ---------- delete-account: fixed messages, stable codes, cause classified in the log
{
  const run = async ({ dataFails = null, authFails = null } = {}) => {
    const lines = [];
    const deps = { logOut: (l) => lines.push(l), getUser: async () => ({ id: 'u1' }), deleteData: async () => { if (dataFails) throw dataFails; }, deleteAuthUser: async () => { if (authFails) throw authFails; } };
    const res = await deleteAccount(new Request('https://x.test/f', { method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) }), deps);
    return { status: res.status, json: await res.json(), lines };
  };
  let r = await run({ dataFails: Object.assign(NASTY, { code: '23505' }) });
  ok(r.status === 500 && r.json.code === 'delete_data_failed' && /Nothing was deleted/.test(r.json.error) && clean([r.json]) && r.lines.length === 1 && r.lines[0].event === 'delete_data_failed' && r.lines[0].code === 'validation' && clean(r.lines), 'a database failure: fixed message, stable code, nothing raw in the answer, a classified log line');
  r = await run({ authFails: Object.assign(new Error('GoTrue says: ' + SECRET), { status: 503 }) });
  ok(r.status === 500 && r.json.partial === true && r.json.code === 'delete_auth_failed' && /data was deleted/.test(r.json.error) && clean([r.json]) && r.lines[0].event === 'delete_auth_failed' && r.lines[0].code === 'network' && clean(r.lines), 'a sign-in record failure: partial, stable code, fixed text, classified log line');
  r = await run();
  ok(r.status === 200 && r.lines.length === 0, 'success logs nothing');
}

// ---------- the Steam sync
{
  const base = (over = {}) => {
    const lines = [], calls = [];
    const deps = {
      logOut: (l) => lines.push(l), env: { cronSecret: 'cron' }, now: () => 1000, concurrency: 2,
      getUser: async () => ({ id: 'u1' }), getSteamId: async () => '76561198000000001',
      rpc: async (fn, args) => { calls.push(fn); if (fn === 'claim_manual_sync') return { allowed: true }; if (fn === 'list_steam_due') return [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }]; return { status: 'ok' }; },
      fetchGames: async () => ({ status: 'ok', totals: {} }), ...over };
    return { lines, calls, deps };
  };
  const manual = (deps) => handleManual(new Request('https://x.test/f', { method: 'POST', headers: { authorization: 'Bearer good' } }), deps);
  const all = (deps) => handleAll(new Request('https://x.test/f', { method: 'POST', headers: { 'x-cron-secret': 'cron' } }), deps);

  let t = base({ fetchGames: async () => { throw new SteamError('unavailable', NASTY.message); } });
  let res = await manual(t.deps);
  ok(res.status === 502 && t.lines.some((l) => l.event === 'steam_read_failed' && l.code === 'steam_unavailable') && clean(t.lines) && clean([await res.json()]), 'manual sync, Steam failing: a classified line and a generic answer');
  t = base({ rpc: async (fn) => { if (fn === 'claim_manual_sync') throw Object.assign(NASTY, { code: 'XX000' }); return {}; } });
  res = await manual(t.deps);
  ok(res.status === 500 && t.lines[0].event === 'claim_failed' && t.lines[0].code === 'db' && clean(t.lines) && clean([await res.json()]), 'a failing claim is logged as db, not with its text');
  t = base({ rpc: async (fn) => { if (fn === 'claim_manual_sync') return { allowed: true }; if (fn === 'apply_steam_playtime') throw NASTY; return {}; } });
  res = await manual(t.deps);
  ok(res.status === 500 && t.lines.some((l) => l.event === 'sync_failed') && clean(t.lines), 'a failing apply is logged as sync_failed, clean');
  t = base({ fetchGames: async () => { throw new SteamError('unavailable'); }, rpc: async (fn, a) => { if (fn === 'list_steam_due') return [{ user_id: 'a' }]; if (fn === 'apply_steam_playtime') throw NASTY; return {}; } });
  res = await all(t.deps);
  ok(t.lines.some((l) => l.event === 'status_write_failed') && clean(t.lines), 'a failed status write (once silent) is now logged');
  t = base({ fetchGames: async (id) => { throw NASTY; } });
  res = await all(t.deps);
  const done = t.lines.find((l) => l.event === 'run_done');
  ok(res.status === 200 && done && done.due === 3 && done.error === 3 && done.lvl === 'warn' && /^[0-9a-f]{8}$/.test(done.req) && clean(t.lines), 'the daily run logs a summary with the counts (warn when something failed)');
  ok(t.lines.filter((l) => l.event === 'steam_read_failed').every((l) => !('user_id' in l) && !('user' in l)), 'and no line names a person');
  t = base();
  await all(t.deps);
  ok(t.lines.length === 1 && t.lines[0].event === 'run_done' && t.lines[0].lvl === 'info' && t.lines[0].ok === 3, 'a clean run is one info line');
  t = base({ rpc: async (fn) => { if (fn === 'list_steam_due') return Array.from({ length: 50 }, (_, i) => ({ user_id: 'u' + i })); throw NASTY; }, getSteamId: async () => '76561198000000001', fetchGames: async () => ({ status: 'ok', totals: {} }) });
  await all(t.deps);
  ok(t.lines.filter((l) => l.event === 'sync_failed').length <= 20 && t.lines.filter((l) => l.event === 'sync_failed').length > 0 && clean(t.lines), 'failures in a run are logged at most 20 times, then only counted');
  t = base({ rpc: async () => { throw NASTY; } });
  res = await all(t.deps);
  ok(res.status === 500 && t.lines[0].event === 'list_failed' && clean(t.lines), 'failing to list who is due is logged');
}

// ---------- steam-link
{
  const env = { secret: 'k'.repeat(32), key: 'steamkey-' + SECRET, callbackUrl: 'https://x.test/cb', origins: ['https://app.test'], appIds: [1] };
  const get = (state, deps) => steamLink(new Request('https://x.test/cb?state=' + encodeURIComponent(state)), { env, logOut: (l) => deps.lines.push(l), fetchFn: async () => { throw NASTY; }, rpc: async () => ({}), ...deps.over });
  let d = { lines: [], over: {} };
  let res = await get('garbage', d);
  ok(res.status === 400 && d.lines[0]?.event === 'bad_state' && d.lines[0].code === 'bad_state' && clean(d.lines), 'an invalid state is logged as bad_state (the state itself is not)');
  const good = await signState({ userId: 'u1', returnUrl: 'https://app.test/', now: Date.now() }, env.secret);
  d = { lines: [], over: {} };
  res = await get(good, d);
  ok(res.status === 302 && d.lines[0]?.event === 'link_failed' && clean(d.lines) && !dump(d.lines).includes(good) && !dump(d.lines).includes('steamkey'), 'a failing link is logged as link_failed with a classification only (no state, key or id)');
  const old = await signState({ userId: 'u1', returnUrl: 'https://app.test/', now: Date.now() - 3600_000 }, env.secret);
  d = { lines: [], over: {} };
  await get(old, d);
  ok(d.lines[0]?.code === 'expired' && clean(d.lines), 'an expired state is logged as expired');
}
