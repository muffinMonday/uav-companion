// Community flying areas, Explorer client: filter building, row validation, error mapping and the API wrapper (no browser).
import { buildFilter, cleanItem, describeExploreError, createExploreApi, PAGE, MAX_OFFSET } from '../src/areas/explorer-api.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const ID = '3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e01';
const row = (o = {}) => ({ area_id: ID, name: 'Park', area_m2: 1000, spot_count: 2, approved_at: '2026-11-27T00:00:00Z', center: { lat: 1.3, lng: 103.8 }, distance_km: 1.2, ...o });

ok(JSON.stringify(buildFilter()) === '{}' && JSON.stringify(buildFilter({ query: '  ', center: null })) === '{}', 'no input: an empty filter');
ok(buildFilter({ query: ' marina ' }).query === 'marina' && buildFilter({ query: 'x'.repeat(100) }).query.length === 60, 'the query is trimmed and cut to 60');
const f = buildFilter({ center: { lat: 1.30456, lng: 103.80789 }, radiusKm: 25 });
ok(f.center.lat === 1.3 && f.center.lng === 103.81 && f.radius_km === 25, 'the centre is rounded to 0.01 degree before it is sent');
ok(!('radius_km' in buildFilter({ radiusKm: 25 })) && !('radius_km' in buildFilter({ center: { lat: 1, lng: 2 }, radiusKm: 7 })), 'a radius needs a centre and must be one of the offered values');
ok(!('center' in buildFilter({ center: { lat: 91, lng: 0 } })) && !('center' in buildFilter({ center: { lat: NaN, lng: 0 } })), 'an unusable centre is left out');

ok(cleanItem(row())?.areaId === ID && cleanItem(row()).distanceKm === 1.2 && cleanItem(row({ distance_km: null })).distanceKm === null, 'a valid row is accepted; null distance stays null');
for (const [m, r] of [['bad id', row({ area_id: 'x' })], ['blank name', row({ name: ' ' })], ['zero size', row({ area_m2: 0 })], ['11 spots', row({ spot_count: 11 })], ['bad centre', row({ center: { lat: 100, lng: 0 } })], ['negative distance', row({ distance_km: -1 })], ['null', null]]) ok(cleanItem(r) === null, `${m} is rejected`);
ok(cleanItem(row({ name: '<img src=x onerror=1>' })).name === '<img src=x onerror=1>', 'text is kept as text (rendered with textContent only)');
ok(cleanItem(row({ approved_at: 'nope' })).approvedAt === null && cleanItem(row({ owner_id: 'u1', xp: 5 })).owner_id === undefined, 'a bad date is dropped; unknown fields are not copied');

ok(describeExploreError({ message: 'invalid_radius' }).code === 'bad-request' && describeExploreError(new Error('fetch failed')).code === 'network' && describeExploreError({ name: 'AbortError' }).code === 'aborted', 'errors map to bad-request, network, aborted');

const mk = (res) => createExploreApi({ available: () => true, rpc: async (fn, args, o) => { mk.last = { fn, args, o }; return typeof res === 'function' ? res() : res; } });
let r = await mk({ data: { areas: [row(), row(), row({ area_id: 'bad' }), row({ area_id: '3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e02' })], has_more: true } }).list({ query: 'a' }, 20);
ok(r.items.length === 2 && r.hasMore === true && mk.last.fn === 'explore_public_areas' && mk.last.args.p_offset === 20 && mk.last.args.p_limit === PAGE, 'rows are validated and de-duplicated; the call carries filter, limit and offset');
const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
ok((await thrown(() => mk({ data: { areas: 'x', has_more: false } }).list({}))).code === 'bad-response' && (await thrown(() => mk({ data: null }).list({}))).code === 'bad-response', 'a malformed response is an error, not an empty list');
ok((await thrown(() => mk({ error: { message: 'boom' } }).list({}))).code === 'network' && (await thrown(() => mk({ error: { message: 'invalid_offset' } }).list({}))).code === 'bad-request', 'RPC errors surface as typed failures');
ok((await thrown(() => mk({ data: { areas: [], has_more: false } }).list({}, MAX_OFFSET + 1))).code === 'bad-request', 'an offset beyond the server bound is refused locally');
ok((await mk({ data: { areas: [], has_more: false } }).list({}, MAX_OFFSET)).items.length === 0, 'the largest offset is allowed');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
