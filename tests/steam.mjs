// Steam in the browser: what the card says before the feature is on, linking (through a faked Steam sign-in that sends the browser back), a private profile, a Steam account that
// belongs to someone else, Sync now with its cooldown, a Steam outage that does not cost the cooldown, unlinking, and a phone width. The real Supabase client talks to a mocked HTTP
// server whose functions run the real SQL on an in-memory Postgres (PGlite); Sync now runs the real edge-function handler against a fake Steam.
import { chromium, CHANNEL } from './lib.mjs';
import { makeDb, as, A, B, C, D } from './lib-db.mjs';
import { handleManual } from '../supabase/functions/steam-sync/handler.js';
import { SteamError } from '../supabase/functions/_shared/steam.js';
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
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_steam_apps']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const ID = { [A]: '76561198000000001', [B]: '76561198000000001', [C]: '76561198000000003', [D]: '76561198000000004' }; // A and B are the same Steam account on purpose
const fake = { totals: { 410340: 1000 }, down: false, privateProfile: false };
const sqlArgs = (names, args) => names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
const svc = async (fn, args) => { // the service role, for the edge function's calls
  const names = Object.keys(args);
  const rows = await serial(() => db.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`, sqlArgs(names, args)));
  return rows.rows[0].j;
};
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  if (u.pathname.endsWith('/functions/v1/steam-link')) return reply({ url: 'https://steamcommunity.com/openid/login?openid.mode=checkid_setup&who=' + uid });
  if (u.pathname.endsWith('/functions/v1/steam-sync')) {
    const res = await handleManual(new Request('https://proj.supabase.co/functions/v1/steam-sync', { method: 'POST', headers: { authorization: 'Bearer good' } }), {
      getUser: async () => ({ id: uid }), rpc: svc, env: { cronSecret: '' },
      getSteamId: async () => (await db.query('select steam_id from public.steam_links where user_id = $1', [uid])).rows[0]?.steam_id ?? null,
      fetchGames: async () => { if (fake.down) throw new SteamError('unavailable'); return fake.privateProfile ? { status: 'private' } : { status: 'ok', totals: fake.totals }; },
    });
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': 'application/json' }, body: await res.text() });
  }
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1];
  const args = req.postData() ? JSON.parse(req.postData()) : {};
  const names = Object.keys(args);
  const sql = SETOF.has(fn)
    ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t`
    : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try {
    const rows = await serial(() => as(db, uid, sql, sqlArgs(names, args)));
    return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j);
  } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};

const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'], c: [C, 'c@example.test'], d: [D, 'd@example.test'] };
const b = await chromium.launch({ channel: CHANNEL });
let outcome = 'linked'; // what the faked Steam sign-in does with the person when they get there
async function open(who, { vp = { width: 1300, height: 850 }, mobile = false } = {}) {
  const [uid, email] = WHO[who];
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.route('https://steamcommunity.com/**', async (route) => {
    const who2 = new URL(route.request().url()).searchParams.get('who');
    let result = outcome;
    if (outcome === 'linked') {
      try { await serial(() => db.query('select public.steam_link($1, $2, $3::jsonb)', [who2, ID[who2], JSON.stringify(fake.totals)])); }
      catch (e) { result = /already linked/.test(String(e.message)) ? 'taken' : 'error'; }
    }
    await route.fulfill({ status: 302, headers: { location: 'http://localhost:5173/?steam=' + result } });
  });
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
const goProfile = async (p) => { await p.evaluate(() => { const pop = document.getElementById('account-pop'); const b = [document.getElementById('account-btn'), document.getElementById('dock-account')].find((x) => x && x.offsetParent !== null); if (!pop.hidden) b.click(); b.click(); const s = document.getElementById('pane-steam'); if (s && !s.open) s.open = true; }); await p.waitForTimeout(900); };
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const card = '#account-pop #pane-steam .steam-card';
const txt = async (p, sel) => (await p.textContent(sel).catch(() => '')) ?? '';

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);

// ---------- the feature is off until the owner switches it on
let { ctx, p } = await open('a');
await goProfile(p);
await p.waitForSelector(card + '[data-status=ready]', { timeout: 5000 });
ok(await p.locator(card).getAttribute('data-state') === 'disabled' && /not available yet/.test(await txt(p, card)) && await p.locator(card + ' [data-act=link]').count() === 0, 'before the feature is switched on the card says so and offers no link');
await ctx.close();
await db.exec(`update public.progression_settings set value = 1 where key = 'steam_enabled'`);

// ---------- not linked: what counts, and the way in
({ ctx, p } = await open('a'));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
ok(/10 XP for every completed hour/.test(await txt(p, card)) && /Game details/.test(await txt(p, card)) && /Only playtime after you link counts/.test(await txt(p, card)) && /never shown to anyone/.test(await txt(p, card)), 'the card explains the rate, the public Game details requirement, no retroactive XP and privacy');
await p.click(card + ' .steam-apps summary');
const apps = await p.$$eval(card + ' .steam-apps li', (ls) => ls.map((l) => l.textContent));
ok(apps.length === 6 && apps.some((a) => /Liftoff.*FPV Drone Racing/.test(a)) && apps.some((a) => /FPV LOGIC/.test(a)) && apps.some((a) => /TRYP/.test(a)), 'the six approved simulators are listed');

// ---------- linking: Steam sends the browser back
await p.click(card + ' [data-act=link]');
await p.waitForURL((u) => /steam=linked/.test(u.toString()), { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.waitForSelector('#toast', { state: 'attached', timeout: 3000 }).catch(() => {});
ok(!/steam=/.test(p.url()), 'back in the app the result is removed from the address');
await goProfile(p);
await p.waitForSelector(card + '[data-state=linked]', { timeout: 6000 });
ok(/Steam account linked/.test(await txt(p, card)) && /0 hours credited/.test(await txt(p, card)) && /0 min towards the next hour/.test(await txt(p, card)), 'the card shows the account linked, with nothing credited yet');
const link = (await sql('select * from public.steam_links where user_id = $1', [A]))[0];
ok(link && link.steam_id === ID[A] && (await sql('select last_total_minutes as m from public.steam_app_state where user_id = $1', [A]))[0].m === 1000 && (await sql('select count(*)::int as n from public.xp_ledger where user_id = $1', [A]))[0].n === 0, 'a baseline was recorded and no XP was given for the 1,000 minutes played before');
ok(await p.locator('#account-pop #pane-progression [data-act=collection]').textContent().then((t) => /Achievements 1\/16/.test(t)), 'First Connection unlocked');
const pageText = await p.evaluate(() => document.body.innerText + document.documentElement.innerHTML + JSON.stringify({ ...localStorage }));
ok(!pageText.includes('76561198'), 'the Steam id appears nowhere on the page');

// ---------- Sync now
fake.totals = { 410340: 1090 };
await p.click(card + ' [data-act=sync]');
await p.waitForSelector(card + ' .steam-message', { timeout: 6000 });
ok(/1 new hour credited/.test(await txt(p, card + ' .steam-message')) && /1 hour credited/.test(await txt(p, card)) && /30 min towards the next hour/.test(await txt(p, card)), 'Sync now credits the completed hour and keeps the 30 minutes: ' + (await txt(p, card + ' .steam-message')));
await p.waitForSelector('#account-pop #pane-progression .prog-xp b', { timeout: 4000 });
ok((await txt(p, '#account-pop #pane-progression .prog-xp b')) === '10', 'and the progression card shows the 10 XP');
const syncBtn = p.locator(card + ' [data-act=sync]');
ok(await syncBtn.isDisabled() && /Sync now \(in (59|60) minutes\)/.test(await syncBtn.textContent()), 'the button then shows the cooldown: ' + (await syncBtn.textContent()));
ok((await sql('select count(*)::int as n from public.xp_ledger where user_id = $1 and source = \'sim\'', [A]))[0].n === 1, 'one ledger row (hour:1)');
await ctx.close();

// ---------- a private profile
outcome = 'private';
({ ctx, p } = await open('c'));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
await p.click(card + ' [data-act=link]');
await p.waitForTimeout(2500);
await p.waitForSelector('#toast', { state: 'attached', timeout: 3000 }).catch(() => {});
const toastText = await p.evaluate(() => document.getElementById('toast')?.textContent ?? '');
ok(/private/.test(toastText) && /Game details/.test(toastText), 'when Steam shows nothing the person is told to make Game details public: ' + toastText.slice(0, 60));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
ok((await sql('select count(*)::int as n from public.steam_links where user_id = $1', [C]))[0].n === 0, 'and nothing was linked');
await ctx.close();

// ---------- a Steam account that belongs to someone else
outcome = 'linked';
({ ctx, p } = await open('b'));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
await p.click(card + ' [data-act=link]');
await p.waitForTimeout(2500);
const taken = await p.evaluate(() => document.getElementById('toast')?.textContent ?? '');
ok(/already linked to another/.test(taken) && (await sql('select count(*)::int as n from public.steam_links where user_id = $1', [B]))[0].n === 0, 'a Steam account linked to someone else cannot be linked again: ' + taken.slice(0, 60));
await ctx.close();

// ---------- a Steam outage does not cost the cooldown
({ ctx, p } = await open('d'));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
await p.click(card + ' [data-act=link]');
await p.waitForTimeout(2500);
await goProfile(p);
await p.waitForSelector(card + '[data-state=linked]', { timeout: 6000 });
fake.down = true; fake.totals = { 410340: 1120 };
await p.click(card + ' [data-act=sync]');
await p.waitForSelector(card + ' .steam-message', { timeout: 6000 });
ok(/Steam did not answer/.test(await txt(p, card + ' .steam-message')) && await p.locator(card + ' [data-act=sync]').isEnabled(), 'if Steam does not answer the person is told and can try again at once');
fake.down = false;
await p.click(card + ' [data-act=sync]');
await p.waitForFunction((sel) => /Synced/.test(document.querySelector(sel)?.textContent ?? ''), card + ' .steam-message', { timeout: 6000 });
ok(/no new completed hour/.test(await txt(p, card + ' .steam-message')) && /30 min towards the next hour/.test(await txt(p, card)), 'and the next try works (30 new minutes, not yet an hour)');
await p.waitForTimeout(300);
ok(await p.locator(card + ' [data-act=sync]').isDisabled(), 'which starts the cooldown');
fake.privateProfile = true;
await db.exec(`update public.steam_links set last_manual_sync_at = null where user_id = '${D}'`);
await goProfile(p); await p.waitForTimeout(600);
await p.click(card + ' [data-act=sync]');
await p.waitForSelector(card + ' .steam-message:has-text("private")', { timeout: 6000 });
ok(await p.locator(card + ' [data-act=sync]').isEnabled() && /Set Game details to Public/.test(await txt(p, card)), 'a private profile found by Sync now is explained, and the cooldown is given back');
fake.privateProfile = false;
await ctx.close();

// ---------- unlinking keeps what was earned
({ ctx, p } = await open('a'));
await goProfile(p);
await p.waitForSelector(card + '[data-state=linked]', { timeout: 6000 });
await p.click(card + ' [data-act=unlink]');
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 6000 });
ok((await sql('select hours_awarded as h, steam_id from public.steam_links where user_id = $1', [A]))[0].h === 1 && (await sql('select steam_id from public.steam_links where user_id = $1', [A]))[0].steam_id === null, 'unlinking removes the link and keeps the credited hour');
await p.waitForSelector('#account-pop #pane-progression .prog-xp b', { timeout: 4000 });
ok((await txt(p, '#account-pop #pane-progression .prog-xp b')) === '10', 'the XP stays');
await ctx.close();

// ---------- a phone
({ ctx, p } = await open('a', { vp: { width: 360, height: 740 }, mobile: true }));
await goProfile(p);
await p.waitForSelector(card + '[data-state=unlinked]', { timeout: 5000 });
await p.click(card + ' .steam-apps summary');
const fit = await p.evaluate(() => { const c = document.getElementById('pane-steam').getBoundingClientRect(); return { l: c.left, r: c.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w + 1 && fit.sw <= fit.w + 1, 'on a 360 px phone the card fits the screen (' + Math.round(fit.l) + ' to ' + Math.round(fit.r) + ' of ' + fit.w + ')');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
