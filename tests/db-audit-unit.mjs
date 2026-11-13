// The audit trail (supabase/migrations/20261116120000_audit_events.sql): the append-only table and its one exception, what each operation records, that a rollback
// removes the record with the change, the deletion tombstone, the admin read function and the controlled reason codes. Tested on a real Postgres (PGlite).
// The Steam and attendance events are asserted in db-steam-unit.mjs and db-sessions-unit.mjs, where their fixtures are. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const fails = async (q, params = []) => { try { await db.query(q, params); return null; } catch (e) { return String(e.message || e); } };
const events = (where = 'true', params = []) => sql(`select id, action, actor, subject, ref, meta from public.audit_events where ${where} order by id`, params);
const count = async () => (await sql('select count(*)::int as n from public.audit_events'))[0].n;

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
const [cA, cB, cC, cD] = [await code(A), await code(B), await code(C), await code(D)];
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
const base = await count();

// ---------- closed to clients
for (const q of ['select * from public.audit_events', `insert into public.audit_events (action) values ('role.grant')`, `update public.audit_events set ref = 'x'`, 'delete from public.audit_events']) {
  ok(/permission denied/.test(await refused(db, A, q) ?? '') && /permission denied/.test(await refused(db, null, q) ?? ''), 'the table is closed to users and visitors: ' + q.split(' ').slice(0, 3).join(' '));
}
for (const f of [`public.audit_log('role.grant', null, null, null, '{}')`, `public.audit_reason_code('x')`]) ok(/permission denied/.test(await refused(db, A, `select ${f}`) ?? ''), f.split('(')[0] + ' is internal');
ok(/permission denied/.test(await refused(db, null, `select * from public.admin_audit_events()`) ?? ''), 'admin_audit_events is closed to a visitor');
ok(/not allowed/.test(await refused(db, C, `select * from public.admin_audit_events()`) ?? ''), 'and to an ordinary user');

// ---------- roles
ok((await one(A, 'public.grant_role($1, $2)', [cC, 'organiser'])).status === 'granted', '(setup) grant');
let ev = await events(`action = 'role.grant'`);
ok(ev.length === 1 && ev[0].actor === A && ev[0].subject === C && ev[0].ref === 'organiser' && ev[0].meta.role === 'organiser', 'granting a role records who, to whom and which role');
await one(A, 'public.grant_role($1, $2)', [cC, 'organiser']);
ok((await events(`action = 'role.grant'`)).length === 1, 'a grant that changed nothing is not recorded');
ok(/not allowed/.test(await refused(db, C, `select public.grant_role('${cD}', 'organiser')`) ?? '') && /unknown role/.test(await refused(db, A, `select public.grant_role('${cD}', 'owner')`) ?? '') && (await events(`action = 'role.grant'`)).length === 1, 'refused grants leave nothing');
await one(A, 'public.grant_role($1, $2)', [cB, 'admin']);
ok((await one(A, 'public.revoke_role($1, $2)', [cC, 'organiser'])).status === 'revoked', '(setup) revoke');
ev = await events(`action = 'role.revoke'`);
ok(ev.length === 1 && ev[0].actor === A && ev[0].subject === C && ev[0].ref === 'organiser', 'revoking a role is recorded (it used to leave nothing)');
await one(A, 'public.revoke_role($1, $2)', [cC, 'organiser']);
ok((await events(`action = 'role.revoke'`)).length === 1, 'revoking a role nobody holds records nothing');
await one(B, 'public.revoke_role($1, $2)', [cA, 'admin']); await one(B, 'public.grant_role($1, $2)', [cA, 'admin']);
ok((await events(`action = 'role.revoke' and actor = $1`, [B])).length === 1 && (await events(`action = 'role.grant' and actor = $1`, [B])).length === 1, 'a second administrator is recorded as the actor too');

// ---------- the record and the change are one transaction
{
  const before = await count();
  await db.exec(`begin; set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false); select public.grant_role('${cD}', 'organiser'); reset role; rollback;`);
  ok((await count()) === before && (await sql(`select 1 from public.app_roles where user_id = $1`, [D])).length === 0, 'a rolled-back grant leaves neither the role nor the audit row');
  const e = await fails(`do $$ begin perform public.audit_log('bogus.action', null, null, null, '{}'); end $$`);
  ok(/check constraint/.test(e ?? '') && (await count()) === before, 'an unknown action is refused by the table, so the operation that wrote it would roll back too');
}

// ---------- settings
{
  const n0 = await count();
  await db.exec(`update public.progression_settings set value = 11 where key = 'sim_xp_per_hour'`);
  let e = await events(`action = 'setting.change' and ref = 'sim_xp_per_hour'`);
  ok(e.length === 1 && e[0].actor === null && Number(e[0].meta.old) === 10 && Number(e[0].meta.new) === 11 && e[0].meta.key === 'sim_xp_per_hour', 'a changed setting records the key, old and new value (no actor from the SQL editor)');
  await db.exec(`update public.progression_settings set value = 11 where key = 'sim_xp_per_hour'`);
  ok((await count()) === n0 + 1, 'setting a value to itself records nothing');
  await db.exec(`update public.progression_settings set value = 10 where key = 'sim_xp_per_hour'; insert into public.progression_settings (key, value) values ('probe', 1); delete from public.progression_settings where key = 'probe'`);
  e = await events(`action = 'setting.change' and ref = 'probe'`);
  ok(e.length === 2 && e[0].meta.old === null && Number(e[0].meta.new) === 1 && Number(e[1].meta.old) === 1 && e[1].meta.new === null, 'inserting and deleting a setting are recorded');
}

// ---------- reason codes
for (const [text, want] of [['Mistake, wrong person', 'mistaken_mark'], ['mistaken', 'mistaken_mark'], ['wrong name', 'mistaken_mark'], ['No show', 'no_show'], ['no-show at the field', 'no_show'], ['noshow', 'no_show'],
  ['Duplicate entry', 'duplicate'], ['dup', 'duplicate'], ['abuse of the code', 'abuse'], ['cheating', 'abuse'], ['something else entirely', 'other'], ['  ', 'other'], [null, 'other'], ['Marked twice by mistake', 'other']]) {
  const got = (await sql('select public.audit_reason_code($1) as c', [text]))[0].c;
  ok(got === want, `reason code for ${JSON.stringify(text)} is ${want}${got === want ? '' : ' (got ' + got + ')'}`);
}

// ---------- constraints: names, size, shape; the reserved area.* names
ok(await fails(`insert into public.audit_events (action) values ('area.hide')`) === null && await fails(`insert into public.audit_events (action) values ('area.')`) !== null && await fails(`insert into public.audit_events (action) values ('areas.hide')`) !== null, 'area.* names are accepted (reserved), other unknown names are not');
ok(await fails(`insert into public.audit_events (action, meta) values ('role.grant', '[]')`) !== null && await fails(`insert into public.audit_events (action, meta) values ('role.grant', jsonb_build_object('x', repeat('y', 2000)))`) !== null && await fails(`insert into public.audit_events (action, ref) values ('role.grant', '')`) !== null, 'meta must be a small object and ref 1 to 80 characters');

// ---------- append-only, with the single exception
{
  const t = (await sql(`select id from public.audit_events where action = 'role.grant' and subject = $1 limit 1`, [C]))[0].id;
  ok(/append-only/.test(await fails('delete from public.audit_events where id = $1', [t]) ?? ''), 'a row cannot be deleted (as the owner, with no marker)');
  ok(/append-only/.test(await fails('truncate public.audit_events') ?? ''), 'TRUNCATE is refused');
  ok(/append-only/.test(await fails(`update public.audit_events set ref = 'x' where id = $1`, [t]) ?? '') && /append-only/.test(await fails(`update public.audit_events set subject = null where id = $1`, [t]) ?? ''), 'an update is refused without the wipe marker, even setting a reference to NULL');
  // exec runs several statements, so the marker cases use it
  const tryExec = async (stmts) => { try { await db.exec(stmts); return null; } catch (e) { return String(e.message || e); } finally { await db.exec(`select set_config('uavzones.wipe_user', '', false)`); } };
  ok(/append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); delete from public.audit_events where id = ${t}`) ?? ''), 'a row cannot be deleted even under the wipe marker');
  ok(/append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set meta = '{}' where id = ${t}`) ?? '') && /append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set ref = 'x' where id = ${t}`) ?? '') && /append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set action = 'role.revoke' where id = ${t}`) ?? ''), 'under the marker no other column can change');
  ok(/append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${D}', false); update public.audit_events set subject = null where id = ${t}`) ?? ''), 'the marker for another person cannot null this person');
  ok(/append-only/.test(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set actor = '${B}' where id = ${t}`) ?? ''), 'a reference cannot be changed to another value, only nulled');
  ok(/append-only/.test(await tryExec(`set role service_role; select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set subject = null where id = ${t}; reset role;`) ?? ''), 'a client-facing role (service_role) cannot use the marker');
  await db.exec('reset role');
  ok((await sql('select subject from public.audit_events where id = $1', [t]))[0].subject === C, '(nothing above changed the row)');
  ok(await tryExec(`select set_config('uavzones.wipe_user', '${C}', false); update public.audit_events set subject = null where id = ${t}`) === null, 'the one allowed change: the owner-run wipe nulls the reference to that person');
  ok((await sql('select subject, action, ref from public.audit_events where id = $1', [t]))[0].subject === null, '(and it took effect)');
}

// ---------- deleting a profile: references forgotten, one tombstone, nothing deleted
{
  await one(A, 'public.grant_role($1, $2)', [cD, 'organiser']); await one(A, 'public.revoke_role($1, $2)', [cD, 'organiser']);
  await one(B, 'public.grant_role($1, $2)', [cC, 'organiser']); // actor B, subject C
  const total0 = await count();
  const mine = async (u) => (await sql(`select count(*)::int as n from public.audit_events where actor = $1 or subject = $1`, [u]))[0].n;
  ok((await mine(D)) >= 2 && (await mine(B)) >= 3, '(setup) Dee is the subject of events and Bea the actor of some');
  await one(D, 'public.delete_profile()');
  ok((await mine(D)) === 0 && (await count()) === total0 + 1, 'deleting a profile removes no audit row; it only forgets the person as subject, and adds one tombstone');
  const tomb = (await events(`action = 'profile.delete'`));
  ok(tomb.length === 1 && tomb[0].actor === null && tomb[0].subject === null && tomb[0].ref === null && JSON.stringify(tomb[0].meta) === '{}', 'the tombstone has no actor, subject, reference or data');
  ok((await events(`action = 'role.grant' and ref = 'organiser' and actor = $1`, [A])).length >= 1 && (await events(`action = 'role.revoke' and subject is null and actor = $1`, [A])).length >= 1, 'the events themselves stay (who revoked, what, when) with the deleted person as NULL');
  await one(D, 'public.delete_profile()');
  ok((await events(`action = 'profile.delete'`)).length === 1, 'repeating the deletion (after a partial failure) adds no second tombstone');
  await one(B, 'public.delete_profile()');
  ok((await mine(B)) === 0 && (await events(`action = 'profile.delete'`)).length === 2, 'an administrator who deletes their profile is forgotten as actor, and a second tombstone is added');
  ok((await sql(`select count(*)::int as n from public.audit_events where action = 'role.grant' and actor is null and subject = '${C}'`))[0].n >= 1, 'their grant to Cam remains, with the administrator forgotten');
  ok(/permission denied/.test(await refused(db, A, `update public.audit_events set actor = null`) ?? ''), 'users still cannot touch the table');
  const none = await fails(`select public.delete_profile()`);
  ok(/not signed in/.test(none ?? ''), 'delete_profile still needs a signed-in user (as before)');
}

// ---------- the admin read function
{
  const rows = await as(db, A, 'select * from public.admin_audit_events(500, null)');
  ok(rows.length <= 200 && rows.length > 5, 'an administrator reads the events: ' + rows.length);
  ok(rows.every((r, i) => i === 0 || new Date(rows[i - 1].at) >= new Date(r.at)), 'newest first');
  ok(!('actor' in rows[0]) && !('subject' in rows[0]) && 'actor_code' in rows[0] && 'subject_code' in rows[0], 'people are shown by friend code, not id');
  const g = rows.find((r) => r.action === 'role.grant' && r.actor_code === cA);
  ok(g && (g.subject_code === cB || g.subject_code === cC || g.subject_code === cD || g.subject_code === null), 'a grant names its actor by friend code');
  ok(rows.some((r) => r.action === 'role.revoke' && r.subject_code === null), 'a person who deleted their profile shows as empty');
  ok((await as(db, A, `select * from public.admin_audit_events(5, 'role.grant')`)).every((r) => r.action === 'role.grant') && (await as(db, A, `select * from public.admin_audit_events(0, null)`)).length === 1 && (await as(db, A, `select * from public.admin_audit_events(null, null)`)).length <= 50, 'the action filter works and the limit is clamped (min 1, default 50, max 200)');
}
