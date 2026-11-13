// Cloud sync for one device: keeps the markers and trips in the store and the user's cloud copy in step, and asks when it cannot decide.
// No network code lives here: it talks to an adapter (see sync/supabase.js; tests use an in-memory one), and the rules are in sync/core.js.
//
// Adapter: getSession() → { email } | null; signIn(email); signOut(); info() → { rev, updated_at, device, markers, trips } | null;
//   fetch() → { doc, rev, updated_at, device } | null; save(doc, baseRev, device, force) → { status:'ok'|'conflict', rev, ... };
//   listVersions(); restore(rev); remove(). info() and fetch().doc may carry `settings` ({ theme, themeAt }, see core.js mergeSettings).
// `settings` option: { get() -> { theme, themeAt } | null, apply(value) } for the synced settings; each is last-writer-wins and never causes a question.
//
// Status: 'off' (no adapter or not signed in), 'idle', 'syncing', 'synced', 'ask' (waiting for the user's choice), 'error'.

import { buildDoc, decide, diffDocs, keepLocalCheckins, counts, sameContent, contentSig, mergeSettings } from './core.js';

const KEY = 'uavzones.v1.sync';
const DEBOUNCE_MS = 2500;
const SHARED_DEBOUNCE_MS = 30000; // a shared-trip change applied from the server is uploaded to the cloud copy later, and with the next ones together

export function createSync({ store, adapter, storage = globalThis.localStorage, device = 'Browser', includeCheckins = () => false, settings = null, backup = null, debounceMs = DEBOUNCE_MS, now = () => new Date().toISOString() }) {
  const listeners = new Set();
  let state = { baseRev: null, dirty: false, lastSyncedAt: null, baseSig: null }; // baseSig: fingerprint of the markers and trips as last synced
  try { const s = JSON.parse(storage?.getItem(KEY) || 'null'); if (s && typeof s === 'object') state = { baseRev: Number.isFinite(s.baseRev) ? s.baseRev : null, dirty: !!s.dirty, lastSyncedAt: typeof s.lastSyncedAt === 'string' ? s.lastSyncedAt : null, baseSig: typeof s.baseSig === 'string' ? s.baseSig : null }; } catch { /* start fresh */ }

  let status = adapter ? 'idle' : 'off';
  let session = null, error = null, pending = null, applying = false, timer = null, running = null, changes = 0, stopped = false;

  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* the app works without it; the next start asks again */ } };
  const snapshot = () => ({ status, session, error, pending, baseRev: state.baseRev, dirty: state.dirty, lastSyncedAt: state.lastSyncedAt });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const set = (s, extra = {}) => { status = s; error = extra.error ?? null; pending = extra.pending ?? null; emit(); };
  const localDoc = () => buildDoc({ items: store.items(), trips: store.trips(), includeCheckins: includeCheckins(), settings: settings?.get() });
  const hasData = () => store.items().length + store.trips().length > 0;
  const fail = (e) => { set('error', { error: String(e?.message || e) }); };

  /** Settings: the newer of the two wins. Applies the cloud's at once when it is newer; returns true when this device's are newer (the cloud copy needs them). */
  function reconcileSettings(cloudSettings) {
    if (!settings) return false;
    const m = mergeSettings(settings.get(), cloudSettings);
    if (m.from === 'cloud') { try { settings.apply(m.value); } catch { /* a settings problem must not stop the sync */ } }
    return m.from === 'local';
  }

  function applyCloud(res) {
    const items = includeCheckins() ? res.doc.items : keepLocalCheckins(res.doc.items, store.items());
    if (!sameContent({ items: store.items(), trips: store.trips() }, { items, trips: res.doc.trips })) { // a change of settings only does not redraw the markers
      applying = true;
      try { store.replaceAll(items, res.doc.trips); } finally { applying = false; }
    }
    state = { baseRev: res.rev, dirty: false, lastSyncedAt: now(), baseSig: contentSig(res.doc) };
    persist();
    return reconcileSettings(res.doc.settings); // true: this device's settings are newer than the copy just taken
  }

  async function push(force) {
    const mark = changes;
    let base = state.baseRev;
    if (force) { const cur = await adapter.info(); base = cur?.rev ?? null; reconcileSettings(cur?.settings); } // keep the cloud's settings if they are newer
    const doc = localDoc();
    const r = await adapter.save(doc, base, device, force);
    if (r.status === 'conflict') return r;
    state = { baseRev: r.rev, dirty: changes !== mark, lastSyncedAt: now(), baseSig: contentSig(doc) }; // edits made while the save was in flight stay marked
    persist();
    return r;
  }

  /** Uploads this device's settings alone: the cloud copy's markers and trips are taken as they are and only `settings` changes. No question, no dirty flag; once more if the cloud moved meanwhile. */
  async function pushSettings() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const got = await adapter.fetch();
      if (!got) return; // no cloud copy: the first real upload carries the settings
      if (!reconcileSettings(got.doc.settings)) return; // not newer here after all
      const r = await adapter.save({ ...got.doc, settings: buildDoc({ settings: settings.get() }).settings }, got.rev, device, false);
      if (r.status === 'conflict') continue;
      if (state.baseRev === got.rev) { state = { ...state, baseRev: r.rev }; persist(); } // a real pending pull (another baseRev) stays visible
      return;
    }
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
    const settingsNewer = reconcileSettings(cloud?.settings); // before anything else, and with no question: also while one is waiting
    let action = decide({ hasData: hasData(), dirty: state.dirty, baseRev: state.baseRev }, cloud);
    if (action === 'ask' && state.dirty && state.baseSig && cloud.rev > state.baseRev) {
      // The cloud copy moved on, but if its markers and trips are what we last synced, only its settings changed (another device): our changes can go up on top of it.
      const got = await adapter.fetch();
      if (got && contentSig(got.doc) === state.baseSig) { state = { ...state, baseRev: got.rev }; persist(); action = 'push'; }
    }
    if (action === 'nothing' || action === 'in-sync') {
      state.lastSyncedAt = state.lastSyncedAt ?? now(); persist();
      if (action === 'in-sync' && settingsNewer) await pushSettings();
      set('synced'); return;
    }
    if (action === 'pull') { const newer = applyCloud(await adapter.fetch()); set('synced'); if (newer) schedule(); return; }
    if (action === 'ask') {
      // Identical content on both sides (an upload that reached the server but whose answer was lost, or the same data on two devices): nothing to choose.
      const got = state.baseRev == null ? await adapter.fetch() : null;
      if (got && sameContent(localDoc(), got.doc)) { state = { baseRev: got.rev, dirty: false, lastSyncedAt: now(), baseSig: contentSig(got.doc) }; persist(); reconcileSettings(got.doc.settings); if (settingsNewer) await pushSettings(); set('synced'); return; }
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

  let timerMs = 0;
  /** Uploads after a pause. A person's own edit restarts a shorter pause; a server-applied change (`later`) never touches a pause that is already running, so it neither delays nor multiplies uploads. */
  function schedule(later = false) {
    if (!adapter || !session || status === 'ask' || stopped) return;
    const ms = later ? Math.max(debounceMs, SHARED_DEBOUNCE_MS) : debounceMs;
    if (timer && (later || ms > timerMs)) return;
    clearTimeout(timer); timerMs = ms;
    timer = setTimeout(() => { timer = null; sync(); }, ms);
  }

  store.onChange((kind) => {
    if (applying) return;
    changes++; state.dirty = true; persist();
    if (status === 'synced' || status === 'idle' || status === 'error') schedule(kind === 'shared');
  });

  return {
    status: snapshot,
    onStatus: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Look for a session (a returning visit, or coming back from the email link) and sync if there is one. */
    start: () => sync(),
    sync,
    /** The user changed a synced setting here: upload it after the usual pause. */
    noteSettings: () => schedule(),
    /** A cheap look at the cloud copy's settings only (for a tab that comes back to the front): adopts newer ones now, and schedules the upload of ours if they are newer. Never asks anything. */
    async checkSettings() {
      if (!adapter || !session || !settings || stopped || running || status === 'ask' || status === 'syncing') return;
      try { const cloud = await adapter.info(); if (cloud && reconcileSettings(cloud.settings)) schedule(); } catch { /* try again at the next visit */ }
    },
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
      await adapter.signOut(); session = null; state = { baseRev: null, dirty: false, lastSyncedAt: null, baseSig: null }; persist();
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
      state = { baseRev: null, dirty: false, lastSyncedAt: null, baseSig: null };
      persist(); set('synced');
    },
    async stop() { stopped = true; clearTimeout(timer); await running; },
  };
}
