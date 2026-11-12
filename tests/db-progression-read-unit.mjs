// Reading progression (supabase/migrations/20261114120000_progression_read.sql): who may see whose rank, XP and achievements, what is returned, and your own XP history.
// Tested on a real Postgres (PGlite) as different users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const J = (o) => JSON.stringify(o);
const get = (u, kind, id) => one(u, 'public.get_progression($1, $2)', [kind, id]);
const list = (u, kind, ids) => one(u, 'public.list_progression($1, $2::uuid[])', [kind, ids]);
const hidden = (r) => r && r.visible === false && J(r) === '{"visible":false}';
const T = '5a1c0000-0000-4000-8000-0000000000c1';
const NONE = '00000000-0000-0000-0000-000000000000';

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
async function befriend(x, y) { const r = await one(x, 'public.request_friend($1)', [await codeOf(y)]); await one(y, 'public.respond_friend($1, true)', [r.id]); return r.id; }
const friendRow = async (u, name) => (await as(db, u, 'select * from public.list_friends()')).find((f) => f.display_name === name);
const memberRow = async (u, name) => (await as(db, u, 'select * from public.list_trip_members($1)', [T])).find((m) => m.display_name === name);

// A is friends with B (and they share a trip), A and D shared a trip but are no longer friends, and A asked C who has not answered
let fAB = await befriend(A, B);
const fAD = await befriend(A, D);
await one(A, 'public.share_trip($1::jsonb)', [J({ v: 1, trip: { id: T, name: 'Spring' }, items: [] })]);
await one(A, 'public.invite_to_trip($1, $2)', [T, fAB]); await one(B, 'public.respond_trip_invite($1, true)', [T]);
await one(A, 'public.invite_to_trip($1, $2)', [T, fAD]); await one(D, 'public.respond_trip_invite($1, true)', [T]);
await one(A, 'public.remove_friendship($1)', [fAD]);
const reqAC = await one(A, 'public.request_friend($1)', [await codeOf(C)]);
const fAC = reqAC.id;
const mA = (await memberRow(A, 'Alex')).member_id, mB = (await memberRow(A, 'Bea')).member_id, mD = (await memberRow(A, 'Dee')).member_id;
const mBofB = (await memberRow(B, 'Bea')).member_id;
ok(mA && mB && mD && mB === mBofB, '(setup) A and B are friends in one trip; D is in the trip but not a friend; C has an unanswered request from A');

// B has 350 XP (Cadet) from attendance, D has 3600 (Ace)
for (let i = 1; i <= 7; i++) await sql(`select public.award_xp($1, 50, 'attendance', $2, 'secret session note')`, [B, 'session:' + i]);
await sql(`select public.award_xp($1, 3600, 'admin', 'seed', 'Seeded for the test')`, [D]);

// ---------- what a friend sees
let r = await get(A, 'friend', fAB);
ok(r.visible === true && r.xp === 350 && r.tier === 3 && r.rank_key === 'cadet' && r.rank_name === 'Cadet' && r.tier_min_xp === 250 && r.next_min_xp === 450 && r.next_name === 'Novice' && r.max === false, 'a friend sees rank, exact XP and progress to the next rank: ' + J({ xp: r.xp, tier: r.tier, next: r.next_min_xp }));
ok(Array.isArray(r.achievements) && r.achievements.length === 16 && r.unlocked_count === r.achievements.filter((a) => a.unlocked).length, 'with the whole collection (16) and the unlocked count');
const byKey = Object.fromEntries(r.achievements.map((a) => [a.key, a]));
ok(byKey['first-meetup'].unlocked === true && byKey['regular-flyer'].unlocked === true && byKey['moving-up'].unlocked === true && byKey['ace-pilot'].unlocked === false && byKey['first-flight'].unlocked === false, 'each marked unlocked or not');
ok(byKey['ace-pilot'].description.includes('Ace') && byKey['ace-pilot'].rarity === 'legendary' && typeof byKey['ace-pilot'].icon === 'string' && byKey['ace-pilot'].category === 'progression', 'locked ones still carry their name, criteria, rarity and icon');
ok(!r.achievements.some((a) => 'unlocked_at' in a), 'others do not see unlock times');
ok(Array.isArray(r.featured) && r.featured.length === 0, 'and the featured list (empty so far)');
await one(B, `public.set_featured($1::jsonb)`, [J(['moving-up', 'first-meetup'])]);
ok(J((await get(A, 'friend', fAB)).featured) === J(['moving-up', 'first-meetup']), 'a featured choice shows to a friend, in order');

// ---------- you, and the top rank
const me = await one(B, 'public.my_progression()');
ok(me.visible === true && me.xp === 350 && me.achievements.filter((a) => a.unlocked).every((a) => a['unlocked_at']) && me.achievements.filter((a) => !a.unlocked).every((a) => !('unlocked_at' in a)), 'my own progression has my unlock times, and none for what is locked');
ok(J(await get(B, 'member', mBofB)) === J(me), 'my own member row in a party gives the same, with times');
r = await get(A, 'member', mD);
ok(r.visible === true && r.xp === 3600 && r.tier === 10 && r.rank_key === 'ace' && r.max === true && r.next_min_xp === null && r.next_name === null, 'someone in my party who is not my friend is visible, and Ace is the maximum rank (no next rank) with the exact XP kept');
ok((await get(D, 'member', (await memberRow(D, 'Alex')).member_id)).xp === 0 && (await get(D, 'member', (await memberRow(D, 'Alex')).member_id)).tier === 1, 'a person with no XP shows 0 XP, tier 1, and no unlocks');

// ---------- not reachable, not visible: the same answer every time
ok(hidden(await get(A, 'friend', fAC)) && hidden(await get(C, 'friend', fAC)), 'a pending friend request is not enough, for either side');
ok(hidden(await get(C, 'member', mB)) && hidden(await get(C, 'member', mD)), 'someone outside the party cannot read a member through a member id');
ok(hidden(await get(A, 'friend', NONE)) && hidden(await get(A, 'member', NONE)), 'an id that does not exist is hidden, not an error');
ok(hidden(await get(A, 'member', fAB)) && hidden(await get(A, 'friend', mB)), 'an id of the other kind is hidden (the two kinds of id are different handles)');
ok(hidden(await get(B, 'friend', fAD)) && hidden(await get(A, 'friend', fAD)), 'a friendship that was removed gives nothing');
ok(/invalid kind/.test(await refused(db, A, `select public.get_progression('user', '${A}')`)), 'there is no way to ask by user id');
ok(/permission denied/.test(await refused(db, null, `select public.get_progression('friend', '${fAB}')`)) && /permission denied/.test(await refused(db, null, 'select public.my_progression()')) && /permission denied/.test(await refused(db, null, `select public.list_progression('friend', '{}')`)) && /permission denied/.test(await refused(db, null, 'select public.my_xp_history()')), 'a visitor can read none of it');

// ---------- the profile switch hides it from everyone else, not from the owner
await one(B, 'public.update_profile($1::jsonb)', [J({ share_profile: false })]);
ok(hidden(await get(A, 'friend', fAB)) && hidden(await get(A, 'member', mB)) && hidden(await get(D, 'member', (await memberRow(D, 'Bea')).member_id)), 'with the profile switch off, a friend and a party member see nothing');
ok((await get(B, 'member', mBofB)).visible === true && (await one(B, 'public.my_progression()')).xp === 350, 'but the owner still sees their own');
ok(J((await list(A, 'friend', [fAB]))[0]) === J({ id: fAB, visible: false }), 'and the list hides it the same way');
await one(B, 'public.update_profile($1::jsonb)', [J({ share_profile: true })]);
ok((await get(A, 'friend', fAB)).visible === true, 'switching it back shows it again');

// ---------- blocking, whoever blocked first
const blockIdOf = async (u) => (await as(db, u, 'select * from public.list_blocked()'))[0]?.id;
await one(A, 'public.block_user($1)', [fAB]);
ok(hidden(await get(A, 'member', mB)) && hidden(await get(B, 'member', mBofB === mB ? (await memberRow(B, 'Alex')).member_id : mB)), 'after A blocks B (still in one trip) neither sees the other\'s progression');
await one(A, 'public.unblock($1)', [await blockIdOf(A)]);
ok((await get(A, 'member', mB)).visible === true && (await get(B, 'member', (await memberRow(B, 'Alex')).member_id)).visible === true, 'unblocking restores it');
fAB = await befriend(A, B); // blocking ended the friendship; they become friends again
// the other direction: D blocks A. D has no friendship with A, so block through a friendship first
const fDA = await befriend(D, A);
await one(D, 'public.block_user($1)', [fDA]);
ok(hidden(await get(A, 'member', mD)) && hidden(await get(D, 'member', (await memberRow(D, 'Alex')).member_id)), 'it works the same when the other person was the one who blocked');
ok(J(await get(A, 'member', mD)) === J(await get(A, 'friend', NONE)), 'and a block looks exactly like hidden, unknown and not reachable');
const lb = await list(A, 'member', [mB, mD]);
ok(lb.find((x) => x.id === mB).visible === true && lb.find((x) => x.id === mD).visible === false, 'the list applies the block per person');
await one(D, 'public.unblock($1)', [await blockIdOf(D)]);
ok((await get(A, 'member', mD)).visible === true, 'unblocking D restores it');

// ---------- leaving the party
await one(B, 'public.leave_trip($1)', [T]);
ok(hidden(await get(A, 'member', mB)) && (await get(A, 'friend', fAB)).visible === true, 'a member who left is no longer reachable as a member, but is still reachable as a friend');

// ---------- the list
const rows = await list(A, 'friend', [fAB, fAC, NONE, fAB]);
ok(Array.isArray(rows) && rows.length === 3, 'the list answers once per distinct id');
const lab = rows.find((x) => x.id === fAB);
ok(lab.visible === true && lab.xp === 350 && lab.tier === 3 && lab.rank_name === 'Cadet' && lab.next_min_xp === 450 && !('achievements' in lab) && Array.isArray(lab.featured), 'a visible item is brief: rank, XP, progress and featured, without the whole collection');
ok(J(rows.find((x) => x.id === fAC)) === J({ id: fAC, visible: false }) && J(rows.find((x) => x.id === NONE)) === J({ id: NONE, visible: false }), 'and a hidden or unknown one has nothing but its id');
ok((await list(A, 'friend', null)).length === 0 && (await list(A, 'friend', [])).length === 0, 'asking for nobody gives an empty list');
ok(/at most 100/.test(await refused(db, A, `select public.list_progression('friend', array(select gen_random_uuid() from generate_series(1, 101)))`)), 'more than 100 at once is refused');
ok(/invalid kind/.test(await refused(db, A, `select public.list_progression('user', '{}')`)) && /invalid kind/.test(await refused(db, A, `select public.list_progression(null, '{}')`)), 'an unknown kind is refused');

// ---------- nothing private is returned
const dump = J([await get(A, 'friend', fAB), await get(A, 'member', mD), await list(A, 'friend', [fAB]), await one(B, 'public.my_progression()'), await one(B, 'public.my_xp_history()')]);
ok(![A, B, C, D].some((u) => dump.includes(u)) && !/steam_id|actor|"ref"|session:|secret session note/i.test(dump), 'no user id, Steam id, ledger reference, actor or private note appears anywhere in what is returned');

// ---------- a deduction lowers the rank others see; achievements stay
await db.exec(`insert into public.app_roles (user_id, role) values ('${C}', 'admin')`);
const cBea = await codeOf(B);
await one(C, 'public.admin_adjust_xp($1, -300, $2)', [cBea, 'Corrected a duplicate']);
r = await get(A, 'friend', fAB);
ok(r.xp === 50 && r.tier === 1 && r.rank_key === 'rookie' && r.achievements.find((a) => a.key === 'moving-up').unlocked === true, 'after a deduction others see the lower rank and XP, and the achievement it earned is still unlocked');

// ---------- the list of achievements shown
await db.exec(`insert into public.achievements (key, category, name, description, rarity, icon, metric, threshold, active) values ('t-off', 'seasonal', 'Off', 'o', 'rare', 'star', 'sim_hours', 99, false)`);
await db.exec(`insert into public.achievements (key, category, name, description, rarity, icon, metric, threshold, starts_at, ends_at) values ('t-later', 'seasonal', 'Later', 'l', 'rare', 'star', 'sim_hours', 99, now() + interval '1 day', now() + interval '2 days')`);
ok((await get(A, 'friend', fAB)).achievements.length === 16, 'an inactive achievement and one whose season has not started are not listed');

// ---------- my XP history
await sql(`select public.award_xp($1, 50, 'attendance', 'session:private', 'a private reference')`, [A]);
let h = await one(B, 'public.my_xp_history()');
ok(h.items.length === 8 && h.next === null && h.items[0].source === 'admin' && h.items[0].amount === -300 && h.items[0].reason === 'Corrected a duplicate', 'my history lists every change newest first, and an administrator adjustment shows its reason');
ok(h.items.filter((x) => x.source === 'attendance').every((x) => x.reason === null && x.amount === 50), 'other kinds show no reason');
ok(h.items.every((x) => Object.keys(x).sort().join() === 'amount,created_at,id,reason,source'), 'and nothing else about the row (no actor, no reference)');
ok(h.items.every((x, i, a) => i === 0 || a[i - 1].id > x.id), 'in newest-first order');
const p1 = await one(B, 'public.my_xp_history(null, 3)');
ok(p1.items.length === 3 && p1.next === p1.items[2].id, 'a page of 3 says where the next one starts');
const p2 = await one(B, 'public.my_xp_history($1, 3)', [p1.next]);
const p3 = await one(B, 'public.my_xp_history($1, 3)', [p2.next]);
ok(p2.items.length === 3 && p3.items.length === 2 && p3.next === null && new Set([...p1.items, ...p2.items, ...p3.items].map((x) => x.id)).size === 8, 'paging walks the whole history once, 3 + 3 + 2, and then ends');
ok((await one(B, 'public.my_xp_history(null, 1000)')).items.length === 8 && (await one(B, 'public.my_xp_history(null, 0)')).items.length === 1, 'the page size is kept between 1 and 100');
const ha = await one(A, 'public.my_xp_history()');
ok(ha.items.length === 1 && ha.items[0].amount === 50 && (await one(C, 'public.my_xp_history()')).items.length === 0, "one person's history never contains another's, and a new person's is empty");

// ---------- the internals are not callable
for (const f of [`public.progression_viewable('friend', '${fAB}')`, `public.progression_payload('${B}', true, true)`]) ok(/permission denied/.test(await refused(db, A, `select ${f}`)) && /permission denied/.test(await refused(db, null, `select ${f}`)), f.split('(')[0] + ' is internal');
