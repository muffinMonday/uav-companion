// Flight sessions in the browser (the Sessions hub): discovering public sessions, RSVP and capacity, reporting, hosting as an ordinary person (private by default, the map pin picker keeping the draft,
// the repeat preview, invitations and private links, the wording that a host cannot verify attendance for XP), marking attendance as an organiser, the administrator, the dashboard card and a phone width.
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session', 'list_session_participants']);
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
  await p.addLocatorHandler(p.locator('#autoshare-consent'), () => p.locator('#autoshare-enable').click()); // replaces the browser confirm these tests accepted
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Marked the wrong person') : d.accept()));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}
const goFriends = async (p) => { await p.evaluate(() => { const t = document.getElementById('tab-friends'); if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=friends]').click(); else t.click(); }); await p.waitForTimeout(900); };
const goProfile = async (p) => { await p.evaluate(() => { const pop = document.getElementById('account-pop'); const b = [document.getElementById('account-btn'), document.getElementById('dock-account')].find((x) => x && x.offsetParent !== null); if (!pop.hidden) b.click(); b.click(); }); await p.waitForTimeout(900); };
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();

// ---------- the data: A administrator, B organiser, C and D ordinary people
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
const [cA, cB, cD] = [await code(A), await code(B), await code(D)];
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
await one(A, `public.grant_role($1, 'organiser')`, [cB]);

const txt = async (p, sel) => (await p.textContent(sel).catch(() => '')) ?? '';
const hub = '#ses-hub';
const body = hub + ' .ses-hub-inner';
const rowOf = (p, title) => p.locator(`${body} .ses-row`, { hasText: title });
const openHub = async (p, tab = 'discover') => { if (await p.locator(hub + '[open]').count() === 0) await moreTool(p, 'sessions'); await p.waitForSelector(hub + '[open]'); if (tab !== 'discover') await p.click(`${hub} .ses-tab[data-section=${tab}]`); await p.waitForTimeout(250); };
const goTab = async (p, tab) => { await p.click(`${hub} .ses-tab[data-section=${tab}]`); await p.waitForTimeout(250); };
const say = async (p, re) => p.waitForFunction(([sel, s]) => new RegExp(s).test(document.querySelector(sel)?.textContent ?? ''), [body + ' .ses-message', re.source], { timeout: 6000 });
const lat0 = 30.6, lng0 = 114.3;
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);

// ---------- the map button, and the hub for someone with nothing planned
let { ctx, p } = await open('c');
ok(await p.locator('.sessions-btn').count() === 1 && await p.getAttribute('.sessions-btn', 'aria-label').then((t) => /Flight sessions/.test(t)) && !(await p.locator('.sessions-btn').isVisible()), 'the Flight sessions control is kept, folded into More tools');
await p.click('.more-btn');
ok(await p.locator('#more-tools-menu .more-row[data-tool=sessions]').isVisible() && /Flight Sessions/.test(await p.textContent('#more-tools-menu .more-row[data-tool=sessions]')), 'More tools has a Flight Sessions row');
await p.click('.more-btn');
ok(await p.evaluate(() => { const v = document.querySelector('.sessions-btn svg'); const c = getComputedStyle(v); return c.fill === 'none' && c.stroke !== 'none'; }), 'its icon is still drawn as an outline, not a filled block');
await openHub(p);
ok(/No public sessions match/.test(await txt(p, body)) && await p.locator('#ses-new').count() === 1, 'Discover with nothing public says so, and anyone signed in can plan a session');
ok(await p.locator(hub + ' .ses-tab').count() === 3 && await p.locator(hub + ' .ses-tab[aria-selected=true]').textContent().then((t) => /Discover/.test(t)), 'three tabs: Discover, My sessions, Invitations');
await goTab(p, 'mine');
ok(/not hosting anything upcoming/.test(await txt(p, body)) && /not joined/.test(await txt(p, body)), 'My sessions: nothing hosted, nothing joined');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok(await p.locator(hub + '[open]').count() === 0, 'Escape closes the hub');
await ctx.close();

// ---------- sessions exist: one public under way (B's), one public tomorrow (B's, capacity 1), one private (B's)
const ins = async (title, o) => (await sql(`insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, capacity, timezone) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', $10, 'Asia/Shanghai') returning id`, [title, o.desc ?? null, o.loc ?? null, o.lat ?? lat0, o.lng ?? lng0, o.s, o.e, B, o.vis ?? 'public', o.cap ?? null]))[0].id;
const nowS = await ins('Field day', { desc: 'Bring batteries', loc: 'East Lake', s: hr(-1), e: hr(2) });
const nextS = await ins('Tomorrow meetup', { s: hr(24), e: hr(27), cap: 1, lat: 30.9, lng: 114.6 });
const farS = await ins('Far away fly-in', { s: hr(48), e: hr(50), lat: 40.0, lng: 116.0, loc: 'Beijing' });
const privS = await ins('Private club', { s: hr(30), e: hr(33), vis: 'private', loc: 'Secret field' });

// Public deep links bypass Discover entirely, including filtered/paginated results.
for (const who of ['guest', 'c', 'b']) {
  ({ ctx, p } = await open(who, { hash: '#flight-session=' + farS, ...(who === 'guest' ? { vp: { width: 360, height: 740 }, mobile: true } : {}) }));
  await p.waitForSelector(body + ' [data-act=share]');
  ok(/Far away fly-in/.test(await txt(p, body)) && await p.locator(hub + '[open]').count() === 1, who + ' opens the specific public occurrence directly');
  const shareRect = await p.locator('[data-act=share]').boundingBox(), navRect = await p.locator(body + ' [data-act=navigate]').boundingBox();
  ok(Math.abs(shareRect.y - navRect.y) < 1 && Math.abs(shareRect.height - navRect.height) < 1 && await p.locator('[data-act=share] svg').count() === 1, who + ' sees an icon Share button beside Navigate at the same height');
  ok(who === 'guest' ? await p.locator(body + ' [data-act=signin]').count() === 1 : await p.locator(body + ' [data-act=rsvp]').count() === 1, who + ' keeps the existing RSVP/sign-in flow');
  if (who === 'b') ok(await p.locator('#ses-manage').count() === 1, 'public link preserves host management controls');
  if (who === 'guest') {
    const rect = await p.locator(hub).boundingBox();
    ok(rect.x >= 0 && rect.x + rect.width <= 361 && rect.y >= 0 && rect.y + rect.height <= 741, 'public details fit a mobile screen');
    await p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (v) => { window.sharedSession = v; } }); });
    await p.click('[data-act=share]');
    ok(await p.evaluate((id) => window.sharedSession.title === 'Far away fly-in' && window.sharedSession.url === location.origin + location.pathname + '#flight-session=' + id, farS), 'Web Share receives the title and occurrence URL');
    await p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (url) => { window.copiedSession = url; } } }); });
    await p.click('[data-act=share]');
    ok(await p.evaluate((id) => window.copiedSession.endsWith('#flight-session=' + id), farS), 'clipboard fallback copies the public URL');
    await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
    await p.click('[data-act=share]');
    ok(await p.locator('[data-public-url]').inputValue() === 'http://localhost:5173/#flight-session=' + farS, 'selectable public URL fallback stays in existing detail');
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('[data-act=share]');
    ok(/Far away fly-in/.test(await txt(p, body)), 'reload reopens the shared occurrence');
    await p.goBack();
    await p.waitForTimeout(300);
    ok(await p.locator(hub + '[open]').count() === 1 && await p.locator('#ses-q').isVisible(), 'browser Back returns from linked detail to Discover');
  }
  await ctx.close();
}
({ ctx, p } = await open('guest'));
await openHub(p);
await p.fill('#ses-q', 'no matching sessions'); await p.press('#ses-q', 'Enter');
await p.waitForTimeout(400);
await p.evaluate((id) => { location.hash = 'flight-session=' + id; }, farS);
await p.waitForSelector('[data-act=share]');
ok(/Far away fly-in/.test(await txt(p, body)), 'hash change opens a session outside the filtered Discover results');
const directPattern = new RegExp('/rest/v1/rpc/get_public_session$');
let releaseLookup;
const held = new Promise((resolve) => { releaseLookup = resolve; });
await p.route(directPattern, async (route) => { if (route.request().postDataJSON().p_id === nowS) await held; await route.fallback(); });
await p.evaluate((id) => { location.hash = 'flight-session=' + id; }, nowS);
await p.waitForFunction(() => document.querySelector('#ses-hub-body')?.textContent.includes('Loading session'));
await p.evaluate((id) => { location.hash = 'flight-session=' + id; }, nextS);
await p.waitForFunction(() => document.querySelector('#ses-hub-body .ses-title')?.textContent === 'Tomorrow meetup');
releaseLookup(); await p.waitForTimeout(300);
ok(/Tomorrow meetup/.test(await txt(p, body)) && !/Field day/.test(await txt(p, body)), 'rapid hash changes discard stale public lookup results');
for (const id of ['not-a-uuid', privS, '00000000-0000-4000-8000-000000000000']) {
  await p.evaluate((id) => { location.hash = 'flight-session=' + id; }, id);
  await p.waitForFunction(() => document.querySelector('#ses-hub-body')?.textContent.includes('This session is no longer available.'));
  ok(!/Private club|Secret field/.test(await txt(p, body)) && await p.locator('[data-act=share]').count() === 0, 'invalid/private/unavailable links show the same generic failure');
}
await ctx.close();
// A guest follows the existing sign-in control and signs in on the same page.
({ ctx, p } = await open('guest', { hash: '#flight-session=' + farS }));
await p.waitForSelector('[data-act=share]');
await p.click('[data-act=signin]');
await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(C));
await p.evaluate(([ref, sess]) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  const channel = new BroadcastChannel(`sb-${ref}-auth-token`);
  channel.postMessage({ event: 'SIGNED_IN', session: sess }); channel.close();
}, [REF, session(C, 'c@example.test')]);
await p.waitForSelector('[data-act=rsvp]');
ok(/Far away fly-in/.test(await txt(p, body)) && await p.locator(hub + '[open]').count() === 1, 'sign-in transition refreshes the same public detail without duplicate dialogs');
await ctx.close();

({ ctx, p } = await open('c'));
await openHub(p);
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
ok(await p.locator(body + ' .ses-row').count() === 3 && !/Private club|Secret field/.test(await txt(p, body)), 'Discover lists the three public sessions and never the private one');
ok(/East Lake/.test(await txt(p, body)) && /Under way/.test(await txt(p, body)) && /1 place/.test(await txt(p, body)) && /0 people are coming/.test(await txt(p, body)), 'rows show when, where, capacity and who is coming');
await p.fill('#ses-q', 'far'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(500);
ok(await p.locator(body + ' .ses-row').count() === 1 && /Far away/.test(await txt(p, body)), 'search narrows the list');
await p.fill('#ses-q', ''); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(500);
await p.evaluate(([la, ln]) => { /* map centre near the first two */ document.getElementById('ses-near'); }, [lat0, lng0]);
await p.selectOption('#ses-near', '25'); await p.waitForTimeout(600);
ok(await p.locator(body + ' .ses-row').count() >= 1 && !/Far away/.test(await txt(p, body)), 'a distance filter around the map centre hides the far session');
await p.selectOption('#ses-near', 'any'); await p.waitForTimeout(500);
await rowOf(p, 'Tomorrow meetup').locator('[data-act=details]').click();
await p.waitForSelector(body + ' [data-act=rsvp]', { timeout: 5000 });
ok(/Meeting point: 30\.9/.test(await txt(p, body)) && /Public/.test(await txt(p, body)) && await p.locator(body + ' [data-act=show-map]').count() === 1, 'the detail shows the exact point, public, and Show on the map');
ok(await p.locator(body + ' .ses-role').count() === 0 && await p.locator(body + ' #ses-manage').count() === 0, 'an ordinary person sees no role line and no manage panel');
await p.click(body + ' [data-act=rsvp]');
await p.waitForSelector(body + ' [data-act=withdraw]', { timeout: 5000 });
ok(/1 of 1 place taken/.test(await txt(p, body)) && /on the list/.test(await txt(p, body + ' .ses-message')), 'RSVP puts you on the list; the capacity shows full');
await p.click('#ses-back'); await p.waitForTimeout(200);
await p.click(hub + ' .ses-tab[data-section=mine]'); await p.waitForTimeout(300);
ok(await rowOf(p, 'Tomorrow meetup').count() === 1 && /Joined/.test(await txt(p, body)), 'it shows under Joined in My sessions');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=details]').click();
await p.click(body + ' [data-act=withdraw]'); await p.waitForSelector(body + ' [data-act=rsvp]', { timeout: 5000 });
ok(true, 'before it starts you can withdraw');
await p.click('#ses-back'); await goTab(p, 'discover');
await rowOf(p, 'Field day').locator('[data-act=details]').click();
await p.click(body + ' [data-act=rsvp]'); await p.waitForSelector(body + ' .badge:has-text("You said you will come")', { timeout: 5000 });
ok(await p.locator(body + ' [data-act=withdraw]').count() === 0, 'once it has started the RSVP can no longer be withdrawn');
ok((await sql(`select total from public.user_xp where user_id = $1`, [C])).length === 0 || (await sql(`select total from public.user_xp where user_id = $1`, [C]))[0].total === 0, 'an RSVP gives no XP');
await p.click('#ses-back');
// capacity: D takes the one place of Tomorrow meetup? C already withdrew; make D take it, then C is refused
await one(D, 'public.rsvp_session($1)', [nextS]);
await goTab(p, 'discover'); await rowOf(p, 'Tomorrow meetup').locator('[data-act=details]').click();
await p.waitForSelector(body + ' .badge:has-text("Full")', { timeout: 5000 });
ok(await p.locator(body + ' [data-act=rsvp]').count() === 0, 'when it is full there is no RSVP button');
await p.click('#ses-back');
// report
await rowOf(p, 'Far away').locator('[data-act=details]').click();
await p.click(body + ' [data-act=report]'); await p.selectOption('#ses-report-reason', 'spam'); await p.click(body + ' [data-act=send-report]');
await say(p, /moderators will look/);
ok((await sql(`select reason from public.session_reports where session_id = $1 and reporter = $2`, [farS, C])).length === 1, 'a public session can be reported and the report reaches the database');
await p.click(body + ' [data-act=report]').catch(() => {});
await ctx.close();

// ---------- an ordinary person hosts: the wording says what they cannot do; the pin picker keeps the draft; recurrence preview; private default
({ ctx, p } = await open('c'));
// two saved markers for the form's "Use a saved marker…" dropdown (the page reads them on load, so reload once before anything is done)
await p.evaluate((po) => localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })), [
  { id: 'lake', type: 'photo', name: 'Lake Viewpoint', note: '', lat: 30.512, lon: 114.312, created: '2026-11-01T00:00:13.000Z' },
  { id: 'gate', type: 'photo', name: 'Main Gate', note: '', lat: 30.52, lon: 114.32, created: '2026-11-01T00:00:15.000Z' },
]);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
await openHub(p);
await p.click('#ses-new');
await p.waitForSelector('#ses-form');
ok(await p.locator('#ses-form input[name=ses-vis][value=private]').isChecked() && !(await p.locator('#ses-form input[name=ses-vis][value=public]').isChecked()), 'the new session form starts private');
ok(/cannot verify attendance for XP/.test(await txt(p, body)), 'the form says a host cannot verify attendance for XP unless an organiser or administrator');
// the saved-marker dropdown: it shows the chosen marker and sets the point; the name fills an empty place name; the placeholder leaves the point; a map point clears it
const MARK = '#ses-form select[aria-label="Use a saved marker"]', PIN = '#ses-form .ses-pin-text', PLACE = '#ses-form .ses-field:has(label:text-is("Place name (optional)")) input';
const shownMark = () => p.$eval(MARK, (s) => s.selectedOptions[0]?.textContent ?? null);
const pinAt = async () => (await txt(p, PIN)).match(/Point chosen: ([\d.]+), ([\d.]+)/)?.slice(1).join(' ') ?? null;
ok(JSON.stringify(await p.$$eval(MARK + ' option', (os) => os.map((o) => [o.value, o.textContent]))) === JSON.stringify([['', 'Use a saved marker…'], ['0', 'Lake Viewpoint'], ['1', 'Main Gate']]) && (await p.inputValue(MARK)) === '', 'the saved-marker dropdown starts on the placeholder and lists each saved marker by name');
await p.selectOption(MARK, { label: 'Lake Viewpoint' });
ok((await pinAt()) === '30.51200 114.31200' && (await shownMark()) === 'Lake Viewpoint' && (await p.inputValue(PLACE)) === 'Lake Viewpoint', 'choosing a saved marker sets the point, keeps its name shown and fills the empty place name');
await p.fill(PLACE, 'Meet by the bridge');
await p.selectOption(MARK, { label: 'Main Gate' });
ok((await pinAt()) === '30.52000 114.32000' && (await shownMark()) === 'Main Gate' && (await p.inputValue(PLACE)) === 'Meet by the bridge', 'another marker moves the point and the dropdown follows; a filled place name is kept');
await p.selectOption(MARK, '');
ok((await pinAt()) === '30.52000 114.32000' && (await p.inputValue(MARK)) === '', 'choosing the placeholder leaves the meeting point alone');
await p.selectOption(MARK, { label: 'Main Gate' });
await p.selectOption(MARK, { label: 'Main Gate' });
ok((await pinAt()) === '30.52000 114.32000' && (await shownMark()) === 'Main Gate', 'choosing the same marker again keeps the point and the name');
await p.click('#ses-form [data-act=centre]');
ok((await p.inputValue(MARK)) === '' && (await shownMark()) === 'Use a saved marker…' && /Point chosen: /.test(await txt(p, PIN)), 'a point taken from the map is not shown as a saved marker');
await p.selectOption(MARK, { label: 'Lake Viewpoint' });
ok((await pinAt()) === '30.51200 114.31200' && (await shownMark()) === 'Lake Viewpoint', 'after a map point, choosing a saved marker again sets it and shows its name');
await p.fill('#ses-form input[name=title]', 'Saturday group');
await p.click('#ses-form [data-act=pick]');
await p.waitForSelector('.ses-bar:not([hidden])');
ok(await p.locator(hub + '[open]').count() === 0, 'choosing a point closes the hub so the map is usable');
await p.click('.ses-bar button:has-text("Use this point")');
await p.waitForSelector(hub + '[open]');
ok(await p.inputValue('#ses-form input[name=title]') === 'Saturday group' && /Point chosen: 3\d\.\d{5}/.test(await txt(p, '#ses-form .ses-pin-text')), 'the hub reopens with the draft kept and the point set');
await p.click('#ses-form [data-act=preset-saturday]');
await p.waitForSelector('#ses-form .ses-preview li');
ok(await p.locator('#ses-form .ses-preview li').count() === 3 && /4 sessions/.test(await txt(p, '#ses-form .ses-preview')) && /Sat/.test(await txt(p, '#ses-form .ses-preview li')), 'the Saturday preset previews the first three dates and the total of four');
await p.fill('#ses-form input[name=capacity]', '8');
await p.click('#ses-form input[name=ses-vis][value=public]');
await p.click('#ses-create');
ok(/Confirm that anyone will see the exact meeting point/.test(await txt(p, '#ses-form .ses-message')) && (await sql(`select count(*)::int as n from public.flight_sessions where title = 'Saturday group'`))[0].n === 0, 'a public session cannot be created without confirming the exact point is visible');
await p.click('#ses-form input[name=ses-vis][value=private]');
await p.click('#ses-create');
await p.waitForSelector(body + ' .ses-row:has-text("Saturday group")', { timeout: 6000 });
const made = await sql(`select visibility, capacity, series_ordinal, timezone from public.flight_sessions where title = 'Saturday group' order by series_ordinal`);
ok(made.length === 4 && made.every((r) => r.visibility === 'private' && r.capacity === 8) && made.map((r) => r.series_ordinal).join() === '1,2,3,4', 'creating the series makes four private occurrences with capacity 8');
ok(await p.locator(body + ' .ses-row:has-text("Saturday group")').count() === 4 && /Session 1 of 4/.test(await txt(p, body)), 'My sessions lists them under Hosting as Session 1 of 4 ...');
await rowOf(p, 'Saturday group').first().locator('[data-act=details]').click();
await p.waitForSelector('#ses-manage');
ok(/host this session: you can edit it/.test(await txt(p, body + ' .ses-role')) && /cannot/.test(await txt(p, body + ' .ses-role')), 'the host sees: you host this session, but you cannot verify attendance for XP');
ok(await p.locator(body + ' [data-act=mark]').count() === 0 && await p.locator(body + ' [data-act=mark-code]').count() === 0 && await p.locator(body + ' [data-act=close]').count() === 0 && /not verify attendance for XP/.test(await txt(p, body + ' .ses-noverify')), 'and has no Mark present, no walk-in form and no Close');
// invite D by code to the whole series; D sees it under Invitations
const codeD = (await one(D, 'public.ensure_profile()')).friend_code;
await p.selectOption(body + ' .ses-invite-form select', 'series');
await p.fill(body + ' .ses-invite-form input', codeD); await p.click(body + ' [data-act=invite]');
await say(p, /Invitation sent/);
await p.selectOption(body + ' .ses-link-form select:nth-of-type(1)', 'series').catch(() => {});
await p.click(body + ' [data-act=link]');
await p.waitForSelector('#ses-link-url', { timeout: 5000 });
const url = await p.inputValue('#ses-link-url');
ok(await p.locator('[data-act=share]').count() === 0, 'private details never offer public sharing');
ok(/#session=[A-Za-z0-9]{32,}$/.test(url) && /Copy it now/.test(await txt(p, body + ' .ses-message')), 'a private link is shown once with its token after #');
const tokenInDb = (await sql(`select token_hash from public.session_links`))[0]?.token_hash;
ok(tokenInDb && !url.includes(tokenInDb), 'only a hash of the token is stored');
await p.click('#ses-back');
await ctx.close();

// D: the invitation tab shows the series invitation; D can RSVP to one occurrence of the private series
({ ctx, p } = await open('d'));
await openHub(p);
ok(await p.locator(hub + ' .ses-tab[data-section=invites] .tab-badge').count() === 1, 'a badge on Invitations says something is waiting');
await goTab(p, 'invites');
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
ok(await p.locator(body + ' .ses-row:has-text("Saturday group")').count() === 4 && /Invited to the whole series/.test(await txt(p, body)) && !/Secret field|Private club/.test(await txt(p, body)), 'Invitations lists the four occurrences, says the whole series, and shows nothing else that is private');
await p.locator(body + ' .ses-row').first().locator('[data-act=details]').click();
await p.waitForSelector(body + ' [data-act=rsvp]', { timeout: 5000 });
await p.click(body + ' [data-act=rsvp]'); await p.waitForSelector(body + ' [data-act=withdraw]', { timeout: 5000 });
ok((await sql(`select count(*)::int as n from public.session_rsvps where user_id = $1 and session_id in (select id from public.flight_sessions where title = 'Saturday group')`, [D]))[0].n === 1, 'RSVP applies to one occurrence only');
ok(!(await p.locator(body + ' #ses-manage').count()), 'an invitee does not get the host tools');
await ctx.close();

// the host revokes the invitation: D no longer sees the series
({ ctx, p } = await open('c'));
await openHub(p, 'mine');
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
await rowOf(p, 'Saturday group').first().locator('[data-act=details]').click();
await p.waitForSelector(body + ' [data-act=revoke-invite]', { timeout: 5000 });
await p.click(body + ' [data-act=revoke-invite]');
await say(p, /Invitation revoked/);
await p.click(body + ' [data-act=revoke-link]'); await say(p, /Link revoked/);
ok((await sql(`select count(*)::int as n from public.session_invitations where invitee = $1 and revoked_at is null`, [D]))[0].n === 0 && (await sql('select count(*)::int as n from public.session_links where revoked_at is null'))[0].n === 0, 'revoking an invitation and a link takes effect');
await ctx.close();

// ---------- the organiser: marks attendance at a session they host, with the XP wording
({ ctx, p } = await open('b'));
await openHub(p, 'mine');
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
await rowOf(p, 'Field day').locator('[data-act=details]').click();
await p.waitForSelector('#ses-manage', { timeout: 5000 });
ok(/host this session and can verify attendance for XP/.test(await txt(p, body + ' .ses-role')), 'an organiser who hosts it sees: you host this session and can verify attendance for XP');
await p.waitForSelector(body + ' .ses-person', { timeout: 5000 });
ok(await p.locator(body + ' .ses-person').count() === 1 && /Cam/.test(await txt(p, body + ' .ses-person')) && /Said they will come/.test(await txt(p, body + ' .ses-person')), 'Manage lists who said they will come');
await p.click(body + ' .ses-person [data-act=mark]');
await say(p, /Cam: marked present/);
ok((await sql(`select total from public.user_xp where user_id = $1`, [C]))[0].total === 50, 'marking an RSVP present awards the 50 XP');
await p.fill(body + ' .ses-walkin input', cD.toUpperCase().slice(0, 5) + '-' + cD.toUpperCase().slice(5)); await p.click(body + ' [data-act=mark-code]');
await say(p, /Dee: marked present/);
ok((await sql(`select total from public.user_xp where user_id = $1`, [D]))[0].total === 50, 'a walk-in marked by friend code gets the XP');
await p.fill(body + ' .ses-walkin input', cB); await p.click(body + ' [data-act=mark-code]');
await say(p, /yourself/);
ok((await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1`, [B]))[0].n === 0, 'an organiser cannot mark themselves present');
await p.click(body + ' [data-act=close]');
await p.waitForSelector(body + ' .badge:has-text("Closed")', { timeout: 5000 });
ok((await sql(`select status from public.flight_sessions where id = $1`, [nowS]))[0].status === 'closed', 'closing a session ends marking');
// remove a participant of the tomorrow session: D holds the place
await p.click('#ses-back'); await goTab(p, 'mine');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=details]').click();
await p.waitForSelector(body + ' .ses-person [data-act=remove]', { timeout: 5000 });
await p.click(body + ' .ses-person [data-act=remove]');
await p.waitForSelector(body + ' .ses-person', { state: 'detached', timeout: 5000 });
ok((await sql(`select count(*)::int as n from public.session_rsvps where session_id = $1`, [nextS]))[0].n === 0, 'a host can remove a participant');
// edit: change the place name and capacity; the participants are told
await p.click(body + ' [data-act=edit]');
await p.fill('#se-3', 'North field'); await p.click(body + ' [data-act=save]');
await say(p, /Saved/);
ok((await sql(`select location from public.flight_sessions where id = $1`, [nextS]))[0].location === 'North field', 'editing saves the new place name');
await ctx.close();

// ---------- the administrator revokes a mistaken mark
({ ctx, p } = await open('a'));
await openHub(p, 'mine');
await p.waitForSelector(body + ' .ses-group', { timeout: 5000 });
ok(await p.locator(body + ' .ses-row:has-text("Field day")').count() === 0, 'an administrator does not see other people\'s sessions under My sessions');
await goTab(p, 'discover');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=details]').click();
await p.waitForSelector('#ses-manage', { timeout: 5000 });
ok(/As an administrator you can verify attendance/.test(await txt(p, body + ' .ses-role')), 'an administrator is told they can verify attendance for XP');
await ctx.close();

// ---------- a guest: Discover works (exact point visible), everything else asks to sign in
({ ctx, p } = await open('guest'));
await openHub(p);
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
ok(await p.locator(body + ' .ses-row').count() >= 2 && !/Private club|Secret field/.test(await txt(p, body)) && await p.locator('#ses-new').count() === 0 && await p.locator(body + ' [data-act=signin]').count() === 1, 'a guest sees the public sessions, no private one, and a Sign in prompt instead of New session');
await rowOf(p, 'Far away').locator('[data-act=details]').click();
await p.waitForSelector(body + ' [data-act=signin]', { timeout: 5000 });
ok(/Meeting point: 40\.0/.test(await txt(p, body)) && await p.locator(body + ' [data-act=rsvp]').count() === 0 && await p.locator(body + ' [data-act=report]').count() === 0, 'a guest sees the exact point and is asked to sign in to RSVP (no RSVP or report button)');
await p.click('#ses-back'); await goTab(p, 'mine');
ok(/Sign in to see the sessions you host/.test(await txt(p, body)), 'My sessions asks a guest to sign in');
await ctx.close();

// ---------- a private link: D opens it signed in and is invited; a guest who opens it keeps it for after sign-in and the address is cleaned
const link = await one(B, `public.create_session_link($1, 'occurrence', 24, 5)`, [privS]);
({ ctx, p } = await open('d', { hash: '#session=' + link.token }));
await p.waitForSelector(hub + '[open]', { timeout: 6000 });
await p.waitForSelector(body + ' [data-act=rsvp]', { timeout: 6000 });
ok(/Private club/.test(await txt(p, body)) && /You are invited/.test(await txt(p, body)) && (await p.evaluate(() => location.hash)) === '', 'opening a link signed in adds the invitation, opens the session and removes the token from the address');
ok((await sql(`select uses from public.session_links where id = $1`, [link.id]))[0].uses === 1 && (await sql(`select via from public.session_invitations where invitee = $1 and session_id = $2`, [D, privS]))[0].via === 'link', 'the link counted one use and the invitation says via link');
await ctx.close();
({ ctx, p } = await open('guest', { hash: '#session=' + link.token }));
await p.waitForSelector(hub + '[open]', { timeout: 6000 });
ok(/Sign in to accept the invitation/.test(await txt(p, body)) && (await p.evaluate(() => location.hash)) === '' && (await p.evaluate(() => sessionStorage.getItem('uavzones.session-link'))) === link.token, 'a guest is asked to sign in; the token is kept for this tab only and removed from the address');
ok((await sql(`select uses from public.session_links where id = $1`, [link.id]))[0].uses === 1, 'a guest cannot use up a link');
await ctx.close();
await one(B, `public.revoke_session_link($1)`, [link.id]);
({ ctx, p } = await open('c', { hash: '#session=' + link.token }));
await p.waitForSelector(hub + '[open]', { timeout: 6000 });
await p.waitForSelector(body + ' .ses-message', { timeout: 6000 });
ok(/not valid/.test(await txt(p, body + ' .ses-message')) && (await sql(`select count(*)::int as n from public.session_invitations where invitee = $1 and session_id = $2`, [C, privS]))[0].n === 0, 'a revoked link says it is not valid and invites nobody');
await ctx.close();

// ---------- the dashboard card
({ ctx, p } = await open('c'));
await p.evaluate(() => { localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: true, welcomed: true, seen: '9999' })); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.locator('#name-dlg-skip').click({ timeout: 1500 }).catch(() => {});
await p.evaluate(() => document.getElementById('dash-peek')?.click());
await p.waitForSelector('#task-sessions', { timeout: 6000 });
ok(await p.locator('#task-sessions').count() === 1 && /Find sessions/.test(await txt(p, '#task-sessions')) && await p.locator('.dash-sessions').count() === 0, 'the dashboard has the Find sessions shortcut and no empty Flight sessions card');
await p.locator('#task-sessions').click();
await p.waitForSelector(hub + '[open]', { timeout: 4000 });
ok(await p.locator(hub + '[open]').count() === 1, 'its button opens the hub');
await p.keyboard.press('Escape');
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').sessionsNearby)) !== true, 'nearby discovery is off until the person asks for it');
await p.evaluate(() => document.getElementById('help-open').click());
await p.evaluate(() => document.querySelectorAll('.dash-topic').forEach((d) => { d.open = true; }));
await p.check('.dash-help-view .ses-nearby input'); await p.waitForTimeout(900);
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').sessionsNearby)) === true, 'ticking the box in Help saves the opt-in (it uses the map centre, never the position)');
await p.evaluate(() => document.getElementById('dash-back').click()); await p.waitForTimeout(300);
ok(await p.locator('.dash-sessions').count() <= 1, 'with it on, the dashboard card may appear when sessions are nearby');
await ctx.close();

// ---------- a phone
({ ctx, p } = await open('b', { vp: { width: 360, height: 740 }, mobile: true }));
await p.evaluate(() => document.querySelector('.sessions-btn').click());
await p.waitForSelector(hub + '[open]', { timeout: 4000 });
await goTab(p, 'mine');
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
const fit = await p.evaluate(() => { const c = document.getElementById('ses-hub').getBoundingClientRect(); return { l: c.left, r: c.right, w: innerWidth, sw: document.getElementById('ses-hub-body').scrollWidth, cw: document.getElementById('ses-hub-body').clientWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w + 1 && fit.sw <= fit.cw + 1, 'on a 360 px phone the hub fills the screen without sideways scrolling (' + Math.round(fit.l) + ' to ' + Math.round(fit.r) + ' of ' + fit.w + ')');
await ctx.close();

// ---------- Wave A: the Today filter and the Has-space page filter (discover-list-guards)
await db.exec(`delete from public.flight_sessions where title like 'Full %'`);
await ins('Today only', { s: hr(-0.5), e: hr(1), lat: 10, lng: 10 }); await ins('Later day', { s: hr(30), e: hr(32), lat: 10, lng: 10 });
({ ctx, p } = await open('c'));
await openHub(p);
await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
const opts = await p.$$eval('#ses-when-f option', (o) => o.map((x) => x.textContent));
ok(opts.join('|') === 'Any date|Today (your time)|Next 7 days|Next 30 days', 'the date filter has Today: ' + opts.join('|'));
await p.selectOption('#ses-when-f', 'today'); await p.waitForTimeout(700);
const todayRows = await p.locator(body + ' .ses-row').allTextContents();
ok(todayRows.length >= 1 && todayRows.every((t) => !/Later day|Far away/.test(t)) && todayRows.some((t) => /Today only/.test(t)), 'Today keeps what is under way and drops tomorrow and later (' + todayRows.length + ' rows)');
const fullIds = [];
for (let i = 0; i < 20; i++) fullIds.push(await ins('Full ' + i, { s: hr(-1.9 + i / 100), e: hr(1 + i / 100), cap: 1, lat: 10, lng: 10 }));
for (const id of fullIds) await sql(`insert into public.session_rsvps (session_id, user_id) values ($1, $2)`, [id, D]);
await p.selectOption('#ses-when-f', 'any'); await p.waitForTimeout(700);
await p.check('.ses-check input'); await p.waitForTimeout(400);
ok(await p.locator(body + ' .ses-row').count() === 0 && !/No public sessions match/.test(await txt(p, body)) && await p.locator(body + ' [data-act=more]').isVisible(), 'Has space with a page of full sessions shows Show more, not a false empty state');
await p.click(body + ' [data-act=more]'); await p.waitForTimeout(700);
ok(/Today only/.test(await txt(p, body)), 'Show more reaches the sessions that have space');
await p.uncheck('.ses-check input'); await ctx.close();
await db.exec(`delete from public.flight_sessions where title like 'Full %' or title in ('Today only', 'Later day')`);

// ---------- Wave B2: the XP badge from the database, the host and attendee popovers with Add friend, the attendee-list switch
await db.exec(`delete from public.flight_sessions where title in ('People meet', 'Plain meet')`);
await db.exec(`delete from public.friendships`);
const peopleS = (await sql(`insert into public.flight_sessions (title, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, timezone) values ('People meet', 10, 10, $1, $2, $3, 'public', 'published', 'Asia/Shanghai') returning id`, [hr(3), hr(5), B]))[0].id;
await sql(`insert into public.flight_sessions (title, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, timezone) values ('Plain meet', 11, 11, $1, $2, $3, 'public', 'published', 'Asia/Shanghai')`, [hr(3), hr(5), C]);
await db.exec(`insert into public.session_rsvps (session_id, user_id) values ('${peopleS}', '${A}'), ('${peopleS}', '${D}')`);
{
  const cA2 = await one(A, 'public.ensure_profile()').then((r) => r.friend_code);
  const fq = await one(C, 'public.request_friend($1)', [cA2]); await one(A, 'public.respond_friend($1, true)', [fq.id]); // C and Alex are friends; Bea and Dee are strangers to C
  ({ ctx, p } = await open('c'));
  await openHub(p); await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
  await p.fill('#ses-q', 'meet'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700);
  ok(/\+50 XP/.test(await rowOf(p, 'People meet').textContent()) && !/XP/.test(await rowOf(p, 'Plain meet').textContent()), 'the XP badge comes from the database: an organiser\'s session shows +50 XP, an ordinary host\'s shows none');
  ok(/RSVP alone earns none/.test(await rowOf(p, 'People meet').locator('.badge.xp').getAttribute('title')), 'its text says RSVP alone earns nothing');
  await rowOf(p, 'People meet').locator('[data-act=host-profile]').click(); await p.waitForTimeout(900);
  ok(await p.locator(hub + ' #profile-pop:not([hidden])').count() === 1 && /Bea/.test(await txt(p, hub + ' #profile-pop')) && await p.locator(hub + ' #profile-pop [data-act=add-friend]').count() === 1, 'the host opens the profile popover inside the dialog, with Add friend for a stranger');
  const pb = await p.locator('#profile-pop').boundingBox(); const vp = p.viewportSize();
  ok(pb.x >= 0 && pb.y >= 0 && pb.x + pb.width <= vp.width && pb.y + pb.height <= vp.height + 1, 'the popover is on screen');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(await p.locator('#profile-pop:not([hidden])').count() === 0 && await p.locator(hub + '[open]').count() === 1, 'Escape closes only the popover, not the dialog');
  await rowOf(p, 'People meet').locator('[data-act=host-profile]').click(); await p.waitForTimeout(700);
  await p.click(hub + ' #profile-pop [data-act=add-friend]'); await p.waitForTimeout(900);
  ok(/Friend request sent/.test(await txt(p, hub + ' #profile-pop')) && (await sql(`select 1 from public.friendships where requester = '${C}' and addressee = '${B}' and status = 'pending'`)).length === 1, 'Add friend sends the request and says so');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await rowOf(p, 'People meet').locator('[data-act=details]').click(); await p.waitForSelector(body + ' .ses-attendee', { timeout: 6000 });
  const names = await p.locator(body + ' .ses-attendee-name').allTextContents();
  ok(names.join('|') === 'Bea|Alex|Dee', 'the detail lists the host first, then the people who are coming: ' + names.join('|'));
  ok(/Your name and picture show/.test(await txt(p, body + ' .ses-rsvp-note')) && /Host/.test(await txt(p, body + ' .ses-attendee')), 'the RSVP step has the notice and the host is marked');
  ok((await txt(p, body + ' .ses-xp-text')) === 'Earn 50 XP when your attendance is verified. RSVP alone earns no XP.' && await p.locator(body + ' .ses-xp').getAttribute('data-xp') === 'attendee' && await p.locator(body + ' .ses-xp').evaluate((e) => e.previousElementSibling?.classList.contains('ses-people')), 'the EXP section after Who is coming explains the attendee rule (the amount from the session)');
  await p.locator(body + ' .ses-attendee', { hasText: 'Alex' }).click(); await p.waitForTimeout(900);
  ok(/In your friends list/.test(await txt(p, hub + ' #profile-pop')) && await p.locator(hub + ' #profile-pop [data-act=add-friend]').count() === 0, 'a friend shows "In your friends list" and no Add friend');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.locator(body + ' .ses-attendee', { hasText: 'Dee' }).click(); await p.waitForTimeout(700);
  ok(await p.locator(hub + ' #profile-pop [data-act=add-friend]').count() === 1 && !/@|[0-9a-f]{8}-[0-9a-f]{4}/.test(await txt(p, hub + ' #profile-pop')), 'a stranger: name, picture and Add friend, no id in sight');
  await p.click(hub + ' #profile-pop [data-act=add-friend]'); await p.waitForTimeout(900);
  ok((await sql(`select 1 from public.friendships where requester = '${C}' and addressee = '${D}'`)).length === 1, 'Add friend from the list sends a request by handle');
  await ctx.close();

  // a guest: the list and the popover work, Add friend asks to sign in
  ({ ctx, p } = await open('guest'));
  await openHub(p); await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
  await p.fill('#ses-q', 'People'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700);
  await rowOf(p, 'People meet').locator('[data-act=details]').click(); await p.waitForSelector(body + ' .ses-attendee', { timeout: 6000 });
  ok(await p.locator(body + ' .ses-attendee').count() === 3, 'a guest sees the list of a public session');
  await p.locator(body + ' .ses-attendee', { hasText: 'Dee' }).click(); await p.waitForTimeout(600);
  await p.click(hub + ' #profile-pop [data-act=add-friend]'); await p.waitForTimeout(500);
  ok(/Sign in to add friends/.test(await txt(p, '#toast')), 'a guest\'s Add friend asks them to sign in');
  await ctx.close();

  // the opt-out switch
  ({ ctx, p } = await open('d'));
  await openHub(p, 'mine'); await p.waitForSelector('#ses-in-lists', { timeout: 5000 });
  ok(await p.isChecked('#ses-in-lists'), 'the attendee-list switch is on by default');
  await p.uncheck('#ses-in-lists'); await p.waitForTimeout(800);
  ok((await sql(`select show_in_attendee_lists as v from public.profiles where user_id = '${D}'`))[0].v === false, 'switching it off is stored');
  await ctx.close();
  ({ ctx, p } = await open('guest'));
  await openHub(p); await p.fill('#ses-q', 'People'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700);
  await rowOf(p, 'People meet').locator('[data-act=details]').click(); await p.waitForSelector(body + ' .ses-attendee', { timeout: 6000 });
  ok((await p.locator(body + ' .ses-attendee-name').allTextContents()).join('|') === 'Bea|Alex', 'someone who switched it off is no longer listed');
  await ctx.close();

  // a phone: the popover is a sheet inside the dialog
  ({ ctx, p } = await open('c', { vp: { width: 360, height: 740 }, mobile: true }));
  await p.evaluate(() => document.querySelector('.sessions-btn').click()); await p.waitForSelector(hub + '[open]'); await p.waitForSelector(body + ' .ses-row', { timeout: 5000 });
  await p.fill('#ses-q', 'People'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700);
  await rowOf(p, 'People meet').locator('[data-act=host-profile]').click(); await p.waitForTimeout(900);
  const sb = await p.locator('#profile-pop').boundingBox();
  ok(await p.locator(hub + ' #profile-pop:not([hidden])').count() === 1 && sb.x >= 0 && sb.x + sb.width <= 361 && sb.y >= 0 && sb.y + sb.height <= 741, 'on a 360 px phone the profile sheet fits the screen inside the dialog');
  await ctx.close();

  // the host (an organiser): the amounts are the database's host reward settings, read again after they change
  const rates = async (base, per) => db.exec(`update public.progression_settings set value = ${base} where key = 'host_base_xp'; update public.progression_settings set value = ${per} where key = 'host_per_attendee_xp'`);
  const hostNote = async (p) => { await openHub(p); await p.waitForSelector(body + ' .ses-row', { timeout: 5000 }); await p.fill('#ses-q', 'meet'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700); await rowOf(p, 'People meet').locator('[data-act=details]').click(); await p.waitForSelector(body + ' .ses-xp-text', { timeout: 6000 }); return txt(p, body + ' .ses-xp-text'); };
  ({ ctx, p } = await open('b'));
  const first = await hostNote(p);
  ok(first === 'Earn 50 XP when the session closes, plus 10 XP for each verified attendee. At least one verified attendee is required for the host reward.', 'the host is told the close reward and the per-attendee amount, from the database: ' + first);
  await rates(40, 12);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
  const changed = await hostNote(p);
  ok(/Earn 40 XP when the session closes, plus 12 XP for each verified attendee/.test(changed), 'changing the database settings changes the host text, with no app change');
  await rates(50, 10);
  await ctx.close();
  ({ ctx, p } = await open('c'));
  await openHub(p); await p.waitForSelector(body + ' .ses-row', { timeout: 5000 }); await p.fill('#ses-q', 'Plain'); await p.press('#ses-q', 'Enter'); await p.waitForTimeout(700);
  await rowOf(p, 'Plain meet').locator('[data-act=details]').click(); await p.waitForSelector(body + ' .ses-xp-text', { timeout: 6000 });
  ok(/^Earn 50 XP when the session closes/.test(await txt(p, body + ' .ses-xp-text')) && await p.locator(body + ' .badge.xp').count() === 0, 'an ordinary host is still told about the host reward (no organiser role needed), while the attendee XP badge stays absent');
  await ctx.close();
}
await db.exec(`delete from public.flight_sessions where title in ('People meet', 'Plain meet')`);

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
