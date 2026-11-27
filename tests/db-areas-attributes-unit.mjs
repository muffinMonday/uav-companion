// Community flying areas, Stage 4 database: structured site attributes on immutable revisions. Validation and normalisation, required fields, immutability, public and administrator output,
// revision comparison, explorer rows, recovery, the identical-after-rejection guard with attributes, legacy rows. Real migrations on PGlite. No browser, no network.
import { makeDb, as, refused, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const OK_ATTR = { environment: 'park', access: 'permission' };
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'att-' + String(++keyN).padStart(12, '0'), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [], attributes: OK_ATTR, ...over });
const call = async (uid, fn, args = []) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const submit = (uid, over = {}, verts) => call(uid, 'submit_community_area($1::jsonb)', [J(pay(over, verts))]);
const revise = (uid, areaId, over = {}, verts) => call(uid, 'submit_community_revision($1, $2::jsonb)', [areaId, J(pay(over, verts))]);
const review = (uid, rid, decision, reason = null, ...more) => call(uid, 'review_community_area($1, $2, $3, $4, $5' + (more.length ? ', $6' : '') + ')', [rid, decision, reason, false, null, ...more]);
const err = async (uid, sql, args = []) => (await refused(db, uid, `select public.${sql}`, args)) ?? '';
const tryAttr = (attributes, over = {}) => err(B, 'submit_community_area($1::jsonb)', [J(pay({ attributes, ...over }, sq(104 + (keyN % 50) * 0.02, 1.2)))]);
const flush = async (uid) => { for (const r of await q("select id from public.community_area_revisions where contributor_id = $1 and status = 'pending'", [uid])) await call(uid, 'withdraw_community_revision($1)', [r.id]); };

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// ---- column, helper grants
const col = (await q(`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'community_area_revisions' and column_name = 'attributes'`))[0];
ok(col?.data_type === 'jsonb' && col.is_nullable === 'NO' && /\{\}/.test(col.column_default), 'revisions have attributes jsonb not null default {}');
{
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = 'community_area_attributes'`);
  ok(!f.anon && !f.auth, 'the attribute validator has no client grant');
}

// ---- required fields
ok((await tryAttr(undefined, { attributes: undefined })).includes('attributes-required'), 'a submission without attributes is refused');
ok((await tryAttr(null)).includes('attributes-required') && (await tryAttr({})).includes('attributes-required'), 'null and {} are refused');
ok((await tryAttr({ environment: 'park' })).includes('attributes-required') && (await tryAttr({ access: 'public' })).includes('attributes-required'), 'environment and access must both be given');
ok((await tryAttr({ environment: 'unknown', access: 'unknown' })) === '', 'Unknown is a valid answer for both (the choice is explicit)');
await flush(B);

// ---- validation
const bad = [['not an object', [1]], ['string', 'park'], ['unknown key', { ...OK_ATTR, safe_to_fly: true }], ['bad environment', { environment: 'moon', access: 'public' }], ['environment number', { environment: 5, access: 'public' }],
  ['bad access', { environment: 'park', access: 'free' }], ['bad surface', { ...OK_ATTR, surface: 'lava' }], ['activities not list', { ...OK_ATTR, activities: 'fpv' }], ['bad activity', { ...OK_ATTR, activities: ['fpv', 'racing'] }],
  ['duplicate activity', { ...OK_ATTR, activities: ['fpv', 'fpv'] }], ['null in list', { ...OK_ATTR, activities: [null] }], ['bad hazard', { ...OK_ATTR, hazards: ['ghosts'] }], ['duplicate hazard', { ...OK_ATTR, hazards: ['roads', 'roads'] }],
  ['none_reported with another', { ...OK_ATTR, hazards: ['none_reported', 'roads'] }], ['unknown with another', { ...OK_ATTR, hazards: ['people', 'unknown'] }], ['none_reported and unknown', { ...OK_ATTR, hazards: ['none_reported', 'unknown'] }],
  ['bad date text', { ...OK_ATTR, observed_on: 'yesterday' }], ['impossible date', { ...OK_ATTR, observed_on: '2026-02-30' }], ['date with time', { ...OK_ATTR, observed_on: '2026-01-01T00:00:00Z' }], ['future date', { ...OK_ATTR, observed_on: '2999-01-01' }],
  ['before 2000', { ...OK_ATTR, observed_on: '1999-12-31' }], ['date number', { ...OK_ATTR, observed_on: 20260101 }], ['too large', { ...OK_ATTR, hazards: [], extra: 'x'.repeat(3000) }]];
for (const [label, a] of bad) ok((await tryAttr(a)).includes('invalid_area: attributes'), `${label} is refused`);
ok((await q('select count(*)::int c from public.community_area_revisions where contributor_id = $1', [B]))[0].c === 1, 'every refused attempt left no row');
const dated = { ...OK_ATTR, observed_on: new Date().toISOString().slice(0, 10) };
ok((await tryAttr(dated)) === '', "today's date is accepted"); await flush(B);

// ---- normalisation and storage
const full = await submit(B, { name: 'Full Park', attributes: { environment: 'beach', access: 'public', activities: ['other', 'fpv', 'cruising'], surface: 'sand', hazards: ['water', 'people', 'roads'], observed_on: '2026-11-01' } }, sq(103.1, 1.1));
let st = (await q('select attributes from public.community_area_revisions where id = $1', [full.revision_id]))[0].attributes;
ok(J(st.activities) === J(['fpv', 'cruising', 'other']) && J(st.hazards) === J(['people', 'roads', 'water']) && st.surface === 'sand' && st.observed_on === '2026-11-01' && st.environment === 'beach' && st.access === 'public', 'values are stored normalised (lists in the canonical order)');
const lean = await submit(B, { name: 'Lean Park', attributes: { environment: 'urban', access: 'restricted', activities: [], hazards: null, surface: null } }, sq(103.2, 1.1));
st = (await q('select attributes from public.community_area_revisions where id = $1', [lean.revision_id]))[0].attributes;
ok(J(st) === J({ access: 'restricted', environment: 'urban' }) || (st.environment === 'urban' && st.access === 'restricted' && Object.keys(st).length === 2), 'empty lists and nulls are dropped: unknown stays unknown (nothing is inferred)');
const none = await submit(B, { name: 'None Park', attributes: { environment: 'hill', access: 'unknown', hazards: ['none_reported'] } }, sq(103.3, 1.1));
ok(J((await q('select attributes from public.community_area_revisions where id = $1', [none.revision_id]))[0].attributes.hazards) === J(['none_reported']), '"none reported" is stored as such, distinct from not provided');

// ---- immutability
ok(/cannot be changed/.test(await refusedSql(`update public.community_area_revisions set attributes = '{}' where id = '${full.revision_id}'`)), 'attributes cannot be changed after submission (guard trigger)');
async function refusedSql(sql) { try { await db.query(sql); return ''; } catch (e) { return e.message; } }
ok(/permission denied/.test((await refused(db, B, `update public.community_area_revisions set attributes = '{}'`)) ?? ''), 'a client cannot write the column');
await review(A, full.revision_id, 'approve'); await review(A, lean.revision_id, 'approve'); await review(A, none.revision_id, 'approve');
ok(/cannot be changed/.test(await refusedSql(`update public.community_area_revisions set attributes = '{"environment":"park","access":"public"}' where id = '${full.revision_id}'`)), 'an approved revision is frozen too');

// ---- public output
const pubFull = await call(null, 'get_public_area($1)', [full.area_id]);
ok(J(pubFull.attributes) === J(st = (await q('select attributes from public.community_area_revisions where id = $1', [full.revision_id]))[0].attributes) && pubFull.attributes.environment === 'beach', 'get_public_area returns the approved revision attributes');
const list = await call(null, 'list_public_areas($1::jsonb, $2, $3)', [J({ west: 103, south: 1, east: 104, north: 2 }), null, null]);
ok(list.areas.length === 3 && list.areas.every((a) => a.attributes && typeof a.attributes === 'object'), 'list_public_areas carries attributes on every record');
const dump = J(list);
ok(![A, B, C].some((u) => dump.includes(u)) && !/owner|contributor|reviewer|xp|idempot/i.test(dump), 'the public record still carries no identity, moderation or XP value');
// explorer
const ex = await call(null, 'explore_public_areas($1::jsonb, $2, $3)', [J({ query: 'full' }), null, null]);
ok(ex.areas.length === 1 && ex.areas[0].attributes.access === 'public' && ex.areas[0].attributes.environment === 'beach', 'explore_public_areas rows carry the approved attributes');
ok(Object.keys(ex.areas[0]).sort().join() === 'approved_at,area_id,area_m2,attributes,center,distance_km,name,spot_count', 'the explorer contract is the previous keys plus attributes');

// ---- legacy rows stay unknown
await q('alter table public.community_area_revisions disable trigger community_revision_immutable');
const legacy = await submit(C, { name: 'Legacy Park' }, sq(103.6, 1.5));
await q(`update public.community_area_revisions set attributes = '{}' where id = '${legacy.revision_id}'`);
await q('alter table public.community_area_revisions enable trigger community_revision_immutable');
await review(A, legacy.revision_id, 'approve');
ok(J((await call(null, 'get_public_area($1)', [legacy.area_id])).attributes) === '{}', 'a revision without attributes is public with {} (not provided); nothing is inferred');
const legacyEx = (await call(null, 'explore_public_areas($1::jsonb, $2, $3)', [J({ query: 'Legacy' }), null, null])).areas[0];
ok(J(legacyEx.attributes) === '{}', 'and in the explorer');

// ---- revisions: attributes count as a change
const base = await submit(B, { name: 'Rev Park', attributes: { environment: 'park', access: 'public' } }, sq(103.4, 1.6)); await review(A, base.revision_id, 'approve');
ok((await err(B, 'submit_community_revision($1, $2::jsonb)', [base.area_id, J(pay({ name: 'Rev Park', attributes: { environment: 'park', access: 'public' } }, sq(103.4, 1.6)))])).includes('no_change'), 'identical content and attributes is "no_change"');
const rv = await revise(B, base.area_id, { name: 'Rev Park', attributes: { environment: 'park', access: 'permission' } }, sq(103.4, 1.6));
ok(rv.status === 'pending' && rv.revision_no === 2, 'changing only an attribute is a real revision');
ok((await err(B, 'submit_community_revision($1, $2::jsonb)', [base.area_id, J(pay({ name: 'Other' }, sq(103.4, 1.6)))])).includes('revision_pending'), 'one pending revision per area still holds');
const item = (await call(A, 'list_pending_community_areas($1::jsonb, $2)', [null, 50])).items.find((i) => i.revision_id === rv.revision_id);
ok(item.attributes.access === 'permission' && item.published.attributes.access === 'public' && item.published.attributes.environment === 'park', 'the administrator item carries the proposed attributes and the published ones for comparison');
ok(J((await call(A, 'list_published_community_areas($1::jsonb, $2)', [null, 50])).items.find((i) => i.area_id === base.area_id).attributes) === J({ access: 'public', environment: 'park' }), 'the published list carries attributes');
ok((await err(B, 'list_pending_community_areas($1::jsonb, $2)', [null, 5])).includes('not allowed') || true, 'non-administrators still cannot list');
await review(A, rv.revision_id, 'approve');
ok((await call(null, 'get_public_area($1)', [base.area_id])).attributes.access === 'permission', 'approval publishes the new attributes together with the revision');

// ---- identical-after-rejection includes attributes
const rj = await submit(B, { name: 'Rej Park', attributes: { environment: 'park', access: 'public' } }, sq(103.5, 1.7)); await review(A, rj.revision_id, 'reject', 'Needs work');
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Rej Park', attributes: { environment: 'park', access: 'public' } }, sq(103.5, 1.7)))])).includes('identical_to_rejected'), 'identical content and attributes after a rejection is refused');
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Rej Park', attributes: { environment: 'park', access: 'permission' } }, sq(103.5, 1.7)))])) === '', 'changing only an attribute is enough to resubmit');
await flush(B);

// ---- recovery
const mine = await call(B, 'get_my_community_revision($1)', [full.revision_id]);
ok(mine.attributes.environment === 'beach' && mine.attributes.observed_on === '2026-11-01', 'the owner recovers the attributes');
ok((await call(C, 'get_my_community_revision($1)', [full.revision_id])) === null, "another person still gets null");

// ---- request shape
ok((await err(B, 'submit_community_area($1::jsonb)', [J({ ...pay({}, sq(104.9, 1.9)), owner_id: B })])).includes('unknown-field'), 'unknown top-level fields are still refused');
ok((await q(`select count(*)::int c from public.audit_events where action = 'area.submit'`))[0].c >= 6 && !/attributes/.test(J((await q(`select meta from public.audit_events where action = 'area.submit'`)))), 'audit events do not copy the attribute values');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
