// The Steam edge functions' logic with no network: the signed link state, the Steam OpenID check, reading owned games, and the three handlers (link, manual sync, daily run)
// with a fake Steam and a fake database. The counting itself is tested on a real Postgres in db-steam-unit.mjs.
import { SteamError, signState, verifyState, allowedReturn, withResult, authUrl, parseSteamId, verifyAssertion, fetchOwnedGames, sameSecret, STEAM_OPENID } from '../supabase/functions/_shared/steam.js';
import { handle as linkHandle } from '../supabase/functions/steam-link/handler.js';
import { handleManual, handleAll } from '../supabase/functions/steam-sync/handler.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const code = async (p) => { try { await p; return null; } catch (e) { return e instanceof SteamError ? e.code : 'other:' + e.message; } };

const SECRET = 'a-long-random-secret', KEY = 'STEAMKEY-DO-NOT-LEAK', NOW = 1_800_000_000_000;
const ORIGINS = ['https://example.github.io', 'http://localhost:5173'];
const CALLBACK = 'https://proj.supabase.co/functions/v1/steam-link';
const SID = '76561198000000001';

// ---------- the signed state
const st = await signState({ userId: 'u1', returnUrl: 'https://example.github.io/app/', now: NOW }, SECRET);
let v = await verifyState(st, SECRET, NOW + 1000);
ok(v.userId === 'u1' && v.returnUrl === 'https://example.github.io/app/', 'a state carries who started the link and where to return');
const [pp, sg] = st.split('.');
const forged = Buffer.from(JSON.stringify({ u: 'victim', r: 'https://example.github.io/app/', e: NOW + 999999 })).toString('base64url');
ok(await code(verifyState(forged + '.' + sg, SECRET, NOW)) === 'bad_state', 'a changed payload with the old signature is refused');
ok(await code(verifyState(pp + '.' + sg.slice(0, -2) + 'AA', SECRET, NOW)) === 'bad_state', 'a changed signature is refused');
ok(await code(verifyState(st, 'another-secret', NOW)) === 'bad_state', 'a state signed with another secret is refused');
ok(await code(verifyState(st, SECRET, NOW + 11 * 60_000)) === 'expired' && await code(verifyState(st, SECRET, NOW + 9 * 60_000)) === null, 'a state is good for ten minutes');
for (const bad of [null, undefined, '', 'a', 'a.b', 'a.b.c', 'x'.repeat(3000), 5, '....']) ok(await code(verifyState(bad, SECRET, NOW)) === 'bad_state', 'refused state: ' + JSON.stringify(bad)?.slice(0, 20));
ok(await code(signState({ userId: 'u', returnUrl: 'x' }, '')) === 'not_configured' && await code(verifyState(st, '', NOW)) === 'not_configured', 'with no secret configured nothing is signed or accepted');

// ---------- return addresses
ok(allowedReturn('https://example.github.io/app/?x=1#frag', ORIGINS) === 'https://example.github.io/app/?x=1', 'an allowed origin is kept with path and query, the hash dropped');
ok(allowedReturn('https://example.github.io/app/?steam=linked&y=2', ORIGINS) === 'https://example.github.io/app/?y=2', 'an old ?steam= result is removed');
ok(allowedReturn('http://localhost:5173/', ORIGINS) === 'http://localhost:5173/', 'http is fine on localhost');
for (const bad of ['https://evil.example/app/', 'http://example.github.io/app/', 'javascript:alert(1)', 'https://example.github.io.evil.com/', 'not a url', '', null, 'https://user@evil.example/', 'ftp://example.github.io/']) ok(allowedReturn(bad, ORIGINS) === null, 'refused return address: ' + String(bad));
ok(allowedReturn('https://example.github.io/', []) === null && allowedReturn('https://example.github.io/', undefined) === null, 'with no allowed origins nothing is allowed');
ok(withResult('https://example.github.io/app/?a=1', 'linked') === 'https://example.github.io/app/?a=1&steam=linked' && withResult('https://example.github.io/app/?steam=x', 'private').endsWith('?steam=private'), 'the result is added or replaced');

// ---------- the sign-in address and the Steam id
const au = new URL(authUrl({ callbackUrl: CALLBACK, state: st }));
ok(au.origin + au.pathname === STEAM_OPENID && au.searchParams.get('openid.mode') === 'checkid_setup' && au.searchParams.get('openid.realm') === 'https://proj.supabase.co', 'the address is Steam\'s OpenID endpoint with the realm of this project');
ok(au.searchParams.get('openid.return_to') === CALLBACK + '?state=' + encodeURIComponent(st), 'Steam is told to come back to the function with the state attached');
ok(parseSteamId('https://steamcommunity.com/openid/id/' + SID) === SID && parseSteamId('http://steamcommunity.com/openid/id/' + SID) === SID, 'the SteamID is read from the claimed id');
for (const bad of ['https://evil.example/openid/id/' + SID, 'https://steamcommunity.com/openid/id/123', 'https://steamcommunity.com/openid/id/' + SID + 'x', 'https://steamcommunity.com.evil.com/openid/id/' + SID, '', null]) ok(parseSteamId(bad) === null, 'not a Steam id: ' + String(bad).slice(0, 50));

// ---------- the OpenID check with Steam
const assertion = (o = {}) => new URLSearchParams({
  'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_OPENID, 'openid.claimed_id': 'https://steamcommunity.com/openid/id/' + SID,
  'openid.identity': 'https://steamcommunity.com/openid/id/' + SID, 'openid.return_to': CALLBACK + '?state=' + encodeURIComponent(st), 'openid.response_nonce': 'n1', 'openid.assoc_handle': 'h', 'openid.signed': 'a,b', 'openid.sig': 's', state: st, ...o,
});
let posted = null;
const steamSays = (text, status = 200) => async (url, init) => { posted = { url, init }; return { ok: status === 200, status, text: async () => text }; };
ok(await verifyAssertion(assertion(), { callbackUrl: CALLBACK, fetchFn: steamSays('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n') }) === SID, 'a good assertion that Steam confirms gives the SteamID');
const sent = new URLSearchParams(posted.init.body);
ok(posted.url === STEAM_OPENID && posted.init.method === 'POST' && sent.get('openid.mode') === 'check_authentication' && sent.get('openid.sig') === 's' && sent.get('openid.response_nonce') === 'n1' && !sent.has('state'), 'it asks Steam to check it (check_authentication) with Steam\'s own fields only');
const notVerified = async (p, f = steamSays('is_valid:true')) => code(verifyAssertion(p, { callbackUrl: CALLBACK, fetchFn: f }));
ok(await notVerified(assertion(), steamSays('is_valid:false')) === 'not_verified', 'Steam saying it is not valid is refused');
ok(await notVerified(assertion({ 'openid.mode': 'cancel' })) === 'not_verified', 'a cancelled sign-in is refused');
ok(await notVerified(assertion({ 'openid.op_endpoint': 'https://evil.example/openid/login' })) === 'not_verified', 'an assertion from another endpoint is refused');
ok(await notVerified(assertion({ 'openid.return_to': 'https://evil.example/cb?state=x' })) === 'not_verified', 'an assertion issued for another address is refused');
ok(await notVerified(assertion({ 'openid.claimed_id': 'https://evil.example/openid/id/' + SID })) === 'not_verified' && await notVerified(assertion({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198999999999' })) === 'not_verified', 'a claimed id that is not Steam\'s, or does not match the identity, is refused');
ok(await notVerified(assertion(), steamSays('', 500)) === 'unavailable' && await notVerified(assertion(), async () => { throw new Error('network down'); }) === 'unavailable', 'if Steam cannot be reached it is "unavailable", not a pass');

// ---------- owned games
const games = (body, status = 200) => async (url) => { games.last = url; return { ok: status === 200, status, json: async () => { if (body instanceof Error) throw body; return body; } }; };
const own = (fetchFn, o = {}) => fetchOwnedGames({ steamId: SID, key: KEY, appIds: [410340, 641780], fetchFn, ...o });
let g = await own(games({ response: { game_count: 3, games: [{ appid: 410340, playtime_forever: 120 }, { appid: 641780, playtime_forever: 0 }, { appid: 730, playtime_forever: 99999 }] } }));
ok(g.status === 'ok' && JSON.stringify(g.totals) === JSON.stringify({ 410340: 120, 641780: 0 }), 'only the approved games are kept, with their minutes');
ok(/include_played_free_games=1/.test(games.last) && /steamid=76561198000000001/.test(games.last), 'free-to-play games are asked for');
g = await own(games({ response: { game_count: 1, games: [{ appid: 410340, playtime_forever: -5 }, { appid: 641780, playtime_forever: 1.5 }, { appid: 410340 }, null] } }));
ok(g.status === 'ok' && Object.keys(g.totals).length === 0, 'a negative, fractional or missing playtime is ignored');
ok((await own(games({ response: {} }))).status === 'private', 'an empty answer means the game details are private');
g = await own(games({ response: { game_count: 0 } }));
ok(g.status === 'ok' && Object.keys(g.totals).length === 0, 'zero games with a public profile is "ok", not private');
for (const [name, f] of [['an HTTP error', games({}, 500)], ['no response object', games({})], ['a non-object response', games({ response: 5 })], ['broken JSON', games(new Error('bad json'))], ['no network', async () => { throw new Error('connect ' + KEY); }]]) {
  let err = null; try { await own(f); } catch (e) { err = e; }
  ok(err instanceof SteamError && err.code === 'unavailable' && !String(err.message).includes(KEY) && !String(err.stack).includes(KEY), name + ' is "unavailable", and the message never has the key');
}
ok(await code(own(games({}), { key: '' })) === 'not_configured' && await code(own(games({}), { steamId: '12' })) === 'bad_return', 'no key, or a bad SteamID, is refused before any request');
ok(sameSecret('abc', 'abc') && !sameSecret('abc', 'abd') && !sameSecret('abc', 'abcd') && !sameSecret('', '') && !sameSecret(null, 'x') && !sameSecret(undefined, undefined), 'secrets are compared exactly, and an empty secret never matches');

// ---------- the link handler
const env = { secret: SECRET, key: KEY, callbackUrl: CALLBACK, origins: ORIGINS, appIds: [410340, 641780] };
const mkDeps = (o = {}) => {
  const calls = [];
  return { calls, env, now: () => NOW, getUser: async (a) => (a === 'Bearer good' ? { id: 'u-real' } : null),
    fetchFn: async (url, init) => (String(url).startsWith(STEAM_OPENID) ? steamSays('is_valid:true')(url, init) : games({ response: { game_count: 2, games: [{ appid: 410340, playtime_forever: 500 }, { appid: 730, playtime_forever: 9 }] } })(url)),
    rpc: async (fn, args) => { calls.push([fn, args]); return { status: 'linked' }; }, ...o };
};
const req = (method, url, headers = {}, body) => new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
let r = await linkHandle(req('POST', CALLBACK, { authorization: 'Bearer good' }, { return: 'https://example.github.io/app/' }), { ...mkDeps(), env: { ...env, key: '' } });
ok(r.status === 503, 'with the Steam key missing the function says it is not set up');
r = await linkHandle(req('POST', CALLBACK, {}, { return: 'https://example.github.io/app/' }), mkDeps());
ok(r.status === 401, 'starting a link needs a signed-in session');
r = await linkHandle(req('POST', CALLBACK, { authorization: 'Bearer nope' }, { return: 'https://example.github.io/app/' }), mkDeps());
ok(r.status === 401, 'a session the database does not know is refused');
r = await linkHandle(req('POST', CALLBACK, { authorization: 'Bearer good' }, { return: 'https://evil.example/' }), mkDeps());
ok(r.status === 400, 'a return address outside the allowed origins is refused');
r = await linkHandle(req('POST', CALLBACK, { authorization: 'Bearer good' }, { return: 'https://example.github.io/app/#x' }), mkDeps());
const start = await r.json();
const startUrl = new URL(start.url);
ok(r.status === 200 && startUrl.origin + startUrl.pathname === STEAM_OPENID, 'a signed-in person gets the Steam sign-in address');
const stateOut = new URL(startUrl.searchParams.get('openid.return_to')).searchParams.get('state');
ok((await verifyState(stateOut, SECRET, NOW)).userId === 'u-real', 'whose state names them (from the session, not from anything they sent)');
const cb = (state, o = {}) => { const p = assertion({ 'openid.return_to': CALLBACK + '?state=' + encodeURIComponent(state), state, ...o }); return CALLBACK + '?' + p.toString(); };
let d = mkDeps();
r = await linkHandle(req('GET', cb(stateOut)), d);
ok(r.status === 302 && r.headers.get('location') === 'https://example.github.io/app/?steam=linked', 'Steam comes back: the person is sent to the app with ?steam=linked');
ok(d.calls.length === 1 && d.calls[0][0] === 'steam_link' && d.calls[0][1].p_user === 'u-real' && d.calls[0][1].p_steam_id === SID && JSON.stringify(d.calls[0][1].p_totals) === JSON.stringify({ 410340: 500 }), 'the link is recorded for the person in the state, with the SteamID Steam confirmed and the approved baseline');
d = mkDeps();
r = await linkHandle(req('GET', cb(stateOut, { user: 'victim', p_user: 'victim', 'openid.claimed_id': 'https://steamcommunity.com/openid/id/' + SID })), d);
ok(d.calls[0][1].p_user === 'u-real', 'a user id in the query is ignored');
d = mkDeps({ fetchFn: async (url, init) => (String(url).startsWith(STEAM_OPENID) ? steamSays('is_valid:true')(url, init) : games({ response: {} })(url)) });
r = await linkHandle(req('GET', cb(stateOut)), d);
ok(r.headers.get('location').endsWith('?steam=private') && d.calls.length === 0, 'a private profile sends the person back with ?steam=private and links nothing');
d = mkDeps({ fetchFn: steamSays('is_valid:false') });
r = await linkHandle(req('GET', cb(stateOut)), d);
ok(r.headers.get('location').endsWith('?steam=error') && d.calls.length === 0, 'an assertion Steam does not confirm links nothing');
d = mkDeps({ rpc: async () => { throw new Error('this Steam account is already linked to another account'); } });
r = await linkHandle(req('GET', cb(stateOut)), d);
ok(r.headers.get('location').endsWith('?steam=taken'), 'a Steam account that belongs to someone else says so');
d = mkDeps({ rpc: async () => { throw new Error('boom ' + KEY); } });
r = await linkHandle(req('GET', cb(stateOut)), d);
ok(r.headers.get('location').endsWith('?steam=error') && !(r.headers.get('location') + (await r.text())).includes(KEY), 'any other failure is a plain error, with nothing leaked');
r = await linkHandle(req('GET', cb('garbage')), mkDeps());
ok(r.status === 400 && !r.headers.get('location'), 'a callback with a bad state is refused, with nowhere to send the person');
const old = await signState({ userId: 'u-real', returnUrl: 'https://example.github.io/app/', now: NOW - 3_600_000 }, SECRET);
r = await linkHandle(req('GET', cb(old)), mkDeps());
ok(r.status === 400 && /expired/.test(await r.text()), 'an old state says it has expired');
r = await linkHandle(req('DELETE', CALLBACK), mkDeps());
ok(r.status === 405, 'other methods are refused');
r = await linkHandle(req('OPTIONS', CALLBACK), mkDeps());
ok(r.status === 204, 'and the browser pre-flight is answered');

// ---------- the manual sync handler
const syncDeps = (o = {}) => {
  const calls = [];
  return { calls, env: { cronSecret: '' }, getUser: async (a) => (a === 'Bearer good' ? { id: 'u1' } : null), getSteamId: async () => SID,
    fetchGames: async () => ({ status: 'ok', totals: { 410340: 700 } }),
    rpc: async (fn, args) => { calls.push([fn, args]); if (fn === 'claim_manual_sync') return { allowed: true, previous: '2026-11-01T00:00:00Z' }; if (fn === 'apply_steam_playtime') return { status: args.p_status, hours_added: 1, hours: 4 }; return null; }, ...o };
};
const post = (headers = { authorization: 'Bearer good' }) => req('POST', 'https://proj.supabase.co/functions/v1/steam-sync', headers);
r = await handleManual(post({}), syncDeps()); ok(r.status === 401, 'Sync now needs a signed-in session');
r = await handleManual(post({ authorization: 'Bearer nope' }), syncDeps()); ok(r.status === 401, 'and a known one');
let s = syncDeps();
r = await handleManual(post(), s);
let body = await r.json();
ok(r.status === 200 && body.status === 'ok' && body.hours_added === 1 && body.hours === 4, 'a manual sync returns the hours added');
ok(s.calls.map((c) => c[0]).join() === 'claim_manual_sync,apply_steam_playtime' && s.calls[1][1].p_user === 'u1' && JSON.stringify(s.calls[1][1].p_totals) === JSON.stringify({ 410340: 700 }), 'it claims the cooldown, then applies what Steam said for that person');
s = syncDeps({ rpc: async (fn, a) => { s.calls.push([fn, a]); return fn === 'claim_manual_sync' ? { allowed: false, reason: 'cooldown', retry_after_seconds: 1234 } : null; } });
r = await handleManual(post(), s); body = await r.json();
ok(r.status === 429 && body.retry_after_seconds === 1234 && s.calls.length === 1, 'inside the cooldown: 429 with how long to wait, and Steam is not asked');
s = syncDeps({ rpc: async (fn, a) => { s.calls.push([fn, a]); return fn === 'claim_manual_sync' ? { allowed: false, reason: 'disabled' } : null; } });
r = await handleManual(post(), s);
ok(r.status === 409 && (await r.json()).reason === 'disabled', 'with the feature switched off: 409');
s = syncDeps({ fetchGames: async () => ({ status: 'private' }) });
r = await handleManual(post(), s);
ok((await r.json()).status === 'private' && s.calls.some((c) => c[0] === 'apply_steam_playtime' && c[1].p_status === 'private') && s.calls.some((c) => c[0] === 'release_manual_sync' && c[1].p_previous === '2026-11-01T00:00:00Z'), 'a private profile is recorded and the cooldown is given back, so the person can fix it and retry');
s = syncDeps({ fetchGames: async () => { throw new SteamError('unavailable'); } });
r = await handleManual(post(), s);
ok(r.status === 502 && s.calls.some((c) => c[0] === 'apply_steam_playtime' && c[1].p_status === 'error') && s.calls.some((c) => c[0] === 'release_manual_sync'), 'if Steam does not answer: 502, the error is recorded and the cooldown given back');
s = syncDeps({ getSteamId: async () => null });
r = await handleManual(post(), s);
ok(r.status === 409 && (await r.json()).reason === 'not_linked' && s.calls.some((c) => c[0] === 'release_manual_sync'), 'someone with no linked account: 409, and the cooldown given back');
s = syncDeps({ rpc: async (fn, a) => { s.calls.push([fn, a]); if (fn === 'claim_manual_sync') return { allowed: true, previous: null }; if (fn === 'apply_steam_playtime') throw new Error('db down'); return null; } });
r = await handleManual(post(), s);
ok(r.status === 500 && s.calls.some((c) => c[0] === 'release_manual_sync'), 'if the database fails while applying, the cooldown is given back');
r = await handleManual(req('GET', 'https://proj.supabase.co/functions/v1/steam-sync'), syncDeps()); ok(r.status === 405, 'GET is refused');

// ---------- the daily run
const allDeps = (due, o = {}) => {
  const calls = [];
  return { calls, env: { cronSecret: 'cron-secret' }, getUser: async () => null, getSteamId: async (id) => (id === 'nolink' ? null : SID),
    fetchGames: async (sid) => calls.fetch?.(sid) ?? { status: 'ok', totals: { 410340: 5 } },
    rpc: async (fn, args) => { calls.push([fn, args]); if (fn === 'list_steam_due') return due; if (fn === 'apply_steam_playtime') { if (args.p_user === 'boom') throw new Error('db'); return { status: args.p_status }; } return null; }, ...o };
};
const cron = (secret) => req('POST', 'https://proj.supabase.co/functions/v1/steam-sync-all', secret === undefined ? {} : { 'x-cron-secret': secret });
let a = allDeps([{ user_id: 'u1' }]);
r = await handleAll(cron(undefined), a); ok(r.status === 401 && a.calls.length === 0, 'the daily run without the secret does nothing');
r = await handleAll(cron('wrong'), a); ok(r.status === 401 && a.calls.length === 0, 'with the wrong secret does nothing');
r = await handleAll(cron('anything'), allDeps([], { env: { cronSecret: '' } })); ok(r.status === 401, 'and with no secret configured nobody can call it');
r = await handleAll(req('GET', 'https://proj.supabase.co/x', { 'x-cron-secret': 'cron-secret' }), a); ok(r.status === 405, 'GET is refused');
a = allDeps([{ user_id: 'u1' }, { user_id: 'priv' }, { user_id: 'nolink' }, { user_id: 'boom' }, { user_id: 'u2' }]);
a.calls.fetch = (sid) => (a.__n = (a.__n ?? 0) + 1) === 2 ? { status: 'private' } : null;
r = await handleAll(cron('cron-secret'), a); body = await r.json();
ok(r.status === 200 && body.due === 5 && body.ok === 2 && body.private === 1 && body.skipped === 1 && body.error === 1, 'the run counts ok, private, skipped and failed, and one person failing does not stop the rest: ' + JSON.stringify(body));
ok(!a.calls.some((c) => c[0] === 'claim_manual_sync' || c[0] === 'release_manual_sync'), 'the daily run never touches the manual cooldown');
ok(!JSON.stringify(body).includes('u1') && !JSON.stringify(body).includes(SID), 'and the answer holds counts only, no ids');
r = await handleAll(cron('cron-secret'), allDeps(null, { rpc: async () => { throw new Error('db'); } })); ok(r.status === 500, 'if the list cannot be read: 500');
ok(body.left === 0, 'when everyone is done nobody is left');
{ // a few at a time, and the time budget stops the run without losing anyone: the rest are counted as left
  const many = Array.from({ length: 12 }, (_, i) => ({ user_id: 'p' + i }));
  let live = 0, peak = 0;
  const d1 = allDeps(many, { fetchGames: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { status: 'ok', totals: { 410340: 5 } }; } });
  r = await handleAll(cron('cron-secret'), d1); body = await r.json();
  ok(body.ok === 12 && body.left === 0 && peak > 1 && peak <= 5, 'the daily run works on up to five people at once (' + peak + ' at most at once)');
  let t = 0;
  const d2 = allDeps(many, { now: () => t, budgetMs: 100, concurrency: 1, fetchGames: async () => { t += 40; return { status: 'ok', totals: { 410340: 5 } }; } });
  r = await handleAll(cron('cron-secret'), d2); body = await r.json();
  ok(body.due === 12 && body.ok === 3 && body.left === 9, 'and stops starting new people when the time budget is used: ' + JSON.stringify(body));
}
