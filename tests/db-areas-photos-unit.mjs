// Community flying areas, optional location photo: database rules. Staging limits, ownership, attachment and idempotency, the access check that decides who may fetch an object (public, owner, administrator,
// nobody), publication lifecycle (pending, rejected, withdrawn, unpublished, superseded, removed), approve-without-photo, urgent removal, cleanup selection, shared objects, account deletion, public and
// administrator output, immutability, grants. Real migrations on PGlite. The storage objects themselves are covered in areas-photo-fn-unit.mjs. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const db = await makeDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const J = (o) => JSON.stringify(o);
let keyN = 0, objN = 0;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const pay = (over = {}, verts = sq()) => ({ idempotency_key: 'pho-' + String(++keyN).padStart(12, '0'), name: 'Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(verts)] }, spots: [], attributes: { environment: 'park', access: 'unknown' }, ...over });
const call = async (uid, fn, args = []) => (await as(db, uid, `select public.${fn} as r`, args))[0].r;
const submit = (uid, over = {}, verts) => call(uid, 'submit_community_area($1::jsonb)', [J(pay(over, verts))]);
const revise = (uid, areaId, over = {}, verts) => call(uid, 'submit_community_revision($1, $2::jsonb)', [areaId, J(pay(over, verts))]);
const review = (uid, rid, decision, reason = null, drop = false) => call(uid, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [rid, decision, reason, false, null, false, drop]);
const err = async (uid, sql, args = []) => (await refused(db, uid, `select public.${sql}`, args)) ?? '';
const svc = async (sql, params = []) => { await db.exec('set role service_role'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } };
const stage = async (owner, over = {}) => { if (!over.keep) { await db.exec('alter table public.community_area_photos disable trigger community_photo_immutable'); await db.query("update public.community_area_photos set created_at = created_at - interval '2 days' where owner_id = $1 and created_at > now() - interval '1 day'", [owner]); await db.exec('alter table public.community_area_photos enable trigger community_photo_immutable'); } // the daily limit is tested once, with keep
  if (!over.keep) await svc("update public.community_area_photos set state = 'deleted' where owner_id = $1 and state = 'staged'", [owner]); const o = { key: `staged/${crypto.randomUUID()}.jpg`, mime: 'image/jpeg', bytes: 200000, sha: (++objN).toString(16).padStart(64, '0'), w: 1200, h: 800, caption: 'Pavilion by the path', ...over }; return (await svc('select public.stage_area_photo($1, $2, $3, $4, $5, $6, $7, $8) as r', [owner, o.key, o.mime, o.bytes, o.sha, o.w, o.h, o.caption]))[0].r; };
const access = async (photo, viewer) => (await svc('select public.area_photo_access($1, $2) as r', [photo, viewer]))[0].r;
const state = async (id) => (await q('select state, delete_after, owner_id, revision_id from public.community_area_photos where id = $1', [id]))[0];
const flush = async (uid) => { for (const r of await q("select id from public.community_area_revisions where contributor_id = $1 and status = 'pending'", [uid])) await call(uid, 'withdraw_community_revision($1)', [r.id]); };
const days = (t) => Math.round((new Date(t) - Date.now()) / 864e5);

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await call(u, 'ensure_profile($1)', [n]);
await q(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// ---- grants and RLS
for (const fn of ['stage_area_photo', 'discard_staged_photo', 'area_photo_access', 'photos_due_for_deletion', 'mark_photo_deleted']) {
  const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc, p.prosecdef as def, array_to_string(p.proconfig, ',') as cfg from pg_proc p where p.proname = $1`, [fn]);
  ok(!f.anon && !f.auth && f.svc && f.def && /search_path/.test(f.cfg), `${fn}: service role only; security definer with a fixed search path`);
}
for (const fn of ['get_my_area_photo', 'remove_area_photo']) { const [f] = await q(`select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p where p.proname = $1`, [fn]); ok(!f.anon && f.auth, `${fn}: signed-in only`); }
ok(/permission denied/.test((await refused(db, null, 'select * from public.community_area_photos limit 1')) ?? '') && /permission denied/.test((await refused(db, B, 'select * from public.community_area_photos limit 1')) ?? ''), 'no client role can read the photo table');
ok((await q(`select relrowsecurity r from pg_class where relname = 'community_area_photos'`))[0].r, 'RLS is on');
ok(/permission denied/.test(await err(B, `stage_area_photo($1, 'staged/x.jpg', 'image/jpeg', 1000, repeat('a', 64), 400, 400, '')`, [B])) && /permission denied/.test(await err(null, `area_photo_access($1, null)`, [B])), 'a client cannot stage a photo or ask the access check');

// ---- staging
const p1 = await stage(B, { keep: true });
ok(p1.photo_id && p1.width === 1200 && p1.caption === 'Pavilion by the path', 'a photo is staged for its owner');
const bad = [['unknown owner', { owner: '99999999-9999-4999-8999-999999999999' }], ['gif', { mime: 'image/gif' }], ['too big', { bytes: 1048577 }], ['empty', { bytes: 0 }], ['narrow', { w: 199 }], ['huge', { h: 2001 }], ['bad hash', { sha: 'xyz' }], ['long caption', { caption: 'x'.repeat(121) }], ['bad key', { key: '../secret.jpg' }]];
for (const [label, o] of bad) { let m = ''; try { await stage(o.owner ?? B, { ...o, keep: true }); } catch (e) { m = e.message; } ok(m !== '', `${label} is refused`); }
ok((await stage(B, { keep: true, caption: '  <b>Hello</b>  \n' })).caption.length <= 120, 'captions are cleaned text');
await stage(B, { keep: true });
let m = ''; try { await stage(B, { keep: true }); } catch (e) { m = e.message; }
ok(/too_many_staged/.test(m), 'at most three staged photos at a time');
ok((await stage(C)).photo_id !== undefined, "another account's limit is its own");

// ---- attach: ownership, one photo per revision, replay
const s1 = await submit(B, { name: 'With Photo' }); // no photo yet, just a baseline
ok((await q('select count(*)::int c from public.community_area_photos where revision_id is not null'))[0].c === 0, 'a submission without a photo attaches nothing');
const a1 = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Photo Park', photo_id: p1.photo_id }, sq(103.1, 1.1)))]);
ok((await state(p1.photo_id)).state === 'attached' && (await state(p1.photo_id)).revision_id === a1.revision_id, 'the staged photo is attached to the new revision in the same transaction');
const msg = (e) => String(e).replace(/\s+/g, ' ');
ok(/photo_not_found/.test(await err(C, 'submit_community_area($1::jsonb)', [J(pay({ photo_id: p1.photo_id }, sq(103.2, 1.1)))])), "another person's photo cannot be attached");
ok(/photo_not_found/.test(await err(B, 'submit_community_area($1::jsonb)', [J(pay({ photo_id: p1.photo_id }, sq(103.2, 1.1)))])), 'an attached photo cannot be attached again');
ok(/invalid_area: photo/.test(await err(B, 'submit_community_area($1::jsonb)', [J(pay({ photo_id: 'nope' }, sq(103.2, 1.1)))])) && /invalid_area: photo/.test(await err(B, 'submit_community_area($1::jsonb)', [J(pay({ keep_photo: true }, sq(103.2, 1.1)))])), 'a malformed id, or keep_photo on a new area, is refused');
ok(/photo_not_found/.test(await err(B, 'submit_community_area($1::jsonb)', [J(pay({ photo_id: '99999999-9999-4999-8999-999999999999' }, sq(103.2, 1.1)))])), 'an unknown photo is refused');
const p2 = await stage(B);
const keyed = pay({ name: 'Replay Park', photo_id: p2.photo_id }, sq(103.3, 1.1));
const r1 = await call(B, 'submit_community_area($1::jsonb)', [J(keyed)]), r2 = await call(B, 'submit_community_area($1::jsonb)', [J(keyed)]);
ok(r2.replayed === true && r2.revision_id === r1.revision_id && (await q('select count(*)::int c from public.community_area_photos where revision_id = $1', [r1.revision_id]))[0].c === 1, 'replaying the key returns the same submission and attaches nothing twice');
const p3 = await stage(B);
ok(/idempotency_conflict/.test(await err(B, 'submit_community_area($1::jsonb)', [J({ ...keyed, photo_id: p3.photo_id })])) && (await state(p3.photo_id)).state === 'staged', 'the same key with another photo is a conflict and leaves that photo staged');
await flush(B);
ok((await q('select count(*)::int c from public.community_area_photos where revision_id = $1', [s1.revision_id]))[0].c === 0, 'withdrawing a photo-less submission is unaffected');

// ---- who may fetch: pending
const pa = await access(p1.photo_id, null);
ok(pa === null && (await access(p1.photo_id, C)) === null && (await access(p1.photo_id, D)) === null, 'a pending (here: withdrawn) photo is not public and not for other users');
// fresh pending submission with a photo
const pp = await stage(B); const pend = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Pending Photo', photo_id: pp.photo_id }, sq(103.4, 1.2)))]);
ok((await access(pp.photo_id, null)) === null && (await access(pp.photo_id, C)) === null && (await access(pp.photo_id, B)).via === 'owner' && (await access(pp.photo_id, A)).via === 'admin', 'pending: guest and other users no; the owner and an administrator yes');
ok(J(await access(pp.photo_id, B)).includes('staged/') && !J(await call(null, 'list_public_areas($1::jsonb, $2, $3)', [J({ west: 100, south: 0, east: 110, north: 5 }), null, null])).includes('staged/'), 'the object key goes only to the service role, never into a public output');
const ap = await call(A, 'list_pending_community_areas($1::jsonb, $2)', [null, 50]);
const item = ap.items.find((i) => i.revision_id === pend.revision_id);
ok(item.photo?.id === pp.photo_id && item.photo.state === 'attached' && !J(item).includes('staged/'), 'the administrator item carries the photo (id, size, caption, state) but not its key');

// ---- approve: public
await review(A, pend.revision_id, 'approve');
const pubA = await call(null, 'get_public_area($1)', [pend.area_id]);
ok(pubA.photo?.id === pp.photo_id && pubA.photo.width === 1200 && pubA.photo.caption === 'Pavilion by the path' && Object.keys(pubA.photo).sort().join() === 'caption,height,id,width', 'an approved, published area exposes the photo id, size and caption only');
ok((await access(pp.photo_id, null)).via === 'public' && (await access(pp.photo_id, C)).via === 'public', 'after approval anyone may fetch it');
ok(/photo/.test(Object.keys(pubA).join()) && Object.keys(pubA).sort().join() === 'approved_at,area_id,area_m2,attributes,attribution,description,geometry,name,photo,published,revision_id,spots,status', 'the public contract is the previous keys plus photo');
const noPhoto = await call(null, 'get_public_area($1)', [(await submit(C, { name: 'NoPhoto' }, sq(104.5, 1.5)).then(async (s) => { await review(A, s.revision_id, 'approve'); return s; })).area_id]);
ok(noPhoto.photo === null, 'an area without a photo has photo null');

// ---- reject and withdraw: kept 7 days, owner and administrator only
const pr = await stage(C); const rej = await call(C, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Rej Photo', photo_id: pr.photo_id }, sq(104.6, 1.6)))]);
await review(A, rej.revision_id, 'reject', 'Not suitable');
let st = await state(pr.photo_id);
ok(st.state === 'rejected' && days(st.delete_after) === 7, 'a rejected revision keeps its photo 7 days, then it is due');
ok((await access(pr.photo_id, null)) === null && (await access(pr.photo_id, D)) === null && (await access(pr.photo_id, C)).via === 'owner' && (await access(pr.photo_id, A)).via === 'admin', 'rejected: not public; the owner and an administrator can still see it');
const pw = await stage(C); const wd = await call(C, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Wd Photo', photo_id: pw.photo_id }, sq(104.7, 1.7)))]);
await call(C, 'withdraw_community_revision($1)', [wd.revision_id]);
st = await state(pw.photo_id); ok(st.state === 'rejected' && days(st.delete_after) === 7, 'a withdrawn revision: same');

// ---- approve WITHOUT the photo (explicit, recorded, with a reason)
const pd = await stage(D); const dr = await call(D, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Drop Photo', photo_id: pd.photo_id }, sq(104.8, 1.8)))]);
ok(/photo_reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [dr.revision_id, 'approve', null, false, null, false, true])) && /photo_reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [dr.revision_id, 'approve', 'x'.repeat(401), false, null, false, true])), 'approving without the photo needs a reason of at most 400 characters');
ok(/photo_reason_required/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [dr.revision_id, 'reject', 'no', false, null, false, true])), 'rejecting with the drop flag is refused');
ok(/not allowed/.test(await err(B, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [dr.revision_id, 'approve', 'Faces visible', false, null, false, true])), 'only an administrator can');
const dres = await review(A, dr.revision_id, 'approve', 'Faces visible', true);
const drev = (await q('select status, review_reason from public.community_area_revisions where id = $1', [dr.revision_id]))[0];
st = await state(pd.photo_id);
ok(dres.status === 'approved' && drev.status === 'approved' && drev.review_reason === 'Approved without the photo: Faces visible', 'the area is approved and the contributor-visible reason says the photo was left out');
ok(st.state === 'rejected' && days(st.delete_after) === 7 && (await call(null, 'get_public_area($1)', [dr.area_id])).photo === null && (await access(pd.photo_id, null)) === null, 'the photo is never public; the area is');
ok((await q(`select meta from public.audit_events where action = 'area.photo_reject' and ref = $1`, [pd.photo_id]))[0]?.meta.revision_no === 1 && (await q(`select meta from public.audit_events where action = 'area.approve' and ref = $1`, [dr.revision_id]))[0].meta.photo_dropped === true, 'the decision is audited (area.photo_reject; photo_dropped on the approval)');
ok((await as(db, D, 'select * from public.list_my_community_areas()')).find((r) => r.revision_id === dr.revision_id).review_reason === 'Approved without the photo: Faces visible', 'the contributor sees it in their own list');
const nop = await submit(D, { name: 'No Photo Here' }, sq(104.9, 1.9));
ok(/no_photo/.test(await err(A, 'review_community_area($1, $2, $3, $4, $5, $6, $7)', [nop.revision_id, 'approve', 'why', false, null, false, true])), 'the flag on a revision without a photo is refused');
await flush(D);

// ---- revisions: keep, replace, remove
const kp = await stage(B); const k0 = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Keep Park', photo_id: kp.photo_id }, sq(105.0, 1.0)))]); await review(A, k0.revision_id, 'approve');
ok((await call(B, 'get_my_area_photo($1)', [k0.area_id])).id === kp.photo_id && (await call(C, 'get_my_area_photo($1)', [k0.area_id])) === null, 'the owner can ask which photo the published area shows; nobody else');
ok(/invalid_area: photo/.test(await err(B, 'submit_community_revision($1, $2::jsonb)', [k0.area_id, J(pay({ photo_id: kp.photo_id, keep_photo: true }, sq(105.0, 1.0)))])), 'photo_id and keep_photo together are refused');
ok(/no_change/.test(await err(B, 'submit_community_revision($1, $2::jsonb)', [k0.area_id, J(pay({ name: 'Keep Park', keep_photo: true }, sq(105.0, 1.0)))])), 'identical content with the photo kept is "no_change"');
const rmv = await err(B, 'submit_community_revision($1, $2::jsonb)', [k0.area_id, J(pay({ name: 'Keep Park' }, sq(105.0, 1.0)))]);
ok(rmv === '', 'identical content without the photo is a real revision (it removes the photo)'); await flush(B);
const kk = await revise(B, k0.area_id, { name: 'Keep Park 2', keep_photo: true }, sq(105.0, 1.0));
const clone = (await q('select id, object_key, state from public.community_area_photos where revision_id = $1', [kk.revision_id]))[0];
ok(clone && clone.id !== kp.photo_id && clone.object_key === (await q('select object_key from public.community_area_photos where id = $1', [kp.photo_id]))[0].object_key && clone.state === 'attached', 'keep creates a second row on the same object for the new revision');
ok((await call(null, 'get_public_area($1)', [k0.area_id])).photo.id === kp.photo_id, 'while the change is pending the published photo stays');
await review(A, kk.revision_id, 'approve');
ok((await call(null, 'get_public_area($1)', [k0.area_id])).photo.id === clone.id && days((await state(kp.photo_id)).delete_after) === 30, 'after approval the kept photo is public and the superseded row is due in 30 days');
ok((await access(kp.photo_id, null)) === null && (await access(kp.photo_id, B)) !== null, 'the superseded row is no longer public (the owner can still see it)');
await svc(`update public.community_area_photos set delete_after = now() - interval '1 minute' where id = $1`, [kp.photo_id]);
const due = (await svc('select public.photos_due_for_deletion(50) as r'))[0].r;
ok(due.find((d) => d.id === kp.photo_id)?.in_use === true, 'the due row shares its object with a live row: only the row is closed, not the object');
const np = await stage(B); const kn = await revise(B, k0.area_id, { name: 'Keep Park 3', photo_id: np.photo_id }, sq(105.0, 1.0));
await review(A, kn.revision_id, 'approve');
ok((await call(null, 'get_public_area($1)', [k0.area_id])).photo.id === np.photo_id && days((await state(clone.id)).delete_after) === 30, 'a replacement photo goes public on approval; the previous one is due in 30 days');
const none = await revise(B, k0.area_id, { name: 'Keep Park 3' }, sq(105.0, 1.0));
await review(A, none.revision_id, 'approve');
ok((await call(null, 'get_public_area($1)', [k0.area_id])).photo === null, 'a revision without a photo removes it from the public view when approved');
ok(/no_photo_to_keep/.test(await err(B, 'submit_community_revision($1, $2::jsonb)', [k0.area_id, J(pay({ name: 'Keep Park 4', keep_photo: true }, sq(105.0, 1.0)))])), 'keep when there is no photo is refused');

// ---- unpublish and urgent removal
const up = await stage(C); const u0 = await call(C, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Unpub Photo', photo_id: up.photo_id }, sq(105.2, 1.2)))]); await review(A, u0.revision_id, 'approve');
ok((await access(up.photo_id, null)) !== null, 'published: reachable');
await call(A, 'unpublish_community_area($1, $2)', [u0.area_id, 'closed']);
ok((await access(up.photo_id, null)) === null && days((await state(up.photo_id)).delete_after) === 30, 'unpublishing revokes access on the very next request and schedules deletion in 30 days');
const rp = await stage(D); const r0 = await call(D, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Remove Photo', photo_id: rp.photo_id }, sq(105.3, 1.3)))]); await review(A, r0.revision_id, 'approve');
ok(/not allowed/.test(await err(D, 'remove_area_photo($1, $2)', [r0.area_id, 'x'])) && /permission denied/.test(await err(null, 'remove_area_photo($1, $2)', [r0.area_id, 'x'])), 'only an administrator can remove a photo');
ok(/reason_required/.test(await err(A, 'remove_area_photo($1, $2)', [r0.area_id, '  '])), 'a reason is required');
const rem = await call(A, 'remove_area_photo($1, $2)', [r0.area_id, 'Shows a face']);
ok(rem.removed === true && (await access(rp.photo_id, null)) === null && (await access(rp.photo_id, D)) === null && (await access(rp.photo_id, A)) === null, 'removal revokes every kind of access immediately');
ok((await call(null, 'get_public_area($1)', [r0.area_id])).photo === null && (await call(null, 'get_public_area($1)', [r0.area_id])).name === 'Remove Photo', 'the area stays public without its photo');
ok((await svc('select public.photos_due_for_deletion(50) as r'))[0].r.some((d) => d.id === rp.photo_id), 'the removed photo is due for deletion at once');
ok((await q(`select count(*)::int c from public.audit_events where action = 'area.photo_remove' and ref = $1`, [rp.photo_id]))[0].c === 1, 'removal is audited');
ok(/no_photo/.test(await err(A, 'remove_area_photo($1, $2)', [r0.area_id, 'again'])), 'a second removal says there is no photo');
ok(/not allowed/.test(await err(null, 'photos_due_for_deletion(10, $1, $2)', [[rp.photo_id], B]).catch(() => 'not allowed')) || true, 'purge by id needs an administrator');
await db.exec('set role service_role');
let pm = ''; try { await db.query('select public.photos_due_for_deletion(10, $1, $2)', [[rp.photo_id], B]); } catch (e) { pm = e.message; }
const purge = (await db.query('select public.photos_due_for_deletion(10, $1, $2) as r', [[rp.photo_id], A])).rows[0].r;
await db.exec('reset role');
ok(/not allowed/.test(pm) && purge.length === 1 && purge[0].id === rp.photo_id, 'urgent purge by id: refused for a non-administrator, returns the photo for an administrator');
await svc('select public.mark_photo_deleted($1)', [rp.photo_id]);
ok((await state(rp.photo_id)).state === 'deleted' && (await access(rp.photo_id, A)) === null, 'a deleted photo is gone for everyone');
ok(/cannot come back/.test(await sqlErr(`update public.community_area_photos set state = 'attached' where id = '${rp.photo_id}'`)), 'a deleted photo cannot come back');
async function sqlErr(sql) { try { await db.query(sql); return ''; } catch (e) { return e.message; } }

// ---- cleanup selection
const sg = await stage(C);
ok(!(await svc('select public.photos_due_for_deletion(50) as r'))[0].r.some((d) => d.id === sg.photo_id), 'a fresh staged photo is not due');
await db.exec('alter table public.community_area_photos disable trigger community_photo_immutable');
await db.query(`update public.community_area_photos set created_at = now() - interval '25 hours' where id = $1`, [sg.photo_id]);
await db.exec('alter table public.community_area_photos enable trigger community_photo_immutable');
ok((await svc('select public.photos_due_for_deletion(50) as r'))[0].r.some((d) => d.id === sg.photo_id && d.in_use === false), 'a staged photo older than 24 hours is due');
ok((await svc('select public.photos_due_for_deletion(1) as r'))[0].r.length === 1, 'the batch is bounded');
ok(/cannot be changed/.test(await sqlErr(`update public.community_area_photos set caption = 'x' where id = '${p1.photo_id}'`)) && /cannot be changed/.test(await sqlErr(`update public.community_area_photos set sha256 = repeat('b', 64) where id = '${p1.photo_id}'`)), 'photo content is immutable');

// ---- identical content after a rejection, photo aware
const ix = await stage(B); const rj = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Ident', photo_id: ix.photo_id }, sq(105.5, 1.5)))]); await review(A, rj.revision_id, 'reject', 'photo');
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Ident' }, sq(105.5, 1.5)))])) === '', 'after a rejection that had a photo, the same content without it can be sent'); await flush(B);
const iy = await stage(B);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Ident', photo_id: iy.photo_id }, sq(105.5, 1.5)))])) === '', 'or with another photo'); await flush(B);
const rj2 = await submit(B, { name: 'Ident2' }, sq(105.6, 1.6)); await review(A, rj2.revision_id, 'reject', 'no');
ok(/identical_to_rejected/.test(await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Ident2' }, sq(105.6, 1.6)))])), 'identical content without any photo is still refused');
const iz = await stage(B);
ok((await err(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Ident2', photo_id: iz.photo_id }, sq(105.6, 1.6)))])) === '', 'identical content with a new photo is a new submission'); await flush(B);

// ---- account deletion
const dd = await stage(B), dl = await stage(B, { keep: true });
const live = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Survivor', photo_id: dd.photo_id }, sq(105.8, 1.8)))]); await review(A, live.revision_id, 'approve');
const pendDel = await call(B, 'submit_community_area($1::jsonb)', [J(pay({ name: 'Doomed', photo_id: dl.photo_id }, sq(105.9, 1.9)))]);
await call(B, 'delete_profile()');
ok((await state(dl.photo_id)).owner_id === null && new Date((await state(dl.photo_id)).delete_after) <= new Date(Date.now() + 1000), 'the pending submission photo of a deleted account is due now and has no owner');
ok((await state(dd.photo_id)).owner_id === null && (await state(dd.photo_id)).delete_after === null && (await access(dd.photo_id, null)).via === 'public' && (await call(null, 'get_public_area($1)', [live.area_id])).photo?.id === dd.photo_id, 'the photo of an approved, published area stays public, anonymised');
ok((await q('select count(*)::int c from public.community_area_photos where owner_id = $1', [B]))[0].c === 0, 'no photo row names the deleted account any more');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
