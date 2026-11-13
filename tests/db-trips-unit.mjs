// Shared trips and their access rules, tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const J = (o) => JSON.stringify(o);
const TRIP = '5a1c0000-0000-4000-8000-000000000001';
const mk = (id, extra = {}) => ({ id, type: 'photo', name: 'Marker ' + id, note: '', lat: 30.5, lon: 114.3, created: '2026-11-01T00:00:00.000Z', tripId: TRIP, ...extra });
const docOf = (items = [], trip = {}) => ({ v: 1, trip: { id: TRIP, name: 'Hubei spring', ...trip }, items });
const share = (uid, doc = docOf([mk('m1'), mk('m2')])) => one(uid, 'public.share_trip($1::jsonb)', [J(doc)]);
const save = async (uid, doc, base, trip = TRIP) => { await db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${trip}'`); return one(uid, 'public.save_shared_trip($1, $2::jsonb, $3)', [trip, J(doc), base]); }; // saves minutes apart, so each keeps a version (version_coalesce)
const members = (uid, trip = TRIP) => rows(uid, 'select * from public.list_trip_members($1)', [trip]);
const mine = (uid) => rows(uid, 'select * from public.list_my_trips()');

// profiles and friendships: A is friends with B and D; C is a stranger
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
for (const other of [B, D]) {
  const r = await one(A, 'public.request_friend($1)', [await codeOf(other)]);
  await one(other, 'public.respond_friend($1, true)', [r.id]);
}
const friendId = async (uid, name) => (await rows(uid, 'select * from public.list_friends()')).find((f) => f.display_name === name).id;

// ---------- nobody signed in, and no direct access
for (const fn of ['public.list_my_trips()', `public.get_shared_trip('${TRIP}')`, `public.list_trip_members('${TRIP}')`, `public.share_trip('{}'::jsonb)`, `public.delete_shared_trip('${TRIP}')`]) {
  ok(/permission denied/.test(await refused(db, null, `select * from ${fn}`)), 'a visitor who is not signed in cannot call ' + fn.split('(')[0]);
}
for (const t of ['shared_trips', 'shared_trip_versions', 'trip_members']) {
  ok(/permission denied/.test(await refused(db, A, `select * from public.${t}`)), 'a signed-in user cannot read the ' + t + ' table directly');
  ok(/permission denied/.test(await refused(db, A, `delete from public.${t}`)), 'or delete from it');
}
ok(/permission denied/.test(await refused(db, A, `select public.check_trip_doc('{}'::jsonb, '${TRIP}')`)) && /permission denied/.test(await refused(db, A, `select public.is_party_member('${TRIP}')`)), 'the internal helpers are not callable through the API');

// ---------- sharing a trip
let r = await share(A);
ok(r.id === TRIP && r.rev === 1, 'the owner shares a trip: its id is the trip\'s id, revision 1');
const ma = await members(A);
ok(ma.length === 1 && ma[0].role === 'owner' && ma[0].status === 'joined' && ma[0].is_me && ma[0].display_name === 'Alex' && !Object.keys(ma[0]).some((k) => /user/.test(k)), 'the owner is the first party member, and no user id is returned: ' + Object.keys(ma[0]).join(', '));
ok(/already shared/.test(await refused(db, A, 'select public.share_trip($1::jsonb)', [J(docOf())])) && /already shared/.test(await refused(db, B, 'select public.share_trip($1::jsonb)', [J(docOf())])), 'the same trip cannot be shared twice, by anyone');
for (const [what, doc, re] of [
  ['an id that is not valid', { v: 1, trip: { id: 'not-a-uuid', name: 'x' }, items: [] }, /not valid/],
  ['no name', docOf([], { name: '' }), /1 to 80/],
  ['a wrong version', { ...docOf(), v: 2 }, /unsupported/],
  ['markers that are not a list', { ...docOf(), items: 'x' }, /must be a list/],
  ['a marker without an id', docOf([{ name: 'x' }]), /needs an id/],
  ['a Home marker', docOf([mk('h', { type: 'residence' })]), /Home marker/],
  ['a check-in', docOf([mk('c', { checkin: { at: 'x', lat: 1, lon: 1 } })]), /check-ins are personal/],
]) {
  const id = '5a1c0000-0000-4000-8000-0000000000' + String(10 + Math.floor(Math.random() * 80));
  const d = JSON.parse(J(doc)); if (d.trip && d.trip.id === TRIP) d.trip.id = id;
  ok(re.test(await refused(db, A, 'select public.share_trip($1::jsonb)', [J(d)])), 'a trip with ' + what + ' is refused');
}
ok(/at most 500/.test(await refused(db, A, 'select public.share_trip($1::jsonb)', [J({ v: 1, trip: { id: '5a1c0000-0000-4000-8000-000000000099', name: 'big' }, items: Array.from({ length: 501 }, (_, i) => mk('b' + i)) })])), 'more than 500 markers is refused');
ok(/too large/.test(await refused(db, A, 'select public.share_trip($1::jsonb)', [J({ v: 1, trip: { id: '5a1c0000-0000-4000-8000-000000000098', name: 'huge' }, items: [], pad: 'x'.repeat(1100000) })])), 'a document over about 1 MB is refused');

// ---------- inviting
ok(/only invite friends/.test(await refused(db, A, 'select public.invite_to_trip($1, $2)', [TRIP, '00000000-0000-0000-0000-000000000000'])), 'inviting with something that is not a friendship is refused');
const fAB = await friendId(A, 'Bea'), fAD = await friendId(A, 'Dee');
ok(/trip not found/.test(await refused(db, B, 'select public.invite_to_trip($1, $2)', [TRIP, await friendId(B, 'Alex')])), 'someone who is not the owner cannot invite');
const invitable = () => rows(A, 'select * from public.list_invitable_friends($1)', [TRIP]);
ok((await invitable()).map((f) => f.display_name).join() === 'Bea,Dee' && (await invitable())[0].friendship_id === fAB && !Object.keys((await invitable())[0]).some((k) => /user/.test(k)), 'the picker lists friends who are not in the trip yet, with the friendship ids');
ok(/trip not found/.test(await refused(db, B, 'select * from public.list_invitable_friends($1)', [TRIP])) && /trip not found/.test(await refused(db, C, 'select * from public.list_invitable_friends($1)', [TRIP])) && /permission denied/.test(await refused(db, null, 'select * from public.list_invitable_friends($1)', [TRIP])), 'nobody else can ask for it');
ok((await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAB])).status === 'invited', 'the owner invites a friend');
ok((await invitable()).map((f) => f.display_name).join() === 'Dee', 'once invited, a friend drops off the picker');
ok(/already invited/.test(await refused(db, A, 'select public.invite_to_trip($1, $2)', [TRIP, fAB])), 'and cannot invite the same person twice');
let mb = await mine(B);
ok(mb.length === 1 && mb[0].status === 'invited' && mb[0].owner_name === 'Alex' && mb[0].name === 'Hubei spring' && mb[0].role === 'editor', 'the invited friend sees the invitation with the trip name and the owner: ' + JSON.stringify({ n: mb[0].name, o: mb[0].owner_name }));
ok(/trip not found/.test(await refused(db, B, 'select public.get_shared_trip($1)', [TRIP])) && /trip not found/.test(await refused(db, B, 'select * from public.list_trip_members($1)', [TRIP])), 'but cannot read the trip or its members until they accept');
ok((await mine(C)).length === 0 && /trip not found/.test(await refused(db, C, 'select public.get_shared_trip($1)', [TRIP])), 'a stranger sees nothing and cannot read the trip');
ok((await members(A)).some((m) => m.display_name === 'Bea' && m.status === 'invited'), 'the owner sees the pending invitation among the members');

// ---------- accepting
ok(/invitation not found/.test(await refused(db, C, 'select public.respond_trip_invite($1, true)', [TRIP])) && /invitation not found/.test(await refused(db, A, 'select public.respond_trip_invite($1, true)', [TRIP])), 'only the invited person can answer an invitation');
ok((await one(B, 'public.respond_trip_invite($1, true)', [TRIP])).status === 'joined', 'the invited friend accepts');
const gt = await one(B, 'public.get_shared_trip($1)', [TRIP]);
ok(gt.rev === 1 && gt.doc.items.length === 2 && gt.role === 'editor' && gt.updated_by_name === 'Alex', 'a party member reads the trip: revision, markers, who saved last');
ok((await members(B)).length === 2 && (await members(B)).find((m) => m.is_me).role === 'editor', 'and sees who is in it');
ok(/invitation not found/.test(await refused(db, B, 'select public.respond_trip_invite($1, true)', [TRIP])), 'an accepted invitation cannot be answered again');

// declining, then being invited again
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAD]);
ok((await one(D, 'public.respond_trip_invite($1, false)', [TRIP])).status === 'declined' && (await mine(D)).length === 0, 'declining removes the invitation');
ok((await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAD])).status === 'invited', 'and the owner can invite them again');

// ---------- editing: party members edit, only the owner deletes the trip
r = await save(B, docOf([mk('m1'), mk('m2'), mk('m3', { name: 'Added by Bea' })], { notes: 'Bea\'s notes' }), 1);
ok(r.status === 'ok' && r.rev === 2 && r.updated_by_name === 'Bea', 'a party member saves an edit (revision 2)');
r = await save(B, docOf([mk('m1'), mk('m3')]), 2);
ok(r.status === 'ok' && r.rev === 3 && (await one(A, 'public.get_shared_trip($1)', [TRIP])).doc.items.length === 2, 'a party member may remove markers inside the trip');
r = await save(A, docOf([mk('m1'), mk('m9')]), 1);
ok(r.status === 'conflict' && r.rev === 3 && r.updated_by_name === 'Bea', 'a save from an older revision is a conflict that says who saved last: ' + J(r));
r = await save(A, docOf([mk('m1'), mk('m3'), mk('m9')]), 3);
ok(r.status === 'ok' && r.rev === 4, 'after merging, the owner saves from the new revision');
ok(/trip not found/.test(await refused(db, C, 'select public.save_shared_trip($1, $2::jsonb, 4)', [TRIP, J(docOf())])), 'a stranger cannot save');
ok(/trip not found/.test(await refused(db, D, 'select public.save_shared_trip($1, $2::jsonb, 4)', [TRIP, J(docOf())])), 'nor can someone who is only invited');
ok(/does not match/.test(await refused(db, B, 'select public.save_shared_trip($1, $2::jsonb, 4)', [TRIP, J({ v: 1, trip: { id: '5a1c0000-0000-4000-8000-0000000000ff', name: 'Other' }, items: [] })])), 'a document for a different trip is refused');
ok(/Home marker/.test(await refused(db, B, 'select public.save_shared_trip($1, $2::jsonb, 4)', [TRIP, J(docOf([mk('h', { type: 'residence' })]))])) && /check-ins are personal/.test(await refused(db, B, 'select public.save_shared_trip($1, $2::jsonb, 4)', [TRIP, J(docOf([mk('c', { checkin: { at: 'x' } })]))])), 'saves with a Home marker or a check-in are refused too');
ok(/trip not found/.test(await refused(db, B, 'select public.delete_shared_trip($1)', [TRIP])), 'a party member cannot delete the trip');
ok(/trip not found/.test(await refused(db, B, 'select public.remove_member($1, $2)', [TRIP, (await members(A))[0].member_id])), 'nor remove anyone');
ok((await mine(B))[0].name === 'Hubei spring' && (await mine(A))[0].markers === 3, 'the list follows the saved trip: name and marker count');
ok((await save(B, docOf([mk('m1')], { name: 'Hubei autumn' }), 4)).rev === 5 && (await mine(A))[0].name === 'Hubei autumn', 'renaming the trip shows in everyone\'s list');

// ---------- earlier versions
let vs = await rows(A, 'select * from public.list_shared_trip_versions($1)', [TRIP]);
ok(vs.length === 4 && Number(vs[0].rev) === 4 && vs[0].updated_by_name === 'Alex' && vs[1].updated_by_name === 'Bea', 'the earlier versions are kept, newest first, with who saved them: ' + vs.map((v) => '#' + v.rev + ' ' + v.updated_by_name).join(', '));
ok(/trip not found/.test(await refused(db, C, 'select * from public.list_shared_trip_versions($1)', [TRIP])), 'a stranger cannot list them');
r = await one(B, 'public.restore_shared_trip_version($1, 2)', [TRIP]);
ok(r.status === 'ok' && r.rev === 6 && (await one(A, 'public.get_shared_trip($1)', [TRIP])).doc.items.length === 3, 'a party member restores version 2 as a new revision (the restore can itself be undone)');
ok(/no longer exists/.test(await refused(db, B, 'select public.restore_shared_trip_version($1, 999)', [TRIP])), 'restoring a version that is not there is refused');
for (let i = 0; i < 25; i++) { const cur = (await one(A, 'public.get_shared_trip($1)', [TRIP])).rev; await save(A, docOf([mk('m1', { note: 'n' + i })]), cur); }
vs = await rows(A, 'select * from public.list_shared_trip_versions($1)', [TRIP]);
const top = Number((await one(A, 'public.get_shared_trip($1)', [TRIP])).rev);
ok(vs.length <= 20 && vs.every((v) => Number(v.rev) > top - 20), 'at most 20 versions are kept (' + vs.length + ')');
await db.exec(`update public.shared_trip_versions set updated_at = now() - interval '31 days' where rev < ${top - 3}`);
await save(A, docOf([mk('m1', { note: 'again' })]), top);
vs = await rows(A, 'select * from public.list_shared_trip_versions($1)', [TRIP]);
ok(vs.length === 4, 'versions older than 30 days are dropped at the next save (' + vs.length + ' left)');

// ---------- listing
const la = await mine(A), lb = await mine(B);
ok(la.length === 1 && la[0].role === 'owner' && la[0].status === 'joined' && la[0].members === 2 && la[0].start_date === null, 'the owner\'s list: role, members joined, no dates yet');
ok(lb[0].role === 'editor' && lb[0].owner_name === 'Alex' && !('doc' in lb[0]), 'a party member\'s list names the owner and carries no document');
await save(A, docOf([mk('m1')], { startDate: '2026-12-01', endDate: '2026-12-04' }), Number((await one(A, 'public.get_shared_trip($1)', [TRIP])).rev));
ok((await mine(B))[0].start_date === '2026-12-01' && (await mine(B))[0].end_date === '2026-12-04', 'the dates show in the list');
const mrev = (await mine(A))[0].members_rev;

// ---------- leaving and removing
ok(/not found/.test(await refused(db, A, 'select public.leave_trip($1)', [TRIP])), 'the owner cannot leave their own trip');
ok((await one(B, 'public.leave_trip($1)', [TRIP])).status === 'left' && (await mine(B)).length === 0 && /trip not found/.test(await refused(db, B, 'select public.get_shared_trip($1)', [TRIP])), 'a party member leaves and can no longer read the trip');
ok((await mine(A))[0].members_rev > mrev, 'the member list changed, so the revision of the members goes up (others notice)');
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAB]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
const bid = (await members(A)).find((m) => m.display_name === 'Bea').member_id;
ok(/not found/.test(await refused(db, A, 'select public.remove_member($1, $2)', [TRIP, (await members(A)).find((m) => m.role === 'owner').member_id])), 'the owner cannot be removed');
ok((await one(A, 'public.remove_member($1, $2)', [TRIP, bid])).status === 'removed' && (await mine(B)).length === 0, 'the owner removes a party member');
ok(/not found/.test(await refused(db, A, 'select public.remove_member($1, $2)', [TRIP, bid])), 'removing the same member again says not found');
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAB]);
const pend = (await members(A)).find((m) => m.display_name === 'Bea').member_id;
await one(A, 'public.remove_member($1, $2)', [TRIP, pend]);
ok((await mine(B)).length === 0, 'the owner can cancel an invitation');

// ---------- at most 10 people
{
  const many = Array.from({ length: 12 }, (_, i) => `00000000-0000-0000-0002-${String(i).padStart(12, '0')}`);
  await db.exec(`insert into auth.users (id, email) values ${many.map((u, i) => `('${u}', 'p${i}@example.test')`).join(',')}`);
  await db.exec(`insert into public.profiles (user_id, display_name, friend_code) values ${many.map((u, i) => `('${u}', 'P${i}', '${(3 * 10 ** 9 + i).toString(16).padStart(10, '0')}')`).join(',')}`);
  await db.exec(`insert into public.friendships (requester, addressee, status) values ${many.map((u) => `('${A}', '${u}', 'accepted')`).join(',')}`);
  const fl = await rows(A, 'select * from public.list_friends()');
  let invited = 0, refusedAt = null;
  for (const name of many.map((_, i) => 'P' + i)) {
    const msg = await refused(db, A, 'select public.invite_to_trip($1, $2)', [TRIP, fl.find((f) => f.display_name === name).id]);
    if (msg) { refusedAt = msg; break; } invited++;
  }
  ok(invited === 8 && /at most 10 people/.test(refusedAt), 'a trip holds at most 10 people, counting the owner and pending invitations (the owner and Dee were in, so ' + invited + ' more fit)');
}

// ---------- deleting the trip
ok(/trip not found/.test(await refused(db, C, 'select public.delete_shared_trip($1)', [TRIP])), 'a stranger cannot delete it');
ok((await one(A, 'public.delete_shared_trip($1)', [TRIP])).status === 'deleted' && (await mine(A)).length === 0, 'the owner deletes the trip');
const left = (await db.query(`select (select count(*)::int from public.shared_trips) as t, (select count(*)::int from public.trip_members) as m, (select count(*)::int from public.shared_trip_versions) as v`)).rows[0];
ok(left.t === 0 && left.m === 0 && left.v === 0, 'with its members and versions');

// ---------- deleting an account deletes what it owns
const T2 = '5a1c0000-0000-4000-8000-000000000002';
await share(C, { v: 1, trip: { id: T2, name: 'Cam trip' }, items: [] });
// Side Quests are ordinary fields of a marker: the database does not need to know about them
const sqDoc = { v: 1, trip: { id: T2, name: 'Cam trip' }, items: [mk('p1', { tripId: T2 }), mk('q1', { tripId: T2, isSub: true, parentId: 'p1', order: 1 })] };
const sqRev = (await one(C, 'public.get_shared_trip($1)', [T2])).rev;
const sqSaved = await save(C, sqDoc, sqRev, T2);
const sqBack = await one(C, 'public.get_shared_trip($1)', [T2]);
ok(sqSaved.status === 'ok' && sqBack.doc.items.find((i) => i.id === 'q1').isSub === true && sqBack.doc.items.find((i) => i.id === 'q1').parentId === 'p1', 'a trip with a Side Quest (isSub, parentId) is saved and read back as it is');
// ---------- a burst of saves by one person keeps one version, not one per save (version_coalesce)
{
  const T = '5a1c0000-0000-4000-8000-0000000000ab';
  const doc = (n) => ({ v: 1, trip: { id: T, name: 'Burst', startDate: '2026-12-01', endDate: '2026-12-02' }, items: Array.from({ length: n }, (_, i) => mk('b' + i, { tripId: T })) });
  const vn = async () => (await rows(A, 'select * from public.list_shared_trip_versions($1)', [T])).length;
  await share(A, doc(1));
  const t = (await db.query(`select start_date, end_date from public.shared_trips where id = '${T}'`)).rows[0];
  ok(t.start_date === '2026-12-01' && t.end_date === '2026-12-02', 'share_trip stores the dates in their columns');
  const fast = (uid, d, base) => one(uid, 'public.save_shared_trip($1, $2::jsonb, $3)', [T, J(d), base]);
  await fast(A, doc(2), 1); await fast(A, doc(3), 2); await fast(A, doc(4), 3);
  ok((await one(A, 'public.get_shared_trip($1)', [T])).rev === 4 && await vn() === 0, 'saves seconds apart by one person keep no version between them');
  await db.exec(`update public.shared_trips set updated_by = '${B}' where id = '${T}'`);
  await fast(A, doc(5), 4);
  ok(await vn() === 1, "a save over someone else's keeps what it replaces");
  await db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${T}'`);
  await fast(A, { ...doc(5), trip: { ...doc(5).trip, endDate: '2026-12-09' } }, 5);
  ok(await vn() === 2, 'and so does a save over a document that is two minutes old or more');
  const t2 = (await db.query(`select end_date from public.shared_trips where id = '${T}'`)).rows[0];
  ok(t2.end_date === '2026-12-09', 'save_shared_trip keeps the end date column in step');
  const l = (await rows(A, 'select * from public.list_my_trips()')).find((x) => x.id === T);
  ok(l.end_date === '2026-12-09' && l.start_date === '2026-12-01', 'and list_my_trips reads the dates from the columns');
  await one(A, 'public.delete_shared_trip($1)', [T]);
}
await db.exec(`delete from auth.users where id = '${C}'`);
ok((await db.query('select count(*)::int as n from public.shared_trips')).rows[0].n === 0, 'deleting the owner\'s account deletes the shared trip too');
await db.close();
