// The progression functions of the cloud database (supabase/migrations/20261114110000_achievements.sql and 20261114120000_progression_read.sql), with a short cache.
// A person is named by the handle the app already holds: ('friend', friendship id) or ('member', party member id). Nothing here ever has a user id.
import { cleanProgression, cleanHistory } from './progression.js';
import { createBackoff } from './backoff.js';

const TTL_MS = 30_000;
const clients = new WeakMap();

/** One shared instance per database client, so every screen shares the cache. */
export function getProgression(client) {
  if (!clients.has(client)) clients.set(client, createProgression(client));
  return clients.get(client);
}

export function createProgression(client, now = () => Date.now()) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const cache = new Map(); // key -> { at, value }
  const manyWait = createBackoff({ base: 10_000, max: 120_000, now, name: 'progression' }); // after a failed list call, `many` fails at once for a while instead of asking again
  const fresh = (k) => { const c = cache.get(k); return c && now() - c.at < TTL_MS ? c.value : undefined; };
  const keep = (k, value) => { cache.set(k, { at: now(), value }); if (cache.size > 200) cache.delete(cache.keys().next().value); return value; };

  return {
    /** Someone's progression in full: { visible: false } when it is hidden or not reachable (the database gives the same answer for every reason). */
    async get(kind, id) {
      const k = kind + ':' + id; const hit = fresh(k); if (hit) return hit;
      return keep(k, cleanProgression(await rpc('get_progression', { p_kind: kind, p_id: id })));
    },
    /**
     * Brief progression (rank, XP, progress, featured) for many people at once, one database call for those not held yet. Returns a Map id -> cleaned payload;
     * anyone the database does not return, or hides, is { visible: false }. Kept apart from get(), whose payloads carry the whole collection.
     */
    async many(kind, ids) {
      const uniq = [...new Set(ids)];
      const want = uniq.filter((id) => fresh('brief:' + kind + ':' + id) === undefined);
      if (want.length && !manyWait.ready()) throw new Error('progression is unavailable, trying again shortly');
      for (let i = 0; i < want.length; i += 100) {
        const chunk = want.slice(i, i + 100);
        let rows;
        try { rows = await rpc('list_progression', { p_kind: kind, p_ids: chunk }); manyWait.ok(); } catch (e) { manyWait.fail(e); throw e; }
        const got = new Set();
        for (const r of Array.isArray(rows) ? rows : []) if (r && typeof r.id === 'string' && chunk.includes(r.id)) { got.add(r.id); keep('brief:' + kind + ':' + r.id, cleanProgression(r)); }
        for (const id of chunk) if (!got.has(id)) keep('brief:' + kind + ':' + id, { visible: false });
      }
      return new Map(uniq.map((id) => [id, fresh('brief:' + kind + ':' + id) ?? { visible: false }]));
    },
    /** The caller's own, with unlock times. */
    async mine({ force = false } = {}) {
      if (!force) { const hit = fresh('me'); if (hit) return hit; }
      return keep('me', cleanProgression(await rpc('my_progression')));
    },
    /** What `get` or `mine` already holds and is still fresh, or null: lets a screen draw at once. */
    peek: (kind, id) => fresh(kind === 'me' ? 'me' : kind + ':' + id) ?? null,
    /** A page of the caller's own XP history. Pass `next` from the previous page as `before`. */
    async history(before = null, limit = 30) { return cleanHistory(await rpc('my_xp_history', { p_before: before, p_limit: limit })); },
    /** Chooses up to three unlocked achievements to show on the profile (keys, in order). Returns the saved keys. */
    async setFeatured(keys) { const r = await rpc('set_featured', { p_keys: keys }); cache.delete('me'); return r?.featured ?? []; },
    forget() { cache.clear(); },
  };
}
