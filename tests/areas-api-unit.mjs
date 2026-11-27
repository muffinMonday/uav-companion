// Community flying areas, Phase 2 client logic (src/areas/api.js, submit.js, store.js submission reference). No browser, no network: the backend is a double.
import { createAreaStore, cleanSubmission, KEY, parseGeoJSON } from '../src/areas/store.js';
import { closeRing } from '../src/areas/core.js';
import { buildPayload, contentHash, describeError, cleanSubmitResult, cleanListRow, createAreasApi, newKey, isKey } from '../src/areas/api.js';
import { createSubmitController, INTENT_KEY } from '../src/areas/submit.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const mem = (init = {}) => { const m = { ...init }; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const draft = (over = {}) => ({ name: 'Park', description: 'Open grass', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] }, spots: [{ type: 'shelter', note: 'hut', coordinates: [103.805, 1.305] }], ...over });
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- payload and results
const st0 = createAreaStore({ storage: mem() }); const a0 = st0.add(draft()).area;
const p = buildPayload(a0, 'k-abcdefghijklmnop');
ok(Object.keys(p).sort().join() === 'description,draw_kind,geometry,idempotency_key,name,spots', 'the payload has only the allowed fields');
ok(!/owner|contributor|user|email|id"/.test(JSON.stringify(Object.keys(p))) && !JSON.stringify(p).includes(a0.id), 'the payload carries no identity and not the local id');
ok(isKey(newKey()) && newKey() !== newKey(), 'generated keys are valid and distinct');
ok(contentHash(a0) === contentHash(structuredClone(a0)) && contentHash(a0) !== contentHash({ ...a0, name: 'Other' }), 'the content hash follows content');
ok(cleanSubmitResult({ area_id: U1, revision_id: U2, revision_no: 1, status: 'pending', submitted_at: '2026-11-27T10:00:00Z', replayed: false })?.status === 'pending', 'a valid result is accepted');
ok(cleanSubmitResult({ area_id: 'x', revision_id: U2, status: 'pending', submitted_at: '2026-11-27T10:00:00Z' }) === null && cleanSubmitResult({ area_id: U1, revision_id: U2, status: 'weird', submitted_at: '2026-11-27T10:00:00Z' }) === null && cleanSubmitResult(null) === null, 'malformed results are refused');
ok(cleanListRow({ area_id: U1, revision_id: U2, status: 'rejected', submitted_at: '2026-11-27T10:00:00Z', review_reason: 'x'.repeat(900) }).reason.length === 500, 'a list row is cleaned and bounded');
ok(describeError({ message: 'invalid_area: self-intersection' }).code === 'invalid' && describeError({ message: 'pending_limit_reached' }).code === 'limit' && describeError({ message: 'idempotency_conflict' }).code === 'conflict' && describeError({ message: 'Failed to fetch' }).retryable === true && describeError({ message: 'not signed in' }).code === 'signed-out', 'errors map to codes; only unknown or network failures are retryable');
ok(!/select|relation|public\./i.test(describeError({ message: 'relation "public.x" does not exist' }).message), 'an unexpected error shows no SQL details');

// ---- store: the submission reference
{
  const s = mem(); const st = createAreaStore({ storage: s }); const a = st.add(draft()).area;
  const sub = { status: 'pending', key: 'k-abcdefghijklmnop', contentHash: contentHash(a), areaId: U1, revisionId: U2, revisionNo: 1, submittedAt: '2026-11-27T10:00:00.000Z' };
  ok(st.setSubmission(a.id, sub) && st.get(a.id).submission.revisionId === U2, 'a submission reference is stored on the local area');
  ok(JSON.parse(s.m[KEY]).v === 1 && KEY === 'uavzones.v1.areas', 'same key and version');
  ok(createAreaStore({ storage: s }).get(a.id).submission.status === 'pending', 'the link survives a reload');
  ok(st.update(a.id, draft({ name: 'Edited' })).ok && st.get(a.id).submission.status === 'pending' && st.get(a.id).submission.revisionId === U2, 'editing keeps the link');
  const d = st.duplicate(a.id).area; ok(d.submission === null, 'a duplicate does not inherit the submission');
  const imp = createAreaStore({ storage: mem() }); const gj = st.toGeoJSON([a.id]); ok(!JSON.stringify(gj).includes(U2) && !JSON.stringify(gj).includes('submission'), 'export carries no submission reference');
  imp.importGeoJSON(JSON.stringify(gj)); ok(imp.list()[0].submission === null, 'an imported area has no submission');
  const forged = JSON.parse(JSON.stringify(gj)); forged.features[0].properties.submission = sub; imp.importGeoJSON(JSON.stringify(forged)); ok(imp.list().every((x) => x.submission === null), 'a submission forged inside an imported file is ignored');
  ok(!st.setSubmission(a.id, { status: 'pending', revisionId: 'nope' }) && !st.setSubmission(a.id, { status: 'bogus' }) && !st.setSubmission(a.id, { status: 'pending' }), 'invalid references are refused');
  ok(st.setSubmission(a.id, null) && st.get(a.id).submission === null, 'a reference can be cleared');
  const raw = JSON.parse(s.m[KEY]); raw.areas[0].submission = { status: 'pending', revisionId: '<script>' }; s.m[KEY] = JSON.stringify(raw);
  const bad = createAreaStore({ storage: s }); ok(bad.list().length === 2 && bad.list()[0].submission === null && cleanSubmission('x') === null, 'a damaged reference is dropped; the area itself is kept');
  const legacy = createAreaStore({ storage: mem({ [KEY]: JSON.stringify({ v: 1, areas: [{ ...st.list()[0], submission: undefined, id: 'alegacy' }] }) }) });
  ok(legacy.list().length === 1 && legacy.get('alegacy').submission === null, 'Phase 1 records (no reference) still load');
}

// ---- controller
function backend({ signed = true, available = true, fail = null, delay = 0 } = {}) {
  const b = { signed, fail, calls: [], rows: [], listeners: new Set(), signIns: 0,
    avail: () => available, signedIn: () => b.signed, signIn: () => { b.signIns++; }, onChange: (f) => { b.listeners.add(f); return () => b.listeners.delete(f); },
    rpc: async (fn, args) => {
      b.calls.push({ fn, args }); if (delay) await new Promise((r) => setTimeout(r, delay));
      if (b.fail) { const f = typeof b.fail === 'function' ? b.fail(fn) : b.fail; if (f) return f; }
      if (fn === 'submit_community_area') { const ex = b.seen?.get(args.p_payload.idempotency_key); b.seen ??= new Map(); const r = ex ?? { area_id: U1, revision_id: U2, revision_no: 1, status: 'pending', submitted_at: '2026-11-27T10:00:00Z', replayed: false }; b.seen.set(args.p_payload.idempotency_key, { ...r, replayed: true }); return { data: r }; }
      if (fn === 'list_my_community_areas') return { data: b.rows };
      if (fn === 'withdraw_community_revision') return { data: { revision_id: args.p_revision_id, status: 'withdrawn', changed: true } };
      return { error: { message: 'unknown' } };
    } };
  return b;
}
const mk = (opts) => { const store = createAreaStore({ storage: mem() }); const id = store.add(draft()).area.id; const be = backend(opts); const store2 = mem(); const ctl = createSubmitController({ store, backend: { ...be, available: be.avail ?? (() => true) }, storage: store2 }); return { store, id, be, ctl, store2 }; };
{
  const { store, id, be, ctl } = mk({ signed: false });
  ok(!(await ctl.submit(id)).ok && (await ctl.submit(id)).code === 'signed-out' && be.calls.length === 0, 'a guest cannot submit; nothing is sent');
}
{
  const { store, id, be, ctl } = mk();
  const before = JSON.stringify(store.get(id).geometry);
  const r = await ctl.submit(id);
  const a = store.get(id);
  ok(r.ok && a.submission.status === 'pending' && a.submission.revisionId === U2 && a.submission.submittedAt, 'success records the pending reference and date');
  ok(JSON.stringify(a.geometry) === before && store.count() === 1, 'the draft is untouched and still there');
  ok(be.calls.length === 1 && be.calls[0].fn === 'submit_community_area' && be.calls[0].args.p_payload.name === 'Park', 'one request was made');
  ok(ctl.state(a).kind === 'pending' && !ctl.eligible(a), 'a pending area is not eligible to submit again');
  ok(!(await ctl.submit(id)).ok && be.calls.length === 1, 'a second submit of a pending area sends nothing');
  store.update(id, draft({ name: 'Edited' })); ok(ctl.state(store.get(id)).changed === true && ctl.state(store.get(id)).kind === 'pending', 'edits after submission are flagged as changed since');
  const w = await ctl.withdraw(id);
  ok(w.ok && store.get(id).submission.status === 'withdrawn' && store.count() === 1, 'withdraw marks it withdrawn and keeps the draft');
  ok(ctl.eligible(store.get(id)), 'a withdrawn area can be submitted again');
  const r2 = await ctl.submit(id); ok(r2.ok && be.calls.filter((c) => c.fn === 'submit_community_area').length === 2 && be.calls[0].args.p_payload.idempotency_key !== be.calls[2].args.p_payload.idempotency_key, 'resubmitting after withdrawal uses a new key');
}
{ // network failure then retry with the same key
  const { store, id, be, ctl } = mk({ fail: { error: { message: 'Failed to fetch' } } });
  const r = await ctl.submit(id); const a = store.get(id);
  ok(!r.ok && r.code === 'network' && a.submission.status === 'unsent' && a.submission.key && store.count() === 1, 'a network failure keeps the draft and the idempotency key');
  const key1 = a.submission.key;
  ok(ctl.eligible(a) && /did not finish/.test(ctl.state(a).kind === 'unsent' ? 'did not finish' : ''), 'the draft can be retried');
  be.fail = null; const r2 = await ctl.submit(id);
  ok(r2.ok && be.calls.at(-1).args.p_payload.idempotency_key === key1, 'the retry reuses the same key');
  ok(store.get(id).submission.status === 'pending' && store.get(id).submission.key === key1, 'then it is pending');
}
{ // edited between failed attempts: new key (the old one would conflict)
  const { store, id, be, ctl } = mk({ fail: { error: { message: 'Failed to fetch' } } });
  await ctl.submit(id); const k1 = store.get(id).submission.key; store.update(id, draft({ name: 'Changed' })); be.fail = null; await ctl.submit(id);
  ok(be.calls.at(-1).args.p_payload.idempotency_key !== k1, 'content changed after a failed attempt: a new key');
}
{ // refusals
  const { store, id, ctl } = mk({ fail: { error: { message: 'invalid_area: too-large' } } });
  const r = await ctl.submit(id); ok(!r.ok && r.code === 'invalid' && /25 km²/.test(r.message) && store.get(id).submission === null && store.count() === 1, 'a server refusal explains why, keeps the draft and forgets the key');
  const m = mk({ fail: { error: { message: 'pending_limit_reached' } } }); const r2 = await m.ctl.submit(m.id);
  ok(!r2.ok && r2.code === 'limit' && /5 submissions/.test(r2.message) && m.store.get(m.id).submission === null, 'the five-pending limit is explained');
  const u = mk({ available: false }); ok((await u.ctl.submit(u.id)).code === 'unavailable', 'no account support: a clear refusal');
}
{ // double press
  const { store, id, be, ctl } = mk({ delay: 20 });
  const [a, b2, c] = await Promise.all([ctl.submit(id), ctl.submit(id), ctl.submit(id)]);
  ok([a, b2, c].filter((r) => r.ok).length === 1 && be.calls.filter((x) => x.fn === 'submit_community_area').length === 1, 'repeated presses while in flight send one request');
  ok(!ctl.isBusy(id) && ctl.state(store.get(id)).kind === 'pending', 'busy is cleared afterwards');
}
{ // refresh
  const { store, id, be, ctl } = mk(); await ctl.submit(id);
  be.rows = [{ area_id: U1, revision_id: U2, revision_no: 1, name: 'x', status: 'rejected', submitted_at: '2026-11-27T10:00:00Z', reviewed_at: '2026-11-28T10:00:00Z', review_reason: 'Too vague', published: false }];
  await ctl.refresh(); ok(store.get(id).submission.status === 'rejected' && store.get(id).submission.reason === 'Too vague', 'refresh brings a decision into the local record');
  be.rows = []; await ctl.refresh(); ok(store.get(id).submission.status === 'missing' && ctl.eligible(store.get(id)), 'a submission not found for this account is marked and can be resubmitted');
  ok(store.count() === 1, 'refresh never creates or deletes local areas');
  const out = mk({ signed: false }); const n = out.be.calls.length; await out.ctl.refresh(); ok(out.be.calls.length === n, 'signed out: no request');
}
{ // withdraw edge cases
  const { store, id, be, ctl } = mk(); await ctl.submit(id);
  be.fail = (fn) => (fn === 'withdraw_community_revision' ? { error: { message: 'not_withdrawable' } } : null);
  be.rows = [{ area_id: U1, revision_id: U2, revision_no: 1, name: 'x', status: 'approved', submitted_at: '2026-11-27T10:00:00Z', reviewed_at: null, review_reason: null, published: true }];
  const w = await ctl.withdraw(id); ok(!w.ok && w.code === 'not-withdrawable' && store.get(id).submission.status === 'approved', 'withdrawing something already approved is refused and the real status is shown');
  ok(!(await ctl.withdraw(id)).ok, 'an approved submission offers no withdrawal');
}
// sign-in intent
{
  const { store, id, ctl, store2 } = mk(); let t = 1_000_000; const c2 = createSubmitController({ store, backend: ctl.backend, storage: store2, now: () => t });
  c2.intent.set(id); ok(JSON.parse(store2.m[INTENT_KEY]).areaId === id, 'the intent stores only the local area id and a time');
  ok(c2.intent.take() === id && !(INTENT_KEY in store2.m), 'it is returned once and cleared');
  c2.intent.set(id); t += 31 * 60 * 1000; ok(c2.intent.take() === null, 'an old intent expires');
  c2.intent.set('gone'); ok(c2.intent.take() === null, 'an intent for a deleted area is ignored');
  store2.m[INTENT_KEY] = '{bad'; ok(c2.intent.take() === null, 'a damaged intent is ignored');
}
{ const api = createAreasApi({ rpc: async () => ({ data: { weird: 1 } }) }); let e; try { await api.submit({}); } catch (x) { e = x; } ok(e?.code === 'bad-response', 'an unexpected response is not trusted'); }

// ---- Phase 5: revisions of a published area
{
  const U3 = '33333333-3333-4333-8333-333333333333';
  ok(describeError({ message: 'not_published' }).code === 'not-published' && describeError({ message: 'revision_pending' }).code === 'revision-pending' && describeError({ message: 'no_change' }).code === 'no-change', 'revision errors are named');
  ok(cleanSubmission({ status: 'pending', areaId: U1, revisionId: U2, revision: true })?.revision === true && cleanSubmission({ status: 'unsent', revision: true })?.revision === undefined, 'the revision flag needs an area id');
  const calls = []; let n = 0;
  const rpc = async (fn, args) => { calls.push({ fn, args }); if (fn === 'submit_community_revision') return { data: { area_id: args.p_area_id, revision_id: U3, revision_no: 2 + n++, status: 'pending', submitted_at: '2026-11-28T10:00:00Z', replayed: false } }; if (fn === 'withdraw_community_revision') return { data: { revision_id: args.p_revision_id, status: 'withdrawn', changed: true } }; if (fn === 'list_my_community_areas') return { data: [] }; return { error: { message: 'unknown' } }; };
  const store = createAreaStore({ storage: mem() }); const id = store.add(draft()).area.id;
  const ctl = createSubmitController({ store, backend: { available: () => true, signedIn: () => true, signIn() {}, rpc, onChange: () => () => {} }, storage: mem() });
  store.setSubmission(id, { status: 'approved', key: 'k-abcdefghijklmnop', contentHash: contentHash(store.get(id)), areaId: U1, revisionId: U2, revisionNo: 1, submittedAt: '2026-11-27T10:00:00.000Z' });
  ok(!ctl.eligible(store.get(id)), 'an approved area with an unchanged draft cannot be resubmitted');
  store.update(id, { ...draft(), description: 'Better description' });
  ok(ctl.eligible(store.get(id)) && ctl.isRevision(store.get(id)), 'once the draft differs from the approved version it can be submitted as a revision');
  const r = await ctl.submit(id);
  const a = store.get(id);
  ok(r.ok && calls.length === 1 && calls[0].fn === 'submit_community_revision' && calls[0].args.p_area_id === U1 && !('area_id' in calls[0].args.p_payload), 'the revision goes to submit_community_revision with the known area id outside the payload');
  ok(a.submission.status === 'pending' && a.submission.revision === true && a.submission.areaId === U1 && a.submission.revisionId === U3 && a.submission.revisionNo === 2, 'the local link now points at the pending revision, flagged as a revision');
  ok(!ctl.eligible(a) && !(await ctl.submit(id)).ok && calls.length === 1, 'a pending revision blocks another submission');
  ok((await ctl.withdraw(id)).ok && store.get(id).submission.status === 'withdrawn' && store.get(id).submission.revision === true && store.get(id).submission.areaId === U1, 'withdrawing keeps the area link and the revision flag');
  store.update(id, { ...draft(), description: 'Corrected again' });
  const r2 = await ctl.submit(id);
  ok(r2.ok && calls[calls.length - 1].fn === 'submit_community_revision' && calls[calls.length - 1].args.p_area_id === U1 && store.get(id).submission.revisionNo === 3, 'a corrected resubmission after a withdrawal is a new revision of the same area, never a new area');
  const be2 = { available: () => true, signedIn: () => true, signIn() {}, rpc: async () => ({ error: { message: 'not_published' } }), onChange: () => () => {} };
  const st2 = createAreaStore({ storage: mem() }); const id2 = st2.add(draft()).area.id;
  st2.setSubmission(id2, { status: 'rejected', key: 'k-abcdefghijklmnop', contentHash: 'deadbeef', areaId: U1, revisionId: U2, revision: true });
  const c2 = createSubmitController({ store: st2, backend: be2, storage: mem() });
  const r3 = await c2.submit(id2);
  ok(!r3.ok && r3.code === 'not-published' && st2.get(id2).submission.status === 'rejected' && st2.get(id2).submission.revision === true, 'a refusal (area no longer published) leaves the rejected revision and its link in place');
  const st3 = createAreaStore({ storage: mem() }); const id3 = st3.add(draft()).area.id; const seen = [];
  st3.setSubmission(id3, { status: 'rejected', key: 'k-abcdefghijklmnop', contentHash: 'deadbeef', areaId: U1, revisionId: U2 });
  const c3 = createSubmitController({ store: st3, backend: { available: () => true, signedIn: () => true, signIn() {}, rpc: async (fn) => { seen.push(fn); return { data: { area_id: U3, revision_id: U2, revision_no: 1, status: 'pending', submitted_at: '2026-11-28T10:00:00Z', replayed: false } }; }, onChange: () => () => {} }, storage: mem() });
  await c3.submit(id3);
  ok(seen[0] === 'submit_community_area' && !c3.isRevision(st3.get(id3)), 'a rejected first submission is resubmitted as before (new area; nothing public existed)');
}
process.exit(fails ? 1 : 0);
