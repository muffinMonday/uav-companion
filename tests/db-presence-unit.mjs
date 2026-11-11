// Online status and its access rules, tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const friends = (uid) => rows(uid, 'select * from public.list_friends()');
const seen = async (uid, name) => (await friends(uid)).find((f) => f.display_name === name);
const age = (uid, seconds) => db.exec(`update public.profiles set last_seen = now() - interval '${seconds} seconds' where user_id = '${uid}'`);
const lastSeen = async (uid) => (await db.query(`select last_seen from public.profiles where user_id = '${uid}'`)).rows[0].last_seen;

// ---------- nobody signed in
for (const fn of ['public.touch_presence()', 'public.set_show_online(true)']) {
  ok(/permission denied/.test(await refused(db, null, `select ${fn}`)), 'a visitor who is not signed in cannot call ' + fn.split('(')[0]);
}

// ---------- before there is a profile
ok((await one(A, 'public.touch_presence()')).status === 'no profile', 'someone with no profile yet records nothing');
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
ok((await one(A, 'public.ensure_profile()')).show_online === true, 'a profile shows its status by default');
// A is friends with B and D; C is a stranger
for (const other of [B, D]) { const r = await one(A, 'public.request_friend($1)', [(await one(other, 'public.ensure_profile()')).friend_code]); await one(other, 'public.respond_friend($1, true)', [r.id]); }
ok((await seen(A, 'Bea')).online === false && (await seen(A, 'Bea')).last_seen === null, 'a friend who has never been seen is offline, with no last seen');

// ---------- being seen
ok((await one(B, 'public.touch_presence()')).status === 'ok' && await lastSeen(B) !== null, 'touching records the time');
let bea = await seen(A, 'Bea');
ok(bea.online === true && bea.last_seen !== null, 'a friend sees them online');
ok((await seen(B, 'Alex')).online === false, 'and they see a friend who has not been seen as offline');
ok(!(await friends(C)).some((f) => f.display_name === 'Bea'), 'a stranger sees nothing of them');
ok(!Object.keys(bea).some((k) => /user|requester|addressee/.test(k)), 'no user id comes back: ' + Object.keys(bea).join(', '));

// ---------- throttling
const t1 = await lastSeen(B);
await one(B, 'public.touch_presence()');
ok(String(await lastSeen(B)) === String(t1), 'touching again within 15 seconds changes nothing');
await age(B, 20);
await one(B, 'public.touch_presence()');
ok(Date.now() - new Date(await lastSeen(B)).getTime() < 8000, 'after 15 seconds it records again');

// ---------- the 75 second window
await age(B, 60);
ok((await seen(A, 'Bea')).online === true, 'seen 60 seconds ago is still online');
await age(B, 80);
bea = await seen(A, 'Bea');
ok(bea.online === false && bea.last_seen !== null && Date.now() - new Date(bea.last_seen).getTime() > 70000, 'seen 80 seconds ago is offline, with the time of the last sighting');
await age(B, 3600);
ok(new Date(Date.now() - 3600 * 1000).getTime() - new Date((await seen(A, 'Bea')).last_seen).getTime() < 5000, 'an hour ago shows as an hour ago');

// ---------- requests show nothing
const E = await one(C, 'public.request_friend($1)', [(await one(A, 'public.ensure_profile()')).friend_code]);
const req = (await friends(A)).find((f) => f.status === 'incoming');
ok(req && req.online === null && req.last_seen === null, 'a pending request shows no status');
await one(A, 'public.respond_friend($1, false)', [E.id]);

// ---------- hiding
await one(B, 'public.touch_presence()');
ok((await one(B, 'public.set_show_online(false)')).show_online === false && await lastSeen(B) === null, 'hiding forgets the last time');
bea = await seen(A, 'Bea');
ok(bea.online === null && bea.last_seen === null, 'a friend who hides their status shows nothing to anyone');
ok((await one(B, 'public.touch_presence()')).status === 'hidden' && await lastSeen(B) === null, 'and touching records nothing while hidden');
await one(A, 'public.touch_presence()');
const alexForBea = await seen(B, 'Alex');
ok(alexForBea.online === null && alexForBea.last_seen === null, 'someone who hides theirs cannot see anyone else\'s either');
ok((await seen(B, 'Alex')).display_name === 'Alex', 'but their friends list is otherwise unchanged');
ok((await one(B, 'public.set_show_online(true)')).show_online === true && await lastSeen(B) !== null, 'showing again starts with now');
ok((await seen(A, 'Bea')).online === true && (await seen(B, 'Alex')).online === true, 'and both see each other again');
ok((await one(B, 'public.set_show_online(null)')).show_online === true, 'a missing answer means show');

// ---------- people in the same trip
const TRIP = '5a1c0000-0000-4000-8000-0000000000bb';
await one(A, 'public.share_trip($1::jsonb)', [JSON.stringify({ v: 1, trip: { id: TRIP, name: 'Hubei' }, items: [] })]);
const fid = async (uid, name) => (await friends(uid)).find((f) => f.display_name === name).id;
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, await fid(A, 'Bea')]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, await fid(A, 'Dee')]);
await one(B, 'public.touch_presence()'); await one(D, 'public.touch_presence()'); await one(A, 'public.touch_presence()');
const party = (uid) => rows(uid, 'select * from public.list_trip_members($1)', [TRIP]);
let pm = await party(A);
ok(pm.find((m) => m.display_name === 'Bea').online === true && pm.find((m) => m.is_me).online === true, 'the owner sees a joined member online, and their own status');
ok(pm.find((m) => m.display_name === 'Dee').status === 'invited' && pm.find((m) => m.display_name === 'Dee').online === null && pm.find((m) => m.display_name === 'Dee').last_seen === null, 'someone who is only invited shows nothing');
await one(D, 'public.respond_trip_invite($1, true)', [TRIP]);
pm = await party(B);
ok(pm.find((m) => m.display_name === 'Dee').online === true, 'two party members who are not friends see each other\'s status');
await one(D, 'public.set_show_online(false)');
pm = await party(B);
ok(pm.find((m) => m.display_name === 'Dee').online === null, 'a member who hides theirs shows nothing to the party');
pm = await party(D);
ok(pm.find((m) => m.display_name === 'Alex').online === null && pm.find((m) => m.is_me).online === false && pm.find((m) => m.is_me).last_seen === null, 'and cannot see the party\'s; their own row is there, offline');
ok(!Object.keys(pm[0]).some((k) => /user/.test(k)), 'the member list carries no user id either');
ok(/trip not found/.test(await refused(db, C, 'select * from public.list_trip_members($1)', [TRIP])), 'a stranger still cannot list a trip\'s members');
await db.close();
