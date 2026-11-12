// The app side of Steam (src/steam.js): validation of what the database returns, the wording, reading the result Steam's sign-in leaves in the address, and the calls. No browser, no network.
import { cleanSteam, cleanApps, waitText, returnResult, withoutResult, isSteamSignIn, createSteam, RESULT_TEXT } from '../src/steam.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// ---------- cleaning
let s = cleanSteam({ enabled: true, linked: true, ever_linked: true, hours: 7, minutes_to_next: 25, last_synced_at: '2026-11-14T10:00:00Z', last_status: 'ok', manual_available_at: null, xp_per_hour: 10 });
ok(s.enabled && s.linked && s.everLinked && s.hours === 7 && s.minutesToNext === 25 && s.lastStatus === 'ok' && s.manualAvailableAt === null && s.xpPerHour === 10, 'a good answer is read');
for (const bad of [null, undefined, 5, 'x', [], {}]) { const c = cleanSteam(bad); ok(!c.enabled && !c.linked && c.hours === 0 && c.minutesToNext === 0 && c.lastStatus === null && c.xpPerHour === 10, 'a bad answer is "off, not linked, zero": ' + JSON.stringify(bad)); }
s = cleanSteam({ enabled: 'yes', linked: 1, hours: -3, minutes_to_next: 'lots', last_synced_at: 'yesterday', last_status: 'weird', manual_available_at: 'soon', xp_per_hour: 0 });
ok(!s.enabled && !s.linked && s.hours === 0 && s.minutesToNext === 0 && s.lastSyncedAt === null && s.lastStatus === null && s.manualAvailableAt === null && s.xpPerHour === 10, 'only a real true counts; bad numbers, times and statuses are dropped');
ok(cleanSteam({ hours: 3.9 }).hours === 3, 'hours are whole numbers');
ok(cleanApps([{ app_id: 410340, name: 'Liftoff' }, { app_id: 'x', name: 'bad' }, { app_id: 5, name: '' }, null, { app_id: '641780', name: 'DRL' }]).map((a) => a.id).join() === '410340,641780' && cleanApps('nope').length === 0, 'the approved list drops bad rows');
ok(cleanApps(Array.from({ length: 80 }, (_, i) => ({ app_id: i + 1, name: 'n' + i }))).length === 50 && cleanApps([{ app_id: 1, name: 'x'.repeat(200) }])[0].name.length === 80, 'and is bounded');

// ---------- the wait text
const t0 = Date.parse('2026-11-14T10:00:00Z');
ok(waitText('2026-11-14T10:00:30Z', t0) === 'a few seconds' && waitText('2026-11-14T10:00:59Z', t0) === 'a few seconds' && waitText('2026-11-14T10:01:01Z', t0) === '2 minutes' && waitText('2026-11-14T11:00:00Z', t0) === '60 minutes', 'the wait is "a few seconds" or whole minutes, rounded up');
ok(waitText('2026-11-14T10:05:00Z', t0) === '5 minutes' && waitText('2026-11-14T10:01:00Z', t0) === '1 minute', 'one minute is singular');
ok(waitText('2026-11-14T09:59:00Z', t0) === '' && waitText(null, t0) === '' && waitText('junk', t0) === '', 'nothing when it is not in the future');

// ---------- the result in the address
ok(returnResult('?steam=linked') === 'linked' && returnResult('?a=1&steam=private') === 'private' && returnResult('?steam=taken') === 'taken' && returnResult('?steam=error') === 'error', 'the four results are recognised');
ok(returnResult('?steam=hacked') === null && returnResult('') === null && returnResult('?steam=') === null && returnResult('?steam=__proto__') === null && returnResult(null) === null, 'anything else is ignored');
ok(Object.keys(RESULT_TEXT).sort().join() === 'error,linked,private,taken' && Object.values(RESULT_TEXT).every((t) => t.length > 20), 'each result has a message');
ok(withoutResult('https://example.github.io/app/?steam=linked&x=1#top') === '/app/?x=1#top' && withoutResult('http://localhost:5173/?steam=private') === '/', 'the address is tidied: only the steam parameter goes');
ok(isSteamSignIn('https://steamcommunity.com/openid/login?openid.mode=checkid_setup') === true, 'Steam\'s sign-in address is recognised');
for (const bad of ['https://evil.example/openid/login', 'http://steamcommunity.com/openid/login', 'https://steamcommunity.com.evil.com/openid/login', 'https://steamcommunity.com/other', 'javascript:alert(1)', '', null, undefined, 5]) ok(isSteamSignIn(bad) === false, 'the app does not go to: ' + String(bad));

// ---------- the calls
const calls = [];
let reply = null, fnReply = null;
const client = {
  rpc: async (fn, args) => { calls.push(['rpc', fn, args]); return reply instanceof Error ? { data: null, error: { message: reply.message } } : { data: reply, error: null }; },
  functions: { invoke: async (name, opts) => { calls.push(['fn', name, opts]); return fnReply; } },
};
const api = createSteam(client);
reply = { enabled: true, linked: false, hours: 0 };
ok((await api.status()).enabled === true && calls.at(-1)[1] === 'my_steam', 'status reads my_steam and cleans it');
reply = [{ app_id: 410340, name: 'Liftoff' }];
ok((await api.apps())[0].id === 410340 && calls.at(-1)[1] === 'list_steam_apps', 'apps reads the approved list');
reply = { status: 'unlinked' };
await api.unlink(); ok(calls.at(-1)[1] === 'unlink_steam', 'unlink calls unlink_steam');
fnReply = { data: { url: 'https://steamcommunity.com/openid/login?x=1' }, error: null };
ok(await api.startLink('https://example.github.io/app/') === 'https://steamcommunity.com/openid/login?x=1' && calls.at(-1)[1] === 'steam-link' && calls.at(-1)[2].body.return === 'https://example.github.io/app/', 'startLink asks the function and returns Steam\'s sign-in address');
fnReply = { data: { url: 'https://evil.example/login' }, error: null };
let err = null; try { await api.startLink('x'); } catch (e) { err = e.message; }
ok(/not available/.test(err), 'an address that is not Steam\'s is refused, not followed');
fnReply = { data: { status: 'ok', hours_added: 2, hours: 9 }, error: null };
ok((await api.syncNow()).hours_added === 2 && calls.at(-1)[1] === 'steam-sync', 'syncNow returns the function\'s answer');
const httpError = (status, body) => ({ data: null, error: { name: 'FunctionsHttpError', context: { json: async () => { if (body instanceof Error) throw body; return body; }, status } } });
fnReply = httpError(429, { reason: 'cooldown', retry_after_seconds: 1500 });
err = null; try { await api.syncNow(); } catch (e) { err = e; }
ok(err && err.reason === 'cooldown' && err.retryAfterSeconds === 1500 && /not available yet/.test(err.message), 'a cooldown is an error with its reason and how long to wait');
fnReply = httpError(502, { status: 'error', error: 'Steam did not answer. Try again in a little while.' });
err = null; try { await api.syncNow(); } catch (e) { err = e; }
ok(err && /Steam did not answer/.test(err.message), 'the function\'s own message is kept');
fnReply = httpError(409, { reason: 'not_linked' });
err = null; try { await api.syncNow(); } catch (e) { err = e; }
ok(err && err.reason === 'not_linked' && /No Steam account/.test(err.message), 'not linked has its own wording');
fnReply = httpError(500, new Error('not json'));
err = null; try { await api.syncNow(); } catch (e) { err = e; }
ok(err && /did not work/.test(err.message) && err.reason === null, 'an unreadable error body gives a plain message');
reply = new Error('permission denied');
err = null; try { await api.status(); } catch (e) { err = e.message; }
ok(err === 'permission denied', 'a database error is thrown with its message');
ok(!calls.some((c) => JSON.stringify(c).includes('playtime') || JSON.stringify(c).includes('minutes')), 'the app never sends playtime anywhere');
