// Load test of the hosted Supabase project with virtual users that make the same requests, at the same pace, as the app (Project_context/docs/DEVELOPMENT.md).
//
//   node scripts/loadtest.mjs --yes --users 25 --minutes 5 [--scenario idle|live|mixed] [--adaptive] [--group 5] [--sharers 0.2] [--out file.json] [--keep]
//   node scripts/loadtest.mjs --yes --cleanup            removes leftover test users (e-mail loadtest-...@example.test)
//
// WARNING: it creates real throwaway users on the project the .env.development.local file points to (which is also the project the live site uses; there is no
// second project yet) and deletes them at the end. Run it off-peak and read the output of a small run (--users 3 --minutes 1) first. --yes is required.
// The service key is fetched into memory through the Supabase CLI for the user admin calls only; it is never printed or written to a file.
//
// Scenarios (what every virtual user does, with the app's own intervals):
//   idle    list_my_trips every 10 s, touch_presence every 30 s, list_friends every 120 s, list_live_locations every 5 s (no one shares)
//   live    as idle, and a share of the users (--sharers, default 0.2) also send share_location every 5 s
//   mixed   as live, and every user saves the shared trip every 30 s with probability 0.1 (an edit)
// --adaptive reproduces the new client: list_live_locations only while list_my_trips says someone else is sharing (live_active), and list_my_trips backs off to
// 20 s / 30 s after a quiet minute / three minutes. Without it the pre-review pace is used, so a run with and a run without it compare the two clients.
// Users are put in parties of --group (default 5) people: one owner, who shares a trip, and the others, who are friends of the owner and join it.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); if (i < 0) return def; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const USERS = Math.min(300, Math.max(1, Number(arg('users', 10)))), MINUTES = Number(arg('minutes', 5)), SCENARIO = String(arg('scenario', 'live'));
const GROUP = Math.max(2, Number(arg('group', 5))), SHARERS = Number(arg('sharers', 0.2)), ADAPTIVE = arg('adaptive', false) === true, KEEP = arg('keep', false) === true;
const OUT = arg('out', null);
if (arg('yes', false) !== true) { console.log('This creates throwaway users on the hosted project. Add --yes to go ahead (see the top of this file).'); process.exit(2); }
if (!['idle', 'live', 'mixed'].includes(SCENARIO)) { console.log('--scenario must be idle, live or mixed'); process.exit(2); }

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)[1], key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)[1];
const ref = new URL(url).hostname.split('.')[0];
const service = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).find((k) => k.name === 'service_role').api_key;
const admin = createClient(url, service, { auth: { persistSession: false } });
const PREFIX = 'loadtest-';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  let removed = 0;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (u.email?.startsWith(PREFIX) && u.email.endsWith('@example.test')) { await admin.auth.admin.deleteUser(u.id); removed++; }
    if (data.users.length < 200) break;
  }
  return removed;
}
if (arg('cleanup', false) === true) { console.log('removed ' + await cleanup() + ' test users'); process.exit(0); }

// ---------- measurements
const stats = new Map(); // name -> { n, errors, ms: [] }
const stat = (name) => { if (!stats.has(name)) stats.set(name, { n: 0, errors: 0, ms: [], firstError: null }); return stats.get(name); };
async function timed(name, fn) {
  const s = stat(name), t0 = performance.now();
  try { const r = await fn(); s.n++; s.ms.push(performance.now() - t0); return r; }
  catch (e) { s.n++; s.errors++; s.ms.push(performance.now() - t0); s.firstError ??= String(e.message ?? e).slice(0, 120); return null; }
}
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);

// ---------- users
const runId = Date.now().toString(36);
const users = [];
async function makeUser(i) {
  const email = `${PREFIX}${runId}-${i}@example.test`, password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('create user: ' + error.message);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error('sign in: ' + e2.message);
  const u = { i, id: data.user.id, email, client, device: 'lt-' + i + '-' + runId };
  u.rpc = async (fn, args) => { const { data: d, error: e } = await client.rpc(fn, args); if (e) throw new Error(e.message); return d; };
  return u;
}
const doc = (tid, n) => ({ v: 1, trip: { id: tid, name: 'Load test ' + tid.slice(0, 4) }, items: Array.from({ length: n }, (_, i) => ({ id: 'm' + i, type: 'photo', name: 'Marker ' + i, note: 'x'.repeat(40), lat: 30.5 + i / 1000, lon: 114.3, created: '2026-11-01T00:00:00.000Z', tripId: tid })) });
const uuid = () => globalThis.crypto.randomUUID();

let exitCode = 0;
try {
  console.log(`creating ${USERS} users (${Math.ceil(USERS / GROUP)} parties of up to ${GROUP}) on ${ref} ...`);
  for (let i = 0; i < USERS; i += 10) await Promise.all(Array.from({ length: Math.min(10, USERS - i) }, (_, k) => makeUser(i + k).then((u) => users.push(u))));
  users.sort((a, b) => a.i - b.i);
  await Promise.all(users.map((u) => u.rpc('ensure_profile', { p_display_name: 'LT' + u.i })));
  const parties = [];
  for (let g = 0; g < users.length; g += GROUP) parties.push(users.slice(g, g + GROUP));
  for (const party of parties) {
    const [owner, ...rest] = party;
    const tid = uuid(); owner.trip = tid; owner.docState = { rev: 1 };
    await owner.rpc('share_trip', { p_doc: doc(tid, 50) });
    for (const m of rest) {
      const code = (await m.rpc('ensure_profile', {})).friend_code;
      const fr = await owner.rpc('request_friend', { p_code: code });
      await m.rpc('respond_friend', { p_id: fr.id, p_accept: true });
      const fid = (await owner.rpc('list_friends')).find((f) => f.display_name === 'LT' + m.i).id;
      await owner.rpc('invite_to_trip', { p_trip: tid, p_friendship: fid });
      await m.rpc('respond_trip_invite', { p_trip: tid, p_accept: true });
      m.trip = tid;
    }
    for (const u of party) u.party = party;
  }
  const sharerCount = SCENARIO === 'idle' ? 0 : Math.max(1, Math.round(USERS * SHARERS));
  { const step = Math.max(1, Math.floor(USERS / Math.max(1, sharerCount))); let n = 0; for (const u of users) { u.sharer = sharerCount > 0 && u.i % step === 0 && n < sharerCount; if (u.sharer) n++; } }
  console.log(`seeded. ${users.filter((u) => u.sharer).length} sharers. running ${SCENARIO}${ADAPTIVE ? ' (adaptive client)' : ''} for ${MINUTES} min ...`);

  // ---------- the virtual users
  const endAt = Date.now() + MINUTES * 60000;
  const loop = (u) => (async () => {
    await sleep(Math.random() * 5000); // start spread over a few seconds
    let quiet = 0, tickN = 0, liveActive = null, sig = '';
    const every = (ms, fn) => (async () => { await sleep(Math.random() * ms); while (Date.now() < endAt) { const t0 = Date.now(); await fn(); await sleep(Math.max(0, ms - (Date.now() - t0))); } })();
    await Promise.all([
      every(10000, async () => { // the shared-trip poll
        if (ADAPTIVE) { const f = quiet >= 18 ? 3 : quiet >= 6 ? 2 : 1; if (++tickN % f) return; }
        const list = await timed('list_my_trips', () => u.rpc('list_my_trips'));
        if (!list) return;
        const s = JSON.stringify(list.map((t) => [t.id, t.rev, t.members_rev, t.members, (t.live_active ?? 0) > 0]));
        quiet = s === sig ? quiet + 1 : 0; sig = s;
        liveActive = list.every((t) => Number.isFinite(t.live_active)) ? list.reduce((n, t) => n + t.live_active, 0) : null;
      }),
      every(30000, () => timed('touch_presence', () => u.rpc('touch_presence'))),
      every(120000, async () => { await timed('list_friends', () => u.rpc('list_friends')); await timed('list_sessions', () => u.rpc('list_sessions')); }),
      every(5000, async () => { if (ADAPTIVE && !((liveActive ?? 1) > 0)) return; await timed('list_live_locations', () => u.rpc('list_live_locations')); }),
      u.sharer ? every(5000, () => timed('share_location', () => u.rpc('share_location', { p_trip: u.trip, p_lat: 30.5 + Math.random() / 100, p_lon: 114.3 + Math.random() / 100, p_accuracy: 12, p_device: u.device, p_claim: false }))) : Promise.resolve(),
      SCENARIO === 'mixed' ? every(30000, async () => {
        if (Math.random() > 0.1) return;
        const cur = await timed('get_shared_trip', () => u.rpc('get_shared_trip', { p_trip: u.trip }));
        if (!cur) return;
        await timed('save_shared_trip', () => u.rpc('save_shared_trip', { p_trip: u.trip, p_doc: doc(u.trip, 50 + Math.floor(Math.random() * 5)), p_base_rev: Number(cur.rev) }));
      }) : Promise.resolve(),
    ]);
  })();
  const t0 = Date.now();
  await Promise.all(users.map(loop));
  const secs = (Date.now() - t0) / 1000;

  // ---------- results
  const rows = [...stats].map(([name, s]) => { const a = s.ms.slice().sort((x, y) => x - y); return { name, n: s.n, rps: +(s.n / secs).toFixed(2), errors: s.errors, errPct: +((100 * s.errors) / s.n).toFixed(2), p50: Math.round(pct(a, 50)), p95: Math.round(pct(a, 95)), p99: Math.round(pct(a, 99)), firstError: s.firstError }; });
  const total = rows.reduce((n, r) => n + r.n, 0), errs = rows.reduce((n, r) => n + r.errors, 0);
  console.log(`\n${USERS} users, ${SCENARIO}${ADAPTIVE ? ' adaptive' : ''}, ${secs.toFixed(0)} s: ${total} requests, ${(total / secs).toFixed(1)} req/s, ${errs} errors (${((100 * errs) / Math.max(1, total)).toFixed(2)} %)`);
  console.table(rows.map(({ firstError, ...r }) => r));
  for (const r of rows) if (r.firstError) console.log('first error, ' + r.name + ': ' + r.firstError);
  const summary = { users: USERS, scenario: SCENARIO, adaptive: ADAPTIVE, minutes: MINUTES, seconds: Math.round(secs), requests: total, rps: +(total / secs).toFixed(2), errors: errs, rows };
  if (OUT && OUT !== true) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\nAlso read, in the Supabase dashboard for this period: CPU, memory, disk IO, connections, and pg_stat_statements (top queries by total time).');
} catch (e) {
  console.log('FAIL  ' + (e.message ?? e)); exitCode = 1;
} finally {
  if (!KEEP) { console.log('removing the test users ...'); for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {}); console.log('done. Anything left over: node scripts/loadtest.mjs --yes --cleanup'); }
  else console.log('--keep: the test users stay (remove them with --cleanup).');
}
process.exit(exitCode);
