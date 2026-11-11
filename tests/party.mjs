// Party Members in the browser: sharing a trip, inviting a friend, joining, editing, leaving and deleting. The real Supabase client talks to a mocked HTTP
// server whose functions run the real database SQL on PGlite, so the interface is tested against the real access rules. Two users, two browser contexts.
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_my_trips', 'list_trip_members', 'list_shared_trip_versions', 'list_invitable_friends']);
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

// profiles and the friendship between Alex (A) and Bea (B)
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
await one(A, 'public.ensure_profile($1)', ['Alex']); await one(B, 'public.ensure_profile($1)', ['Bea']);
const fr = await one(A, 'public.request_friend($1)', [(await one(B, 'public.ensure_profile()')).friend_code]);
await one(B, 'public.respond_friend($1, true)', [fr.id]);

const TRIP = '5a1c0000-0000-4000-8000-0000000000aa';
const mk = (id, name, lat) => ({ id, type: 'photo', name, note: '', lat, lon: 114.3, created: `2026-11-01T00:00:0${id.length}.000Z`, tripId: TRIP });
const alexTrips = [{ id: TRIP, name: 'Hubei spring', country: 'CN', startDate: '2026-12-01', endDate: '2026-12-03', description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const alexItems = [mk('t1', 'Tower', 30.5), mk('t2', 'Lake', 30.6), { id: 'hm', type: 'residence', name: 'Home', note: '', lat: 30.4, lon: 114.1, created: '2026-11-01T00:00:00.000Z' }];

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { items = [], trips = [], vp = { width: 1300, height: 900 }, mobile = false, signedIn = true } = {}) {
  const [uid, email] = who === 'a' ? [A, 'a@example.test'] : [B, 'b@example.test'];
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, po, tr, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, signedIn ? session(uid, email) : null, items, trips, LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of 4/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}
const wake = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the page came back into view: look for changes
const goTrips = async (p) => { await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=trips]').click(); else document.getElementById('tab-trips').click(); }); await p.waitForTimeout(400); };
const openTrip = async (p) => { await goTrips(p); const back = p.locator('#trip-detail:not([hidden]) >> text=‹ Trips'); if (await back.count()) await back.click(); await p.click('#trips-list .trip-card >> text=Open'); await p.waitForSelector('#trip-detail:not([hidden])'); await p.waitForTimeout(300); };
const party = (p) => p.locator('#trip-detail .trip-party');
const unfold = async (p) => { if (!(await party(p).evaluate((d) => d.open))) await party(p).locator('summary').first().click(); await p.waitForTimeout(500); };
const serverTrip = async () => (await one(A, 'public.get_shared_trip($1)', [TRIP]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- signed out: the section points to sign-in
let { ctx, p } = await open('a', { items: alexItems, trips: alexTrips, signedIn: false });
await openTrip(p); await unfold(p);
ok(/Sign in/.test(await party(p).textContent()) && await party(p).locator('text=Share this trip').count() === 0, 'signed out, Party Members offers sign-in, not sharing');
await ctx.close();

// ---------- Alex shares the trip
({ ctx, p } = await open('a', { items: alexItems, trips: alexTrips }));
await openTrip(p);
ok(/Party Members/.test(await party(p).locator('summary').first().textContent()), 'a trip screen has a Party Members section');
await unfold(p);
await party(p).locator('text=Share this trip').click(); await p.waitForTimeout(1200);
ok((await serverTrip()).doc.items.map((i) => i.name).sort().join() === 'Lake,Tower', 'sharing uploads the trip and its markers, and not the Home marker');
ok(/Owner/.test(await party(p).textContent()) && /You/.test(await party(p).textContent()) && /Party Members \(1\)/.test(await party(p).locator('summary').first().textContent()), 'the owner is the first party member');
ok(/Up to date/.test(await party(p).locator('.party-status').textContent()), 'and the section says the trip is up to date: ' + await party(p).locator('.party-status').textContent());
await goTrips(p); await p.click('#trip-detail >> text=‹ Trips').catch(() => {});
ok(/Shared · you own it/.test(await p.textContent('#trips-list')), 'the trip list marks it as shared, by you');

// ---------- inviting Bea
await openTrip(p); await unfold(p);
ok((await party(p).locator('.party-invite select option').allTextContents()).join() === 'Bea', 'the invite picker lists the friends who are not in the trip: Bea');
await party(p).locator('.party-invite button').click(); await p.waitForTimeout(1200);
ok(/Bea/.test(await party(p).textContent()) && /Invited/.test(await party(p).textContent()), 'inviting shows Bea as invited');
ok(await party(p).locator('.party-invite select').count() === 0, 'and she drops off the picker');

// ---------- Bea joins
const bea = await open('b');
await bea.p.evaluate(() => { document.querySelector('#dock button[data-tab=friends]')?.click() || document.getElementById('tab-friends').click(); }); await bea.p.waitForTimeout(900);
ok(/Hubei spring/.test(await bea.p.textContent('#party-invites')) && /from Alex/.test(await bea.p.textContent('#party-invites')) && /2026-12-01/.test(await bea.p.textContent('#party-invites')), 'Bea sees the invitation in Friends, with the trip, the owner and the dates');
ok(await bea.p.locator('#tab-friends .tab-badge:not([hidden])').textContent() === '1', 'the Friends tab carries a badge for it');
await bea.p.click('#party-invites >> text=Join'); await bea.p.waitForTimeout(1500);
ok(!(await bea.p.locator('#party-invites').count()), 'joining clears the invitation');
await goTrips(bea.p);
ok(/Hubei spring/.test(await bea.p.textContent('#trips-list')) && /Shared · by Alex/.test(await bea.p.textContent('#trips-list')), 'the trip is in Bea\'s Trips, marked as shared by Alex');
await openTrip(bea.p); await unfold(bea.p);
ok(/Alex/.test(await party(bea.p).textContent()) && /Owner/.test(await party(bea.p).textContent()) && /Leave trip/.test(await party(bea.p).textContent()), 'her Party Members shows the owner and a Leave button');
ok(await bea.p.locator('#trip-detail .trip-acts button:has-text("Delete")').count() === 0, 'and she has no Delete button: only the owner deletes a shared trip');
await bea.p.evaluate(() => document.getElementById('tab-poi').click()); await bea.p.waitForTimeout(300);
ok((await bea.p.textContent('#poi-list')).includes('Tower') && (await bea.p.textContent('#poi-list')).includes('Lake') && !(await bea.p.textContent('#poi-list')).includes('Home'), 'the trip\'s markers are in her list, and not Alex\'s Home');

// ---------- Bea edits; Alex sees it
await goTrips(bea.p);
await bea.p.fill('#trip-detail .check-add input', 'Batteries charged'); await bea.p.click('#trip-detail .check-add button'); await bea.p.waitForTimeout(3500);
ok((await serverTrip()).doc.trip.checklist?.some((c) => c.text === 'Batteries charged'), 'an edit by Bea (a checklist item) is saved to the shared trip');
await wake(p); await p.waitForTimeout(1500);
ok(/Batteries charged/.test(await p.textContent('#trip-detail')), 'Alex sees it as soon as his page is back in view');
ok(/Bea/.test(await party(p).textContent()) && !/Invited/.test(await party(p).textContent()) && /Party Members \(2\)/.test(await party(p).locator('summary').first().textContent()), 'and his Party Members shows Bea as joined (2)');

// ---------- earlier versions
await party(p).locator('.party-versions summary').click(); await p.waitForTimeout(800);
ok(await party(p).locator('.party-version').count() >= 1 && /Bea|Alex/.test(await party(p).locator('.party-version').first().textContent()), 'earlier versions are listed with who saved them');

// ---------- Bea leaves and keeps a private copy
await bea.p.click('#trip-detail >> text=Leave trip'); await bea.p.waitForTimeout(1500);
await goTrips(bea.p);
ok(!/Shared/.test(await bea.p.textContent('#trips-list')) && /Hubei spring/.test(await bea.p.textContent('#trips-list')), 'Bea leaves: the trip stays in her Trips, no longer shared');
ok(await bea.p.locator('#trips-list .trip-acts button:has-text("Delete")').count() === 1, 'and she can now delete it, because it is hers');
await wake(p); await p.waitForTimeout(1500);
ok(/Party Members \(1\)/.test(await party(p).locator('summary').first().textContent()), 'Alex sees that she left (1)');

// ---------- the owner deletes the shared trip
await p.click('#trip-detail .trip-acts button:has-text("Delete")'); await p.waitForTimeout(300);
ok(/deletes it for the whole party/.test(await p.textContent('#trip-detail .trip-acts button.danger')), 'the owner\'s Delete says it deletes the trip for the whole party');
await p.click('#trip-detail .trip-acts button.danger'); await p.waitForTimeout(1500);
ok((await db.query('select count(*)::int as n from public.shared_trips')).rows[0].n === 0 && !(await p.locator('#trips-list .trip-card').count()), 'confirming deletes the shared trip on the server and the trip here');
await bea.ctx.close(); await ctx.close();

// ---------- a phone: the section fits
({ ctx, p } = await open('a', { items: alexItems, trips: alexTrips, vp: { width: 360, height: 740 }, mobile: true }));
await p.tap('#dock button[data-tab=trips]'); await p.waitForTimeout(500);
await p.tap('#trips-list .trip-card >> text=Open'); await p.waitForSelector('#trip-detail:not([hidden])'); await p.waitForTimeout(300);
await party(p).locator('summary').first().tap(); await p.waitForTimeout(400);
const fit = await p.evaluate(() => { const d = document.querySelector('#trip-detail .trip-party').getBoundingClientRect(), pn = document.getElementById('panel').getBoundingClientRect(); return { right: d.right, panel: pn.right, scroll: document.querySelector('.sp-body').scrollWidth <= document.querySelector('.sp-body').clientWidth + 1 }; });
ok(fit.right <= fit.panel && fit.scroll, 'on a 360 px phone the Party Members section fits without sideways scrolling');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
