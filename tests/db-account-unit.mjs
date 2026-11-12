// Deleting a profile and deleting an account: what goes, what is handed on, what stays, and that nobody else is touched.
// Tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (table, where = 'true') => (await q(`select count(*)::int as n from public.${table} where ${where}`))[0].n;
const J = (o) => JSON.stringify(o);
const T1 = '5a1c0000-0000-4000-8000-0000000000b1', T2 = '5a1c0000-0000-4000-8000-0000000000b2', T3 = '5a1c0000-0000-4000-8000-0000000000b3', T4 = '5a1c0000-0000-4000-8000-0000000000b4';
const doc = (id, name) => ({ v: 1, trip: { id, name }, items: [{ id: 'm-' + id, type: 'photo', name: 'M', note: '', lat: 30.5, lon: 114.3, created: '2026-11-01T00:00:00.000Z', tripId: id }] });

for (const u of [A, B, C, D]) await q('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [u, u.slice(0, 2) + '@example.test']);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
const friendIdOf = async (u, name) => (await rows(u, 'select * from public.list_friends()')).find((f) => f.display_name === name).id;
async function befriend(x, y) { const r = await one(x, 'public.request_friend($1)', [await codeOf(y)]); await one(y, 'public.respond_friend($1, true)', [r.id]); }
async function join(owner, member, trip) { await one(owner, 'public.invite_to_trip($1, $2)', [trip, await friendIdOf(owner, (await one(member, 'public.ensure_profile()')).display_name)]); await one(member, 'public.respond_trip_invite($1, true)', [trip]); }
await befriend(A, B); await befriend(A, C); await befriend(A, D);

// Alex owns four trips: T1 shared with Bea (joined first) and Cam (joined second); T2 alone; T3 with only a pending invitation; T4 owned by Dee, Alex edits it.
await one(A, 'public.share_trip($1::jsonb)', [J(doc(T1, 'Party'))]);
await join(A, B, T1); await join(A, C, T1);
await q(`update public.trip_members set joined_at = now() - interval '2 days' where trip_id = $1 and user_id = $2`, [T1, B]);
await q(`update public.trip_members set joined_at = now() - interval '1 day' where trip_id = $1 and user_id = $2`, [T1, C]);
await one(A, 'public.share_trip($1::jsonb)', [J(doc(T2, 'Solo'))]);
await one(A, 'public.share_trip($1::jsonb)', [J(doc(T3, 'Pending only'))]);
await one(A, 'public.invite_to_trip($1, $2)', [T3, await friendIdOf(A, 'Dee')]);
await one(D, 'public.share_trip($1::jsonb)', [J(doc(T4, 'Dee trip'))]);
await join(D, A, T4);
await one(A, 'public.save_user_data($1::jsonb, null, $2)', [J({ v: 1, items: [], trips: [] }), 'laptop']);
await one(A, 'public.save_user_data($1::jsonb, 1, $2)', [J({ v: 1, items: [{ id: 'x' }], trips: [] }), 'laptop']);
await one(B, 'public.save_user_data($1::jsonb, null, $2)', [J({ v: 1, items: [], trips: [] }), 'phone']);
await one(A, 'public.share_location($1, 30.5, 114.3, 10)', [T1]);
await one(B, 'public.share_location($1, 30.6, 114.4, 10)', [T1]);
const rev0 = Number((await q('select members_rev from public.shared_trips where id = $1', [T4]))[0].members_rev);

// ---------- not signed in, and internal helper
for (const fn of ['public.delete_account()', 'public.delete_profile()']) ok(/permission denied/.test(await refused(db, null, `select ${fn}`)), 'a visitor who is not signed in cannot call ' + fn);
ok(/permission denied/.test(await refused(db, A, `select public.leave_all_trips('${A}')`)), 'the internal helper is not callable through the API');
ok(/permission denied/.test(await refused(db, A, `select public.leave_all_trips('${B}')`)), 'so nobody can remove someone else from their trips');

// ---------- delete_account for Alex
ok((await one(A, 'public.delete_account()')).status === 'deleted', 'delete_account answers "deleted"');
ok(await count('profiles', `user_id = '${A}'`) === 0 && await count('friendships', `'${A}' in (requester, addressee)`) === 0, 'the profile and friendships are gone');
ok(await count('user_data', `user_id = '${A}'`) === 0 && await count('user_data_versions', `user_id = '${A}'`) === 0, 'the cloud copy and its earlier versions are gone');
ok(await count('live_locations', `user_id = '${A}'`) === 0 && await count('trip_members', `user_id = '${A}'`) === 0, 'live positions and places in trips are gone');
const t1 = (await q('select owner, rev from public.shared_trips where id = $1', [T1]))[0];
ok(t1 && t1.owner === B && (await q(`select role from public.trip_members where trip_id = $1 and user_id = $2`, [T1, B]))[0].role === 'owner', 'a trip with other joined members passes to the one who joined first (Bea), who is now its owner');
ok((await q(`select role from public.trip_members where trip_id = $1 and user_id = $2`, [T1, C]))[0].role === 'editor' && await count('trip_members', `trip_id = '${T1}'`) === 2, 'the other member stays an editor, and Alex is no longer a member');
ok((await one(B, 'public.get_shared_trip($1)', [T1])).doc.trip.name === 'Party', 'the trip and its document are intact for the new owner');
ok(await count('shared_trips', `id = '${T2}'`) === 0, 'a trip nobody else joined is deleted');
ok(await count('shared_trips', `id = '${T3}'`) === 0 && await count('trip_members', `trip_id = '${T3}'`) === 0, 'and so are its pending invitations');
ok(await count('shared_trips', `id = '${T4}'`) === 1 && await count('trip_members', `trip_id = '${T4}' and user_id = '${D}'`) === 1 && await count('trip_members', `trip_id = '${T4}' and user_id = '${A}'`) === 0, 'in a trip someone else owns, Alex just leaves and the trip stays');
ok(Number((await q('select members_rev from public.shared_trips where id = $1', [T4]))[0].members_rev) > rev0, 'every trip he left gets a new members revision, so the others\' apps notice');
ok(await count('live_locations', `user_id = '${B}'`) === 1 && await count('user_data', `user_id = '${B}'`) === 1 && await count('profiles', `user_id = '${B}'`) === 1, 'other people\'s data is untouched (Bea\'s position, cloud copy, profile)');
ok((await rows(B, 'select * from public.list_friends()')).every((f) => f.display_name !== 'Alex'), 'Alex no longer appears among Bea\'s friends');
ok((await one(A, 'public.delete_account()')).status === 'deleted', 'running it again (a retry after a failure) is harmless');

// ---------- the sign-in record can then go, and nothing is left behind
await q('delete from auth.users where id = $1', [A]);
ok(await count('trip_members', `user_id = '${A}'`) === 0 && await count('shared_trips', `owner = '${A}'`) === 0, 'removing the sign-in record afterwards leaves nothing of Alex');
const left = (await q('select updated_by from public.shared_trips where id = $1', [T1]))[0];
ok(left.updated_by === null || left.updated_by === B, 'a trip Alex last saved no longer points at him');

// ---------- delete_profile alone: leaves the cloud copy, still hands trips on
await one(D, 'public.share_trip($1::jsonb)', [J(doc(T2, 'Dee solo'))]);
await one(D, 'public.save_user_data($1::jsonb, null, $2)', [J({ v: 1, items: [], trips: [] }), 'tablet']);
ok((await one(D, 'public.delete_profile()')).status === 'deleted', 'delete_profile answers "deleted"');
ok(await count('profiles', `user_id = '${D}'`) === 0 && await count('shared_trips', `owner = '${D}'`) === 0 && await count('trip_members', `user_id = '${D}'`) === 0, 'it removes the profile and the trips and memberships');
ok(await count('shared_trips', `id = '${T4}'`) === 0, 'Dee\'s own trip (nobody else joined) went with her');
ok(await count('user_data', `user_id = '${D}'`) === 1, 'but the cloud copy stays: it has its own delete button');
ok(await count('profiles', `user_id = '${C}'`) === 1 && await count('shared_trips', `id = '${T1}'`) === 1, 'and nobody else was touched');

await db.close();
