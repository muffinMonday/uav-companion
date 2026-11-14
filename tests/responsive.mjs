// Responsive layout of the major dialogs on the screens a foldable can show: narrow phone, large phone, unfolded (portrait and landscape), tablet, desktop, and short landscape windows.
// Checks that titles, close buttons, tabs and the Create/Cancel row stay inside the visible viewport, that nothing scrolls sideways, that the header stays put while the body scrolls,
// that the sheet follows a (simulated) visual viewport when the keyboard opens, and that the map point picker, Escape and focus restoration still work.
// Emulated only: touch and viewport sizes (Playwright). A real foldable, the real Android toolbar and the real keyboard are NOT exercised. Screenshots go to tests/out/responsive/.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/responsive`; fs.mkdirSync(SHOTS, { recursive: true });

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
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => args[n]))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const ins = (title, loc, s, e, lat, lng, vis = 'public') => db.query(`insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, timezone) values ($1, 'Bring batteries and a spotter. Meet at the car park by the lake.', $2, $3, $4, $5, $6, $7, $8, 'published', 'Asia/Shanghai')`, [title, loc, lat, lng, s, e, B, vis]);
await ins('Field day', 'East Lake', hr(24), hr(27), 30.6, 114.3);
await ins('Evening flight', 'Riverside', hr(48), hr(50), 30.62, 114.31);

const VPS = [['narrow phone', 360, 780, true], ['large phone', 412, 915, true], ['unfolded portrait', 700, 850, true], ['unfolded landscape', 850, 700, true], ['tablet portrait', 768, 1024, true], ['tablet landscape', 1024, 768, true], ['desktop', 1440, 900, false],
  ['short landscape phone', 850, 400, true], ['short desktop window', 1100, 420, false]];
const b = await chromium.launch({ channel: CHANNEL });
// A controllable visualViewport stands in for the on-screen keyboard (real Chrome resizes the visual viewport, not the layout viewport).
const FAKE_VV = () => {
  const t = new EventTarget(); let hh = null, top = 0;
  const vv = { get width() { return innerWidth; }, get height() { return hh ?? innerHeight; }, get offsetTop() { return top; }, offsetLeft: 0, scale: 1, addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t) };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__vv = (h, o = 0) => { hh = h; top = o; t.dispatchEvent(new Event("resize")); };
};
async function open([name, w, h, touch], { uid = C, dark = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(FAKE_VV);
  await ctx.addInitScript(([ref, sess]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: '9999' }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, 'c@example.test') : null]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push(`${name}: pageerror ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(`${name}: ${m.text()}`));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.locator('#name-dlg-skip').click({ timeout: 2000 }).catch(() => {});
  return { ctx, p };
}
const R = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
const rect = (p, sel) => p.evaluate(`(${R.toString()})(${JSON.stringify(sel)})`);
const inside = (r, w, h) => !!r && r.l >= -0.5 && r.t >= -0.5 && r.r <= w + 0.5 && r.b <= h + 0.5;
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png` });
const noSideways = (p) => p.evaluate(() => { const bd = document.getElementById('ses-hub-body'); return document.documentElement.scrollWidth <= innerWidth + 1 && (!bd || bd.scrollWidth <= bd.clientWidth + 1); });
const hub = '#ses-hub';

for (const vp of VPS) {
  const [name, w, h, touch] = vp, tag = `${name} ${w}x${h}`, slug = `${w}x${h}`;
  const { ctx, p } = await open(vp);
  await p.focus('.more-btn');
  await p.keyboard.press('Enter'); await p.waitForSelector('#more-tools-menu .more-row[data-tool=sessions]'); await p.focus('#more-tools-menu .more-row[data-tool=sessions]'); await p.keyboard.press('Enter'); await p.waitForSelector(hub + '[open]'); await p.waitForSelector(hub + ' .ses-row', { timeout: 5000 }); await p.waitForTimeout(300);
  ok(inside(await rect(p, hub), w, h), `${tag}: the hub dialog is inside the viewport`);
  ok(inside(await rect(p, '.ses-hub-head h2'), w, h) && inside(await rect(p, '#ses-hub-close'), w, h), `${tag}: the title and the close button are inside the viewport`);
  const tabsOk = await p.evaluate(([w, h, touch]) => [...document.querySelectorAll('.ses-tab')].every((t) => { const r = t.getBoundingClientRect(); return r.left >= -0.5 && r.right <= w + 0.5 && r.bottom <= h + 0.5 && r.height >= (touch ? 44 : 30); }), [w, h, touch]);
  ok(tabsOk, `${tag}: the three tabs are inside the viewport` + (touch ? ' and at least 44 px tall' : ''));
  ok(await noSideways(p), `${tag}: nothing scrolls sideways`);
  const sheet = touch && (w <= 900 || h <= 520);
  const dr = await rect(p, hub);
  ok(sheet ? (dr.l <= 0.5 && dr.t <= 0.5 && dr.r >= w - 0.5 && dr.b >= h - 0.5) : (dr.r - dr.l <= 960.5 && dr.l >= 15), `${tag}: ${sheet ? 'a touch screen gets the full-screen sheet' : 'a mouse or a big tablet keeps the dialog'}`);
  const bodyW = await p.evaluate(() => document.getElementById('ses-hub-body').clientWidth);
  const fw = await p.evaluate(() => { const w = (q) => Math.round(document.querySelector(q).getBoundingClientRect().width); return { q: w('.ses-filters input[type=search]'), near: w('#ses-near'), when: w('#ses-when-f') }; });
  ok(fw.q <= 361 && fw.near <= 221 && fw.when <= 221 && fw.near >= 100, `${tag}: Discover filters stay compact (search ${fw.q} px, selects ${fw.near} and ${fw.when} px, for a ${Math.round(bodyW)} px body)`);
  await shot(p, `hub-discover-${slug}`);
  const before = await rect(p, '.ses-hub-head');
  await p.evaluate(() => { const bd = document.getElementById('ses-hub-body'); const s = document.createElement('div'); s.style.height = '1500px'; s.className = 'ses-filler'; bd.firstChild.append(s); bd.scrollTop = 400; });
  await p.waitForTimeout(100);
  const after = await rect(p, '.ses-hub-head');
  ok(before.t === after.t && before.b === after.b && await p.evaluate(() => document.getElementById('ses-hub-body').scrollTop > 0), `${tag}: the header does not move while the body scrolls`);
  await p.evaluate(() => document.querySelector('.ses-filler')?.remove());
  await p.click(`${hub} .ses-tab[data-section=mine]`); await p.waitForTimeout(400); await shot(p, `hub-mine-${slug}`);
  const mineText = await p.textContent(hub);
  ok(/five active hosted sessions/.test(mineText) && /public or private/.test(mineText) && /counts once/.test(mineText), `${tag}: My sessions states the hosting limit (five, public or private, a series counts once)`);
  await p.click(`${hub} .ses-tab[data-section=invites]`); await p.waitForTimeout(300); await shot(p, `hub-invites-${slug}`);
  await p.click(`${hub} .ses-tab[data-section=discover]`); await p.waitForTimeout(300);
  await p.click('#ses-new'); await p.waitForSelector('#ses-form');
  const f = await p.evaluate(`(() => { const g = ${R.toString()}; return { go: g('#ses-create'), cancel: g('#ses-create-cancel'), body: g('#ses-hub-body'), fw: g('#ses-form'), ids: ['sc-1', 'sc-2', 'sc-3', 'sc-starts', 'sc-ends', 'sc-4'].every((i) => document.getElementById(i)), sec: document.querySelectorAll('#ses-form .ses-sec').length }; })()`);
  ok(inside(f.go, w, h) && inside(f.cancel, w, h) && f.go.b <= f.body.b + 0.5, `${tag}: Create and Cancel are visible without scrolling`);
  ok(f.ids && f.sec === 4, `${tag}: the form has its four groups and its fields`);
  const small = await p.evaluate(() => { const w = (q) => Math.round(document.querySelector(q).getBoundingClientRect().width); return { radio: w('#ses-form input[type=radio]'), cap: w('#ses-form input[name=capacity]') }; });
  ok(small.radio <= 24 && small.cap <= 200, `${tag}: radio buttons keep their size (${small.radio} px) and the capacity field stays short (${small.cap} px)`);
  const fwid = f.fw.r - f.fw.l, lgap = f.fw.l - f.body.l, rgap = f.body.r - f.fw.r;
  ok(fwid <= 601 && (bodyW <= 640 || Math.abs(lgap - rgap) <= 8), `${tag}: the form is one column of ${Math.round(fwid)} px (at most 600), centred in a ${Math.round(bodyW)} px body`);
  ok(await noSideways(p), `${tag}: the form does not scroll sideways`);
  await shot(p, `hub-create-${slug}`);
  await p.fill('#ses-form input[name=title]', 'A very long session title that goes on and on to check how a long line wraps in the form');
  await p.fill('#sc-2', 'Details '.repeat(60)); await p.click('#ses-form input[name=ses-vis][value=public]'); await p.waitForTimeout(100);
  ok(await noSideways(p), `${tag}: a long title, long details and the public warning do not overflow`);
  await shot(p, `hub-create-public-${slug}`);
  await p.click('#ses-form input[name=ses-vis][value=private]');
  if (sheet) {
    const kb = Math.round(h * 0.45);
    await p.focus('#sc-1'); await p.evaluate((k) => window.__vv(k), h - kb); await p.waitForTimeout(500);
    const k = await p.evaluate(`(() => { const g = ${R.toString()}; return { d: g('#ses-hub'), head: g('.ses-hub-head'), go: g('#ses-create'), field: g('#sc-1') }; })()`);
    ok(k.d.b <= h - kb + 1 && k.head.t >= -0.5, `${tag}: with a ${kb} px keyboard the sheet ends above it and its header stays on screen`);
    ok(k.go.b <= h - kb + 1 && k.go.t >= 0, `${tag}: with the keyboard open Create and Cancel stay above it`);
    ok(k.field.t >= k.head.b - 1 && k.field.b <= h - kb + 1, `${tag}: the focused field is not covered by the keyboard or the header`);
    await shot(p, `hub-create-keyboard-${slug}`);
    await p.evaluate((hh) => window.__vv(hh), h); await p.waitForTimeout(200);
  }
  await p.fill('#ses-form input[name=title]', 'Draft kept');
  await p.click('#ses-form [data-act=pick]'); await p.waitForSelector('.ses-bar:not([hidden])');
  ok(inside(await rect(p, '.ses-bar'), w, h) && await p.evaluate(() => !document.getElementById('ses-hub').open), `${tag}: while picking, the hub is out of the way and the bar is on screen`);
  await shot(p, `hub-picker-${slug}`);
  await p.click('.ses-bar .primary'); await p.waitForSelector(hub + '[open]');
  ok(await p.inputValue('#ses-form input[name=title]') === 'Draft kept' && /Point chosen/.test(await p.textContent('#ses-form .ses-pin-text')), `${tag}: the draft and the chosen point are kept after the map picker`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.locator('#ses-form').count() === 0 && await p.locator(hub + '[open]').count() === 1, `${tag}: Escape leaves the form and keeps the hub`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(await p.locator(hub + '[open]').count() === 0 && await p.evaluate(() => document.activeElement?.classList.contains('more-btn')), `${tag}: Escape closes the hub and focus returns to the More tools button`);
  await ctx.close();
}

// dark theme: the same checks hold and the dialog is drawn with the dark surface
{
  const vp = VPS[2], [, w, h] = vp, { ctx, p } = await open(vp, { dark: true });
  await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.getElementById('ses-hub')).backgroundColor !== 'rgb(255, 255, 255)'), 'dark theme: the hub uses the dark surface');
  ok(inside(await rect(p, '#ses-hub-close'), w, h), 'dark theme: the close button is inside the viewport');
  await shot(p, 'hub-dark-700x850');
  await p.click('#ses-new'); await p.waitForSelector('#ses-form'); await shot(p, 'hub-create-dark-700x850');
  await ctx.close();
}

// The old clipping mechanism: a dialog sized from a 100vh taller than the visible area. The hub uses no vh, so a visible area shorter than its maximum height still fits.
{
  const vp = ['visible area 850x560 (toolbar showing)', 850, 560, false], [, w, h] = vp, { ctx, p } = await open(vp);
  await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); await p.waitForTimeout(300);
  ok(inside(await rect(p, hub), w, h) && inside(await rect(p, '#ses-hub-close'), w, h) && inside(await rect(p, '.ses-hub-head h2'), w, h), 'a visible area shorter than the maximum dialog height: the title and close button stay inside (the old rule put them above the top)');
  ok(await p.evaluate(() => !/vh/.test([...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r.selectorText === '.ses-hub').map((r) => r.cssText).join(''))), 'the hub rules contain no vh units');
  await ctx.close();
}

// the account popup, the side panel and the dashboard on the same screens
for (const vp of [VPS[0], VPS[2], VPS[3], VPS[7], VPS[6]]) {
  const [name, w, h] = vp, tag = `${name} ${w}x${h}`, slug = `${w}x${h}`;
  const { ctx, p } = await open(vp);
  await p.evaluate(() => { const bt = [document.getElementById('account-btn'), document.getElementById('dock-account')].find((x) => x && x.offsetParent !== null); bt.click(); });
  await p.waitForSelector('#account-pop:not([hidden])'); await p.waitForTimeout(500);
  const ap = await p.evaluate(`(() => { const g = ${R.toString()}; return { pop: g('#account-pop'), close: g('#account-pop .account-close'), h2: g('#account-pop h2') }; })()`);
  ok(inside(ap.pop, w, h) && inside(ap.close, w, h), `${tag}: the account popup and its close button are inside the viewport`);
  await shot(p, `account-${slug}`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click()); await p.waitForTimeout(500);
  const pn = await p.evaluate(`(() => { const g = ${R.toString()}; return { panel: g('#panel'), close: g('#panel-close'), tabs: [...document.querySelectorAll('#panel .tabs button')].map((t) => { const r = t.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }) }; })()`);
  ok(inside(pn.panel, w, h) && inside(pn.close, w, h) && pn.tabs.every((t) => inside(t, w, h)), `${tag}: the side panel, its tabs and its close button are inside the viewport`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: the page does not scroll sideways with the panel open`);
  await shot(p, `panel-${slug}`);
  await p.evaluate(() => document.getElementById('panel-close').click()); await p.waitForTimeout(300);
  if (await p.locator('#dash').isHidden()) await p.locator('#dash-tab:visible, #dash-peek:visible').first().click();
  await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(400);
  const ds = await p.evaluate(`(() => { const g = ${R.toString()}; return { dash: g('#dash'), head: g('#dash .dash-head'), collapse: g('#dash-collapse') }; })()`);
  ok(inside(ds.dash, w, h) && inside(ds.head, w, h) && inside(ds.collapse, w, h), `${tag}: the dashboard, its header and its fold button are inside the viewport`);
  await shot(p, `dash-${slug}`);
  await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click()); await p.waitForTimeout(500);
  const both = await p.evaluate(() => { const a = document.getElementById('panel').getBoundingClientRect(), d = document.getElementById('dash'); if (!d || d.hidden) return { hidden: true }; const r = d.getBoundingClientRect(); return { hidden: false, overlap: Math.min(a.right, r.right) - Math.max(a.left, r.left) > 1 && Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) > 1 }; });
  ok(both.hidden || !both.overlap, `${tag}: with the side panel open the dashboard does not sit on top of it` + (both.hidden ? ' (dashboard folds away)' : ''));
  await shot(p, `panel-dash-${slug}`);
  await ctx.close();
}

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
