// Flight sessions, RSVP and organiser-verified attendance (supabase/migrations/20261114130000_flight_sessions.sql).
// Tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const fails = async (q, params = []) => { try { await db.query(q, params); return null; } catch (e) { return String(e.message || e); } };
const J = (o) => JSON.stringify(o);
const total = async (u) => (await sql('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? 0;
const ledger = (u) => sql(`select amount, source, ref, actor, reason, meta from public.xp_ledger where user_id = $1 and source = 'attendance' order by id`, [u]);
const unlocked = async (u) => (await sql('select achievement_key as k from public.user_achievements where user_id = $1', [u])).map((r) => r.k);
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
const [cA, cB, cC, cD] = [await codeOf(A), await codeOf(B), await codeOf(C), await codeOf(D)];
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
await one(A, `public.grant_role($1, 'organiser')`, [cB]); // B is an organiser; A an administrator; C and D ordinary people

// a session with chosen times, made by `by`
async function mk(by, startH, endH, title = 'Session', status = 'scheduled') {
  return (await sql(`insert into public.flight_sessions (title, starts_at, ends_at, created_by, status) values ($1, $2, $3, $4, $5) returning id`, [title, hr(startH), hr(endH), by, status]))[0].id;
}
const open = await mk(B, -1, 2, 'Open now');      // started an hour ago, still open: attendance can be marked
const future = await mk(B, 24, 27, 'Tomorrow');   // not started
const mark = (u, s, kind, ref) => one(u, 'public.mark_attended($1, $2, $3)', [s, kind, ref]);
const badMark = (u, s, kind, ref) => refused(db, u, 'select public.mark_attended($1, $2, $3)', [s, kind, ref]);
const rsvps = (u, s) => one(u, 'public.list_session_rsvps($1)', [s]);

// ---------- no direct access, visitors, ordinary people
for (const t of ['flight_sessions', 'session_rsvps', 'session_attendance']) ok(/permission denied/.test(await refused(db, C, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' cannot be read directly');
ok(/permission denied/.test(await refused(db, C, `insert into public.session_attendance (session_id, user_id, source) values ('${open}', '${C}', 'rsvp')`)), 'nobody can write attendance directly (no way to award oneself)');
for (const f of [`public.list_sessions()`, `public.rsvp_session('${open}')`, `public.withdraw_rsvp('${open}')`, `public.mark_attended('${open}', 'code', 'x')`, `public.list_session_rsvps('${open}')`, `public.create_session('t', null, null, now(), now() + interval '1 hour')`, `public.close_session('${open}')`, `public.cancel_session('${open}')`, `public.update_session('${open}', '{}')`, `public.revoke_attendance('${open}', '${open}', 'x')`, `public.can_manage_session('${A}', '${open}')`]) {
  ok(/permission denied/.test(await refused(db, null, `select ${f}`)), f.split('(')[0] + ' is closed to a visitor');
}
ok(/permission denied/.test(await refused(db, C, `select public.can_manage_session('${A}', '${open}')`)), 'can_manage_session is internal');

// ---------- creating a session
const create = (u, t, d, l, s, e) => one(u, 'public.create_session($1, $2, $3, $4, $5)', [t, d, l, s, e]);
const badCreate = (u, t, d, l, s, e) => refused(db, u, 'select public.create_session($1, $2, $3, $4, $5)', [t, d, l, s, e]);
ok(/not allowed/.test(await badCreate(C, 'Mine', null, null, hr(5), hr(7))), 'an ordinary user cannot create a session');
const made = await create(B, '  Saturday   field  day ', '  Bring batteries\nand goggles ', ' Wuhan East Lake ', hr(48), hr(52));
const row = (await sql('select * from public.flight_sessions where id = $1', [made.id]))[0];
ok(row.title === 'Saturday field day' && row.description === 'Bring batteries and goggles' && row.location === 'Wuhan East Lake' && row.created_by === B && row.status === 'scheduled', 'an organiser creates a session; the text is tidied and the creator recorded');
ok(!!(await create(A, 'Admin session', null, null, hr(5), hr(6))).id, 'an administrator can create one too');
const createRefusals = [
  ['', null, null, hr(5), hr(6), /title/], ['x'.repeat(81), null, null, hr(5), hr(6), /title/], ['T', 'd'.repeat(501), null, hr(5), hr(6), /description/], ['T', null, 'l'.repeat(121), hr(5), hr(6), /location/],
  ['T', null, null, hr(6), hr(5), /ends after/], ['T', null, null, hr(5), hr(5), /ends after/], ['T', null, null, hr(5), hr(60), /48 hours/], ['T', null, null, null, hr(5), /required/],
  ['T', null, null, hr(-24 * 31), hr(-24 * 31 + 2), /within the last 30 days/], ['T', null, null, hr(24 * 400), hr(24 * 400 + 2), /within the last 30 days/],
];
for (const [t, d, l, s, e, re] of createRefusals) ok(re.test(await badCreate(B, t, d, l, s, e) ?? ''), 'refused: ' + J([t.slice(0, 12), d && d.length, l && l.length, s && 's', e && 'e']));

// ---------- who sees what in the list
const listFor = (u) => as(db, u, 'select * from public.list_sessions()');
let ls = await listFor(C);
const lo = ls.find((x) => x.id === open);
ok(lo && lo.title === 'Open now' && lo.rsvp_count === 0 && lo.i_rsvped === false && lo.my_attended === false && lo.can_manage === false, 'anyone signed in sees scheduled sessions, with a count and no management rights');
ok((await listFor(B)).find((x) => x.id === open).can_manage === true && (await listFor(A)).find((x) => x.id === open).can_manage === true, 'the organiser who made it and an administrator can manage it');
const aSession = (await sql(`select id from public.flight_sessions where created_by = $1`, [A]))[0].id;
ok((await listFor(B)).find((x) => x.id === aSession).can_manage === false && (await listFor(A)).find((x) => x.id === aSession).can_manage === true, "an organiser does not manage another person's session");
ok(!Object.keys(lo).some((k) => /user|created_by|rsvp_id/.test(k)), 'and no identities appear in the list');

// ---------- RSVP: intent only, no XP
ok((await one(C, 'public.rsvp_session($1)', [open])).status === 'rsvped' && (await one(C, 'public.rsvp_session($1)', [open])).status === 'rsvped', 'RSVP, and again: idempotent');
ok((await sql('select count(*)::int as n from public.session_rsvps where session_id = $1', [open]))[0].n === 1, 'one RSVP row');
ok(await total(C) === 0 && (await ledger(C)).length === 0, 'an RSVP earns no XP');
ls = await listFor(C); ok(ls.find((x) => x.id === open).i_rsvped === true && ls.find((x) => x.id === open).rsvp_count === 1, 'the list shows my RSVP and the count');
ok(/session not found/.test(await refused(db, C, `select public.rsvp_session('${C}')`)), 'RSVP to nothing is refused');
const over = await mk(B, -5, -3, 'Over'); const closedS = await mk(B, -1, 2, 'Closed', 'closed');
ok(/session not found/.test(await refused(db, C, 'select public.rsvp_session($1)', [closedS])) && /over/.test(await refused(db, C, 'select public.rsvp_session($1)', [over]) ?? ''), 'a closed session or one that is over takes no RSVP');
ok((await one(D, 'public.rsvp_session($1)', [future])).status === 'rsvped' && (await one(D, 'public.withdraw_rsvp($1)', [future])).status === 'withdrawn' && (await sql('select count(*)::int as n from public.session_rsvps where session_id = $1', [future]))[0].n === 0, 'before it starts an RSVP can be withdrawn');
ok((await one(D, 'public.withdraw_rsvp($1)', [future])).status === 'withdrawn', 'withdrawing when not RSVPed is harmless');
ok(/has started/.test(await refused(db, C, 'select public.withdraw_rsvp($1)', [open]) ?? '') && (await sql('select count(*)::int as n from public.session_rsvps where session_id = $1', [open]))[0].n === 1, 'once it has started an RSVP cannot be withdrawn');
await db.exec(`delete from public.profiles where user_id = '${D}'`);
ok(/create your profile first/.test(await refused(db, D, 'select public.rsvp_session($1)', [open]) ?? ''), 'RSVP needs a profile');
await one(D, 'public.ensure_profile($1)', ['Dee']);
const cD2 = await codeOf(D);

// ---------- the RSVP list is for managers, and shows no user ids
ok(/session not found/.test(await refused(db, C, 'select public.list_session_rsvps($1)', [open])) && /session not found/.test(await refused(db, D, 'select public.list_session_rsvps($1)', [open])), 'ordinary people cannot read the RSVP list');
await one(A, `public.grant_role($1, 'organiser')`, [cD2]); // D becomes an organiser (of nothing yet)
ok(/session not found/.test(await refused(db, D, 'select public.list_session_rsvps($1)', [open])), "an organiser cannot read the list of another organiser's session");
let list = await rsvps(B, open);
ok(list.length === 1 && list[0].display_name === 'Cam' && list[0].rsvped === true && list[0].attended === false && list[0].attendance_id === null && !!list[0].rsvp_id, 'the session\'s organiser sees who said they would come');
ok(J(await rsvps(A, open)) === J(list), 'and so does an administrator');
ok(![A, B, C, D].some((u) => J(list).includes(u)), 'with no user ids');
await db.exec(`delete from public.app_roles where user_id = '${D}'`);

// ---------- marking attendance
ok(/session not found/.test(await badMark(C, open, 'rsvp', list[0].rsvp_id)) && /session not found/.test(await badMark(D, open, 'code', cC)), 'only a manager of the session can mark anyone');
ok(/has not started/.test(await badMark(B, future, 'code', cC) ?? ''), 'not before the session starts');
let r = await mark(B, open, 'rsvp', list[0].rsvp_id);
ok(r.status === 'marked' && r.display_name === 'Cam' && r.xp === 50 && await total(C) === 50, 'the organiser marks an RSVP present: 50 XP');
const att = (await sql(`select * from public.session_attendance where session_id = $1 and user_id = $2`, [open, C]))[0];
ok(att.verified_by === B && att.verified_at && att.source === 'rsvp' && att.revoked_at === null, 'the attendance row keeps who verified it, when, and that it came from an RSVP');
const lg = await ledger(C);
ok(lg.length === 1 && lg[0].amount === 50 && lg[0].ref === 'session:' + open && lg[0].actor === B, 'and the ledger has one attendance row, naming the organiser');
ok((await unlocked(C)).includes('first-meetup'), 'First Meetup unlocked');
r = await mark(B, open, 'rsvp', list[0].rsvp_id);
ok(r.status === 'already_attended' && await total(C) === 50 && (await ledger(C)).length === 1, 'marking again changes nothing');
r = await mark(A, open, 'code', cC.toUpperCase().slice(0, 5) + '-' + cC.toUpperCase().slice(5));
ok(r.status === 'already_attended' && await total(C) === 50, 'the same person by friend code (typed with a dash, in capitals) is also recognised');
await Promise.all([1, 2, 3, 4].map(() => sql(`select 1`)));
const results = await Promise.all([1, 2, 3, 4].map(() => mark(B, open, 'code', cD2)));
ok(results.filter((x) => x.status === 'marked').length === 1 && results.filter((x) => x.status === 'already_attended').length === 3 && await total(D) === 50, 'a walk-in marked four times at once gets one award');
ok((await sql(`select source from public.session_attendance where session_id = $1 and user_id = $2`, [open, D]))[0].source === 'walk_in', 'and is recorded as a walk-in');
list = await rsvps(B, open);
ok(list.length === 2 && list.find((x) => x.display_name === 'Dee').rsvped === false && list.find((x) => x.display_name === 'Dee').attended === true && list.find((x) => x.display_name === 'Cam').attended === true, 'the list shows the walk-in as attended and not RSVPed');
ok(/not found/.test(await badMark(B, open, 'code', 'ffffffffff') ?? '') && /not found/.test(await badMark(B, open, 'code', null) ?? '') && /not found/.test(await badMark(B, open, 'rsvp', 'not-a-uuid') ?? '') && /not found/.test(await badMark(B, open, 'rsvp', B) ?? ''), 'an unknown code or RSVP id is refused');
ok(/invalid kind/.test(await badMark(B, open, 'user', C) ?? ''), 'there is no way to mark by user id');
await one(B, 'public.rsvp_session($1)', [open]);
const bRsvp = (await rsvps(B, open)).find((x) => x.display_name === 'Bea').rsvp_id;
ok(/yourself/.test(await badMark(B, open, 'rsvp', bRsvp) ?? '') && /yourself/.test(await badMark(B, open, 'code', cB) ?? '') && /yourself/.test(await badMark(A, open, 'code', cA) ?? ''), 'nobody can mark themselves present, not an organiser and not an administrator');
ok(await total(B) === 0 && await total(A) === 0, 'and no XP was created');
const other = await mk(D, -1, 2, 'Dee session'); // not B's
ok(/session not found/.test(await badMark(B, other, 'code', cC) ?? '') && (await mark(A, other, 'code', cC)).status === 'marked', "an organiser cannot mark at another organiser's session, an administrator can");
ok((await ledger(C)).length === 2 && await total(C) === 100, 'a second session is a second award');

// ---------- achievements follow from verified attendance
for (let i = 0; i < 2; i++) { const s = await mk(B, -1, 2, 'More ' + i); await mark(B, s, 'code', cC); }
ok(!(await unlocked(C)).includes('regular-flyer') && await total(C) === 200, 'four sessions: not yet Regular Flyer');
const s5 = await mk(B, -1, 2, 'Fifth'); await mark(B, s5, 'code', cC);
ok((await unlocked(C)).includes('regular-flyer') && await total(C) === 250, 'the fifth unlocks Regular Flyer');

// ---------- closed and cancelled
ok(/closed/.test(await badMark(B, closedS, 'code', cD2) ?? ''), 'a closed session takes no more marks');
const toClose = await mk(B, -1, 2, 'To close'); const toCancel = await mk(B, 5, 7, 'To cancel');
ok(/session not found/.test(await refused(db, D, 'select public.close_session($1)', [toClose])) && /session not found/.test(await refused(db, C, 'select public.cancel_session($1)', [toCancel])), "nobody else can close or cancel a session");
ok((await one(B, 'public.close_session($1)', [toClose])).status === 'closed' && /already closed/.test(await refused(db, B, 'select public.close_session($1)', [toClose]) ?? '') && /closed/.test(await badMark(B, toClose, 'code', cC) ?? ''), 'an organiser closes their session; closing is final and ends marking');
ok((await one(B, 'public.cancel_session($1)', [toCancel])).status === 'cancelled' && /session not found/.test(await refused(db, C, 'select public.rsvp_session($1)', [toCancel]) ?? ''), 'a session with no attendance can be cancelled, and then takes no RSVPs');
ok(/close the session instead/.test(await refused(db, B, 'select public.cancel_session($1)', [open]) ?? ''), 'but not once someone was marked present');
ok(!(await listFor(C)).some((x) => x.id === toClose) && (await listFor(B)).some((x) => x.id === toClose), 'a closed session is listed only to its managers and those who were there');

// ---------- editing a session
const upd = (u, s, patch) => one(u, 'public.update_session($1, $2::jsonb)', [s, J(patch)]);
const badUpd = (u, s, patch) => refused(db, u, 'select public.update_session($1, $2::jsonb)', [s, J(patch)]);
ok((await upd(B, future, { title: ' New  title ', description: null, location: 'Somewhere' })).status === 'updated' && (await sql('select title, description, location from public.flight_sessions where id = $1', [future]))[0].title === 'New title', 'an organiser edits their scheduled session');
ok(/session not found/.test(await badUpd(C, future, { title: 'x' }) ?? '') && /session not found/.test(await badUpd(D, future, { title: 'x' }) ?? '') && (await upd(A, future, { title: 'Admin edit' })).status === 'updated', 'only its managers edit it');
ok(/unknown session field/.test(await badUpd(B, future, { status: 'closed' }) ?? '') && /unknown session field/.test(await badUpd(B, future, { created_by: C }) ?? ''), 'status and creator cannot be set');
ok(/ends after/.test(await badUpd(B, future, { ends_at: hr(1) }) ?? '') && /title/.test(await badUpd(B, future, { title: '' }) ?? '') && /must be times/.test(await badUpd(B, future, { starts_at: 'tomorrow-ish' }) ?? '') && /must be an object/.test(await badUpd(B, future, [1]) ?? ''), 'a bad edit is refused');
ok(/only a scheduled/.test(await badUpd(B, closedS, { title: 'x' }) ?? ''), 'a closed session cannot be edited');

// ---------- revoking a mistaken mark: administrators only, ledger kept
const aid = (await rsvps(B, open)).find((x) => x.display_name === 'Dee').attendance_id;
ok(/not allowed/.test(await refused(db, B, 'select public.revoke_attendance($1, $2, $3)', [open, aid, 'wrong person'])), 'an organiser cannot revoke a mark');
ok(/reason/.test(await refused(db, A, 'select public.revoke_attendance($1, $2, $3)', [open, aid, '  ']) ?? '') && /not found/.test(await refused(db, A, 'select public.revoke_attendance($1, $2, $3)', [open, B, 'x']) ?? ''), 'an administrator needs a reason and a real mark');
await one(A, 'public.admin_adjust_xp($1, -40, $2)', [cD2, 'Spent some']); // D has 10 XP left: the reversal will be clamped
ok(await total(D) === 10, '(setup) Dee has 10 XP');
ok((await one(A, 'public.revoke_attendance($1, $2, $3)', [open, aid, 'Marked the wrong person'])).status === 'revoked', 'an administrator revokes it');
const rv = (await ledger(D)).find((x) => x.ref.endsWith(':rev'));
ok(rv && rv.amount === -10 && rv.meta.requested === -50 && rv.actor === A && rv.reason === 'Marked the wrong person' && await total(D) === 0, 'a reversal is appended to the ledger (never below zero), with the administrator and reason; nothing was deleted');
ok((await ledger(D)).length === 2, 'the original award row is still there');
ok((await rsvps(A, open)).find((x) => x.display_name === 'Dee').revoked === true && (await rsvps(A, open)).find((x) => x.display_name === 'Dee').attended === false, 'the list shows it as revoked');
ok((await sql(`select revoked_by, revoked_at, verified_by from public.session_attendance where id = $1`, [aid]))[0].revoked_by === A, 'the attendance row keeps who verified it and who revoked it');
ok((await one(A, 'public.revoke_attendance($1, $2, $3)', [open, aid, 'again'])).status === 'already_revoked' && (await ledger(D)).length === 2, 'revoking twice does nothing more');
ok(/revoked by an administrator/.test(await badMark(B, open, 'code', cD2) ?? '') && await total(D) === 0, 'marking them again is refused and awards nothing');
ok(!(await unlocked(D)).includes('xxx') && (await unlocked(D)).includes('first-meetup'), 'their achievement is not taken away');
const aidC = (await rsvps(B, open)).find((x) => x.display_name === 'Cam').attendance_id;
await one(A, 'public.revoke_attendance($1, $2, $3)', [open, aidC, 'Test']);
ok(await total(C) === 200 && (await unlocked(C)).includes('regular-flyer') && (await unlocked(C)).includes('first-meetup'), 'a full reversal lowers XP by 50 and keeps every achievement');

// ---------- leaving: deleting a profile withdraws RSVPs and keeps attendance; deleting an account removes both
await one(B, 'public.ensure_profile($1)', ['Bea']);
const sx = await mk(A, 1, 3, 'RSVP later'); await one(C, 'public.rsvp_session($1)', [sx]);
await one(C, 'public.delete_profile()');
ok((await sql('select count(*)::int as n from public.session_rsvps where user_id = $1', [C]))[0].n === 0 && (await sql('select count(*)::int as n from public.session_attendance where user_id = $1', [C]))[0].n >= 5, "deleting a profile withdraws the person's RSVPs and keeps what they attended");
await db.exec(`delete from auth.users where id = '${C}'`);
ok((await sql('select count(*)::int as n from public.session_attendance where user_id = $1', [C]))[0].n === 0 && (await sql('select count(*)::int as n from public.xp_ledger where user_id = $1', [C]))[0].n === 0, "deleting the account removes their attendance and XP");
ok((await sql('select count(*)::int as n from public.session_attendance where user_id = $1', [D]))[0].n === 1, "and nobody else's");
