// Community flying areas, Phase 3: the pure client checks of src/areas/admin-api.js (response cleaning, reason and reward rules, request shape, error mapping). No DOM, no network.
import { cleanItem, cleanPage, checkReason, checkReward, describeAdminError, createAdminApi, XP_AMOUNTS, XP_DEFAULT } from '../src/areas/admin-api.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const raw = (over = {}) => ({ revision_id: U(1), area_id: U(2), revision_no: 1, name: 'Park', description: 'Grass', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.31], [103.8, 1.3]]] }, spots: [{ type: 'open', note: '', coordinates: [103.805, 1.305] }],
  area_m2: 1.2e6, status: 'pending', submitted_at: '2026-11-01T00:00:00Z', contributor_name: 'Bea', contributor_code: 'abcdef0123', own: false, has_published: false, ...over });

ok(XP_AMOUNTS.join() === '100,200,300,400,500' && XP_DEFAULT === 100, 'the reward steps are 100 to 500 and the default is 100');
const it = cleanItem(raw());
ok(it && it.revisionId === U(1) && it.contributorCode === 'abcdef0123' && it.ring.length === 5 && it.spots.length === 1 && it.valid, 'a well-formed item is cleaned');
ok(cleanItem(raw({ revision_id: 'x' })) === null && cleanItem(raw({ status: 'bogus' })) === null && cleanItem(raw({ submitted_at: 'no' })) === null && cleanItem(null) === null, 'malformed items are dropped');
ok(cleanItem(raw({ geometry: { type: 'Point', coordinates: [1, 1] } })).valid === false && cleanItem(raw({ geometry: { type: 'Point' } })).ring === null, 'an invalid outline is flagged, not hidden');
ok(cleanItem(raw({ contributor_code: '<script>' })).contributorCode === '' && cleanItem(raw({ contributor_name: 'x'.repeat(100) })).contributorName.length === 40, 'contributor fields are bounded');
const pg = cleanPage({ items: [raw(), { bad: 1 }], next_cursor: { at: '2026-11-01T00:00:00Z', id: U(1) } });
ok(pg.items.length === 1 && pg.next.id === U(1) && cleanPage({ items: [], next_cursor: { at: 'x', id: 'y' } }).next === null && cleanPage(null).items.length === 0, 'pages keep valid items and a valid cursor only');
ok(!checkReason('', true).ok && !checkReason('   ', true).ok && checkReason('', false).ok && checkReason('x'.repeat(500), true).ok && !checkReason('x'.repeat(501), true).ok && checkReason('  hi ', true).text === 'hi', 'reason rules: required for rejection, 500 characters, trimmed');
ok(checkReward(false, 300, false).award === false && checkReward(true, 300, false).amount === 300 && !checkReward(true, 250, false).ok && !checkReward(true, 0, false).ok && !checkReward(true, 600, false).ok && !checkReward(true, 100, true).ok, 'reward rules: 100 to 500 in steps, never for an own submission');
ok(describeAdminError({ message: 'not_pending' }).code === 'not_pending' && describeAdminError({ message: 'permission denied for function' }).code === 'not_allowed' && describeAdminError({ message: 'Failed to fetch' }).retryable === true && !/42501|SQL|stack/i.test(describeAdminError({ message: 'ERROR 42501 at line 3' }).message), 'errors map to controlled messages');

const sent = [];
const be = (handler) => ({ rpc: async (fn, args) => { sent.push({ fn, args }); return handler(fn, args); } });
let api = createAdminApi(be(() => ({ data: { admin: true } })));
ok(await api.isAdmin() === true && sent[0].fn === 'my_roles', 'isAdmin reads my_roles');
ok(await createAdminApi(be(() => ({ error: { message: 'x' } }))).isAdmin() === false && await createAdminApi(be(() => ({ data: { admin: 'true' } }))).isAdmin() === false, 'anything but admin: true is not an administrator');
sent.length = 0;
api = createAdminApi(be((fn) => (fn === 'review_community_area' ? { data: { status: 'approved', changed: true, xp_awarded: true, xp: 200 } } : { data: { items: [], next_cursor: null } })));
const item = cleanItem(raw());
const r = await api.review(item, 'approve', { award: true, amount: 200, reason: ' note ' });
ok(r.xpAwarded && r.xp === 200 && JSON.stringify(sent[0].args) === JSON.stringify({ p_revision_id: U(1), p_decision: 'approve', p_reason: 'note', p_award_xp: true, p_xp_amount: 200 }), 'approve sends exactly the revision, decision, note and reward');
await api.review(item, 'approve', {});
ok(sent[1].args.p_award_xp === false && sent[1].args.p_xp_amount === null && sent[1].args.p_reason === null, 'no reward flag, amount or note by default');
const fail = async (f) => { try { await f(); return null; } catch (e) { return e.code; } };
const n0 = sent.length;
ok(await fail(() => api.review(item, 'reject', { reason: '' })) === 'reason_required' && await fail(() => api.review(item, 'approve', { award: true, amount: 150 })) === 'invalid_xp_amount' && await fail(() => api.review({ ...item, own: true }, 'approve', { award: true, amount: 100 })) === 'invalid_xp_amount' && await fail(() => api.unpublish(item, ' ')) === 'reason_required' && sent.length === n0, 'invalid decisions are refused before any request');
await api.listPending(); await api.listPublished({ at: '2026-11-01T00:00:00Z', id: U(1) }, 5);
ok(sent.at(-2).args.p_limit === 20 && sent.at(-2).args.p_cursor === null && sent.at(-1).args.p_limit === 5 && sent.at(-1).args.p_cursor.id === U(1), 'list calls pass the cursor and a bounded limit');
ok(await fail(() => createAdminApi(be(() => ({ error: { message: 'not_pending' } }))).review(item, 'approve', {})) === 'not_pending' && await fail(() => createAdminApi(be(() => ({ data: { status: 'x' } }))).review(item, 'approve', {})) === 'bad-response', 'server errors and unexpected answers surface as controlled errors');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
