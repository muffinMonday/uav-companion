// The local diagnostic log store (see log.js): recent entries kept in this browser, in IndexedDB, with a fixed size. Nothing here touches the network.
//
// Writes are queued in memory and saved together after a short pause (idle time when the browser has it), so logging never waits for storage. Rotation runs on every
// save: entries older than the age limit go, then the oldest go until both the entry limit and the size limit hold. If IndexedDB is missing or fails, the store keeps
// working from memory only (the same limits) and never throws.
import { scrubEntry } from './logscrub.js';

export const LIMITS = { maxEntries: 500, maxBytes: 200 * 1024, maxAgeMs: 7 * 24 * 3600 * 1000 };
const entryBytes = (e) => { try { return JSON.stringify(e).length; } catch { return 0; } };

/** Which entries to remove: past the age limit, then oldest first until the entry and size limits hold. Pure. `entries` need `id`, `t`, and may be in any order. */
export function rotation(entries, { maxEntries, maxBytes, maxAgeMs }, now) {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  const drop = new Set();
  for (const e of sorted) if (now - (e.last || e.t) > maxAgeMs) drop.add(e.id);
  let kept = sorted.filter((e) => !drop.has(e.id));
  let bytes = kept.reduce((n, e) => n + entryBytes(e), 0);
  let i = 0;
  while (i < kept.length && (kept.length - i > maxEntries || bytes > maxBytes)) { bytes -= entryBytes(kept[i]); drop.add(kept[i].id); i++; }
  return [...drop];
}

/** The IndexedDB backend. Returns null when IndexedDB is not there. Each method returns a promise. */
export function idbBackend(idbIn, name = 'uavzones-log') {
  let idb = idbIn;
  try { idb = idb || globalThis.indexedDB; } catch { return null; } // reaching indexedDB can throw when site data is blocked
  if (!idb) return null;
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('log', { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb'));
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  }));
  const run = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('log', mode);
      const store = tx.objectStore('log');
      let result;
      try { result = work(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('indexeddb'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb aborted'));
    });
  };
  return {
    putMany: (entries) => run('readwrite', (s) => { for (const e of entries) s.put(e); }),
    getAll: () => run('readonly', (s) => s.getAll()),
    deleteMany: (ids) => run('readwrite', (s) => { for (const id of ids) s.delete(id); }),
    clear: () => run('readwrite', (s) => { s.clear(); }),
  };
}

/** A memory backend (also what the tests use). */
export function memoryBackend() {
  const m = new Map();
  return {
    putMany: async (entries) => { for (const e of entries) m.set(e.id, JSON.parse(JSON.stringify(e))); },
    getAll: async () => [...m.values()],
    deleteMany: async (ids) => { for (const id of ids) m.delete(id); },
    clear: async () => { m.clear(); },
  };
}

const defaultSchedule = (fn) => {
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 2000);
};

/**
 * createLogStore({ backend, limits, now, schedule }) -> { put(entry), flush(), recent(), clear(), stats(), exportJson() }
 *   put(entry)    queue an entry (an entry with a known id replaces the earlier copy: a repeated message raises its count)
 *   flush()       save the queue now (resolves when done; never rejects)
 *   recent()      the stored entries, oldest first (resolves to [] on failure)
 *   stats()       { entries, bytes, limits, persistent }
 */
export function createLogStore({ backend = idbBackend(), limits = LIMITS, now = () => Date.now(), schedule = defaultSchedule } = {}) {
  const lim = { ...LIMITS, ...limits };
  let pending = new Map();
  let mem = new Map(); // what this session has, used when the backend is missing or has failed
  let dead = !backend;
  let timer = false, chain = Promise.resolve();

  const trimMem = () => { for (const id of rotation([...mem.values()], lim, now())) mem.delete(id); };

  const save = async () => {
    const batch = [...pending.values()];
    pending = new Map();
    if (!batch.length || dead) return;
    try {
      await backend.putMany(batch);
      const all = await backend.getAll();
      const drop = rotation(all, lim, now());
      if (drop.length) await backend.deleteMany(drop);
    } catch { dead = true; } // from here on the memory copy answers
  };

  const flush = () => {
    chain = chain.then(save).catch(() => {});
    return chain;
  };
  const arm = () => {
    if (timer) return;
    timer = true;
    try { schedule(() => { timer = false; flush(); }); } catch { timer = false; }
  };

  return {
    put(entry) {
      try {
        const e = scrubEntry(entry);
        mem.set(e.id, e); trimMem();
        if (!dead) { pending.set(e.id, e); arm(); }
      } catch { /* logging must never break the app */ }
    },
    flush,
    async recent() {
      try {
        await flush();
        if (!dead) return (await backend.getAll()).map(scrubEntry).sort((a, b) => a.id - b.id);
      } catch { dead = true; }
      return [...mem.values()].sort((a, b) => a.id - b.id);
    },
    async clear() {
      pending = new Map(); mem = new Map();
      try { await chain; if (!dead) await backend.clear(); } catch { dead = true; }
    },
    async stats() {
      const all = await this.recent();
      return { entries: all.length, bytes: all.reduce((n, e) => n + entryBytes(e), 0), limits: lim, persistent: !dead };
    },
    async exportJson() {
      const all = await this.recent(); // scrubbed again on the way out
      return JSON.stringify({ app: 'UAV Companion diagnostics', exported: new Date(now()).toISOString(), limits: lim, note: 'Kept on this device only. Contains no positions, names, tokens or account details.', entries: all }, null, 2);
    },
  };
}
