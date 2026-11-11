// Check-in in the panel: the position watcher (opt-in, only while the panel shows markers) and the little control at the right of a marker row.
// The position never leaves the browser. See privacy.js (checkIn) and checkin.js for the rules.
import { getPrivacy, onPrivacyChange } from './privacy.js';
import { checkinState, checkinTitle, checkinLabel } from './checkin.js';
import { getDistanceSettings } from './units.js';
import { fmtDistance } from './distance.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function createCheckin({ store, panel, toast }) {
  let fix = null, watchId = null, status = 'off'; // off | waiting | ready | denied | unavailable
  const subs = new Set();
  const bound = new Map(); // namespace -> Set of refresh functions of the cells now on screen
  const emit = () => { for (const fn of subs) { try { fn(); } catch (e) { console.error(e); } } for (const set of bound.values()) for (const fn of set) fn(); };

  const enabled = () => !!getPrivacy().checkIn;
  const extra = []; // other screens that show check-in buttons (the dashboard)
  const panelShows = () => panel.isOpen() && !panel.isRolled() && ['poi', 'trips'].includes(panel.getTab());
  const wanted = () => enabled() && status !== 'denied' && status !== 'unavailable' && !document.hidden && (panelShows() || extra.some((fn) => fn()));

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    fix = null;
    if (status === 'waiting' || status === 'ready') status = 'off';
  }
  function start() {
    if (!navigator.geolocation) { status = 'unavailable'; return; }
    status = 'waiting';
    watchId = navigator.geolocation.watchPosition(
      (pos) => { fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, t: pos.timestamp }; status = 'ready'; emit(); },
      (err) => {
        if (err.code === 1) { stop(); status = 'denied'; toast?.('Location is blocked for this page, so check-in cannot work. Allow it in the browser settings.', 7000); emit(); }
        // a timeout or a lost signal: keep the last position and keep trying
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
  }
  function sync() {
    const want = wanted();
    if (want && watchId === null) start();
    else if (!want && watchId !== null) stop();
    emit();
  }
  onPrivacyChange(() => { if (status === 'denied' || status === 'unavailable') status = 'off'; sync(); });
  document.addEventListener('visibilitychange', sync);
  panel.onChange?.(sync);
  sync();

  return {
    enabled,
    /** What this position says about a marker, with the watcher's status. */
    state: (item) => ({ ...checkinState(fix, item), status }),
    /** Saves a check-in on the marker if the position allows it. Returns true if it did. */
    record(id) {
      const item = store.get(id);
      if (!item || item.type === 'residence' || !fix) return false;
      if (!checkinState(fix, item).can) return false;
      return !!store.update(id, { checkin: { at: new Date().toISOString(), lat: fix.lat, lon: fix.lon, acc: Math.round(fix.accuracy) } }).item;
    },
    clear(id) { return !!store.update(id, { checkin: null }).item; },
    onChange(fn) { subs.add(fn); },
    /** Another screen that shows check-in buttons says when it is on show (fn returns true), and calls sync() when that changes. */
    also(fn) { extra.push(fn); },
    sync,
    /** Cells register to be refreshed on every new position; a screen unbinds its namespace before it redraws. */
    bind(ns, fn) { if (!bound.has(ns)) bound.set(ns, new Set()); bound.get(ns).add(fn); },
    unbind(ns) { bound.delete(ns); },
  };
}

/**
 * The control for one marker, to sit at the right of its row: "Check in" (disabled until you are close), or what was recorded and a small
 * button to clear it. Returns null when there is nothing to show (check-in is off and the marker has no check-in, or it is the Home marker).
 */
export function checkinCell({ cin, store, id, ns }) {
  const first = store.get(id);
  if (!first || first.type === 'residence' || (!cin.enabled() && !first.checkin)) return null;
  const wrap = el('span', 'checkin');
  let shape = null, btn = null;
  const paint = () => {
    const it = store.get(id);
    if (!it) return;
    const units = getDistanceSettings().units;
    if (it.checkin) {
      if (shape !== 'done:' + it.checkin.at) {
        shape = 'done:' + it.checkin.at;
        wrap.replaceChildren();
        const done = el('span', 'checkin-done', '✓ ' + checkinLabel(it.checkin));
        if (Date.now() - Date.parse(it.checkin.at) < 3000) done.classList.add('pop'); // just recorded: a short pop
        const from = it.checkin.acc !== undefined ? ` (GPS accuracy about ${fmtDistance(it.checkin.acc, units)})` : '';
        done.title = `Checked in ${checkinLabel(it.checkin)} at ${it.checkin.lat.toFixed(5)}, ${it.checkin.lon.toFixed(5)}${from}`;
        const clear = el('button', 'icon-btn checkin-clear', '✕'); clear.type = 'button';
        clear.setAttribute('aria-label', 'Clear the check-in of ' + it.name); clear.title = 'Clear this check-in';
        let armed = null;
        clear.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!armed) { clear.textContent = 'Clear?'; clear.classList.add('armed'); armed = setTimeout(() => { clear.textContent = '✕'; clear.classList.remove('armed'); armed = null; }, 4000); return; }
          clearTimeout(armed); cin.clear(id);
        });
        wrap.append(done, clear);
        btn = null;
      }
      return;
    }
    const st = cin.state(it);
    if (shape !== 'button') {
      shape = 'button';
      wrap.replaceChildren();
      btn = el('button', 'btn small checkin-btn', 'Check in'); btn.type = 'button';
      btn.addEventListener('click', (e) => { e.stopPropagation(); cin.record(id); });
      wrap.append(btn);
    }
    btn.disabled = !st.can;
    btn.title = checkinTitle(st, units, st.status);
  };
  paint();
  cin.bind(ns, paint);
  return wrap;
}
