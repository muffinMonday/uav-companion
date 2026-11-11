// Live locations in the browser: the switch in Party Members (off by default), the indicator with its stop button, the party's pins on the map, hiding them,
// a refused permission, and a phone. The real Supabase client talks to a mocked HTTP server whose functions run the real database SQL on PGlite; positions come
// from the browser's emulated geolocation. Two users, two browser contexts.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
import { makeDb, as, A, B } from './lib-db.mjs';
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_my_trips', 'list_trip_members', 'list_shared_trip_versions', 'list_invitable_friends', 'list_live_locations']);
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
  if (fn === 'save_user_data') return reply({ status: 'ok', rev: 1 }); // the personal cloud copy is not what this suite tests
  const args = req.postData() ? JSON.parse(req.postData()) : {};
  const names = Object.keys(args);
  const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${JSONB.has(n) ? '::jsonb' : ''}`).join(', ')})`;
  const sql = SETOF.has(fn) ? `select to_jsonb(t) as j from ${call} t` : `select ${call} as j`;
  try {
    const rows = await serial(() => as(db, uid, sql, names.map((n) => (JSONB.has(n) ? JSON.stringify(args[n]) : args[n]))));
    return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j);
  } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};

// the shared trip, set up in the database: Alex owns it, Bea is a party member
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
await one(A, 'public.ensure_profile($1)', ['Alex']); await one(B, 'public.ensure_profile($1)', ['Bea']);
const fr = await one(A, 'public.request_friend($1)', [(await one(B, 'public.ensure_profile()')).friend_code]); await one(B, 'public.respond_friend($1, true)', [fr.id]);
const TRIP = '5a1c0000-0000-4000-8000-0000000000f1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const trip = { id: TRIP, name: 'Hubei spring', startDate: day(1), endDate: day(10), color: '#e91e63', created: '2026-01-01T00:00:00.000Z' };
await one(A, 'public.share_trip($1::jsonb)', [JSON.stringify({ v: 1, trip, items: [] })]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, (await as(db, A, 'select * from public.list_friends()'))[0].id]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
const rowOf = async (uid) => (await db.query(`select * from public.live_locations where user_id = '${uid}'`)).rows[0];

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 900 }, mobile = false, geo = null, local = false } = {}) {
  const [uid, email] = who === 'a' ? [A, 'a@example.test'] : [B, 'b@example.test'];
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, ...(geo && { permissions: ['geolocation'], geolocation: geo }) });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, tr, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.58, lon: 114.33, zoom: 11 }, basemap: 'osm' }));
    if (tr) localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: [tr] }));
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, session(uid, email), local ? trip : null, LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of 4|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  return { ctx, p };
}
const wake = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const openTripScreen = async (p) => {
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=trips]').click(); else document.getElementById('tab-trips').click(); });
  await p.waitForSelector('#trips-list .trip-card', { timeout: 15000 });
  await p.click('#trips-list .trip-card >> text=Open'); await p.waitForSelector('#trip-detail:not([hidden])');
  const party = p.locator('#trip-detail .trip-party');
  if (!(await party.evaluate((d) => d.open))) await party.locator('summary').first().click();
  await p.waitForSelector('#party-live'); await p.waitForTimeout(500);
};
const pins = (p) => p.locator('.live-pin');
const pinBox = (p) => p.locator('.live-pin b').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- both open the trip; sharing is off
const alex = await open('a', { geo: { latitude: 30.55, longitude: 114.31, accuracy: 15 }, local: true });
await openTripScreen(alex.p);
ok(!(await alex.p.isChecked('#party-live')), 'the switch to share my location is off when the app is opened');
ok(await alex.p.locator('#live-chip').isHidden() && !(await rowOf(A)), 'nothing is shown or sent');
const bea = await open('b');
await openTripScreen(bea.p);
ok(await pins(bea.p).count() === 0, 'Bea sees no pins on the map');

// ---------- Alex turns sharing on
await alex.p.check('#party-live'); await alex.p.waitForTimeout(1800);
ok(await alex.p.locator('#live-chip').isVisible() && /Sharing your location with “Hubei spring”/.test(await alex.p.textContent('#live-chip')) && await alex.p.locator('#live-chip button').isVisible(), 'an indicator with a Stop button stays on screen while sharing');
ok(/Sharing your location · accurate to about 15 m/.test(await alex.p.textContent('#trip-detail .party-live-status')), 'the section says what is happening: ' + await alex.p.textContent('#trip-detail .party-live-status'));
const chipBox = await alex.p.$eval('#live-chip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, y: r.y }; });
const panelBox = await alex.p.$eval('#panel', (e) => { const r = e.getBoundingClientRect(); return { x: r.x }; });
ok(chipBox.r <= panelBox.x && chipBox.x >= 60, 'the indicator sits in the free map area, clear of the open panel and of the map controls');
const row = await rowOf(A);
ok(row && Math.abs(row.lat - 30.55) < 1e-6 && Math.abs(row.lon - 114.31) < 1e-6, 'the position reaches the server');

// ---------- Bea sees Alex on the map
await wake(bea.p); await bea.p.waitForSelector('.live-pin', { timeout: 8000 });
ok(await pins(bea.p).count() === 1 && /Alex/.test(await bea.p.textContent('.live-pin span')) && /just now|s ago/.test(await bea.p.textContent('.live-pin span')), 'Bea sees a pin named Alex, with how long ago: ' + await bea.p.textContent('.live-pin span'));
ok(await bea.p.locator('.live-pin b').first().textContent() === 'A', 'carrying his initial');
await bea.p.waitForTimeout(600);
ok(/sharing their location/.test(await bea.p.textContent('#trip-detail .party-list')) && await bea.p.locator('#trip-detail .party-row button:has-text("Show on map")').count() === 1, 'her Party Members row for Alex says he is sharing, with a Show on map button');
await bea.p.click('#trip-detail .party-row button:has-text("Show on map")'); await bea.p.waitForTimeout(900);
ok(await pins(bea.p).count() === 1, 'Show on map works');
await alex.p.waitForTimeout(100);
ok(await alex.p.locator('.live-pin').count() === 0, 'and Alex does not see his own pin');

// ---------- moving
await sleep(5500);
await alex.ctx.setGeolocation({ latitude: 30.60, longitude: 114.36, accuracy: 9 });
await alex.p.waitForTimeout(2500);
ok(Math.abs((await rowOf(A)).lat - 30.60) < 1e-6, 'when Alex moves the new position is sent');
// bring the pin on screen for Bea before comparing positions
await bea.p.evaluate(() => document.getElementById('panel-close').click()).catch(() => {}); await bea.p.waitForTimeout(500);
const before = await pinBox(bea.p);
await wake(bea.p); await bea.p.waitForTimeout(1500);
const after = await pinBox(bea.p);
ok(before.x !== after.x || before.y !== after.y, 'and Bea\'s pin moves (' + JSON.stringify(before) + ' to ' + JSON.stringify(after) + ')');

// ---------- hiding the party on the map
await bea.p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click()); await bea.p.waitForTimeout(500);
await bea.p.uncheck('#party-map'); await bea.p.waitForTimeout(300);
ok(await pins(bea.p).count() === 0, 'Bea can choose not to see the party on the map');
await bea.p.check('#party-map'); await bea.p.waitForTimeout(300);
ok(await pins(bea.p).count() === 1, 'and bring them back');

// ---------- stopping
await alex.p.click('#live-chip button'); await alex.p.waitForTimeout(1200);
ok(await alex.p.locator('#live-chip').isHidden() && !(await alex.p.isChecked('#party-live')) && !(await rowOf(A)), 'the Stop button ends sharing: the indicator goes, the switch is off, the server holds nothing');
await wake(bea.p); await bea.p.waitForTimeout(1200);
ok(await pins(bea.p).count() === 0 && !/sharing their location/.test(await bea.p.textContent('#trip-detail .party-list')), 'and Bea\'s pin and the note disappear');

// ---------- sharing is never resumed by itself
await alex.p.check('#party-live'); await alex.p.waitForTimeout(1500);
ok(!!(await rowOf(A)), 'sharing again');
await alex.p.reload({ waitUntil: 'networkidle' }); await alex.p.waitForTimeout(2500);
await openTripScreen(alex.p);
ok(!(await alex.p.isChecked('#party-live')) && await alex.p.locator('#live-chip').isHidden(), 'after a reload sharing is off again: it is never resumed on its own');
await db.exec(`delete from public.live_locations`);
await alex.ctx.close();

// ---------- location permission refused
const denied = await open('a', { local: true });
await openTripScreen(denied.p);
await denied.p.click('#party-live'); await denied.p.waitForTimeout(2000); // the switch turns itself off again, so it is clicked, not checked
ok(!(await denied.p.isChecked('#party-live')) && /permission was refused/.test(await denied.p.textContent('#toast')) && await denied.p.locator('#live-chip').isHidden(), 'when location permission is refused the switch goes off and a message says why');
ok(!(await rowOf(A)), 'and nothing was sent');
await denied.ctx.close();

// ---------- a phone: the indicator fits beside the rail and the search
const phone = await open('a', { vp: { width: 360, height: 740 }, mobile: true, geo: { latitude: 30.55, longitude: 114.31, accuracy: 15 }, local: true });
await phone.p.tap('#dock button[data-tab=trips]'); await phone.p.waitForSelector('#trips-list .trip-card'); await phone.p.tap('#trips-list .trip-card >> text=Open'); await phone.p.waitForSelector('#party-live', { state: 'attached', timeout: 15000 }).catch(() => {});
const party = phone.p.locator('#trip-detail .trip-party'); if (!(await party.evaluate((d) => d.open))) await party.locator('summary').first().tap();
await phone.p.waitForSelector('#party-live'); await phone.p.check('#party-live'); await phone.p.waitForTimeout(1500);
await phone.p.tap('#panel-close'); await phone.p.waitForTimeout(600);
const chip = await phone.p.$eval('#live-chip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, r: r.right, y: r.y, b: r.bottom }; });
const rail = await phone.p.$eval('#dock', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.bottom }; });
ok(chip.x >= 0 && chip.r <= 360 && (chip.r <= rail.x || chip.b <= rail.y), 'on a 360 px phone the indicator stays on screen and clear of the rail');
await phone.p.tap('#live-chip button'); await phone.p.waitForTimeout(800);
await phone.ctx.close();

await bea.ctx.close();
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
