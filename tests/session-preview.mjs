// Discover map previews: tile-grid thumbnails opened by a right-edge chevron (src/sessions-preview.js) at 320 to 768 px, dark, reduced motion and keyboard: one open at a time, the explorer focus path,
// four tile requests per opened card and none before, no thumbnails in explorer cards. Real SQL in PGlite behind a mocked HTTP server (as tests/sessions.mjs); tile requests are answered locally.
// The real Supabase client talks to a mocked HTTP server whose functions run the real SQL on an in-memory Postgres (PGlite), so the screen is tested against the real rules.
import { chromium, CHANNEL, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C, D } from './lib-db.mjs';
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const fault = { list: false };
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1];
  if (fn === 'list_sessions' && fault.list) return reply({ message: 'server unavailable' }, 500);
  const args = req.postData() ? JSON.parse(req.postData()) : {};
  const names = Object.keys(args);
  const sql = SETOF.has(fn)
    ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t`
    : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try {
    const rows = await serial(() => as(db, uid, sql, names.map((n) => args[n])));
    return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j);
  } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};

const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'], c: [C, 'c@example.test'], d: [D, 'd@example.test'] };
const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, mobile = false, hash = '' } = {}) {
  const [uid, email] = WHO[who] ?? [null, null]; // 'guest': nobody signed in
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, dash]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify(dash));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, { v: 1, showOnStart: false, welcomed: true, seen: '9999' }]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Marked the wrong person') : d.accept()));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}

const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const hub = '#ses-hub', body = hub + ' .ses-hub-inner';
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1)', [n]);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
for (const [i, t] of ['Lake meet', 'Park fly-in', 'Field day'].entries()) await sql(`insert into public.flight_sessions (title, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, timezone) values ($1, $2, $3, $4, $5, $6, 'public', 'published', 'Asia/Shanghai')`, [t, 30.55 + i * 0.5, 114.37 + i * 0.5, hr(2 + i), hr(4 + i), B]);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let tiles = 0;
async function page(vp, extra = {}) {
  const r = await open('c', { vp, mobile: vp.width < 600 });
  await r.ctx.route('https://tile.openstreetmap.org/**', (route) => { tiles++; route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  const p = r.p;
  if (extra.colorScheme || extra.reducedMotion) await p.emulateMedia(extra);
  await p.evaluate(() => document.querySelector('.sessions-btn').click());
  await p.waitForSelector(hub + '[open]'); await p.waitForSelector(body + ' .ses-row', { timeout: 6000 });
  return r;
}
const rows = (p) => p.locator(body + ' .ses-row');

for (const w of [320, 360, 390, 520, 768]) {
  const { ctx, p } = await page({ width: w, height: 800 });
  tiles = 0;
  const n = await rows(p).count();
  ok(n === 3 && await p.locator(body + ' .ses-chev').count() === 3, `${w}px: every Discover card has a chevron`);
  const c0 = p.locator(body + ' .ses-chev').first();
  const id = await c0.getAttribute('aria-controls');
  ok(await c0.getAttribute('aria-expanded') === 'false' && await p.locator('#' + id).count() === 1 && await p.locator(body + ' .ses-prev-fig').count() === 0, `${w}px: collapsed, aria-controls points at the panel, no map built`);
  await p.waitForTimeout(300);
  ok(tiles === 0, `${w}px: no tile is requested before a card opens`);
  const box = await c0.boundingBox(), rb = await rows(p).first().boundingBox();
  ok(box.width >= 44 && box.height >= 44 && box.x + box.width <= rb.x + rb.width + 1 && box.x + box.width <= w, `${w}px: the chevron is 44 px and inside the card (${Math.round(box.width)}x${Math.round(box.height)})`);
  await c0.click(); await p.waitForTimeout(500);
  ok(await c0.getAttribute('aria-expanded') === 'true' && await p.locator(body + ' .ses-prev-map img').count() === 4 && await p.locator(body + ' .ses-prev-pin').isVisible(), `${w}px: opened, four tiles and the pin`);
  ok(tiles === 4, `${w}px: exactly four tile requests for the opened card (${tiles})`);
  const fig = await p.locator(body + ' .ses-prev-fig').boundingBox();
  ok(fig.width > 0 && fig.height >= 150 && fig.x >= 0 && fig.x + fig.width <= w + 1, `${w}px: the preview fits the screen (${Math.round(fig.width)}x${Math.round(fig.height)})`);
  ok(/OpenStreetMap/.test(await p.textContent(body + ' .ses-prev-credit')) && /check airspace/.test(await p.textContent(body + ' .ses-prev-note')), `${w}px: credit and the airspace pointer are shown`);
  ok(await p.evaluate(() => { const b = document.getElementById('ses-hub-body'); return b.scrollWidth <= b.clientWidth + 1; }), `${w}px: no sideways scrolling with the preview open`);
  if (w === 390) await p.screenshot({ path: 'tests/out/session-preview-390-open.png' });
  await p.locator(body + ' .ses-chev').nth(1).click(); await p.waitForTimeout(400);
  ok(await p.locator(body + ' .ses-chev[aria-expanded=true]').count() === 1 && await p.locator(body + ' .ses-prev-fig').count() === 1 && await p.locator(body + ' .ses-chev').nth(1).getAttribute('aria-expanded') === 'true', `${w}px: opening another card closes the first (one at a time)`);
  await p.locator(body + ' .ses-chev').nth(1).click(); await p.waitForTimeout(400);
  ok(await p.locator(body + ' .ses-prev-fig').count() === 0 && await p.locator(body + ' .ses-chev[aria-expanded=true]').count() === 0, `${w}px: the up chevron collapses it`);

  await ctx.close();
}

// opening the map from the preview uses the explorer focus path; explorer cards carry no thumbnail
{
  const { ctx, p } = await page({ width: 1300, height: 850 });
  await p.locator(body + ' .ses-chev').nth(1).click(); await p.waitForTimeout(400);
  await p.locator(body + ' .ses-prev-open').click(); await p.waitForTimeout(1200);
  ok(await p.locator('#ses-explorer:not([hidden])').count() === 1 && await p.locator('#ses-explorer .ses-xcard[data-selected=true] .ses-xtitle').textContent() === 'Park fly-in', 'tapping the preview opens the explorer focused on that session');
  ok(await p.locator('#ses-explorer img').count() === 0 && await p.locator('#ses-explorer .ses-prev').count() === 0, 'explorer cards have no thumbnail');
  await ctx.close();
}

// keyboard
{
  const { ctx, p } = await page({ width: 390, height: 800 });
  const c = p.locator(body + ' .ses-chev').first();
  await c.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok(await p.locator(body + ' .ses-chev').first().getAttribute('aria-expanded') === 'true' && await p.evaluate(() => document.activeElement?.classList.contains('ses-chev')), 'Enter opens it and focus stays on the chevron');
  await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.activeElement?.classList.contains('ses-prev-open')), 'Tab reaches the map control inside the open preview');
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Space'); await p.waitForTimeout(400);
  ok(await p.locator(body + ' .ses-prev-fig').count() === 0 && await p.evaluate(() => document.activeElement?.classList.contains('ses-chev')), 'Space closes it and focus stays on the chevron');
  ok(await p.evaluate(() => { const i = document.querySelector('.ses-prev-in'); return !i || getComputedStyle(i).visibility === 'hidden'; }), 'a closed preview is not focusable');
  await ctx.close();
}

// dark theme uses the base-layer filter; reduced motion removes the transition
{
  const { ctx, p } = await page({ width: 390, height: 800 }, { colorScheme: 'dark', reducedMotion: 'reduce' });
  await p.locator(body + ' .ses-chev').first().click(); await p.waitForTimeout(300);
  ok(/invert/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.ses-prev-map img')).filter)), 'dark theme: the tiles carry the dark filter');
  ok(/^0s$/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.ses-prev')).transitionDuration)), 'reduced motion: no transition');
  await ctx.close();
}

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
