// Community flying areas, Phase 5 database: revisions of a published area (submit_community_revision), the unchanged public side, moderation with the comparison item, XP per revision,
// stale decisions, unpublication and account deletion. Real migrations on PGlite, as different users. PGlite serialises queries, so "concurrent" calls meet the state the
// previous one left; the lock that orders them in production is asserted in the function body.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const key = () => 'rev-' + String(++keyN).padStart(12, '0');
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: key(), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [{ type: 'shelter', note: 'Pavilion', coordinates: [verts[0][0] + 0.004, verts[0][1] + 0.004] }], attributes: { environment: 'open_field', access: 'unknown' }, ...over });
const submit = async (uid, over = {}, verts) => (await as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [J(pay(over, verts))]))[0].r;
const revise = async (uid, aid, over = {}, verts) => (await as(db, uid, 'select public.submit_community_revision($1, $2::jsonb) as r', [aid, J(pay(over, verts))]))[0].r;
const reviseErr = async (uid, aid, p) => (await refused(db, uid, 'select public.submit_community_revision($1, $2::jsonb)', [aid, J(p)])) ?? '';
const call = async (uid, fn, args) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const review = (uid, rid, decision, reason = null, award = false, amt = null) => call(uid, 'review_community_area($1, $2, $3, $4, $5)', [rid, decision, reason, award, amt]);
const err = async (uid, fn, args = []) => (await refused(db, uid, `select public.${fn}`, args)) ?? '';
const area = async (id) => (await q('select * from public.community_areas where id = $1', [id]))[0];
const rev = async (id) => (await q('select * from public.community_area_revisions where id = $1', [id]))[0];
const ledger = async (u) => q(`select * from public.xp_ledger where user_id = $1 and source = 'community_area' order by id`, [u]);
const total = async (u) => (await q('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? 0;
const pubGet = async (aid) => (await as(db, null, 'select public.get_public_area($1) as r', [aid]))[0].r;
const pubList = async () => (await as(db, null, `select public.list_public_areas('{"west":103.7,"south":1.2,"east":103.9,"north":1.4}'::jsonb) as r`))[0].r;
const events = async (action) => q('select * from public.audit_events where action = $1 order by id', [action]);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
const dcode = (await call(D, 'ensure_profile()')).friend_code;
await call(A, 'grant_role($1, $2)', [dcode, 'admin']);

// ---- a published area to revise: owner B, approved by admin A
const s1 = await submit(B, { name: 'Marina Park' });
const aid = s1.area_id;

// permissions and refusals before publication
ok(/permission denied/.test(await err(null, 'submit_community_revision($1, $2::jsonb)', [aid, J(pay())])), 'a guest cannot call submit_community_revision');
ok(/not_published/.test(await reviseErr(B, aid, pay({ name: 'Early' }))), 'an area that was never approved cannot take a revision');
await review(A, s1.revision_id, 'approve');
ok((await area(aid)).published_revision_id === s1.revision_id, 'setup: the first revision is published');

ok(/not_found/.test(await reviseErr(C, aid, pay({ name: 'Mine now' }))), "another user cannot revise (or learn about) someone else's area");
ok(/not_found/.test(await reviseErr(A, aid, pay({ name: 'Admin edit' }))), 'an administrator is not the owner: cannot submit a revision for it either');
ok(/not_found/.test(await reviseErr(B, '00000000-0000-4000-8000-000000000000', pay())), 'an unknown area id is not_found');
ok(/unknown-field/.test(await reviseErr(B, aid, pay({ area_id: aid }))) && /unknown-field/.test(await reviseErr(B, aid, pay({ owner_id: B }))), 'no client-supplied area, owner or status in the payload');
ok(/invalid_area: name/.test(await reviseErr(B, aid, pay({ name: '' }))) && /invalid_area: self-intersection/.test(await reviseErr(B, aid, { ...pay(), geometry: { type: 'Polygon', coordinates: [closeRing([[103.8, 1.3], [103.81, 1.31], [103.81, 1.3], [103.8, 1.31]])] } })), 'the same validation as a first submission');
ok(/no_change/.test(await reviseErr(B, aid, pay({ name: 'Marina Park' }))), 'a revision identical to the published version is refused');

// ---- submit a revision: pending, owner kept, published untouched
const r2 = await revise(B, aid, { name: 'Marina Park (north lawn)', description: 'Bigger lawn' }, sq(103.8, 1.3, 0.012));
ok(r2.status === 'pending' && r2.revision_no === 2 && r2.area_id === aid && r2.replayed === false && !('owner_id' in r2), 'the owner submits revision 2: pending, same area, identifiers only');
const row2 = await rev(r2.revision_id);
ok(row2.contributor_id === B && row2.status === 'pending' && row2.name === 'Marina Park (north lawn)' && row2.geometry.coordinates[0].length === 5 && row2.bbox_east === 103.812, 'contributor is auth.uid(); content normalised and the box derived on the server');
const a2 = await area(aid);
ok(a2.published_revision_id === s1.revision_id && a2.bbox_east === 103.81 && a2.unpublished_at === null, 'the area still points at revision 1 and keeps its published bounding box');
const pubNow = await pubGet(aid);
ok(pubNow.name === 'Marina Park' && J(pubNow).indexOf('north lawn') < 0 && J(pubNow).indexOf('Bigger lawn') < 0, 'get_public_area still serves revision 1 and leaks nothing of the pending one');
const lst = await pubList();
ok(lst.areas.length === 1 && lst.areas[0].name === 'Marina Park' && J(lst).indexOf('north lawn') < 0, 'list_public_areas still serves revision 1 only');

// idempotency and one pending per area
const same = pay({ name: 'Marina Park (north lawn)', description: 'Bigger lawn' }, sq(103.8, 1.3, 0.012));
const first = await as(db, B, 'select public.submit_community_revision($1, $2::jsonb) as r', [aid, J({ ...same, idempotency_key: 'retry-key-000000001' })]).then((r) => r[0].r).catch((e) => e);
ok(/revision_pending/.test(first.message ?? ''), 'a second revision while one is pending is refused (one pending revision per area)');
await q(`update public.community_area_revisions set status = 'withdrawn' where id = $1`, [r2.revision_id]);
const k = 'retry-key-000000002';
const t1 = await as(db, B, 'select public.submit_community_revision($1, $2::jsonb) as r', [aid, J({ ...same, idempotency_key: k })]).then((r) => r[0].r);
const t2 = await as(db, B, 'select public.submit_community_revision($1, $2::jsonb) as r', [aid, J({ ...same, idempotency_key: k })]).then((r) => r[0].r);
ok(t1.replayed === false && t2.replayed === true && t2.revision_id === t1.revision_id && t1.revision_no === 3 && (await q('select count(*)::int n from public.community_area_revisions where area_id = $1', [aid]))[0].n === 3, 'a retry with the same key and content replays the same revision (no duplicate row); numbering continues after a withdrawn one');
ok(/idempotency_conflict/.test(await reviseErr(B, aid, { ...same, idempotency_key: k, name: 'Other name' })), 'the same key with different content is a conflict');
const sub = await submit(B, {}, sq(103.9, 1.4));
ok(/idempotency_conflict/.test((await refused(db, B, 'select public.submit_community_area($1::jsonb)', [J({ ...same, idempotency_key: k })])) ?? ''), 'a revision key cannot be replayed as a new area');

// ---- withdraw and rejection keep revision 1 live; corrections resubmit as a new revision of the SAME area
ok((await call(B, 'withdraw_community_revision($1)', [t1.revision_id])).status === 'withdrawn' && (await area(aid)).published_revision_id === s1.revision_id && (await pubGet(aid)).name === 'Marina Park', 'withdrawing a pending revision leaves revision 1 published and public');
const t3 = await revise(B, aid, { name: 'Marina Park v4' }, sq(103.8, 1.3, 0.011));
ok(t3.revision_no === 4, 'a corrected revision after a withdrawal is revision 4 of the same area');
ok(/not_allowed|not allowed/.test(await err(B, 'review_community_area($1, $2, $3, $4, $5)', [t3.revision_id, 'reject', 'no', false, null])), 'the contributor cannot review their own revision');
const rj = await review(D, t3.revision_id, 'reject', 'Boundary is wrong');
ok(rj.status === 'rejected' && (await area(aid)).published_revision_id === s1.revision_id && (await pubGet(aid)).name === 'Marina Park', 'a rejected revision leaves revision 1 published');
const mine = await as(db, B, 'select * from public.list_my_community_areas()');
ok(mine.filter((m) => m.area_id === aid).length === 4 && mine.find((m) => m.revision_id === s1.revision_id).published === true && mine.find((m) => m.revision_id === t3.revision_id).status === 'rejected' && mine.find((m) => m.revision_id === t3.revision_id).review_reason === 'Boundary is wrong', 'the owner list shows every revision of the area with status, reason and which one is published');
ok((await q('select count(*)::int n from public.community_areas where owner_id = $1', [B]))[0].n === 2, 'no duplicate public area was created by revising (two areas: Marina Park and the unrelated submission)');
const t4 = await revise(B, aid, { name: 'Marina Park v5' }, sq(103.8, 1.3, 0.0115));
ok(t4.revision_no === 5 && t4.area_id === aid, 'resubmitting after a rejection is a new revision of the same area');

// ---- immutable submitted content
ok(/immutable|frozen|cannot/i.test((await db.query(`update public.community_area_revisions set name = 'x' where id = $1`, [t4.revision_id]).catch((e) => e)).message ?? ''), 'submitted revision content is immutable');

// ---- moderation sees the comparison, and only administrators do
const pend = await call(D, 'list_pending_community_areas()', []);
const it = pend.items.find((x) => x.revision_id === t4.revision_id);
ok(it && it.has_published === true && it.published && it.published.revision_no === 1 && it.published.name === 'Marina Park' && it.published.geometry && Array.isArray(it.published.spots) && it.revision_no === 5, 'the pending item carries the currently published version for comparison');
const first_ = pend.items.find((x) => x.revision_id === sub.revision_id);
ok(first_ && first_.published === null && first_.has_published === false, 'an initial submission has no published version to compare');
ok(/not allowed/.test(await err(B, 'list_pending_community_areas()')) && /not allowed/.test(await err(C, 'list_pending_community_areas()')), 'a contributor or other user cannot read the moderation queue');
const pubd = await call(D, 'list_published_community_areas()', []);
ok(pubd.items.find((x) => x.area_id === aid).published === null, 'a published item does not repeat itself as a comparison');

// ---- approval is atomic: replaces the published revision, updates the public record and box, and XP rules hold
const self = await err(B, 'review_community_area($1, $2, $3, $4, $5)', [t4.revision_id, 'approve', null, true, 100]);
ok(/not allowed/.test(self), 'only administrators can approve');
const ap = await review(D, t4.revision_id, 'approve', null, true, 300);
ok(ap.status === 'approved' && ap.changed === true && ap.xp_awarded === true && ap.xp === 300, 'approving a revision publishes it and awards the chosen XP');
const a3 = await area(aid);
ok(a3.published_revision_id === t4.revision_id && a3.bbox_east === 103.8115 && a3.unpublished_at === null, 'the area now points at revision 5 and its bounding box follows it');
const pub2 = await pubGet(aid);
ok(pub2.name === 'Marina Park v5' && (await pubList()).areas[0].name === 'Marina Park v5' && (await pubList()).areas.length === 1 && pub2.spots.length === 1, 'public geometry, details and spots now come from revision 5; still one public area');
const lg = await ledger(B);
ok(lg.length === 1 && lg[0].amount === 300 && lg[0].ref === 'area-revision:' + t4.revision_id && lg[0].actor === D && (await total(B)) === 300, 'one ledger row for the revision, keyed by revision id, recipient the contributor');
ok((await review(D, t4.revision_id, 'approve', null, true, 300)).changed === false && (await ledger(B)).length === 1 && (await total(B)) === 300, 'repeating the approval changes nothing and awards nothing again');
ok(/not_pending/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [t4.revision_id, 'reject', 'late', false, null])), 'a stale decision by another administrator is refused');
ok(/not_pending/.test(await err(D, 'review_community_area($1, $2, $3, $4, $5)', [t3.revision_id, 'approve', null, true, 500])) && (await ledger(B)).length === 1, 'a rejected revision cannot be approved later, and earns nothing');
const ev = (await events('area.approve')).filter((e) => e.ref === t4.revision_id);
ok(ev.length === 1 && ev[0].meta.revision_no === 5 && ev[0].meta.xp_awarded === true && ev[0].meta.xp === 300 && !('reason' in ev[0].meta), 'the approval is audited once with revision number and XP, no free text');
ok((await events('area.submit')).filter((e) => e.meta.revision === true).length >= 3 && (await events('area.submit')).every((e) => !('name' in e.meta)), 'revision submissions are audited with counts only');

// a no-XP approval of a later revision, and a self-approval by an administrator-owner without XP
const r6 = await revise(B, aid, { description: 'Typo fixed' }, sq(103.8, 1.3, 0.0115));
const ap2 = await review(D, r6.revision_id, 'approve');
ok(ap2.xp_awarded === false && (await ledger(B)).length === 1 && (await area(aid)).published_revision_id === r6.revision_id, 'a cosmetic revision can be approved without XP; the earlier award stays');
// atomic rollback: an injected failure after the pointer change leaves nothing half done
const r7 = await revise(B, aid, { name: 'Will roll back' }, sq(103.8, 1.3, 0.0113));
await q(`create function public.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
await q(`create trigger zz_fail before insert on public.audit_events for each row execute function public.fail_audit()`);
const boom = await err(D, 'review_community_area($1, $2, $3, $4, $5)', [r7.revision_id, 'approve', null, true, 200]);
await q('drop trigger zz_fail on public.audit_events');
ok(/injected/.test(boom) && (await rev(r7.revision_id)).status === 'pending' && (await area(aid)).published_revision_id === r6.revision_id && (await ledger(B)).length === 1, 'a failure while auditing rolls back the publication, the status and the XP together');

// ---- unpublication: refuses further revisions, removes the area from fresh public reads
const unp = await call(D, 'unpublish_community_area($1, $2)', [aid, 'Inappropriate text']);
ok(unp.status === 'unpublished' && (await pubGet(aid)) === null && (await pubList()).areas.length === 0, 'unpublishing removes the area from public reads even with a revision pending');
await q(`update public.community_area_revisions set status = 'withdrawn' where id = $1`, [r7.revision_id]);
ok(/not_published/.test(await reviseErr(B, aid, pay({ name: 'After unpublish' }))), 'an unpublished area cannot take a new revision');
ok((await q('select status from public.community_area_revisions where id = $1', [r6.revision_id]))[0].status === 'approved', 'its approved history is kept');

// ---- account deletion: pending revision removed, published content stays anonymised
const E = '66666666-6666-6666-6666-666666666666';
await q(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
await call(E, 'ensure_profile($1)', ['Eve']);
const e1 = await submit(E, { name: 'Eve Field' }, sq(103.85, 1.35));
await review(D, e1.revision_id, 'approve');
const e2 = await revise(E, e1.area_id, { name: 'Eve Field (new)' }, sq(103.85, 1.35, 0.012));
await call(E, 'delete_profile()', []);
const left = await q('select r.id, r.status, r.contributor_id, a.owner_id, a.published_revision_id from public.community_areas a join public.community_area_revisions r on r.area_id = a.id where a.id = $1', [e1.area_id]);
ok(left.length === 1 && left[0].id === e1.revision_id && left[0].status === 'approved' && left[0].owner_id === null && left[0].contributor_id === null && left[0].published_revision_id === e1.revision_id, 'deleting the account removes the pending revision and keeps the published revision with no owner or contributor');
ok((await pubGet(e1.area_id)).name === 'Eve Field' && (await rev(e2.revision_id)) === undefined, 'the public record is unchanged and the pending replacement is gone');

// ---- definitions
const defs = await q(`select proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'execute') anon_x, has_function_privilege('authenticated', oid, 'execute') auth_x, pg_get_functiondef(oid) d from pg_proc where proname in ('submit_community_revision','community_area_admin_item') and pronamespace = 'public'::regnamespace`);
const sr = defs.find((d) => d.proname === 'submit_community_revision');
ok(sr.prosecdef && /search_path=""/.test(String(sr.proconfig)) && sr.anon_x === false && sr.auth_x === true && /for update/.test(sr.d) && /pg_advisory_xact_lock/.test(sr.d), 'security definer, empty search_path, authenticated only, area row and account locked');
ok(defs.find((d) => d.proname === 'community_area_admin_item').auth_x === false, 'the moderation item builder has no client grant');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
