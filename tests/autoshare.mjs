// Automatic location sharing in the browser: the one-time question, sharing that starts by itself when someone in the party or a friend is online, how friends
// look on the map next to party members, and a person who stops it by hand or has it off. The real Supabase client talks to a mocked HTTP server whose functions
// run the real database SQL on PGlite; positions come from the browser's emulated geolocation. Three users: Alex (owns a trip), Bea (in the trip, also a friend
// of Alex) and Cam (a friend of Alex, not in the trip).
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => {
  const user = { id, email, aud: 'authenticated', role: 'authenticated' };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
};

const db = await makeDb();
let lock = Promise.resolve();
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const SETOF = new Set(['list_friends', 'list_blocked', 'list_my_trips', 'list_trip_members', 'list_shared_trip_versions', 'list_invitable_friends', 'list_live_locations', 'list_friend_live_locations']);
const JSONB = new Set(['p_doc']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1];
  if (fn === 'save_user_data') return reply({ status: 'ok', rev: 1 });
  const args = req.postData() ? JSON.parse(req.postData()) : {};
  const names = Object.keys(args);
  const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${JSONB.has(n) ? '::jsonb' : ''}`).join(', ')})`;
  const sql = SETOF.has(fn) ? `select to_jsonb(t) as j from ${call} t` : `select ${call} as j`;
  try {
    const rows = await serial(() => as(db, uid, sql, names.map((n) => (JSONB.has(n) ? JSON.stringify(args[n]) : args[n]))));
    return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j);
  } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};

const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await one(u, 'public.ensure_profile($1)', [n]);
const befriend = async (a, bb) => { const r = await one(a, 'public.request_friend($1)', [(await one(bb, 'public.ensure_profile()')).friend_code]); await one(bb, 'public.respond_friend($1, true)', [r.id]); };
await befriend(A, B); await befriend(A, C);
const TRIP = '5a1c0000-0000-4000-8000-0000000000f2';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const trip = { id: TRIP, name: 'Hubei spring', startDate: day(1), endDate: day(10), color: '#e91e63', created: '2026-01-01T00:00:00.000Z' };
await one(A, 'public.share_trip($1::jsonb)', [JSON.stringify({ v: 1, trip, items: [] })]);
const friendIdOf = async (uid, name) => (await as(db, uid, 'select * from public.list_friends()')).find((f) => f.display_name === name).id;
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, await friendIdOf(A, 'Bea')]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
const partyRow = async (uid) => (await db.query(`select * from public.live_locations where user_id = '${uid}'`)).rows[0];
const friendRow = async (uid) => (await db.query(`select * from public.friend_live_locations where user_id = '${uid}'`)).rows[0];

const b = await chromium.launch({ channel: CHANNEL });
const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'], c: [C, 'c@example.test'] };
async function open(who, { prefs = {}, geo = null, local = false, dialogs = null } = {}) {
  const [uid, email] = WHO[who];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, ...(geo && { permissions: ['geolocation'], geolocation: geo }) });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, tr, seen, pr]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.58, lon: 114.33, zoom: 11 }, basemap: 'osm', ...pr }));
    if (tr) localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: [tr] }));
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, session(uid, email), local ? trip : null, LATEST_SEEN, prefs]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => { if (dialogs) dialogs.push(d.message()); (dialogs?.accept === false ? d.dismiss() : d.accept()).catch(() => {}); });
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of 4|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  return { ctx, p };
}
const until = async (fn, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEO = { latitude: 30.55, longitude: 114.31, accuracy: 15 };

// ---------- Bea and Cam are online (the app records it every 30 s)
const bea = await open('b', { local: false });
const cam = await open('c');
await sleep(1500);

// ---------- Alex has not answered the question yet: it is asked once, and a yes starts sharing without any switch
const asked = [];
const alex = await open('a', { geo: GEO, local: true, dialogs: asked });
ok(await until(() => asked.length > 0, 30000), 'the first time someone is online, Alex is asked once');
ok(/Share your location automatically/.test(asked[0] || '') && /party/.test(asked[0] || '') && /friend/.test(asked[0] || ''), 'the question says what it is about: ' + (asked[0] || '').split('\n')[0]);
ok(await until(async () => !!(await partyRow(A)) && !!(await friendRow(A)), 20000), 'after yes the position goes to the party and to friends without touching a switch');
ok(await alex.p.locator('#live-chip').isVisible() && /Sharing your location with “Hubei spring” and friends/.test(await alex.p.textContent('#live-chip')), 'the indicator on the map says both: ' + await alex.p.textContent('#live-chip'));
ok(asked.length === 1, 'and he is not asked again');
const stored = await alex.p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).autoShare);
ok(stored === 'on', 'the yes is remembered in this browser');

// ---------- how others see him: Bea as party (a circle), Cam as a friend (a rounded square, with the word Friend)
await bea.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok(await until(() => bea.p.locator('.live-pin').count().then((n) => n === 1), 15000), 'Bea sees one pin for Alex');
ok(await bea.p.locator('.live-pin.friend').count() === 0 && !/Friend/.test(await bea.p.textContent('.live-pin span')), 'it is a party pin: Alex is a friend and in the party, and is shown once, as party');
const partyShape = await bea.p.$eval('.live-pin b', (e) => getComputedStyle(e).borderRadius);
ok(await until(() => cam.p.locator('.live-pin.friend').count().then((n) => n === 1), 25000), 'Cam, who is only a friend, sees a friend pin for Alex');
const friendLabel = await cam.p.textContent('.live-pin.friend span');
const friendShape = await cam.p.$eval('.live-pin.friend b', (e) => getComputedStyle(e).borderRadius);
ok(/^Friend · Alex/.test(friendLabel), 'its label says Friend, so colour is not the only difference: ' + friendLabel);
ok(parseFloat(partyShape) >= 14 && parseFloat(friendShape) < 14 && parseFloat(friendShape) > 0, 'and the shape differs: party ' + partyShape + ', friend ' + friendShape);
ok(await cam.p.locator('.live-pin').count() === 1, 'Cam sees no second pin');

// ---------- Cam can hide friends' pins
await cam.p.evaluate(() => document.querySelector('#dock button[data-tab=friends]').click());
await cam.p.waitForSelector('#fr-map', { timeout: 10000 });
await cam.p.uncheck('#fr-map'); await sleep(400);
ok(await cam.p.locator('.live-pin').count() === 0, 'Cam can choose not to see friends on the map');
await cam.p.check('#fr-map'); await sleep(400);
ok(await cam.p.locator('.live-pin.friend').count() === 1, 'and bring them back');

// ---------- stopping by hand sticks
await alex.p.click('#live-chip button'); await sleep(1500);
ok(await alex.p.locator('#live-chip').isHidden() && !(await partyRow(A)) && !(await friendRow(A)), 'the Stop button ends both');
await sleep(18000); // longer than the check that runs by itself every 15 s
ok(!(await partyRow(A)) && !(await friendRow(A)) && await alex.p.locator('#live-chip').isHidden(), 'and nothing starts again by itself although Bea and Cam are still online');
await alex.p.evaluate(() => document.querySelector('#dock button[data-tab=friends]').click());
await alex.p.waitForSelector('#fr-share', { timeout: 10000 });
ok(!(await alex.p.isChecked('#fr-share')), 'the friends switch in the Friends tab shows it is off');
await alex.p.check('#fr-share'); await sleep(2500);
ok(!!(await friendRow(A)) && await alex.p.isChecked('#fr-share'), 'turning it on by hand shares with friends again');
await alex.p.click('#live-chip button'); await sleep(1000);
ok(!(await friendRow(A)) && !(await alex.p.isChecked('#fr-share')), 'and the Stop button moves that switch back to off');
await alex.ctx.close();
await db.exec('delete from public.live_locations; delete from public.friend_live_locations');

// ---------- a person who said no is not asked and nothing starts
const none = [];
const dina = await open('a', { geo: GEO, local: true, dialogs: none, prefs: { autoShare: 'off' } });
await sleep(14000);
ok(!none.length && !(await partyRow(A)) && !(await friendRow(A)) && await dina.p.locator('#live-chip').isHidden(), 'with automatic sharing off: no question, nothing is shared');
await dina.ctx.close();

// ---------- friends can be left out
const fr = await open('a', { geo: GEO, local: true, prefs: { autoShare: 'on', shareFriends: false } });
ok(await until(async () => !!(await partyRow(A)), 30000), 'with friends switched off, the party is still shared with');
await sleep(2000);
ok(!(await friendRow(A)), 'and friends are not');
await fr.ctx.close();

await bea.ctx.close(); await cam.ctx.close();
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
