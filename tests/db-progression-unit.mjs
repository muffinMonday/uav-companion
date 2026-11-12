// Progression core (supabase/migrations/20261114100000_progression_core.sql): the rank ladder, the XP ledger and its guarantees, roles, and the administrator's adjustment.
// Tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows; // as the database owner, for internal checks
const fails = async (q, params = []) => { try { await db.query(q, params); return null; } catch (e) { return String(e.message || e); } };
const total = async (u) => (await sql('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? null;
const peak = async (u) => (await sql('select peak_tier from public.user_xp where user_id = $1', [u]))[0]?.peak_tier ?? null;
const adjust = (uid, code, n, why) => one(uid, 'public.admin_adjust_xp($1, $2, $3)', [code, n, why]);
const bad = (uid, code, n, why) => refused(db, uid, 'select public.admin_adjust_xp($1, $2, $3)', [code, n, why]);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
const [cA, cB, cC, cD] = [await code(A), await code(B), await code(C), await code(D)];

// ---------- the ladder
const ladder = await sql('select tier, name, min_xp from public.progression_ranks order by tier');
ok(ladder.length === 10 && ladder[0].name === 'Rookie' && ladder[9].name === 'Ace' && ladder[9].min_xp === 3500, 'ten ranks, Rookie at 0 XP to Ace at 3500');
ok(JSON.stringify(ladder.map((r) => r.min_xp)) === JSON.stringify([0, 100, 250, 450, 700, 1000, 1400, 1950, 2650, 3500]), 'the thresholds are the agreed cumulative ones');
const cases = [[0, 1], [99, 1], [100, 2], [249, 2], [250, 3], [449, 3], [450, 4], [699, 4], [700, 5], [999, 5], [1000, 6], [1399, 6], [1400, 7], [1949, 7], [1950, 8], [2649, 8], [2650, 9], [3499, 9], [3500, 10], [3501, 10], [99999, 10]];
let wrong = [];
for (const [xp, tier] of cases) { const r = (await sql('select public.rank_for($1) as t', [xp]))[0].t; if (r !== tier) wrong.push(xp + '->' + r); }
ok(wrong.length === 0, 'rank_for gives the right tier on both sides of every threshold, and stays Ace above 3500' + (wrong.length ? ': ' + wrong : ''));
const rates = Object.fromEntries((await sql('select key, value from public.progression_settings')).map((r) => [r.key, Number(r.value)]));
ok(rates.sim_xp_per_hour === 10 && rates.attendance_xp === 50 && rates.steam_manual_cooldown_minutes === 60, 'the earning rates are settings: 10 XP an hour, 50 per session, a 60 minute manual sync cooldown');
ok(await fails(`update public.progression_ranks set min_xp = 260 where tier = 3`) === null, 'a threshold that still rises with the tier can be changed by the owner');
await db.exec(`update public.progression_ranks set min_xp = 250 where tier = 3`);
ok(/rise with the tier/.test(await fails(`update public.progression_ranks set min_xp = 90 where tier = 3`) ?? ''), 'a threshold below the tier before it is refused');
ok(/rise with the tier/.test(await fails(`update public.progression_ranks set min_xp = 3500 where tier = 9`) ?? '') || /unique/.test(await fails(`update public.progression_ranks set min_xp = 3500 where tier = 9`) ?? ''), 'a threshold equal to the tier after it is refused');
ok(/rise with the tier/.test(await fails(`insert into public.progression_ranks (tier, key, name, min_xp) values (11, 'legend', 'Legend', 3000)`) ?? ''), 'a new top tier below the current top is refused');

// ---------- nobody reaches the tables or the internal functions
for (const t of ['progression_ranks', 'progression_settings', 'app_roles', 'xp_ledger', 'user_xp']) {
  ok(/permission denied/.test(await refused(db, A, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' cannot be read directly by a user or a visitor');
}
ok(/permission denied/.test(await refused(db, A, `insert into public.xp_ledger (user_id, amount, source, ref) values ('${A}', 5000, 'admin', 'x')`)), 'a user cannot insert into the ledger');
ok(/permission denied/.test(await refused(db, A, `update public.user_xp set total = 99999 where user_id = '${A}'`)), 'a user cannot set their own total');
const internal = [`public.award_xp('${A}', 100, 'sim', 'hour:1')`, 'public.rank_for(100)', `public.setting_num('attendance_xp')`, `public.has_role('${A}', 'admin')`];
for (const f of internal) {
  ok(/permission denied/.test(await refused(db, A, `select ${f}`)) && /permission denied/.test(await refused(db, null, `select ${f}`)), f.split('(')[0] + ' is internal: refused for a user and a visitor');
}
ok(await total(A) === null, 'and no XP was created by those attempts');
for (const f of ['my_roles()', `grant_role('x', 'admin')`, `revoke_role('x', 'admin')`, `admin_adjust_xp('x', 5, 'y')`, 'admin_verify_xp()']) {
  ok(/permission denied/.test(await refused(db, null, `select public.${f}`)), f.split('(')[0] + ' is closed to a visitor');
}

// ---------- award_xp: idempotent, validated
ok((await sql(`select public.award_xp($1, 10, 'sim', 'hour:1') as r`, [B]))[0].r === 10 && await total(B) === 10, 'an award adds its XP and moves the total');
ok((await sql(`select public.award_xp($1, 10, 'sim', 'hour:1') as r`, [B]))[0].r === null && await total(B) === 10, 'the same award again changes nothing (returns null)');
await Promise.all([1, 2, 3, 4, 5].map(() => sql(`select public.award_xp($1, 50, 'attendance', 'session:s1')`, [B])));
ok(await total(B) === 60 && (await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1 and source = 'attendance'`, [B]))[0].n === 1, 'five identical awards at once give exactly one ledger row and +50');
ok(await total(B) === 60 && (await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1`, [B]))[0].n === 2, 'the same ref under a different source is a different award (hour:1 sim, session:s1 attendance)');
ok((await sql(`select public.award_xp($1, 7, 'attendance', 'hour:1') as r`, [B]))[0].r === 7, 'the key is user + source + ref');
const badAwards = [
  [`select public.award_xp($1, -5, 'sim', 'x1')`, /only an administrator/], [`select public.award_xp($1, 0, 'sim', 'x2')`, /only an administrator|invalid/], [`select public.award_xp($1, 5, 'bonus', 'x3')`, /invalid award source/],
  [`select public.award_xp($1, 5, 'sim', '')`, /invalid award/], [`select public.award_xp($1, 5, 'sim', null)`, /invalid award/], [`select public.award_xp($1, 100001, 'admin', 'x4')`, /too large/],
  [`select public.award_xp($1, null, 'sim', 'x5')`, /invalid award/], [`select public.award_xp($1, 0, 'admin', 'x6')`, /invalid award/], [`select public.award_xp(null::uuid, 5, 'sim', 'x7') where $1::uuid is not null`, /invalid award/],
];
for (const [q, re] of badAwards) ok(re.test(await fails(q, [B]) ?? ''), 'refused: ' + q.replace(/\$1/, 'user').slice(0, 58));
ok(await total(B) === 67, 'refused awards left the total alone');

// ---------- the total follows the ledger; rank follows the total; peak tier is a high-water mark
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
ok(await one(A, 'public.admin_verify_xp()') === 0, 'every total equals the sum of its ledger');
await db.exec(`update public.user_xp set total = total + 1 where user_id = '${B}'`);
ok(await one(A, 'public.admin_verify_xp()') === 1, 'a total that drifted from its ledger is found');
await db.exec(`update public.user_xp set total = total - 1 where user_id = '${B}'`);
ok(await one(A, 'public.admin_verify_xp()') === 0, 'and is clean again once fixed');
ok(/not allowed/.test(await refused(db, B, 'select public.admin_verify_xp()')), 'only an administrator can run the check');

// ---------- administrator adjustments
let r = await adjust(A, cC, 120, '  Won the club   race ');
ok(r.status === 'adjusted' && r.applied === 120 && r.xp === 120 && r.tier === 2, 'an administrator adds XP and gets the new total and tier: ' + JSON.stringify(r));
let row = (await sql(`select amount, source, reason, actor, ref, created_at from public.xp_ledger where user_id = $1 and source = 'admin'`, [C]))[0];
ok(row.amount === 120 && row.reason === 'Won the club race' && row.actor === A && row.ref.length > 10 && row.created_at, 'the ledger records the amount, tidied reason, administrator, a unique ref and the time');
ok(await peak(C) === 2, 'peak tier is 2');
r = await adjust(A, cC, -50, 'Corrected a duplicate entry');
ok(r.applied === -50 && r.xp === 70 && r.tier === 1, 'a deduction lowers the total and the rank can fall (Trainee to Rookie): ' + JSON.stringify(r));
ok(await peak(C) === 2, 'but the peak tier stays 2');
r = await adjust(A, cC, -1000, 'Reset after account misuse');
row = (await sql(`select amount, meta from public.xp_ledger where user_id = $1 and source = 'admin' order by id desc limit 1`, [C]))[0];
ok(r.applied === -70 && r.xp === 0 && row.amount === -70 && row.meta.requested === -1000, 'XP cannot go below zero: the row records what was applied (-70) and what was asked (-1000)');
r = await adjust(A, cC, -5, 'Nothing left to remove');
ok(r.applied === 0 && r.xp === 0 && (await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1 and amount = 0`, [C]))[0].n === 1, 'a deduction on zero XP is still recorded, as a zero row');
r = await adjust(A, cD, 5000, 'Seeding a test account');
ok(r.xp === 5000 && r.tier === 10 && await peak(D) === 10, 'XP keeps counting past 3500 and the tier stays Ace');
r = await adjust(A, cD, -2000, 'Penalty');
ok(r.xp === 3000 && r.tier === 9 && await peak(D) === 10, 'a deduction from Ace drops the rank to Veteran Pilot; the peak stays Ace');
ok(await total(D) === 3000 && (await sql('select sum(amount)::int as s from public.xp_ledger where user_id = $1', [D]))[0].s === 3000 && await one(A, 'public.admin_verify_xp()') === 0, 'total = sum of the ledger after all of this');
ok((await sql(`select count(*)::int as n from public.xp_ledger where source = 'admin' and (actor is null or reason is null)`))[0].n === 0, 'every administrator row has an actor and a reason');

// ---------- refusals
const before = await sql('select count(*)::int as n from public.xp_ledger');
const refusals = [
  [B, cC, 10, 'I am not an admin', /not allowed/], [null, cC, 10, 'visitor', /permission denied/], [A, cC, 10, '', /reason/], [A, cC, 10, '   \n ', /reason/], [A, cC, 10, null, /reason/],
  [A, cC, 10, 'x'.repeat(201), /reason/], [A, cC, 0, 'zero', /non-zero/], [A, cC, null, 'null amount', /non-zero/], [A, cC, 100001, 'too much', /non-zero/], [A, 'ffffffffff', 10, 'no such code', /not found/],
  [A, null, 10, 'null code', /not found/], [A, cA, 10, 'my own XP', /their own XP/],
];
for (const [u, c, n, why, re] of refusals) ok(re.test(await bad(u, c, n, why) ?? ''), 'refused: ' + (u === A ? 'admin' : u === B ? 'non-admin' : 'visitor') + ', amount ' + n + ', reason ' + JSON.stringify(why)?.slice(0, 20));
ok((await sql('select count(*)::int as n from public.xp_ledger'))[0].n === before[0].n, 'a refused adjustment writes nothing');
ok(/not allowed/.test(await bad(B, cA, 10, 'trying to raise the admin')) && await total(A) === null, 'a non-admin cannot target an administrator either');

// ---------- the ledger is append-only
ok(/append-only/.test(await fails(`update public.xp_ledger set amount = 999999 where user_id = '${B}'`) ?? ''), 'a ledger row cannot be changed, even by the database owner');
ok(/append-only/.test(await fails(`delete from public.xp_ledger where user_id = '${B}'`) ?? ''), 'or deleted');
ok(/append-only/.test(await fails(`truncate public.xp_ledger`) ?? ''), 'or truncated');
ok(await total(B) === 67, 'and the total is unchanged');
await db.exec(`delete from auth.users where id = '${B}'`);
ok((await sql('select count(*)::int as n from public.xp_ledger where user_id = $1', [B]))[0].n === 0 && await total(B) === null, 'deleting an account removes its ledger rows and total with it');
ok((await sql(`select count(*)::int as n from public.xp_ledger where source = 'admin' and user_id = $1`, [D]))[0].n === 2, "and nobody else's rows");

// ---------- roles
const roles = (u) => one(u, 'public.my_roles()');
let m = await roles(A);
ok(m.admin === true && m.organiser === true, 'an administrator is also an organiser');
m = await roles(C);
ok(m.admin === false && m.organiser === false, 'an ordinary user holds no role');
ok(/not allowed/.test(await refused(db, C, `select public.grant_role('${cC}', 'admin')`)), 'an ordinary user cannot grant a role, even to themselves');
ok((await one(A, `public.grant_role($1, 'organiser')`, [cC])).status === 'granted', 'an administrator grants the organiser role by friend code');
m = await roles(C);
ok(m.organiser === true && m.admin === false, 'the organiser is not an administrator');
ok((await sql(`select granted_by from public.app_roles where user_id = $1 and role = 'organiser'`, [C]))[0].granted_by === A, 'who granted it is recorded');
ok(/not allowed/.test(await refused(db, C, `select public.grant_role('${cD}', 'organiser')`)) && /not allowed/.test(await refused(db, C, `select public.admin_adjust_xp('${cD}', 5, 'organisers cannot adjust XP')`)), 'an organiser cannot grant roles or adjust XP');
ok((await one(A, `public.grant_role($1, 'organiser')`, [cC])).status === 'granted' && (await sql(`select count(*)::int as n from public.app_roles where user_id = $1`, [C]))[0].n === 1, 'granting twice leaves one row');
const roleRefusals = [[`select public.grant_role('${cC}', 'owner')`, /unknown role/], [`select public.grant_role('ffffffffff', 'admin')`, /not found/], [`select public.revoke_role('${cC}', null)`, /unknown role/]];
for (const [q, re] of roleRefusals) ok(re.test(await refused(db, A, q) ?? ''), 'refused: ' + q.slice(7, 50));
ok((await one(A, `public.revoke_role($1, 'organiser')`, [cC])).status === 'revoked' && (await roles(C)).organiser === false, 'an administrator revokes it');
ok(/last administrator/.test(await refused(db, A, `select public.revoke_role('${cA}', 'admin')`) ?? ''), 'the last administrator cannot be removed');
await one(A, `public.grant_role($1, 'admin')`, [cD]);
ok((await roles(D)).admin === true && (await one(A, `public.revoke_role($1, 'admin')`, [cA])).status === 'revoked' && (await roles(A)).admin === false, 'with a second administrator the first can step down');
ok(/last administrator/.test(await refused(db, D, `select public.revoke_role('${cD}', 'admin')`) ?? ''), 'and the new last one is protected in turn');
