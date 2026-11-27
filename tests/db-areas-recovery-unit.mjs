// Community flying areas, Stage 3 database: get_my_community_revision (owner-only recovery read), the identical-after-rejection guard and the republish guard on review_community_area.
// Real migrations on PGlite. No browser, no network.
import { makeDb, as, refused, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'rec-' + String(++keyN).padStart(12, '0'), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [{ type: 'shelter', note: 'Pavilion', coordinates: [verts[0][0] + 0.005, verts[0][1] + 0.005] }], ...over });
const call = async (uid, fn, args = []) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const submit = (uid, over = {}, verts) => call(uid, 'submit_community_area($1::jsonb)', [J(pay(over, verts))]);
const revise = (uid, areaId, over = {}, verts) => call(uid, 'submit_community_revision($1, $2::jsonb)', [areaId, J(pay(over, verts))]);
const review = (uid, rid, decision, reason = null) => call(uid, 'review_community_area($1, $2, $3, $4, $5)', [rid, decision, reason, false, null]);
const err = async (uid, sql, args = []) => (await refused(db, uid, `select public.${sql}`, args)) ?? '';
const flush = async (uid) => { for (const r of await q("select id from public.community_area_revisions where contributor_id = $1 and status = 'pending'", [uid])) await call(uid, 'withdraw_community_revision($1)', [r.id]); }; // keeps the five-pending limit out of the way
const mine = (uid, rid) => call(uid, 'get_my_community_revision($1)', [rid]);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// ---- get_my_community_revision
const a1 = await submit(B, { name: 'Marina Park', description: 'desc' }); await review(A, a1.revision_id, 'approve');
const v2 = await revise(B, a1.area_id, { name: 'Marina Park 2' }, sq(103.8, 1.3, 0.011));
const w1 = await submit(B, { name: 'Withdrawn Park' }, sq(103.85, 1.35)); await call(B, 'withdraw_community_revision($1)', [w1.revision_id]);
const r1 = await submit(B, { name: 'Rejected Park' }, sq(103.9, 1.4)); await review(A, r1.revision_id, 'reject', 'Too big');
const c1 = await submit(C, { name: 'Cam Park' }, sq(104, 1.5));
{
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, p.prosecdef as def, array_to_string(p.proconfig, ',') as cfg from pg_proc p where p.proname = 'get_my_community_revision'`);
  ok(!f.anon && f.auth && f.def && /search_path/.test(f.cfg), 'get_my_community_revision: authenticated only; security definer with a fixed search path');
}
ok(/permission denied|not signed in/.test(await err(null, 'get_my_community_revision($1)', [a1.revision_id])), 'a guest cannot call it');
const own = await mine(B, a1.revision_id);
ok(own.name === 'Marina Park' && own.description === 'desc' && own.status === 'approved' && own.published === true && own.area_published === true && own.geometry.type === 'Polygon' && own.spots.length === 1 && own.revision_no === 1, 'the owner reads the full content of an approved, published revision');
const pend = await mine(B, v2.revision_id);
ok(pend.status === 'pending' && pend.published === false && pend.area_published === true && pend.revision_no === 2 && pend.name === 'Marina Park 2', 'a pending revision of a published area is readable and is marked not published');
ok((await mine(B, w1.revision_id)).status === 'withdrawn' && (await mine(B, r1.revision_id)).review_reason === 'Too big', 'withdrawn and rejected revisions are readable by their owner, with the reason');
ok((await mine(B, c1.revision_id)) === null && (await mine(C, a1.revision_id)) === null && (await mine(A, a1.revision_id)) === null, "another person's revision (an administrator's too) returns null, the same as a missing one");
ok((await mine(B, '99999999-9999-4999-8999-999999999999')) === null && (await mine(B, null)) === null, 'an unknown or null id returns null');
const dump = J(own);
ok(!dump.includes(A) && !dump.includes(B) && !/owner|contributor|reviewer|reviewed_by|idempot|payload|xp/i.test(dump), 'the result carries no user id, reviewer, key or XP value');
const counts = async () => J((await q('select (select count(*) from public.community_area_revisions) r, (select count(*) from public.audit_events) a, (select count(*) from public.xp_ledger) x'))[0]);
const before = await counts(); await mine(B, a1.revision_id);
ok(before === await counts(), 'reading changes nothing: no row, audit event or XP');
// after account deletion the revision is anonymised: nobody can read it any more
const d1 = await submit(C, { name: 'Deleted Soon' }, sq(104.2, 1.6));
await call(C, 'delete_profile()').catch(() => {});
ok((await mine(C, d1.revision_id).catch(() => null)) === null, 'after the owner deletes the account the revision is not readable');

await flush(B); await flush(C);
// ---- identical resubmission after a rejection
const rj = await submit(B, { name: 'Dup Park' }, sq(103.5, 1.1)); await review(A, rj.revision_id, 'reject', 'Not suitable');
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Dup Park' }, sq(103.5, 1.1)))])).includes('identical_to_rejected'), 'a first submission identical to a rejected one is refused');
await flush(B);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Dup Park', description: 'Open grass!' }, sq(103.5, 1.1)))])) === '', 'changing the description is enough');
await flush(B);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Dup Park' }, sq(103.5, 1.1001)))])) === '', 'changing the outline is enough');
await flush(B);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Dup Park', spots: [] }, sq(103.5, 1.1)))])) === '', 'changing the setup spots is enough');
await flush(B);
ok((await err(C, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Dup Park' }, sq(103.5, 1.1)))])) === '', "another person's identical content is not affected");
await flush(C);
// replay of the key of the rejected one is a replay, not a new insert
const rp = pay({ name: 'Replay Park' }, sq(103.4, 1.2)); const first = await call(B, 'submit_community_area($1::jsonb)', [J(rp)]); await review(A, first.revision_id, 'reject', 'No');
const replay = await call(B, 'submit_community_area($1::jsonb)', [J(rp)]);
ok(replay.replayed === true && replay.revision_id === first.revision_id, 'replaying the key of a rejected submission returns it unchanged (the guard only blocks new rows)');
// a withdrawn revision may be sent again
const wd = await submit(B, { name: 'Wd Park' }, sq(103.3, 1.2)); await call(B, 'withdraw_community_revision($1)', [wd.revision_id]);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Wd Park' }, sq(103.3, 1.2)))])) === '', 'a withdrawn submission can be sent again unchanged');
await flush(B);
// revisions: identical to a rejected revision of the same area
const base = await submit(B, { name: 'Rev Park' }, sq(103.2, 1.3)); await review(A, base.revision_id, 'approve');
const rv = await revise(B, base.area_id, { name: 'Rev Park v2' }, sq(103.2, 1.3, 0.011)); await review(A, rv.revision_id, 'reject', 'No thanks');
ok((await err(B, 'submit_community_revision($1, $2::jsonb)', [base.area_id, J(pay({ name: 'Rev Park v2' }, sq(103.2, 1.3, 0.011)))])).includes('identical_to_rejected'), 'a revision identical to its own rejected revision is refused');
ok((await err(B, 'submit_community_revision($1, $2::jsonb)', [base.area_id, J(pay({ name: 'Rev Park v3' }, sq(103.2, 1.3, 0.011)))])) === '', 'a changed revision goes through; the published one stayed live meanwhile');
await flush(B);

// ---- republish guard
const u1 = await submit(B, { name: 'Unpub Park' }, sq(103.1, 1.4)); await review(A, u1.revision_id, 'approve');
const u2 = await revise(B, u1.area_id, { name: 'Unpub Park v2' }, sq(103.1, 1.4, 0.011));
await call(A, 'unpublish_community_area($1, $2)', [u1.area_id, 'closed for works']);
ok((await err(A, 'review_community_area($1, $2, $3, $4, $5)', [u2.revision_id, 'approve', null, false, null])).includes('area_unpublished'), 'approving a pending change to an unpublished area is refused by default');
ok((await q('select status from public.community_area_revisions where id = $1', [u2.revision_id]))[0].status === 'pending' && (await call(null, 'get_public_area($1)', [u1.area_id])) === null, 'the refusal changed nothing: the revision is pending and the area is still not public');
ok((await err(A, 'review_community_area($1, $2, $3, $4, $5, $6)', [u2.revision_id, 'approve', null, false, null, false])).includes('area_unpublished'), 'p_republish = false is the same as the default');
ok((await err(B, 'review_community_area($1, $2, $3, $4, $5, $6)', [u2.revision_id, 'approve', null, false, null, true])).includes('not allowed'), 'a contributor cannot approve even with p_republish');
ok((await err(null, 'review_community_area($1, $2, $3, $4, $5, $6)', [u2.revision_id, 'approve', null, false, null, true])) !== '', 'a guest cannot call it');
const done = await call(A, 'review_community_area($1, $2, $3, $4, $5, $6)', [u2.revision_id, 'approve', null, false, null, true]);
ok(done.status === 'approved' && done.changed === true && (await call(null, 'get_public_area($1)', [u1.area_id])).name === 'Unpub Park v2', 'with an explicit p_republish = true the area is published again with the new revision');
const aud = (await q(`select meta as metadata from public.audit_events where action = 'area.approve' and ref = $1`, [u2.revision_id]))[0];
ok(aud?.metadata?.republished === true, 'the audit event records that the approval republished the area');
const norm = (await q(`select meta as metadata from public.audit_events where action = 'area.approve' and ref = $1`, [u1.revision_id]))[0];
ok(norm?.metadata?.republished === false, 'an ordinary approval records republished = false');
// rejecting needs no confirmation; an ordinary approval is unchanged
const u3 = await revise(B, u1.area_id, { name: 'Unpub Park v3' }, sq(103.1, 1.4, 0.012));
await call(A, 'unpublish_community_area($1, $2)', [u1.area_id, 'again']);
ok((await review(A, u3.revision_id, 'reject', 'no')).status === 'rejected', 'rejecting a pending change of an unpublished area needs no extra confirmation');
const o1 = await submit(C, { name: 'Ordinary Park' }, sq(103.0, 1.5));
ok((await review(A, o1.revision_id, 'approve')).status === 'approved', 'an ordinary approval with five arguments still works');
ok((await q(`select count(*)::int c from pg_proc where proname = 'review_community_area'`))[0].c === 1, 'there is exactly one review_community_area (the five-argument form was replaced, not overloaded)');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
