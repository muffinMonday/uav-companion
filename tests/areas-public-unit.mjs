// Community flying areas, Phase 4: the public API client and the viewport loader (src/areas/public-api.js). Pure logic with a fake API: no browser, no network.
import { viewportQuery, queryKey, createPublicApi, createPublicLoader, describePublicError, MAX_PAGES, PAGE_SIZE, TTL_MS, MAX_CACHE } from '../src/areas/public-api.js';
import { publicView, cleanAttribution } from '../src/areas/adapter-public.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

// ---- viewportQuery
const V = { west: 103.7, south: 1.25, east: 103.9, north: 1.4 };
const q = viewportQuery(V);
ok(q && q.west < V.west && q.east > V.east && q.south < V.south && q.north > V.north, 'the query box is the viewport plus a buffer');
ok(viewportQuery({ ...V, west: 103.701 }) && queryKey(viewportQuery({ ...V, west: 103.701 })) === queryKey(q), 'a tiny pan rounds to the same key');
ok(viewportQuery({ west: 70, south: 10, east: 140, north: 50 }) === null, 'a country-wide view is not queried');
ok(viewportQuery({ west: 100, south: 0, east: 108.5, north: 5 }) === null && viewportQuery({ west: 100, south: 0, east: 106.6, north: 5 }) !== null, 'the span limit includes the buffer (10 degrees)');
for (const b of [null, {}, { west: NaN, south: 0, east: 1, north: 1 }, { west: 0, south: 5, east: 1, north: 1 }, { west: 5, south: 0, east: 1, north: 1 }, { west: '1', south: 0, east: 2, north: 1 }]) ok(viewportQuery(b) === null, `unusable box refused: ${JSON.stringify(b)}`);
const wrapped = viewportQuery({ west: 179.5, south: 9, east: 180.7, north: 10 });
ok(wrapped && wrapped.west > 0 && wrapped.east < 0 && wrapped.west > wrapped.east, 'a map wrapped past 180 gives west > east (antimeridian)');
const wrappedNeg = viewportQuery({ west: -180.6, south: 9, east: -179.4, north: 10 });
ok(wrappedNeg && wrappedNeg.west > 0 && wrappedNeg.east < 0, 'a map wrapped past -180 is normalised the same way');
ok(viewportQuery({ west: 10, south: 89, east: 11, north: 91 }).north === 90 && viewportQuery({ west: 10, south: -91, east: 11, north: -89 }).south === -90, 'latitudes are clamped');
ok([q.west, q.south, q.east, q.north].every((x) => Math.abs(x * 20 - Math.round(x * 20)) < 1e-6), 'the box sits on the 0.05 degree grid');

// ---- fixtures
const sq = (x, y, d = 0.001) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rec = (n, over = {}) => ({ area_id: id(n), revision_id: id(1000 + n), status: 'approved', published: true, name: 'Area ' + n, description: 'd', geometry: { type: 'Polygon', coordinates: [sq(103.8 + n * 0.002, 1.3)] }, spots: [], area_m2: 12000, approved_at: '2026-11-27T00:00:00Z', attribution: null, ...over });
const records = Array.from({ length: 260 }, (_, i) => rec(i + 1));
const flush = () => new Promise((r) => setTimeout(r, 0));

function fake({ pageSize = PAGE_SIZE, data = records, delay = 0 } = {}) {
  const f = { calls: [], fail: null, hold: null };
  f.api = {
    available: () => true,
    async list(qq, cursor, limit, signal) {
      f.calls.push({ q: qq, cursor, limit, aborted: () => signal?.aborted === true });
      if (f.hold) await f.hold;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (signal?.aborted) throw { code: 'aborted', message: 'cancelled' };
      if (f.fail) throw f.fail;
      const from = cursor ? data.findIndex((r) => r.area_id === cursor) + 1 : 0;
      const rows = data.slice(from, from + limit);
      return { areas: rows, next: from + limit < data.length ? rows[rows.length - 1].area_id : null };
    },
  };
  return f;
}
const Q1 = viewportQuery(V), Q2 = viewportQuery({ west: 104.5, south: 1.25, east: 104.7, north: 1.4 });

// ---- paging, validation and de-duplication
{
  const f = fake(); const L = createPublicLoader({ api: f.api });
  const r = await L.load(Q1);
  ok(f.calls.length === MAX_PAGES && r.views.length === MAX_PAGES * PAGE_SIZE && r.truncated === true, `paging is bounded: ${MAX_PAGES} pages of ${PAGE_SIZE}, then "truncated"`);
  ok(f.calls[0].limit === PAGE_SIZE && f.calls[0].cursor === null && f.calls[1].cursor === records[PAGE_SIZE - 1].area_id, 'each page continues from the last id');
  const f2 = fake({ data: records.slice(0, 70) }); const r2 = await createPublicLoader({ api: f2.api }).load(Q1);
  ok(r2.views.length === 70 && r2.truncated === false && f2.calls.length === 2, 'a viewport that fits is complete and not truncated');
}
{
  const dup = [rec(1), rec(1), rec(2)]; const r = await createPublicLoader({ api: fake({ data: dup }).api }).load(Q1);
  ok(r.views.length === 2, 'duplicate area ids are merged');
  const bad = [rec(1), rec(2, { status: 'pending' }), rec(3, { published: false }), rec(4, { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } }), rec(5, { area_id: 'nope' }), rec(6, { name: '' }), rec(7)];
  const r2 = await createPublicLoader({ api: fake({ data: bad }).api }).load(Q1);
  ok(r2.views.map((v) => v.areaId).join() === [id(1), id(7)].join(), 'every record is re-validated: pending, unpublished, invalid shape, bad id and bad name are dropped');
}

// ---- cache
{
  let t = 1000; const f = fake({ data: records.slice(0, 5) }); const L = createPublicLoader({ api: f.api, now: () => t });
  await L.load(Q1); const n = f.calls.length;
  const again = await L.load(Q1);
  ok(f.calls.length === n && again.cached === true, 'the same viewport within the TTL is served from memory');
  t += TTL_MS - 1; await L.load(Q1); ok(f.calls.length === n, 'still cached just before the TTL');
  t += 2; const after = await L.load(Q1);
  ok(f.calls.length === n + 1 && after.cached === false, 'expired after 60 s: fetched again');
  ok((await L.load(Q2)).views.length === 5 && f.calls.length === n + 2, 'another viewport is another cache entry');
  const forced = await L.load(Q2, { force: true }); ok(forced.cached === false && f.calls.length === n + 3, 'force bypasses the cache');
  L.forget(id(1));
  ok((await L.load(Q1)).views.every((v) => v.areaId !== id(1)), 'forget() removes an area from every cached viewport');
  L.clear(); ok(L.size() === 0, 'clear() empties the cache');
  const cap = createPublicLoader({ api: fake({ data: records.slice(0, 1) }).api, now: () => t });
  for (let i = 0; i < MAX_CACHE + 10; i++) await cap.load(viewportQuery({ west: 100 + i * 0.5, south: 1, east: 100.2 + i * 0.5, north: 1.2 }));
  ok(cap.size() <= MAX_CACHE, `the cache never holds more than ${MAX_CACHE} viewports`);
}

// ---- in-flight de-duplication, cancellation, stale responses
{
  const f = fake({ data: records.slice(0, 3) }); let release; f.hold = new Promise((r) => { release = r; });
  const L = createPublicLoader({ api: f.api });
  const a = L.load(Q1), b = L.load(Q1); await flush(); release();
  const [ra, rb] = await Promise.all([a, b]);
  ok(f.calls.length === 1 && ra === null && rb.views.length === 3, 'two identical requests in flight make one call; only the newest applies');
}
{
  const f = fake({ data: records.slice(0, 3) }); let release; f.hold = new Promise((r) => { release = r; });
  const L = createPublicLoader({ api: f.api });
  const a = L.load(Q1); await flush();
  const b = L.load(Q2); await flush();
  ok(f.calls[0].aborted() === true, 'a request for another viewport cancels the obsolete one');
  release();
  const [ra, rb] = await Promise.all([a, b]);
  ok(ra === null && rb && rb.views.length === 3, 'the obsolete response is ignored, the newest is applied');
}
{
  // a slow older response must not overwrite a newer one even when the abort is not honoured
  const data = [rec(1)]; const slow = { calls: 0 };
  const api = { available: () => true, async list(qq) { slow.calls++; const mine = slow.calls; await new Promise((r) => setTimeout(r, mine === 1 ? 30 : 1)); return { areas: mine === 1 ? [rec(1)] : [rec(2)], next: null }; } };
  const L = createPublicLoader({ api });
  const a = L.load(Q1); const b = L.load(Q2);
  const [ra, rb] = await Promise.all([a, b]);
  ok(ra === null && rb.views[0].areaId === id(2), 'out-of-order responses: the older one never wins');
}
{
  const f = fake({ data: records.slice(0, 3) }); const L = createPublicLoader({ api: f.api });
  const ok1 = await L.load(Q1); f.fail = { code: 'network', message: 'x' };
  let err = null; try { await L.load(Q2); } catch (e) { err = e; }
  ok(err?.code === 'network', 'a failure rejects (it is never turned into an empty result)');
  f.fail = null; ok((await L.load(Q1)).views.length === ok1.views.length, 'the cache of other viewports survives a failure');
  f.fail = { code: 'network', message: 'x' }; try { await L.load(Q2); } catch { /* expected */ }
  ok(L.size() === 1, 'a failed viewport is not cached');
}
{
  const f = fake({ data: records.slice(0, 3) }); let release; f.hold = new Promise((r) => { release = r; });
  const L = createPublicLoader({ api: f.api }); const a = L.load(Q1); await flush(); L.clear(); release();
  ok((await a) === null, 'clear() while a request is in flight discards its result (an unpublished area cannot return through it)');
}

// ---- api wrapper
{
  const calls = [];
  const backend = { available: () => true, rpc: async (fn, args, o) => { calls.push({ fn, args, o }); return fn === 'get_public_area' ? { data: rec(1) } : { data: { areas: [rec(1)], next_cursor: null } }; } };
  const api = createPublicApi(backend);
  const l = await api.list(Q1, null, 50, undefined);
  ok(l.areas.length === 1 && l.next === null && calls[0].fn === 'list_public_areas' && calls[0].args.p_limit === 50 && calls[0].args.p_cursor === null, 'list calls list_public_areas with bounds, cursor and limit only');
  ok(Object.keys(calls[0].args).sort().join() === 'p_bounds,p_cursor,p_limit', 'no identity or session value is sent');
  ok((await api.get(id(1))).area_id === id(1) && calls[1].args.p_area_id === id(1), 'get calls get_public_area');
  ok((await api.get('not-a-uuid')) === null && calls.length === 2, 'get refuses a malformed id without a request');
  const bad = createPublicApi({ rpc: async () => ({ data: { areas: 'x' } }) });
  ok(await bad.list(Q1).then(() => false, (e) => e.code === 'bad-response'), 'a malformed list response is rejected');
  const bad2 = createPublicApi({ rpc: async () => ({ data: { areas: [], next_cursor: 'zzz' } }) });
  ok(await bad2.list(Q1).then(() => false, (e) => e.code === 'bad-response'), 'a malformed cursor is rejected');
  const nul = createPublicApi({ rpc: async () => ({ data: null }) });
  ok((await nul.get(id(2))) === null, 'an unpublished area (null) is reported as null');
  ok(describePublicError({ message: 'bounds_too_large' }).code === 'too-wide' && describePublicError(new TypeError('fetch failed')).code === 'network' && describePublicError({ name: 'AbortError' }).code === 'aborted', 'errors map to codes');
}

// ---- the adapter contract the server must meet
{
  const v = publicView(rec(1, { attribution: { display_name: 'Bea', avatar: 'nope', bio: 'secret', user_id: 'x', xp: 5 } }));
  ok(v.byline.profileRow && Object.keys(v.byline.profileRow).sort().join() === 'avatar,display_name' && v.byline.profileRow.avatar === null, 'attribution is reduced to display name and a known avatar key');
  ok(publicView(rec(1)).byline.text === 'Community contributor' && publicView(rec(1)).actions.length === 0, 'anonymous fallback and no private actions');
  ok(cleanAttribution({ display_name: '  ' }) === null && cleanAttribution(null) === null, 'an empty name gives no attribution');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
