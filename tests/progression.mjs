// Progression in the browser: your own card and collection, other people's cards in the profile popover (partial data, maximum rank, hidden, loading, error), featuring,
// XP history, and a phone width. The real Supabase client talks to a mocked HTTP server whose functions run the real SQL on an in-memory Postgres (PGlite).
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
const SETOF = new Set(['list_friends', 'list_blocked']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const calls = [];
const fault = { progFail: false, progDelay: 0 };
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1]; calls.push(fn);
  if (fn === 'get_progression' && fault.progDelay) await new Promise((r) => setTimeout(r, fault.progDelay));
  if (fn === 'get_progression' && fault.progFail) return reply({ message: 'server unavailable' }, 500);
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

const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'] };
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
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}
const goFriends = async (p) => { await p.evaluate(() => { const t = document.getElementById('tab-friends'); if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=friends]').click(); else t.click(); }); await p.waitForTimeout(900); };
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;

// ---------- the data: A looks at B (Cadet), C (Ace) and D (hides progression); A has 175 XP and two achievements
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
for (const y of [B, C, D]) { const r = await one(A, 'public.request_friend($1)', [await code(y)]); await one(y, 'public.respond_friend($1, true)', [r.id]); }
for (let i = 1; i <= 7; i++) await db.query(`select public.award_xp($1, 50, 'attendance', $2)`, [B, 'session:' + i]);
await db.query(`select public.award_xp($1, 3650, 'admin', 'seed', 'seed')`, [C]);
await one(D, 'public.update_profile($1::jsonb)', [JSON.stringify({ share_profile: false })]);
for (let h = 1; h <= 10; h++) await db.query(`select public.award_xp($1, 10, 'sim', $2)`, [A, 'hour:' + h]);
await db.query(`select public.award_xp($1, 75, 'admin', 'seed2', 'A welcome bonus')`, [A]);

// ---------- your own card
let { ctx, p } = await open('a');
await goFriends(p);
const card = '#fr-progression .prog-card';
await p.waitForSelector(card + '[data-status=ready]', { timeout: 5000 });
const txt = async (sel) => (await p.textContent(sel).catch(() => '')) ?? '';
ok(await p.locator('#fr-progression').count() === 1 && (await txt(card + ' .prog-rank')) === 'Trainee' && (await txt(card + ' .prog-tier')) === 'Tier 2' && (await txt(card + ' .prog-xp b')) === '175', 'your card sits in the Friends tab with your rank, tier and exact XP');
ok(await p.getAttribute(card + ' .prog-bar', 'aria-valuenow') === '50' && /75 XP to Cadet \(250 XP\)/.test(await txt(card + ' .prog-next')), 'with progress to the next rank (50 percent, 75 XP to Cadet)');
ok(await p.locator(card + ' .rank-badge[data-tier="2"]').count() === 1, 'and the rank badge');
ok(/Open your achievements to feature/.test(await txt(card)) && /Achievements 2\/16/.test(await txt(card + ' [data-act=collection]')) && await p.locator(card + ' [data-act=history]').count() === 1, 'two achievements unlocked, with the collection and history buttons');

// ---------- the collection: locked ones with their criteria, and featuring
await p.click(card + ' [data-act=collection]');
await p.waitForSelector('#prog-dialog[open] .ach-tile', { timeout: 3000 });
const tiles = await p.$$eval('#prog-dialog .ach-tile', (ts) => ts.map((t) => ({ key: t.dataset.key, unlocked: t.dataset.unlocked, rarity: [...t.classList].find((c) => c.startsWith('rar-')), state: t.querySelector('.ach-state').textContent, desc: t.querySelector('.ach-desc').textContent })));
ok(tiles.length === 16 && tiles.filter((t) => t.unlocked === 'true').length === 2 && /2 of 16 unlocked/.test(await txt('#prog-dialog .prog-sum')), 'the collection lists all 16, two unlocked');
const ace = tiles.find((t) => t.key === 'ace-pilot'), ff = tiles.find((t) => t.key === 'first-flight');
ok(ace.unlocked === 'false' && ace.state === 'Locked' && /Reach the Ace rank/.test(ace.desc) && ace.rarity === 'rar-legendary', 'a locked achievement shows how to earn it and its rarity');
ok(ff.unlocked === 'true' && /^Unlocked \d/.test(ff.state), 'your own unlocked ones show when');
ok((await p.$$eval('#prog-dialog .ach-group h3', (hs) => hs.map((h) => h.textContent))).join() === 'Simulator,Community,Progression,Platform', 'grouped by category, in the order given');
ok(await p.locator('#prog-dialog [data-act=feature]').count() === 2 && await p.locator('#prog-dialog [data-key=ace-pilot] [data-act=feature]').count() === 0, 'only unlocked ones can be featured');
await p.click('#prog-dialog [data-key=first-flight] [data-act=feature]'); await p.waitForTimeout(500);
ok(await p.getAttribute('#prog-dialog [data-key=first-flight] [data-act=feature]', 'aria-pressed') === 'true', 'featuring one marks it');
await p.click('#prog-dialog [data-key=getting-comfortable] [data-act=feature]'); await p.waitForTimeout(500);
ok((await db.query(`select achievement_key from public.featured_achievements where user_id = $1 order by position`, [A])).rows.map((r) => r.achievement_key).join() === 'first-flight,getting-comfortable', 'both are saved in the database, in the order chosen');
await p.click('#prog-dialog .btn-row button'); await p.waitForTimeout(300);
ok(await p.locator(card + ' .ach-chip').count() === 2 && /First Flight/.test(await txt(card + ' .prog-featured')), 'the card now shows the two featured achievements');
ok(await p.locator('#prog-dialog[open]').count() === 0, 'closing the collection closes the dialog');

// ---------- history
await p.click(card + ' [data-act=history]');
await p.waitForSelector('#prog-dialog[open] .prog-hist-row', { timeout: 3000 });
const rows = await p.$$eval('#prog-dialog .prog-hist-row', (rs) => rs.map((r) => r.textContent));
ok(rows.length === 11 && /\+75 XP/.test(rows[0]) && /Adjusted by an administrator: A welcome bonus/.test(rows[0]) && rows.slice(1).every((t) => /\+10 XP.*Simulator playtime/.test(t)), 'the XP history lists every change newest first, and the adjustment shows its reason');
ok(await p.locator('#prog-dialog .btn-row button', { hasText: 'Show more' }).isHidden(), 'with no "show more" when it all fits');
await p.click('#prog-dialog .btn-row button:last-child'); await p.waitForTimeout(300);

// ---------- other people, in the profile popover
const popFor = async (name) => {
  await p.click(`#pane-friends .fr-row .pv-trigger[aria-label="View profile of ${name}"] >> nth=0`);
  await p.waitForSelector('#profile-pop:not([hidden]) .pv-prog .prog-card', { timeout: 4000 });
  await p.waitForSelector('#profile-pop .prog-card:not([data-status=loading])', { timeout: 4000 });
};
await popFor('Bea');
ok((await txt('#profile-pop .prog-rank')) === 'Cadet' && (await txt('#profile-pop .prog-tier')) === 'Tier 3' && (await txt('#profile-pop .prog-xp b')) === '350' && /100 XP to Novice \(450 XP\)/.test(await txt('#profile-pop .prog-next')), "a friend's profile shows rank, tier, exact XP and progress");
ok(await p.locator('#profile-pop [data-act=history]').count() === 0 && /Achievements \d+\/16/.test(await txt('#profile-pop [data-act=collection]')), "and the achievements button, but never someone else's history");
await p.click('#profile-pop [data-act=collection]');
await p.waitForSelector('#prog-dialog[open] .ach-tile', { timeout: 3000 });
const others = await p.$$eval('#prog-dialog .ach-tile', (ts) => ts.map((t) => ({ unlocked: t.dataset.unlocked, state: t.querySelector('.ach-state').textContent })));
ok(others.length === 16 && others.some((t) => t.unlocked === 'true') && others.every((t) => /^(Locked|Unlocked)$/.test(t.state)), "another person's collection shows what is unlocked, without unlock dates");
ok(await p.locator('#prog-dialog [data-act=feature]').count() === 0, "and cannot be edited from someone else's profile");
await p.click('#prog-dialog .btn-row button'); await p.waitForTimeout(200);

await popFor('Cam');
ok((await txt('#profile-pop .prog-xp b')) === '3,650' && (await txt('#profile-pop .prog-rank')) === 'Ace' && await p.locator('#profile-pop .prog-max').count() === 1 && await p.locator('#profile-pop .prog-bar').count() === 0 && !/to /.test(await txt('#profile-pop .prog-card')), 'at Ace: the maximum-rank state, no empty bar and no next rank, exact XP kept');
ok(await p.locator('#profile-pop .rank-badge[data-tier="10"]').count() === 1, 'with the top-rank badge');

await popFor('Dee');
ok(await p.locator('#profile-pop .prog-card[data-status=hidden]').count() === 1 && /not shown for this person/.test(await txt('#profile-pop .prog-card')) && await p.locator('#profile-pop .prog-xp').count() === 0, 'someone who hides their profile shows a plain "not shown" message and nothing else');

// ---------- loading and error (a fresh page has an empty cache, so each fetch goes to the database)
await db.query(`select public.award_xp($1, 5, 'admin', 'x1', 'tick')`, [B]);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await p.locator('#name-dlg-skip').click({ timeout: 1500 }).catch(() => {});
await goFriends(p);
fault.progDelay = 900;
await p.evaluate(() => document.querySelector('#pane-friends .fr-row .pv-trigger[aria-label="View profile of Bea"]').click());
await p.waitForTimeout(150);
ok(await p.locator('#profile-pop .prog-card[data-status=loading]').count() === 1 && /Loading progression/.test(await txt('#profile-pop .prog-card')), 'while it loads, the card says so');
await p.waitForSelector('#profile-pop .prog-card[data-status=ready]', { timeout: 4000 });
ok((await txt('#profile-pop .prog-xp b')) === '355', 'and then shows the current total');
fault.progDelay = 0;
await p.keyboard.press('Escape');
fault.progFail = true;
await p.evaluate(() => document.querySelector('#pane-friends .fr-row .pv-trigger[aria-label="View profile of Cam"]').click());
await p.waitForSelector('#profile-pop .prog-card[data-status=error]', { timeout: 5000 });
ok(/unavailable right now/.test(await txt('#profile-pop .prog-card')) && await p.locator('#profile-pop .prog-card button', { hasText: 'Try again' }).count() === 1 && await p.locator('#profile-pop .pv-name').count() === 1, 'if the database fails, the card says it is unavailable with a Try again button, and the rest of the profile still shows');
fault.progFail = false;
await p.click('#profile-pop .prog-card button');
await p.waitForSelector('#profile-pop .prog-card[data-status=ready]', { timeout: 5000 });
ok((await txt('#profile-pop .prog-xp b')) === '3,650', 'Try again loads it');
await p.keyboard.press('Escape');
ok(await p.locator('#fr-progression .prog-card').count() === 1, 'your own card is still on the tab');
await ctx.close();

// ---------- a phone
({ ctx, p } = await open('a', { vp: { width: 360, height: 740 }, mobile: true }));
await goFriends(p);
await p.waitForSelector(card + '[data-status=ready]', { timeout: 5000 });
await p.evaluate(() => document.querySelector('#pane-friends .fr-row .pv-trigger[aria-label="View profile of Cam"]').click());
await p.waitForSelector('#profile-pop .prog-card[data-status=ready]', { timeout: 5000 });
let fit = await p.evaluate(() => { const r = document.getElementById('profile-pop').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w + 1 && fit.sw <= fit.w + 1, 'on a 360 px phone the profile popover with progression fits the screen (' + Math.round(fit.l) + ' to ' + Math.round(fit.r) + ' of ' + fit.w + ')');
await p.keyboard.press('Escape');
await p.click(card + ' [data-act=collection]');
await p.waitForSelector('#prog-dialog[open] .ach-tile', { timeout: 3000 });
fit = await p.evaluate(() => { const r = document.getElementById('prog-dialog').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w + 1 && fit.sw <= fit.w + 1, 'and so does the collection (' + Math.round(fit.l) + ' to ' + Math.round(fit.r) + ' of ' + fit.w + ')');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
