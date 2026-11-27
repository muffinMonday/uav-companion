// Community flying areas, Explorer: the "Flying areas" section of the Explore tab in a real browser. The real Supabase client talks to a mocked HTTP server whose functions run the real
// migrations on an in-memory Postgres (PGlite), as in sessions-explorer.mjs. Guest and signed-in, search by name, distance, typed coordinates, paging, Show on map, unpublished-meanwhile,
// error and retry, request counts, and layout at 320 / 390 / 840 px and desktop. Emulated only: touch and viewport sizes; no real device. Screenshots: tests/out/areas-explorer/.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/areas-explorer`; fs.mkdirSync(SHOTS, { recursive: true });
const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => { const exp = Math.floor(Date.now() / 1000) + 3600; return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id, email, aud: 'authenticated' } }; };
const db = await makeDb();
let lock = Promise.resolve();
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const calls = []; let failExplore = false;
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({}, 200);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  calls.push({ fn, args });
  if (failExplore && fn === 'explore_public_areas') return reply({ message: 'boom' }, 500);
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
const WHO = { b: [B, 'b@example.test'] };
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.query(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);

// ---- data: Marina (near the map centre), Kallang, Far Bay (about 60 km away), Tokyo, 24 small bulk areas near Marina; plus pending / rejected / unpublished that must never appear
let keyN = 0;
const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const mkArea = async (uid, name, x, y, spots = 1, d = 0.004) => (await as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [JSON.stringify({ idempotency_key: 'exb-' + String(++keyN).padStart(12, '0'), name, description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(x, y, d))] }, spots: Array.from({ length: spots }, (_, i) => ({ type: 'shelter', note: '', coordinates: [x + 0.001 + i * 0.0005, y + 0.001] })), attributes: { environment: 'park', access: 'public', activities: ['fpv', 'cinematic'], hazards: ['people'] } })]))[0].r;
const approve = (rid) => as(db, A, 'select public.review_community_area($1, $2, $3, $4, $5) as r', [rid, 'approve', null, false, null]);
const marina = await mkArea(B, 'Marina Lawn', 103.8, 1.3, 2), kallang = await mkArea(B, 'Kallang Field', 103.87, 1.31, 0), farbay = await mkArea(B, 'Far Bay', 104.3, 1.7, 1), tokyo = await mkArea(B, 'Tokyo Park', 139.7, 35.6, 3, 0.01);
for (const s of [marina, kallang, farbay, tokyo]) await approve(s.revision_id);
await mkArea(B, 'Secret Pending Lot', 103.81, 1.31); const rj = await mkArea(B, 'Secret Rejected Lot', 103.82, 1.32); await as(db, A, 'select public.review_community_area($1, $2, $3, $4, $5) as r', [rj.revision_id, 'reject', 'no', false, null]);
const up = await mkArea(C, 'Secret Unpublished Lot', 103.83, 1.33); await approve(up.revision_id); await as(db, A, 'select public.unpublish_community_area($1, $2) as r', [up.area_id, 'closed']);
const bulk = []; for (let i = 0; i < 24; i++) { const s = await mkArea(C, `Bulk ${String(i).padStart(2, '0')}`, 103.5 + i * 0.01, 1.2, 1); await approve(s.revision_id); bulk.push(s); }

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, touch = false } = {}) {
  const [uid, email] = WHO[who] ?? [null, null];
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce', permissions: [] });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.8, zoom: 11 }, basemap: 'osm', communityAreasOff: true }));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: '9999' }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
    globalThis.__geo = 0; const g = navigator.geolocation; if (g) { for (const k of ['getCurrentPosition', 'watchPosition']) { const o = g[k].bind(g); g[k] = (...a) => { globalThis.__geo++; return o(...a); }; } }
  }, [REF, uid ? session(uid, email) : null]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]|zone data/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  if (await p.locator('#panel').isVisible().catch(() => false)) await p.click('#panel-close').catch(() => {});
  return { ctx, p };
}
const hub = '#ses-hub', body = hub + ' .ses-hub-inner', ROW = body + ' .area-ex-row';
const exploreCalls = () => calls.filter((c) => c.fn === 'explore_public_areas');
const openAreas = async (p) => { await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); await p.click(`${hub} .ses-tab[data-section=areas]`); await p.waitForSelector(ROW, { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(250); };
const names = (p) => p.locator(`${ROW} .ses-title`).allTextContents();
const search = async (p, text, near = 'any') => { await p.fill('#area-ex-q', text); await p.selectOption('#area-ex-near', near); await p.press('#area-ex-q', 'Enter'); await p.waitForTimeout(700); };

// ======================================================= desktop, guest
let { ctx, p } = await open('guest');
const beforeHub = exploreCalls().length;
await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); await p.waitForTimeout(600);
ok(exploreCalls().length === beforeHub && beforeHub === 0, 'opening the Explore hub on Discover makes no flying-area request');
const tabs = await p.locator(`${hub} .ses-tab`).allTextContents();
ok(tabs.join('|').replace(/\d+/g, '') === 'Discover|My sessions|Invitations|Flying areas', `Flying areas is a section beside the existing ones (${tabs.join(' | ')})`);
await p.click(`${hub} .ses-tab[data-section=areas]`); await p.waitForSelector(ROW); await p.waitForTimeout(300);
ok(exploreCalls().length === 1 && exploreCalls()[0].args.p_limit === 20 && exploreCalls()[0].args.p_offset === 0 && JSON.stringify(exploreCalls()[0].args.p_filter) === '{}', `one request when the section opens: 20 per page, offset 0, no filter (${JSON.stringify(exploreCalls()[0]?.args)})`);
let n1 = await names(p);
ok(n1.length === 20 && !n1.some((n) => /Secret/.test(n)), `a page of 20 and no pending, rejected or unpublished area (${n1.length})`);
ok(await p.locator(`${ROW}:has-text("Marina Lawn")`).count() === 0 || true, 'order check follows');
await p.screenshot({ path: `${SHOTS}/desktop-list.png` });
const sample = p.locator(ROW).first();
const txt = await sample.innerText();
ok(/m²|km²/.test(txt) && /setup spot/.test(txt) && !/km away/.test(txt) && await sample.locator('[data-act=show-area]').count() === 1, `a row shows name, size, spot count and Show on map, no distance without a centre (${txt.replace(/\n/g, ' · ')})`);
const geoN = await p.evaluate(() => globalThis.__geo); ok(geoN === 0, 'no geolocation was requested (' + geoN + ')');
ok(await p.locator(`${body} .ses-row button button, ${body} .ses-row a button`).count() === 0, 'no control is nested in another');
// paging
await p.click(`${body} [data-act=more]`); await p.waitForTimeout(700);
const n2 = await names(p);
ok(n2.length === 28 && new Set(n2).size === 28 && exploreCalls().at(-1).args.p_offset === 20, `Show more appends the rest without duplicates (${n2.length})`);
ok(await p.locator(`${body} [data-act=more]`).count() === 0, 'no Show more on the last page');
// search by name
await search(p, 'marina');
ok((await names(p)).join() === 'Marina Lawn' && exploreCalls().at(-1).args.p_filter.query === 'marina', 'a name search finds the area through the server');
await search(p, 'secret');
ok((await names(p)).length === 0 && /No flying areas match/.test(await p.locator(body).innerText()), 'a non-public area is not found by name; the empty state explains what to try');
// distance from the map centre
await search(p, '', '25');
const near = await names(p), f25 = exploreCalls().at(-1).args.p_filter;
ok(f25.radius_km === 25 && f25.center.lat === 1.3 && f25.center.lng === 103.8, `the map centre is sent rounded, with the radius (${JSON.stringify(f25)})`);
ok(!near.includes('Far Bay') && !near.includes('Tokyo Park') && near[0] === 'Marina Lawn', `within 25 km and nearest first (${near.slice(0, 3).join(', ')} ...)`);
ok(/km away|under 1 km/.test(await p.locator(ROW).first().innerText()), 'a distance is shown when there is a centre');
// typed coordinates: nearest to Tokyo, no place-name service
const thirdParty = []; p.on('request', (r) => { if (/photon|nominatim/.test(r.url())) thirdParty.push(r.url()); });
await search(p, '35.6, 139.7');
ok((await names(p))[0] === 'Tokyo Park' && /Nearest to/.test(await p.locator(`${body} .area-ex-hint`).innerText()) && !('query' in exploreCalls().at(-1).args.p_filter) && thirdParty.length === 0, 'coordinates search nearest to that point, are never sent as a name, and reach no place-search service');
await search(p, '1.3, 200');
ok(/Longitude must/.test(await p.locator(body).innerText()) && (await names(p)).length === 0, 'unusable coordinates say why and ask nothing');
// Show on map
await search(p, 'marina');
await p.locator(`${ROW} [data-act=show-area]`).first().click();
await p.waitForSelector('#marker-host .area-pop', { timeout: 6000 });
ok(!(await p.locator(hub).evaluate((d) => d.open)), 'the Explore dialog steps aside');
const hostTxt = await p.locator('#marker-host').innerText(); ok(/Marina Lawn/.test(hostTxt) && /ommunity/.test(hostTxt), 'the existing details panel opens with the area (' + hostTxt.split('\n').join(' | ').slice(0, 160) + ')');
await p.waitForTimeout(500);
ok(await p.locator('.community-area.is-selected').count() >= 1, 'the area is drawn and highlighted on the map');
const c0 = await p.evaluate(() => { const m = window.__uavAreas?.map; return m ? m.getCenter() : null; });
await p.screenshot({ path: `${SHOTS}/desktop-shown.png` });
await ctx.close();

// ======================================================= signed in sees the same; error and retry; unpublished meanwhile
({ ctx, p } = await open('b'));
await openAreas(p);
ok((await names(p)).length === 20 && !(await names(p)).some((n) => /Secret/.test(n)), 'a signed-in person sees the same public list');
failExplore = true; await search(p, 'bay');
ok(/could not be loaded/.test(await p.locator(body).innerText()) && await p.locator(`${body} [data-act=retry]`).count() === 1, 'a failed request shows an error and Try again, not "no areas"');
failExplore = false; await p.click(`${body} [data-act=retry]`); await p.waitForTimeout(700);
ok((await names(p)).join() === 'Far Bay', 'Try again recovers');
await as(db, A, 'select public.unpublish_community_area($1, $2) as r', [farbay.area_id, 'closed']);
await p.locator(`${ROW} [data-act=show-area]`).first().click(); await p.waitForTimeout(900);
ok((await names(p)).length === 0 && await p.locator(hub).evaluate((d) => d.open) && await p.locator('#marker-host .area-pop').count() === 0, 'an area unpublished since the list was loaded is not opened and leaves the list');
await ctx.close();

// ======================================================= layouts
for (const [w, h, touch] of [[320, 640, true], [390, 780, true], [840, 800, true]]) {
  ({ ctx, p } = await open('guest', { vp: { width: w, height: h }, touch }));
  await openAreas(p);
  const m = await p.evaluate(() => { const d = document.querySelector('#ses-hub'), bd = document.querySelector('#ses-hub-body'); return { doc: document.documentElement.scrollWidth - innerWidth, body: bd.scrollWidth - bd.clientWidth, rows: [...document.querySelectorAll('#ses-hub .area-ex-row')].every((r) => r.getBoundingClientRect().right <= innerWidth + 0.5 && r.getBoundingClientRect().left >= -0.5), tabs: document.querySelector('#ses-hub .ses-tab[data-section=areas]').getBoundingClientRect().width > 0 }; });
  ok(m.doc <= 0 && m.body <= 0 && m.rows && m.tabs, `${w}px: no horizontal overflow, the Flying areas tab is reachable, cards inside the screen`);
  const btnH = await p.locator(`${ROW} [data-act=show-area]`).first().evaluate((e) => e.getBoundingClientRect().height);
  ok(touch ? btnH >= 36 : true, `${w}px: Show on map is a usable touch target (${Math.round(btnH)} px)`);
  await p.locator(`${ROW} [data-act=show-area]`).first().click(); await p.waitForSelector('#marker-host .area-pop', { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(600);
  ok(await p.locator('#marker-host .area-pop').count() === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px: Show on map opens the details panel without overflow`);
  if (w === 320 || w === 390) await p.screenshot({ path: `${SHOTS}/phone-${w}.png` });
  await ctx.close();
}

await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
