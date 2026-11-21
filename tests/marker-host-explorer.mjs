// Review 01 S5: the REAL Sessions hub and explorer with the marker host (development switch ?markerhost=1). Opening a saved marker's details parks the explorer;
// closing them (button, Escape, map click, a point check) brings it back with the same selected session, list and scroll position; the hub's data and the
// guest / signed-in boundary are the explorer suite's own (same mocked Supabase on an in-memory Postgres). Emulated viewports only; no real phone.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
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
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [{ id: 'm1', type: 'photo', name: 'Saved tower', note: '', lat: 30.585, lon: 114.255, created: '2026-11-01T00:00:00.000Z' }] }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, prefs]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/?markerhost=1', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}
const hub = '#ses-hub', body = hub + ' .ses-hub-inner', X = '#ses-explorer';
const rowOf = (p, title, n = 0) => p.locator(`${body} .ses-row`, { hasText: title }).nth(n);
const cardOf = (p, id) => p.locator(`${X} .ses-xcard[data-id="${id}"]`);
const openHub = async (p, tab = 'discover') => { await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); if (tab !== 'discover') await p.click(`${hub} .ses-tab[data-section=${tab}]`); await p.waitForSelector(body + ' .ses-row', { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(300); };
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

// ======================================================================= the lifecycle
const tap = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === n); if (!e) return false; e.click(); return true; }, name); // the pin may be under the dock: Leaflet hears a click on the icon wherever it is
const pinPos = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === n); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
const state = (p) => p.evaluate(() => ({
  exHidden: document.getElementById('ses-explorer').hidden, hostHidden: !document.getElementById('marker-host') || document.getElementById('marker-host').hidden,
  sel: document.querySelector('#ses-explorer .ses-xcard[data-selected=true]')?.dataset.id ?? null, cards: document.querySelectorAll('#ses-explorer .ses-xcard').length,
  scroll: document.querySelector('#ses-explorer .ses-x-body').scrollTop, hubOpen: document.getElementById('ses-hub')?.open ?? false, sesx: document.body.dataset.sesx ?? null,
  title: document.activeElement?.id ?? document.activeElement?.tagName,
}));
async function scenario(label, vp, how) {
  const { ctx, p } = await open('guest', { vp });
  await explore(p);
  const ids = await p.$$eval(X + ' .ses-xcard', (c) => c.map((x) => x.dataset.id));
  await cardOf(p, ids[3]).locator('.ses-xsel').click(); await settle(p, 700);
  await p.evaluate(() => { document.querySelector('#ses-explorer .ses-x-body').scrollTop = 90; });
  const before = await state(p);
  ok(before.sel === ids[3] && before.cards === 9 && !before.exHidden, label + ': precondition: explorer open, card selected, ' + before.cards + ' cards, scrolled ' + before.scroll);
  // open the saved marker's details
  const q = await tap(p, 'Saved tower'); await settle(p, 1200);
  const during = await state(p);
  ok(q && !during.hostHidden && during.exHidden && during.sesx === null, label + ': opening marker details parks the explorer (one contextual overlay visible, the dock\'s map offsets released)');
  await how(p, label);
  const after = await state(p);
  ok(after.hostHidden && !after.exHidden && after.sel === before.sel && after.cards === before.cards && Math.abs(after.scroll - before.scroll) <= 1 && after.sesx !== null,
    label + ': the explorer is back with the same selected session, the same list and scroll position (' + JSON.stringify({ sel: after.sel, cards: after.cards, scroll: after.scroll }) + ')');
  ok(await p.locator(X + ' .ses-xcard[data-selected=true]').count() === 1 && await p.locator(hub + '[open]').count() === 0, label + ': still one selected card, and the hub stayed closed');
  // the explorer still works afterwards
  await cardOf(p, ids[5]).locator('.ses-xsel').click(); await settle(p, 600);
  ok(await selectedId(p) === ids[5], label + ': selecting another card works after the return');
  await ctx.close();
}
await scenario('desktop, Escape', { width: 1300, height: 850 }, async (p) => { await p.keyboard.press('Escape'); await settle(p, 500); });
await scenario('desktop, close button', { width: 1300, height: 850 }, async (p) => { await p.click('#marker-host .pop-close'); await settle(p, 500); });
await scenario('desktop, map click', { width: 1300, height: 850 }, async (p) => { await p.mouse.click(520, 250); await settle(p, 500); });
await scenario('folded phone, close button', { width: 360, height: 740 }, async (p) => { await p.click('#marker-host .pop-close'); await settle(p, 500); });
await scenario('unfolded 760, Escape', { width: 760, height: 800 }, async (p) => { await p.keyboard.press('Escape'); await settle(p, 500); });
await scenario('desktop, a point check', { width: 1300, height: 850 }, async (p) => { await p.mouse.click(150, 400, { button: 'right' }); await settle(p, 2500); });

// opening the explorer again while the marker panel is open closes the panel
{
  const { ctx, p } = await open('guest', { vp: { width: 1300, height: 850 } });
  await tap(p, 'Saved tower'); await settle(p, 1200);
  ok(await p.locator('#marker-host:not([hidden])').count() === 1, 'precondition: marker panel open');
  await explore(p);
  const st = await state(p);
  ok(st.hostHidden && !st.exHidden, 'opening the explorer from the hub closes the marker panel (one contextual overlay)');
  await ctx.close();
}

ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
await b.close();
await db.close?.();
process.exit(0);
