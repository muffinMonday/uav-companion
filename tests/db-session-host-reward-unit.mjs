// Flight Sessions: host reward on close (supabase/migrations/20261120100000_session_host_reward.sql). 50 XP + 10 per distinct verified non-host attendee, none without one,
// kept apart from attendance counts, no double payout, adjusted when an administrator revokes attendance later. Real Postgres (PGlite), several users, no browser.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const E = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee'], [E, 'Eli']]) await one(u, 'public.ensure_profile($1)', [n]);
const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
await one(A, `public.grant_role($1, 'organiser')`, [await code(B)]); // A administrator, B organiser and host; C, D, E ordinary people

async function mk(by, startH = -1, endH = 2, status = 'scheduled') {
  return (await sql(`insert into public.flight_sessions (title, starts_at, ends_at, created_by, status, visibility, latitude, longitude) values ('Field', $1, $2, $3, $4, 'public', 30.5, 114.3) returning id`, [hr(startH), hr(endH), by, status]))[0].id;
}
const mark = (u, s, who) => one(u, `public.mark_attended($1, 'code', $2)`, [s, who]);
const close = (u, s) => one(u, 'public.close_session($1)', [s]);
const revoke = async (s, who, why = 'Marked the wrong person') => {
  const id = (await sql('select id from public.session_attendance where session_id = $1 and user_id = $2', [s, who]))[0].id;
  return one(A, 'public.revoke_attendance($1, $2, $3)', [s, id, why]);
};
const rows = (u, s) => sql(`select amount, ref, actor, reason, meta from public.xp_ledger where user_id = $1 and source = 'hosting' and ref like $2 order by id`, [u, 'session:' + s + '%']);
const sum = async (u, s) => (await rows(u, s)).reduce((t, r) => t + r.amount, 0);
const total = async (u) => (await sql('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? 0;
const attXp = async (u) => (await sql(`select coalesce(sum(amount), 0)::int as t from public.xp_ledger where user_id = $1 and source = 'attendance'`, [u]))[0].t;
const metric = async (u) => (await sql(`select public.user_metric($1, 'attendance_verified_count') as m`, [u]))[0].m;
const unlocked = async (u) => (await sql('select achievement_key as k from public.user_achievements where user_id = $1', [u])).map((r) => r.k);
const [cC, cD, cE] = [await code(C), await code(D), await code(E)];

// ---------- RSVPs alone, or no one: nothing
const s0 = await mk(B); await one(C, 'public.rsvp_session($1)', [s0]); await one(D, 'public.rsvp_session($1)', [s0]);
let r = await close(B, s0);
ok(r.status === 'closed' && r.host_xp === 0 && (await rows(B, s0)).length === 0 && await total(B) === 0, 'RSVPs alone earn the host nothing');
const s00 = await mk(B); r = await close(B, s00);
ok(r.host_xp === 0 && (await rows(B, s00)).length === 0, 'a session nobody attended earns the host nothing');

// ---------- the formula, attendance kept apart
const s1 = await mk(B);
await one(C, 'public.rsvp_session($1)', [s1]); await one(E, 'public.rsvp_session($1)', [s1]); // C walks in with an RSVP, D walks in without, E only RSVPs
await mark(B, s1, cC); await mark(B, s1, cD);
const before = await attXp(B);
r = await close(B, s1);
const h1 = await rows(B, s1);
ok(r.host_xp === 70 && h1.length === 1 && h1[0].amount === 70 && h1[0].ref === 'session:' + s1 && h1[0].meta.attendees === 2 && await total(B) === 70, 'closing pays 50 + 10 x 2 verified attendees once, as one hosting row');
ok(await total(E) === 0 && (await rows(E, s1)).length === 0, 'an RSVP that was never verified earns nothing');
ok(await attXp(C) === 50 && await attXp(D) === 50 && await attXp(B) === before, 'attendee XP is unchanged and the host gets no attendance row');
ok(await metric(B) === 0 && !(await unlocked(B)).includes('first-meetup') && await metric(C) === 1, 'the host reward does not count as attendance for achievements');
ok((await sql(`select source from public.xp_ledger where user_id = $1`, [B])).every((x) => x.source === 'hosting'), 'the ledger records it under its own source');
const hist = await one(B, 'public.my_xp_history()');
ok(hist.items.length === 1 && hist.items[0].source === 'hosting' && hist.items[0].amount === 70 && hist.items[0].reason === null, 'the host sees it in their XP history as hosting');

// ---------- no double payout
ok(/already closed/.test(await refused(db, B, 'select public.close_session($1)', [s1]) ?? '') && /already closed/.test(await refused(db, A, 'select public.close_session($1)', [s1]) ?? ''), 'closing again is refused');
ok((await db.query(`select public.award_xp($1, 70, 'hosting', $2) as r`, [B, 'session:' + s1])).rows[0].r === null && (await rows(B, s1)).length === 1 && await total(B) === 70, 'the ledger key refuses a second payout for the same session');
{
  const s = await mk(B); await mark(B, s, cC);
  const res = await Promise.allSettled([close(B, s), close(B, s), close(A, s)]);
  ok(res.filter((x) => x.status === 'fulfilled').length === 1 && (await rows(B, s)).length === 1 && await sum(B, s) === 60, 'simultaneous closes pay exactly once');
}

// ---------- who is paid, who is counted
{
  const s = await mk(B); await mark(B, s, cC);
  r = await close(A, s);
  ok(r.host_xp === 60 && await sum(B, s) === 60 && (await rows(A, s)).length === 0, 'an administrator closing the session pays the host, not themselves');
  const sh = await mk(B); await db.query(`insert into public.session_attendance (session_id, user_id, verified_by, source) values ($1, $2, $3, 'walk_in')`, [sh, B, A]);
  r = await close(B, sh);
  ok(r.host_xp === 0 && (await rows(B, sh)).length === 0, "the host's own attendance row is not an eligible attendee");
  const sr = await mk(B); await mark(B, sr, cC); await mark(B, sr, cD); await revoke(sr, D);
  r = await close(B, sr);
  ok(r.host_xp === 60 && (await rows(B, sr))[0].meta.attendees === 1, 'attendance revoked before the close is not counted');
  ok(/the session is closed/.test(await db.query(`insert into public.session_attendance (session_id, user_id, verified_by, source) values ($1, $2, null, 'auto')`, [sr, E]).then(() => '', (e) => String(e.message))), 'no attendance can be added after the close');
  ok(/session not found/.test(await refused(db, C, 'select public.close_session($1)', [await mk(B)]) ?? ''), 'someone who cannot manage the session cannot close it for the reward');
}

// ---------- revocation after the close adjusts the reward
{
  const s = await mk(B); await mark(B, s, cC); await mark(B, s, cD); await mark(B, s, cE);
  await close(B, s);
  ok(await sum(B, s) === 80 && await total(B) === 70 + 60 + 60 + 60 + 80, '(setup) three attendees pay 80');
  const t0 = await total(B), cXp = await attXp(C), cMetric = await metric(C);
  ok((await revoke(s, E)).status === 'revoked' && await sum(B, s) === 70 && await total(B) === t0 - 10, 'revoking one attendee lowers the reward by 10');
  const adj = (await rows(B, s)).find((x) => x.ref === 'session:' + s + ':adj:1');
  ok(adj && adj.amount === -10 && adj.actor === A && adj.reason === 'Marked the wrong person' && (await rows(B, s)).length === 2, 'the adjustment is an appended ledger row with the administrator and reason; the payout row stays');
  ok((await revoke(s, E)).status === 'already_revoked' && await sum(B, s) === 70, 'revoking the same attendance twice changes nothing more');
  await revoke(s, D);
  ok(await sum(B, s) === 60, 'a second revocation lowers it again');
  await revoke(s, C);
  ok(await sum(B, s) === 0 && (await rows(B, s)).length === 4, 'revoking the last eligible attendee removes the 50 base too: net zero, nothing deleted');
  ok(await attXp(C) === cXp - 50 && await metric(B) === 0 && await metric(C) === cMetric, 'attendee reversals and counts still behave as before; the host count is untouched');
}

// ---------- revoking before a close pays nothing extra; sessions closed before the feature are never paid by a later revocation
{
  const s = await mk(B); await mark(B, s, cC); await mark(B, s, cD);
  await revoke(s, C);
  ok((await rows(B, s)).length === 0, 'revoking while the session is open touches no reward');
  const legacy = await mk(B, -3, -2); await db.query(`insert into public.session_attendance (session_id, user_id, verified_by, source) values ($1, $2, $3, 'walk_in')`, [legacy, C, B]);
  await db.exec(`update public.flight_sessions set status = 'closed', closed_at = now() where id = '${legacy}'`); // closed the old way, with no reward
  const t0 = await total(B); await revoke(legacy, C);
  ok((await rows(B, legacy)).length === 0 && await total(B) === t0, 'a session closed before the feature has no reward to adjust');
}

// ---------- automatic attendance and the bulk rollback
{
  const s = await mk(B);
  await db.query(`insert into public.session_attendance (session_id, user_id, verified_by, source) values ($1, $2, null, 'auto'), ($1, $3, null, 'auto')`, [s, C, D]);
  r = await close(B, s);
  ok(r.host_xp === 70, 'automatic (server-verified) attendance counts like a manual mark');
  const res = await one(A, 'public.admin_bulk_revoke_auto_attendance($1, $2, $3)', [hr(-1), hr(1), 'GPS spoofing ring']);
  ok(res.count === 2 && await sum(B, s) === 0 && (await rows(B, s)).length === 2, 'the bulk rollback adjusts the host reward once per session touched');
}

// ---------- settings are read at the close; zero pays nothing
{
  await db.exec(`update public.progression_settings set value = 0 where key in ('host_base_xp', 'host_per_attendee_xp')`);
  const s = await mk(B); await mark(B, s, cC);
  r = await close(B, s);
  ok(r.host_xp === 0 && (await rows(B, s)).length === 0, 'with both settings at 0 no reward is recorded');
  await db.exec(`update public.progression_settings set value = 20 where key = 'host_base_xp'`);
  await db.exec(`update public.progression_settings set value = 5 where key = 'host_per_attendee_xp'`);
  const s2 = await mk(B); await mark(B, s2, cC); await mark(B, s2, cD);
  await close(B, s2);
  await db.exec(`update public.progression_settings set value = 99 where key = 'host_base_xp'`); // later changes must not distort the adjustment
  ok(await sum(B, s2) === 30, 'the amounts come from the settings');
  await revoke(s2, D);
  ok(await sum(B, s2) === 25, 'the adjustment uses the numbers recorded at the payout, not the current settings');
  await db.exec(`update public.progression_settings set value = 50 where key = 'host_base_xp'`);
  await db.exec(`update public.progression_settings set value = 10 where key = 'host_per_attendee_xp'`);
}

// ---------- the host loses nothing below zero, and the reward is not reachable by clients
{
  const s = await mk(B); await mark(B, s, cC); await mark(B, s, cD); await close(B, s);
  await one(A, 'public.admin_adjust_xp($1, $2, $3)', [await code(B), -(await total(B)) + 5, 'Spent']);
  await revoke(s, C); await revoke(s, D);
  const adj = (await rows(B, s)).filter((x) => x.ref.includes(':adj:'));
  ok(await total(B) === 0 && adj.length === 1 && adj[0].amount === -5 && adj[0].meta.requested === -10, 'a reduction is clamped at zero XP and records what was requested; a host with 0 XP gets no zero row');
}
for (const f of [`public.session_host_reward('${s0}', true)`, `public.award_xp('${B}', 10, 'hosting', 'x')`, `public.session_attendance_open_guard()`]) {
  ok(/permission denied/.test(await refused(db, B, `select ${f}`)) && /permission denied/.test(await refused(db, null, `select ${f}`)), f.split('(')[0] + ' is closed to clients and visitors');
}
ok(/permission denied/.test(await refused(db, B, `insert into public.xp_ledger (user_id, amount, source, ref) values ('${B}', 50, 'hosting', 'session:x')`)), 'a host cannot write the ledger directly');
ok(/only an administrator adjustment/.test((await db.query(`select public.award_xp($1, -5, 'hosting', 'session:zz')`, [B]).then(() => '', (e) => String(e.message)))), 'only the :adj: key can lower hosting XP');

// the amounts the app explains come from the same settings the close pays (session_xp_rates, read-only, signed-in people only)
const rates0 = await one(B, 'public.session_xp_rates()');
ok(rates0.host_base_xp === 50 && rates0.host_per_attendee_xp === 10, 'session_xp_rates gives the host reward settings: ' + JSON.stringify(rates0));
await db.exec(`update public.progression_settings set value = 7 where key = 'host_per_attendee_xp'`);
ok((await one(C, 'public.session_xp_rates()')).host_per_attendee_xp === 7, 'a change to the setting is what a signed-in person is shown');
await db.exec(`update public.progression_settings set value = 10 where key = 'host_per_attendee_xp'`);
ok(/permission denied/.test(await refused(db, null, 'select public.session_xp_rates()')), 'a visitor cannot read them');
