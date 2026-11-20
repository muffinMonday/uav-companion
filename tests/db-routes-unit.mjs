// The route cache of shared trips, tested on a real Postgres (PGlite) as different users: membership, no direct access, the service-role-only writers,
// budget, duplicates, invalidation by trip saves, cascade. No browser, no network.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const TRIP = '5a1c0000-0000-4000-8000-0000000000a1';
const J = (o) => JSON.stringify(o);
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
async function svc(sql, params = []) { await db.exec('set role service_role'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } }
const svcErr = async (sql, params = []) => { try { await svc(sql, params); return null; } catch (e) { return String(e.message || e); } };
const mk = (id, lat, lon, extra = {}) => ({ id, type: 'photo', name: id, note: '', lat, lon, created: '2026-11-01T00:00:00.000Z', tripId: TRIP, ...extra });
const docOf = (items) => ({ v: 1, trip: { id: TRIP, name: 'Hubei spring' }, items });
const items = [mk('m1', 30.6, 114.3), mk('m2', 30.7, 114.4), mk('m3', 30.8, 114.5)];
await one(A, 'public.share_trip($1::jsonb)', [J(docOf(items))]);
// B joined, C invited only, D (and the visitor) not in the trip
await db.exec(`insert into public.trip_members (trip_id, user_id, role, status, joined_at) values ('${TRIP}', '${B}', 'editor', 'joined', now()), ('${TRIP}', '${C}', 'editor', 'invited', null)`);

const KEY = (a, b) => `driving-car|v1|${a.id}:${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.id}:${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
const begin = (user, trip, a, b, lim = [150, 1500, 30]) => svc('select public.route_begin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [user, trip, KEY(a, b), a.id, a.lat, a.lon, b.id, b.lat, b.lon, ...lim]).then((r) => r[0].r);
const beginErr = async (...args) => { try { await begin(...args); return null; } catch (e) { return String(e.message || e); } };
const store = (user, trip, a, b, o = {}) => svc('select public.route_store($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as r',
  [user, trip, o.key ?? KEY(a, b), a.id, a.lat, a.lon, b.id, b.lat, b.lon, 'driving-car', 1, o.geometry ?? '_p~iF~ps|U_ulLnnqC', o.points ?? 2, o.distance ?? 15500, o.duration ?? 1300]).then((r) => r[0].r);
const storeErr = async (...args) => { try { await store(...args); return null; } catch (e) { return String(e.message || e); } };
const [m1, m2, m3] = items;
const count = async () => Number((await db.query('select count(*)::int n from public.trip_routes')).rows[0].n);
const budget = async () => Number((await db.query('select coalesce(sum(n),0)::int n from public.route_budget')).rows[0].n);

// ---------- no direct access, the writers are not for the API roles
for (const t of ['trip_routes', 'route_budget']) {
  ok(/permission denied/.test(await refused(db, A, `select * from public.${t}`)) && /permission denied/.test(await refused(db, A, `delete from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), `${t}: no direct read or delete for a signed-in user or a visitor`);
}
ok(/permission denied/.test(await refused(db, A, `insert into public.trip_routes (trip_id, leg_key, from_marker, to_marker, from_lat, from_lon, to_lat, to_lon, profile, schema_version, geometry, points, distance_m, duration_s) values ('${TRIP}', 'driving-car|v1|forged-key-xx', 'm1','m2',1,1,1,1,'driving-car',1,'_p~iF~ps|U',2,1,1)`)), 'an owner cannot insert a route row directly (nobody can forge a cache entry)');
const KEYARGS = `'${TRIP}'`;
for (const [fn, args] of [
  ['route_begin', `'${A}', ${KEYARGS}, 'k', 'm1', 1, 1, 'm2', 1, 1`],
  ['route_store', `'${A}', ${KEYARGS}, 'k', 'm1', 1, 1, 'm2', 1, 1, 'driving-car', 1, 'abcd', 2, 1, 1`],
  ['route_is_member', `'${A}', ${KEYARGS}`],
  ['route_marker_ok', `${KEYARGS}, 'm1', 30.6, 114.3`],
  ['route_take', `'x', 5, now()`],
]) {
  ok(/permission denied/.test(await refused(db, A, `select public.${fn}(${args})`)) && /permission denied/.test(await refused(db, null, `select public.${fn}(${args})`)), `${fn} cannot be called through the API, not even by the trip owner`);
}
ok(/permission denied/.test(await refused(db, null, `select public.get_trip_routes('${TRIP}')`)), 'a visitor who is not signed in cannot read routes');

// ---------- a miss, a provider answer, a hit
ok((await begin(A, TRIP, m1, m2)).hit === false, 'the owner asking for an uncached leg gets a miss (the function then calls the provider)');
ok(await budget() === 3, 'a miss counts one call in each of the three budget buckets');
ok((await store(A, TRIP, m1, m2)).status === 'stored' && await count() === 1, 'the route is stored');
const hit = await begin(B, TRIP, m1, m2);
ok(hit.hit === true && hit.route.distance_m === 15500 && hit.route.duration_s === 1300 && hit.route.geometry && hit.route.key === KEY(m1, m2), 'a joined editor gets the cached route');
ok(await budget() === 3, 'a hit costs no provider budget');
const list = await one(B, 'public.get_trip_routes($1)', [TRIP]);
ok(Array.isArray(list) && list.length === 1 && list[0].key === KEY(m1, m2) && list[0].from === 'm1' && !('trip_id' in list[0]), 'a joined member lists the trip routes (no trip or user ids in the answer)');
ok((await one(A, 'public.get_trip_routes($1)', [TRIP])).length === 1, 'so does the owner');

// ---------- negative authorization: refused BEFORE the budget or the provider
const b0 = await budget();
ok(/trip not found/.test(await refused(db, C, 'select public.get_trip_routes($1)', [TRIP])), 'an invited person who has not joined gets no routes');
ok(/trip not found/.test(await refused(db, D, 'select public.get_trip_routes($1)', [TRIP])), 'a stranger gets no routes');
ok(/trip not found/.test(await beginErr(C, TRIP, m2, m3)) && /trip not found/.test(await beginErr(D, TRIP, m2, m3)), 'route_begin refuses an invited-only person and a stranger');
ok(/trip not found/.test(await storeErr(D, TRIP, m2, m3)) && /trip not found/.test(await storeErr(C, TRIP, m2, m3)), 'route_store refuses them too: a route cannot be forged for a trip the caller is not in');
ok(/trip not found/.test(await beginErr(A, '5a1c0000-0000-4000-8000-0000000000ff', m2, m3)), 'a trip that does not exist: refused');
ok(/not signed in/.test(await beginErr(null, TRIP, m2, m3)), 'no caller: refused');
ok(await budget() === b0 && await count() === 1, 'none of those refusals used budget or stored anything');
ok(/not in this trip/.test(await beginErr(A, TRIP, m2, { id: 'm3', lat: 31.0, lon: 114.5 })), 'an end point with coordinates that are not the marker\'s: refused before the provider');
ok(/not in this trip/.test(await beginErr(A, TRIP, m2, { id: 'zz', lat: 30.8, lon: 114.5 })), 'an end point that is not a marker of the trip: refused');
ok(/not in this trip/.test(await storeErr(A, TRIP, m2, { id: 'zz', lat: 30.8, lon: 114.5 })), 'and cannot be stored either');
ok(await budget() === b0, 'still no budget used');
// a Home marker can never be an end point, even if one got into the document some other way
await db.exec(`update public.shared_trips set doc = jsonb_set(doc, '{items}', doc->'items' || '[{"id":"home","type":"residence","name":"Home","lat":30.9,"lon":114.6,"created":"x","tripId":"${TRIP}"}]'::jsonb) where id = '${TRIP}'`);
ok(/not in this trip/.test(await beginErr(A, TRIP, m2, { id: 'home', lat: 30.9, lon: 114.6 })) && /not in this trip/.test(await storeErr(A, TRIP, m2, { id: 'home', lat: 30.9, lon: 114.6 })), 'a private Home marker cannot enter the route cache or be sent to the provider');
await db.exec(`update public.shared_trips set doc = jsonb_set(doc, '{items}', (select jsonb_agg(e) from jsonb_array_elements(doc->'items') e where e->>'id' <> 'home')) where id = '${TRIP}'`);

// ---------- invalid routes are refused by the table's own checks
for (const [what, o] of [['an empty geometry', { geometry: '' }], ['a geometry with characters outside the polyline alphabet', { geometry: 'abc def' }], ['a distance over the 6,000 km limit', { distance: 7e6 }], ['a zero distance', { distance: 0 }], ['a negative duration', { duration: -1 }], ['one point', { points: 1 }], ['a geometry over 60,000 characters', { geometry: '_'.repeat(60001) }], ['a key that is too short', { key: 'short' }]]) {
  ok(/violates check constraint|check/.test(await storeErr(A, TRIP, m2, m3, o) ?? ''), `${what}: refused`);
}
ok(await count() === 1, 'no invalid route was stored');

// ---------- duplicates, replacement, cap
await store(A, TRIP, m2, m3);
await Promise.all([store(A, TRIP, m2, m3, { distance: 16000 }), store(B, TRIP, m2, m3, { distance: 17000 }), store(A, TRIP, m2, m3, { distance: 18000 })]);
ok(await count() === 2 && (await db.query(`select count(*)::int n from public.trip_routes where from_marker = 'm2'`)).rows[0].n === 1, 'concurrent stores of the same leg leave one row');
// moving m1: the old route is removed when the trip is saved; the m2 to m3 route stays
let moved = items.map((i) => (i.id === 'm1' ? { ...i, lat: 30.61 } : i));
await db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${TRIP}'`);
ok((await one(A, 'public.save_shared_trip($1, $2::jsonb, 1)', [TRIP, J(docOf(moved))])).status === 'ok', 'the owner saves the trip with marker m1 moved');
const keys = (await db.query('select leg_key from public.trip_routes order by leg_key')).rows.map((r) => r.leg_key);
ok(keys.length === 1 && keys[0] === KEY(m2, m3), 'only the route that started at the moved marker is removed; the unrelated leg stays');
const m1b = { ...m1, lat: 30.61 };
await store(A, TRIP, m1b, m2);
ok(/not in this trip/.test(await storeErr(A, TRIP, m1, m2)), 'a route for the old coordinates cannot be stored once the marker moved (stale identity never enters the cache)');
await store(A, TRIP, m1b, m2, { key: KEY(m1b, m2) });
const afterReplace = (await db.query(`select leg_key from public.trip_routes where from_marker = 'm1'`)).rows;
ok(afterReplace.length === 1 && afterReplace[0].leg_key === KEY(m1b, m2), 'storing a route under a new key for the same two markers replaces the old key');
// deleting a marker removes its routes
let rev = 2;
const without = moved.filter((i) => i.id !== 'm3');
await db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${TRIP}'`);
await one(A, 'public.save_shared_trip($1, $2::jsonb, $3)', [TRIP, J(docOf(without)), rev]);
ok((await db.query(`select leg_key from public.trip_routes`)).rows.map((r) => r.leg_key).join() === KEY(m1b, m2), 'deleting marker m3 removes the route into it and keeps the other');
// a save that changes only a note keeps every route
await db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${TRIP}'`);
await one(A, 'public.save_shared_trip($1, $2::jsonb, $3)', [TRIP, J(docOf(without.map((i) => (i.id === 'm2' ? { ...i, note: 'x', name: 'renamed' } : i)))), rev + 1]);
ok(await count() === 1, 'renaming a marker or editing a note does not touch the routes');
// cap of 600 per trip
await db.exec(`insert into public.trip_routes (trip_id, leg_key, from_marker, to_marker, from_lat, from_lon, to_lat, to_lon, profile, schema_version, geometry, points, distance_m, duration_s, updated_at)
  select '${TRIP}', 'driving-car|v1|bulk' || g, 'bulk' || g, 'bulk' || g || 'b', 1, 1, 1, 1, 'driving-car', 1, '_p~iF~ps|U', 2, 1, 1, now() - (g || ' seconds')::interval from generate_series(1, 650) g`);
await db.exec(`update public.shared_trips set doc = jsonb_set(doc, '{items}', doc->'items') where id = '${TRIP}'`); // (prune would drop them: they are not markers; restore the rows after)
await db.exec(`insert into public.trip_routes (trip_id, leg_key, from_marker, to_marker, from_lat, from_lon, to_lat, to_lon, profile, schema_version, geometry, points, distance_m, duration_s, updated_at)
  select '${TRIP}', 'driving-car|v1|bulk' || g, 'bulk' || g, 'bulk' || g || 'b', 1, 1, 1, 1, 'driving-car', 1, '_p~iF~ps|U', 2, 1, 1, now() - (g || ' seconds')::interval from generate_series(1, 650) g on conflict do nothing`);
await store(A, TRIP, m1b, m2, { distance: 15501 });
ok(await count() === 600, 'a trip keeps at most 600 cached routes (the oldest go): ' + await count());

// ---------- budget
await db.exec('delete from public.route_budget');
ok(!(await beginErr(A, null, m1, m2, [2, 100, 100])) && !(await beginErr(A, null, m1, m2, [2, 100, 100])), 'a private trip (no trip id) is allowed within the budget; nothing is cached on the server for it');
ok(/budget/.test(await beginErr(A, null, m1, m2, [2, 100, 100])), 'the third call of a user with a daily limit of 2 is refused');
ok(!(await beginErr(B, null, m1, m2, [2, 100, 100])), 'another user has their own daily budget');
await db.exec('delete from public.route_budget');
const results = await Promise.all(Array.from({ length: 8 }, () => beginErr(A, null, m1, m2, [100, 100, 3])));
ok(results.filter((x) => x === null).length === 3 && results.filter((x) => /budget/.test(x ?? '')).length === 5, 'eight simultaneous calls against a limit of 3 per minute: exactly 3 get through');
const refusedBudget = await budget();
await beginErr(A, null, m1, m2, [100, 100, 3]);
ok(await budget() === refusedBudget, 'a refused call leaves the counters unchanged (all or nothing)');
await db.exec('delete from public.route_budget');
await beginErr(A, null, m1, m2, [100, 2, 100]); await beginErr(B, null, m1, m2, [100, 2, 100]);
ok(/budget/.test(await beginErr(D, null, m1, m2, [100, 2, 100])), 'the all-users daily limit stops the third call whoever makes it');
await db.exec(`update public.route_budget set expires_at = now() - interval '1 minute'`);
ok(!(await beginErr(A, null, m1, m2, [100, 100, 100])) && (await db.query('select count(*)::int n from public.route_budget')).rows[0].n === 3, 'expired counters are cleaned up when the next call is counted');

// ---------- membership changes and deletion
await store(A, TRIP, m1b, m2);
ok((await one(B, 'public.get_trip_routes($1)', [TRIP])).length > 0, 'the member sees routes before leaving');
await one(B, 'public.leave_trip($1)', [TRIP]);
ok(/trip not found/.test(await refused(db, B, 'select public.get_trip_routes($1)', [TRIP])) && /trip not found/.test(await beginErr(B, TRIP, m1b, m2)), 'a member who leaves loses access at once, to the cache and to requests');
const mem = (await db.query(`select id from public.trip_members where user_id = '${C}' and trip_id = '${TRIP}'`)).rows[0].id;
await one(C, 'public.respond_trip_invite($1, true)', [TRIP]);
ok((await one(C, 'public.get_trip_routes($1)', [TRIP])).length > 0, 'an invited person who accepts then gets the cached routes');
await one(A, 'public.remove_member($1, $2)', [TRIP, mem]);
ok(/trip not found/.test(await refused(db, C, 'select public.get_trip_routes($1)', [TRIP])), 'a member the owner removes loses access at once');
await one(A, 'public.delete_shared_trip($1)', [TRIP]);
ok(await count() === 0, 'deleting the shared trip deletes its cached routes');
