// Community flying areas, Phase 2 database: tables, submission, limits, idempotency, ownership, privacy, withdrawal, account deletion, and
// parity of the SQL geometry rules with the Phase 1 client rules (src/areas/core.js). Real migrations on PGlite, as different users.
// PGlite runs one query at a time, so "concurrent" calls are serialised here; their correctness rests on the per-account advisory lock plus the unique indexes,
// both asserted directly below. No browser, no network.
import { makeDb, as, refused, A, B, C } from './lib-db.mjs';
import { validateArea, closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
const count = async (t, w = 'true') => (await q(`select count(*)::int n from public.${t} where ${w}`))[0].n;
let keyN = 0;
const key = () => 'key-' + String(++keyN).padStart(12, '0');
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const circle = (n, r = 0.005) => Array.from({ length: n }, (_, i) => [103.8 + r * Math.cos(2 * Math.PI * i / n), 1.3 + r * Math.sin(2 * Math.PI * i / n)]);
const ringOf = (verts) => (verts.some((p) => !Array.isArray(p) || p.some((n) => typeof n !== 'number' || Math.abs(n) > 1e6)) ? [...verts, verts[0]] : closeRing(verts));
const pay = (over = {}, verts = sq()) => ({ idempotency_key: key(), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [ringOf(verts)] }, spots: [], ...over });
const STRICT = new Set(); // accounts whose pending count the tests manage themselves; every other account is kept below the five-pending limit
const submit = async (uid, p) => {
  if (!STRICT.has(uid) && (await count('community_area_revisions', `contributor_id = '${uid}' and status = 'pending'`)) >= 4) await q(`update public.community_area_revisions set status = 'withdrawn' where contributor_id = '${uid}' and status = 'pending'`);
  return as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [J(p)]).then((r) => r[0].r);
};
const bad = async (uid, p) => (await refused(db, uid, 'select public.submit_community_area($1::jsonb)', [J(p)])) ?? '';

// ---- authentication and ownership
ok(/permission denied/.test(await bad(null, pay())), 'a guest cannot call submit_community_area (no execute grant)');
ok(/permission denied/.test((await refused(db, null, 'select * from public.list_my_community_areas()')) ?? ''), 'a guest cannot list');
ok(/permission denied/.test((await refused(db, null, 'select public.withdraw_community_revision($1)', ['00000000-0000-4000-8000-000000000000'])) ?? ''), 'a guest cannot withdraw');
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','',false);`);
ok(/not signed in/.test((await db.query('select public.submit_community_area($1::jsonb)', [J(pay())]).catch((e) => e)).message ?? ''), 'authenticated role without a user id: not signed in');
await db.exec('reset role');
const r1 = await submit(A, pay({ name: '  Marina   park ' }, sq()));
ok(r1.status === 'pending' && r1.revision_no === 1 && r1.replayed === false && /^[0-9a-f-]{36}$/.test(r1.area_id) && !('owner_id' in r1) && !('contributor_id' in r1), 'a signed-in user submits; the result holds only submission identifiers and status');
const row = (await q('select r.*, a.owner_id from public.community_area_revisions r join public.community_areas a on a.id = r.area_id where r.id = $1', [r1.revision_id]))[0];
ok(row.owner_id === A && row.contributor_id === A && row.name === 'Marina park' && row.status === 'pending', 'owner and contributor are auth.uid(); the name is normalised');
const ring = row.geometry.coordinates[0];
ok(ring.length === 5 && J(ring[0]) === J(ring[4]) && row.bbox_west === 103.8 && row.bbox_north === 1.31 && row.area_m2 > 1e6 && row.area_m2 < 1.3e6, 'closed ring, server-derived bounding box and area');
const cw = [[103.8, 1.3], [103.8, 1.31], [103.81, 1.31], [103.81, 1.3]]; // clockwise as given
const r2 = await submit(A, { ...pay({}, cw), geometry: { type: 'Polygon', coordinates: [[...cw, cw[0]]] } });
const ring2 = (await q('select geometry from public.community_area_revisions where id = $1', [r2.revision_id]))[0].geometry.coordinates[0];
const twice = ring2.slice(0, -1).reduce((s, a, i, v) => s + a[0] * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * a[1], 0);
ok(twice > 0, 'a clockwise ring is stored counter-clockwise');

for (const f of ['owner_id', 'contributor_id', 'user_id', 'reviewed_by', 'status', 'area_id']) ok(/unknown-field/.test(await bad(B, pay({ [f]: A }))), `a client-supplied ${f} is refused`);
const mine = await as(db, A, 'select * from public.list_my_community_areas()');
ok(mine.length === 2 && mine.every((m) => m.status === 'pending' && m.published === false) && !mine.some((m) => 'owner_id' in m || 'contributor_id' in m || 'reviewed_by' in m || 'geometry' in m), 'owner list: own submissions only, no person identifiers, no geometry');
ok((await as(db, B, 'select * from public.list_my_community_areas()')).length === 0, "another user's list is empty");
ok(/not_found/.test((await refused(db, B, 'select public.withdraw_community_revision($1)', [r1.revision_id])) ?? ''), "another user cannot withdraw (or learn about) someone else's revision");
ok((await q('select status from public.community_area_revisions where id = $1', [r1.revision_id]))[0].status === 'pending', '...and it is untouched');

// ---- validation
const codeOf = async (p) => ((await bad(A, p)).match(/invalid_area: ([a-z_-]+)/) ?? [])[1] ?? 'ACCEPTED?' + (await bad(A, p));
ok((await submit(A, pay({}, sq().slice(0, 3)))).status === 'pending', '3 vertices accepted');
ok((await submit(A, pay({}, circle(100)))).status === 'pending', '100 vertices accepted');
ok(await codeOf(pay({}, circle(101))) === 'vertex-count', '101 vertices rejected');
ok(await codeOf(pay({}, sq().slice(0, 2))) === 'vertex-count', '2 vertices rejected');
for (const [label, p] of [['latitude 91', [103.8, 91]], ['longitude 181', [181, 1.3]], ['string', ['1', '2']], ['short', [1]], ['null', null]]) {
  ok(await codeOf(pay({}, [...sq().slice(0, 3), p])) === 'bad-coordinate', `invalid coordinate rejected: ${label}`);
}
ok(await codeOf(pay({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1e999, 1], [1, 1], [0, 0]]] } })) !== 'ACCEPTED?', 'a huge number is refused without a raw SQL error');
ok(await codeOf(pay({}, [[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01]])) === 'self-intersection', 'a bow-tie is rejected');
ok(['degenerate', 'self-intersection'].includes(await codeOf(pay({}, [[0, 0], [0.005, 0], [0.01, 0]]))), 'a line is rejected');
ok(await codeOf(pay({}, [sq()[0], sq()[1], sq()[2], sq()[1]])) === 'duplicate-vertex', 'a repeated vertex is rejected');
ok(await codeOf(pay({}, [[0, 0], [0.01, 0], [0.01, 0.01], [0.005, 0], [0, 0.01]])) === 'self-intersection', 'a vertex touching an edge is rejected');
ok(await codeOf(pay({}, [[179.99, 1], [-179.99, 1], [-179.99, 1.01], [179.99, 1.01]])) === 'antimeridian', 'antimeridian crossing rejected');
ok(await codeOf(pay({ geometry: { type: 'Polygon', coordinates: [closeRing(sq()), closeRing(sq(103.802, 1.302, 0.002))] } })) === 'holes', 'holes rejected');
ok(await codeOf(pay({ geometry: { type: 'MultiPolygon', coordinates: [[closeRing(sq())]] } })) === 'geometry', 'MultiPolygon rejected');
ok(await codeOf(pay({ geometry: { type: 'Point', coordinates: [1, 1] } })) === 'geometry', 'a Point is rejected');
// area boundary: a rectangle of 0.04 degrees at the equator is about 19.8 km2; scale to straddle 25 km2
const rectAt = (d) => [[0, 0], [d, 0], [d, d], [0, d]];
const side = (a) => { let lo = 0.01, hi = 0.1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; (validateArea({ name: 'x', geometry: { type: 'Polygon', coordinates: [closeRing(rectAt(m))] } }).area?.areaM2 ?? 26e6) < a ? lo = m : hi = m; } return lo; };
const edge = side(25e6);
ok((await submit(A, pay({}, rectAt(Math.floor(edge * 1e7) / 1e7 - 2e-7)))).status === 'pending', 'just under 25 km2 accepted');
ok(await codeOf(pay({}, rectAt(Math.ceil(edge * 1e7) / 1e7 + 2e-7))) === 'too-large', 'just over 25 km2 rejected');
ok(await codeOf(pay({}, rectAt(0.1))) === 'too-large', 'far over 25 km2 rejected');
ok(await codeOf(pay({ name: '' })) === 'name' && await codeOf(pay({ name: 'x'.repeat(81) })) === 'name' && await codeOf(pay({ name: 5 })) === 'name', 'name 1 to 80 characters');
ok((await submit(A, pay({ name: '🛸'.repeat(80) }))).status === 'pending', '80 emoji are 80 characters');
ok(await codeOf(pay({ description: 'x'.repeat(501) })) === 'description', 'description over 500 rejected');
ok((await submit(A, pay({ description: 'x'.repeat(500) }))).status === 'pending', 'description of 500 accepted');
const spot = (o = {}) => ({ type: 'shelter', note: 'hut', coordinates: [103.805, 1.305], ...o });
ok((await submit(A, pay({ spots: [spot(), spot({ type: 'seating' }), spot({ type: 'open' }), spot({ type: 'other', coordinates: [103.8, 1.3] })] }))).status === 'pending', 'four spot types accepted, a spot on a vertex is inside');
ok(await codeOf(pay({ spots: [spot({ type: 'parking' })] })) === 'bad-spot-type', 'unknown spot type rejected');
ok(await codeOf(pay({ spots: [spot({ coordinates: [103.9, 1.305] })] })) === 'spot-outside', 'spot outside rejected');
ok(await codeOf(pay({ spots: Array.from({ length: 11 }, () => spot()) })) === 'too-many-spots', 'more than 10 spots rejected');
ok((await submit(A, pay({ spots: Array.from({ length: 10 }, () => spot()) }))).status === 'pending', '10 spots accepted');
ok(await codeOf(pay({ spots: [spot({ note: 'x'.repeat(121) })] })) === 'bad-note', 'spot note over 120 rejected');
ok(await codeOf(pay({ spots: 'x' })) === 'spots', 'spots must be a list');
ok(await codeOf(pay({ draw_kind: 'circle' })) === 'draw_kind', 'unknown draw kind rejected');
ok(await codeOf({ ...pay(), description: 'x'.repeat(40000) }) === 'payload-size', 'oversized payload rejected');
for (const k of [undefined, 'short', 'x'.repeat(65), 'has space has space', 5]) ok(await codeOf({ ...pay(), idempotency_key: k }) === 'idempotency-key', `bad idempotency key refused: ${String(k).slice(0, 12)}`);
ok(/invalid_area: payload/.test(await bad(A, [1])) && /invalid_area: payload/.test((await refused(db, A, 'select public.submit_community_area(null)')) ?? ''), 'non-object payloads refused');
ok(!/syntax|relation|column|function public/.test(await bad(A, pay({ geometry: 'x' }))), 'errors carry no SQL details');

// ---- idempotency
const base = pay({ name: 'Idem' });
const first = await submit(B, base);
const again = await submit(B, { ...base, name: ' Idem ', description: ' Open grass ' }).catch((e) => e);
ok(again.replayed === true && again.revision_id === first.revision_id, 'same key, equivalent payload (name and description spacing): the existing result, replayed');
ok((await submit(B, base)).revision_id === first.revision_id && await count('community_area_revisions', `contributor_id = '${B}'`) === 1, 'a retry creates nothing new');
ok(/idempotency_conflict/.test(await bad(B, { ...base, name: 'Different' })), 'same key, different payload: idempotency_conflict');
ok((await submit(C, { ...base })).replayed === false, "the same key from another account is independent (scoped to the contributor)");
const many = await Promise.all(Array.from({ length: 3 }, () => submit(B, pay({ name: 'Racer' }, sq(104, 1)))));
ok(new Set(many.map((m) => m.revision_id)).size === 3, 'distinct keys create distinct submissions');
const k2 = pay({ name: 'Same key race' }, sq(105, 1));
const dup = await Promise.all(Array.from({ length: 4 }, () => submit(C, k2).catch((e) => e)));
ok(new Set(dup.map((d) => d.revision_id)).size === 1 && dup.filter((d) => d.replayed === false).length === 1, 'simultaneous duplicate requests with one key create one submission');

// ---- limits (five pending per account, one pending per area)
const L = '66666666-6666-4666-8666-666666666666'; STRICT.add(L);
await q(`insert into auth.users (id, email) values ('${L}', 'l@example.test')`);
const ids = [];
for (let i = 0; i < 5; i++) ids.push((await submit(L, pay({ name: 'L' + i }, sq(10 + i * 0.1, 1)))).revision_id);
ok(/pending_limit_reached/.test(await bad(L, pay())), 'the sixth pending submission is refused');
const lim = await Promise.all(Array.from({ length: 3 }, () => as(db, L, 'select public.submit_community_area($1::jsonb)', [J(pay())]).catch((e) => e)));
ok(lim.every((e) => /pending_limit_reached/.test(e.message ?? '')) && await count('community_area_revisions', `contributor_id = '${L}' and status = 'pending'`) === 5, 'parallel attempts at the limit all fail; still exactly five');
const replay5 = await submit(L, { ...pay({ name: 'L0' }, sq(10, 1)), idempotency_key: (await q('select idempotency_key k from public.community_area_revisions where id = $1', [ids[0]]))[0].k });
ok(replay5.replayed === true, 'a replay at the limit still returns the existing result');
const wd = await as(db, L, 'select public.withdraw_community_revision($1) as r', [ids[0]]).then((r) => r[0].r);
ok(wd.status === 'withdrawn' && wd.changed === true, 'withdraw a pending revision');
ok((await as(db, L, 'select public.withdraw_community_revision($1) as r', [ids[0]]))[0].r.changed === false, 'withdrawing twice is a no-op');
const race = await Promise.all([submit(L, pay({ name: 'After' }, sq(20, 1))).catch((e) => e), as(db, L, 'select public.withdraw_community_revision($1) as r', [ids[1]])]);
ok(race[0].status === 'pending' && race[1][0].r.status === 'withdrawn' && [3, 4].includes(await count('community_area_revisions', `contributor_id = '${L}' and status = 'pending'`)), 'withdrawal racing a submission: both complete, the count follows from both')
ok(await count('community_area_revisions', `contributor_id = '${L}' and status = 'pending'`) <= 5, 'pending count stays within the limit');
await q(`update public.community_area_revisions set status = 'approved', reviewed_at = now() where id = $1`, [ids[2]]);
ok(/not_withdrawable/.test((await refused(db, L, 'select public.withdraw_community_revision($1)', [ids[2]])) ?? ''), 'an approved revision cannot be withdrawn');
await q(`update public.community_area_revisions set status = 'rejected', reviewed_at = now() where id = $1`, [ids[3]]);
ok(/not_withdrawable/.test((await refused(db, L, 'select public.withdraw_community_revision($1)', [ids[3]])) ?? ''), 'a rejected revision cannot be withdrawn');
ok((await q('select status from public.community_area_revisions where id = $1', [ids[2]]))[0].status === 'approved', '...and the approved revision is untouched');
const aid = (await q('select area_id from public.community_area_revisions where id = $1', [ids[2]]))[0].area_id;
await q('update public.community_areas set published_revision_id = $1 where id = $2', [ids[2], aid]);
const pubRow = (await q('select * from public.community_areas where id = $1', [aid]))[0];
ok(pubRow.published_revision_id === ids[2] && pubRow.bbox_west === 10.2 && pubRow.bbox_north === 1.01, 'a published revision sets the area bounding box from the revision');
ok(/only an approved revision/.test((await db.query('update public.community_areas set published_revision_id = $1 where id = $2', [ids[4], (await q('select area_id from public.community_area_revisions where id = $1', [ids[4]]))[0].area_id]).catch((e) => e)).message ?? ''), 'a pending revision cannot be published');
ok(/only an approved revision|foreign key|violates/.test((await db.query('update public.community_areas set published_revision_id = $1 where id = $2', [ids[2], (await q('select area_id from public.community_area_revisions where id = $1', [ids[4]]))[0].area_id]).catch((e) => e)).message ?? ''), "a revision of another area cannot be the published one");
ok((await db.query('delete from public.community_area_revisions where id = $1', [ids[2]]).catch((e) => e)).message !== undefined, 'a published revision cannot be deleted from under its area');
const wd2 = await as(db, L, 'select * from public.list_my_community_areas()');
ok(wd2.find((x) => x.revision_id === ids[2]).published === true, 'the owner list marks the published revision');
// one pending revision per area
ok(/duplicate key|unique/.test((await db.query(`insert into public.community_area_revisions (area_id, revision_no, name, geometry, area_m2, bbox_west, bbox_south, bbox_east, bbox_north) select area_id, 2, 'x', geometry, 100, 0, 0, 1, 1 from public.community_area_revisions where id = $1`, [ids[4]]).catch((e) => e)).message ?? ''), 'a second pending revision of one area is refused by the database');
ok(/duplicate key|unique/.test((await db.query(`insert into public.community_area_revisions (area_id, revision_no, name, geometry, area_m2, bbox_west, bbox_south, bbox_east, bbox_north, status) select area_id, 1, 'x', geometry, 100, 0, 0, 1, 1, 'withdrawn' from public.community_area_revisions where id = $1`, [ids[4]]).catch((e) => e)).message ?? ''), '(area_id, revision_no) is unique');
const dpend = await q(`select pg_get_functiondef('public.submit_community_area(jsonb)'::regprocedure) d`);
ok(/pg_advisory_xact_lock/.test(dpend[0].d), 'submission takes a per-account advisory lock (serialises key lookup, limit count and insert)');

// ---- immutability
ok(/cannot be changed/.test((await db.query(`update public.community_area_revisions set name = 'Hacked' where id = $1`, [ids[4]]).catch((e) => e)).message ?? ''), 'submitted content is immutable');
ok(/cannot be changed/.test((await db.query(`update public.community_area_revisions set geometry = geometry, contributor_id = $2 where id = $1`, [ids[4], A]).catch((e) => e)).message ?? ''), 'the contributor cannot be reassigned');
ok(/only a pending/.test((await db.query(`update public.community_area_revisions set status = 'pending' where id = $1`, [ids[3]]).catch((e) => e)).message ?? ''), 'a finished revision cannot go back to pending');

// ---- direct access
for (const role of [null, A]) {
  for (const t of ['community_areas', 'community_area_revisions']) {
    ok(/permission denied/.test((await refused(db, role, `select * from public.${t}`)) ?? ''), `${role ? 'signed-in' : 'guest'} cannot select ${t}`);
    ok(/permission denied/.test((await refused(db, role, `delete from public.${t}`)) ?? ''), `${role ? 'signed-in' : 'guest'} cannot delete ${t}`);
  }
  ok(/permission denied/.test((await refused(db, role, `insert into public.community_areas (owner_id) values ('${A}')`)) ?? ''), `${role ? 'signed-in' : 'guest'} cannot insert an area`);
  ok(/permission denied/.test((await refused(db, role, `update public.community_area_revisions set status = 'approved'`)) ?? ''), `${role ? 'signed-in' : 'guest'} cannot update a revision`);
}
const tabs = await q(`select relname, relrowsecurity from pg_class where relname in ('community_areas','community_area_revisions') and relnamespace = 'public'::regnamespace`);
ok(tabs.length === 2 && tabs.every((t) => t.relrowsecurity), 'RLS is enabled on both tables');
for (const f of ['community_area_normalize(jsonb)', 'community_area_self_intersects(double precision[],double precision[])', 'community_areas_forget(uuid)', 'community_area_guard()']) {
  ok(/permission denied/.test((await refused(db, A, `select public.${f.split('(')[0]}(${f.includes('()') ? '' : 'null'}${f.includes(',') ? ',null' : ''})`)) ?? ''), `helper ${f.split('(')[0]} is not callable by a client`);
}
const defs = await q(`select proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'execute') anon_x, has_function_privilege('authenticated', oid, 'execute') auth_x from pg_proc where proname in ('submit_community_area','list_my_community_areas','withdraw_community_revision','community_areas_forget','delete_profile') and pronamespace = 'public'::regnamespace`);
ok(defs.length === 5 && defs.every((d) => d.prosecdef && d.proconfig?.includes('search_path=""') && !d.anon_x), 'security definer, empty search_path, no anon execute');
ok(defs.find((d) => d.proname === 'community_areas_forget').auth_x === false && defs.find((d) => d.proname === 'submit_community_area').auth_x === true, 'grants: helper closed, API open to signed-in users');
const pub = await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like '%community%' and has_function_privilege('anon', oid, 'execute')`);
ok(pub.length === 0, 'no community function is executable by guests (no public data exposure)');

// ---- audit, atomically
const au = await q(`select action, actor, subject, ref, meta from public.audit_events where action like 'area.%' order by id`);
ok(au.filter((e) => e.action === 'area.submit').length === (await count('community_area_revisions')) , 'one area.submit audit row per stored revision (replays and refusals add none)');
ok(au.some((e) => e.action === 'area.withdraw') && au.every((e) => e.subject === null && !/name|description|geometry/.test(J(e.meta))), 'audit rows hold no content or subject');
const before = await count('audit_events');
await refused(db, A, 'select public.submit_community_area($1::jsonb)', [J(pay({ name: '' }))]);
ok(await count('audit_events') === before, 'a refused submission writes no audit row');
ok(/append-only/.test((await db.query(`update public.audit_events set ref = 'x' where action = 'area.submit'`).catch((e) => e)).message ?? ''), 'area audit rows are append-only');

// ---- account deletion
const D1 = '77777777-7777-4777-8777-777777777777';
await q(`insert into auth.users (id, email) values ('${D1}', 'd1@example.test')`);
const s1 = await submit(D1, pay({ name: 'Keep' }, sq(30, 1))), s2 = await submit(D1, pay({ name: 'Pending' }, sq(31, 1))), s3 = await submit(D1, pay({ name: 'Rejected' }, sq(32, 1))), s4 = await submit(D1, pay({ name: 'Withdrawn' }, sq(33, 1)));
await q(`update public.community_area_revisions set status = 'approved', reviewed_at = now(), reviewed_by = $2 where id = $1`, [s1.revision_id, A]);
await q(`update public.community_areas set published_revision_id = $1 where id = $2`, [s1.revision_id, s1.area_id]);
await q(`update public.community_area_revisions set status = 'rejected', reviewed_at = now(), review_reason = 'no' where id = $1`, [s3.revision_id]);
await as(db, D1, 'select public.withdraw_community_revision($1)', [s4.revision_id]);
const otherBefore = await count('community_area_revisions', `contributor_id = '${A}'`);
const del = await as(db, D1, 'select public.delete_profile() as r');
ok(del[0].r.status === 'deleted', 'delete_profile runs for a person with community areas');
const left = await q(`select a.id, a.owner_id, a.published_revision_id, r.contributor_id, r.idempotency_key, r.payload_hash, r.name, r.status, r.geometry is not null g from public.community_areas a join public.community_area_revisions r on r.area_id = a.id where a.id = any($1)`, [[s1.area_id, s2.area_id, s3.area_id, s4.area_id]]);
ok(left.length === 1 && left[0].name === 'Keep' && left[0].g && left[0].published_revision_id === s1.revision_id, 'the approved published area and its geometry are kept');
ok(left[0].owner_id === null && left[0].contributor_id === null && left[0].idempotency_key === null && left[0].payload_hash === null, 'owner, contributor and idempotency data are anonymised');
ok((await q('select reviewed_by from public.community_area_revisions where id = $1', [s1.revision_id]))[0].reviewed_by === A, 'the reviewer reference of another person is untouched');
ok(await count('community_area_revisions', `id = any('{${s2.revision_id},${s3.revision_id},${s4.revision_id}}')`) === 0 && await count('community_areas', `id = any('{${s2.area_id},${s3.area_id},${s4.area_id}}')`) === 0, 'pending, rejected and withdrawn submissions and their areas are removed');
ok(await count('community_area_revisions', `contributor_id = '${A}'`) === otherBefore, "another person's submissions are untouched");
const auD = await q(`select actor from public.audit_events where ref = any($1)`, [[s1.revision_id, s2.revision_id, s4.revision_id]]);
ok(auD.length >= 3 && auD.every((e) => e.actor === null), 'audit rows are retained with the deleted person cleared');
ok((await as(db, D1, 'select public.delete_profile() as r'))[0].r.status === 'deleted' && await count('community_areas', `id = '${s1.area_id}'`) === 1, 'deleting again is safe and idempotent');
await q(`delete from auth.users where id = '${D1}'`);
ok(await count('community_areas', `id = '${s1.area_id}'`) === 1, 'removing the sign-in record keeps the anonymised area (no cascade)');
// an area owner deleted straight from auth.users, without delete_profile: references go NULL rather than blocking
const E1 = '88888888-8888-4888-8888-888888888888';
await q(`insert into auth.users (id, email) values ('${E1}', 'e@example.test')`);
const se = await submit(E1, pay({ name: 'E' }, sq(40, 1)));
await q(`delete from auth.users where id = '${E1}'`);
ok((await q('select owner_id from public.community_areas where id = $1', [se.area_id]))[0].owner_id === null, 'deleting an auth user directly nulls the owner instead of failing');

// ---- parity with the Phase 1 client rules
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
let agree = 0, total = 0; const mism = [];
const cases = [];
for (let i = 0; i < 160; i++) { // random 3 to 9 point shapes of very different sizes: most self-intersect, some are simple
  const n = 3 + Math.floor(rnd() * 7), sz = [0.001, 0.01, 0.04, 0.07][i % 4], x0 = rnd() * 300 - 150, y0 = rnd() * 120 - 60;
  cases.push(Array.from({ length: n }, () => [x0 + rnd() * sz, y0 + rnd() * sz]));
}
for (let i = 0; i < 80; i++) { // convex shapes around the 25 km2 limit at assorted latitudes
  const n = 3 + Math.floor(rnd() * 10), lat = rnd() * 160 - 80, r = 0.03 + rnd() * 0.04;
  const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort();
  cases.push(angles.map((a) => [10 + r * Math.cos(a) / Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat + r * Math.sin(a)]));
}
cases.push(sq(), sq(0, 0, 1e-7), sq(0, 0, 2e-7), sq(0, 0, 3e-6), [[0, 0], [1e-7, 0], [0, 1e-7]]);
for (const verts of cases) {
  const rec = { name: 'P', geometry: { type: 'Polygon', coordinates: [verts.concat([verts[0]])] } };
  const js = validateArea(rec);
  const sql = await as(db, A, 'select public.submit_community_area($1::jsonb) as r', [J({ ...rec, idempotency_key: key() })]).then(() => null, (e) => e.message);
  total++;
  if ((js.ok && sql === null) || (!js.ok && sql && sql.includes('invalid_area: ' + js.errors[0].code))) agree++; else mism.push([js.ok, js.errors[0]?.code, sql]);
  if (js.ok && sql === null) await db.exec(`update public.community_area_revisions set status = 'withdrawn' where contributor_id = '${A}' and status = 'pending'`);
}
ok(agree === total, `SQL and client validation agree on ${agree} of ${total} shapes (accept/reject and the first error code)${mism.length ? ' ' + J(mism.slice(0, 3)) : ''}`);
const areaPairs = await q(`select area_m2 from public.community_area_revisions where contributor_id = '${A}' order by submitted_at desc limit 1`);
ok(areaPairs.length === 1, 'accepted parity shapes were stored');
const jsArea = validateArea({ name: 'x', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] } }).area.areaM2;
ok(Math.abs(row.area_m2 - jsArea) <= 1, `stored area equals the client's spherical area (${row.area_m2} vs ${jsArea})`);

// Phase 3 columns: the unpublish record exists, defaults empty, and is not client-writable
const cols = (await q("select column_name from information_schema.columns where table_name = 'community_areas'")).map((c) => c.column_name);
ok(cols.includes('unpublished_reason') && cols.includes('unpublished_by') && (await q('select count(*)::int n from public.community_areas where unpublished_reason is not null'))[0].n === 0, 'community_areas holds the unpublish reason and actor, empty until an administrator unpublishes');
ok(/permission denied/.test((await refused(db, A, "update public.community_areas set unpublished_reason = 'x'")) ?? ''), 'a client cannot write the unpublish record');

await db.close();
process.exit(fails ? 1 : 0);
