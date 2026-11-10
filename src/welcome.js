// The welcome screen: a short guide to the app and, when a trip is coming up or under way, a countdown to it.
// It appears on every visit until the visitor chooses "Don't show again"; "How it works" in Map Configs reopens it any time.
import { comingTrips, countdownLabel, tripSummary, todayISO } from './trips.js';

const KEY = 'uavzones.v1.welcome';
const $ = (id) => document.getElementById(id);

function loadShow() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && typeof d.show === 'boolean' ? d.show : true; } catch { return true; }
}
function saveShow(show) { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, show })); } catch { /* storage blocked: it simply shows again next time */ } }

export function initWelcome({ poi, panel }) {
  const dlg = $('welcome'), tripBox = $('welcome-trip');
  let show = loadShow();

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function renderTrip() {
    tripBox.replaceChildren();
    const coming = comingTrips(poi.store.trips(), todayISO());
    tripBox.hidden = coming.length === 0;
    if (!coming.length) return;
    const { trip, status } = coming[0];
    const head = el('div', 'w-trip-head');
    const dot = el('i', 'trip-dot-sm'); dot.style.background = trip.color;
    head.append(dot, el('b', '', trip.name));
    tripBox.append(el('div', 'w-count', countdownLabel(status)), head);
    const sum = tripSummary(trip);
    if (sum) tripBox.append(el('div', 'w-trip-sub', sum));
    const row = el('div', 'btn-row');
    const openTrip = el('button', 'btn primary small', 'Open trip'); openTrip.type = 'button';
    openTrip.addEventListener('click', () => { close(); panel.closeIfPhone(); poi.fitTrip(trip.id); });
    row.append(openTrip);
    if (coming.length > 1) {
      const more = el('button', 'btn small', `+${coming.length - 1} more trip${coming.length === 2 ? '' : 's'}`); more.type = 'button';
      more.addEventListener('click', () => { close(); panel.open('trips'); });
      row.append(more);
    }
    tripBox.append(row);
  }
  function renderChoice() {
    $('welcome-dont').hidden = !show;
    $('welcome-again').hidden = show;
  }

  function open() {
    renderTrip(); renderChoice();
    if (!dlg.open) dlg.showModal();
    $('welcome-go').focus({ preventScroll: true });
  }
  function close() { if (dlg.open) dlg.close(); }

  $('welcome-go').addEventListener('click', close);
  $('welcome-dont').addEventListener('click', () => { show = false; saveShow(false); close(); });
  $('welcome-again').addEventListener('click', () => { show = true; saveShow(true); renderChoice(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // a click on the dimmed backdrop
  $('help-open').addEventListener('click', open);

  return {
    /** Shows the screen if the visitor has not opted out. `skip`: something else has their attention (a share link). */
    maybeShow({ skip = false } = {}) { if (show && !skip) open(); },
    open,
  };
}
