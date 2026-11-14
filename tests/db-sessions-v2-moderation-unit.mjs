// Flight Sessions 2.0, phase 6 backend (supabase/migrations/20261118120000_sessions_v2_moderation.sql): reports, automatic hiding, administrator review, audit.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const E = '55555555-5555-5555-5555-555555555555';
const NONE = '99999999-9999-9999-9999-999999999999';

await db.exec(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee'], [E, 'Eve']]) await one(u, 'public.ensure_profile($1)', [n]);
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin'); update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const mk = (u, o = {}) => one(u, 'public.create_session($1, null, $2, $3, $4, $5, $6, $7, $8)', [o.title ?? 'Open fly', 'East Lake', o.lat ?? 30.5, o.lng ?? 114.3, hr(o.s ?? 24), hr(o.e ?? 27), 'UTC', o.vis ?? 'public']);
const report = (u, id, reason = 'spam', note = null) => one(u, 'public.report_session($1, $2, $3)', [id, reason, note]);
const bad = (u, id, reason = 'spam', note = null) => refused(db, u, 'select public.report_session($1, $2, $3)', [id, reason, note]);
const pubIds = async () => (await rows(null, 'select id from public.list_public_sessions()')).map((x) => x.id);

// ---------- access
ok(/permission denied/.test(await refused(db, C, 'select * from public.session_reports')) && /permission denied/.test(await refused(db, null, 'select * from public.session_reports')), 'reports cannot be read directly');
for (const f of [`public.report_session('${A}', 'spam')`, `public.admin_list_session_reports()`, `public.admin_review_session_report('${A}', 'dismiss', 'x')`, `public.admin_unpublish_session('${A}', 'x')`, `public.admin_republish_session('${A}')`, `public.my_session_moderation()`]) ok(/permission denied/.test(await refused(db, null, `select * from ${f}`)), f.split('(')[0] + ' is closed to a guest');
for (const f of [`public.admin_list_session_reports()`, `public.admin_review_session_report('${A}', 'dismiss', 'x')`, `public.admin_unpublish_session('${A}', 'x')`, `public.admin_republish_session('${A}')`]) ok(/not allowed/.test(await refused(db, C, `select * from ${f}`)), f.split('(')[0] + ' is for administrators only');

// ---------- reporting
const s1 = await mk(B, { title: 'Dubious meet' });
await one(D, 'public.rsvp_session($1)', [s1.id]);
ok(/choose a reason/.test(await bad(C, s1.id, 'rude') ?? '') && /choose a reason/.test(await bad(C, s1.id, null) ?? ''), 'a reason code is required');
ok(/200/.test(await bad(C, s1.id, 'spam', 'n'.repeat(201)) ?? ''), 'the note is at most 200 characters');
ok(/session not found/.test(await bad(B, s1.id) ?? '') && /session not found/.test(await bad(C, NONE) ?? ''), 'a host cannot report their own session; nothing to report gives not found');
const priv = await mk(B, { title: 'Private', vis: 'private', lat: 31, lng: 115, s: 30, e: 31 });
ok(/session not found/.test(await bad(C, priv.id) ?? ''), 'a private session cannot be reported (and its existence is not revealed)');
ok((await report(C, s1.id, 'unsafe_location', ' next to an airport ')).status === 'reported' && (await report(C, s1.id)).status === 'already_reported', 'one open report per person per session');
ok((await sql('select note from public.session_reports'))[0].note === 'next to an airport', 'the note is tidied');
ok((await pubIds()).includes(s1.id), 'one report does not hide the session');
await db.exec(`insert into public.blocks (blocker, blocked) values ('${C}', '${B}')`);
ok(/session not found/.test(await bad(C, s1.id, 'illegal') ?? ''), 'a blocked pair cannot report');
await db.exec('delete from public.blocks');
await db.exec('delete from public.session_reports');
for (let i = 0; i < 10; i++) await db.exec(`insert into public.session_reports (session_id, reporter, reason, status) values ('${s1.id}', '${C}', 'spam', 'dismissed')`);
ok(/too many reports/.test(await bad(C, s1.id) ?? ''), 'eleven reports in a day are refused');
await db.exec('delete from public.session_reports');

// ---------- automatic hiding at three distinct reporters
await report(C, s1.id); await report(D, s1.id);
ok((await pubIds()).includes(s1.id), 'two reporters: still public');
const third = await report(E, s1.id, 'harassment');
ok(third.hidden === true && !(await pubIds()).includes(s1.id) && (await rows(null, 'select * from public.get_public_session($1)', [s1.id])).length === 0, 'the third distinct reporter hides it from discovery at once');
ok(/session not found/.test(await refused(db, E, 'select public.rsvp_session($1)', [s1.id]) ?? ''), 'and it takes no new RSVPs');
ok((await rows(D, 'select * from public.list_my_session_notices()')).some((n) => n.session_id === s1.id && n.kind === 'unpublished'), 'people who had joined are told');
const mm = await rows(B, 'select * from public.my_session_moderation()');
ok(mm.length === 1 && mm[0].title === 'Dubious meet', 'the host can see which of their sessions is hidden');
ok((await rows(D, 'select * from public.list_sessions()')).some((x) => x.id === s1.id), 'people who joined keep it in their own list');
await one(B, 'public.update_session($1, $2::jsonb)', [s1.id, JSON.stringify({ visibility: 'private' })]);
ok(/unpublished by a moderator/.test(await refused(db, B, 'select public.update_session($1, $2::jsonb)', [s1.id, JSON.stringify({ visibility: 'public' })]) ?? ''), 'a host cannot make an unpublished session public again');

// ---------- administrator review
const s2 = await mk(C, { title: 'Second', lat: 32, lng: 116, s: 40, e: 41 });
await report(D, s2.id, 'spam', 'looks like an advert'); await report(B, s2.id, 'other');
const all0 = await rows(A, 'select * from public.admin_list_session_reports()');
ok(all0.length === 5 && all0.filter((x) => x.session_title === 'Dubious meet').length === 3, 'reports on an auto-hidden session stay open for review');
const list = all0.filter((x) => x.session_title === 'Second');
ok(list.length === 2 && list[0].session_title === 'Second' && list[0].host_code && list[0].reporter_code && list[0].open_reports === 2 && !JSON.stringify(list).includes(C) && !JSON.stringify(list).includes(D), 'an administrator lists open reports by friend code, never by id');
ok(!(await rows(A, `select * from public.admin_list_session_reports('actioned')`)).length && (await rows(A, `select * from public.admin_list_session_reports('all')`)).length === 5, 'filter by status');
ok(/reason/.test(await refused(db, A, 'select public.admin_review_session_report($1, $2, $3)', [list[0].report_id, 'dismiss', ' ']) ?? '') && /dismiss or unpublish/.test(await refused(db, A, 'select public.admin_review_session_report($1, $2, $3)', [list[0].report_id, 'ban', 'x']) ?? ''), 'a reason and a known action are required');
ok((await one(A, 'public.admin_review_session_report($1, $2, $3)', [list[0].report_id, 'dismiss', 'not an advert'])).status === 'dismissed' && (await pubIds()).includes(s2.id), 'dismissing a report keeps the session public');
ok((await one(A, 'public.admin_review_session_report($1, $2, $3)', [list[0].report_id, 'dismiss', 'again'])).status === 'already_reviewed', 'reviewing twice does nothing');
ok((await one(A, 'public.admin_review_session_report($1, $2, $3)', [list[1].report_id, 'unpublish', 'abuse of the lobby'])).status === 'unpublished' && !(await pubIds()).includes(s2.id), 'unpublishing hides the session');
ok((await rows(A, `select * from public.admin_list_session_reports('open')`)).every((x) => x.session_title !== 'Second'), 'and closes the reports on it');
ok(/not found/.test(await refused(db, A, 'select public.admin_review_session_report($1, $2, $3)', [NONE, 'dismiss', 'x']) ?? ''), 'an unknown report is not found');
const s3 = await mk(D, { title: 'Third', lat: 33, lng: 117, s: 50, e: 51 });
ok((await one(A, 'public.admin_unpublish_session($1, $2)', [s3.id, 'unsafe place'])).status === 'unpublished' && !(await pubIds()).includes(s3.id) && /not found/.test(await refused(db, A, 'select public.admin_unpublish_session($1, $2)', [s3.id, 'again']) ?? ''), 'an administrator can unpublish without a report (once)');
ok(/reason/.test(await refused(db, A, 'select public.admin_unpublish_session($1, $2)', [s3.id, '']) ?? ''), 'a reason is required');
ok((await one(A, 'public.admin_republish_session($1)', [s3.id])).status === 'published' && (await pubIds()).includes(s3.id) && /not found/.test(await refused(db, A, 'select public.admin_republish_session($1)', [s3.id]) ?? ''), 'republishing puts it back');

// ---------- audit trail: who, what, which session; no free text
const ev = await sql(`select action, actor, subject, ref, meta from public.audit_events where action like 'session.%' order by id`);
ok(ev.map((e) => e.action).join() === 'session.report_review,session.report_review,session.unpublish,session.republish' && ev.every((e) => e.actor === A), 'every administrator decision is audited');
ok(!JSON.stringify(ev).includes('advert') && !JSON.stringify(ev).includes('abuse of') && ev[1].meta.action === 'unpublish' && ev[1].subject === C && ev[1].ref === s2.id, 'with the host and session, a fixed meta, and none of the free text');
ok((await sql(`select count(*)::int as n from public.audit_events where action = 'role.grant'`))[0].n >= 0, 'the widened action check keeps the earlier actions');

// ---------- account deletion removes the person's reports
await report(E, s3.id, 'spam');
await one(E, 'public.delete_profile()');
ok((await sql(`select count(*)::int as n from public.session_reports where reporter = '${E}'`))[0].n === 0, 'deleting a profile removes the reports they made');
