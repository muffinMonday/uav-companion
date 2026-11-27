// Community flying areas, Stage 3 client: recovering the account's own submissions as local drafts (recover.js, store.restore, api.myRevision, the admin republish call). No browser.
import { createAreaStore } from '../src/areas/store.js';
import { groupRows, entryLine, submissionFor, createRecovery } from '../src/areas/recover.js';
import { contentHash, cleanListRow, describeError, createAreasApi } from '../src/areas/api.js';
import { createAdminApi, describeAdminError } from '../src/areas/admin-api.js';
import { validateArea, closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const id = (n) => `3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e${String(n).padStart(2, '0')}`;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const rev = (n, over = {}) => ({ area_id: id(1), revision_id: id(n), revision_no: 1, status: 'approved', name: 'Marina Park', description: 'Open grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] }, spots: [{ type: 'shelter', note: 'Pavilion', coordinates: [103.805, 1.305] }], area_m2: 1000, submitted_at: '2026-11-01T00:00:00Z', reviewed_at: null, review_reason: null, published: false, ...over });
const row = (r) => ({ area_id: r.area_id, revision_id: r.revision_id, revision_no: r.revision_no, name: r.name, status: r.status, submitted_at: r.submitted_at, reviewed_at: r.reviewed_at, review_reason: r.review_reason, published: r.published });

// ---- list rows keep the name
ok(cleanListRow(row(rev(10)))?.name === 'Marina Park' && cleanListRow({ ...row(rev(10)), name: 5 })?.name === '', 'cleanListRow keeps the name (text only)');

// ---- grouping
const rows = [rev(10, { revision_no: 1, submitted_at: '2026-11-01T00:00:00Z', published: false }), rev(11, { revision_no: 2, status: 'pending', name: 'Marina Park v2', submitted_at: '2026-11-05T00:00:00Z' }),
  rev(12, { area_id: id(2), name: 'Other', status: 'rejected', review_reason: 'Too big', submitted_at: '2026-11-03T00:00:00Z' })].map((r) => cleanListRow(row(r)));
rows[0].published = true;
const g = groupRows(rows);
ok(g.length === 2 && g[0].areaId === id(1) && g[0].name === 'Marina Park v2' && g[0].latest.status === 'pending' && g[0].live && g[0].revisions === 2, 'one entry per area, newest first, named after its newest revision, live when a revision is published');
ok(/Change pending review.*published version is live/.test(entryLine(g[0])) && /Not approved.*Reason: Too big/.test(entryLine(g[1])), 'plain-language lines for a pending change and a rejection');
ok(/Approved and published/.test(entryLine({ latest: { status: 'approved', revisionNo: 1, submittedAt: '2026-11-01T00:00:00Z' }, live: true, everApproved: true })) && /not currently published/.test(entryLine({ latest: { status: 'approved', revisionNo: 1, submittedAt: '2026-11-01T00:00:00Z' }, live: false, everApproved: true })), 'an approved area that is not live says so');
ok(/Withdrawn/.test(entryLine({ latest: { status: 'withdrawn', revisionNo: 1 }, live: false, everApproved: false })), 'withdrawn');

// ---- submission reference
const sub1 = submissionFor(rev(10), 'abcdef01'), sub2 = submissionFor(rev(11, { revision_no: 2, status: 'rejected', review_reason: 'No' }), 'abcdef01');
ok(sub1.status === 'approved' && sub1.areaId === id(1) && sub1.revisionId === id(10) && !('revision' in sub1) && sub1.key === null, 'revision 1: linked, no revision flag (an approved area is a revision target by its status)');
ok(sub2.revision === true && sub2.reason === 'No' && sub2.status === 'rejected', 'a revision above 1 is a change to a published area and keeps its reason');

// ---- store.restore
const st = createAreaStore({ storage: mem() });
const v = validateArea({ name: 'Marina Park', description: 'Open grass', geometry: rev(10).geometry, spots: rev(10).spots, drawKind: 'polygon' });
const hash = contentHash(v.area);
let r = st.restore(v.area, submissionFor(rev(10), hash));
ok(r.ok && r.area.submission.areaId === id(1) && r.area.submission.status === 'approved' && st.count() === 1 && r.area.id.startsWith('a'), 'restore adds one local record with its submission reference');
const localId = r.area.id;
r = st.restore(v.area, submissionFor(rev(10), hash));
ok(!r.ok && r.code === 'duplicate' && r.existingId === localId && st.count() === 1, 'a second restore of the same server area is refused (no duplicate)');
r = st.restore({ ...v.area, name: 'Renamed' }, submissionFor(rev(11, { revision_no: 2, status: 'pending' }), hash), { replaceId: localId });
ok(r.ok && st.count() === 1 && st.get(localId).name === 'Renamed' && st.get(localId).submission.revisionId === id(11) && st.get(localId).created === r.area.created, 'replace overwrites that record in place and keeps its id');
ok(st.restore(v.area, null).code === 'bad-submission' && st.restore(v.area, { status: 'pending', areaId: id(5) }).code === 'bad-submission', 'a missing or incomplete reference is refused');
ok(st.restore({ ...v.area, name: '' }, submissionFor(rev(20, { area_id: id(7) }), hash)).ok === false && st.count() === 1, 'an invalid server copy is not stored');
ok(st.restore(v.area, submissionFor(rev(21, { area_id: id(8) }), hash), { replaceId: 'nope' }).code === 'not-found', 'replacing a record that does not exist is refused');
const big = createAreaStore({ storage: mem() }); let last;
for (let i = 0; i <= 200; i++) { last = big.restore(v.area, submissionFor(rev(30, { area_id: `3f1b9c0e-6a52-4d3b-9a3e-${String(i).padStart(12, '0')}`, revision_id: `4f1b9c0e-6a52-4d3b-9a3e-${String(i).padStart(12, '0')}` }), hash)); if (!last.ok) break; }
ok(!last.ok && last.code === 'too-many-areas', 'the local limit still applies');

// ---- the recovery controller with a fake account
const fake = (data, { signedIn = true } = {}) => {
  const calls = [];
  const backend = { available: () => true, signedIn: () => signedIn, rpc: async (fn, args) => { calls.push({ fn, args }); return data(fn, args); } };
  return { backend, calls };
};
const serverRows = [rows[0], rows[1], rows[2]].map((x) => ({ area_id: x.areaId, revision_id: x.revisionId, revision_no: x.revisionNo, name: x.name, status: x.status, submitted_at: x.submittedAt, reviewed_at: x.reviewedAt, review_reason: x.reason, published: x.published }));
const bodies = { [id(10)]: rev(10, { published: true }), [id(11)]: rev(11, { revision_no: 2, status: 'pending', name: 'Marina Park v2' }), [id(12)]: rev(12, { area_id: id(2), name: 'Other', status: 'rejected', review_reason: 'Too big' }) };
const f1 = fake((fn, a) => (fn === 'list_my_community_areas' ? { data: serverRows } : fn === 'get_my_community_revision' ? { data: bodies[a.p_revision_id] ?? null } : { data: null }));
const s2 = createAreaStore({ storage: mem() }), rc = createRecovery({ store: s2, backend: f1.backend });
let l = await rc.list();
ok(l.length === 2 && l.every((e) => e.local === null) && f1.calls.every((c) => c.fn === 'list_my_community_areas'), 'list reads only the account list and shows nothing on this device yet');
let out = await rc.recover(id(1));
ok(out.ok && out.replaced === false && s2.count() === 1 && s2.list()[0].name === 'Marina Park v2' && s2.list()[0].submission.status === 'pending' && s2.list()[0].submission.revision === true, 'recover rebuilds the NEWEST revision (the pending change) as a local draft linked to it');
ok(f1.calls.map((c) => c.fn).every((fn) => ['list_my_community_areas', 'get_my_community_revision'].includes(fn)), 'only the two read functions were called: nothing is written to the account');
out = await rc.recover(id(1));
ok(!out.ok && out.code === 'exists' && out.existingId && s2.count() === 1, 'a second recover without confirmation is refused: no duplicate');
l = await rc.list();
ok(l.find((e) => e.areaId === id(1)).local?.changed === false, 'an untouched recovered copy is not reported as changed');
s2.update(s2.list()[0].id, { ...s2.list()[0], name: 'Edited locally' });
l = await rc.list();
ok(l.find((e) => e.areaId === id(1)).local?.changed === true && l.find((e) => e.areaId === id(1)).local.name === 'Edited locally', 'local edits are noticed, so the replace warning can say so');
out = await rc.recover(id(1), { replace: true });
ok(out.ok && out.replaced === true && s2.count() === 1 && s2.list()[0].name === 'Marina Park v2', 'with replace the local copy is overwritten by the server version, still one record');
out = await rc.recover(id(2));
ok(out.ok && s2.count() === 2 && s2.list().find((a) => a.submission.areaId === id(2)).submission.reason === 'Too big' && s2.list().find((a) => a.submission.areaId === id(2)).submission.status === 'rejected', 'a rejected submission is recovered with its reason and can be resubmitted');
out = await rc.recover(id(9));
ok(!out.ok && out.code === 'not-found' && s2.count() === 2, 'an area that is not on the account is not found');
const f2 = fake((fn) => (fn === 'list_my_community_areas' ? { data: serverRows } : { data: null }));
out = await createRecovery({ store: createAreaStore({ storage: mem() }), backend: f2.backend }).recover(id(1));
ok(!out.ok && out.code === 'not-found', "the server answering null for a revision (not the caller's) stores nothing");
const f3 = fake((fn) => (fn === 'list_my_community_areas' ? { data: serverRows } : { data: { ...bodies[id(11)], geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } } }));
const s4 = createAreaStore({ storage: mem() });
out = await createRecovery({ store: s4, backend: f3.backend }).recover(id(1));
ok(!out.ok && out.code === 'invalid' && s4.count() === 0, 'a server copy that fails the local checks is not stored');
const f4 = fake(() => ({ error: { message: 'fetch failed' } }));
out = await createRecovery({ store: createAreaStore({ storage: mem() }), backend: f4.backend }).recover(id(1));
ok(!out.ok && out.code === 'network', 'a network failure is reported, not treated as "nothing found"');
const f5 = fake(() => ({ data: [] }), { signedIn: false });
out = await createRecovery({ store: createAreaStore({ storage: mem() }), backend: f5.backend }).recover(id(1));
ok(!out.ok && out.code === 'signed-out' && f5.calls.length === 0, 'signed out: no request at all');
let thrown = null; try { await createRecovery({ store: createAreaStore({ storage: mem() }), backend: f5.backend }).list(); } catch (e) { thrown = e; }
ok(thrown?.code === 'signed-out', 'list while signed out says to sign in');
// two taps at once are one request
const f6 = fake(async (fn, a) => { await new Promise((r) => setTimeout(r, 20)); return fn === 'list_my_community_areas' ? { data: serverRows } : { data: bodies[a.p_revision_id] ?? null }; });
const s6 = createAreaStore({ storage: mem() }), rc6 = createRecovery({ store: s6, backend: f6.backend });
const [o1, o2] = await Promise.all([rc6.recover(id(1)), rc6.recover(id(1))]);
ok([o1, o2].filter((x) => x.ok).length === 1 && [o1, o2].some((x) => x.code === 'busy') && s6.count() === 1, 'two presses at once create one local record');

// ---- api: myRevision and errors
const api = createAreasApi(f1.backend);
ok((await api.myRevision(id(10))).name === 'Marina Park' && (await api.myRevision('x')) === null && (await api.myRevision(id(99))) === null, 'myRevision returns the revision, null for a bad id or when the server has none');
let t2 = null; try { await createAreasApi(fake(() => ({ data: { ...bodies[id(10)], revision_id: id(11) } })).backend).myRevision(id(10)); } catch (e) { t2 = e; }
ok(t2?.code === 'bad-response', 'a response for a different revision than the one asked for is refused');
ok(describeError({ message: 'identical_to_rejected' }).code === 'identical-to-rejected' && /declined/.test(describeError({ message: 'identical_to_rejected' }).message), 'identical_to_rejected has its own plain message');

// ---- administrator: explicit republish
const adm = fake(() => ({ data: { status: 'approved', changed: true, xp_awarded: false, xp: 0 } }));
const aa = createAdminApi(adm.backend), item = { revisionId: id(11), own: false };
await aa.review(item, 'approve', {});
ok(!('p_republish' in adm.calls.at(-1).args), 'an ordinary approval does not send p_republish');
await aa.review(item, 'approve', { republish: true });
ok(adm.calls.at(-1).args.p_republish === true, 'the explicit decision sends p_republish = true');
await aa.review(item, 'reject', { reason: 'no', republish: true });
ok(!('p_republish' in adm.calls.at(-1).args), 'a rejection never sends it');
ok(describeAdminError({ message: 'area_unpublished' }).code === 'area_unpublished' && /publish it again/.test(describeAdminError({ message: 'area_unpublished' }).message), 'the refusal is recognised and explained');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
