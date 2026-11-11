// Profiles, friend codes, requests and blocks, with their access rules, tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const call = async (uid, sql, params = []) => (await as(db, uid, sql, params));
const one = async (uid, sql, params = []) => (await call(uid, `select ${sql} as r`, params))[0].r;
const profile = (uid, name) => one(uid, name === undefined ? 'public.ensure_profile()' : 'public.ensure_profile($1)', name === undefined ? [] : [name]);
const friends = (uid) => call(uid, 'select * from public.list_friends()');
const NOT_FOUND = /that code was not found/;

// ---------- nobody signed in
for (const fn of ['public.ensure_profile()', 'public.list_friends()', `public.request_friend('aaaaaaaaaa')`, 'public.list_blocked()', 'public.delete_profile()', 'public.regenerate_friend_code()', `public.set_accepts_requests(false)`]) {
  ok(/permission denied/.test(await refused(db, null, `select * from ${fn}`)), 'a visitor who is not signed in cannot call ' + fn);
}
for (const t of ['profiles', 'friendships', 'blocks']) {
  ok(/permission denied/.test(await refused(db, null, `select * from public.${t}`)), 'nor read the ' + t + ' table');
  ok(/permission denied/.test(await refused(db, A, `select * from public.${t}`)), 'and a signed-in user cannot read the ' + t + ' table directly either');
  ok(/permission denied/.test(await refused(db, A, `delete from public.${t}`)), 'or delete from it');
}
ok(/permission denied/.test(await refused(db, A, `insert into public.profiles (user_id, display_name, friend_code) values ('${A}', 'x', 'aaaaaaaaaa')`)), 'or write a profile directly');
ok(/permission denied/.test(await refused(db, A, `select public.clean_display_name('x')`)), 'the internal helper is not callable through the API');

// ---------- profiles
let pa = await profile(A);
ok(pa.display_name === 'Pilot' && /^[0-9a-f]{10}$/.test(pa.friend_code) && pa.accepts_requests === true, 'the first call creates a profile with a default name and a 10-character code: ' + JSON.stringify(pa));
ok((await profile(A)).friend_code === pa.friend_code, 'calling again changes nothing');
ok((await profile(A, '  Alex   the   Pilot ')).display_name === 'Alex the Pilot', 'a name is tidied (spaces collapsed)');
ok((await profile(A, 'Al\u0007e\nx\t')).display_name === 'Alex', 'control characters are removed');
ok(/1 to 40/.test(await refused(db, A, `select public.ensure_profile('   ')`)) && /1 to 40/.test(await refused(db, A, `select public.ensure_profile($1)`, ['x'.repeat(41)])), 'an empty name or one over 40 characters is refused');
ok((await profile(A, 'Alex')).display_name === 'Alex' && (await profile(A)).display_name === 'Alex', 'the name sticks');
const pb = await profile(B, 'Bea');
ok(pb.friend_code !== pa.friend_code && (await profile(A)).display_name === 'Alex', 'another user gets their own code and does not change anyone else\'s profile');
await profile(C, 'Cam'); await profile(D, 'Dee');

// ---------- requests: unknown, malformed, own, off
for (const [what, code] of [['an unknown code', 'ffffffffff'], ['a malformed code', 'zzz'], ['an empty code', ''], ['your own code', (await profile(A)).friend_code]]) {
  ok(NOT_FOUND.test(await refused(db, A, 'select public.request_friend($1)', [code])), what + ' gives "that code was not found"');
}
ok(NOT_FOUND.test(await refused(db, A, 'select public.request_friend($1)', [null])), 'and so does no code at all');
await one(D, 'public.set_accepts_requests(false)');
const dcode = (await profile(D)).friend_code;
const dMsg = await refused(db, A, 'select public.request_friend($1)', [dcode]);
const unknownMsg = await refused(db, A, 'select public.request_friend($1)', ['ffffffffff']);
ok(dMsg === unknownMsg, 'a code whose owner switched requests off gives exactly the same answer as an unknown one (nothing to learn by trying)');
ok(!(await refused(db, null, 'select 1')) && (await friends(D)).length === 0, 'and the owner sees nothing');
await one(D, 'public.set_accepts_requests(true)');

// ---------- a request, as both sides see it
const bcode = pb.friend_code;
let r = await one(A, 'public.request_friend($1)', [bcode.slice(0, 5).toUpperCase() + '-' + bcode.slice(5).toUpperCase()]);
ok(r.status === 'pending' && typeof r.id === 'string', 'a code typed in capitals with a dash still works: ' + r.status);
const fid = r.id;
let la = await friends(A), lb = await friends(B);
ok(la.length === 1 && la[0].status === 'outgoing' && la[0].display_name === 'Bea' && la[0].id === fid, 'the sender sees an outgoing request with the other person\'s name');
ok(lb.length === 1 && lb[0].status === 'incoming' && lb[0].display_name === 'Alex' && lb[0].id === fid, 'the receiver sees it as incoming with the sender\'s name');
ok((await friends(C)).length === 0 && (await call(C, 'select * from public.list_blocked()')).length === 0, 'a third person sees nothing');
ok(!('user_id' in la[0]) && !Object.keys(la[0]).some((k) => /user|requester|addressee/.test(k)), 'no user id is returned: ' + Object.keys(la[0]).join(', '));
r = await one(A, 'public.request_friend($1)', [bcode]);
ok(r.status === 'pending' && r.id === fid && (await friends(A)).length === 1, 'asking again changes nothing');
ok(/request not found/.test(await refused(db, A, 'select public.respond_friend($1, true)', [fid])), 'the sender cannot accept their own request');
ok(/request not found/.test(await refused(db, C, 'select public.respond_friend($1, true)', [fid])) && /not found/.test(await refused(db, C, 'select public.remove_friendship($1)', [fid])), 'a third person can neither answer it nor remove it');

// ---------- accepting
r = await one(B, 'public.respond_friend($1, true)', [fid]);
ok(r.status === 'friends', 'the receiver accepts');
la = await friends(A); lb = await friends(B);
ok(la[0].status === 'friends' && lb[0].status === 'friends' && la[0].display_name === 'Bea' && lb[0].display_name === 'Alex', 'both now see a friend');
ok((await one(A, 'public.request_friend($1)', [bcode])).status === 'friends' && (await friends(A)).length === 1, 'asking a friend again says they are friends and adds nothing');
ok(/request not found/.test(await refused(db, B, 'select public.respond_friend($1, true)', [fid])), 'an accepted request cannot be answered again');
await profile(B, 'Beatrice');
ok((await friends(A))[0].display_name === 'Beatrice', 'a changed display name shows up for friends');

// ---------- the other way round: both ask, so it is accepted
const ccode = (await profile(C)).friend_code, acode = (await profile(A)).friend_code;
r = await one(C, 'public.request_friend($1)', [acode]);
r = await one(A, 'public.request_friend($1)', [ccode]);
ok(r.status === 'friends' && (await friends(C)).find((f) => f.display_name === 'Alex')?.status === 'friends', 'when the person you ask had already asked you, you become friends at once');

// ---------- ending things
r = await one(D, 'public.request_friend($1)', [acode]);
ok((await friends(A)).some((f) => f.status === 'incoming' && f.display_name === 'Dee'), 'a request from a fourth person arrives');
ok((await one(A, 'public.respond_friend($1, false)', [r.id])).status === 'declined' && !(await friends(A)).some((f) => f.display_name === 'Dee') && (await friends(D)).length === 0, 'declining removes it on both sides');
r = await one(D, 'public.request_friend($1)', [acode]);
await one(D, 'public.remove_friendship($1)', [r.id]);
ok((await friends(A)).every((f) => f.display_name !== 'Dee'), 'the sender can cancel a request');
await one(A, 'public.remove_friendship($1)', [fid]);
ok((await friends(A)).every((f) => f.display_name !== 'Beatrice') && (await friends(B)).length === 0, 'either side can end a friendship, and it ends for both');
ok((await one(B, 'public.request_friend($1)', [acode])).status === 'pending', 'afterwards they can ask again');
await one(A, 'public.respond_friend($1, true)', [(await friends(A)).find((f) => f.display_name === 'Beatrice').id]);

// ---------- blocking
const fAB = (await friends(A)).find((f) => f.display_name === 'Beatrice').id;
ok((await one(A, 'public.block_user($1)', [fAB])).status === 'blocked' && (await friends(A)).every((f) => f.display_name !== 'Beatrice') && (await friends(B)).length === 0, 'blocking ends the friendship on both sides');
ok(NOT_FOUND.test(await refused(db, B, 'select public.request_friend($1)', [acode])), 'the blocked person asking gets "that code was not found" and is not told they are blocked');
const bl = await call(A, 'select * from public.list_blocked()');
ok(bl.length === 1 && bl[0].display_name === 'Beatrice' && !('blocked' in bl[0]), 'the blocker sees who they blocked');
ok((await call(B, 'select * from public.list_blocked()')).length === 0, 'the blocked person sees no block');
ok(/unblock them first/.test(await refused(db, A, 'select public.request_friend($1)', [bcode])), 'the blocker asking the person they blocked is told to unblock first');
ok(/not found/.test(await refused(db, B, 'select public.unblock($1)', [bl[0].id])), 'nobody else can remove the block');
await one(A, 'public.unblock($1)', [bl[0].id]);
ok((await call(A, 'select * from public.list_blocked()')).length === 0 && (await one(B, 'public.request_friend($1)', [acode])).status === 'pending', 'after unblocking, requests work again');
await one(A, 'public.remove_friendship($1)', [(await friends(A)).find((f) => f.display_name === 'Beatrice').id]);
ok(/not found/.test(await refused(db, C, 'select public.block_user($1)', [fAB])), 'one cannot block through someone else\'s friendship');

// ---------- a new code
const old = (await profile(C)).friend_code;
const fresh = (await one(C, 'public.regenerate_friend_code()')).friend_code;
ok(fresh !== old && /^[0-9a-f]{10}$/.test(fresh), 'a new code is different');
ok(NOT_FOUND.test(await refused(db, B, 'select public.request_friend($1)', [old])) && (await one(B, 'public.request_friend($1)', [fresh])).status === 'pending', 'the old code stops working, the new one works');

// ---------- limits (set up directly as the database owner)
{
  const many = Array.from({ length: 60 }, (_, i) => `00000000-0000-0000-0000-${String(1000 + i).padStart(12, '0')}`);
  await db.exec(`insert into auth.users (id, email) values ${many.map((u, i) => `('${u}', 'm${i}@example.test')`).join(',')}`);
  await db.exec(`insert into public.profiles (user_id, display_name, friend_code) values ${many.map((u, i) => `('${u}', 'M${i}', '${(10 ** 9 + i).toString(16).padStart(10, '0')}')`).join(',')}`);
  // 50 requests already waiting from D
  await db.exec(`insert into public.friendships (requester, addressee, status) values ${many.slice(0, 50).map((u) => `('${D}', '${u}', 'pending')`).join(',')}`);
  ok(/too many requests/.test(await refused(db, D, 'select public.request_friend($1)', [(10 ** 9 + 55).toString(16).padStart(10, '0')])), 'at 50 requests waiting, another is refused');
  // 200 friends for C
  await db.exec(`delete from public.friendships where requester = '${D}'`);
  await db.exec(`delete from public.friendships where '${C}' in (requester, addressee)`);
  const lots = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0001-${String(i).padStart(12, '0')}`);
  await db.exec(`insert into auth.users (id, email) values ${lots.map((u, i) => `('${u}', 'l${i}@example.test')`).join(',')}`);
  await db.exec(`insert into public.profiles (user_id, display_name, friend_code) values ${lots.map((u, i) => `('${u}', 'L${i}', '${(2 * 10 ** 9 + i).toString(16).padStart(10, '0')}')`).join(',')}`);
  await db.exec(`insert into public.friendships (requester, addressee, status) values ${lots.map((u) => `('${u}', '${C}', 'accepted')`).join(',')}`);
  const pend = await one(B, 'public.request_friend($1)', [(await profile(C)).friend_code]);
  ok(/limit of 200 friends/.test(await refused(db, C, 'select public.respond_friend($1, true)', [pend.id])), 'a person with 200 friends cannot accept another');
  ok((await friends(C)).filter((f) => f.status === 'friends').length === 200, 'and the 200 are intact');
}

// ---------- deleting a profile and deleting an account
await one(A, 'public.delete_profile()');
ok((await db.query(`select count(*)::int as n from public.profiles where user_id = '${A}'`)).rows[0].n === 0 && (await db.query(`select count(*)::int as n from public.friendships where '${A}' in (requester, addressee)`)).rows[0].n === 0, 'deleting a profile removes it with its friendships');
ok(NOT_FOUND.test(await refused(db, B, 'select public.request_friend($1)', [acode])), 'and its code stops working');
await db.exec(`insert into public.blocks (blocker, blocked) values ('${B}', '${C}')`);
await db.exec(`delete from auth.users where id = '${B}'`);
const left = (await db.query(`select (select count(*)::int from public.profiles where user_id = '${B}') as p, (select count(*)::int from public.friendships where '${B}' in (requester, addressee)) as f, (select count(*)::int from public.blocks where '${B}' in (blocker, blocked)) as b`)).rows[0];
ok(left.p === 0 && left.f === 0 && left.b === 0, 'deleting an account deletes its profile, friendships and blocks too');
await db.close();
