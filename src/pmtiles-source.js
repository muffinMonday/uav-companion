// Whole-file PMTiles source. The CDN in front of the site answers Range requests with stale bytes, so an archive is
// downloaded once with a plain GET (which is correct) and read from memory. The PMTiles reader asks for byte ranges as usual.
//
// Persistence (Cache API, one cache per origin, keyed by the content-hashed URL):
// - A download is checked against the sha256 prefix in its name before it is used. A failed or mismatched download is
//   never stored, and a stored copy that no longer matches is dropped.
// - Older hash-named archives are kept. A save that fails because storage is full evicts ONE archive (an unreferenced
//   one first, then the least recently used), then retries once. Nothing is deleted unless a save fails.
// - If the retry fails, or storage is unavailable, persistence stops for the page session and the map keeps working
//   from memory. Saving runs in the background, so cache work never delays the map.
import { PMTiles } from 'pmtiles';

export const CACHE_NAME = 'uavzones-pmtiles-v1';
const INDEX_CACHE = 'uavzones-pmtiles-index-v1';
const INDEX_KEY = 'uavzones-index.json'; // last-use record; the Cache API keeps no access times of its own
const HASHED = /\.([0-9a-f]{8})\.pmtiles$/;

let referenced = new Set(); // archive URLs the current manifests reference, set once the manifests load
/** Called after the manifests load; archives outside this set are evicted first when storage is full. */
export function setArchiveReferences(urls) { referenced = new Set(urls); }

const realDeps = () => ({
  fetch: (url, init) => fetch(url, init),
  caches: typeof caches !== 'undefined' ? caches : null,
  digest: async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join(''),
  warn: (...a) => console.warn(...a),
  info: (...a) => console.info(...a),
  now: () => Date.now(),
  referenced: () => referenced,
  estimate: async () => (typeof navigator !== 'undefined' && navigator.storage?.estimate ? navigator.storage.estimate() : null),
});
const REAL = realDeps(); // one set of deps per page: all archives share one persistence layer

const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message ?? '')));
const keyOf = (r) => (typeof r === 'string' ? r : r.url);

const layers = new WeakMap();
function layerFor(deps) {
  if (!layers.has(deps)) layers.set(deps, makeLayer(deps));
  return layers.get(deps);
}

// Index writes are serialised so concurrent saves and touches cannot lose each other's updates.
function makeLayer(deps) {
  let chain = Promise.resolve();
  const exclusive = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  let persistOff = false;
  let reportedOnce = false;

  const readIndex = async () => {
    try { const r = await (await deps.caches.open(INDEX_CACHE)).match(INDEX_KEY); return r ? await r.json() : {}; }
    catch { return {}; }
  };
  const writeIndex = async (idx) => (await deps.caches.open(INDEX_CACHE))
    .put(INDEX_KEY, new Response(JSON.stringify(idx), { headers: { 'content-type': 'application/json' } }));

  const recordUse = (url, bytes) => exclusive(async () => {
    const idx = await readIndex();
    idx[url] = { bytes, used: deps.now() };
    await writeIndex(idx);
  });
  const forget = (url) => exclusive(async () => {
    const idx = await readIndex();
    delete idx[url];
    await writeIndex(idx);
  });

  /** One eviction candidate: not referenced by the manifests first, then the least recently used. Never `exclude`. */
  const chooseVictim = async (cache, exclude) => {
    const keys = (await cache.keys()).map(keyOf).filter((u) => u !== exclude);
    const idx = await readIndex();
    const refs = deps.referenced();
    keys.sort((a, b) => (refs.has(a) - refs.has(b)) || ((idx[a]?.used ?? 0) - (idx[b]?.used ?? 0)));
    return keys[0] ?? null;
  };

  const reportStorage = async () => {
    if (reportedOnce) return;
    reportedOnce = true;
    try {
      const idx = await readIndex();
      const est = await deps.estimate();
      const mb = (n) => (n / 1e6).toFixed(1);
      const used = Object.values(idx).reduce((s, e) => s + (e.bytes || 0), 0);
      deps.info(`archive cache: ${Object.keys(idx).length} archive(s), ${mb(used)} MB` + (est ? `; browser storage ${mb(est.usage ?? 0)} of ${mb(est.quota ?? 0)} MB` : ''));
    } catch { /* reporting is optional */ }
  };

  /** Saves a validated archive. Runs in the background; every failure ends here, so the map never waits on it. */
  const store = async (url, buf) => {
    if (persistOff) return;
    try {
      const cache = await deps.caches.open(CACHE_NAME);
      const entry = () => new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) } });
      try {
        await cache.put(url, entry());
      } catch (e) {
        if (!isQuota(e)) throw e;
        const victim = await chooseVictim(cache, url);
        if (!victim) { persistOff = true; deps.warn('archive cache full and nothing to evict; the map keeps working from memory:', e); return; }
        await cache.delete(victim);
        await forget(victim);
        deps.info(`archive cache full: evicted ${victim} to make room`);
        try {
          await cache.put(url, entry());
        } catch (e2) {
          persistOff = true;
          deps.warn('archive still does not fit after one eviction; persistent caching is off for this session, the map keeps working from memory:', e2);
          return;
        }
      }
      await recordUse(url, buf.byteLength);
      reportStorage();
    } catch (e) {
      persistOff = true;
      deps.warn('archive not cached (storage unavailable); the map keeps working from memory:', e);
    }
  };

  /** A stored copy that matches its name, or null. Touches the last-use record without waiting for it. */
  const read = async (url, expected) => {
    if (!deps.caches || expected === null) return null;
    try {
      const cache = await deps.caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (!hit) return null;
      const buf = await hit.arrayBuffer();
      if (!(await deps.digest(buf) === expected)) {
        await cache.delete(url);
        await forget(url);
        return null;
      }
      recordUse(url, buf.byteLength).catch(() => {});
      return buf;
    } catch (e) { deps.warn('archive cache read failed; downloading instead:', e); return null; }
  };

  return { read, store, isOff: () => persistOff };
}

/** Reads one archive: memory, then the Cache API, then the network. Returns a PMTiles reader for `url`. */
export function wholeFileArchive(url, deps = REAL, hooks = {}) {
  const expected = HASHED.exec(new URL(url).pathname)?.[1] ?? null; // no hash in the name: never persisted
  const layer = layerFor(deps);
  let loading = null;

  const validate = async (buf) => expected === null || (await deps.digest(buf)) === expected;

  const download = async () => {
    const r = await deps.fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const buf = await r.arrayBuffer();
    if (!(await validate(buf))) throw new Error(`${url}: content does not match its name (not stored)`);
    if (expected !== null && deps.caches) layer.store(url, buf); // in the background: the map does not wait for it
    return buf;
  };

  const load = () => (loading ??= (async () => (await layer.read(url, expected)) ?? download())()
    .catch((e) => { loading = null; throw e; })); // a failed download is retried on the next read

  const reader = new PMTiles({
    getKey: () => url,
    async getBytes(offset, length) {
      hooks.begin?.();
      try {
        const bytes = await load();
        return { data: bytes.slice(offset, offset + length) };
      } finally { hooks.end?.(); }
    },
  });
  reader.drop = () => { loading = null; }; // forget the whole-file buffer; the next read comes back from the Cache API
  return reader;
}

// Archives resident in memory, one reader per URL for the whole page (the map and the point check share one copy).
// An entry leaves memory (the whole-file buffer is dropped; the Cache API copy is untouched) once nothing holds it and no
// read is in flight, after a short grace period so panning back and forth over a border does not reload it.
// A hold is a lease: the map keeps one per rendered region, a point check one for its duration.
/** The grace period; mutable so tests can shorten it. */
export const evictPolicy = { graceMs: 20000 };

export function createArchiveRegistry(deps = REAL, { policy = evictPolicy, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = new Map(); // url -> { reader, holds, busy, timer }
  const entryFor = (url) => {
    let e = entries.get(url);
    if (!e) {
      e = { holds: 0, busy: 0, timer: null };
      e.reader = wholeFileArchive(url, deps, { begin: () => { e.busy++; }, end: () => { e.busy--; } });
      entries.set(url, e);
    }
    return e;
  };
  const cancel = (e) => { if (e.timer !== null) { clearTimer(e.timer); e.timer = null; } };
  const evictIfIdle = (url, e) => {
    e.timer = null;
    if (entries.get(url) !== e || e.holds > 0) return;
    if (e.busy > 0) { e.timer = setTimer(() => evictIfIdle(url, e), policy.graceMs); return; } // a read is under way: try again later
    entries.delete(url);
    e.reader.drop();
  };
  const schedule = (url, e) => { cancel(e); e.timer = setTimer(() => evictIfIdle(url, e), policy.graceMs); };

  return {
    /** The reader for `url`, created on first use. Takes no hold. */
    shared: (url) => entryFor(url).reader,
    /** The reader for `url` with a hold on it; cancels a pending eviction. Pair with `release`. */
    retain(url) { const e = entryFor(url); e.holds++; cancel(e); return e.reader; },
    /** Gives one hold back. With none left the archive becomes eligible for eviction after the grace period. */
    release(url) {
      const e = entries.get(url);
      if (!e || e.holds === 0) return;
      if (--e.holds === 0) schedule(url, e);
    },
    /** Runs `fn(reader)` with a hold, so the archive cannot be evicted underneath it. */
    async with(url, fn) {
      const reader = this.retain(url);
      try { return await fn(reader); } finally { this.release(url); }
    },
    resident: (url) => entries.has(url),
    residentCount: () => entries.size,
  };
}

const registry = createArchiveRegistry();
/** The page's reader for `url` (memoised, no hold). */
export const sharedArchive = (url) => registry.shared(url);
/** The page's reader for `url`, held until `releaseArchive(url)`. */
export const retainArchive = (url) => registry.retain(url);
/** Gives back one hold taken with `retainArchive`; the archive leaves memory after the grace period if nothing else holds it. */
export const releaseArchive = (url) => registry.release(url);
/** Runs `fn(reader)` while holding the archive (a point check, for example). */
export const withArchive = (url, fn) => registry.with(url, fn);
/** Is the archive for `url` in memory? */
export const archiveResident = (url) => registry.resident(url);
/** Archives currently in memory. */
export const residentArchives = () => registry.residentCount();

/** Current cache use for the console and tests: archives kept, MB recorded, browser usage and quota. */
export async function archiveCacheStatus() {
  const layer = layerFor(REAL);
  const idx = await (async () => { try { const r = await (await caches.open(INDEX_CACHE)).match(INDEX_KEY); return r ? await r.json() : {}; } catch { return {}; } })();
  const est = await REAL.estimate().catch(() => null);
  return { archives: Object.keys(idx).length, bytes: Object.values(idx).reduce((s, e) => s + (e.bytes || 0), 0), usage: est?.usage ?? null, quota: est?.quota ?? null, persistent: !layer.isOff(), resident: registry.residentCount() };
}
