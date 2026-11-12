// Cloud sync for one device: keeps the markers and trips in the store and the user's cloud copy in step, and asks when it cannot decide.
// No network code lives here: it talks to an adapter (see sync/supabase.js; tests use an in-memory one), and the rules are in sync/core.js.
//
// Adapter: getSession() → { email } | null; signIn(email); signOut(); info() → { rev, updated_at, device, markers, trips } | null;
//   fetch() → { doc, rev, updated_at, device } | null; save(doc, baseRev, device, force) → { status:'ok'|'conflict', rev, ... };
//   listVersions(); restore(rev); remove().
//
// Status: 'off' (no adapter or not signed in), 'idle', 'syncing', 'synced', 'ask' (waiting for the user's choice), 'error'.

import { buildDoc, decide, diffDocs, keepLocalCheckins, counts, sameContent } from './core.js';

const KEY = 'uavzones.v1.sync';
const DEBOUNCE_MS = 2500;

export function createSync({ store, adapter, storage = globalThis.localStorage, device = 'Browser', includeCheckins = () => false, backup = null, debounceMs = DEBOUNCE_MS, now = () => new Date().toISOString() }) {
  const listeners = new Set();
  let state = { baseRev: null, dirty: false, lastSyncedAt: null };
  try { const s = JSON.parse(storage?.getItem(KEY) || 'null'); if (s && typeof s === 'object') state = { baseRev: Number.isFinite(s.baseRev) ? s.baseRev : null, dirty: !!s.dirty, lastSyncedAt: typeof s.lastSyncedAt === 'string' ? s.lastSyncedAt : null }; } catch { /* start fresh */ }

  let status = adapter ? 'idle' : 'off';
  let session = null, error = null, pending = null, applying = false, timer = null, running = null, changes = 0, stopped = false;

  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* the app works without it; the next start asks again */ } };
  const snapshot = () => ({ status, session, error, pending, baseRev: state.baseRev, dirty: state.dirty, lastSyncedAt: state.lastSyncedAt });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const set = (s, extra = {}) => { status = s; error = extra.error ?? null; pending = extra.pending ?? null; emit(); };
  const localDoc = () => buildDoc({ items: store.items(), trips: store.trips(), includeCheckins: includeCheckins() });
  const hasData = () => store.items().length + store.trips().length > 0;
  const fail = (e) => { set('error', { error: String(e?.message || e) }); };

  function applyCloud(res) {
    applying = true;
    try { store.replaceAll(includeCheckins() ? res.doc.items : keepLocalCheckins(res.doc.items, store.items()), res.doc.trips); } finally { applying = false; }
    state = { baseRev: res.rev, dirty: false, lastSyncedAt: now() };
    persist();
  }

  async function push(force) {
    const mark = changes, doc = localDoc();
    const r = await adapter.save(doc, force ? (await adapter.info())?.rev ?? null : state.baseRev, device, force);
    if (r.status === 'conflict') return r;
    state = { baseRev: r.rev, dirty: changes !== mark, lastSyncedAt: now() }; // edits made while the save was in flight stay marked
    persist();
    return r;
  }

  async function askUser(cloud) {
    const got = await adapter.fetch();
    const d = got ? diffDocs(localDoc(), got.doc) : null;
    set('ask', { pending: { cloud: { rev: cloud.rev, updated_at: cloud.updated_at, device: cloud.device, markers: cloud.markers, trips: cloud.trips }, local: counts(localDoc()), diff: d, neverSynced: state.baseRev == null, cloudReset: state.baseRev != null && cloud.rev < state.baseRev } });
  }

  async function run() {
    set('syncing');
    session = await adapter.getSession();
    if (!session) { set('off'); return; }
    const cloud = await adapter.info();
    const action = decide({ hasData: hasData(), dirty: state.dirty, baseRev: state.baseRev }, cloud);
    if (action === 'nothing' || action === 'in-sync') { state.lastSyncedAt = state.lastSyncedAt ?? now(); persist(); set('synced'); return; }
    if (action === 'pull') { applyCloud(await adapter.fetch()); set('synced'); return; }
    if (action === 'ask') {
      // Identical content on both sides (an upload that reached the server but whose answer was lost, or the same data on two devices): nothing to choose.
      const got = state.baseRev == null ? await adapter.fetch() : null;
      if (got && sameContent(localDoc(), got.doc)) { state = { baseRev: got.rev, dirty: false, lastSyncedAt: now() }; persist(); set('synced'); return; }
      await askUser(cloud); return;
    }
    const r = await push(false); // push, push-first
    if (r.status === 'conflict') { await askUser(r); return; }
    set('synced');
    if (state.dirty) schedule();
  }

  /** One sync pass; calls made while one is running join it. */
  function sync() {
    if (!adapter || stopped) return Promise.resolve();
    if (status === 'ask') return Promise.resolve();
    clearTimeout(timer); timer = null;
    running ??= run().catch(fail).finally(() => { running = null; });
    return running;
  }

  function schedule() {
    if (!adapter || !session || status === 'ask' || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(); }, debounceMs);
  }

  store.onChange(() => {
    if (applying) return;
    changes++; state.dirty = true; persist();
    if (status === 'synced' || status === 'idle' || status === 'error') schedule();
  });

  return {
    status: snapshot,
    onStatus: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Look for a session (a returning visit, or coming back from the email link) and sync if there is one. */
    start: () => sync(),
    sync,
    async signIn(email) { try { await adapter.signIn(email); return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message || e) }; } },
    /**
     * Signs out. With `wipe`, this device's markers and trips are removed afterwards so the next person to sign in here does not inherit them (the data
     * stays in the cloud copy). It refuses ({ ok: false, reason }) while something here is not in the cloud copy: 'unsynced' (a change the cloud has not
     * accepted, or a pending question) or 'checkins' (check-ins are not uploaded). `force` goes ahead anyway, after handing the whole device to `backup`.
     */
    async signOut({ wipe = false, force = false } = {}) {
      clearTimeout(timer);
      if (wipe && session && hasData()) {
        await running;
        if (state.dirty || state.baseRev == null) await sync();
        const unsynced = state.dirty || state.baseRev == null || status === 'ask' || status === 'error';
        const checkins = !includeCheckins() && store.items().some((i) => i.checkin);
        if ((unsynced || checkins) && !force) { schedule(); return { ok: false, reason: unsynced ? 'unsynced' : 'checkins' }; }
        if ((unsynced || checkins) && backup) await backup('device', buildDoc({ items: store.items(), trips: store.trips(), includeCheckins: true }));
      }
      await adapter.signOut(); session = null; state = { baseRev: null, dirty: false, lastSyncedAt: null }; persist();
      if (wipe) { applying = true; try { store.replaceAll([], []); } finally { applying = false; } }
      set('off');
      return { ok: true };
    },
    /** The user's answer to a question: 'cloud' (take the cloud copy) or 'device' (keep this device's data, replacing the cloud copy); backup: save the side that loses first. */
    async resolve(choice, { backup: wantBackup = true } = {}) {
      if (status !== 'ask') return;
      set('syncing');
      try {
        if (choice === 'cloud') {
          const got = await adapter.fetch();
          if (wantBackup && backup && hasData()) await backup('device', localDoc());
          applyCloud(got);
        } else if (choice === 'device') {
          if (wantBackup && backup) { const got = await adapter.fetch(); if (got) await backup('cloud', got.doc); }
          const r = await push(true);
          if (r.status !== 'ok') throw new Error('the cloud copy changed again; try once more');
        } else throw new Error('unknown choice');
        set('synced');
        if (state.dirty) schedule();
      } catch (e) { fail(e); }
    },
    /** Makes an earlier version the current cloud copy and brings this device in line with it (this device's data is handed to the backup first). */
    async restoreVersion(rev) {
      if (!session) return;
      set('syncing');
      try {
        await adapter.restore(rev);
        const got = await adapter.fetch();
        if (backup && hasData()) await backup('device', localDoc());
        applyCloud(got);
        set('synced');
      } catch (e) { fail(e); }
    },
    /** Deletes the cloud copy and its versions; this device keeps its data and the next change uploads it again. */
    async deleteCloud() {
      await adapter.remove();
      state = { baseRev: null, dirty: false, lastSyncedAt: null };
      persist(); set('synced');
    },
    async stop() { stopped = true; clearTimeout(timer); await running; },
  };
}
