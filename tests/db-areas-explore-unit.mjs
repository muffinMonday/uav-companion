// Community flying areas, Explorer database: explore_public_areas (paginated public list beyond the viewport). Real migrations on PGlite, as guest and signed-in.
import { makeDb, as, refused, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'exp-' + String(++keyN).padStart(12, '0'), name: 'Park', description: '', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [{ type: 'shelter', note: 'x', coordinates: [verts[0][0] + 0.005, verts[0][1] + 0.005] }], ...over });
const call = async (uid, fn, args = []) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const submit = (uid, over = {}, verts) => call(uid, 'submit_community_area($1::jsonb)', [J(pay(over, verts))]);
const review = (uid, rid, decision, reason = null) => call(uid, 'review_community_area($1, $2, $3, $4, $5)', [rid, decision, reason, false, null]);
const ex = (uid, filter = {}, lim = null, off = null) => call(uid, 'explore_public_areas($1::jsonb, $2, $3)', [J(filter), lim, off]);
const err = async (uid, filter, lim = null, off = null) => (await refused(db, uid, 'select public.explore_public_areas($1::jsonb, $2, $3)', [J(filter), lim, off])) ?? '';
const names = (r) => r.areas.map((a) => a.name);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// near Singapore: Alpha (1.30, 103.80), Beta (1.40, 103.80), Gamma (1.60, 103.80); far: Delta (30.1, 120.1); non-public: pending, rejected, withdrawn, unpublished
const mk = async (uid, name, x, y, d = 0.01) => submit(uid, { name }, sq(x, y, d));
const a1 = await mk(B, 'Alpha Park', 103.8, 1.3), a2 = await mk(B, 'Beta Field', 103.8, 1.4), a3 = await mk(C, 'Gamma 100%_Lawn', 103.8, 1.6, 0.02), a4 = await mk(C, 'Delta Far', 120.1, 30.1);
const p1 = await mk(B, 'Pending Park', 103.9, 1.3), r1 = await mk(B, 'Rejected Park', 103.9, 1.35), w1 = await mk(B, 'Withdrawn Park', 103.9, 1.4), u1 = await mk(C, 'Unpublished Park', 103.9, 1.45);
for (const s of [a1, a2, a3, a4, u1]) await review(A, s.revision_id, 'approve');
await review(A, r1.revision_id, 'reject', 'no'); await call(B, 'withdraw_community_revision($1)', [w1.revision_id]); await call(A, 'unpublish_community_area($1, $2)', [u1.area_id, 'closed']);

// ---- grants
{
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as def, array_to_string(p.proconfig, ',') as cfg, p.provolatile as vol from pg_proc p where p.proname = 'explore_public_areas'`);
  ok(f.anon && f.auth && f.def && /search_path/.test(f.cfg) && f.vol === 's', 'explore_public_areas: anon and authenticated may call; stable security definer with a fixed search path');
  ok(/permission denied/.test((await refused(db, null, 'select * from public.community_areas limit 1')) ?? ''), 'guest still cannot read the tables');
}

// ---- eligibility
const all = await ex(null);
ok(names(all).length === 4 && !names(all).some((n) => /Pending|Rejected|Withdrawn|Unpublished/.test(n)), `guest sees only the four approved published areas (${names(all).join(', ')})`);
ok(names(await ex(B)).join() === names(all).join(), 'a signed-in user gets the same list');
const recKeys = Object.keys(all.areas[0]).sort().join();
ok(recKeys === 'approved_at,area_id,area_m2,center,distance_km,name,spot_count', `summary record keys only (${recKeys})`);
const dump = J(all);
ok(![A, B, C].some((u) => dump.includes(u)) && !/owner|contributor|reviewer|review_reason|xp|idempot|payload|unpublished|attribution|geometry|description/i.test(dump.replace(/Unpublished Park/g, '')), 'no user id, moderation, XP, attribution, geometry or description appears');
ok(all.areas.every((a) => a.distance_km === null && a.spot_count === 1 && a.area_m2 > 0 && typeof a.center.lat === 'number'), 'without a centre the distance is null; size, spot count and centre are present');
ok(names(all)[0] === 'Delta Far' || all.areas.every((a, i, l) => i === 0 || l[i - 1].approved_at >= a.approved_at), 'without a centre the order is most recently approved first');
ok(names(all).join() === 'Delta Far,Gamma 100%_Lawn,Beta Field,Alpha Park', 'the first approval (Alpha Park) sorts last');

// ---- nearby
const near = await ex(null, { center: { lat: 1.3, lng: 103.8 } });
ok(names(near).join() === 'Alpha Park,Beta Field,Gamma 100%_Lawn,Delta Far', `nearest first (${names(near).join(' > ')})`);
ok(near.areas[0].distance_km < 1 && Math.abs(near.areas[1].distance_km - 11.1) < 1.2 && near.areas[3].distance_km > 3000, `distances are approximate kilometres (${near.areas.map((a) => a.distance_km).join(', ')})`);
ok(names(await ex(null, { center: { lat: 1.3, lng: 103.8 }, radius_km: 25 })).join() === 'Alpha Park,Beta Field', 'a 25 km radius keeps the two close areas');
ok(names(await ex(null, { center: { lat: 1.3, lng: 103.8 }, radius_km: 1 })).join() === 'Alpha Park', 'a 1 km radius keeps one');
ok(names(await ex(null, { center: { lat: 60, lng: 10 }, radius_km: 100 })).length === 0, 'an empty result is a safe empty page');
ok((await ex(null, { center: { lat: 60, lng: 10 }, radius_km: 100 })).has_more === false, 'an empty page has no more');
ok(names(await ex(null, { center: { lat: 1.3, lng: 179.9 }, radius_km: 50 })).length === 0, 'a centre near the antimeridian is handled');

// ---- search
ok(names(await ex(null, { query: 'park' })).join() === 'Alpha Park', 'name search is case-insensitive and public-only (pending/rejected/unpublished parks are not found)');
ok(names(await ex(null, { query: '100%' })).join() === 'Gamma 100%_Lawn' && names(await ex(null, { query: '%' })).join() === 'Gamma 100%_Lawn', 'a percent sign is literal, not a wildcard');
ok(names(await ex(null, { query: '_' })).join() === 'Gamma 100%_Lawn' && names(await ex(null, { query: 'a_p' })).length === 0, 'an underscore is literal');
ok(names(await ex(null, { query: '\\' })).length === 0, 'a backslash is literal');
ok(names(await ex(null, { query: "x'; drop table public.community_areas; --" })).length === 0 && (await q('select count(*)::int c from public.community_areas'))[0].c === 8, 'an injection-shaped search finds nothing and changes nothing');
ok(names(await ex(null, { query: '   ' })).length === 4 && names(await ex(null, { query: null })).length === 4, 'a blank or null query is no filter');
ok(names(await ex(null, { query: 'f', center: { lat: 1.3, lng: 103.8 }, radius_km: 100 })).join() === 'Beta Field', 'query and radius combine');

// ---- paging: bounded
for (let i = 0; i < 7; i++) { const s = await mk(B, `Bulk ${String(i).padStart(2, '0')}`, 104 + i * 0.1, 1.3); await review(A, s.revision_id, 'approve'); }
const p1p = await ex(null, { center: { lat: 1.3, lng: 103.8 } }, 5, 0), p2p = await ex(null, { center: { lat: 1.3, lng: 103.8 } }, 5, 5), p3p = await ex(null, { center: { lat: 1.3, lng: 103.8 } }, 5, 10);
ok(p1p.areas.length === 5 && p1p.has_more && p2p.areas.length === 5 && p2p.has_more && p3p.areas.length === 1 && !p3p.has_more, 'pages of 5: 5, 5, 1 and has_more tracks the end');
ok(new Set([...names(p1p), ...names(p2p), ...names(p3p)]).size === 11, 'pages do not overlap or skip');
ok((await ex(null, {}, 1000)).areas.length === 11 && (await ex(null, {}, 1000)).has_more === false, 'a limit above 50 is cut to 50 (all 11 fit)');
ok((await ex(null)).areas.length === 11 && (await ex(null, {}, null, null)).areas.length === 11, 'the default limit is 20');

// ---- validation
for (const [label, filter, lim, off, code] of [
  ['unknown key', { owner: 'x' }, null, null, 'invalid_filter'], ['filter not an object', [1], null, null, 'invalid_filter'],
  ['query not text', { query: 5 }, null, null, 'invalid_query'], ['query too long', { query: 'x'.repeat(61) }, null, null, 'invalid_query'],
  ['centre missing lng', { center: { lat: 1 } }, null, null, 'invalid_center'], ['centre text', { center: { lat: '1', lng: '2' } }, null, null, 'invalid_center'],
  ['centre extra key', { center: { lat: 1, lng: 2, x: 3 } }, null, null, 'invalid_center'], ['latitude out of range', { center: { lat: 91, lng: 0 } }, null, null, 'invalid_center'],
  ['longitude out of range', { center: { lat: 0, lng: 181 } }, null, null, 'invalid_center'], ['radius without centre', { radius_km: 10 }, null, null, 'invalid_radius'],
  ['radius too small', { center: { lat: 0, lng: 0 }, radius_km: 0.5 }, null, null, 'invalid_radius'], ['radius too large', { center: { lat: 0, lng: 0 }, radius_km: 501 }, null, null, 'invalid_radius'],
  ['radius text', { center: { lat: 0, lng: 0 }, radius_km: '10' }, null, null, 'invalid_radius'],
  ['limit zero', {}, 0, null, 'invalid_limit'], ['negative offset', {}, 5, -1, 'invalid_offset'], ['offset past the bound', {}, 5, 501, 'invalid_offset'],
]) ok((await err(null, filter, lim, off)).includes(code), `${label} is refused (${code})`);
ok(names(await ex(null, {}, 5, 500)).length === 0, 'the largest allowed offset returns an empty page, not an error');

// ---- lifecycle: a decision shows at once; revisions do not leak
await call(A, 'unpublish_community_area($1, $2)', [a2.area_id, 'closed']);
ok(!names(await ex(null)).includes('Beta Field'), 'an unpublished area leaves the list immediately');
const rev = await call(B, 'submit_community_revision($1, $2::jsonb)', [a1.area_id, J(pay({ name: 'Alpha Park RENAMED' }, sq(103.8, 1.3, 0.011)))]);
ok(names(await ex(null)).includes('Alpha Park') && !names(await ex(null)).some((n) => /RENAMED/.test(n)), 'a pending revision does not change the published listing');
await review(A, rev.revision_id, 'approve');
ok(names(await ex(null)).includes('Alpha Park RENAMED') && !names(await ex(null)).includes('Alpha Park'), 'an approved revision replaces the name in the list');
ok(names(await ex(null, { query: 'Alpha' })).length === 1, 'the area is listed once, not once per revision');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
