// The client router: cache first, de-duplication, bounded concurrency, back-off, shared cache, stale identity. Fake backend, fake storage, fake clock.
import { createRouter, createBackend, STORE_KEY, MAX_LOCAL } from '../src/route/router.js';
import { routeKey } from '../src/route/identity.js';
import { encodePolyline } from '../src/route/polyline.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const leg = (a, b, o = {}) => ({ id: `${a}>${b}`, tripId: o.trip ?? 't1', from: { id: a, lat: o.la ?? 30.6, lon: 114.3 }, to: { id: b, lat: o.lb ?? 30.7, lon: 114.4 } });
const rowFor = (l, dist = 15500) => ({ key: routeKey(l), from: l.from.id, to: l.to.id, geometry: encodePolyline([[l.from.lat, l.from.lon], [(l.from.lat + l.to.lat) / 2, 114.36], [l.to.lat, l.to.lon]]), points: 3, distance_m: dist, duration_s: 1300 });
const tick = () => new Promise((r) => setTimeout(r, 5));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

function setup(over = {}) {
  let t = 1_000_000; const clock = { now: () => t, adv: (ms) => { t += ms; } };
  const storage = over.storage ?? mem();
  const calls = { invoke: [], shared: [], peak: 0, live: 0, changes: 0 };
  let behaviour = over.behaviour ?? ((l) => ({ source: 'provider', route: rowFor(l) }));
  const backend = {
    signedIn: () => over.signedIn !== false,
    invoke: async (body) => {
      calls.invoke.push(body); calls.live++; calls.peak = Math.max(calls.peak, calls.live);
      await tick();
      calls.live--;
      const l = { from: body.from, to: body.to, tripId: body.trip };
      const r = behaviour(l, body);
      if (r instanceof Error) throw r;
      return r;
    },
    fetchShared: async (id) => { calls.shared.push(id); if (over.sharedError) throw new Error('no'); return over.sharedRows ?? []; },
  };
  const router = createRouter({ storage, now: clock.now, onChange: () => { calls.changes++; }, isShared: over.isShared ?? (() => false), maxConcurrent: 2 });
  router.setBackend(backend);
  calls.changes = 0;
  return { router, calls, clock, storage, set: (b) => { behaviour = b; } };
}
const err = (code, status) => Object.assign(new Error('x'), { code, status });

// ---------- cache first
let s = setup();
const L1 = leg('a', 'b');
let r = s.router.resolve(L1);
ok(r.pending && r.result.state === 'fallback' && r.result.reason === 'waiting', 'an unknown eligible leg is a straight-line fallback while the road is wanted');
s.router.ensure([L1]); s.router.ensure([L1]); s.router.ensure([L1]);
ok(s.router.resolve(L1).result.reason === 'pending', 'while asking, the fallback says pending');
await settle();
ok(s.calls.invoke.length === 1, 'three ensure() calls for one leg make one request (in-flight de-duplication)');
ok(JSON.stringify(Object.keys(s.calls.invoke[0]).sort()) === '["from","to","trip"]' && s.calls.invoke[0].trip === null && Object.keys(s.calls.invoke[0].from).sort().join() === 'id,lat,lon', 'the request holds the trip id (null for a private trip) and the two points: ids and coordinates only');
r = s.router.resolve(L1);
ok(r.result.state === 'road' && r.result.source === 'provider' && r.result.distanceM === 15500 && r.result.durationS === 1300 && r.result.coords.length === 3 && s.calls.changes >= 1, 'then the road is returned and the renderer was told');
const saved = JSON.parse(s.storage.getItem(STORE_KEY));
ok(saved.v === 1 && saved.items.length === 1 && !JSON.stringify(saved).includes('t1') && !JSON.stringify(saved).includes('"a"'), 'the device cache holds the route by its key only: no trip id, no marker name');
const s2 = setup({ storage: s.storage });
r = s2.router.resolve(L1);
ok(r.result.state === 'road' && !r.pending, 'a new session finds the road in the device cache');
s2.router.ensure([L1]); await settle();
ok(s2.calls.invoke.length === 0, 'and makes no request: cache first');

// ---------- stale identity
const moved = leg('a', 'b', { la: 30.6005 });
r = s2.router.resolve(moved);
ok(r.result.state === 'fallback' && r.pending, 'the same markers with a moved end point do not reuse the old road');
ok(s2.router.resolve(L1).result.state === 'road', 'the unmoved leg keeps its road');
s2.router.ensure([moved]); await settle();
ok(s2.calls.invoke.length === 1 && s2.router.resolve(moved).result.state === 'road' && s2.router.resolve(L1).result.state === 'road', 'only the moved leg was requested');
// a wrong key from the function is not accepted
s = setup({ behaviour: (l) => ({ source: 'provider', route: { ...rowFor(l), key: 'driving-car|v1|other' } }) });
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.state === 'fallback' && s.router.resolve(L1).result.reason === 'provider_bad_answer', 'an answer for another leg is refused');
s = setup({ behaviour: (l) => ({ source: 'provider', route: { ...rowFor(l), geometry: '!!' } }) });
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.state === 'fallback', 'an answer with a bad geometry is refused');

// ---------- never asked
s = setup();
const far = { id: 'x>y', tripId: 't', from: { id: 'x', lat: 21.03, lon: 105.85 }, to: { id: 'y', lat: 30.6, lon: 114.3 } };
s.router.ensure([far, { id: 'a>a', tripId: 't', from: { id: 'a', lat: 30.6, lon: 114.3 }, to: { id: 'z', lat: 30.6, lon: 114.3 } }]); await settle();
ok(s.calls.invoke.length === 0 && s.router.resolve(far).result.reason === 'country', 'a leg that is not eligible is never requested');
s = setup({ signedIn: false });
s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 0 && s.router.resolve(L1).result.reason === 'signin' && !s.router.resolve(L1).pending, 'signed out: straight line, no request');
const none = createRouter({ storage: mem() });
ok(none.resolve(L1).result.reason === 'offline' && (none.ensure([L1]), true), 'no backend (no accounts in this build): straight line, no request');

// ---------- bounded concurrency
s = setup();
const many = Array.from({ length: 7 }, (_, i) => leg('p' + i, 'q' + i, { la: 30.6 + i * 0.01, lb: 30.7 + i * 0.01 }));
s.router.ensure(many); await settle(); await settle();
ok(s.calls.invoke.length === 7 && s.calls.peak <= 2, 'seven legs: all requested, never more than two at once (peak ' + s.calls.peak + ')');

// ---------- failures and back-off
s = setup({ behaviour: () => err('no_route', 422) });
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.reason === 'no_route' && !s.router.resolve(L1).pending, 'no route: fallback with that reason');
s.router.ensure([L1]); s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 1, 'a no-route answer is not asked again on every draw');
s.clock.adv(7 * 3600_000); s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 2, 'it is asked again after the memory of the refusal has expired');
s = setup({ behaviour: () => err('provider_unavailable', 502) });
s.router.ensure([L1]); await settle();
s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 1, 'a provider failure backs off: no immediate retry');
s.clock.adv(61_000); s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 2, 'retry after 1 minute');
s.router.ensure([L1]); s.clock.adv(61_000); s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 2, 'the second back-off is 2 minutes, not 1');
s.clock.adv(61_000); s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 3, 'retry after 2 minutes');
s = setup({ behaviour: () => err(null, undefined) });
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.reason === 'network' && s.router.resolve(L1).result.state === 'fallback', 'a network failure with no code: fallback, reason network');
// a rate limit pauses every request, not just one leg
s = setup({ behaviour: () => err('budget', 429) });
const others = Array.from({ length: 5 }, (_, i) => leg('u' + i, 'v' + i, { la: 30.6 + i * 0.01, lb: 30.7 + i * 0.01 }));
s.router.ensure(others.slice(0, 2)); await settle();
const first = s.calls.invoke.length;
s.router.ensure(others.slice(2)); await settle();
ok(first <= 2 && s.calls.invoke.length === first, 'after a budget answer, no other leg is requested during the pause (' + first + ' calls then ' + s.calls.invoke.length + ')');
ok(s.router.resolve(others[3]).result.reason === 'budget', 'and they show the straight line with that reason');
s.set((l) => ({ source: 'provider', route: rowFor(l) }));
s.clock.adv(3 * 60_000); s.router.ensure(others.slice(2)); await settle();
ok(s.calls.invoke.length > first && s.router.resolve(others[3]).result.state === 'road', 'the pause ends after two minutes');
// a valid cached road survives an outage
s = setup();
s.router.ensure([L1]); await settle();
s.set(() => err('provider_unavailable', 502)); s.clock.adv(3600_000);
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.state === 'road' && s.calls.invoke.length === 1, 'with the provider down, a road already known is still drawn and nothing is requested');

// ---------- shared trips
const sharedRow = rowFor(L1, 12345);
s = setup({ isShared: (t) => t === 't1', sharedRows: [sharedRow] });
s.router.ensure([L1, leg('b', 'c', { la: 30.7, lb: 30.8 })]); await settle();
ok(s.calls.shared.length === 1 && s.calls.shared[0] === 't1', 'a shared trip reads its route cache once, not once per leg');
ok(s.router.resolve(L1).result.distanceM === 12345 && s.calls.invoke.length === 1 && s.calls.invoke[0].from.id === 'b' && s.calls.invoke[0].trip === 't1', 'a leg found in the shared cache needs no request; the other leg asks the function with the trip id');
s = setup({ isShared: () => true, sharedError: true });
s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 1 && s.router.resolve(L1).result.state === 'road', 'if the shared cache cannot be read, the function is asked (it decides who may)');
s = setup({ isShared: () => false, sharedRows: [sharedRow] });
s.router.ensure([L1]); await settle();
ok(s.calls.shared.length === 0, 'a private trip never reads a shared cache');
s = setup({ isShared: () => true, sharedRows: [{ key: 'bad' }, { key: routeKey(L1), geometry: 5 }, null, { ...rowFor(L1), distance_m: -3 }] });
s.router.ensure([L1]); await settle();
ok(s.calls.invoke.length === 1, 'malformed shared rows are ignored (and the leg is requested instead)');

// ---------- the device cache
const bad = mem(); bad.setItem(STORE_KEY, '{not json');
ok(setup({ storage: bad }).router.resolve(L1).result.state === 'fallback', 'an unreadable device cache is treated as empty');
const bad2 = mem(); bad2.setItem(STORE_KEY, JSON.stringify({ v: 1, items: [{ key: routeKey(L1), geometry: '!!', distanceM: 1, durationS: 1, t: 1 }, { key: 5 }, null, { key: routeKey(L1), geometry: rowFor(L1).geometry, distanceM: -1, durationS: 1, t: 1 }] }));
ok(setup({ storage: bad2 }).router.resolve(L1).result.state === 'fallback', 'malformed entries in the device cache are ignored');
const full = mem(); full.setItem = () => { throw new Error('quota'); };
s = setup({ storage: full });
s.router.ensure([L1]); await settle();
ok(s.router.resolve(L1).result.state === 'road', 'a device cache that cannot be written does not break the route');
const big = mem();
big.setItem(STORE_KEY, JSON.stringify({ v: 1, items: Array.from({ length: 300 }, (_, i) => { const l = leg('k' + i, 'm' + i); return { key: routeKey(l), geometry: rowFor(l).geometry, distanceM: 1000, durationS: 60, t: i }; }) }));
s = setup({ storage: big });
s.router.ensure([L1]); await settle();
ok(JSON.parse(big.getItem(STORE_KEY)).items.length <= MAX_LOCAL, 'the device cache is bounded to ' + MAX_LOCAL + ' routes');
s.router.clearLocal();
ok(big.getItem(STORE_KEY) === null && s.router.resolve(L1).result.state === 'fallback', 'clearing removes every stored route');

// ---------- the backend over a Supabase client
const fake = (res) => ({ functions: { invoke: async () => res }, rpc: async () => res });
ok((await createBackend(fake({ data: { a: 1 }, error: null }), () => true).invoke({})).a === 1, 'the backend returns the function\'s data');
let thrown = null;
try { await createBackend(fake({ data: null, error: { context: { status: 429, json: async () => ({ code: 'budget', error: 'secret' }) } } }), () => true).invoke({}); } catch (e) { thrown = e; }
ok(thrown?.code === 'budget' && thrown.status === 429 && !/secret/.test(thrown.message), 'a function error becomes { code, status } without its text');
thrown = null;
try { await createBackend(fake({ data: null, error: { message: 'x' } }), () => true).fetchShared('t'); } catch (e) { thrown = e; }
ok(!!thrown && !/x/.test(thrown.message), 'a cache read error is reported without the database text');

// ---------- no provider details in the browser code
const src = ['src/route/router.js', 'src/route/legs.js', 'src/route/identity.js', 'src/route/result.js'].map((f) => fs.readFileSync(f, 'utf8')).join('');
ok(!/heigit\.org|openrouteservice\.org|HEIGIT_API_KEY/i.test(src), 'the browser route modules never name the provider endpoint or key');

// ---------- peek: a saved road only, never a request
s = setup();
ok(s.router.peek(L1) === null && s.calls.invoke.length === 0, 'peek on an unknown leg answers null and asks for nothing');
s.router.ensure([L1]); await settle();
const pk = s.router.peek(L1);
ok(pk && pk.state === 'road' && pk.distanceM === 15500 && s.router.peek(leg('b', 'a')) === null && s.calls.invoke.length === 1, 'peek returns a known road for that direction only, with no further request');
ok(s.router.peek(leg('a', 'b', { la: 30.6005 })) === null, 'peek never returns a road for moved end points');
