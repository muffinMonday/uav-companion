// Profile fields (avatar, bio, location, interests, share switch): who can write them, what each kind of viewer sees, and that nothing leaks.
// Tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
import { AVATARS, INTERESTS } from '../src/avatars.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const J = (o) => JSON.stringify(o);
const update = (uid, patch) => one(uid, 'public.update_profile($1::jsonb)', [J(patch)]);
const bad = (uid, patch) => refused(db, uid, 'select public.update_profile($1::jsonb)', [J(patch)]);
const friendsOf = (uid) => rows(uid, 'select * from public.list_friends()');
const TRIP = '5a1c0000-0000-4000-8000-0000000000a1';

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
async function befriend(x, y) { const r = await one(x, 'public.request_friend($1)', [await codeOf(y)]); await one(y, 'public.respond_friend($1, true)', [r.id]); return r.id; }

// ---------- the lists: SQL and the app agree
const sqlA = (await db.query('select public.profile_avatars() as a, public.profile_interests() as i')).rows[0];
ok(J(sqlA.a) === J(AVATARS.map((x) => x.key)) && J(sqlA.i) === J(INTERESTS.map((x) => x.key)), 'the database lists and the app lists hold the same keys in the same order (' + AVATARS.length + ' avatars, ' + INTERESTS.length + ' interests)');
let accepted = 0; for (const a of AVATARS) { try { await update(A, { avatar: a.key }); accepted++; } catch { /* counted below */ } }
ok(accepted === AVATARS.length, 'the database accepts every avatar key the app offers (' + accepted + ')');
accepted = 0; for (const t of INTERESTS) { try { await update(A, { interests: [t.key] }); accepted++; } catch { /* counted below */ } }
ok(accepted === INTERESTS.length, 'and every interest key (' + accepted + ')');
ok(AVATARS.some((a) => /^fpv-(5in|cinewhoop|tinywhoop|toothpick)$/.test(a.key)) && AVATARS.some((a) => a.key.startsWith('photo-')) && AVATARS.some((a) => a.key.startsWith('travel-')), 'the avatars cover FPV platforms, photography drones and travel');
ok(INTERESTS.some((t) => t.key.startsWith('fpv-')) && INTERESTS.length >= 12, 'the interests include the FPV flying styles');
await update(A, { avatar: null, interests: [] });

// ---------- nobody signed in, no direct writes
ok(/permission denied/.test(await refused(db, null, `select public.update_profile('{}'::jsonb)`)), 'a visitor who is not signed in cannot update a profile');
ok(/permission denied/.test(await refused(db, A, `update public.profiles set bio = 'x' where user_id = '${A}'`)), 'and nobody writes the table directly');
for (const fn of ['public.profile_avatars()', 'public.profile_interests()', `public.clean_text('x')`]) ok(/permission denied/.test(await refused(db, A, `select ${fn}`)), fn.split('(')[0] + ' is internal');

// ---------- a new profile is empty, and returns no email
let pa = await one(A, 'public.ensure_profile()');
ok(pa.avatar === null && pa.bio === null && pa.location === null && Array.isArray(pa.interests) && pa.interests.length === 0 && pa.share_profile === true, 'a profile starts with no avatar, bio, location or interests, and sharing on: ' + J(pa));
ok(!J(pa).includes('@') && !('email' in pa) && !('user_id' in pa), 'and carries no email or user id');

// ---------- writing
pa = await update(A, { avatar: 'fpv-5in', bio: '  Freestyle\n   and cinematic  ', location: 'Wuhan, China', interests: ['fpv-freestyle', 'hiking', 'hiking'], display_name: ' Alex  P ' });
ok(pa.avatar === 'fpv-5in' && pa.bio === 'Freestyle and cinematic' && pa.location === 'Wuhan, China' && J(pa.interests) === J(['fpv-freestyle', 'hiking']) && pa.display_name === 'Alex P', 'one patch sets the fields, tidies the text and drops a repeated interest: ' + J(pa));
pa = await update(A, { bio: 'Only the bio' });
ok(pa.avatar === 'fpv-5in' && pa.location === 'Wuhan, China' && pa.bio === 'Only the bio', 'a field that is not in the patch is left alone');
pa = await update(A, { bio: null, location: '   ', interests: null, avatar: null });
ok(pa.bio === null && pa.location === null && pa.avatar === null && pa.interests.length === 0, 'null, an empty string or null interests clear a field');
ok((await update(A, {})).display_name === 'Alex P', 'an empty patch changes nothing');
ok((await update(C, { bio: 'hi' })).bio === 'hi' && (await one(A, 'public.ensure_profile()')).bio === null, 'a user only ever changes their own profile');

// ---------- refusals: nothing is changed unless the whole patch is good
await update(A, { bio: 'keep me', avatar: 'travel-sun' });
const before = J(await one(A, 'public.ensure_profile()'));
const refusals = [
  [{ bio: 'x'.repeat(161) }, /at most 160/], [{ location: 'x'.repeat(61) }, /at most 60/], [{ avatar: 'not-an-avatar' }, /not in the list/], [{ avatar: 5 }, /not in the list/],
  [{ interests: ['hiking', 'nope'] }, /not in the list/], [{ interests: ['hiking', 'food', 'history', 'wildlife', 'cycling', 'camping'] }, /up to 5/], [{ interests: 'hiking' }, /must be a list/],
  [{ interests: [5] }, /not in the list/], [{ display_name: '   ' }, /1 to 40/], [{ display_name: 5 }, /1 to 40/], [{ share_profile: 'yes' }, /true or false/], [{ bio: 5 }, /must be text/],
  [{ email: 'a@b.c' }, /unknown profile field/], [{ user_id: A }, /unknown profile field/], [{ friend_code: 'aaaaaaaaaa' }, /unknown profile field/],
];
for (const [patch, re] of refusals) ok(re.test(await bad(A, { bio: 'changed', ...patch })), 'refused: ' + J(patch).slice(0, 60));
ok(J(await one(A, 'public.ensure_profile()')) === before, 'and none of those, even with a good bio beside them, changed anything');
ok(/must be an object/.test(await refused(db, A, `select public.update_profile('[1]'::jsonb)`)) && /must be an object/.test(await refused(db, A, 'select public.update_profile($1::jsonb)', [null])), 'a patch must be an object');
ok((await update(A, { bio: 'ü'.repeat(160), location: 'é'.repeat(60) })).bio.length === 160, 'the limits count characters, not bytes');
ok((await update(A, { bio: 'a\u0007b\u0000'.replace('\u0000', '') })).bio === 'a b', 'control characters become spaces');

// ---------- who sees what
await update(A, { avatar: 'photo-folding', bio: 'Aerial work', location: 'Wuhan', interests: ['hiking', 'fpv-racing'], share_profile: true });
const fAB = await befriend(A, B);
await one(C, 'public.request_friend($1)', [await codeOf(A)]); // C asks A: a pending request only
let row = (await friendsOf(B)).find((f) => f.display_name === 'Alex P');
ok(row.avatar === 'photo-folding' && row.bio === 'Aerial work' && row.location === 'Wuhan' && J(row.interests) === J(['hiking', 'fpv-racing']), 'an accepted friend sees avatar, bio, location and interests');
let rq = (await friendsOf(A)).find((f) => f.display_name === 'Cam');
ok(rq.status === 'incoming' && rq.avatar === null && rq.bio === null && rq.location === null && rq.interests.length === 0, 'a pending request shows a name only');
await update(C, { avatar: 'travel-leaf', bio: 'secret', location: 'Paris', interests: ['food'] });
rq = (await friendsOf(A)).find((f) => f.display_name === 'Cam');
ok(rq.avatar === null && rq.bio === null, 'and still nothing once the stranger fills theirs in');
await update(A, { share_profile: false });
row = (await friendsOf(B)).find((f) => f.display_name === 'Alex P');
ok(row.avatar === 'photo-folding' && row.bio === null && row.location === null && row.interests.length === 0, 'with sharing off a friend still sees the avatar but not bio, location or interests');
ok((await one(A, 'public.ensure_profile()')).bio === 'Aerial work', 'and the owner still sees their own');
await update(A, { share_profile: true });
await befriend(A, D);
ok(!J(await friendsOf(B)).includes('@') && !J(await friendsOf(B)).includes(A), 'the friends list returns no email and no user id');

// ---------- shared trips: members and the editor's avatar
const doc = { v: 1, trip: { id: TRIP, name: 'Spring' }, items: [{ id: 'm1', type: 'photo', name: 'M', note: '', lat: 30.5, lon: 114.3, created: '2026-11-01T00:00:00.000Z', tripId: TRIP }] };
await one(A, 'public.share_trip($1::jsonb)', [J(doc)]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, fAB]);
let mem = await rows(A, 'select * from public.list_trip_members($1)', [TRIP]);
const bea = () => mem.find((m) => m.display_name === 'Bea');
ok(bea().status === 'invited' && bea().avatar === null && bea().bio === null, 'an invited member shows no avatar or fields yet');
await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
await update(B, { avatar: 'fpv-tinywhoop', bio: 'Whoop pilot', location: 'Ghent', interests: ['fpv-micro'] });
mem = await rows(A, 'select * from public.list_trip_members($1)', [TRIP]);
ok(bea().avatar === 'fpv-tinywhoop' && bea().bio === 'Whoop pilot' && bea().location === 'Ghent' && J(bea().interests) === J(['fpv-micro']), 'a joined member shows avatar and shared fields to the party');
await update(B, { share_profile: false });
mem = await rows(A, 'select * from public.list_trip_members($1)', [TRIP]);
ok(bea().avatar === 'fpv-tinywhoop' && bea().bio === null && bea().interests.length === 0, 'a member who does not share still shows an avatar, not bio, location or interests');
const meRow = (await rows(B, 'select * from public.list_trip_members($1)', [TRIP])).find((m) => m.is_me);
ok(meRow.bio === 'Whoop pilot', 'and sees their own row in full');
ok(/trip not found/.test(await refused(db, D, 'select * from public.list_trip_members($1)', [TRIP])), 'a friend outside the trip cannot read the member list');

const saved = await one(B, 'public.save_shared_trip($1, $2::jsonb, $3)', [TRIP, J({ ...doc, trip: { ...doc.trip, name: 'Spring 2' } }), 1]);
ok(saved.status === 'ok', 'a member saves the trip');
const vs = await rows(A, 'select * from public.list_shared_trip_versions($1)', [TRIP]);
ok(vs.some((v) => v.updated_by_name === 'Alex P' && v.updated_by_avatar === 'photo-folding'), 'the version list carries the editor\'s avatar: ' + J(vs.map((v) => [v.updated_by_name, v.updated_by_avatar])));
ok(/trip not found/.test(await refused(db, C, 'select * from public.list_shared_trip_versions($1)', [TRIP])), 'a stranger cannot list versions');

await db.close();
