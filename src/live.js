// Live locations of the party in a shared trip, and of friends: sending this device's position while the person is sharing it, and looking for the others'.
// No screen code here (see party-ui.js and livemap.js). The rules are in supabase/migrations/20261111160000_live_locations.sql.
//
//   - Sharing is per trip, plus one more scope for all friends (FRIENDS). This engine never resumes anything on its own; autoshare.js decides, under the
//     person's consent, when to start. It stops when the page closes, when the person signs out, leaves or is removed, when the trip ends (a day after its
//     end date), or when location permission is refused. A scope that stopped for one of those reasons is "halted": autoshare.js does not start it again
//     until the person starts it by hand.
//   - While sharing, the device's position is sent at most every 5 s, and only when it has moved 5 m or 15 s have passed since the last one.
//   - The others' positions are looked for every 5 s while the page is visible. A position the server no longer returns (older than 2 minutes) disappears.
//   - One device at a time: the page that most recently turned sharing on holds the position; an older one is told "moved" on its next send and stops (the
//     device id is added by the api, see sharedtrip/api.js).

import { createBackoff, canPoll } from './backoff.js';
import { log } from './log.js';

const MIN_MS = 5000, KEEP_MS = 15000, MOVE_M = 5, POLL_MS = 5000, FRIEND_POLL_MS = 10000, DAY = 86400000;
/** The scope id for sharing with all friends (trip ids are uuids, so it cannot clash). */
export const FRIENDS = 'friends';

/** Metres between two positions (good enough at the scale of a few metres to a few kilometres). */
export function meters(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Has a trip with this end date (YYYY-MM-DD) been over for more than a day? (The same rule as the server's, in UTC.) */
export const endedMoreThanADay = (endDate, nowMs) => /^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '') && Date.parse(endDate + 'T00:00:00Z') + 2 * DAY <= nowMs;

export function createLive({ api, geo = globalThis.navigator?.geolocation, getTrip = () => null, now = () => Date.now(), minMs = MIN_MS, keepMs = KEEP_MS, moveM = MOVE_M, pollMs = POLL_MS }) {
  const listeners = new Set();
  const trips = new Map(); // trip id -> { sentAt, sent, accuracy, status: 'waiting' | 'ok' | 'error', error, busy }
  let watch = null, last = null, partyOthers = [], friendOthers = [], error = null, timer = null, notices = [], lastSig = '', polling = null, lastFriendPoll = 0, denied = false;
  const halted = new Set(); // scopes that stopped for a reason the person did not choose (see the header)
  let wantFriends = () => false;
  const merged = () => [...partyOthers.map((o) => ({ ...o, relation: 'party' })), ...friendOthers.map((o) => ({ ...o, trip_id: null, relation: 'friend' }))];
  const pollWait = createBackoff({ base: pollMs, max: 60000, now, name: 'live-poll' }); // a failing poll is repeated less and less often

  const snapshot = () => ({
    sharing: Object.fromEntries([...trips].map(([id, t]) => [id, { status: t.status, accuracy: t.accuracy ?? null, error: t.error ?? null, at: t.sentAt ?? null }])),
    others: merged(), error, notices: notices.slice(),
  });
  const emit = () => {
    const s = snapshot();
    const sig = JSON.stringify([s.sharing, s.others, s.error, s.notices]);
    if (sig === lastSig) return;
    lastSig = sig; listeners.forEach((fn) => fn(s));
  };
  const note = (m) => { if (m) notices.push(m); };
  const quiet = (p) => Promise.resolve(p).catch((e) => { log.warn('live', 'a stop or clean-up call failed', e); /* best effort: the server forgets a position after 2 minutes anyway */ });

  function endWatch() { if (watch !== null && geo) geo.clearWatch(watch); watch = null; last = null; }

  const stopCall = (id) => (id === FRIENDS ? api.stopSharingFriends() : api.stopSharing(id));
  async function send(id) {
    const t = trips.get(id);
    if (!t || t.busy || !last) return;
    t.busy = true;
    const p = last;
    try {
      const end = id === FRIENDS ? null : getTrip(id)?.endDate;
      if (endedMoreThanADay(end, now())) { await stop(id, 'The trip has ended, so sharing your location stopped.'); return; }
      const r = id === FRIENDS ? await api.shareLocationFriends(p.lat, p.lon, p.accuracy, t.claim) : await api.shareLocation(id, p.lat, p.lon, p.accuracy, t.claim);
      if (!trips.has(id)) { await quiet(stopCall(id)); return; } // stopped while the position was on its way
      if (r?.status === 'moved') { // another device of this account started sharing in this trip after this one: it holds the position now
        trips.delete(id); halted.add(id); if (!trips.size) endWatch();
        note('Sharing moved to your other device, so this one stopped.');
        return;
      }
      t.claim = false; // the first position took the trip over from any other device; the ones after it only update
      if (r?.status === 'ended') { halted.add(id); await stop(id, 'The trip has ended, so sharing your location stopped.'); return; }
      if (r?.status === 'nofriends') { halted.add(id); await stop(id, 'You have no friends to share with, so sharing stopped.'); return; }
      t.sentAt = now(); t.sent = { lat: p.lat, lon: p.lon }; t.accuracy = p.accuracy; t.status = 'ok'; t.error = null; t.retry.ok();
    } catch (e) {
      if (/trip not found/.test(e.message)) { halted.add(id); await stop(id, 'You are no longer in this trip, so sharing your location stopped.'); return; }
      t.status = 'error'; t.error = e.message; t.retry.fail(e); // the next position is sent after a wait that grows with each failure
    } finally { t.busy = false; emit(); }
  }

  function onPosition(pos) {
    const c = pos.coords;
    last = { lat: c.latitude, lon: c.longitude, accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null, t: now() };
    for (const [id, t] of trips) {
      if (!t.retry.ready()) { t.accuracy = last.accuracy; continue; }
      const idle = t.sentAt === undefined ? Infinity : now() - t.sentAt;
      const moved = t.sent ? meters(t.sent.lat, t.sent.lon, last.lat, last.lon) : Infinity;
      if (t.sentAt === undefined || (idle >= minMs && (moved >= moveM || idle >= keepMs))) send(id);
      else t.accuracy = last.accuracy;
    }
    emit();
  }
  function onError(err) {
    if (err?.code === 1) { denied = true; stopAll('Location permission was refused, so sharing stopped. Allow location for this site to share.'); return; }
    for (const t of trips.values()) if (t.status !== 'ok') { t.status = 'waiting'; t.error = 'Waiting for a position…'; }
    emit();
  }

  async function stop(id, message) {
    if (!trips.delete(id)) return;
    if (!trips.size) endWatch();
    note(message);
    await quiet(stopCall(id));
    emit();
  }
  async function stopAll(message) {
    if (!trips.size && watch === null) return;
    trips.clear(); endWatch();
    note(message);
    await quiet(api.stopAll());
    emit();
  }

  /** One look for the others' positions. A call while one is already on its way gets that one's answer. */
  function poll({ party = true, friends = true } = {}) {
    if (polling) return polling;
    polling = (async () => {
      const doFriends = friends && !!api.friendLive && wantFriends();
      const [a, b] = await Promise.allSettled([party ? api.live() : Promise.resolve(partyOthers), doFriends ? api.friendLive() : Promise.resolve(null)]);
      error = null;
      if (a.status === 'fulfilled') partyOthers = a.value; else error = a.reason?.message ?? String(a.reason);
      if (doFriends) { lastFriendPoll = now(); if (b.status === 'fulfilled') friendOthers = b.value ?? []; else error = error ?? (b.reason?.message ?? String(b.reason)); }
      else if (friends && friendOthers.length) friendOthers = [];
      if (error) pollWait.fail(new Error(error)); else pollWait.ok();
      emit();
    })().finally(() => { polling = null; });
    return polling;
  }

  return {
    snapshot,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    takeNotices: () => { const n = notices; notices = []; lastSig = ''; return n; },
    isSharing: (id) => trips.has(id),
    /** Did this scope stop for a reason the person did not choose (moved to another device, trip ended, left, no friends)? Cleared when they start it by hand. */
    isHalted: (id) => halted.has(id),
    /** Was location permission refused (cleared when the person starts sharing by hand)? */
    isDenied: () => denied,
    sharingIds: () => [...trips.keys()],
    /** Starts sharing in a trip, or with friends (id FRIENDS); the first position is sent as soon as there is one. Returns { ok } or { ok: false, reason }.
     *  `auto`: started by autoshare.js, which must not override a halt or a refusal; a start by hand clears both. */
    start(id, { auto = false } = {}) {
      if (!geo) return { ok: false, reason: 'This browser cannot give a position.' };
      if (trips.has(id)) return { ok: true };
      if (auto && (halted.has(id) || denied)) return { ok: false, reason: 'halted' };
      halted.delete(id); denied = false;
      trips.set(id, { status: 'waiting', claim: true, retry: createBackoff({ base: minMs, max: 60000, now, name: 'live-send' }) });
      if (watch === null) watch = geo.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      else if (last) send(id);
      emit();
      return { ok: true };
    },
    stop, stopAll, poll,
    /** Looks for the others' positions every few seconds while `wanted()` (someone in the party is sharing) and the page is visible. */
    // `wantedFriends()`: some friend is online, so one may be sharing; friends' positions are then looked for every 10 s.
    startPolling(wanted = () => true, wantedFriends = () => false) {
      clearInterval(timer);
      wantFriends = wantedFriends;
      timer = setInterval(() => {
        const wp = wanted(), wf = !!api.friendLive && wantFriends();
        if (!wp && partyOthers.length) { partyOthers = []; emit(); } // nobody is sharing any more: their pins go
        if (!wf && friendOthers.length) { friendOthers = []; emit(); }
        if ((wp || wf) && canPoll() && pollWait.ready()) poll({ party: wp, friends: wf && now() - lastFriendPoll >= FRIEND_POLL_MS });
      }, pollMs);
    },
    stopPolling() { clearInterval(timer); timer = null; partyOthers = []; friendOthers = []; emit(); },
  };
}
