// Live locations of the party in a shared trip: sending this device's position while the person has chosen to share it, and looking for the others'.
// No screen code here (see party-ui.js and livemap.js). The rules are in supabase/migrations/20261111160000_live_locations.sql.
//
//   - Sharing is a switch per trip and is OFF every time the app is opened: it is never resumed on its own. It stops by itself when the page closes, when the
//     person signs out, leaves or is removed, when the trip ends (a day after its end date), or when location permission is refused.
//   - While sharing, the device's position is sent at most every 5 s, and only when it has moved 5 m or 15 s have passed since the last one.
//   - The others' positions are looked for every 5 s while the page is visible. A position the server no longer returns (older than 2 minutes) disappears.
//   - One device at a time: the page that most recently turned sharing on holds the position; an older one is told "moved" on its next send and stops (the
//     device id is added by the api, see sharedtrip/api.js).

import { createBackoff, canPoll } from './backoff.js';

const MIN_MS = 5000, KEEP_MS = 15000, MOVE_M = 5, POLL_MS = 5000, DAY = 86400000;

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
  let watch = null, last = null, others = [], error = null, timer = null, notices = [], lastSig = '', polling = null;
  const pollWait = createBackoff({ base: pollMs, max: 60000, now }); // a failing poll is repeated less and less often

  const snapshot = () => ({
    sharing: Object.fromEntries([...trips].map(([id, t]) => [id, { status: t.status, accuracy: t.accuracy ?? null, error: t.error ?? null, at: t.sentAt ?? null }])),
    others: others.slice(), error, notices: notices.slice(),
  });
  const emit = () => {
    const s = snapshot();
    const sig = JSON.stringify([s.sharing, s.others, s.error, s.notices]);
    if (sig === lastSig) return;
    lastSig = sig; listeners.forEach((fn) => fn(s));
  };
  const note = (m) => { if (m) notices.push(m); };
  const quiet = (p) => Promise.resolve(p).catch(() => { /* best effort: the server forgets a position after 2 minutes anyway */ });

  function endWatch() { if (watch !== null && geo) geo.clearWatch(watch); watch = null; last = null; }

  async function send(id) {
    const t = trips.get(id);
    if (!t || t.busy || !last) return;
    t.busy = true;
    const p = last;
    try {
      const end = getTrip(id)?.endDate;
      if (endedMoreThanADay(end, now())) { await stop(id, 'The trip has ended, so sharing your location stopped.'); return; }
      const r = await api.shareLocation(id, p.lat, p.lon, p.accuracy, t.claim);
      if (!trips.has(id)) { await quiet(api.stopSharing(id)); return; } // stopped while the position was on its way
      if (r?.status === 'moved') { // another device of this account started sharing in this trip after this one: it holds the position now
        trips.delete(id); if (!trips.size) endWatch();
        note('Sharing moved to your other device, so this one stopped.');
        return;
      }
      t.claim = false; // the first position took the trip over from any other device; the ones after it only update
      if (r?.status === 'ended') { await stop(id, 'The trip has ended, so sharing your location stopped.'); return; }
      t.sentAt = now(); t.sent = { lat: p.lat, lon: p.lon }; t.accuracy = p.accuracy; t.status = 'ok'; t.error = null; t.retry.ok();
    } catch (e) {
      if (/trip not found/.test(e.message)) { await stop(id, 'You are no longer in this trip, so sharing your location stopped.'); return; }
      t.status = 'error'; t.error = e.message; t.retry.fail(); // the next position is sent after a wait that grows with each failure
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
    if (err?.code === 1) { stopAll('Location permission was refused, so sharing stopped. Allow location for this site to share.'); return; }
    for (const t of trips.values()) if (t.status !== 'ok') { t.status = 'waiting'; t.error = 'Waiting for a position…'; }
    emit();
  }

  async function stop(id, message) {
    if (!trips.delete(id)) return;
    if (!trips.size) endWatch();
    note(message);
    await quiet(api.stopSharing(id));
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
  function poll() {
    if (polling) return polling;
    polling = (async () => {
      try { others = await api.live(); error = null; pollWait.ok(); } catch (e) { error = e.message; pollWait.fail(); }
      emit();
    })().finally(() => { polling = null; });
    return polling;
  }

  return {
    snapshot,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    takeNotices: () => { const n = notices; notices = []; lastSig = ''; return n; },
    isSharing: (id) => trips.has(id),
    sharingIds: () => [...trips.keys()],
    /** Starts sharing in a trip (the first position is sent as soon as there is one). Returns { ok } or { ok: false, reason }. */
    start(id) {
      if (!geo) return { ok: false, reason: 'This browser cannot give a position.' };
      if (trips.has(id)) return { ok: true };
      trips.set(id, { status: 'waiting', claim: true, retry: createBackoff({ base: minMs, max: 60000, now }) });
      if (watch === null) watch = geo.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      else if (last) send(id);
      emit();
      return { ok: true };
    },
    stop, stopAll, poll,
    /** Looks for the others' positions every few seconds while `wanted()` (someone in the party is sharing) and the page is visible. */
    startPolling(wanted = () => true) {
      clearInterval(timer);
      timer = setInterval(() => {
        if (!wanted()) { if (others.length) { others = []; emit(); } return; } // nobody is sharing any more: their pins go
        if (canPoll() && pollWait.ready()) poll();
      }, pollMs);
    },
    stopPolling() { clearInterval(timer); timer = null; others = []; emit(); },
  };
}
