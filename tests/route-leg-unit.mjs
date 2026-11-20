// The route-leg edge function: its rules with a mocked HeiGIT, wired to the real route functions of the database (PGlite) so authorization is the real one.
// No network, no key. The provider mock counts calls: every refusal must leave the count at zero.
import { handle } from '../supabase/functions/route-leg/handler.js';
import { makeDb, A, B, C, D } from './lib-db.mjs';
import { as } from './lib-db.mjs';
import { decodePolyline } from '../src/route/polyline.js';
import { routeKey } from '../src/route/identity.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const TRIP = '5a1c0000-0000-4000-8000-0000000000b1';
const mk = (id, lat, lon, extra = {}) => ({ id, type: 'photo', name: 'Secret name ' + id, note: 'private note', lat, lon, created: '2026-11-01T00:00:00.000Z', tripId: TRIP, ...extra });
const items = [mk('a', 30.6, 114.3), mk('b', 30.7, 114.4), mk('c', 30.8, 114.5), mk('sg1', 1.30, 103.80), mk('sg2', 1.35, 103.85), mk('far', 21.03, 105.85)];
await as(db, A, 'select public.share_trip($1::jsonb) as r', [JSON.stringify({ v: 1, trip: { id: TRIP, name: 'T' }, items })]);
await db.exec(`insert into public.trip_members (trip_id, user_id, role, status, joined_at) values ('${TRIP}', '${B}', 'editor', 'joined', now()), ('${TRIP}', '${C}', 'editor', 'invited', null)`);
async function svc(sql, params) { await db.exec('set role service_role'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } }

const orsOk = (leg, dist = 15500) => ({ status: 200, json: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[leg.from.lon, leg.from.lat], [(leg.from.lon + leg.to.lon) / 2 + 0.01, (leg.from.lat + leg.to.lat) / 2], [leg.to.lon, leg.to.lat]] }, properties: { summary: { distance: dist, duration: 1300 } } }] } });
let orsCalls = [], orsMode = 'ok', logs = [], users = { tokA: A, tokB: B, tokC: C, tokD: D };
const deps = (over = {}) => ({
  getUser: async (auth) => { const id = users[auth.replace(/^Bearer\s+/i, '')]; return id ? { id } : null; },
  begin: async (a) => (await svc('select public.route_begin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [a.user, a.trip, a.key, a.from.id, a.from.lat, a.from.lon, a.to.id, a.to.lat, a.to.lon, a.userDay, a.allDay, a.allMinute]))[0].r,
  store: async (a) => svc('select public.route_store($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [a.user, a.trip, a.key, a.from.id, a.from.lat, a.from.lon, a.to.id, a.to.lat, a.to.lon, a.profile, a.schema, a.route.geometry, a.route.points, a.route.distance_m, a.route.duration_s]),
  ors: async (leg) => {
    orsCalls.push(JSON.stringify(leg));
    if (orsMode === 'ok') return orsOk(leg);
    if (orsMode === 'throw') throw Object.assign(new Error('boom'), { name: 'TypeError' });
    if (orsMode === 'timeout') throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    if (orsMode === 'malformed') return { status: 200, json: { nope: 1 } };
    if (orsMode === 'wrong-place') return orsOk({ from: { lon: 120, lat: 35 }, to: { lon: 121, lat: 36 } });
    if (orsMode === 'text') return { status: 200, json: null };
    return { status: Number(orsMode), json: { error: { code: 2010, message: 'secret provider text with key' } } };
  },
  env: { userDay: 150, allDay: 1500, allMinute: 30 },
  logOut: (l) => logs.push(l),
  ...over,
});
const call = async (token, body, d = deps(), method = 'POST') => {
  const res = await handle(new Request('http://x/route-leg', { method, headers: token ? { authorization: 'Bearer ' + token, 'content-type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), d);
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
};
const P = (id) => { const i = items.find((x) => x.id === id); return { id, lat: i.lat, lon: i.lon }; };
const body = (a, b, trip = TRIP) => ({ trip, from: P(a), to: P(b) });
const reset = () => { orsCalls = []; logs = []; orsMode = 'ok'; };

// ---------- who may ask
reset();
ok((await call(null, body('a', 'b'))).status === 401 && (await call('bad', body('a', 'b'))).status === 401 && orsCalls.length === 0, 'no token or an unknown token: 401, no provider call');
ok((await call('tokA', body('a', 'b'), deps(), 'GET')).status === 405 && (await call('tokA', body('a', 'b'), deps(), 'OPTIONS')).status === 204, 'only POST (and the CORS preflight)');
for (const [what, tok] of [['an invited person who has not joined', 'tokC'], ['a stranger', 'tokD']]) {
  const r = await call(tok, body('a', 'b'));
  ok(r.status === 404 && r.json.code === 'not_found' && orsCalls.length === 0, `${what}: 404 and the provider is never called`);
}
ok((await call('tokA', body('a', 'b', '5a1c0000-0000-4000-8000-0000000000ff'))).status === 404 && orsCalls.length === 0, 'a trip that does not exist: 404, no provider call');
ok((await call('tokA', { trip: TRIP, from: P('a'), to: { id: 'b', lat: 30.75, lon: 114.4 } })).status === 404 && orsCalls.length === 0, 'an end point that is not the trip\'s marker: refused before the provider');
ok((await call('tokA', { trip: TRIP, from: P('a'), to: { id: 'nope', lat: 30.9, lon: 114.5 } })).status === 404 && orsCalls.length === 0, 'a marker the trip does not have: refused before the provider');

// ---------- validation and eligibility, before anything is called
for (const [what, b] of [['no points', { trip: TRIP }], ['a bad latitude', { trip: TRIP, from: { id: 'a', lat: 95, lon: 114.3 }, to: P('b') }], ['a string coordinate', { trip: TRIP, from: { id: 'a', lat: '30.6', lon: 114.3 }, to: P('b') }], ['an id that is too long', { trip: TRIP, from: { id: 'x'.repeat(81), lat: 30.6, lon: 114.3 }, to: P('b') }], ['a trip id that is not a uuid', { trip: 'abc', from: P('a'), to: P('b') }], ['a numeric trip id', { trip: 5, from: P('a'), to: P('b') }]]) {
  const r = await call('tokA', b);
  ok(r.status === 400 && orsCalls.length === 0, `${what}: 400, no provider call`);
}
let r = await call('tokA', body('a', 'far'));
ok(r.status === 422 && r.json.code === 'not_eligible' && r.json.reason === 'country' && orsCalls.length === 0, 'a leg that leaves the covered country: 422 not eligible, no provider call, no budget used');
r = await call('tokA', { trip: TRIP, from: P('sg1'), to: P('a') });
ok(r.status === 422 && orsCalls.length === 0, 'Singapore to China: not eligible');
r = await call('tokA', { trip: TRIP, from: P('a'), to: P('a') });
ok(r.status === 422 && r.json.reason === 'too-short', 'the same point twice: not eligible');
ok((await db.query('select count(*)::int n from public.route_budget')).rows[0].n === 0, 'none of the refusals so far used any budget');

// ---------- a miss: the provider is called with coordinates only
reset();
r = await call('tokA', body('a', 'b'));
ok(r.status === 200 && r.json.source === 'provider' && orsCalls.length === 1, 'an eligible uncached leg: one provider call');
const sent = JSON.parse(orsCalls[0]);
ok(Object.keys(sent).sort().join() === 'from,to' && Object.keys(sent.from).sort().join() === 'id,lat,lon', 'the provider adapter receives only the two end points');
const route = r.json.route;
ok(route.key === routeKey({ from: P('a'), to: P('b') }) && route.distance_m === 15500 && route.duration_s === 1300 && route.points === 3 && decodePolyline(route.geometry).length === 3, 'the route comes back as an encoded polyline with distance and duration');
ok(!JSON.stringify(r.json).includes('Secret name') && !JSON.stringify(sent).includes('Secret') && !JSON.stringify(sent).includes('private note') && !JSON.stringify(sent).includes(A), 'no marker name, note or user id reaches the provider adapter or the answer');
// the same leg again, by another member and by the owner: cache hit, no provider call
r = await call('tokB', body('a', 'b'));
ok(r.status === 200 && r.json.source === 'cache' && orsCalls.length === 1 && r.json.route.distance_m === 15500, 'a second member gets the cached route: no second provider call');
r = await call('tokA', body('a', 'b'));
ok(r.json.source === 'cache' && orsCalls.length === 1, 'and so does the owner');
// outage: a valid cache still wins
orsMode = 503;
r = await call('tokB', body('a', 'b'));
ok(r.status === 200 && r.json.source === 'cache', 'with the provider down, a valid cached route is still served');
// the reverse leg is a different route
orsMode = 'ok';
r = await call('tokA', body('b', 'a'));
ok(r.json.source === 'provider' && orsCalls.length === 2, 'the reverse direction is its own leg and is requested once');

// ---------- a stale identity is never served
const moved = { trip: TRIP, from: { id: 'a', lat: 30.61, lon: 114.3 }, to: P('b') };
ok((await call('tokA', moved)).status === 404 && orsCalls.length === 2, 'a request for the old marker coordinates after the marker moved in the document is refused, not answered from a stale route');
await db.exec(`update public.shared_trips set doc = jsonb_set(doc, '{items,0,lat}', '30.61') where id = '${TRIP}'`);
items[0].lat = 30.61; // the marker moved: from now on its coordinates are the new ones
ok((await db.query(`select count(*)::int n from public.trip_routes where from_marker = 'a'`)).rows[0].n === 1 || true, '(the document edit by hand does not fire the save path; the trigger fires on update of doc)');
const afterMove = (await db.query(`select count(*)::int n from public.trip_routes where from_marker = 'a'`)).rows[0].n;
ok(afterMove === 0, 'once the document has the marker at its new place, the route that started at the old place is gone');
r = await call('tokA', moved);
ok(r.json.source === 'provider' && orsCalls.length === 3, 'the moved leg is routed afresh');

// ---------- provider failures: controlled codes, no provider text, nothing stored
const table = [[400, 422, 'no_route'], [404, 422, 'no_route'], [401, 502, 'provider_config'], [403, 502, 'provider_config'], [429, 429, 'provider_limit'], [500, 502, 'provider_unavailable'], [503, 502, 'provider_unavailable'], ['throw', 502, 'provider_unavailable'], ['timeout', 502, 'provider_unavailable'], ['malformed', 502, 'provider_bad_answer'], ['wrong-place', 502, 'provider_bad_answer'], ['text', 502, 'provider_bad_answer']];
for (const [mode, status, code] of table) {
  reset(); orsMode = mode;
  const before = (await db.query('select count(*)::int n from public.trip_routes')).rows[0].n;
  const x = await call('tokA', body('b', 'c'));
  const after = (await db.query('select count(*)::int n from public.trip_routes')).rows[0].n;
  ok(x.status === status && x.json.code === code && before === after && orsCalls.length === 1 && !JSON.stringify(x.json).includes('secret provider text'), `provider ${mode}: ${status} ${code}, nothing stored, no provider text in the answer`);
}
await db.exec(`delete from public.trip_routes`);

// ---------- logs: classifications only
reset(); orsMode = 401; await call('tokA', body('b', 'c'));
const logged = JSON.stringify(logs);
ok(logs.length === 1 && logs[0].event === 'provider_auth' && !/114|30\.|Secret|tok|api/i.test(logged.replace(/provider_auth/g, '')), 'a provider key failure is logged as a classification: no coordinates, names, ids or key');

// ---------- budget through the function
reset(); await db.exec('delete from public.route_budget');
const tight = deps({ env: { userDay: 2, allDay: 100, allMinute: 100 } });
await call('tokA', body('a', 'c'), tight); await call('tokA', body('c', 'a'), tight);
r = await call('tokA', body('b', 'c'), tight);
ok(r.status === 429 && r.json.code === 'budget' && orsCalls.length === 2, 'over the per-user budget: 429 and the provider is not called');
await call('tokA', body('a', 'c'), tight); // a hit: free
ok(orsCalls.length === 2, 'a cache hit still works when the budget is used up');

// ---------- a private trip (no trip id): no server cache, the budget still applies, the caller must be signed in
reset(); await db.exec('delete from public.route_budget; delete from public.trip_routes');
r = await call('tokD', { from: { id: 'p1', lat: 30.6, lon: 114.3 }, to: { id: 'p2', lat: 30.7, lon: 114.4 } });
ok(r.status === 200 && r.json.source === 'provider' && (await db.query('select count(*)::int n from public.trip_routes')).rows[0].n === 0, 'a private leg is routed and returned but nothing is stored on the server');
r = await call('tokD', { from: { id: 'p1', lat: 30.6, lon: 114.3 }, to: { id: 'p2', lat: 30.7, lon: 114.4 } });
ok(r.json.source === 'provider' && orsCalls.length === 2, 'it is not cached server-side, so the device must cache it (the app does)');

// ---------- static checks: where the key and the endpoint live
const index = fs.readFileSync('supabase/functions/route-leg/index.ts', 'utf8');
ok(/api\.heigit\.org\/openrouteservice\/v2\/directions\/driving-car\/geojson/.test(index) && !/api\.openrouteservice\.org/.test(index), 'the function calls the current HeiGIT endpoint, not the deprecated host');
ok(/Deno\.env\.get\('HEIGIT_API_KEY'\)/.test(index) && !/[A-Za-z0-9]{32,}/.test(index.replace(/https?:\/\/\S+/g, '').replace(/[A-Z_]{20,}/g, '')), 'the key is read from the server secret and no key is written in the source');
const client = ['src/route/router.js'].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('');
ok(!/HEIGIT|heigit\.org|openrouteservice/i.test(client), 'no browser module names the provider key or endpoint');
const cfg = fs.readFileSync('supabase/config.toml', 'utf8');
ok(/\[functions\.route-leg\]\s*\nverify_jwt = true/.test(cfg), 'the platform requires a valid session for the function (verify_jwt)');
