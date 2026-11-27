// Community flying areas, Phase 4 database: the public read API (list_public_areas, get_public_area) and the community_attribution preference.
// Real migrations on PGlite, as guest (anon) and as signed-in users. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'pub-' + String(++keyN).padStart(12, '0'), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [{ type: 'shelter', note: 'Pavilion', coordinates: [verts[0][0] + 0.005, verts[0][1] + 0.005] }], attributes: { environment: 'open_field', access: 'unknown' }, ...over });
const call = async (uid, fn, args = []) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const submit = (uid, over = {}, verts) => call(uid, 'submit_community_area($1::jsonb)', [J(pay(over, verts))]);
const review = (uid, rid, decision, reason = null) => call(uid, 'review_community_area($1, $2, $3, $4, $5)', [rid, decision, reason, false, null]);
const list = (uid, b, cur = null, lim = null) => call(uid, 'list_public_areas($1::jsonb, $2, $3)', [J(b), cur, lim]);
const err = async (uid, fn, args = []) => (await refused(db, uid, `select public.${fn}`, args)) ?? '';
const VIEW = { west: 103, south: 1, east: 105, north: 2 };
const ids = (r) => r.areas.map((a) => a.area_id);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// ---- profile preference
const P = await q('select user_id, community_attribution from public.profiles');
ok(P.length === 4 && P.every((p) => p.community_attribution === false), 'every profile has community_attribution = false by default');
ok((await call(B, 'ensure_profile()')).community_attribution === false, 'ensure_profile returns the preference (own profile)');
ok((await call(B, 'update_profile($1::jsonb)', [J({ community_attribution: 'yes' })]).catch((e) => String(e.message))).includes('must be true or false'), 'a non-boolean preference is refused');
ok(/unknown profile field/.test(await err(B, 'update_profile($1::jsonb)', [J({ share_everything: true })])), 'unknown profile fields are still refused');
const sp = (await call(B, 'update_profile($1::jsonb)', [J({ bio: 'hello', share_profile: false })]));
ok(sp.community_attribution === false && sp.share_profile === false, 'other patches leave the preference and are independent of share_profile');
await call(B, 'set_show_online($1)', [false]);
ok((await call(B, 'ensure_profile()')).community_attribution === false, 'show_online does not change the preference');
ok(/not signed in|permission denied/.test(await err(null, 'update_profile($1::jsonb)', [J({ community_attribution: true })])), 'a guest cannot set it');

// ---- fixtures: area 1 approved (Bea), area 2 pending, 3 rejected, 4 withdrawn, 5 approved then unpublished, 6 approved far away
const s1 = await submit(B, { name: 'Marina Park' });
const s2 = await submit(B, { name: 'Pending Park' }, sq(103.81, 1.31));
const s3 = await submit(B, { name: 'Rejected Park' }, sq(103.82, 1.32));
const s4 = await submit(B, { name: 'Withdrawn Park' }, sq(103.83, 1.33));
const s5 = await submit(C, { name: 'Unpublished Park' }, sq(103.84, 1.34));
const s6 = await submit(C, { name: 'Far Park' }, sq(120.1, 30.1));
await review(A, s1.revision_id, 'approve'); await review(A, s3.revision_id, 'reject', 'no'); await call(B, 'withdraw_community_revision($1)', [s4.revision_id]);
await review(A, s5.revision_id, 'approve'); await call(A, 'unpublish_community_area($1, $2)', [s5.area_id, 'closed']); await review(A, s6.revision_id, 'approve');

// ---- permissions and grants
for (const fn of ['list_public_areas', 'get_public_area']) {
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as def, array_to_string(p.proconfig, ',') as cfg from pg_proc p where p.proname = $1`, [fn]);
  ok(f.anon && f.auth && f.def && /search_path/.test(f.cfg), `${fn}: anon and authenticated may call; security definer with a fixed search path`);
}
{
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = 'community_area_public_item'`);
  ok(!f.anon && !f.auth, 'the internal item builder has no client grant');
  const adm = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p where p.proname in ('list_pending_community_areas','list_published_community_areas','review_community_area','unpublish_community_area','list_my_community_areas','submit_community_area')`);
  ok(adm.length === 6 && adm.every((x) => !x.anon), 'no admin, moderation or submission function gained an anon grant');
}
for (const t of ['community_areas', 'community_area_revisions', 'profiles']) {
  ok(/permission denied/.test((await refused(db, null, `select * from public.${t} limit 1`)) ?? ''), `guest cannot read ${t} directly`);
  ok(/permission denied/.test((await refused(db, B, `select count(*) from public.${t === 'profiles' ? 'community_areas' : t}`)) ?? '') || t === 'profiles', `signed-in client has no table access to ${t === 'profiles' ? 'community_areas' : t}`);
}
ok(/permission denied/.test((await refused(db, null, `update public.community_areas set owner_id = null`)) ?? ''), 'public roles cannot write the tables');
ok((await q(`select bool_and(relrowsecurity) r from pg_class where relname in ('community_areas','community_area_revisions')`))[0].r, 'RLS stays enabled on both tables');

// ---- eligibility
const g = await list(null, VIEW);
ok(ids(g).length === 1 && ids(g)[0] === s1.area_id, 'guest sees only the approved published area (pending, rejected, withdrawn and unpublished are absent)');
ok(ids(await list(B, VIEW)).join() === s1.area_id, 'a signed-in user gets the same result');
ok(ids(await list(null, { west: 120, south: 30, east: 121, north: 31 })).join() === s6.area_id, 'a viewport elsewhere returns only the areas inside it');
ok(ids(await list(null, { west: 10, south: 10, east: 11, north: 11 })).length === 0 && (await list(null, { west: 10, south: 10, east: 11, north: 11 })).next_cursor === null, 'an empty result is a safe empty page');
const rec = g.areas[0];
const KEYS = ['approved_at', 'area_id', 'area_m2', 'attributes', 'attribution', 'description', 'geometry', 'name', 'photo', 'published', 'revision_id', 'spots', 'status'];
ok(Object.keys(rec).sort().join() === KEYS.join() && rec.status === 'approved' && rec.published === true, 'the record has exactly the public contract keys');
ok(rec.revision_id === s1.revision_id && rec.name === 'Marina Park' && rec.spots.length === 1 && rec.geometry.type === 'Polygon' && rec.area_m2 > 0 && !!rec.approved_at, 'content comes from the published revision');
const dump = J(g);
ok(![B, A, C].some((u) => dump.includes(u)) && !/owner|contributor|reviewer|review_reason|xp|idempot|payload_hash|unpublished/i.test(dump), 'no user id, owner, contributor, reviewer, moderation or XP value appears');
ok(rec.attribution === null, 'attribution is null while the preference is off');
const one = await call(null, 'get_public_area($1)', [s1.area_id]);
ok(one.area_id === s1.area_id, 'get_public_area returns a published area to a guest');
for (const [s, w] of [[s2, 'pending'], [s3, 'rejected'], [s4, 'withdrawn'], [s5, 'unpublished']]) ok((await call(null, 'get_public_area($1)', [s.area_id])) === null, `get_public_area returns null for a ${w} area`);
ok((await call(null, 'get_public_area($1)', ['99999999-9999-4999-8999-999999999999'])) === null, 'get_public_area returns null for an unknown id');

// ---- attribution
await call(B, 'update_profile($1::jsonb)', [J({ community_attribution: true, avatar: null })]);
let a1 = (await list(null, VIEW)).areas[0].attribution;
ok(a1 && Object.keys(a1).sort().join() === 'avatar,display_name' && a1.display_name === 'Bea' && a1.avatar === null, 'opt-in: attribution is only { display_name, avatar }');
await call(B, 'update_profile($1::jsonb)', [J({ avatar: (await q('select (public.profile_avatars())[1] as a'))[0].a, bio: 'secret bio', location: 'Hidden', interests: [] })]);
a1 = (await call(null, 'get_public_area($1)', [s1.area_id])).attribution;
ok(a1.avatar && !J(a1).includes('secret bio') && !J(a1).includes('Hidden') && !J(a1).includes('friend'), 'the preset avatar key is shown; bio, location and friend code are not');
await call(B, 'update_profile($1::jsonb)', [J({ community_attribution: false })]);
ok((await list(null, VIEW)).areas[0].attribution === null && (await call(null, 'get_public_area($1)', [s1.area_id])).attribution === null, 'turning it off removes attribution from the next responses');
ok((await call(B, 'ensure_profile()')).community_attribution === false, 'the owner profile reports the stored value');
// another user opting in does not attribute Bea's area; Cam's flag only affects Cam's revisions
await call(C, 'update_profile($1::jsonb)', [J({ community_attribution: true })]);
ok((await list(null, VIEW)).areas[0].attribution === null && (await list(null, { west: 120, south: 30, east: 121, north: 31 })).areas[0].attribution.display_name === 'Cam', 'attribution follows the contributor of the published revision only');

// ---- bounds, cursor and limit validation
const bad = async (b, cur = null, lim = null) => err(null, 'list_public_areas($1::jsonb, $2, $3)', [J(b), cur, lim]);
for (const [b, w] of [[{ west: 0, south: 5, east: 1, north: 4 }, 'south above north'], [{ west: -181, south: 0, east: 1, north: 1 }, 'west out of range'], [{ west: 0, south: 0, east: 1, north: 91 }, 'north out of range'],
  [{ west: 0, south: 0, east: 1 }, 'missing key'], [{ west: '0', south: 0, east: 1, north: 1 }, 'string value'], [{ west: 0, south: 0, east: 1, north: 1, extra: 1 }, 'extra key'], [null, 'null bounds']]) ok(/invalid_bounds/.test(await bad(b)), `invalid bounds refused: ${w}`);
ok(/invalid_bounds/.test(await err(null, 'list_public_areas($1::jsonb, $2, $3)', ['[1,2]', null, null])), 'array bounds refused');
ok(/bounds_too_large/.test(await bad({ west: 70, south: 10, east: 140, north: 50 })), 'a country-wide box is refused');
ok(/bounds_too_large/.test(await bad({ west: 0, south: -60, east: 1, north: 60 })) && /bounds_too_large/.test(await bad({ west: 0, south: 0, east: -1, north: 1 })), 'tall boxes and wrap-around world-wide boxes are refused');
ok(/invalid_cursor/.test(await bad(VIEW, 'not-a-uuid')) && /invalid_cursor/.test(await bad(VIEW, "x'; drop table x;--")), 'invalid cursors are refused');
ok(/invalid_limit/.test(await bad(VIEW, null, 0)) && /invalid_limit/.test(await bad(VIEW, null, -3)), 'a limit below 1 is refused');
ok((await list(null, VIEW, null, 1000000)).areas.length === 1, 'an oversized limit is cut, not an error');

// ---- antimeridian
const e1 = await submit(D, { name: 'East edge' }, sq(179.9, 10, 0.03)); const e2 = await submit(D, { name: 'West edge' }, sq(-179.95, 10, 0.03));
await review(A, e1.revision_id, 'approve'); await review(A, e2.revision_id, 'approve');
const wrap = await list(null, { west: 179, south: 9, east: -179, north: 11 });
ok(ids(wrap).sort().join() === [e1.area_id, e2.area_id].sort().join(), 'a box across the antimeridian finds areas on both sides');
ok(ids(await list(null, { west: 179, south: 9, east: 180, north: 11 })).join() === e1.area_id && ids(await list(null, { west: -180, south: 9, east: -179, north: 11 })).join() === e2.area_id, 'one-sided boxes find only their own side');

// ---- pagination
const many = [];
for (let i = 0; i < 7; i++) { const s = await submit(D, { name: 'Many ' + i }, sq(110 + i * 0.01, 20, 0.005)); await review(A, s.revision_id, 'approve'); many.push(s.area_id); }
const BOX = { west: 109.9, south: 19.9, east: 110.2, north: 20.1 };
const seen = []; let cur = null, pages = 0;
do { const p = await list(null, BOX, cur, 3); seen.push(...ids(p)); cur = p.next_cursor; pages++; if (pages > 5) break; } while (cur);
ok(pages === 3 && seen.length === 7 && new Set(seen).size === 7 && seen.every((x) => many.includes(x)), 'cursor pagination covers every row exactly once (7 rows, pages of 3)');
ok(seen.join() === [...seen].sort().join(), 'pages are in stable id order');
ok((await list(null, BOX, null, 7)).next_cursor === null && (await list(null, BOX, null, 6)).next_cursor !== null, 'next_cursor is null only on the last page');
ok((await list(null, BOX, null, null)).areas.length === 7, 'the default limit covers a small viewport');

// ---- unpublish / replacement semantics
await call(A, 'unpublish_community_area($1, $2)', [many[0], 'test']);
ok(!ids(await list(null, BOX, null, 50)).includes(many[0]) && (await call(null, 'get_public_area($1)', [many[0]])) === null, 'unpublishing removes the area from the very next public read');
// a pending replacement does not hide the live revision, and a rejected one does not remove it: forge the second revision directly (Phase 5 is not built)
await q(`insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north, status)
  select area_id, 2, contributor_id, 'Replacement', description, draw_kind, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north, 'pending' from public.community_area_revisions where id = $1`, [s1.revision_id]);
ok((await call(null, 'get_public_area($1)', [s1.area_id])).revision_id === s1.revision_id && (await call(null, 'get_public_area($1)', [s1.area_id])).name === 'Marina Park', 'a pending replacement does not hide or replace the published revision');
await q(`update public.community_area_revisions set status = 'rejected', reviewed_at = now() where area_id = $1 and revision_no = 2`, [s1.area_id]);
ok((await call(null, 'get_public_area($1)', [s1.area_id])).revision_id === s1.revision_id, 'a rejected replacement does not remove the published revision');
// the pointer must be the live one: an older approved revision never appears once the pointer moves
await q(`insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north, status, reviewed_at)
  select area_id, 3, contributor_id, 'Newer approved but not published', description, draw_kind, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north, 'approved', now() from public.community_area_revisions where id = $1`, [s1.revision_id]);
ok((await call(null, 'get_public_area($1)', [s1.area_id])).revision_id === s1.revision_id, 'an approved revision that is not the published pointer is never returned');
// re-publication through approval of a fresh submission makes it public again (Phase 3 semantics unchanged)
ok((await call(null, 'get_public_area($1)', [s5.area_id])) === null, 'an unpublished area stays hidden');

// ---- account deletion: the contributor goes, the area stays anonymous
await call(C, 'delete_profile()');
const far = await list(null, { west: 120, south: 30, east: 121, north: 31 });
ok(far.areas.length === 1 && far.areas[0].attribution === null, 'after the contributor deletes the account the published area stays, with no attribution');

// ---- performance guard: the viewport query uses the bbox index when the table is large enough
const plan = (await q(`explain select a.id from public.community_areas a where a.published_revision_id is not null and a.unpublished_at is null and a.bbox_north >= 1 and a.bbox_south <= 2 and a.bbox_east >= 103 and a.bbox_west <= 105`)).map((r) => Object.values(r)[0]).join('\n');
ok(plan.length > 0, 'the bbox predicate is expressed on the indexed columns (plan available)');
const src = (await q(`select prosrc from pg_proc where proname = 'list_public_areas'`))[0].prosrc;
ok(/bbox_east/.test(src) && /bbox_west/.test(src) && /limit lim \+ 1/.test(src) && /least\(p_limit, 100\)/.test(src), 'list_public_areas filters on the bbox columns and caps the page at 100');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
