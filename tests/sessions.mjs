// Flight sessions in the browser: RSVP and withdraw as an ordinary person, creating a session and marking people present as an organiser (from the RSVP list and by friend code),
// revoking a mark as an administrator, the error state, and a phone width. The real Supabase client talks to a mocked HTTP server whose functions run the real SQL on an
// in-memory Postgres (PGlite), so the screen is tested against the real rules.
import { chromium, CHANNEL } from './lib.mjs';
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions']);
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

const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'], c: [C, 'c@example.test'] };
const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, mobile = false } = {}) {
  const [uid, email] = WHO[who];
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, dash]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify(dash));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, session(uid, email), { v: 1, showOnStart: false, welcomed: true, seen: '9999' }]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Marked the wrong person') : d.accept()));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
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
const card = '#fr-sessions .ses-card';
const txt = async (p, sel) => (await p.textContent(sel).catch(() => '')) ?? '';
const rowOf = (p, title) => p.locator(`${card} .ses-row`, { hasText: title });

// ---------- an ordinary person with no sessions planned
let { ctx, p } = await open('c');
await goFriends(p);
await p.waitForSelector(card + '[data-status=ready]', { timeout: 5000 });
ok(/No flight sessions are planned yet/.test(await txt(p, card)) && await p.locator('#ses-new').count() === 0, 'with nothing planned the card says so, and an ordinary person has no way to create a session');
await ctx.close();

// ---------- sessions exist: one under way (B's), one tomorrow (B's)
const nowS = (await sql(`insert into public.flight_sessions (title, description, location, starts_at, ends_at, created_by) values ('Field day', 'Bring batteries', 'East Lake', $1, $2, $3) returning id`, [hr(-1), hr(2), B]))[0].id;
const nextS = (await sql(`insert into public.flight_sessions (title, starts_at, ends_at, created_by) values ('Tomorrow meetup', $1, $2, $3) returning id`, [hr(24), hr(27), B]))[0].id;

({ ctx, p } = await open('c'));
await goFriends(p);
await p.waitForSelector(card + ' .ses-row', { timeout: 5000 });
ok(await p.locator(card + ' .ses-row').count() === 2 && /Field day/.test(await txt(p, card)) && /East Lake/.test(await txt(p, card)) && /0 people are coming/.test(await txt(p, card)), 'the sessions are listed with when, where and how many are coming');
ok(await rowOf(p, 'Field day').locator('.badge', { hasText: 'Under way' }).count() === 1, 'one is marked as under way');
ok(await p.locator(card + ' [data-act=manage]').count() === 0, 'an ordinary person sees no management controls');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=rsvp]').click();
await p.waitForSelector(card + ' .ses-row:has-text("Tomorrow meetup") [data-act=withdraw]', { timeout: 5000 });
ok(/1 person is coming/.test(await txt(p, card + ' .ses-row:has-text("Tomorrow meetup")')) && /on the list/.test(await txt(p, card + ' .ses-message')), 'RSVP puts you on the list, and the count goes up');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=withdraw]').click();
await p.waitForSelector(card + ' .ses-row:has-text("Tomorrow meetup") [data-act=rsvp]', { timeout: 5000 });
ok(/0 people are coming/.test(await txt(p, card + ' .ses-row:has-text("Tomorrow meetup")')), 'before it starts you can withdraw');
await rowOf(p, 'Field day').locator('[data-act=rsvp]').click();
await p.waitForSelector(card + ' .ses-row:has-text("Field day") .badge:has-text("You said you will come")', { timeout: 5000 });
ok(await rowOf(p, 'Field day').locator('[data-act=withdraw]').count() === 0, 'once it has started the RSVP can no longer be withdrawn');
ok((await sql(`select total from public.user_xp where user_id = $1`, [C])).length === 0 || (await sql(`select total from public.user_xp where user_id = $1`, [C]))[0].total === 0, 'an RSVP gives no XP');
await ctx.close();

// ---------- the organiser
({ ctx, p } = await open('b'));
await goFriends(p);
await p.waitForSelector(card + ' .ses-row', { timeout: 5000 });
ok(await p.locator('#ses-new').count() === 1 && await p.locator(card + ' [data-act=manage]').count() === 2, 'an organiser sees New session and Manage on their sessions');
await p.click('#ses-new');
await p.fill('#ses-title', 'Test   meetup'); await p.fill('#ses-location', 'Hankou'); await p.fill('#ses-details', 'Casual flying');
await p.click('#ses-create');
await p.waitForSelector(card + ' .ses-row:has-text("Test meetup")', { timeout: 5000 });
ok(/Hankou/.test(await txt(p, card)) && (await sql(`select title from public.flight_sessions where title = 'Test meetup'`)).length === 1 && await p.locator('#ses-form').count() === 0, 'creating a session adds it (the title tidied) and closes the form');
await rowOf(p, 'Field day').locator('[data-act=manage]').click();
await p.waitForSelector(card + ' .ses-person', { timeout: 5000 });
ok(await p.locator(card + ' .ses-person').count() === 1 && /Cam/.test(await txt(p, card + ' .ses-person')) && /Said they will come/.test(await txt(p, card + ' .ses-person')), 'Manage lists who said they will come');
await rowOf(p, 'Field day').locator('.ses-person [data-act=mark]').click();
await p.waitForSelector(card + ' .ses-person:has-text("Present")', { timeout: 5000 });
await p.waitForFunction((sel) => /Cam: marked present/.test(document.querySelector(sel)?.textContent ?? ''), card + ' .ses-message', { timeout: 5000 });
ok(/Cam: marked present/.test(await txt(p, card + ' .ses-message')) && (await sql(`select total from public.user_xp where user_id = $1`, [C]))[0].total === 50, 'marking an RSVP present awards the 50 XP');
ok(await rowOf(p, 'Field day').locator('.ses-person [data-act=mark]').count() === 0, 'and the Mark button is gone for them');
await p.fill(card + ' .ses-walkin input', cD.toUpperCase().slice(0, 5) + '-' + cD.toUpperCase().slice(5));
await p.click(card + ' [data-act=mark-code]');
await p.waitForSelector(card + ' .ses-person:has-text("Dee")', { timeout: 5000 });
ok(/Dee: marked present/.test(await txt(p, card + ' .ses-message')) && /walk-in/.test(await txt(p, card + ' .ses-person[data-name=Dee]')) && (await sql(`select total from public.user_xp where user_id = $1`, [D]))[0].total === 50, 'someone who came without an RSVP is marked by friend code');
await p.fill(card + ' .ses-walkin input', cD); await p.click(card + ' [data-act=mark-code]');
await p.waitForSelector(card + ' .ses-message:has-text("already marked")', { timeout: 5000 });
ok((await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1 and source = 'attendance'`, [D]))[0].n === 1, 'marking them again says so and awards nothing more');
await p.fill(card + ' .ses-walkin input', cB); await p.click(card + ' [data-act=mark-code]');
await p.waitForSelector(card + ' .ses-message:has-text("yourself")', { timeout: 5000 });
ok((await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1`, [B]))[0].n === 0, 'an organiser cannot mark themselves present: the database says so and nothing is awarded');
ok(await rowOf(p, 'Tomorrow meetup').locator('[data-act=manage]').count() === 1, '(the future session has its own Manage)');
await rowOf(p, 'Tomorrow meetup').locator('[data-act=manage]').click();
await p.waitForSelector(card + ' .ses-row:has-text("Tomorrow meetup") .ses-manage', { timeout: 5000 });
ok(/once the session has started/.test(await txt(p, card + ' .ses-row:has-text("Tomorrow meetup") .ses-manage')) && await rowOf(p, 'Tomorrow meetup').locator('[data-act=mark-code]').count() === 0, 'before a session starts there is nothing to mark');
await rowOf(p, 'Field day').locator('[data-act=close]').click();
await p.waitForSelector(card + ' .ses-row:has-text("Field day") .badge:has-text("Closed")', { timeout: 5000 });
ok(await rowOf(p, 'Field day').locator('[data-act=mark-code]').count() === 0 && (await sql(`select status from public.flight_sessions where id = $1`, [nowS]))[0].status === 'closed', 'closing a session ends marking');
await ctx.close();

// ---------- the person who was marked present sees it
({ ctx, p } = await open('c'));
await goFriends(p);
await p.waitForSelector(card + ' .ses-row:has-text("Field day") .ses-attended', { timeout: 5000 });
await goProfile(p);
ok(await p.locator('#account-pop #pane-progression .prog-xp b').textContent() === '50' && /Moving|Rookie/.test(await txt(p, '#account-pop #pane-progression')), 'Cam sees "You were there" and 50 XP in the progression card');
ok(await p.locator('#account-pop #pane-progression [data-act=collection]').textContent().then((t) => /Achievements 1\/16/.test(t)), 'and First Meetup unlocked');
await ctx.close();

// ---------- the administrator revokes a mistaken mark
({ ctx, p } = await open('a'));
await goFriends(p);
await p.waitForSelector(card + ' .ses-row:has-text("Field day")', { timeout: 5000 });
ok(await p.locator(card + ' [data-act=manage]').count() >= 3, 'an administrator can manage every session');
await rowOf(p, 'Field day').locator('[data-act=manage]').click();
await p.waitForSelector(card + ' .ses-person[data-name=Dee] [data-act=revoke]', { timeout: 5000 });
await p.click(card + ' .ses-person[data-name=Dee] [data-act=revoke]');
await p.waitForSelector(card + ' .ses-person[data-name=Dee]:has-text("revoked")', { timeout: 5000 });
const rev = (await sql(`select amount, actor, reason from public.xp_ledger where user_id = $1 and ref like '%:rev'`, [D]))[0];
ok(rev && rev.amount === -50 && rev.actor === A && rev.reason === 'Marked the wrong person' && (await sql(`select total from public.user_xp where user_id = $1`, [D]))[0].total === 0, 'revoking asks for a reason and reverses the XP in the ledger');
ok(await p.locator(card + ' .ses-person[data-name=Dee] [data-act=revoke]').count() === 0, 'and the mark shows as revoked');
await ctx.close();

// ---------- error state
({ ctx, p } = await open('c'));
fault.list = true;
await goFriends(p);
await p.waitForSelector(card + '[data-status=error]', { timeout: 6000 });
ok(/unavailable right now/.test(await txt(p, card)) && await p.locator(card + ' button', { hasText: 'Try again' }).count() === 1 && await p.locator('#pane-friends #fr-friends').count() === 1, 'if sessions cannot be loaded the card says so with Try again, and the rest of the tab still works');
fault.list = false;
await p.click(card + ' button');
await p.waitForSelector(card + '[data-status=ready]', { timeout: 6000 });
ok(await p.locator(card + ' .ses-row').count() >= 2, 'Try again loads them');
await ctx.close();

// ---------- a phone
({ ctx, p } = await open('b', { vp: { width: 360, height: 740 }, mobile: true }));
await goFriends(p);
await p.waitForSelector(card + ' .ses-row', { timeout: 5000 });
await p.evaluate(() => document.querySelector('#fr-sessions [data-act=manage]').click());
await p.waitForSelector(card + ' .ses-manage', { timeout: 5000 });
const fit = await p.evaluate(() => { const c = document.getElementById('fr-sessions').getBoundingClientRect(); return { l: c.left, r: c.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w + 1 && fit.sw <= fit.w + 1, 'on a 360 px phone the card with a manage panel fits the screen (' + Math.round(fit.l) + ' to ' + Math.round(fit.r) + ' of ' + fit.w + ')');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
