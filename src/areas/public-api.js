// Community flying areas, Phase 4: the client side of the PUBLIC read functions (supabase/migrations/20261127140000_community_area_public.sql) and the viewport loader.
// Online only. Nothing is requested at startup, for a country-wide view, or while the layer is switched off. Everything returned is validated again by adapter-public.js
// (publicView) before it can be drawn, so a bad or hostile response cannot reach the screen. No person is identified by this module; it sends bounds, a cursor and a limit.
//   - viewportQuery(): the visible box, widened by a buffer and rounded outwards to a grid, so small pans reuse the same cache key. null when the box is too wide to ask for.
//   - createPublicLoader(): one in-memory cache (60 s, at most 24 viewports, never stored on disk), de-duplication of identical in-flight requests, cancellation and
//     discarding of obsolete responses, bounded paging (4 pages of 50), and a failure that keeps the last good result instead of reporting "no areas".
import { publicView } from './adapter-public.js';

export const TTL_MS = 60000;
export const MAX_CACHE = 24;
export const PAGE_SIZE = 50;
export const MAX_PAGES = 4;      // 200 areas per viewport at most; beyond that the person is asked to zoom in
export const MAX_SPAN = 10;      // degrees; the server refuses more than 12
export const BUFFER = 0.25;      // each side, as a share of the visible span
export const GRID = 0.05;        // degrees; the query box is rounded outwards to this grid
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const isAreaId = (v) => typeof v === 'string' && UUID.test(v);

/**
 * { west, south, east, north } for the server, from the visible box (degrees, longitudes may run past +-180 when the map is wrapped), or null when the box is not usable or wider
 * than MAX_SPAN once buffered. west > east means the box crosses the antimeridian.
 */
export function viewportQuery(b) {
  if (!b || ![b.west, b.south, b.east, b.north].every(num) || b.north < b.south || b.east < b.west) return null;
  const spanX = b.east - b.west, spanY = b.north - b.south;
  if (spanX * (1 + 2 * BUFFER) > MAX_SPAN || spanY * (1 + 2 * BUFFER) > MAX_SPAN) return null;
  let w = Math.floor((b.west - spanX * BUFFER) / GRID) * GRID, e = Math.ceil((b.east + spanX * BUFFER) / GRID) * GRID;
  const s = Math.max(-90, Math.floor((b.south - spanY * BUFFER) / GRID) * GRID), n = Math.min(90, Math.ceil((b.north + spanY * BUFFER) / GRID) * GRID);
  const wrap = (x) => { const y = ((((x + 180) % 360) + 360) % 360) - 180; return y; };
  if (w < -180 || w > 180) w = wrap(w);
  if (e > 180 || e < -180) e = wrap(e);
  return { west: r4(w), south: r4(s), east: r4(e), north: r4(n) };
}
export const queryKey = (q) => `${q.west.toFixed(2)},${q.south.toFixed(2)},${q.east.toFixed(2)},${q.north.toFixed(2)}`;

const CODES = { invalid_bounds: 'bad-request', bounds_too_large: 'too-wide', invalid_cursor: 'bad-request', invalid_limit: 'bad-request' };
/** A failure of a public call: { code, message }. A refused request is not a network failure, and neither is evidence that no areas exist. */
export function describePublicError(e) {
  const raw = String(e?.message ?? e ?? '');
  if (e?.name === 'AbortError' || /AbortError|aborted/i.test(raw)) return { code: 'aborted', message: 'cancelled' };
  const m = /(invalid_bounds|bounds_too_large|invalid_cursor|invalid_limit)/.exec(raw);
  if (m) return { code: CODES[m[1]], message: 'The server refused this request.' };
  return { code: 'network', message: 'Community flying areas could not be loaded.' };
}

/** list_public_areas / get_public_area with validated results; failures throw { code, message }. `backend` is createCloudBackend's (rpc, available). */
export function createPublicApi(backend) {
  async function call(fn, args, signal) {
    let res;
    try { res = await backend.rpc(fn, args, { signal }); } catch (e) { throw describePublicError(e); }
    if (res?.error) throw describePublicError(res.error);
    return res?.data;
  }
  return {
    available: () => !!backend?.available?.(),
    async list(q, cursor = null, limit = PAGE_SIZE, signal) {
      const d = await call('list_public_areas', { p_bounds: q, p_cursor: cursor, p_limit: limit }, signal);
      if (!d || typeof d !== 'object' || !Array.isArray(d.areas)) throw { code: 'bad-response', message: 'The server answered in an unexpected way.' };
      const next = d.next_cursor === null || d.next_cursor === undefined ? null : isAreaId(d.next_cursor) ? d.next_cursor : undefined;
      if (next === undefined) throw { code: 'bad-response', message: 'The server answered in an unexpected way.' };
      return { areas: d.areas.slice(0, 100), next };
    },
    /** One area as it is published right now, or null when it is not (unpublished, never approved, unknown). */
    async get(areaId, signal) {
      if (!isAreaId(areaId)) return null;
      const d = await call('get_public_area', { p_area_id: areaId }, signal);
      return d && typeof d === 'object' ? d : null;
    },
  };
}

/**
 * @param {object} o
 * @param {ReturnType<typeof createPublicApi>} o.api
 * @param {() => number} [o.now]
 * @returns {{ load, forget, clear, size }}
 * `load(query, { force })` resolves { views, truncated, cached } for the newest request, or null when a newer request has replaced it (or it failed: then it
 * rejects with { code, message } unless it was only cancelled). `views` are publicView() results, de-duplicated by area id.
 */
export function createPublicLoader({ api, now = Date.now, ttl = TTL_MS, maxCache = MAX_CACHE, maxPages = MAX_PAGES, pageSize = PAGE_SIZE }) {
  const cache = new Map();    // key -> { t, views, truncated }
  const inflight = new Map(); // key -> { promise, ctrl }
  let seq = 0, activeKey = null;

  const prune = () => {
    const t = now();
    for (const [k, v] of cache) if (t - v.t >= ttl) cache.delete(k);
    while (cache.size > maxCache) cache.delete(cache.keys().next().value);
  };

  async function fetchAll(q, signal) {
    const byId = new Map();
    let cursor = null, pages = 0, truncated = false;
    for (;;) {
      const page = await api.list(q, cursor, pageSize, signal);
      pages++;
      for (const rec of page.areas) {
        const v = publicView(rec);
        if (v && !byId.has(rec.area_id)) byId.set(rec.area_id, { ...v, areaId: rec.area_id, record: rec });
      }
      if (!page.next) break;
      if (pages >= maxPages) { truncated = true; break; }
      cursor = page.next;
    }
    return { views: [...byId.values()], truncated };
  }

  async function load(q, { force = false } = {}) {
    const key = queryKey(q), mine = ++seq;
    prune();
    const hit = !force && cache.get(key);
    if (hit) { activeKey = key; return { views: hit.views, truncated: hit.truncated, cached: true }; }
    let run = inflight.get(key);
    if (!run) {
      // a request for another viewport is obsolete the moment this one starts
      for (const [k, r] of inflight) if (k !== key) { r.ctrl.abort(); inflight.delete(k); }
      const ctrl = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} };
      const promise = fetchAll(q, ctrl.signal).then((r) => { cache.set(key, { t: now(), ...r }); prune(); return r; }).finally(() => { if (inflight.get(key)?.promise === promise) inflight.delete(key); });
      promise.catch(() => {}); // a cancelled or failed run with no waiter left must not surface as an unhandled rejection
      run = { promise, ctrl };
      inflight.set(key, run);
    }
    activeKey = key;
    let r;
    try { r = await run.promise; } catch (e) { if (mine !== seq) return null; if (e?.code === 'aborted') return null; throw e; }
    if (mine !== seq) return null; // a newer request was made while this one was in flight
    return { views: r.views, truncated: r.truncated, cached: false };
  }

  return {
    load,
    /** Drops one area from every cached viewport (it was found to be unpublished): a stale entry can never bring it back. */
    forget(areaId) { for (const v of cache.values()) v.views = v.views.filter((x) => x.areaId !== areaId); },
    /** Drops every cached viewport and cancels what is in flight (a moderation decision, sign-in or sign-out). */
    clear() { cache.clear(); for (const r of inflight.values()) r.ctrl.abort(); inflight.clear(); seq++; },
    size: () => cache.size,
    activeKey: () => activeKey,
  };
}
