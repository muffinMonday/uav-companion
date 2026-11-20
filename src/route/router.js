// The browser side of routing: "get the route for this leg", cache first. No provider key and no provider address live here; road routes come from the
// route-leg edge function (or from the database cache of a shared trip, through get_trip_routes, for joined members).
//
// resolve(leg) answers at once from what is known: a road route (memory, this device's cache, or the shared cache) or the straight-line fallback with the reason.
// ensure(legs) asks for the roads that are missing, with bounded concurrency, in-flight de-duplication and back-off; it is driven by what is on show, never by
// panning, zooming or turning the map (the renderer calls resolve for that). A persistent refusal (no route, not eligible) is not asked again on every draw.
import { routeKey } from './identity.js';
import { ineligibleReason, fallbackFor, roadFrom } from './result.js';
import { decodePolyline } from './polyline.js';

export const STORE_KEY = 'uavzones.routes.v1'; // device cache of road routes: { v: 1, items: [{ key, geometry, distanceM, durationS, t }] }; no names, no trip ids
export const MAX_LOCAL = 150;
const MIN = 60_000;
// how long a refusal is remembered (ms) by the code the function answers with; the others back off 1 min, 2, 4 ... up to 30 min
const MEMO = { no_route: 6 * 60 * MIN, not_eligible: 24 * 60 * MIN, not_found: 10 * MIN, bad_request: 24 * 60 * MIN };
const PAUSE = { budget: 2 * MIN, provider_limit: 2 * MIN, provider_config: 10 * MIN }; // these stop every request for a while, not just one leg

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** A road route from a stored/serialized row ({ key, geometry, distance_m | distanceM, duration_s | durationS }), or null when it is not well-formed. */
export function roadFromRow(row, leg, source) {
  if (!row || typeof row.key !== 'string' || row.key !== routeKey(leg)) return null; // a stored route is used only for exactly this leg as it is now
  const coords = decodePolyline(row.geometry);
  const d = row.distance_m ?? row.distanceM, t = row.duration_s ?? row.durationS;
  if (coords.length < 2 || !finite(d) || d <= 0 || !finite(t) || t < 0) return null;
  return roadFrom(leg, { coords, distanceM: d, durationS: t }, source);
}

export function createRouter({ storage = globalThis.localStorage, now = () => Date.now(), onChange = () => {}, maxConcurrent = 2, isShared = () => false, log = () => {} } = {}) {
  let backend = null;                 // { signedIn(), invoke(body) -> data, fetchShared(tripId) -> rows }
  const roads = new Map();            // key -> stored road row (geometry string, numbers), from any source
  const sources = new Map();          // key -> 'cache' | 'provider'
  const memo = new Map();             // key -> { until, reason, n }
  const inflight = new Map();         // key -> Promise
  const sharedLoads = new Map();      // trip id -> Promise (rows ingested)
  const queue = [];
  let running = 0, pausedUntil = 0, pauseReason = null;

  // ---- the device cache
  function loadLocal() {
    try {
      const doc = JSON.parse(storage?.getItem(STORE_KEY) || 'null');
      if (doc?.v !== 1 || !Array.isArray(doc.items)) return;
      for (const r of doc.items.slice(0, MAX_LOCAL)) {
        if (typeof r?.key !== 'string' || r.key.length > 300 || typeof r.geometry !== 'string' || !finite(r.distanceM) || !finite(r.durationS) || !finite(r.t)) continue;
        if (decodePolyline(r.geometry).length < 2) continue;
        roads.set(r.key, { key: r.key, geometry: r.geometry, distanceM: r.distanceM, durationS: r.durationS, t: r.t });
      }
    } catch { /* an unreadable cache is an empty cache */ }
  }
  function saveLocal() {
    try {
      const items = [...roads.values()].sort((a, b) => b.t - a.t).slice(0, MAX_LOCAL);
      for (const k of [...roads.keys()]) if (!items.some((i) => i.key === k)) roads.delete(k);
      storage?.setItem(STORE_KEY, JSON.stringify({ v: 1, items }));
    } catch { /* storage full or blocked: the route still shows this session */ }
  }
  loadLocal();

  const store = (row, source) => { roads.set(row.key, { key: row.key, geometry: row.geometry, distanceM: row.distance_m ?? row.distanceM, durationS: row.duration_s ?? row.durationS, t: now() }); sources.set(row.key, source); };

  /** The answer for a leg as far as it is known now: { result, pending }. */
  function resolve(leg) {
    const key = routeKey(leg);
    const row = roads.get(key);
    if (row) { const road = roadFromRow(row, leg, sources.get(key) ?? 'cache'); if (road) return { result: road, pending: false }; roads.delete(key); }
    const why = ineligibleReason(leg);
    if (why) return { result: fallbackFor(leg, why), pending: false };
    const m = memo.get(key);
    if (m && m.until > now()) return { result: fallbackFor(leg, m.reason), pending: false };
    if (!backend) return { result: fallbackFor(leg, 'offline'), pending: false };
    if (!backend.signedIn()) return { result: fallbackFor(leg, 'signin'), pending: false };
    if (pausedUntil > now()) return { result: fallbackFor(leg, pauseReason ?? 'busy'), pending: false };
    return { result: fallbackFor(leg, inflight.has(key) || queue.some((q) => q.key === key) ? 'pending' : 'waiting'), pending: true };
  }

  function fail(key, code) {
    const n = (memo.get(key)?.n ?? 0) + 1;
    const until = now() + (MEMO[code] ?? Math.min(30 * MIN, MIN * 2 ** (n - 1)));
    memo.set(key, { until, reason: code, n });
    if (PAUSE[code]) { pausedUntil = now() + PAUSE[code]; pauseReason = code; }
  }

  async function sharedRows(tripId) {
    if (!sharedLoads.has(tripId)) {
      sharedLoads.set(tripId, (async () => {
        try { const rows = await backend.fetchShared(tripId); for (const r of Array.isArray(rows) ? rows : []) if (typeof r?.key === 'string' && typeof r.geometry === 'string') store(r, 'cache'); }
        catch { sharedLoads.delete(tripId); } // not a member, or offline: ask the function (it decides); try the cache again later
      })());
    }
    await sharedLoads.get(tripId);
  }

  async function fetchLeg(leg) {
    const key = routeKey(leg);
    const shared = leg.tripId && isShared(leg.tripId) ? leg.tripId : null;
    if (shared) { await sharedRows(shared); if (roads.has(key) && roadFromRow(roads.get(key), leg, 'cache')) return; }
    try {
      const data = await backend.invoke({ trip: shared, from: leg.from, to: leg.to });
      const row = data?.route;
      if (!row || row.key !== key || !roadFromRow(row, leg, 'provider')) { fail(key, 'provider_bad_answer'); return; }
      store(row, data.source === 'cache' ? 'cache' : 'provider');
      memo.delete(key);
      saveLocal();
    } catch (e) {
      const code = typeof e?.code === 'string' ? e.code : e?.status === 401 ? 'not_signed_in' : e?.status === 404 ? 'not_found' : 'network';
      fail(key, code);
      log('route', code);
    }
  }

  function pump() {
    while (running < maxConcurrent && queue.length && pausedUntil <= now()) {
      const q = queue.shift();
      running++;
      const p = fetchLeg(q.leg).finally(() => { running--; inflight.delete(q.key); onChange(); pump(); });
      inflight.set(q.key, p);
    }
  }

  /** Asks for the roads of these legs that are not known and not refused recently. Returns nothing; onChange() fires as answers arrive. */
  function ensure(legs) {
    if (!backend?.signedIn()) return;
    let any = false;
    for (const leg of legs) {
      const r = resolve(leg);
      const key = routeKey(leg);
      if (!r.pending || inflight.has(key) || queue.some((q) => q.key === key)) continue;
      queue.push({ key, leg: { tripId: leg.tripId, from: { id: leg.from.id, lat: leg.from.lat, lon: leg.from.lon }, to: { id: leg.to.id, lat: leg.to.lat, lon: leg.to.lon } } });
      any = true;
    }
    if (any) pump();
  }

  /** The road for a leg if one is already known (memory, device cache, shared cache), else null. Never asks for anything. */
  function peek(leg) {
    const row = roads.get(routeKey(leg));
    return row ? roadFromRow(row, leg, sources.get(row.key) ?? 'cache') : null;
  }

  return {
    resolve, ensure, peek,
    setBackend(b) { backend = b; onChange(); },
    /** Forgets everything remembered about refusals (not the roads): after signing in, say. */
    resetFailures() { memo.clear(); pausedUntil = 0; pauseReason = null; sharedLoads.clear(); },
    clearLocal() { roads.clear(); sources.clear(); try { storage?.removeItem(STORE_KEY); } catch { /* ignore */ } },
    stats: () => ({ roads: roads.size, queued: queue.length, running, pausedUntil }),
  };
}

/** The backend over a Supabase client: the edge function for a route, get_trip_routes for a shared trip's cache. Errors carry { code, status } only. */
export function createBackend(client, signedIn) {
  return {
    signedIn,
    async invoke(body) {
      const { data, error } = await client.functions.invoke('route-leg', { body });
      if (error) {
        let code = null;
        try { code = (await error.context?.json?.())?.code ?? null; } catch { /* no body */ }
        throw Object.assign(new Error('route'), { code, status: error.context?.status });
      }
      return data;
    },
    async fetchShared(tripId) {
      const { data, error } = await client.rpc('get_trip_routes', { p_trip: tripId });
      if (error) throw new Error('route cache');
      return data;
    },
  };
}
