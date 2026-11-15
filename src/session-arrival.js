// Automatic attendance, the app side (backlog FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG, wave D). One shared foreground position sampler: while the page is visible, the person has
// consented, the database switch is on and a session they joined is under way, it reads the position every 30 to 60 s (getCurrentPosition, so no new watcher beside locate.js, checkin-ui.js
// and live.js) and sends it to submit_session_arrival. The server measures the distance, keeps no coordinates and decides; this file only asks and tells the truth about the answer.
// It stops by itself after an award, on sign-out, on opt-out, when the tab is hidden, when permission is denied and when no session is under way. No background tracking, no push.

/** Sessions the sampler may report for: joined, not hosted by the person, still scheduled, under way now, with a meeting point, not already attended. */
export function eligibleSessions(list, now = Date.now(), skip = new Set()) {
  return list.filter((s) => s && s.status === 'scheduled' && s.iRsvped && !s.isHost && !s.myAttended && !skip.has(s.id)
    && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Date.parse(s.startsAt) <= now && now <= Date.parse(s.endsAt));
}

/** The start time (ms) of the soonest joined session that has not begun, or null. */
export function nextStart(list, now = Date.now(), skip = new Set()) {
  let min = null;
  for (const s of list) { if (!s || s.status !== 'scheduled' || !s.iRsvped || s.isHost || s.myAttended || skip.has(s.id) || !Number.isFinite(s.lat)) continue; const st = Date.parse(s.startsAt); if (st > now && (min === null || st < min)) min = st; }
  return min;
}

/** What the screen says for each answer (or condition). Nothing here claims an award that the server did not confirm. */
export const ARRIVAL_TEXT = {
  checking: 'Checking attendance. Keep this page open.',
  tracking: 'Checking attendance. Keep this page open at the meeting point.',
  waiting: 'You are at the meeting point. Attendance is confirmed once enough other people are there too.',
  too_far: 'Not at the meeting point yet.',
  poor_accuracy: 'The location signal is too weak here to check attendance.',
  awarded: 'Attendance confirmed.',
  attended: 'Attendance recorded.',
  already_attended: 'Attendance already recorded.',
  capped: 'Automatic check-in limit reached for now. An organiser can still confirm you.',
  not_eligible: 'Automatic check-in is not available for this session.',
  revoked: 'This attendance was revoked by an administrator.',
  denied: 'Location permission is off, so automatic check-in cannot run. Manual verification still works.',
  unavailable: 'Automatic check-in is unavailable right now. Manual verification remains possible.',
  idle: '',
};
/** Answers after which the sampler does not ask again for that session. */
const FINAL = new Set(['awarded', 'attended', 'already_attended', 'capped', 'not_eligible', 'revoked']);

/** The toast line: only for an award the server confirmed with XP above 0. */
export const awardToast = (r) => (r && r.status === 'awarded' && Number.isFinite(r.xp) && r.xp > 0 ? `Attendance confirmed: +${r.xp} XP earned.` : null);

/** The delay to the next sample: the server's spacing plus a margin, kept within 30 to 60 seconds. */
export const sampleDelay = (spacingS) => Math.min(60000, Math.max(30000, ((Number.isFinite(spacingS) ? spacingS : 30) + 5) * 1000));

const defaultPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(Object.assign(new Error('no geolocation'), { code: 2 })); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
});

/**
 * `api` has arrivalConfig(), recordConsent(), withdrawConsent(), submitArrival(id, lat, lng, accuracy); `candidates()` returns the person's sessions; `signedIn()`;
 * `pref()` / `setPref(bool)` the local switch; `toast(text)`. Everything else can be injected for tests (`position`, `now`, `visible`, timers).
 */
export function createArrival({ api, candidates, signedIn, pref, setPref, toast, position = defaultPosition, now = Date.now, visible = () => !document.hidden, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let cfg = null, timer = null, busy = false, state = { status: 'idle', sessionId: null, text: '' };
  const done = new Set(), listeners = new Set();
  const set = (status, sessionId = null) => { state = { status, sessionId, text: ARRIVAL_TEXT[status] ?? '' }; for (const fn of listeners) { try { fn(state); } catch { /* a listener must not stop the sampler */ } } };
  const live = () => signedIn() && pref() === true && cfg?.enabled === true && cfg?.consented === true;
  const due = () => (live() && visible() ? eligibleSessions(candidates(), now(), done) : []);

  function stop() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function schedule(delay) {
    stop();
    if (!due().length) {
      if (state.status !== 'denied' && state.status !== 'idle' && !FINAL.has(state.status)) set('idle'); // a final answer stays on screen
      const next = live() && visible() ? nextStart(candidates(), now(), done) : null; // wake up when the next joined session begins
      if (next !== null) timer = setTimer(() => { timer = null; schedule(500); }, Math.min(Math.max(next - now() + 1000, 1000), 6 * 3600e3));
      return;
    }
    timer = setTimer(() => { timer = null; tick(); }, delay ?? sampleDelay(cfg?.spacing_s));
  }
  async function refreshConfig() {
    if (!signedIn()) { cfg = null; return null; }
    try { cfg = await api.arrivalConfig(); } catch { cfg = null; }
    set(state.status, state.sessionId); // tell the screens the switch or the consent may have changed
    return cfg;
  }
  async function tick() {
    if (busy) return;
    const list = due(); if (!list.length) { schedule(); return; }
    busy = true; set('checking', list[0].id);
    try {
      const pos = await position();
      for (const s of eligibleSessions(candidates(), now(), done)) {
        if (!live() || !visible()) break;
        const r = await api.submitArrival(s.id, pos.lat, pos.lng, pos.accuracy);
        set(r.status, s.id);
        const t = awardToast(r); if (t) toast(t);
        if (FINAL.has(r.status)) done.add(s.id);
        if (r.status === 'unavailable' || r.status === 'no_consent') { await refreshConfig(); break; }
      }
    } catch (e) {
      if (e && e.code === 1) { set('denied'); done.clear(); busy = false; stop(); return; } // permission refused: stop until the person acts again
      set('unavailable');
    }
    busy = false; schedule();
  }

  return {
    state: () => state,
    onState(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    config: () => cfg,
    loadConfig: refreshConfig,
    /** Re-read the database switch and the consent, then (re)start. Call on sign-in, on opening the hub and after a list load. */
    async refresh() { await refreshConfig(); schedule(1500); },
    /** The list of sessions changed, the tab came back, or a switch changed: look again without asking the server. */
    kick() { if (timer === null && !busy) schedule(1500); else if (!due().length) schedule(); },
    /** The person turned automatic attendance on: the server records the consent first, then the switch. */
    async enable() { await api.recordConsent(); setPref(true); done.clear(); await refreshConfig(); schedule(1500); },
    /** Off: the server forgets the consent and the samples, then everything stops. */
    async disable() { stop(); await api.withdrawConsent(); setPref(false); done.clear(); set('idle'); await refreshConfig(); },
    /** Sign-out: forget everything. */
    reset() { stop(); cfg = null; done.clear(); busy = false; set('idle'); },
    tick,
  };
}
