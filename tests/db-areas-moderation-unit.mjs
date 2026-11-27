// Community flying areas, Phase 3 database: administrator moderation (queue, approve, reject, unpublish) and the contribution XP reward.
// Real migrations on PGlite, as different users. PGlite runs one query at a time, so "concurrent" review requests are serialised here: the second one meets the state
// the first left (the row lock that orders them in production is asserted in the function body). No browser, no network.
import fs from 'node:fs';
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
import { ROOT } from './lib.mjs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'mod-' + String(++keyN).padStart(12, '0'), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [{ type: 'shelter', note: 'Pavilion', coordinates: [verts[0][0] + 0.005, verts[0][1] + 0.005] }], ...over });
const submit = async (uid, over = {}, verts) => (await as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [J(pay(over, verts))]))[0].r;
const call = async (uid, fn, args) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const review = (uid, rid, decision, reason = null, award = false, amt = null) => call(uid, 'review_community_area($1, $2, $3, $4, $5)', [rid, decision, reason, award, amt]);
const err = async (uid, fn, args = []) => (await refused(db, uid, `select public.${fn}`, args)) ?? '';
const rev = async (id) => (await q('select * from public.community_area_revisions where id = $1', [id]))[0];
const area = async (id) => (await q('select * from public.community_areas where id = $1', [id]))[0];
const ledger = async (u) => q(`select * from public.xp_ledger where user_id = $1 and source = 'community_area' order by id`, [u]);
const total = async (u) => (await q('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? 0;
const events = async (action) => q('select * from public.audit_events where action = $1 order by id', [action]);
const count = async (t, w = 'true') => (await q(`select count(*)::int n from public.${t} where ${w}`))[0].n;
const clear = async () => { await q(`update public.community_area_revisions set status = 'withdrawn' where status = 'pending'`); };

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await call(u, 'ensure_profile($1)', [n]);
const codeOf = async (u) => (await call(u, 'ensure_profile()')).friend_code;

// ---- roles: the bootstrap row, an audited grant, nothing a client can do to itself
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`); // the owner's one-time bootstrap statement (supabase/README.md)
await call(A, 'grant_role($1, $2)', [await codeOf(C), 'organiser']);
await call(A, 'grant_role($1, $2)', [await codeOf(D), 'admin']);
ok((await call(A, 'my_roles()')).admin === true && (await call(D, 'my_roles()')).admin === true, 'my_roles reports admin: true for the administrators');
ok((await call(C, 'my_roles()')).admin === false && (await call(C, 'my_roles()')).organiser === true, 'an organiser is not an administrator');
ok(/not allowed/.test(await err(B, 'grant_role($1, $2)', [await codeOf(B), 'admin'])), 'a client cannot grant itself admin');
ok(/not allowed/.test(await err(C, 'grant_role($1, $2)', [await codeOf(C), 'admin'])), 'an organiser cannot grant itself admin');
ok((await q(`select count(*)::int n from public.app_roles where user_id = '${A}'`))[0].n === 1 && (await events('role.grant')).length === 2, 'existing roles are preserved and the grants are audited');

// ---- permissions on every function
const E = '55555555-5555-5555-5555-555555555555';
await q(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
const s1 = await submit(B, { name: 'Marina Park' });
const fns = [['list_pending_community_areas()', []], ['list_published_community_areas()', []], ['review_community_area($1, $2, $3, $4, $5)', [s1.revision_id, 'approve', null, false, null]],
  ['review_community_area($1, $2, $3, $4, $5)', [s1.revision_id, 'reject', 'no', false, null]], ['unpublish_community_area($1, $2)', [s1.area_id, 'no']]];
for (const [f, a] of fns) {
  ok(/permission denied/.test((await refused(db, null, `select public.${f}`, a)) ?? ''), `a guest cannot call ${f.split('(')[0]}`);
  for (const [u, who] of [[B, 'the contributor'], [C, 'an organiser'], [E, 'a user with no profile or role']]) {
    ok(/not allowed/.test(await err(u, f, a)), `${who} cannot call ${f.split('(')[0]}`);
  }
}
ok((await rev(s1.revision_id)).status === 'pending' && (await count('xp_ledger', `source = 'community_area'`)) === 0, 'all denied attempts left the revision pending and created no XP');
for (const fn of ['list_pending_community_areas', 'list_published_community_areas', 'review_community_area', 'unpublish_community_area', 'award_xp', 'community_area_admin_item']) {
  const [f] = await q(`select not has_function_privilege('anon', p.oid, 'execute') as noanon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as def, p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'] as sp from pg_proc p where p.proname = $1`, [fn]);
  const internal = ['award_xp', 'community_area_admin_item'].includes(fn);
  ok(f.noanon && f.def && f.sp && f.auth === !internal, `${fn}: security definer, empty search_path, no anon grant${internal ? ', no client grant' : ', authenticated may call'}`);
}
const body = (await q(`select prosrc from pg_proc where proname = 'review_community_area'`))[0].prosrc;
ok(/has_role\(uid, 'admin'\)/.test(body) && /for update/.test(body) && /award_xp/.test(body) && !/insert into public\.xp_ledger|update public\.user_xp/.test(body), 'review_community_area checks has_role, locks the revision, and only awards through award_xp');

// ---- the queue
await clear();
const ids = [];
for (let i = 0; i < 4; i++) { const r = await submit(i % 2 ? B : C, { name: 'Area ' + i, description: 'D' + i }, sq(103.8 + i * 0.02)); ids.push(r); await q('alter table public.community_area_revisions disable trigger community_revision_immutable'); await q(`update public.community_area_revisions set submitted_at = now() - interval '${10 - i} hours' where id = $1`, [r.revision_id]); await q('alter table public.community_area_revisions enable trigger community_revision_immutable'); }
const pg1 = await call(A, 'list_pending_community_areas(null, 3)');
ok(pg1.items.length === 3 && pg1.next_cursor && pg1.items.map((x) => x.name).join() === 'Area 0,Area 1,Area 2', 'pending queue: oldest first, a bounded page with a cursor');
const pg2 = await call(A, 'list_pending_community_areas($1::jsonb, 3)', [J(pg1.next_cursor)]);
ok(pg2.items.length === 1 && pg2.items[0].name === 'Area 3' && pg2.next_cursor === null, 'the cursor continues without repeats and ends');
ok((await call(A, 'list_pending_community_areas(null, 1000)')).items.length === 4 && (await call(A, 'list_pending_community_areas(null, 0)')).items.length === 1, 'the limit is clamped (1 to 50)');
ok(/invalid cursor/.test(await err(A, 'list_pending_community_areas($1::jsonb, 3)', [J({ at: 'x', id: 'y' })])), 'a bad cursor is refused');
const it = pg1.items[1];
ok(it.contributor_name === 'Bea' && it.contributor_code === await codeOf(B) && it.own === false && it.geometry.type === 'Polygon' && it.spots.length === 1 && it.area_m2 > 0 && it.bbox.length === 4 && it.description === 'D1' && it.status === 'pending', 'an item carries the contributor, geometry, spots, size, description and submission date');
ok(!J(pg1).includes(B) && !J(pg1).includes(C) && !('contributor_id' in it), 'no internal user id appears in the queue');
ok((await as(db, B, 'select * from public.list_my_community_areas()')).every((m) => !('contributor_name' in m) && !('contributor_code' in m)), 'the owner list still holds no person fields');

// ---- reject
ok(/reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'reject', null, false, null])), 'rejection without a reason fails');
ok(/reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'reject', '  \n ', false, null])), 'a blank reason fails');
ok(/reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'reject', 'x'.repeat(501), false, null])), 'a reason over 500 characters fails');
ok(/invalid_decision/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'maybe', 'x', false, null])) && /invalid_decision/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'reject', 'x', true, 100])), 'an unknown decision, or a reward on a rejection, fails');
ok((await rev(ids[0].revision_id)).status === 'pending' && (await events('area.reject')).length === 0, 'failed rejections changed nothing and wrote no audit row');
const rj = await review(A, ids[0].revision_id, 'reject', 'x'.repeat(500));
const rrow = await rev(ids[0].revision_id);
ok(rj.status === 'rejected' && rj.changed === true && rj.xp_awarded === false && rrow.status === 'rejected' && rrow.review_reason.length === 500 && rrow.reviewed_by === A && rrow.reviewed_at, 'rejection with a 500-character reason succeeds and records reviewer, time and reason');
ok((await area(ids[0].area_id)).published_revision_id === null && (await count('xp_ledger', `source = 'community_area'`)) === 0, 'a rejected revision is not published and earns nothing');
const mine = (await as(db, C, 'select * from public.list_my_community_areas()')).find((m) => m.revision_id === ids[0].revision_id);
ok(mine.status === 'rejected' && mine.review_reason.length === 500 && mine.published === false, 'the contributor sees the reason through their own status list');
const evR = (await events('area.reject'))[0];
ok(evR.actor === A && evR.subject === C && evR.ref === ids[0].revision_id && !J(evR.meta).includes('xxxx') && J(evR.meta) === J({ revision_no: 1 }), 'area.reject is audited with a bounded, reason-free record');
ok(/not_pending/.test(await err(D, 'review_community_area($1, $2, $3, $4, $5)', [ids[0].revision_id, 'approve', null, false, null])), 'a rejected revision cannot be approved afterwards');
ok((await review(A, ids[0].revision_id, 'reject', 'again')).changed === false && (await events('area.reject')).length === 1, 'repeating the same rejection is a no-op and adds no audit row');
const ctr = await q(`select count(*)::int n from public.community_area_revisions where id = $1 and (name, description) = ('Area 0', 'D0')`, [ids[0].revision_id]);
ok(ctr[0].n === 1, 'moderation never changes the submitted content');
const withdrawn = await submit(B, { name: 'To withdraw' }, sq(104.5));
await call(B, 'withdraw_community_revision($1)', [withdrawn.revision_id]);
ok(/not_pending/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [withdrawn.revision_id, 'approve', null, false, null])) && (await area(withdrawn.area_id)).published_revision_id === null, 'a withdrawn revision cannot be published');

// ---- approve without a reward
const ap = await review(A, ids[1].revision_id, 'approve');
const a1 = await area(ids[1].area_id);
const r1 = await rev(ids[1].revision_id);
ok(ap.status === 'approved' && ap.xp_awarded === false && ap.xp === 0 && a1.published_revision_id === ids[1].revision_id && a1.unpublished_at === null, 'approval publishes the revision with no XP when the reward is off');
ok(a1.bbox_west === r1.bbox_west && a1.bbox_south === r1.bbox_south && a1.bbox_east === r1.bbox_east && a1.bbox_north === r1.bbox_north && a1.bbox_west === 103.82, 'the published bounding box is the revision’s');
ok((await ledger(B)).length === 0 && (await total(B)) === 0, 'no ledger row and no XP total');
const evA = (await events('area.approve'))[0];
ok(evA.actor === A && evA.subject === B && evA.meta.xp_awarded === false && evA.meta.xp === 0 && evA.meta.self === false, 'area.approve audit: actor, subject, xp_awarded false');
ok((await review(A, ids[1].revision_id, 'approve')).changed === false && (await events('area.approve')).length === 1, 'repeating an approval is a no-op');
ok(/not_pending/.test(await err(D, 'review_community_area($1, $2, $3, $4, $5)', [ids[1].revision_id, 'reject', 'late', false, null])) && (await rev(ids[1].revision_id)).status === 'approved', 'a stale rejection by another administrator cannot overwrite the approval');
ok((await as(db, B, 'select * from public.list_my_community_areas()')).find((m) => m.revision_id === ids[1].revision_id).published === true, 'the contributor’s list now reports published');
ok(/not_found/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', ['99999999-9999-4999-8999-999999999999', 'approve', null, false, null])), 'an unknown revision is not found');

// ---- approve with a reward
for (const bad of [50, 150, 600, 0, -100, null]) ok(/invalid_xp_amount/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[2].revision_id, 'approve', null, true, bad])), `reward amount ${bad} is refused`);
ok(/invalid_xp_amount/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [ids[2].revision_id, 'approve', null, false, 100])), 'an amount without the reward flag is refused');
ok((await rev(ids[2].revision_id)).status === 'pending' && (await count('xp_ledger', `source = 'community_area'`)) === 0, 'refused amounts changed nothing');
const before = await total(C);
const aw = await review(A, ids[2].revision_id, 'approve', 'Good local knowledge', true, 300);
const lr = await ledger(C);
ok(aw.xp_awarded === true && aw.xp === 300 && lr.length === 1 && lr[0].amount === 300 && lr[0].ref === 'area-revision:' + ids[2].revision_id && lr[0].actor === A && lr[0].source === 'community_area', 'approval with a reward writes exactly one ledger row for the contributor (amount, key, moderator)');
ok((await total(C)) === before + 300 && (await q('select public.rank_for(total) r from public.user_xp where user_id = $1', [C]))[0].r >= 1, 'the ledger trigger updated the total and the rank follows it');
ok((await ledger(A)).length === 0 && (await ledger(D)).length === 0, 'the administrator received nothing');
const evW = (await events('area.approve')).find((e) => e.ref === ids[2].revision_id);
ok(evW.meta.xp_awarded === true && evW.meta.xp === 300 && evW.meta.xp === lr[0].amount && (await rev(ids[2].revision_id)).review_reason === 'Good local knowledge', 'the audit metadata matches the ledger; the note stays in the revision, not in the audit');
ok((await review(A, ids[2].revision_id, 'approve', null, true, 500)).changed === false && (await ledger(C)).length === 1, 'a retry (even with another amount) does not pay again');
ok(/not_pending/.test(await err(D, 'review_community_area($1, $2, $3, $4, $5)', [ids[2].revision_id, 'approve', null, true, 500])) && (await ledger(C)).length === 1, 'another administrator’s duplicate approval is stale and pays nothing');
const hist = (await call(C, 'my_xp_history(null, 10)')).items;
ok(hist.length === 1 && hist[0].source === 'community_area' && hist[0].amount === 300 && hist[0].reason === null && !J(hist).includes(A), 'the contributor sees the award in their own history, without actor or reference');

// ---- self-approval: allowed without a reward, never with one
const own = await submit(A, { name: 'Admin’s own' }, sq(105));
ok(/self_award_not_allowed/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [own.revision_id, 'approve', null, true, 100])), 'an administrator cannot reward themselves');
ok((await rev(own.revision_id)).status === 'pending' && (await ledger(A)).length === 0 && (await total(A)) === 0, '...and the refusal left the revision pending with no award');
ok((await call(A, 'list_pending_community_areas(null, 50)')).items.find((x) => x.revision_id === own.revision_id).own === true, 'the queue marks the administrator’s own submission');
const own2 = await review(A, own.revision_id, 'approve');
ok(own2.status === 'approved' && own2.xp_awarded === false && (await ledger(A)).length === 0 && (await events('area.approve')).find((e) => e.ref === own.revision_id).meta.self === true, 'self-approval without a reward publishes and records self = true');
const ownD = await submit(D, { name: 'Second admin' }, sq(105.2));
ok((await review(A, ownD.revision_id, 'approve', null, true, 100)).xp === 100 && (await ledger(D)).length === 1, 'one administrator can reward another’s contribution');

// ---- a second, improved revision earns its own award; a cosmetic one is approved without
const second = (await q(`insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north)
  select area_id, 2, $2, name, 'Better boundary', geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north from public.community_area_revisions where id = $1 returning id`, [ids[2].revision_id, B]))[0].id;
ok((await rev(ids[2].revision_id)).status === 'approved' && (await area(ids[2].area_id)).published_revision_id === ids[2].revision_id, 'a pending replacement leaves the published revision in place');
const rj2 = await review(A, second, 'reject', 'Not an improvement');
ok(rj2.status === 'rejected' && (await area(ids[2].area_id)).published_revision_id === ids[2].revision_id && (await rev(ids[2].revision_id)).status === 'approved', 'rejecting a replacement keeps the approved revision published');
const third = (await q(`insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north)
  select area_id, 3, $2, name, 'Fenced part removed', geometry, spots, area_m2, bbox_west + 0.001, bbox_south, bbox_east, bbox_north from public.community_area_revisions where id = $1 returning id`, [ids[2].revision_id, B]))[0].id;
const aw3 = await review(A, third, 'approve', null, true, 200);
ok(aw3.xp === 200 && (await ledger(B)).length === 1 && (await ledger(B))[0].ref === 'area-revision:' + third && (await area(ids[2].area_id)).published_revision_id === third && Math.abs((await area(ids[2].area_id)).bbox_west - 103.841) < 1e-9, 'a materially improved revision earns a separate award for its own submitter and replaces the published revision with its box');
const fourth = (await q(`insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north)
  select area_id, 4, $2, 'Park (renamed)', description, geometry, spots, area_m2, bbox_west, bbox_south, bbox_east, bbox_north from public.community_area_revisions where id = $1 returning id`, [third, D]))[0].id;
await review(A, fourth, 'approve');
ok((await ledger(D)).length === 1 && (await count('xp_ledger', `source = 'community_area'`)) === 3, 'a cosmetic revision approved with the reward off earns nothing');
ok((await rev(ids[2].revision_id)).status === 'approved' && (await rev(third)).status === 'approved', 'earlier approved revisions stay as history');

// ---- atomicity: a failure after the state change leaves nothing behind
await q(`create function public.test_block_ledger() returns trigger language plpgsql as $$ begin raise exception 'ledger blocked'; end $$`);
await q(`create trigger test_block before insert on public.xp_ledger for each row execute function public.test_block_ledger()`);
const pend = await submit(B, { name: 'Rollback' }, sq(106));
const evBefore = await count('audit_events'), ledBefore = await count('xp_ledger');
ok(/ledger blocked/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [pend.revision_id, 'approve', null, true, 400])), 'a failing award fails the approval');
ok((await rev(pend.revision_id)).status === 'pending' && (await rev(pend.revision_id)).reviewed_by === null && (await area(pend.area_id)).published_revision_id === null && (await count('audit_events')) === evBefore && (await count('xp_ledger')) === ledBefore, 'nothing was published, awarded or audited');
await q('drop trigger test_block on public.xp_ledger');
await q(`create function public.test_block_audit() returns trigger language plpgsql as $$ begin if new.action = 'area.approve' then raise exception 'audit blocked'; end if; return new; end $$`);
await q(`create trigger test_block2 before insert on public.audit_events for each row execute function public.test_block_audit()`);
ok(/audit blocked/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5)', [pend.revision_id, 'approve', null, true, 400])) && (await ledger(B)).length === 1 && (await rev(pend.revision_id)).status === 'pending', 'a failing audit write also rolls the ledger entry and publication back');
await q('drop trigger test_block2 on public.audit_events');
const done = await review(A, pend.revision_id, 'approve', null, true, 400);
ok(done.xp === 400 && (await ledger(B)).length === 2, 'after the fault is gone the same request succeeds once');

// ---- unpublish
const pubId = ids[1].area_id;
ok(/reason_required/.test(await err(A, 'unpublish_community_area($1, $2)', [pubId, null])) && /reason_required/.test(await err(A, 'unpublish_community_area($1, $2)', [pubId, '  '])), 'unpublishing requires a reason');
ok(/not allowed/.test(await err(B, 'unpublish_community_area($1, $2)', [pubId, 'x'])), 'a non-administrator cannot unpublish');
ok((await call(A, 'list_published_community_areas(null, 50)')).items.some((x) => x.area_id === pubId), 'the published list shows the area');
const up = await call(D, 'unpublish_community_area($1, $2)', [pubId, 'Private land']);
const au = await area(pubId);
ok(up.status === 'unpublished' && au.published_revision_id === null && au.unpublished_at && au.unpublished_reason === 'Private land' && au.unpublished_by === D && au.bbox_west === null, 'unpublishing clears the published revision and box, and records when, by whom and why');
ok((await rev(ids[1].revision_id)).status === 'approved' && (await rev(ids[1].revision_id)).name === 'Area 1', 'the historical revision is preserved unchanged');
ok(!(await call(A, 'list_published_community_areas(null, 50)')).items.some((x) => x.area_id === pubId) && (await as(db, B, 'select * from public.list_my_community_areas()')).find((m) => m.revision_id === ids[1].revision_id).published === false, 'the area is no longer published for any read');
ok(/not_published/.test(await err(A, 'unpublish_community_area($1, $2)', [pubId, 'again'])) && /not_found/.test(await err(A, 'unpublish_community_area($1, $2)', ['99999999-9999-4999-8999-999999999999', 'x'])), 'a second unpublish and an unknown area fail');
const evU = (await events('area.unpublish'))[0];
ok(evU.actor === D && evU.subject === B && evU.ref === pubId && J(evU.meta) === J({ revision_no: 1 }), 'area.unpublish is audited without the reason');
ok((await ledger(B)).length === 2, 'unpublishing does not claw back XP');
ok((await events('area.approve')).every((e) => J(e.meta).length < 200) && !(await q('select 1 from public.audit_events where meta::text like $1', ['%Private land%'])).length, 'audit metadata stays small and free of reasons');

// ---- privacy
for (const role of ['anon', 'authenticated']) for (const t of ['community_areas', 'community_area_revisions', 'xp_ledger', 'audit_events']) ok(/permission denied/.test((await refused(db, role === 'anon' ? null : B, `select * from public.${t}`)) ?? ''), `${role} cannot read ${t}`);
ok((await q(`select relrowsecurity from pg_class where relname in ('community_areas', 'community_area_revisions')`)).every((r) => r.relrowsecurity), 'RLS stays on for both community tables');
ok(/permission denied/.test((await refused(db, B, `update public.community_area_revisions set status = 'approved'`)) ?? '') && /permission denied/.test((await refused(db, B, `update public.community_areas set published_revision_id = null`)) ?? ''), 'no direct client write to the community tables');
ok(/permission denied/.test((await refused(db, A, `select public.award_xp($1, 100, 'community_area', 'x')`, [B])) ?? ''), 'award_xp is not callable by a client, not even an administrator');
ok((await as(db, A, `select * from public.admin_audit_events(100, 'area.approve')`)).length === 7, 'admin_audit_events returns the area.approve rows to an administrator');

// ---- immutability still holds
ok(/cannot be changed/.test(await db.query(`update public.community_area_revisions set name = 'Hack' where id = $1`, [ids[1].revision_id]).then(() => '', (e) => e.message)), 'the immutability trigger still refuses content edits');
ok(/only a pending/.test(await db.query(`update public.community_area_revisions set status = 'rejected' where id = $1`, [ids[1].revision_id]).then(() => '', (e) => e.message)), 'a decided revision cannot change state');

// ---- account deletion keeps the approved geometry, drops the contributor's XP account and the reviewer reference
await call(D, 'delete_profile()');
ok((await area(pubId)).unpublished_by === null && (await q('select count(*)::int n from public.user_xp where user_id = $1', [D]))[0].n === 0 && (await ledger(D)).length === 0, 'deleting an administrator’s profile forgets them as unpublisher and wipes their XP');
ok((await q(`select count(*)::int n from public.community_area_revisions where contributor_id is null and status = 'approved'`))[0].n >= 1, 'approved content stays, anonymised');
ok(fs.readFileSync(ROOT + '/supabase/migrations/20261127130000_community_area_moderation.sql', 'utf8').search(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|@[a-z]+\.[a-z]+/i) === -1, 'the migration contains no account id or email');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
