// Flight Sessions: XP badge field and the attendee list with Add friend (supabase/migrations/20261119100000_sessions_people_xp.sql). Real Postgres (PGlite), several users, no browser.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const E = '55555555-5555-5555-5555-555555555555';

await db.exec(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee'], [E, 'Eli']]) await one(u, 'public.ensure_profile($1)', [n]);
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
const code = (u) => one(u, 'public.ensure_profile()').then((p) => p.friend_code);
await one(A, `public.grant_role($1, 'organiser')`, [await code(B)]);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);

let n = 0;
const mk = (u, o = {}) => one(u, 'public.create_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [o.title ?? 'Session ' + ++n, null, 'East Lake', 30 + n * 0.1, 114, o.s ?? hr(24 + n * 5), o.e ?? hr(26 + n * 5), 'Asia/Shanghai', o.vis ?? 'public', o.cap ?? null]).then((r) => r.id);
const people = (u, id, l = 30, o = 0) => rows(u, 'select * from public.list_session_participants($1, $2, $3)', [id, l, o]);
const pubRow = async (u, id) => (await rows(u, 'select * from public.list_public_sessions()')).find((r) => r.id === id);
const J = JSON.stringify;

// ---------- xp_reward: the database says what a session can pay
const bS = await mk(B), cS = await mk(C), aS = await mk(A);
ok((await pubRow(null, bS)).xp_reward === 50 && (await pubRow(null, aS)).xp_reward === 50, 'a session hosted by an organiser or an administrator pays 50 (attendance_xp), for guests too');
ok((await pubRow(null, cS)).xp_reward === null, 'an ordinary host: no XP possible (null)');
ok((await rows(null, 'select * from public.get_public_session($1)', [bS]))[0].xp_reward === 50 && (await rows(null, 'select * from public.get_public_session($1)', [cS]))[0].xp_reward === null, 'get_public_session carries it');
ok((await rows(C, 'select * from public.list_sessions()')).find((r) => r.id === bS).xp_reward === 50 && (await rows(C, 'select * from public.list_sessions()')).find((r) => r.id === cS).xp_reward === null, 'list_sessions carries it');
await db.exec(`update public.progression_settings set value = 0 where key = 'attendance_xp'`);
ok((await pubRow(null, bS)).xp_reward === null, 'attendance_xp 0 means no XP is possible: null, not 0');
await db.exec(`update public.progression_settings set value = 75 where key = 'attendance_xp'`);
ok((await pubRow(null, bS)).xp_reward === 75, 'the amount follows the setting, never a constant');
await db.exec(`update public.progression_settings set value = 50 where key = 'attendance_xp'`);
await db.exec(`update public.progression_settings set value = 1 where key = 'auto_attendance_enabled'`);
ok((await pubRow(null, cS)).xp_reward === 50, 'with automatic attendance on, any host\'s session can pay');
await db.exec(`update public.progression_settings set value = 0 where key = 'auto_attendance_enabled'`);
ok((await pubRow(null, cS)).xp_reward === null, 'and off again: none');
ok(/permission denied/.test(await refused(db, C, 'select public.session_xp_reward($1)', [bS])), 'session_xp_reward is internal');

// ---------- the opt-out switch
ok(await one(C, 'public.get_show_in_attendee_lists()') === true, 'the list switch is on by default');
ok(await one(C, 'public.set_show_in_attendee_lists($1)', [false]) === false && await one(C, 'public.get_show_in_attendee_lists()') === false, 'it can be switched off');
await one(C, 'public.set_show_in_attendee_lists($1)', [true]);
ok(/permission denied/.test(await refused(db, null, 'select public.get_show_in_attendee_lists()')) && /permission denied/.test(await refused(db, null, 'select public.set_show_in_attendee_lists(true)')), 'guests cannot touch it');

// ---------- the list: a public session hosted by C, joined by B and D
await one(B, 'public.rsvp_session($1)', [cS]); await one(D, 'public.rsvp_session($1)', [cS]);
let l = await people(null, cS);
ok(l.length === 3 && l[0].is_host && l[0].display_name === 'Cam' && l.every((r) => r.total === 3) && l.map((r) => r.display_name).join() === 'Cam,Bea,Dee', 'a guest sees the host first, then the people, with the total');
ok(l.every((r) => r.relation === 'none' && r.friendship_id === null), 'a guest has no relations');
const keys = Object.keys(l[0]).sort().join();
ok(keys === 'avatar,display_name,friendship_id,handle,is_host,relation,total', 'only these columns, no user id and no RSVP id: ' + keys);
const rs = await sql('select id, user_id from public.session_rsvps where session_id = $1', [cS]);
ok(l.every((r) => !rs.some((x) => x.id === r.handle || x.user_id === r.handle) && ![A, B, C, D].includes(r.handle)) && new Set(l.map((r) => r.handle)).size === 3, 'handles are random, per person, and are neither an RSVP id nor a user id');
ok(J((await people(null, cS)).map((r) => r.handle)) === J(l.map((r) => r.handle)), 'a handle is stable between calls');
const other = await mk(C); await one(D, 'public.rsvp_session($1)', [other]);
ok((await people(null, other)).find((r) => r.display_name === 'Dee').handle !== l.find((r) => r.display_name === 'Dee').handle, 'and differs between sessions');
l = await people(D, cS);
ok(l.find((r) => r.display_name === 'Dee').relation === 'self' && l.find((r) => r.display_name === 'Bea').relation === 'none', 'a signed-in viewer sees themselves as self');
ok((await people(null, cS, 1, 1)).length === 1 && (await people(null, cS, 1, 1))[0].display_name === 'Bea' && (await people(null, cS, 1000, 0)).length === 3 && (await people(null, cS, 0, -5)).length === 1, 'pages: size and offset are capped');
ok((await people(null, '00000000-0000-0000-0000-000000000000')).length === 0, 'an unknown session gives nothing');

// friend and pending
const fr = await one(C, 'public.request_friend($1)', [await code(D)]);
ok((await people(D, cS)).find((r) => r.display_name === 'Cam').relation === 'pending' && (await people(C, cS)).find((r) => r.display_name === 'Dee').relation === 'pending', 'a pending request shows as pending to both');
await one(D, 'public.respond_friend($1, true)', [fr.id]);
l = await people(D, cS); const cam = l.find((r) => r.display_name === 'Cam');
ok(cam.relation === 'friend' && cam.friendship_id === fr.id, 'a friend is a friend, with the viewer\'s own friendship id');
ok((await people(C, cS)).find((r) => r.display_name === 'Dee').friendship_id === fr.id, 'and the other side sees the same row id (their own friendship)');

// opt-out, host exempt
await one(D, 'public.set_show_in_attendee_lists($1)', [false]);
ok((await people(B, cS)).map((r) => r.display_name).join() === 'Cam,Bea' && (await people(D, cS)).some((r) => r.display_name === 'Dee' && r.relation === 'self') && (await people(null, cS)).length === 2, 'someone who opted out is hidden from others and still sees themselves');
await one(C, 'public.set_show_in_attendee_lists($1)', [false]);
ok((await people(null, cS))[0].display_name === 'Cam', 'a host who opted out is still shown as the host of a public session');
await one(C, 'public.set_show_in_attendee_lists($1)', [true]); await one(D, 'public.set_show_in_attendee_lists($1)', [true]);

// blocks hide both ways
await db.exec(`insert into public.blocks (blocker, blocked) values ('${B}', '${D}')`);
ok(!(await people(B, cS)).some((r) => r.display_name === 'Dee') && !(await people(D, cS)).some((r) => r.display_name === 'Bea'), 'a blocked pair does not see each other (both ways)');
ok((await people(C, cS)).length === 3, 'a third person still sees both');
await db.exec(`delete from public.blocks`);
await db.exec(`insert into public.blocks (blocker, blocked) values ('${D}', '${C}')`);
ok((await people(D, cS)).length === 0 && !(await people(C, cS)).some((r) => r.display_name === 'Dee'), 'a viewer who blocked the host gets nothing, and the host no longer sees them');
await db.exec(`delete from public.blocks`);

// private sessions: joined people only
const pv = await mk(C, { vis: 'private' }); await one(D, 'public.rsvp_session($1)', [pv]).catch(() => null);
ok((await people(null, pv)).length === 0 && (await people(E, pv)).length === 0, 'a private session lists no one to a guest or a stranger');
const inv = await one(C, 'public.create_session_link($1, $2, $3, $4)', [pv, 'occurrence', 24, 5]);
await one(E, 'public.redeem_session_link($1)', [inv.token ?? inv.url ?? '']).catch(() => null);
await db.exec(`insert into public.session_rsvps (session_id, user_id) values ('${pv}', '${B}') on conflict do nothing`);
ok((await people(B, pv)).length >= 2 && (await people(C, pv)).length >= 2 && (await people(A, pv)).length >= 2, 'the host, someone who joined and an administrator see it');
ok((await people(E, pv)).length === 0, 'an invited person who has not joined sees nothing');

// cancelled sessions list no one
const cx = await mk(C); await one(D, 'public.rsvp_session($1)', [cx]); await one(C, 'public.cancel_session($1)', [cx]);
ok((await people(D, cx)).length === 0, 'a cancelled session lists no one');

// ---------- Add friend from a session
const hs = async (u, id, name) => (await people(u, id)).find((r) => r.display_name === name).handle;
const hB = await hs(E, cS, 'Bea');
ok(/permission denied/.test(await refused(db, null, 'select public.request_friend_from_session($1, $2)', [cS, hB])), 'a guest cannot add friends');
let r = await one(E, 'public.request_friend_from_session($1, $2)', [cS, hB]);
ok(r.status === 'pending' && (await sql(`select 1 from public.friendships where requester = '${E}' and addressee = '${B}' and status = 'pending'`)).length === 1, 'Add friend sends a request, answered "pending"');
r = await one(E, 'public.request_friend_from_session($1, $2)', [cS, hB]);
ok(r.status === 'pending' && (await sql(`select 1 from public.friendships where requester = '${E}' and addressee = '${B}'`)).length === 1, 'asking again changes nothing');
await db.exec(`insert into public.session_rsvps (session_id, user_id) values ('${cS}', '${E}') on conflict do nothing`);
r = await one(B, 'public.request_friend_from_session($1, $2)', [cS, await hs(B, cS, 'Eli')]);
ok(r.status === 'friends', 'when they asked first, adding them accepts: friends');
ok((await one(B, 'public.request_friend_from_session($1, $2)', [cS, await hs(B, cS, 'Eli')])).status === 'friends', 'and asking again reports friends');
// not accepting requests, blocked: the same answer, nothing created
await one(C, 'public.set_accepts_requests($1)', [false]);
const hC = await hs(E, cS, 'Cam');
r = await one(E, 'public.request_friend_from_session($1, $2)', [cS, hC]);
ok(r.status === 'pending' && (await sql(`select 1 from public.friendships where requester = '${E}' and addressee = '${C}'`)).length === 0, 'a person who takes no requests gives the same answer and nothing is created');
await one(C, 'public.set_accepts_requests($1)', [true]);
await db.exec(`insert into public.blocks (blocker, blocked) values ('${C}', '${E}')`);
r = await one(E, 'public.request_friend_from_session($1, $2)', [cS, hC]).catch((e) => String(e.message));
ok(/not found/.test(String(r)) || r.status === 'pending', 'a blocked requester gets a uniform refusal or pending');
ok((await sql(`select 1 from public.friendships where requester = '${E}' and addressee = '${C}'`)).length === 0, 'and no request is created');
await db.exec(`delete from public.blocks`);
// wrong handle, other session, self, opt-out after the handle was seen, private
const bad = (u, id, h) => refused(db, u, 'select public.request_friend_from_session($1, $2)', [id, h]);
ok(/not found/.test(await bad(E, cS, '00000000-0000-0000-0000-000000000000')), 'an unknown handle is not found');
ok(/not found/.test(await bad(E, bS, hC)), 'a handle from another session is not found');
ok(/not found/.test(await bad(E, cS, await hs(E, cS, 'Eli').catch(() => '00000000-0000-0000-0000-000000000001'))), 'one\'s own handle is not found');
const hD = await hs(E, cS, 'Dee');
await one(D, 'public.set_show_in_attendee_lists($1)', [false]);
ok(/not found/.test(await bad(E, cS, hD)), 'a handle seen before the person opted out no longer works');
await one(D, 'public.set_show_in_attendee_lists($1)', [true]);
ok(/not found/.test(await bad(E, pv, hB)), 'a private session\'s handles do not work for outsiders');

// ---------- the rate limit and the closed tables
await db.exec(`delete from public.people_list_rate`);
let limited = null;
for (let i = 0; i < 65 && !limited; i++) limited = await refused(db, A, 'select count(*) from public.list_session_participants($1)', [cS]);
ok(/too many requests/.test(limited ?? ''), 'a person asking too often is told to wait');
for (const t of ['session_participant_handles', 'people_list_rate']) ok(/permission denied/.test(await refused(db, C, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' is closed to clients');
for (const f of ['public.people_list_throttle($1)', 'public.session_people_visible($1, $1)']) ok(/permission denied/.test(await refused(db, C, `select ${f}`.replace(/\$1/g, `'${C}'`))), f.split('(')[0] + ' is internal');

// ---------- deleting a profile drops the handles
await db.exec(`delete from public.people_list_rate`);
ok((await sql(`select 1 from public.session_participant_handles where user_id = '${D}'`)).length > 0, 'handles exist for D');
await one(D, 'public.delete_profile()');
ok((await sql(`select 1 from public.session_participant_handles where user_id = '${D}'`)).length === 0, 'delete_profile removes the person\'s handles');
ok(!(await people(null, cS)).some((r) => r.display_name === 'Dee'), 'and they are gone from the list');
await db.close();
