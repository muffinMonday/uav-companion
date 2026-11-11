// Live locations and their access rules, tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const J = JSON.stringify;
const TRIP = '5a1c0000-0000-4000-8000-0000000000cc', TRIP2 = '5a1c0000-0000-4000-8000-0000000000dd';
const share = (uid, lat = 30.5, lon = 114.3, acc = 12) => one(uid, 'public.share_location($1, $2, $3, $4)', [TRIP, lat, lon, acc]);
const live = (uid) => rows(uid, 'select * from public.list_live_locations()');
const age = (uid, seconds, trip = TRIP) => db.exec(`update public.live_locations set updated_at = now() - interval '${seconds} seconds' where user_id = '${uid}' and trip_id = '${trip}'`);
const count = async () => (await db.query('select count(*)::int as n from public.live_locations')).rows[0].n;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// a trip with A (owner), B and D (party members) and C (invited only); a stranger E is not set up
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
for (const other of [B, C, D]) { const r = await one(A, 'public.request_friend($1)', [(await one(other, 'public.ensure_profile()')).friend_code]); await one(other, 'public.respond_friend($1, true)', [r.id]); }
const docOf = (id, endDate) => ({ v: 1, trip: { id, name: 'Hubei', ...(endDate && { endDate, startDate: endDate }) }, items: [] });
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP))]);
const fid = async (uid, name) => (await rows(uid, 'select * from public.list_friends()')).find((f) => f.display_name === name).id;
for (const [n, join] of [['Bea', true], ['Dee', true], ['Cam', false]]) {
  await one(A, 'public.invite_to_trip($1, $2)', [TRIP, await fid(A, n)]);
  if (join) await one({ Bea: B, Dee: D }[n], 'public.respond_trip_invite($1, true)', [TRIP]);
}

// ---------- nobody signed in, and no direct access
for (const fn of [`public.share_location('${TRIP}', 1, 1)`, 'public.list_live_locations()', `public.stop_sharing_location('${TRIP}')`, 'public.stop_all_sharing()']) {
  ok(/permission denied/.test(await refused(db, null, `select * from ${fn}`)), 'a visitor who is not signed in cannot call ' + fn.split('(')[0]);
}
ok(/permission denied/.test(await refused(db, A, 'select * from public.live_locations')) && /permission denied/.test(await refused(db, A, 'delete from public.live_locations')), 'a signed-in user cannot read or change the table directly');

// ---------- who may send a position
ok(/trip not found/.test(await refused(db, C, 'select public.share_location($1, 1, 1)', [TRIP])), 'someone who is only invited cannot send a position');
ok(/trip not found/.test(await refused(db, (await db.query("select '00000000-0000-0000-0000-0000000000ee'::uuid as u")).rows[0].u, 'select public.share_location($1, 1, 1)', [TRIP])), 'nor can a stranger');
ok((await share(A)).status === 'ok' && (await share(B, 30.6, 114.4)).status === 'ok', 'joined members send their positions');

// ---------- what is accepted
for (const [what, args] of [['a latitude over 90', [91, 10]], ['a latitude under -90', [-91, 10]], ['a longitude over 180', [10, 181]], ['a longitude under -180', [10, -181]], ['no latitude', [null, 10]], ['no longitude', [10, null]], ['a latitude that is not a number', ['NaN', 10]]]) {
  ok(/not a position/.test(await refused(db, D, 'select public.share_location($1, $2::float8, $3::float8)', [TRIP, ...args])), 'a position with ' + what + ' is refused');
}
ok((await one(D, 'public.share_location($1, 10, 10, -5)', [TRIP])).status === 'ok' && (await db.query(`select accuracy from public.live_locations where user_id = '${D}'`)).rows[0].accuracy === null, 'an accuracy that makes no sense is simply left out');
ok((await one(D, 'public.share_location($1, -90, 180)', [TRIP])).status === 'slow', 'the limits themselves are valid positions (here held back by the 2 s limit)');

// ---------- the 2 second limit
await age(B, 5);
const first = (await rows(A, 'select * from public.list_live_locations()')).find((l) => l.display_name === 'Bea');
ok((await share(B, 31, 115)).status === 'ok' && (await share(B, 32, 116)).status === 'slow', 'a second position within 2 seconds is held back');
const kept = (await live(A)).find((l) => l.display_name === 'Bea');
ok(kept.lat === 31 && kept.lon === 115, 'and the first one stays');
await age(B, 3);
await share(B, 32, 116);
ok((await live(A)).find((l) => l.display_name === 'Bea').lat === 32, 'after 2 seconds the next one replaces it (one row per person, no history)');
ok(await count() === 3 && first, 'only the latest position is kept (' + await count() + ' rows)');

// ---------- who sees what
let la = await live(A);
ok(la.length === 2 && la.every((l) => l.display_name !== 'Alex'), 'the owner sees the other two sharers and not themselves');
ok(!Object.keys(la[0]).some((k) => /user/.test(k)) && typeof la[0].member_id === 'string' && la[0].trip_id === TRIP, 'with a member id and no user id: ' + Object.keys(la[0]).join(', '));
const members = await rows(A, 'select * from public.list_trip_members($1)', [TRIP]);
ok(la.every((l) => members.some((m) => m.member_id === l.member_id && m.display_name === l.display_name)), 'the member id is the one list_trip_members gives');
ok((await live(B)).map((l) => l.display_name).sort().join() === 'Alex,Dee', 'a party member sees the others, not themselves');
ok((await live(C)).length === 0, 'someone who is only invited sees nothing');
ok((await rows((await db.query("select '00000000-0000-0000-0000-0000000000ee'::uuid as u")).rows[0].u, 'select * from public.list_live_locations()')).length === 0, 'a stranger sees nothing');
ok(la.every((l) => l.age_seconds >= 0 && l.age_seconds < 30 && typeof l.accuracy === 'number' || l.accuracy === null), 'each position says how old it is');

// ---------- old positions
await age(D, 130);
ok((await live(A)).map((l) => l.display_name).join() === 'Bea', 'a position older than 2 minutes is no longer shown');
await db.exec(`update public.live_locations set updated_at = now() - interval '11 minutes' where user_id = '${D}'`);
await age(A, 5); await share(A);
ok(await count() === 2, 'one older than 10 minutes is deleted by the next position anyone sends (' + await count() + ' rows)');

// ---------- a second trip: positions go only to its own party
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP2))]);
await age(A, 5); await age(B, 5);
await one(A, 'public.share_location($1, 40, 100)', [TRIP2]);
ok((await live(B)).every((l) => l.trip_id === TRIP) && (await live(B)).length === 1, 'a position in a trip someone is not in is not shown to them');
await one(A, 'public.stop_sharing_location($1)', [TRIP2]);

// ---------- a trip that ended
await one(A, 'public.save_shared_trip($1, $2::jsonb, 1)', [TRIP, J(docOf(TRIP, day(-2)))]);
await age(A, 5);
ok((await share(A)).status === 'ended' && !(await live(B)).some((l) => l.display_name === 'Alex'), 'sharing stops by itself more than a day after the trip ends, and the position is removed');
const rev = (await one(A, 'public.get_shared_trip($1)', [TRIP])).rev;
await one(A, 'public.save_shared_trip($1, $2::jsonb, $3)', [TRIP, J(docOf(TRIP, day(-1))), rev]);
ok((await share(A)).status === 'ok', 'the day after the end date is still allowed');
await one(A, 'public.save_shared_trip($1, $2::jsonb, $3)', [TRIP, J(docOf(TRIP, day(3))), rev + 1]);

// ---------- stopping
await age(B, 5);
await one(B, 'public.stop_sharing_location($1)', [TRIP]);
ok(!(await live(A)).some((l) => l.display_name === 'Bea'), 'stopping removes the position at once');
await age(B, 5); await share(B);
await one(B, 'public.stop_all_sharing()');
ok(!(await live(A)).some((l) => l.display_name === 'Bea'), 'stop everywhere does too');

// ---------- leaving and removal end it
await age(B, 5); await share(B); await share(D);
ok((await live(A)).length >= 1, 'two members are sharing again');
await one(B, 'public.leave_trip($1)', [TRIP]);
ok((await db.query(`select count(*)::int as n from public.live_locations where user_id = '${B}'`)).rows[0].n === 0, 'a member who leaves stops sharing at once');
const dMember = (await rows(A, 'select * from public.list_trip_members($1)', [TRIP])).find((m) => m.display_name === 'Dee').member_id;
await one(A, 'public.remove_member($1, $2)', [TRIP, dMember]);
ok((await db.query(`select count(*)::int as n from public.live_locations where user_id = '${D}'`)).rows[0].n === 0 && !(await live(A)).some((l) => l.display_name === 'Dee'), 'and so does one the owner removes');

// ---------- deleting the trip or the account
await age(A, 5); await share(A);
await one(A, 'public.delete_shared_trip($1)', [TRIP]);
ok(await count() === 0, 'deleting the trip deletes the positions');
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP))]);
await one(A, 'public.share_location($1, 1, 1)', [TRIP]);
await db.exec(`delete from auth.users where id = '${A}'`);
ok(await count() === 0, 'deleting an account deletes its positions');
await db.close();
