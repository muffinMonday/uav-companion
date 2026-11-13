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

// ---------- two devices of one account: the newest to start sharing takes over
const dev = (uid, device, claim, lat = 30.5, lon = 114.3) => one(uid, 'public.share_location($1, $2, $3, 10, $4, $5)', [TRIP, lat, lon, device, claim]);
const posOf = async (uid) => (await db.query(`select lat, device from public.live_locations where user_id = '${uid}' and trip_id = '${TRIP}'`)).rows[0];
await db.exec(`delete from public.live_locations where user_id = '${D}'`);
ok((await dev(D, 'phone', true, 10, 10)).status === 'ok' && (await posOf(D)).device === 'phone', 'a device that starts sharing holds the position');
ok((await dev(D, 'laptop', false, 20, 20)).status === 'moved' && (await posOf(D)).lat === 10, 'a second device that did not claim is told "moved" and changes nothing');
ok((await dev(D, 'laptop', true, 20, 20)).status === 'ok' && (await posOf(D)).device === 'laptop' && (await posOf(D)).lat === 20, 'starting to share on the second device takes over at once (not held back by the 2 s limit)');
await age(D, 5);
ok((await dev(D, 'phone', false, 11, 11)).status === 'moved' && (await posOf(D)).lat === 20, 'the first device is now told "moved" and cannot overwrite');
ok((await dev(D, 'laptop', false, 21, 21)).status === 'ok' && (await dev(D, 'laptop', false, 22, 22)).status === 'slow', 'the holder keeps sending and keeps the 2 s limit');
await one(D, 'public.stop_sharing_location($1, $2)', [TRIP, 'phone']);
ok((await posOf(D))?.device === 'laptop', 'a stop from a device that does not hold the position does nothing');
await one(D, 'public.stop_all_sharing($1)', ['phone']);
ok((await posOf(D))?.device === 'laptop', 'and neither does stop everywhere');
await one(D, 'public.stop_all_sharing($1)', ['laptop']);
ok(!(await posOf(D)), 'the holder\'s stop removes it');
await dev(D, 'phone', true, 10, 10); await age(D, 5);
await one(D, 'public.stop_sharing_location($1)', [TRIP]);
ok(!(await posOf(D)), 'a stop without a device id (an older app) still removes it');
await share(D); await age(D, 5);
ok((await dev(D, 'laptop', false)).status === 'ok' && (await posOf(D)).device === 'laptop', 'a row without a device (older app) can be taken by a device without a claim');
ok(/not a device/.test(await refused(db, D, 'select public.share_location($1, 1, 1, 10, $2, false)', [TRIP, ''])), 'an empty device id is refused');
await db.exec(`delete from public.live_locations where user_id = '${D}'`);

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
// ---------- list_my_trips says how many others are sharing now (the app looks for positions only while this is above zero), and the clean-up of old positions
const TRIP3 = '5a1c0000-0000-4000-8000-0000000000ff';
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP3))]);
for (const [n, join, who] of [['Bea', true, B], ['Cam', false, C]]) { await one(A, 'public.invite_to_trip($1, $2)', [TRIP3, await fid(A, n)]); if (join) await one(who, 'public.respond_trip_invite($1, true)', [TRIP3]); }
const share3 = (uid) => one(uid, 'public.share_location($1, 30.5, 114.3, 12)', [TRIP3]);
const act = async (uid) => (await rows(uid, 'select * from public.list_my_trips()')).find((t) => t.id === TRIP3)?.live_active;
const age3 = (uid, seconds) => db.exec(`update public.live_locations set updated_at = now() - interval '${seconds} seconds' where user_id = '${uid}' and trip_id = '${TRIP3}'`);
await db.exec('delete from public.live_locations');
ok(await act(A) === 0 && await act(B) === 0, 'live_active is 0 when nobody is sharing');
await share3(A);
ok(await act(B) === 1, 'one other is sharing: the party sees 1');
ok(await act(A) === 0, 'the sharer does not count themself');
ok(await act(C) === 0, 'someone only invited sees 0');
await share3(B);
ok(await act(A) === 1 && await act(B) === 1, 'two sharing: each sees the other one');
await age3(A, 130);
ok(await act(B) === 0, 'a position older than 2 minutes does not count');
await db.exec('delete from public.live_locations');
await share3(A); await age3(A, 5); await share3(B);
ok(await count() === 2, 'recent positions are all kept');
await db.exec(`update public.live_locations set updated_at = now() - interval '11 minutes' where user_id = '${A}'`);
await age3(B, 5); await share3(B);
ok(await count() === 1, 'a position over 10 minutes old is removed by the next one sent');
await db.exec('delete from public.live_locations');
ok((await db.query("select count(*)::int as n from pg_indexes where indexname = 'live_locations_updated'")).rows[0].n === 1, 'there is an index on the position age');
await one(A, 'public.delete_shared_trip($1)', [TRIP3]);

// ---------- live locations for friends
const fshare = (uid, lat = 30.5, lon = 114.3, dev = null, claim = false) => one(uid, 'public.share_location_friends($1, $2, 12, $3, $4)', [lat, lon, dev, claim]);
const flive = (uid) => rows(uid, 'select * from public.list_friend_live_locations()');
const fcount = async () => (await db.query('select count(*)::int as n from public.friend_live_locations')).rows[0].n;
const fage = (uid, seconds) => db.exec(`update public.friend_live_locations set updated_at = now() - interval '${seconds} seconds' where user_id = '${uid}'`);
const befriend = async (a, b) => { const r = await one(a, 'public.request_friend($1)', [(await one(b, 'public.ensure_profile()')).friend_code]); await one(b, 'public.respond_friend($1, true)', [r.id]); };
await db.exec('delete from public.live_locations');
for (const fn of ['public.share_location_friends(1, 1)', 'public.list_friend_live_locations()', 'public.stop_sharing_friends()']) {
  ok(/permission denied/.test(await refused(db, null, `select * from ${fn}`)), 'a visitor who is not signed in cannot call ' + fn.split('(')[0]);
}
ok(/permission denied/.test(await refused(db, A, 'select * from public.friend_live_locations')), 'the friend positions cannot be read directly');
ok((await fshare(A)).status === 'ok', 'a person with friends sends a position to them');
ok(/not a position/.test(await refused(db, A, 'select public.share_location_friends(91, 10)')), 'a bad position is refused');
const fb = await flive(B);
ok(fb.length === 1 && fb[0].display_name === 'Alex' && !Object.keys(fb[0]).some((k) => /user/.test(k)) && fb[0].member_id === await fid(B, 'Alex'), 'a friend sees it, named by the friendship id and with no user id');
ok((await flive(A)).length === 0, 'the sharer does not see themself');
ok((await fshare(A)).status === 'slow', 'the 2 s limit applies');
ok((await flive(C)).length === 1, 'every accepted friend sees it');
await fage(A, 130);
ok((await flive(B)).length === 0, 'a position older than 2 minutes is not shown');
await fage(A, 5); await fshare(B);
ok(await fcount() === 2, 'recent positions are kept');
await db.exec(`update public.friend_live_locations set updated_at = now() - interval '11 minutes' where user_id = '${A}'`);
await fage(B, 5); await fshare(B);
ok(await fcount() === 1, 'a position over 10 minutes old is removed by the next one sent');
await db.exec('delete from public.friend_live_locations');
await fshare(A, 30.5, 114.3, 'phone', true);
ok((await fshare(A, 31, 115, 'laptop', false)).status === 'moved', 'a second device cannot send without claiming');
await fage(A, 5);
ok((await fshare(A, 31, 115, 'laptop', true)).status === 'ok', 'a device that has just started takes the position over');
await one(A, 'public.stop_sharing_friends($1)', ['phone']);
ok(await fcount() === 1, 'a stop from the device that does not hold it does nothing');
await one(A, 'public.stop_sharing_friends($1)', ['laptop']);
ok(await fcount() === 0, 'a stop from the holder deletes it');
await fshare(A);
await one(A, 'public.stop_all_sharing()');
ok(await fcount() === 0, 'stop_all_sharing also stops the friend position');
await fshare(A);
await one(A, 'public.remove_friendship($1)', [await fid(A, 'Bea')]);
ok((await flive(B)).length === 0 && (await flive(C)).length === 1, 'a removed friend no longer sees the position, the others still do');
await befriend(A, B);
ok((await flive(B)).length === 1, 'a new friendship shows it again');
await one(B, 'public.block_user($1)', [await fid(B, 'Alex')]);
ok((await flive(B)).length === 0, 'a friend who blocked the sharer sees nothing');
await db.exec(`delete from public.blocks`);
await befriend(A, B);
// a friend who is also in the party is shown as party only
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP))]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, await fid(A, 'Bea')]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
await fage(A, 5); await fshare(A); await share(A);
ok((await flive(B)).length === 0 && (await live(B)).length === 1, 'a friend who is also in the party is shown as party, not twice');
ok((await flive(C)).length === 1, 'a friend outside the party still sees the friend position');
await one(A, 'public.delete_shared_trip($1)', [TRIP]);
// online_others in list_my_trips
const TRIP4 = '5a1c0000-0000-4000-8000-0000000000a4';
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP4))]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP4, await fid(A, 'Bea')]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP4]);
const onl = async (uid) => (await rows(uid, 'select * from public.list_my_trips()')).find((t) => t.id === TRIP4)?.online_others;
const seenAgo = (uid, s) => db.exec(`update public.profiles set last_seen = now() - interval '${s} seconds' where user_id = '${uid}'`);
await seenAgo(A, 5); await seenAgo(B, 400);
ok(await onl(A) === 0 && await onl(B) === 1, 'online_others counts only the others who are online (A sees nobody, B sees A)');
await seenAgo(B, 20);
ok(await onl(A) === 1 && await onl(B) === 1, 'one other member online: each sees 1');
await db.exec(`update public.profiles set show_online = false where user_id = '${B}'`);
ok(await onl(A) === 0 && await onl(B) === 0, 'someone who hides their status is not counted, and counts nobody');
await db.exec(`update public.profiles set show_online = true where user_id = '${B}'`);
await seenAgo(B, 80);
ok(await onl(A) === 0, 'seen 80 seconds ago is offline');
await one(A, 'public.delete_shared_trip($1)', [TRIP4]);
await fshare(A);
await one(A, 'public.delete_profile()');
ok(await fcount() === 0, 'deleting the profile removes the friend position');
await one(A, 'public.ensure_profile($1)', ['Alex']);

await one(A, 'public.share_trip($1::jsonb)', [J(docOf(TRIP))]);
await one(A, 'public.share_location($1, 1, 1)', [TRIP]);
await db.exec(`delete from auth.users where id = '${A}'`);
ok(await count() === 0, 'deleting an account deletes its positions');
await db.close();
