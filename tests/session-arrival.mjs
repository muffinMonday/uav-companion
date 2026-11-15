// Automatic attendance, the app side: the Privacy card and the consent, the foreground sampler, the truthful toast, and every way it must stay quiet (switch off, no consent, far away,
// permission refused, hidden page). Real SQL in PGlite behind a mocked HTTP server (as tests/sessions.mjs); Playwright supplies the position and the clock.
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
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Marked the wrong person') : d.accept()));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return { ctx, p };
}
WHO.e = [process.env.E5 ?? '55555555-5555-5555-5555-555555555555', 'e@example.test'];

// ---- the app side of automatic attendance: the Privacy card (consent), the foreground sampler, the truthful toast, and every way it must stay quiet
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const E = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await as(db, u, 'select public.ensure_profile($1)', [n]);
await db.exec(`update public.profiles set created_at = now() - interval '30 days'`);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const LAT = 30.5, LNG = 114.3;
const mkSession = async (title, lat = LAT) => {
  const id = (await as(db, B, 'select public.create_session($1, null, $2, $3, $4, $5, $6, $7, $8, null) as r', [title, 'East Lake', lat, LNG, hr(1), hr(2), 'Asia/Shanghai', 'public']))[0].r.id;
  await db.query('update public.flight_sessions set starts_at = $2, ends_at = $3 where id = $1', [id, hr(-1), hr(2)]);
  return id;
};
const sessionId = await mkSession('Dwell test');
for (const u of [C, D]) await as(db, u, 'select public.rsvp_session($1)', [sessionId]);
const ageProbes = (u, secs) => db.exec(`update public.session_arrival_probes set first_at = first_at - interval '${secs} seconds', last_at = last_at - interval '${secs} seconds' where session_id = '${sessionId}' and user_id = '${u}'`);
const probeRows = (u) => sql('select * from public.session_arrival_probes where session_id = $1 and user_id = $2', [sessionId, u]);
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

let submits = 0;
async function openApp(who, { geo = { latitude: LAT, longitude: LNG, accuracy: 10 }, vp = { width: 1300, height: 850 } } = {}) {
  const [uid, email] = WHO[who];
  const ctx = await b.newContext({ viewport: vp, geolocation: geo ?? undefined, permissions: geo ? ['geolocation'] : [] });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, dash]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify(dash));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, session(uid, email), { v: 1, showOnStart: false, welcomed: true, seen: '9999' }]);
  await ctx.clock.install({ time: new Date() }); await ctx.clock.resume();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('request', (r) => { if (/rpc\/submit_session_arrival/.test(r.url()) && r.method() === 'POST') submits++; });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.locator('#name-dlg-skip').click({ timeout: 2000 }).catch(() => {});
  return { ctx, p };
}
const openPrivacy = async (p) => { if (!(await p.locator('#pv-sessatt').isVisible())) { if (!(await p.locator('#privacy-btn').isVisible())) await p.evaluate(() => document.querySelector('#dock button')?.click()); await p.click('#privacy-btn'); } await p.waitForTimeout(500); };
const note = (p) => p.textContent('#pv-sessatt-note');
const txt = async (p, sel) => (await p.textContent(sel).catch(() => '')) ?? '';

// ---------- the switch in the database is off: the card says so and nothing is sent
let { ctx, p } = await openApp('c');
await openPrivacy(p);
ok(await p.locator('#pv-sessatt').isDisabled() && /not switched on yet/.test(await note(p)), 'with the database switch at 0 the card is disabled and says it is not switched on');
await p.waitForTimeout(2500); await p.clock.fastForward(60000); await settle();
ok(submits === 0 && (await sql('select 1 from public.session_arrival_consent')).length === 0, 'nothing is sent and no consent is stored');
await ctx.close();

// ---------- switch on in the database: consent, sampling, award
await db.exec(`update public.progression_settings set value = 1 where key = 'auto_attendance_enabled'`);
({ ctx, p } = await openApp('c'));
await openPrivacy(p);
ok(!(await p.locator('#pv-sessatt').isDisabled()) && !(await p.isChecked('#pv-sessatt')) && /Off/.test(await note(p)), 'the card is enabled and off by default');
ok(await p.evaluate(() => !JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').autoSessionAttendance), 'the local switch is off by default, separate from check-in, launch location and auto-share');
await p.waitForTimeout(500); await p.clock.fastForward(60000); await settle();
ok(submits === 0, 'before consent nothing is sent, even with a session under way');
await p.check('#pv-sessatt'); await settle(1200);
ok((await sql(`select 1 from public.session_arrival_consent where user_id = '${C}'`)).length === 1 && await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).autoSessionAttendance === true), 'turning it on records the consent on the server and the local switch');
ok(await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.prefs')); return !o.checkIn && !o.autoShare && o.locateOnLaunch !== false; }), 'the other location switches are untouched');
await p.clock.fastForward(3000); await settle(1200);
ok(submits >= 1 && (await probeRows(C)).length === 1 && (await probeRows(C))[0].qualifying === 1, 'the first sample is sent and counted by the server');
const cols = await sql(`select column_name from information_schema.columns where table_name = 'session_arrival_probes'`);
ok(!cols.some((c) => /lat|lng|coord|accuracy/.test(c.column_name)), 'the server keeps no position');
// the second person (D) qualifies by the server's own measure, but nobody else is there yet for C
const dShot = (acc = 10) => as(db, D, 'select public.submit_session_arrival($1, $2, $3, $4) as r', [sessionId, LAT, LNG, acc]).then((r) => r[0].r);
await as(db, D, 'select public.record_arrival_consent()');
await dShot(); await ageProbes(D, 130); await dShot(); await ageProbes(D, 40);
ok((await dShot()).status === 'waiting', 'D qualifies and waits for another person');
// C: two more samples spanning more than two minutes of server time
await ageProbes(C, 130); await p.clock.fastForward(36000); await settle(1200);
await ageProbes(C, 40);
const before = (await sql(`select count(*)::int n from public.xp_ledger where user_id = '${C}' and source = 'attendance'`))[0].n;
ok(before === 0 && !/Attendance confirmed/.test(await txt(p, '#toast')), 'no XP and no toast while the server has not confirmed');
await p.clock.fastForward(36000); await settle(1500);
ok((await sql(`select source, verified_by from public.session_attendance where session_id = '${sessionId}' and user_id = '${C}'`))[0]?.source === 'auto', 'the server recorded the attendance as automatic');
ok((await sql(`select amount from public.xp_ledger where user_id = '${C}' and source = 'attendance' and ref = 'session:${sessionId}'`))[0]?.amount === 50, 'and awarded 50 XP once');
ok(/Attendance confirmed: \+50 XP earned/.test(await txt(p, '#toast')), 'the toast appears only now, with the awarded XP');
const n1 = submits; await p.clock.fastForward(180000); await settle(1000);
ok(submits === n1, 'after the award the sampler stops: no further samples');
await openPrivacy(p);
ok(/Attendance confirmed/.test(await note(p)), 'the Privacy card shows the final state');
// turning it off removes the consent and the samples
await p.uncheck('#pv-sessatt'); await settle(1200);
ok((await sql(`select 1 from public.session_arrival_consent where user_id = '${C}'`)).length === 0 && await p.evaluate(() => !JSON.parse(localStorage.getItem('uavzones.v1.prefs')).autoSessionAttendance), 'turning it off withdraws the consent on the server and the local switch');
await ctx.close();

// ---------- a person who is somewhere else, with a poor signal, and with permission refused
const far = await mkSession('Far test', LAT + 0.3); await as(db, E, 'select public.ensure_profile($1)', ['Eli']); await as(db, E, 'select public.rsvp_session($1)', [far]);
await db.exec(`update public.profiles set created_at = now() - interval '30 days'`);
await as(db, E, 'select public.record_arrival_consent()');
submits = 0;
({ ctx, p } = await openApp('e', { geo: { latitude: LAT, longitude: LNG, accuracy: 10 } }));
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.prefs')); o.autoSessionAttendance = true; localStorage.setItem('uavzones.v1.prefs', JSON.stringify(o)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); await p.clock.fastForward(5000); await settle(1200);
ok(submits >= 1 && (await sql(`select 1 from public.session_arrival_probes where user_id = '${E}'`)).length === 0, 'standing far from the meeting point stores nothing');
await ctx.close();

submits = 0;
({ ctx, p } = await openApp('d', { geo: null }));
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.prefs')); o.autoSessionAttendance = true; localStorage.setItem('uavzones.v1.prefs', JSON.stringify(o)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); await p.clock.fastForward(5000); await settle(1500);
await openPrivacy(p);
ok(submits === 0 && /Location permission is off/.test(await note(p)), 'with location permission refused nothing is sent and the card says so');
await p.clock.fastForward(180000); await settle(600);
ok(submits === 0, 'and the sampler does not keep asking');
await ctx.close();

// ---------- nothing is sent from a hidden page
submits = 0;
({ ctx, p } = await openApp('d'));
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.prefs')); o.autoSessionAttendance = true; localStorage.setItem('uavzones.v1.prefs', JSON.stringify(o)); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
await p.reload({ waitUntil: 'networkidle' }).catch(() => {});
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
await p.clock.fastForward(90000); await settle(1000);
ok(submits === 0, 'a hidden page sends nothing');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
