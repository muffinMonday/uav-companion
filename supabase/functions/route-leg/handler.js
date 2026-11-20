// The logic of the route-leg edge function, free of Deno and Supabase so Node tests can run it (tests/route-leg-unit.mjs).
// One request = one itinerary leg: { trip?: <shared trip id>, from: { id, lat, lon }, to: { id, lat, lon } }. The function
//   1. needs a signed-in caller (the provider key must never be an open proxy),
//   2. validates the input and the same-country gate WITHOUT calling anything (a leg that is not eligible costs nothing),
//   3. asks the database (route_begin, service role, caller passed explicitly) which checks membership and that both end points are markers of the trip,
//      returns a cached route if there is one, and otherwise counts the call against the per-user, daily and per-minute budgets,
//   4. only then calls HeiGIT (coordinates only: no names, notes, user or trip ids), validates the answer and stores it (route_store) for a shared trip.
// `deps`: getUser(authorization) -> { id } | null; begin(args) / store(args) run the SQL functions and throw their error; ors(leg) -> { status, json } or throws
// (a network error or timeout); env: { userDay, allDay, allMinute }; logOut. The answer never carries the provider's or the database's text: a fixed code.
import { routeKey, ineligibleReason, readOrsGeoJson, PROFILE, ROUTE_SCHEMA, validCoord } from '../_shared/route-rules.js';
import { logEvent, classify, requestId } from '../_shared/log.js';
import { encodePolyline, fitPoints } from '../_shared/route-polyline.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function point(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id.length < 1 || p.id.length > 80) return null;
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !validCoord(p.lat, p.lon)) return null;
  return { id: p.id, lat: p.lat, lon: p.lon }; // only these three fields are kept
}

export async function handle(req, deps) {
  const rid = requestId();
  const log = (level, event, code) => logEvent(level, 'route-leg', event, { code, req: rid }, deps.logOut);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'use POST' });
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return reply(401, { error: 'not signed in' });
  let user = null;
  try { user = await deps.getUser(authorization); } catch { user = null; }
  if (!user?.id) return reply(401, { error: 'not signed in' });

  let body = null;
  try { body = await req.json(); } catch { body = null; }
  const from = point(body?.from), to = point(body?.to);
  const trip = body?.trip ?? null;
  if (!from || !to || (trip !== null && (typeof trip !== 'string' || !UUID.test(trip)))) return reply(400, { error: 'bad request', code: 'bad_request' });
  const leg = { from, to };
  const reason = ineligibleReason(leg);
  if (reason) return reply(422, { error: 'not eligible', code: 'not_eligible', reason });
  const key = routeKey(leg);

  const lim = deps.env ?? {};
  const ids = { user: user.id, trip, key, from, to };
  let begun;
  try { begun = await deps.begin({ ...ids, userDay: lim.userDay ?? 150, allDay: lim.allDay ?? 1500, allMinute: lim.allMinute ?? 30 }); }
  catch (e) {
    const msg = String(e?.message ?? '');
    if (/budget/.test(msg) || e?.code === 'P0429') { log('warn', 'budget_full', 'budget'); return reply(429, { error: 'busy', code: 'budget' }); }
    if (/trip not found|not in this trip|not signed in/.test(msg)) return reply(404, { error: 'not found', code: 'not_found' }); // no detail: nothing to tell a stranger
    log('error', 'begin_failed', classify(e));
    return reply(500, { error: 'try again later', code: 'server' });
  }
  if (begun?.hit && begun.route) return reply(200, { source: 'cache', route: begun.route });

  let res;
  try { res = await deps.ors(leg); }
  catch (e) { log('warn', 'provider_unreachable', classify(e)); return reply(502, { error: 'routing unavailable', code: 'provider_unavailable' }); }
  const status = Number(res?.status);
  if (status === 401 || status === 403) { log('error', 'provider_auth', 'provider_auth'); return reply(502, { error: 'routing unavailable', code: 'provider_config' }); }
  if (status === 429) { log('warn', 'provider_limit', 'provider_429'); return reply(429, { error: 'busy', code: 'provider_limit' }); }
  if (status >= 500) { log('warn', 'provider_down', 'provider_5xx'); return reply(502, { error: 'routing unavailable', code: 'provider_unavailable' }); }
  if (status === 404 || status === 400 || status === 422) return reply(422, { error: 'no route', code: 'no_route' });
  if (status !== 200) { log('warn', 'provider_other', 'provider_other'); return reply(502, { error: 'routing unavailable', code: 'provider_unavailable' }); }
  let parsed;
  try { parsed = readOrsGeoJson(res.json, leg); }
  catch (e) { log('warn', 'provider_bad_answer', String(e?.message) === 'malformed' ? 'bad_shape' : 'bad_values'); return reply(502, { error: 'routing unavailable', code: 'provider_bad_answer' }); }
  const pts = fitPoints(parsed.coords, 1500);
  const route = { key, from: from.id, to: to.id, geometry: encodePolyline(pts), points: pts.length, distance_m: Math.round(parsed.distanceM), duration_s: Math.round(parsed.durationS) };
  if (trip) {
    try { await deps.store({ ...ids, profile: PROFILE, schema: ROUTE_SCHEMA, route }); }
    catch (e) { log('warn', 'store_failed', classify(e)); /* the caller still gets the route; the next request will try again */ }
  }
  return reply(200, { source: 'provider', route });
}
