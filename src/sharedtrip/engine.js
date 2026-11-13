// Keeps this device's copies of the shared trips in step with the server, and carries the invitations and the party's membership.
// No network code here: it talks to an api (sharedtrip/api.js; tests use one that runs the real database rules), the rules are in sharedtrip/core.js,
// and the store (poi.js) holds the trips and markers.
//
// The server holds one document per shared trip with a revision. This device remembers, per trip, the revision and document it last synced (the `base`).
//   - Every few seconds it asks the server for the list of the caller's shared trips. A trip whose revision moved on is fetched; if nothing changed on this
//     device it is simply applied, otherwise the two are merged (mergeDocs) and the result is applied here and saved.
//   - A change made on this device is saved a moment after it, the same way: if the server has moved on, fetch, merge, apply, save again.
//   - A trip that is no longer on the list (the owner removed this person or deleted it, or this person left on another device) stops being shared on this
//     device: the trip and its markers stay as a private copy, and a notice says so.

import { buildSharedDoc, mergeDocs, sameDoc, describeChange } from './core.js';
import { createBackoff, canPoll } from '../backoff.js';

const KEY = 'uavzones.v1.shared';

// A list call that finds nothing new is repeated less often: every `pollMs` at first, every second tick after `slowAfter` quiet polls (about a minute), every third after
// `slowerAfter` (about three minutes). Anything that changes (the list, a local edit, coming back to the page, an action) starts again at the normal pace.
export function createSharedTrips({ store, api, storage = globalThis.localStorage, pollMs = 10000, debounceMs = 2000, slowAfter = 6, slowerAfter = 18 }) {
  const listeners = new Set();
  let bases = {};
  try { const d = JSON.parse(storage?.getItem(KEY) || 'null'); if (d && typeof d === 'object' && d.bases && typeof d.bases === 'object') bases = d.bases; } catch { bases = {}; }
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify({ v: 1, bases })); } catch { /* the next start merges from scratch */ } };

  const snap = { invitations: [], trips: {}, notices: [], error: null, polledAt: null, liveActive: null, online: {} };
  let applying = false, poller = null, chain = Promise.resolve(), stopped = false, ticking = false, quiet = 0, tickN = 0, listSig = '';
  const backoff = createBackoff({ base: pollMs, max: 120000, name: 'trip-poll' }); // a failing list call is retried less and less often
  const refused = new Map(); // trip id -> the server revision that could not be adopted (not fetched again until the revision changes)
  const timers = new Map();

  let lastSig = '';
  /** Tells the listeners, but only when something they can see has changed (a check that finds nothing new is silent, so the screen is not redrawn every few seconds). */
  const emit = () => {
    const s = snapshot();
    const sig = JSON.stringify([s.invitations, s.trips, s.error, s.notices]);
    if (sig === lastSig) return;
    lastSig = sig;
    listeners.forEach((fn) => fn(s));
  };
  /** liveActive: how many other members are sharing their location now, over all joined trips (null until a poll has said). Not part of the change signature: it is read by the live poll, not drawn. */
  const snapshot = () => ({ invitations: snap.invitations.slice(), trips: { ...snap.trips }, error: snap.error, polledAt: snap.polledAt, notices: snap.notices.slice(), liveActive: snap.liveActive, online: { ...snap.online } });
  const notice = (m) => { snap.notices.push(m); };
  const setStatus = (id, patch) => { snap.trips[id] = { ...(snap.trips[id] ?? {}), ...patch }; };
  const setBase = (id, rev, doc) => { bases[id] = { rev, doc }; persist(); };
  const dropBase = (id) => { delete bases[id]; persist(); };
  const mineDoc = (id) => { const t = store.getTrip(id); return t ? buildSharedDoc(t, store.items()) : null; };
  const applyLocally = (id, doc) => { applying = true; try { return store.applyShared(id, doc); } finally { applying = false; } };
  const link = (id, info) => { applying = true; try { store.setTripShared(id, info); } finally { applying = false; } };
  /** Runs one thing at a time (a poll, a save), in the order asked. */
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

  async function push(id, startRev) {
    let rev = startRev ?? bases[id]?.rev ?? null;
    for (let n = 0; n < 4; n++) {
      const doc = mineDoc(id);
      if (!doc) return;
      setStatus(id, { status: 'syncing' }); emit();
      const r = await api.save(id, doc, rev);
      if (r.status === 'ok') { setBase(id, r.rev, doc); setStatus(id, { status: 'synced', rev: r.rev, lastBy: r.updated_by_name, error: null }); return; }
      // someone saved first: fetch, merge, apply, and try again from their revision
      const theirs = await api.get(id);
      const merged = mergeDocs(bases[id]?.doc ?? null, doc, theirs.doc);
      if (!sameDoc(merged, doc)) applyLocally(id, merged);
      rev = theirs.rev;
      if (sameDoc(merged, theirs.doc)) { setBase(id, theirs.rev, theirs.doc); setStatus(id, { status: 'synced', rev: theirs.rev, lastBy: theirs.updated_by_name, error: null }); return; }
    }
    throw new Error('could not save the trip, will try again');
  }

  async function syncTrip(e) {
    const id = e.id;
    const info = { owner: e.role === 'owner', ownerName: e.role === 'owner' ? 'You' : e.owner_name };
    setStatus(id, { role: e.role, members_rev: e.members_rev, members: e.members });
    const local = store.getTrip(id);
    if (!local) { // a trip this person joined, not on this device yet
      if (refused.get(id) === e.rev) return;
      const g = await api.get(id);
      const r = (() => { applying = true; try { return store.adoptShared(g.doc, info); } finally { applying = false; } })();
      if (!r.ok) { refused.set(id, e.rev); setStatus(id, { status: 'error', error: r.reason === 'limit' ? 'You have the most trips this app holds.' : 'Could not add the trip.' }); return; }
      refused.delete(id);
      setBase(id, g.rev, g.doc); setStatus(id, { status: 'synced', rev: g.rev, lastBy: g.updated_by_name, error: null });
      return;
    }
    if (!local.shared || local.shared.owner !== info.owner || local.shared.ownerName !== info.ownerName) link(id, info);
    const base = bases[id];
    const mine = mineDoc(id);
    const dirty = !base || !sameDoc(mine, base.doc);
    if (base && base.rev === e.rev) {
      if (dirty) await push(id); else setStatus(id, { status: 'synced', rev: e.rev, error: null });
      return;
    }
    // the server has moved on, or this device has no record of the last sync
    const theirs = await api.get(id);
    const merged = dirty ? mergeDocs(base?.doc ?? null, mine, theirs.doc) : theirs.doc;
    if (!sameDoc(merged, mine)) {
      const d = describeChange(mine, merged);
      applyLocally(id, merged);
      if (base) setStatus(id, { lastChange: d });
    }
    if (sameDoc(merged, theirs.doc)) { setBase(id, theirs.rev, theirs.doc); setStatus(id, { status: 'synced', rev: theirs.rev, lastBy: theirs.updated_by_name, error: null }); }
    else await push(id, theirs.rev);
  }

  async function pollNow() {
    let list;
    try { list = await api.list(); } catch (e) { backoff.fail(e); snap.error = e.message; emit(); return; }
    backoff.ok();
    const sig = JSON.stringify(list.map((t) => [t.id, t.status, t.rev, t.members_rev, t.members, t.name, (t.live_active ?? 0) > 0]));
    quiet = sig === listSig && !snap.error ? quiet + 1 : 0; listSig = sig;
    snap.error = null; snap.polledAt = Date.now();
    snap.invitations = list.filter((t) => t.status === 'invited').map((t) => ({ id: t.id, name: t.name, ownerName: t.owner_name, startDate: t.start_date, endDate: t.end_date }));
    const joined = list.filter((t) => t.status === 'joined');
    snap.liveActive = joined.every((t) => Number.isFinite(t.live_active)) ? joined.reduce((n, t) => n + t.live_active, 0) : null; // null: the server does not say, so the live poll runs as before
    snap.online = Object.fromEntries(joined.map((t) => [t.id, Number.isFinite(t.online_others) ? t.online_others : 0])); // other members online now, per trip (read by autoshare.js; not part of the change signature)
    const ids = new Set(joined.map((t) => t.id));
    for (const e of joined) {
      try { await syncTrip(e); } catch (err) { setStatus(e.id, { status: 'error', error: err.message }); }
    }
    for (const t of store.trips()) { // shared here, but no longer on the server's list: it stays as a private copy
      if (t.shared && !ids.has(t.id)) {
        link(t.id, null); dropBase(t.id); delete snap.trips[t.id];
        notice(`"${t.name}" is no longer shared with you. It stays on this device as a private trip.`);
      }
    }
    for (const id of Object.keys(snap.trips)) if (!ids.has(id)) delete snap.trips[id];
    emit();
  }
  const poll = () => (stopped ? Promise.resolve() : serial(pollNow));
  /** One timer tick. Returns the poll's promise, or undefined when the tick is skipped (hidden or offline page, a poll still running, the wait after a failure, or the slower pace). */
  function tick() {
    if (!canPoll() || ticking || !backoff.ready()) return undefined;
    const every = quiet >= slowerAfter ? 3 : quiet >= slowAfter ? 2 : 1;
    if (++tickN % every) return undefined;
    ticking = true;
    return poll().finally(() => { ticking = false; });
  }

  function schedule(id) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      serial(async () => { try { await push(id); } catch (e) { setStatus(id, { status: 'error', error: e.message }); } emit(); });
    }, debounceMs));
  }
  store.onChange(() => {
    if (applying) return;
    quiet = 0; // something changed on this device
    for (const t of store.trips()) {
      const base = bases[t.id];
      if (!t.shared || !base) continue;
      const mine = mineDoc(t.id);
      if (mine && !sameDoc(mine, base.doc)) { setStatus(t.id, { status: 'pending' }); schedule(t.id); }
    }
    emit();
  });

  const call = async (fn) => { const r = await fn(); await poll(); return r; };
  return {
    snapshot,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Notices (a trip stopped being shared with this person ...) the interface has not shown yet; reading them clears them. */
    takeNotices: () => { const n = snap.notices; snap.notices = []; return n; },
    poll,
    start() { stopped = false; poll(); clearInterval(poller); poller = setInterval(tick, pollMs); },
    tick,
    /** Polls now and goes back to the normal pace (the page came back into view). */
    nudge() { quiet = 0; return poll(); },
    stop() { stopped = true; clearInterval(poller); for (const t of timers.values()) clearTimeout(t); timers.clear(); return chain; },

    /** Starts sharing one of this person's trips with friends (the trip becomes shared; nobody is invited yet). */
    async share(tripId) {
      const t = store.getTrip(tripId);
      if (!t) throw new Error('trip not found');
      const doc = buildSharedDoc(t, store.items());
      const r = await api.share(doc);
      link(tripId, { owner: true, ownerName: 'You' });
      setBase(tripId, r.rev, doc);
      await poll();
      return r;
    },
    invite: (tripId, friendshipId) => call(() => api.invite(tripId, friendshipId)),
    removeMember: (tripId, memberId) => call(() => api.removeMember(tripId, memberId)),
    /** Accepts or declines an invitation; accepting brings the trip onto this device. */
    respond: (tripId, accept) => call(() => api.respond(tripId, accept)),
    /** A party member leaves: the trip stays on this device as a private trip. */
    async leave(tripId) {
      await api.leave(tripId);
      link(tripId, null); dropBase(tripId); delete snap.trips[tripId]; emit();
      await poll();
    },
    /** The owner deletes the shared trip for everyone. This device keeps the trip as a private one (the caller may then delete it too). */
    async deleteShared(tripId) {
      await api.deleteTrip(tripId);
      link(tripId, null); dropBase(tripId); delete snap.trips[tripId]; emit();
      await poll();
    },
    members: (tripId) => api.members(tripId),
    invitable: (tripId) => api.invitable(tripId),
    /** Forgets what was last synced for every trip and stops treating any trip as shared (a different person signed in on this device). The trips and markers stay. */
    reset() { for (const t of store.trips()) if (t.shared) link(t.id, null); bases = {}; persist(); snap.trips = {}; snap.invitations = []; emit(); },
    versions: (tripId) => api.versions(tripId),
    /** Makes an earlier version the current one, for everyone; this device takes it on the next poll (done here). */
    restore: (tripId, rev) => call(() => api.restore(tripId, rev)),
    /** Saves this trip now instead of after the pause. */
    saveNow: (tripId) => { clearTimeout(timers.get(tripId)); timers.delete(tripId); return serial(async () => { try { await push(tripId); } catch (e) { setStatus(tripId, { status: 'error', error: e.message }); } emit(); }); },
  };
}
