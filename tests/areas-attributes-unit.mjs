// Community flying areas, Stage 4 client: site attributes (core.js validateAttributes, payload and fingerprint, submission gate, editor, GeoJSON, review comparison, public and explorer views, recovery).
// No browser.
import { validateAttributes, attributesComplete, hasAttributes, validateArea, closeRing, ENVIRONMENTS, ACCESS, ACTIVITIES, SURFACES, HAZARDS } from '../src/areas/core.js';
import { buildPayload, contentHash, describeError } from '../src/areas/api.js';
import { createAreaStore } from '../src/areas/store.js';
import { createEditor } from '../src/areas/editor.js';
import { createSubmitController } from '../src/areas/submit.js';
import { publicView } from '../src/areas/adapter-public.js';
import { cleanItem, describeChanges, attributeLines, cleanPublished } from '../src/areas/admin-api.js';
import { cleanItem as exploreItem } from '../src/areas/explorer-api.js';
import { createRecovery, submissionFor } from '../src/areas/recover.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const id = (n) => `3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e${String(n).padStart(2, '0')}`;
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const base = (over = {}) => ({ name: 'Park', description: '', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] }, spots: [], ...over });
const FULL = { environment: 'beach', access: 'public', activities: ['other', 'fpv'], surface: 'sand', hazards: ['water', 'people'], observed_on: '2026-11-01' };

// ---- the lists match the server's (plan 13.1 + owner decision: Other on environment, activities, hazards)
ok(Object.keys(ENVIRONMENTS).join() === 'open_field,park,beach,water,hill,woodland,urban,other,unknown' && Object.keys(ACCESS).join() === 'public,permission,restricted,unknown', 'environment and access values');
ok(Object.keys(ACTIVITIES).join() === 'fpv,cinematic,cruising,long_range,fixed_wing,other' && Object.keys(SURFACES).join() === 'grass,paved,dirt,sand,rock,mixed,unknown' && Object.keys(HAZARDS).join() === 'people,roads,power_lines,trees,water,wildlife,uneven,airspace,other,none_reported,unknown', 'activity, surface and hazard values');
ok(/permission/i.test(ACCESS.permission) && /not verified/i.test(ACCESS.unknown) && !/safe|allowed|legal/i.test(Object.values(ACCESS).join(' ').replace(/Public access \(subject to local rules\)/, '')), 'access wording never says safe, allowed or legal');

// ---- validateAttributes
let r = validateAttributes(FULL);
ok(r.ok && r.attributes.activities.join() === 'fpv,other' && r.attributes.hazards.join() === 'people,water', 'valid attributes are kept, lists in canonical order');
ok(validateAttributes(undefined).ok && validateAttributes(null).ok && validateAttributes({}).ok && hasAttributes(validateAttributes({}).attributes) === false, 'missing, null and {} are valid drafts and stay empty');
const dropped = validateAttributes({ environment: 'park', activities: [], hazards: null, surface: null, observed_on: null });
ok(dropped.ok && JSON.stringify(dropped.attributes) === '{"environment":"park"}', 'empty lists and nulls are dropped: unknown stays unknown');
for (const [m, a] of [['array', []], ['string', 'x'], ['unknown key', { environment: 'park', verified: true }], ['bad environment', { environment: 'moon' }], ['bad access', { access: 'free' }], ['bad surface', { surface: 'lava' }],
  ['activities not list', { activities: 'fpv' }], ['bad activity', { activities: ['racing'] }], ['duplicate activity', { activities: ['fpv', 'fpv'] }], ['bad hazard', { hazards: ['ghosts'] }],
  ['none_reported + other', { hazards: ['none_reported', 'roads'] }], ['unknown + other', { hazards: ['unknown', 'people'] }], ['none_reported + unknown', { hazards: ['none_reported', 'unknown'] }],
  ['bad date', { observed_on: 'x' }], ['impossible date', { observed_on: '2026-02-30' }], ['datetime', { observed_on: '2026-01-01T00:00:00Z' }], ['future date', { observed_on: '2999-01-01' }], ['before 2000', { observed_on: '1999-12-31' }], ['date number', { observed_on: 20260101 }]]) {
  ok(validateAttributes(m === 'array' ? [] : a).ok === false, `${m} is refused`);
}
ok(validateAttributes({ hazards: ['none_reported'] }).ok && validateAttributes({ hazards: ['unknown'] }).ok, '"none reported" and "unknown" are valid alone, and distinct');
ok(validateAttributes({ observed_on: new Date().toISOString().slice(0, 10) }).ok, "today's date is accepted");
ok(attributesComplete({ environment: 'unknown', access: 'unknown' }) && !attributesComplete({ environment: 'park' }) && !attributesComplete({}) && !attributesComplete(undefined), 'complete = environment and access chosen (Unknown counts as chosen)');

// ---- areas
const v = validateArea(base({ attributes: FULL }));
ok(v.ok && v.area.attributes.environment === 'beach', 'validateArea keeps normalised attributes');
ok(validateArea(base()).area.attributes && JSON.stringify(validateArea(base()).area.attributes) === '{}', 'an area without attributes has {} (not provided)');
ok(!validateArea(base({ attributes: { environment: 'moon' } })).ok && validateArea(base({ attributes: { environment: 'moon' } })).errors[0].code === 'attributes', 'invalid attributes make the area invalid with their own code');

// ---- payload and fingerprint
const plain = validateArea(base()).area, rich = validateArea(base({ attributes: { environment: 'park', access: 'permission' } })).area;
ok(!('attributes' in buildPayload(plain, 'k-abcdefghijklmnop')) && 'attributes' in buildPayload(rich, 'k-abcdefghijklmnop'), 'the payload carries attributes only when there are some');
const legacyHash = contentHash(plain);
ok(legacyHash === contentHash({ ...plain, attributes: {} }) && legacyHash !== contentHash(rich), 'the fingerprint of an area without site details is unchanged; adding or changing details changes it');
ok(contentHash(rich) !== contentHash({ ...rich, attributes: { environment: 'park', access: 'public' } }), 'changing one attribute is a change since submission');

// ---- submission gate
const calls = [];
const be = { available: () => true, signedIn: () => true, signIn() {}, rpc: async (fn, a) => { calls.push(fn); return { data: { area_id: id(1), revision_id: id(2), revision_no: 1, status: 'pending', submitted_at: '2026-11-01T00:00:00Z' } }; }, onChange: () => () => {} };
const store = createAreaStore({ storage: mem() });
const aPlain = store.add(base()).area, aRich = store.add(base({ name: 'Rich', attributes: { environment: 'park', access: 'permission' } })).area;
const ctl = createSubmitController({ store, backend: be });
let out = await ctl.submit(aPlain.id);
ok(!out.ok && out.code === 'attributes-required' && calls.length === 0 && !store.get(aPlain.id).submission, 'an area without environment and access is not sent, and nothing is recorded');
store.update(aPlain.id, base({ attributes: { environment: 'unknown', access: 'unknown' } }));
out = await ctl.submit(aPlain.id);
ok(out.ok && calls.length === 1 && store.get(aPlain.id).submission.status === 'pending', 'once both are chosen (Unknown is a choice) it is sent');
out = await ctl.submit(aRich.id);
ok(out.ok && calls.length === 2, 'an area with details is sent');
ok(/site environment/i.test(describeError({ message: 'invalid_area: attributes-required' }).message) && /site details/i.test(describeError({ message: 'invalid_area: attributes' }).message), 'server refusals have plain messages');

// ---- editor
const ed = createEditor({ kind: 'polygon', area: aRich });
ok(ed.attributes.environment === 'park' && !ed.dirty, 'the editor starts from the saved attributes, not dirty');
ed.setAttributes({ environment: 'park', access: 'public' });
ok(ed.dirty && ed.toDraft().attributes.access === 'public', 'changing attributes makes the session dirty and shows in the draft');
ed.markSaved(); ed.setAttributes({}); ok(ed.dirty && JSON.stringify(ed.toDraft().attributes) === '{}', 'clearing them is a change too');
const ed2 = createEditor({ kind: 'rectangle' }); ok(JSON.stringify(ed2.attributes) === '{}', 'a new session has none');

// ---- local storage and GeoJSON
const st2 = createAreaStore({ storage: mem() }); const a2 = st2.add(base({ name: 'G', attributes: FULL })).area;
const gj = st2.toGeoJSON([a2.id]), prop = gj.features[0].properties;
ok(prop.attributes.environment === 'beach' && !('attributes' in createAreaStore({ storage: mem() }).toGeoJSON([]).features), 'export carries attributes only when present');
const st3 = createAreaStore({ storage: mem() }); const imp = st3.importGeoJSON(JSON.stringify(gj));
ok(imp.added === 1 && st3.list()[0].attributes.access === 'public' && st3.list()[0].attributes.hazards.join() === 'people,water', 'import restores attributes');
const badGj = JSON.parse(JSON.stringify(gj)); badGj.features[0].properties.attributes = { environment: 'moon' };
const imp2 = createAreaStore({ storage: mem() }).importGeoJSON(JSON.stringify(badGj));
ok(imp2.added === 0 && imp2.skipped.length === 1 && /site details|choices/i.test(imp2.skipped[0].reason), 'import refuses invalid attributes with a reason');
const old = JSON.stringify({ v: 1, areas: [{ id: 'a1', name: 'Old', description: '', drawKind: 'polygon', geometry: base().geometry, spots: [], created: '2026-11-01T00:00:00.000Z', updated: '2026-11-01T00:00:00.000Z' }] });
const sOld = mem(); sOld.setItem('uavzones.v1.areas', old);
const stOld = createAreaStore({ storage: sOld });
ok(stOld.count() === 1 && JSON.stringify(stOld.list()[0].attributes) === '{}', 'records saved before this change load with no attributes');

// ---- public view
const pubRec = (o = {}) => ({ area_id: id(5), revision_id: id(6), status: 'approved', published: true, name: 'Pub', description: '', geometry: base().geometry, spots: [], area_m2: 1000, approved_at: '2026-11-20T00:00:00Z', attribution: null, attributes: FULL, ...o });
const pv = publicView(pubRec());
ok(pv.area.attributes.access === 'public' && pv.dates.observed === '2026-11-01', 'the public view carries the attributes and the observation date (never the approval date)');
ok(publicView(pubRec({ attributes: {} })).dates.observed === null && JSON.stringify(publicView(pubRec({ attributes: undefined })).area.attributes) === '{}', 'no attributes: not provided, no date invented');
const damaged = publicView(pubRec({ attributes: { environment: 'moon' } }));
ok(damaged && JSON.stringify(damaged.area.attributes) === '{}', 'damaged attributes are shown as not provided, the area is still shown');
ok(publicView(pubRec({ attributes: { ...FULL, observed_on: '2999-01-01' } })).dates.observed === null, 'an impossible observation date is not shown');

// ---- administrator item and comparison
const item = cleanItem({ revision_id: id(7), area_id: id(8), revision_no: 2, status: 'pending', name: 'P', description: '', draw_kind: 'polygon', geometry: base().geometry, spots: [], area_m2: 1000, submitted_at: '2026-11-02T00:00:00Z', attributes: { environment: 'park', access: 'permission', hazards: ['roads'] },
  published: { revision_no: 1, name: 'P', description: '', draw_kind: 'polygon', geometry: base().geometry, spots: [], area_m2: 1000, attributes: { environment: 'park', access: 'public' } } });
const ch = describeChanges(item);
ok(ch.some((c) => /Access \/ permission: Public access.* → Permission required/.test(c)) && ch.some((c) => /Known hazards: not provided → Roads/.test(c)) && !ch.some((c) => /Site environment/.test(c)), `changes in attributes are listed (${ch.join(' | ')})`);
const none = cleanItem({ ...{ revision_id: id(7), area_id: id(8), revision_no: 2, status: 'pending', name: 'P', description: '', draw_kind: 'polygon', geometry: base().geometry, spots: [], area_m2: 1000, submitted_at: '2026-11-02T00:00:00Z' }, published: { revision_no: 1, name: 'P', description: '', draw_kind: 'polygon', geometry: base().geometry, spots: [], area_m2: 1000 } });
ok(describeChanges(none)[0] === 'No visible difference', 'a legacy published version without attributes and an identical proposal: no difference');
ok(attributeLines(FULL).length === 6 && attributeLines({}).every(([, val]) => val === null) && attributeLines(FULL)[0][1] === 'Beach / coast', 'review lines: one per field, null when not provided');
ok(JSON.stringify(cleanPublished({ name: 'P', geometry: base().geometry, spots: [], attributes: { environment: 'moon' } }).attributes) === '{}', 'a damaged published version is read as not provided');

// ---- explorer rows
const ex = exploreItem({ area_id: id(9), name: 'E', area_m2: 5, spot_count: 0, approved_at: '2026-11-01T00:00:00Z', center: { lat: 1, lng: 2 }, distance_km: null, attributes: { environment: 'park', access: 'restricted' } });
ok(ex.attributes.access === 'restricted' && JSON.stringify(exploreItem({ area_id: id(9), name: 'E', area_m2: 5, spot_count: 0, center: { lat: 1, lng: 2 }, attributes: { access: 'free' } }).attributes) === '{}', 'explorer rows keep valid attributes and read damaged ones as not provided');

// ---- recovery keeps attributes
const rev = { area_id: id(1), revision_id: id(2), revision_no: 1, status: 'approved', name: 'Rec', description: '', draw_kind: 'polygon', geometry: base().geometry, spots: [], area_m2: 1000, submitted_at: '2026-11-01T00:00:00Z', attributes: FULL, published: true };
const fake = { available: () => true, signedIn: () => true, rpc: async (fn) => (fn === 'list_my_community_areas' ? { data: [{ area_id: rev.area_id, revision_id: rev.revision_id, revision_no: 1, name: 'Rec', status: 'approved', submitted_at: rev.submitted_at, reviewed_at: null, review_reason: null, published: true }] } : { data: rev }) };
const s5 = createAreaStore({ storage: mem() }); const rr = await createRecovery({ store: s5, backend: fake }).recover(id(1));
ok(rr.ok && s5.list()[0].attributes.environment === 'beach' && s5.list()[0].submission.contentHash === contentHash(s5.list()[0]), 'a recovered area keeps its attributes and its fingerprint matches (not reported as changed)');
ok(submissionFor(rev, 'abcdef01').status === 'approved', 'submission link unchanged');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
