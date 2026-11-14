// The Sessions map explorer in a real browser: the non-modal dock (a left panel or a bottom sheet), card selection that puts the marker in the middle of the visible map, the Map / Navigate / Details
// buttons, rapid selection, manual panning, recurring occurrences at one place, cards without a meeting point, the guest / signed-in boundary, sign-out clean-up, keyboard, foldable sizes and a turned map.
// The real Supabase client talks to a mocked HTTP server whose functions run the real SQL on an in-memory Postgres (PGlite), as in sessions.mjs.
// Emulated only: touch and viewport sizes (Playwright). A real foldable and a real phone are NOT exercised. Screenshots go to tests/out/explorer/.
import { chromium, CHANNEL, OUT } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/explorer`; fs.mkdirSync(SHOTS, { recursive: true });

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id, email, aud: 'authenticated', role: 'authenticated' } };
};
const db = await makeDb();
let lock = Promise.resolve();
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({}, 200);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => args[n]))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
const WHO = { b: [B, 'b@example.test'], c: [C, 'c@example.test'] };
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);

// ---------- the data: B hosts. Three occurrences at one place, six more public places, one private place, one private session with no meeting point
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const ins = async (title, lat, lng, h, vis = 'public', loc = null) => (await db.query(`insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, timezone) values ($1, 'Bring batteries', $2, $3, $4, $5, $6, $7, $8, 'published', 'Asia/Shanghai') returning id`, [title, loc, lat, lng, hr(h), hr(h + 2), B, vis])).rows[0].id;
const rec = [await ins('Saturday meetup', 30.6, 114.3, 24, 'public', 'East Lake'), await ins('Saturday meetup', 30.6, 114.3, 48, 'public', 'East Lake'), await ins('Saturday meetup', 30.6, 114.3, 72, 'public', 'East Lake')];
const beta = await ins('Beta lake', 30.65, 114.35, 30, 'public', 'Beta shore'), gamma = await ins('Gamma park', 30.55, 114.2, 36);
for (const [t, la, ln, h] of [['Delta ridge', 30.7, 114.45, 40], ['Echo field', 30.5, 114.1, 44], ['Foxtrot dam', 30.62, 114.28, 50], ['Golf pier', 30.58, 114.33, 55]]) await ins(t, la, ln, h);
const priv = await ins('Private club', 30.7, 114.4, 31, 'private', 'Secret field');
await db.query(`insert into public.flight_sessions (title, starts_at, ends_at, created_by, visibility, publication, timezone) values ('Draft idea', $1, $2, $3, 'private', 'published', 'Asia/Shanghai')`, [hr(60), hr(62), B]);

const b = await chromium.launch({ channel: CHANNEL });
const external = [];
async function open(who, { vp = { width: 1300, height: 850 }, touch = false, motion = false, dark = false, prefs = {} } = {}) {
  const [uid, email] = WHO[who] ?? [null, null]; // 'guest': nobody signed in
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: motion ? 'no-preference' : 'reduce', colorScheme: dark ? 'dark' : 'light' });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.route(/^https:\/\/(www\.google\.com|uri\.amap\.com)\//, (r) => { external.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }); });
  await ctx.addInitScript(([ref, sess, pf]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', ...pf }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, prefs]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}
const hub = '#ses-hub', body = hub + ' .ses-hub-inner', X = '#ses-explorer';
const rowOf = (p, title, n = 0) => p.locator(`${body} .ses-row`, { hasText: title }).nth(n);
const cardOf = (p, id) => p.locator(`${X} .ses-xcard[data-id="${id}"]`);
const openHub = async (p, tab = 'discover') => { await p.click('.sessions-btn'); await p.waitForSelector(hub + '[open]'); if (tab !== 'discover') await p.click(`${hub} .ses-tab[data-section=${tab}]`); await p.waitForSelector(body + ' .ses-row', { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(300); };
const explore = async (p, tab = 'discover') => { await openHub(p, tab); await p.click(body + ' [data-act=explore]'); await p.waitForSelector(X + ':not([hidden])'); await p.waitForTimeout(500); };
const closeX = async (p) => { await p.click('#ses-x-close'); await p.waitForTimeout(200); };
const settle = (p, ms = 800) => p.waitForTimeout(ms);
const selectedId = (p) => p.evaluate(() => document.querySelector('#ses-explorer .ses-xcard[data-selected=true]')?.dataset.id ?? null);
const selectedCount = (p) => p.locator(`${X} .ses-xcard[data-selected=true]`).count();
// The part of the map the dock and the open side panel leave free, and where the selected marker really is on the screen (both from the DOM, so a turned map is measured too).
const visible = (p) => p.evaluate(() => {
  const m = document.getElementById('map').getBoundingClientRect(), d = document.getElementById('ses-explorer'), pn = document.getElementById('panel');
  const r = { l: m.left, t: m.top, r: m.right, b: m.bottom };
  if (d && !d.hidden) { const q = d.getBoundingClientRect(); if (d.dataset.mode === 'side') { if (d.dataset.collapsed !== 'true') r.l = Math.max(r.l, q.right); } else r.b = Math.min(r.b, q.top); }
  if (pn && !pn.hidden) { const q = pn.getBoundingClientRect(); if (q.height > 0.7 * (r.b - r.t)) r.r = Math.min(r.r, q.left); else if (q.width >= 0.7 * (r.r - r.l)) r.b = Math.min(r.b, q.top); }
  return { cx: (r.l + r.r) / 2, cy: (r.t + r.b) / 2, w: r.r - r.l, h: r.b - r.t };
});
const marker = (p, sel = '.ses-map-pin.sel') => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
const offBy = async (p, sel) => { const v = await visible(p), m = await marker(p, sel); return m ? Math.hypot(m.x - v.cx, m.y - v.cy) : 1e9; };
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const goProfile = async (p) => { await p.evaluate(() => { const pop = document.getElementById('account-pop'); const bb = [document.getElementById('account-btn'), document.getElementById('dock-account')].find((x) => x && x.offsetParent !== null); if (!pop.hidden) bb.click(); bb.click(); }); await p.waitForTimeout(700); };
const watchSelections = (p) => p.evaluate(() => { window.__sel = 0; new MutationObserver((rs) => { for (const r of rs) if (r.attributeName === 'data-selected' && r.target.dataset.selected === 'true') window.__sel++; }).observe(document.getElementById('ses-explorer'), { subtree: true, attributes: true, attributeFilter: ['data-selected'] }); });

// ======================================================================= desktop, a guest, a mouse
let { ctx, p } = await open('guest');
await openHub(p);
const rowsHub = await p.locator(body + ' .ses-row').count();
ok(rowsHub === 9, `Discover lists the nine public sessions (${rowsHub}) and never the private ones`);
const r0 = rowOf(p, 'Beta lake');
ok(await r0.locator('button[data-act=map]').count() === 1 && await r0.locator('a[data-act=navigate]').count() === 1 && await r0.locator('[data-act=details]').count() === 1, 'a session card has Map, Navigate and Details');
const nav = r0.locator('a[data-act=navigate]');
const href = await nav.getAttribute('href');
ok(await nav.getAttribute('target') === '_blank' && /noopener/.test(await nav.getAttribute('rel')) && /noreferrer/.test(await nav.getAttribute('rel')), 'Navigate is an external link in a new tab (noopener noreferrer)');
ok(/^https:\/\/uri\.amap\.com\/navigation\?to=114\.35\d+,30\.64\d+,Beta%20lake&mode=car&/.test(href), 'inside China the automatic Maps setting gives Amap navigation, driving: ' + href);
ok(await r0.locator('button[data-act=map]').evaluate((e) => e.tagName === 'BUTTON' && !e.classList.contains('maplink')) && /\bMap\b/.test(await r0.locator('button[data-act=map]').textContent()) && /Navigate/.test(await nav.textContent()), 'Map is an internal button, Navigate an external link, both with visible text');
ok(await r0.locator('.map-action').first().evaluate((e) => { const c = getComputedStyle(e); return parseFloat(c.borderTopWidth) >= 1 && c.borderTopStyle === 'solid' && e.querySelector('svg') && e.getBoundingClientRect().width > 50; }), 'the buttons are outlined, with an icon and text');
await nav.click(); await p.waitForTimeout(500);
ok(external.some((u) => /uri\.amap\.com\/navigation\?to=114\.35/.test(u)) && await p.locator(hub + '[open]').count() === 1, 'tapping Navigate opens the directions and leaves the hub as it was');

// the general entry: no card selected, the map does not move
await p.click(body + ' [data-act=explore]'); await p.waitForSelector(X + ':not([hidden])'); await p.waitForTimeout(500);
const dock = await rect(p, X), vw = 1300;
ok(await p.locator(hub + '[open]').count() === 0 && await p.getAttribute(X, 'data-mode') === 'side', 'Explore on map closes the modal hub and docks the explorer at the side');
ok(dock.l < 20 && dock.w >= 300 && dock.w <= 360 && dock.w <= 0.42 * vw && dock.t < 20 && dock.b > 800, `the dock is a left panel 300 to 360 px wide (${Math.round(dock.w)} px) over the full height`);
ok(await p.locator(`${X} .ses-xcard`).count() === 9 && await selectedCount(p) === 0, 'nine cards, none selected after the general entry');
ok(await p.locator('.ses-map-pin').count() === 7 && await p.locator('.ses-map-pin .ses-pin-n').count() === 1 && /^3$/.test(await p.locator('.ses-map-pin .ses-pin-n').textContent()), 'the three occurrences at one place share one marker (badge 3): seven markers for nine cards');
const m0 = await marker(p, '.ses-map-pin'); await settle(p, 700); const m1 = await marker(p, '.ses-map-pin');
ok(Math.hypot(m1.x - m0.x, m1.y - m0.y) < 1, 'entering from the general action does not move the map');
ok(await p.evaluate(() => document.activeElement?.id === 'ses-x-title'), 'focus goes to the dock heading');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('.leaflet-control-zoom-in')).visibility !== 'hidden' && document.elementFromPoint(...(() => { const r = document.querySelector('.leaflet-control-zoom-in').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()).closest('.leaflet-control-zoom') !== null), 'the zoom buttons are shifted beside the dock, not under it');
ok(await p.evaluate(() => { const c = document.getElementById('map'); return !c.closest('[inert]') && !document.querySelector('dialog[open]'); }), 'nothing modal is open: the map is not inert');
await p.screenshot({ path: `${SHOTS}/desktop-general.png` });

// selecting a card centres its marker in the free part of the map
const gId = (await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).getAttribute('data-id'));
await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).locator('.ses-xsel').click(); await settle(p);
let off = await offBy(p, '.ses-map-pin.sel');
ok(await selectedId(p) === gId && off <= 16, `tapping a card selects it and centres its marker in the free map area (${off.toFixed(1)} px off)`);
ok(await cardOf(p, gId).locator('.ses-xsel').getAttribute('aria-current') === 'true' && await cardOf(p, gId).evaluate((e) => e.classList.contains('selected')), 'the selected card shows it (class and aria-current)');
const seen = await marker(p, '.ses-map-pin.sel');
// the other marker keeps its distance after the first zoom: a later selection keeps the person's zoom
await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel').click(); await settle(p);
const dist1 = await p.evaluate(() => { const a = document.querySelector('.ses-map-pin.sel').getBoundingClientRect(), z = [...document.querySelectorAll('.ses-map-pin')].find((e) => e.dataset.id !== document.querySelector('.ses-map-pin.sel').dataset.id).getBoundingClientRect(); return Math.hypot(a.x - z.x, a.y - z.y); });
await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).locator('.ses-xsel').click(); await settle(p);
const dist2 = await p.evaluate(() => { const a = document.querySelector('.ses-map-pin.sel').getBoundingClientRect(), z = [...document.querySelectorAll('.ses-map-pin')].find((e) => e.dataset.id !== document.querySelector('.ses-map-pin.sel').dataset.id).getBoundingClientRect(); return Math.hypot(a.x - z.x, a.y - z.y); });
ok(await offBy(p, '.ses-map-pin.sel') <= 16 && dist1 > 0 && seen, 'a second selection also lands in the middle');
// the keyboard: Tab to a card, Enter selects it
await p.locator(`${X} .ses-xcard`, { hasText: 'Delta ridge' }).locator('.ses-xsel').focus(); await p.keyboard.press('Enter'); await settle(p);
ok(await p.evaluate(() => document.querySelector('#ses-explorer .ses-xcard[data-selected=true] .ses-xtitle')?.textContent) === 'Delta ridge' && await offBy(p, '.ses-map-pin.sel') <= 16, 'Enter on a focused card selects it and centres it (keyboard)');
await p.locator(`${X} .ses-xcard`, { hasText: 'Echo field' }).locator('.ses-xsel').focus(); await p.keyboard.press('Space'); await settle(p);
ok(await p.evaluate(() => document.querySelector('#ses-explorer .ses-xcard[data-selected=true] .ses-xtitle')?.textContent) === 'Echo field', 'Space selects a card too');

// scrolling the list does not select anything and does not move the map
await p.locator(`${X} .ses-xcard`, { hasText: 'Delta ridge' }).locator('.ses-xsel').click(); await settle(p);
const before = await marker(p, '.ses-map-pin.sel'), sid = await selectedId(p);
await p.mouse.move(150, 500); await p.mouse.wheel(0, 500); await settle(p, 1200);
const scrolled = await p.evaluate(() => document.querySelector('#ses-explorer .ses-x-body').scrollTop);
const after = await marker(p, '.ses-map-pin.sel');
ok(scrolled > 100 && await selectedId(p) === sid && Math.hypot(after.x - before.x, after.y - before.y) < 1, `scrolling the list (${Math.round(scrolled)} px) selects nothing and does not recentre the map`);

// the map stays interactive: a drag moves it and is respected until the next selection
const v = await visible(p);
await p.mouse.move(v.cx, v.cy + 150); await p.mouse.down(); await p.mouse.move(v.cx + 90, v.cy + 190, { steps: 8 }); await p.mouse.up(); await settle(p, 500);
const dragged = await marker(p, '.ses-map-pin.sel');
ok(Math.hypot(dragged.x - before.x, dragged.y - before.y) > 60, 'dragging the map works while the dock is open');
await p.mouse.move(150, 500); await p.mouse.wheel(0, -300); await settle(p, 500);
const still = await marker(p, '.ses-map-pin.sel');
ok(Math.hypot(still.x - dragged.x, still.y - dragged.y) < 1 && await selectedId(p) === sid, 'a manual pan stays where the person put it (scrolling the list does not undo it)');
const gap = () => p.evaluate(() => { const r = [...document.querySelectorAll('.ses-map-pin')].map((e) => e.getBoundingClientRect()); return Math.hypot(r[0].x - r[1].x, r[0].y - r[1].y); });
const gap0 = await gap(); await p.click('.leaflet-control-zoom-out'); await p.waitForFunction(([g]) => { const r = [...document.querySelectorAll('.ses-map-pin')].map((e) => e.getBoundingClientRect()); return Math.hypot(r[0].x - r[1].x, r[0].y - r[1].y) < g * 0.75; }, [gap0], { timeout: 6000 }).catch(() => {}); await settle(p, 400);
ok(await gap() < gap0 * 0.75, 'the map zoom control works beside the dock (the markers moved closer together)');
await p.locator(`${X} .ses-xcard`, { hasText: 'Delta ridge' }).locator('[data-act=map]').click(); await settle(p);
ok(await offBy(p, '.ses-map-pin.sel') <= 16, 'the card\'s Map button brings the marker back to the middle after a manual pan');

// card actions do not select twice, and Navigate / Details do not select at all
await watchSelections(p);
await p.locator(`${X} .ses-xcard`, { hasText: 'Golf pier' }).locator('[data-act=map]').click(); await settle(p, 500);
ok(await p.evaluate(() => window.__sel) === 1, 'the Map button selects the card exactly once (the click does not also reach the card)');
const sel2 = await selectedId(p); const ext = external.length;
await p.locator(`${X} .ses-xcard`, { hasText: 'Foxtrot dam' }).locator('a[data-act=navigate]').click(); await settle(p, 400);
ok(await selectedId(p) === sel2 && await p.evaluate(() => window.__sel) === 1 && external.length > ext, 'Navigate opens the directions and does not select the card');

// rapid selection: the last tap wins (motion allowed in this context below); here the quick sequence with reduced motion
await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel').click();
await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).locator('.ses-xsel').click();
await p.locator(`${X} .ses-xcard`, { hasText: 'Echo field' }).locator('.ses-xsel').click(); await settle(p, 900);
ok(await p.evaluate(() => document.querySelector('#ses-explorer .ses-xcard[data-selected=true] .ses-xtitle')?.textContent) === 'Echo field' && await selectedCount(p) === 1 && await offBy(p, '.ses-map-pin.sel') <= 16, 'rapid taps settle on the last card');

// recurring occurrences: three cards, one marker, each card selects its own occurrence
const occ = p.locator(`${X} .ses-xcard`, { hasText: 'Saturday meetup' });
ok(await occ.count() === 3, 'the three recurring occurrences are three cards');
const times = await occ.locator('.ses-xwhen').allTextContents();
ok(new Set(times).size === 3, 'their dates differ: ' + times.join(' | '));
await occ.nth(1).locator('.ses-xsel').click(); await settle(p);
ok(await selectedId(p) === rec[1] && await offBy(p, '.ses-map-pin.sel') <= 16 && await p.locator('.ses-map-pin').count() === 7, 'the second occurrence is selected by its own id, centred, and no extra marker appears');
ok((await p.locator('.ses-map-pin.sel').getAttribute('title')).includes(times[1]), 'the marker names the selected occurrence: ' + await p.locator('.ses-map-pin.sel').getAttribute('title'));
await occ.nth(2).locator('.ses-xsel').click(); await settle(p, 500);
ok(await selectedId(p) === rec[2] && await p.locator('.ses-map-pin.sel').count() === 1 && (await p.locator('.ses-map-pin.sel').getAttribute('title')).includes(times[2]), 'another occurrence at the same place moves the selection and the marker label');
await p.locator('.ses-map-pin.sel').click(); await settle(p, 500);
ok(await selectedId(p) === rec[0], 'tapping the shared marker steps to the next occurrence');
await p.screenshot({ path: `${SHOTS}/desktop-selected.png` });

// Details opens the right session in the hub, and Back returns to the list
await occ.nth(1).locator('[data-act=details]').click(); await p.waitForSelector(hub + '[open]'); await p.waitForTimeout(500);
ok(await p.locator(X).isHidden() && await p.locator('.ses-map-pin').count() === 0 && (await p.textContent(body + ' .ses-top h3')) === 'Saturday meetup', 'Details leaves the explorer, removes its markers and opens that session in the full hub');
ok((await p.textContent(body + ' .ses-when')) === times[1], 'it is the occurrence that was chosen (same date and time)');
await p.click('#ses-back'); await p.waitForTimeout(300);
ok(await p.locator(`${hub} .ses-tab[aria-selected=true]`).getAttribute('data-section') === 'discover' && await p.locator(body + ' .ses-row').count() === 9, 'Back returns to the Discover list');

// Expand restores the hub exactly as it was (tab, filter)
await p.fill('#ses-q', 'Saturday'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(600);
await p.click(body + ' [data-act=explore]'); await p.waitForSelector(X + ':not([hidden])'); await p.waitForTimeout(400);
ok(await p.locator(`${X} .ses-xcard`).count() === 3 && await p.locator('.ses-map-pin').count() === 1, 'the explorer lists the filtered sessions only (three, one place)');
await p.click('#ses-x-expand'); await p.waitForSelector(hub + '[open]'); await p.waitForTimeout(400);
ok(await p.inputValue('#ses-q') === 'Saturday' && await p.locator(body + ' .ses-row').count() === 3 && await p.locator(X).isHidden() && await p.locator('.ses-map-pin').count() === 0, 'Expand returns to the hub with the same filter and removes the dock and markers');
ok(await p.evaluate(() => document.activeElement?.classList.contains('ses-tab')), 'focus lands on the hub tab');
// the Map button on a hub card selects that occurrence
await rowOf(p, 'Saturday meetup', 2).locator('[data-act=map]').click(); await p.waitForSelector(X + ':not([hidden])'); await settle(p);
ok(await selectedId(p) === rec[2] && await offBy(p, '.ses-map-pin.sel') <= 16, 'the Map button on a hub card opens the explorer with that occurrence selected and centred');

// Escape and Close: exit, clean up, focus back on the launching control
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(await p.locator(X).isHidden() && await p.locator('.ses-map-pin').count() === 0 && await p.evaluate(() => !document.body.dataset.sesx && !document.documentElement.style.getPropertyValue('--ses-x-w')), 'Escape closes the explorer, removes the markers and the layout variables');
ok(await p.evaluate(() => document.activeElement?.classList.contains('sessions-btn')), 'focus returns to the control that opened the sessions');
for (let i = 0; i < 3; i++) { await explore(p); await closeX(p); }
await explore(p);
ok(await p.locator('.ses-map-pin').count() === 1 && await p.locator(`${X} .ses-xcard`).count() === 3 && await p.locator('.ses-map-pin .ses-pin-n').count() === 1, 'opening and closing three times leaves no duplicate markers or cards (the Saturday filter is still applied)');
await closeX(p);

// the unfiltered Details text and the guest boundary
ok(!(await p.evaluate(() => document.body.textContent)).includes('Secret field'), 'a guest never sees the private place');
await ctx.close();

// Navigate follows the Maps settings: Google Maps and walking
({ ctx, p } = await open('guest', { prefs: { mapApp: 'google', mapMode: 'walk' } }));
await openHub(p);
const gHref = /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=30\.650000%2C114\.350000&travelmode=walking$/;
ok(gHref.test(await rowOf(p, 'Beta lake').locator('a[data-act=navigate]').getAttribute('href')), 'with Google Maps and Walk chosen in the Maps settings the hub card links to Google walking directions');
await p.click(body + ' [data-act=explore]'); await p.waitForSelector(X + ':not([hidden])');
ok(gHref.test(await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('a[data-act=navigate]').getAttribute('href')), 'and so does the explorer card');
await ctx.close();

// ======================================================================= the main side panel and a short window
({ ctx, p } = await open('guest', { vp: { width: 850, height: 700 }, touch: true }));
ok(await p.evaluate(() => !document.getElementById('panel').hidden), 'precondition: the side panel is open at 850x700');
await explore(p);
ok(await p.getAttribute(X, 'data-mode') === 'side' && await p.evaluate(() => document.getElementById('panel').hidden), '850x700: left dock, and the side panel steps aside because the map would be too small');
let pv = await visible(p);
ok(pv.w >= 320, `the free map area is at least 320 px wide (${Math.round(pv.w)})`);
await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel').tap(); await settle(p);
off = await offBy(p, '.ses-map-pin.sel'); ok(off <= 16, `850x700 tap: marker centred (${off.toFixed(1)} px)`);
await p.screenshot({ path: `${SHOTS}/850x700-selected.png` });
await closeX(p);
ok(await p.evaluate(() => !document.getElementById('panel').hidden && !JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').panelCollapsed), 'closing the explorer brings the side panel back and the saved panel choice is untouched');
await ctx.close();

// ======================================================================= viewports: folded phone, unfolded, tablets, landscape, desktop, dark
const VPS = [['folded phone', 390, 844, true, 'bottom'], ['unfolded portrait', 700, 850, true, 'side'], ['unfolded landscape', 850, 700, true, 'side'], ['tablet portrait', 768, 1024, true, 'side'], ['tablet landscape', 1024, 768, true, 'side'],
  ['narrow desktop window', 560, 800, false, 'bottom'], ['short landscape phone', 850, 400, true, 'side'], ['desktop', 1440, 900, false, 'side']];
for (const [name, w, h, touch, expect] of VPS) {
  for (const dark of (name === 'folded phone' || name === 'desktop' ? [false, true] : [false])) {
    ({ ctx, p } = await open('guest', { vp: { width: w, height: h }, touch, dark }));
    const tag = `${name} ${w}x${h}${dark ? ' dark' : ''}`;
    await explore(p);
    const d = await rect(p, X);
    ok(await p.getAttribute(X, 'data-mode') === expect, `${tag}: ${expect} dock`);
    if (expect === 'side') ok(d.l >= 0 && d.r <= w && d.t >= 0 && d.b <= h && d.w >= 300 && d.w <= 360 && d.w <= 0.43 * w, `${tag}: side dock inside the screen, 300 to 360 px (${Math.round(d.w)}), at most ~42% of the width`);
    else ok(d.l >= 0 && d.r <= w && d.b <= h && d.h >= 0.3 * h - 4 && d.h <= 0.4 * h + 4, `${tag}: bottom sheet inside the screen, 30 to 40% of the height (${Math.round(d.h)} of ${h})`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('ses-explorer').scrollWidth <= document.getElementById('ses-explorer').clientWidth + 1), `${tag}: nothing scrolls sideways`);
    const tap = touch ? (loc) => loc.tap() : (loc) => loc.click();
    await tap(p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel')); await settle(p);
    off = await offBy(p, '.ses-map-pin.sel');
    ok(off <= 16 && await selectedId(p) !== null, `${tag}: the selected marker is ${off.toFixed(1)} px from the middle of the free map area`);
    if (touch) {
      const bt = await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).locator('.map-action').first().evaluate((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
      ok(bt[1] >= 43.5, `${tag}: the card buttons are at least 44 px tall (${Math.round(bt[1])})`);
      const hb = await p.locator('#ses-x-close').evaluate((e) => e.getBoundingClientRect().width);
      ok(hb >= 43.5, `${tag}: the dock buttons are at least 44 px wide`);
    }
    // a collapsed dock keeps the handle and gives the map back its room
    await p.click('#ses-x-fold'); await settle(p, 500);
    ok(await p.locator(`${X} .ses-x-body`).isHidden() && await p.getAttribute('#ses-x-fold', 'aria-expanded') === 'false', `${tag}: Collapse leaves the header only`);
    ok(await offBy(p, '.ses-map-pin.sel') <= 16, `${tag}: after collapsing, the marker is back in the middle of the free area`);
    await p.click('#ses-x-fold'); await settle(p, 500);
    ok(await offBy(p, '.ses-map-pin.sel') <= 16 && await p.locator(`${X} .ses-x-body`).isVisible(), `${tag}: Show the list restores the dock and the centring`);
    if (name === 'folded phone' || name === 'desktop') await p.screenshot({ path: `${SHOTS}/${w}x${h}${dark ? '-dark' : ''}-selected.png` });
    await ctx.close();
  }
}

// ======================================================================= fold and rotate: the dock moves, the selection stays, the marker is centred again
({ ctx, p } = await open('guest', { vp: { width: 850, height: 700 }, touch: true }));
await explore(p);
await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel').tap(); await settle(p);
const keep = await selectedId(p);
await p.setViewportSize({ width: 390, height: 844 }); await settle(p, 900);
ok(await p.getAttribute(X, 'data-mode') === 'bottom' && await selectedId(p) === keep && await offBy(p, '.ses-map-pin.sel') <= 16, 'folding to 390x844 moves the dock to the bottom, keeps the selected card and recentres its marker');
await p.setViewportSize({ width: 850, height: 700 }); await settle(p, 900);
ok(await p.getAttribute(X, 'data-mode') === 'side' && await selectedId(p) === keep && await offBy(p, '.ses-map-pin.sel') <= 16, 'unfolding returns to the side dock with the same selection, centred');
await p.setViewportSize({ width: 700, height: 850 }); await settle(p, 900);
ok(await selectedId(p) === keep && await offBy(p, '.ses-map-pin.sel') <= 16, 'rotating to 700x850 keeps the selection centred');
await ctx.close();

// ======================================================================= a turned map
for (const [w, h, bearing] of [[1300, 850, 35], [390, 844, -70]]) {
  ({ ctx, p } = await open('guest', { vp: { width: w, height: h }, touch: w < 600 }));
  await p.evaluate((deg) => document.getElementById('map')._rot.set(deg, 'compass'), bearing); await settle(p, 400);
  await explore(p);
  for (const t of ['Beta lake', 'Gamma park', 'Echo field']) {
    await p.locator(`${X} .ses-xcard`, { hasText: t }).locator('.ses-xsel').click(); await settle(p);
    off = await offBy(p, '.ses-map-pin.sel');
    ok(off <= 16, `map turned ${bearing}° at ${w}x${h}: ${t} lands ${off.toFixed(1)} px from the middle of the free area`);
  }
  await p.screenshot({ path: `${SHOTS}/${w}x${h}-rotated.png` });
  await ctx.close();
}

// ======================================================================= motion allowed: quick taps while the first zoom is still animating
({ ctx, p } = await open('guest', { motion: true }));
await explore(p);
await p.locator(`${X} .ses-xcard`, { hasText: 'Beta lake' }).locator('.ses-xsel').click();
await p.waitForTimeout(60);
await p.locator(`${X} .ses-xcard`, { hasText: 'Gamma park' }).locator('.ses-xsel').click();
await p.waitForTimeout(60);
await p.locator(`${X} .ses-xcard`, { hasText: 'Foxtrot dam' }).locator('.ses-xsel').click(); await settle(p, 1800);
ok(await p.evaluate(() => document.querySelector('#ses-explorer .ses-xcard[data-selected=true] .ses-xtitle')?.textContent) === 'Foxtrot dam' && await offBy(p, '.ses-map-pin.sel') <= 16, `with animation on, quick taps during the first zoom settle on the last card (${(await offBy(p, '.ses-map-pin.sel')).toFixed(1)} px)`);
await ctx.close();

// ======================================================================= signed in: private sessions, no-point cards, Home, sign-out clean-up, stale state
({ ctx, p } = await open('b'));
await openHub(p, 'mine');
const mineRows = await p.locator(body + ' .ses-row').count();
ok(mineRows >= 11 && await p.locator(body + ' [data-act=explore]').count() === 1, `My sessions lists what B hosts (${mineRows} cards) with an Explore on map button`);
const draftRow = rowOf(p, 'Draft idea');
ok(await draftRow.locator('button[data-act=map]').count() === 0 && await draftRow.locator('a[data-act=navigate]').count() === 0 && /No meeting point set/.test(await draftRow.textContent()) && await draftRow.locator('[data-act=details]').count() === 1, 'a session with no meeting point shows no Map or Navigate, says why, and keeps Details');
await p.click(body + ' [data-act=explore]'); await p.waitForSelector(X + ':not([hidden])'); await settle(p, 500);
ok(await p.locator(`${X} .ses-xcard`).count() === mineRows && await p.locator(`${X} .ses-xcard`, { hasText: 'Private club' }).count() === 1, 'the explorer shows the private session to its host');
const dcard = p.locator(`${X} .ses-xcard`, { hasText: 'Draft idea' });
ok(await dcard.locator('.map-action').count() === 0 && await dcard.locator('[data-act=details]').count() === 1 && /No meeting point set/.test(await dcard.textContent()), 'the explorer card without a point has Details and an explanation, and no broken map actions');
const markersBefore = await p.locator('.ses-map-pin').count();
await dcard.locator('.ses-xsel').click(); await settle(p, 400);
ok(await selectedId(p) !== null && await p.locator('.ses-map-pin').count() === markersBefore && await p.locator('.ses-map-pin.sel').count() === 0, 'selecting it works without moving the map or adding a marker');
await cardOf(p, priv).locator('[data-act=map]').click(); await settle(p);
ok(await selectedId(p) === priv && await offBy(p, '.ses-map-pin.sel') <= 16, 'the private session is selectable and centred for its host');
// sign out while the explorer is open: private cards and markers go at once, the selection is cleared
await goProfile(p);
await p.click('#account-pop >> text=Sign out'); await p.waitForTimeout(1200);
ok(await p.locator(`${X} .ses-xcard`, { hasText: 'Private club' }).count() === 0 && await p.locator(`${X} .ses-xcard`, { hasText: 'Draft idea' }).count() === 0 && await selectedId(p) === null, 'after sign-out the private cards and the selection are gone from the open explorer');
ok(await p.locator('.ses-map-pin.sel').count() === 0 && !(await p.evaluate(() => document.body.textContent)).includes('Secret field'), 'and no private marker or place name remains on the page');
await ctx.close();

// a guest never gets private data into the explorer even after a public refresh
({ ctx, p } = await open('guest'));
await explore(p);
ok(await p.locator(`${X} .ses-xcard`, { hasText: 'Private club' }).count() === 0 && await p.locator(`${X} .ses-xcard`, { hasText: 'Draft idea' }).count() === 0, 'a guest\'s explorer never lists private sessions');
await ctx.close();

// ======================================================================= Invitations are drawn with the same actions and open the same explorer
const codeC = (await as(db, C, 'select public.ensure_profile() as r'))[0].r.friend_code;
await as(db, B, 'select public.invite_to_session($1, $2) as r', [priv, codeC]);
({ ctx, p } = await open('c'));
await openHub(p, 'invites');
ok(await p.locator(body + ' .ses-row').count() === 1 && await rowOf(p, 'Private club').locator('button[data-act=map]').count() === 1, 'an invitation card has Map, Navigate and Details');
await rowOf(p, 'Private club').locator('[data-act=map]').click(); await p.waitForSelector(X + ':not([hidden])'); await settle(p);
ok(await selectedId(p) === priv && await p.locator(`${X} .ses-xcard`).count() === 1 && await offBy(p, '.ses-map-pin.sel') <= 16, 'its Map button opens the explorer on the invitations with that session selected and centred');
await closeX(p);
await ctx.close();

ok(errs.length === 0, 'no page errors or console errors during the run' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
await b.close();
