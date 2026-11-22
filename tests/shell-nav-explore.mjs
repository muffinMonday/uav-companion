// The new shell's Explore destination (Review 01 S10.5, EXP-01/EXP-02/NAV-07): the shell nav calls the existing, unmodified sessions-hub.js
// (initSessionsHub returns the same dialog used by the map calendar button, Friends tab and dashboard card - nothing here duplicates its
// state or API calls). Starts its own flagged Vite dev server (VITE_NEW_SHELL=1), same pattern as shell-nav.mjs/preflight-lab.mjs, against
// a mocked Supabase backend running real SQL on an in-memory Postgres, same pattern as sessions.mjs.
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
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
await one(A, 'public.ensure_profile($1)', ['Alex']);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
await one(A, 'public.create_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['Explore test session', '', 'Test field', 30.6, 114.3, hr(2), hr(3), 'UTC', 'public', null]);

const PORT = 5194;
const vite = await startVite(PORT);
const b = await chromium.launch({ channel: CHANNEL, headless: true });

async function open(vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(A));
  await ctx.addInitScript(([ref, sess]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: '9999' }));
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, session(A, 'a@example.test')]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}

try {
  const { ctx, p } = await open({ width: 1400, height: 900 }, false);
  // give cloud.sessions (initSessionsHub) time to resolve, same tolerance sessions.mjs uses
  await p.waitForFunction(() => document.getElementById('shell-nav') != null, { timeout: 10000 });
  await p.click('#shell-nav [data-dest=explore]');
  await p.waitForSelector('#ses-hub[open]', { timeout: 10000 });
  ok(await p.getAttribute('#shell-nav [data-dest=explore]', 'aria-current') === 'true', 'EXP-01: Explore opens the existing sessions hub and shows as the current destination');
  await p.waitForSelector('#ses-hub .ses-row', { timeout: 10000 });
  ok((await p.locator('#ses-hub .ses-row').count()) >= 1, 'EXP-01: the Discover list shows the seeded public session (existing sessions-hub.js rendering, unmodified)');

  // EXP-02/NAV-07: open a session's full-screen detail, then use the browser Back button to return to the list (not leave the app)
  await p.click('#ses-hub .ses-row button[data-act=details]');
  await p.waitForSelector('#ses-hub #ses-back', { timeout: 5000 });
  ok(await p.isVisible('#ses-hub #ses-back'), 'EXP-02: a session opens its full-screen detail inside the hub');
  await p.goBack();
  await p.waitForTimeout(300);
  ok((await p.locator('#ses-hub #ses-back').count()) === 0 && (await p.locator('#ses-hub .ses-row').count()) >= 1, 'NAV-07: Back closes the detail and returns to the Discover list, not the app');
  ok(await p.isVisible('#ses-hub[open]'), 'NAV-07: Back closed only the detail - the hub itself is still open');

  // closing the hub by its own means (not through the shell) reverts the shell's current destination to Map
  await p.click('#ses-hub-close');
  await p.waitForTimeout(300);
  ok((await p.locator('#ses-hub[open]').count()) === 0, 'the hub closes from its own ✕ button');
  ok(await p.getAttribute('#shell-nav [data-dest=map]', 'aria-current') === 'true' && await p.getAttribute('#shell-nav [data-dest=explore]', 'aria-current') === 'false', 'S10.5: closing the hub by its own means reverts the shell nav to Map (the same reconciliation Trips already had)');

  await ctx.close();

  // ---- S10.9 (outer NAV-07): the hub itself, with no detail open, also gets one history entry - Back closes it back to Map, the same
  // unified fix now given to Trips and Profile.
  {
    const { ctx, p } = await open({ width: 1400, height: 900 }, false);
    await p.waitForFunction(() => document.getElementById('shell-nav') != null, { timeout: 10000 });
    await p.click('#shell-nav [data-dest=explore]');
    await p.waitForSelector('#ses-hub[open]', { timeout: 10000 });
    await p.goBack();
    await p.waitForTimeout(400);
    ok((await p.locator('#ses-hub[open]').count()) === 0, 'S10.9 (outer NAV-07): Back closes the hub back to Map with no detail open');
    ok(await p.getAttribute('#shell-nav [data-dest=map]', 'aria-current') === 'true', 'S10.9: Map is current again after Back');
    await ctx.close();
  }
} finally {
  await b.close();
  vite.kill();
}

console.log(errs.length ? 'CONSOLE/PAGE ERRORS:\n' + errs.join('\n') : 'errors: none');
