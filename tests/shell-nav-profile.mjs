// The new shell's Profile destination (Review 01 S10.6, PROF-01..06/NAV-07) and the one routing change the new shell makes to the
// first-run splash (AUTH-03). Reuses the existing, unmodified account-ui.js popover (progression, Steam, friends, account controls) and
// splash.js (first-run choices) - nothing here duplicates their state or API calls. Starts its own flagged Vite dev server
// (VITE_NEW_SHELL=1) against a mocked Supabase backend running real SQL on an in-memory Postgres, same pattern as shell-nav-explore.mjs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { CHANNEL, chromium, ROOT } from './lib.mjs';
import { makeDb, as, A } from './lib-db.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');
const errs = [];

function startVite(port) {
  const env = { ...process.env, VITE_NEW_SHELL: '1' };
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    const on = (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } };
    child.stdout.on('data', on); child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}

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
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1];
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

const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
await one(A, 'public.ensure_profile($1)', ['Alex']);

const PORT = 5195;
const vite = await startVite(PORT);
const b = await chromium.launch({ channel: CHANNEL, headless: true });

async function open({ uid = null, email = null } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, dash]) => {
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify(dash));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, { v: 1, showOnStart: false, welcomed: true, seen: '2026-11-14-progression' }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}
/** Reopens the first-run splash through the always-available "Quick setup" entry (Map Configs tab), the same one a returning visitor
 * uses - sidesteps the first-visit auto-detection entirely, since that is not what AUTH-03 is about. */
async function openSplashViaQuickSetup(p) {
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=config]').click(); else document.getElementById('tab-config').click(); });
  await p.waitForTimeout(200);
  await p.click('#setup-open');
  await p.waitForSelector('#splash[open]', { timeout: 10000 });
}

try {
  // ---- PROF-01..06/NAV-07: a signed-in visitor's Profile destination reuses the existing account popover (progression, Steam, friends)
  {
    const { ctx, p } = await open({ uid: A, email: 'a@example.test' });
    await p.waitForFunction(() => document.getElementById('shell-nav') != null, { timeout: 10000 });
    await p.click('#shell-nav [data-dest=profile]');
    await p.waitForSelector('#account-pop:not([hidden])', { timeout: 10000 });
    ok(await p.getAttribute('#shell-nav [data-dest=profile]', 'aria-current') === 'true', 'PROF: Profile opens the existing account popover and shows as the current destination');
    ok(await p.locator('#pane-progression').count() === 1, 'PROF-01: the popover already has the progression (rank/XP/achievements) section, unmodified');
    ok(await p.locator('#pane-steam').count() === 1, 'PROF-06/C-35: Steam is already folded into the Profile popover, unmodified');
    await p.click('#account-pop .account-close');
    await p.waitForTimeout(300);
    ok(await p.locator('#account-pop:not([hidden])').count() === 0, 'the popover closes from its own close button');
    ok(await p.getAttribute('#shell-nav [data-dest=map]', 'aria-current') === 'true' && await p.getAttribute('#shell-nav [data-dest=profile]', 'aria-current') === 'false', 'S10.6: closing the popover by its own means reverts the shell nav to Map, the same reconciliation Trips/Explore already have');
    await ctx.close();
  }

  // ---- AUTH-03: "Skip, just show me the map" opens the Map destination directly under the new shell, not the legacy dashboard. Reopened
  // through the always-available "Quick setup" entry (same dialog, same skip() code path a true first visit uses) so this does not depend
  // on reproducing a genuine first-run detection race in a headless harness.
  {
    const { ctx, p } = await open({});
    await p.waitForFunction(() => document.getElementById('shell-nav') != null, { timeout: 10000 });
    await p.evaluate(() => { if (!document.getElementById('dash').hidden) document.getElementById('dash-close')?.click(); }); // a clean baseline regardless of today's What's new/start state
    await p.waitForTimeout(200);
    await openSplashViaQuickSetup(p);
    await p.click('#splash-skip');
    await p.waitForTimeout(400);
    ok(await p.locator('#splash[open]').count() === 0, 'the splash dialog closes');
    ok(await p.evaluate(() => document.getElementById('dash').hidden === true), 'AUTH-03: Skip does not open the legacy dashboard under the new shell');
    ok(await p.getAttribute('#shell-nav [data-dest=map]', 'aria-current') === 'true', 'AUTH-03: Map is the current destination, shown directly');
    await ctx.close();
  }
} finally {
  await b.close();
  vite.kill();
}

console.log(errs.length ? 'CONSOLE/PAGE ERRORS:\n' + errs.join('\n') : 'errors: none');
