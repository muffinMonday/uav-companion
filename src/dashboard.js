// The dashboard: a drawer along the bottom of the map with What's new, the next trip (and today's stops while it is under way), a backup
// reminder, buttons for the regions the map covers and a short guide. It never blocks the map. Three states: expanded, the one-line
// peek strip (V), and hidden behind a small ^ tab (close). How it starts is decided in dashstate.js.
import { comingTrips, countdownLabel, tripSummary, todayISO, tripLength, tripStatus, planDays, tripWarnings } from './trips.js';
import { WHATS_NEW } from './whatsnew.js';
import { load, save, unseenEntries, startState, backupDue } from './dashstate.js';
import { routeLinks } from './maplinks-ui.js';
import { MODES, MAX_STOPS } from './maplinks.js';
import { typeOf } from './poi.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

export function initDashboard({ poi, panel, trips, shared = false }) {
  const dash = $('dash'), body = $('dash-body'), peek = $('dash-peek'), tab = $('dash-tab');
  const store = poi.store;
  const saved = load();
  const firstRun = !saved.welcomed && store.items().length === 0 && store.trips().length === 0;
  let fresh = unseenEntries(WHATS_NEW, saved.seen);   // entries to show until the visitor has seen them
  let state = null;
  let guideOpen = firstRun;
  let tripFade = false;                              // the trip card eases in after ‹ or ›
  let tripIx = 0;                                    // which of the coming trips the trip card shows
  let regions = { countries: [], goTo: null };

  // ---------- the cards ----------
  function welcomeLine() {
    const c = el('div', 'dash-welcome');
    const first = firstRun && !store.items().length && !store.trips().length;
    if (first) c.append(el('b', '', 'Welcome to UAV Companion.'), ' Check where you can fly a drone and plan your trip.');
    else {
      const coming = comingTrips(store.trips(), todayISO());
      c.append(el('b', '', 'Welcome back.'), ' ' + (coming.length ? coming[0].trip.name + ': ' + countdownLabel(coming[0].status).toLowerCase() + '.' : 'Where to next?'));
    }
    c.append(el('small', '', 'A planning aid, not flight advice.'));
    return c;
  }
  /** The route through the places ticked in Select mode: reorder, reverse, travel mode and the links. Shown only while selecting. */
  function routeCard() {
    const rs = poi.route.state();
    if (!rs.selecting) return null;
    const c = el('section', 'dash-card dash-route'); c.id = 'route-box';
    c.append(el('h3', '', rs.stops.length ? 'Route · ' + rs.stops.length + ' stop' + (rs.stops.length === 1 ? '' : 's') : 'Route'));
    if (rs.stops.length < 2) { c.append(el('p', 'hint', 'Tap pins on the map, or rows in the list, to add stops. Two or more make a route in Google Maps or Amap.')); return c; }
    const list = el('ol', 'route-stops'); list.id = 'route-stops';
    const tool = (text, label, fn, disabled) => { const b = el('button', 'icon-btn route-btn', text); b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = disabled; b.addEventListener('click', fn); return b; };
    rs.stops.forEach((it, i) => {
      const li = el('li', 'route-stop');
      li.append(el('span', 'route-name', it.name), el('small', '', typeOf(it.type).label),
        tool('↑', 'Move ' + it.name + ' earlier', () => poi.route.move(it.id, -1), i === 0),
        tool('↓', 'Move ' + it.name + ' later', () => poi.route.move(it.id, 1), i === rs.stops.length - 1),
        tool('✕', 'Remove ' + it.name + ' from the route', () => poi.route.remove(it.id), false));
      list.append(li);
    });
    c.append(list);
    const row = el('div', 'btn-row');
    const rev = el('button', 'btn small', 'Reverse'); rev.type = 'button'; rev.id = 'route-reverse'; rev.addEventListener('click', () => poi.route.reverse());
    const sort = el('button', 'btn small', 'Use itinerary order'); sort.type = 'button'; sort.id = 'route-sort'; sort.disabled = !rs.canSort; sort.addEventListener('click', () => poi.route.sort());
    row.append(rev, sort); c.append(row);
    const field = el('label', 'field'); field.append(el('span', '', 'Travel by'));
    const sel = el('select'); sel.id = 'route-mode';
    for (const m of MODES) { const o = el('option', '', m.label); o.value = m.id; sel.append(o); }
    sel.value = rs.mode; sel.addEventListener('change', () => poi.route.setMode(sel.value));
    field.append(sel); c.append(field);
    const links = el('div'); links.id = 'route-links';
    if (rs.stops.length > MAX_STOPS) links.append(el('small', 'route-note', 'That is a lot of stops. Tick ' + MAX_STOPS + ' places or fewer.'));
    else links.append(...routeLinks({ stops: rs.stops.map((s) => ({ lat: s.lat, lon: s.lon, name: s.name })), mode: rs.mode, home: rs.stops.some((s) => s.type === 'residence') }));
    c.append(links);
    return c;
  }
  function whatsNewCard() {
    if (!fresh.length) return null;
    const c = el('section', 'dash-card dash-new');
    c.append(el('h3', '', 'What’s new'));
    for (const e of fresh) {
      const box = el('div', 'dash-entry');
      box.append(el('b', '', e.title));
      const ul = el('ul');
      for (const t of e.items) ul.append(el('li', '', t));
      box.append(ul);
      c.append(box);
    }
    return c;
  }
  function tripCard() {
    const today = todayISO();
    const coming = comingTrips(store.trips(), today);
    const c = el('section', 'dash-card dash-trip');
    if (tripFade) { c.classList.add('swap'); tripFade = false; }
    if (!coming.length) {
      if (store.items().length || store.trips().length) return null;
      c.append(el('h3', '', 'Get started'), el('p', 'hint', 'Create a trip, then drop markers for hotels, takeoff spots and photo spots. Or place a marker straight away.'));
      const row = el('div', 'btn-row');
      const mk = (text, fn, cls) => { const b = el('button', 'btn small ' + cls, text); b.type = 'button'; b.addEventListener('click', fn); row.append(b); };
      mk('Create your first trip', () => { panel.open('trips'); $('trip-new').click(); }, 'primary');
      mk('Place a marker', () => panel.open('poi'), '');
      c.append(row);
      return c;
    }
    tripIx = Math.max(0, Math.min(tripIx, coming.length - 1));
    const { trip, status } = coming[tripIx];
    if (coming.length > 1) { // ‹ 2 of 3 › moves through the trips
      const nav = el('div', 'dash-trip-nav');
      const arrow = (label, path, to) => { const b = el('button', 'btn tool'); b.type = 'button'; b.title = label; b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; b.append(el('span', 'tool-label', label)); b.disabled = to < 0 || to >= coming.length; b.addEventListener('click', () => { tripIx = to; tripFade = true; render(); }); return b; };
      nav.append(arrow('Previous trip', 'M15 6l-6 6 6 6', tripIx - 1), el('span', '', (tripIx + 1) + ' of ' + coming.length), arrow('Next trip', 'M9 6l6 6-6 6', tripIx + 1));
      c.append(nav);
    }
    const head = el('div', 'dash-trip-head');
    const dot = el('i', 'trip-dot-sm'); dot.style.background = trip.color;
    head.append(dot, el('b', '', trip.name), el('span', 'dash-count', countdownLabel(status)));
    c.append(head);
    const sum = tripSummary(trip);
    if (sum) c.append(el('div', 'dash-sub', sum));
    const facts = [];
    if (tripLength(trip)) {
      const w = tripWarnings(store.items(), trip);
      const n = w.undated + w.outside + w.noHotel.length;
      if (n) facts.push('⚠ ' + n + ' to check');
    }
    if (trip.checklist?.length) facts.push(trip.checklist.filter((x) => x.done).length + ' of ' + trip.checklist.length + ' checked');
    if (facts.length) c.append(el('div', 'dash-sub', facts.join(' · ')));
    if (status.state === 'now' && tripLength(trip)) { // under way: today's stops
      const day = planDays(store.items(), trip).days[status.day - 1];
      if (day?.stops.length) {
        const list = el('div', 'dash-today');
        list.append(el('small', '', 'Today'));
        for (const s of day.stops) {
          const b = el('button', 'dash-stop'); b.type = 'button';
          b.append(el('span', 'plan-n', s.order !== undefined ? String(s.order) : '•'), el('span', '', s.name));
          b.addEventListener('click', () => { if (isPhone()) setState('peek'); poi.openMarker(s.id); }); // on a phone the map needs the room
          list.append(b);
        }
        c.append(list);
      }
    }
    const row = el('div', 'btn-row');
    const open = el('button', 'btn small primary', 'Open trip'); open.type = 'button';
    open.addEventListener('click', () => trips.openDetail(trip.id));
    row.append(open);
    c.append(row);
    return c;
  }
  function backupCard() {
    const due = backupDue(store.lastBackup(), store.items().length);
    if (!due) return null;
    const c = el('section', 'dash-card');
    c.append(el('h3', '', 'Back up your markers'), el('p', 'hint', due.never
      ? 'They are saved only in this browser, and you have not exported a backup yet.'
      : 'They are saved only in this browser. Your last backup was ' + due.days + ' days ago.'));
    const b = el('button', 'btn small', 'Export now'); b.type = 'button';
    b.addEventListener('click', () => { $('poi-export').click(); setTimeout(render, 300); });
    c.append(b);
    return c;
  }
  function regionsCard() {
    if (!regions.countries.length) return null;
    const c = el('section', 'dash-card');
    c.append(el('h3', '', 'Fly in'));
    const row = el('div', 'btn-row');
    for (const k of regions.countries) {
      const b = el('button', 'btn small', k.name); b.type = 'button';
      b.addEventListener('click', () => { regions.goTo?.(k.id); panel.closeIfPhone(); if (isPhone()) setState('peek'); });
      row.append(b);
    }
    c.append(row);
    return c;
  }
  function guideCard() {
    const d = el('details', 'dash-guide'); d.open = guideOpen;
    d.addEventListener('toggle', () => { guideOpen = d.open; });
    d.append(el('summary', '', 'How it works'));
    const ol = el('ol', 'w-steps');
    for (const t of [
      ['Check a spot.', 'Press and hold on the map for 2 seconds (or right-click) to see whether you can fly there. Search takes places and coordinates.'],
      ['Plan your trip.', 'Create a trip under Trips, then drop markers for hotels, takeoff spots and photo spots, or paste an AI-made itinerary. Press and hold a saved place to move it to another day.'],
      ['See the conditions.', 'Open a marker for its zone verdict and its distance to your hotel and Home. Open a trip for a plan of each day and, if you turn weather on, a forecast.'],
      ['Your data stays yours.', 'Markers and trips are saved only in this browser. Weather, elevation and name lookups are off until you allow them (shield button). Export a backup now and then.'],
    ]) { const li = el('li'); li.append(el('b', '', t[0] + ' '), t[1]); ol.append(li); }
    d.append(ol);
    const names = regions.countries.map((k) => k.name);
    d.append(el('p', 'w-note', 'A planning aid, not flight advice: check the official platform before every flight. Zone data covers ' + (names.length ? names.join(' and ') : 'a few regions') + '. Singapore’s no-fly zones are approximate; every window links to the official OneMap Drone Query.'));
    return d;
  }

  function render() {
    body.replaceChildren();
    body.append(welcomeLine());
    for (const card of [routeCard(), whatsNewCard(), tripCard(), backupCard(), regionsCard()]) if (card) body.append(card);
    body.append(guideCard());
    updatePeek();
  }
  function updatePeek() {
    const coming = comingTrips(store.trips(), todayISO());
    const rs = poi.route.state();
    const text = rs.selecting && rs.stops.length ? 'Route · ' + rs.stops.length + ' stop' + (rs.stops.length === 1 ? '' : 's') : coming.length ? coming[0].trip.name + ' · ' + countdownLabel(coming[0].status) : 'Dashboard';
    $('dash-peek-text').textContent = text;
    peek.setAttribute('aria-label', 'Open the dashboard: ' + text);
  }

  // ---------- the three states ----------
  function lift() { document.documentElement.style.setProperty('--dash-lift', state === 'expanded' ? Math.round(dash.offsetHeight + 12) + 'px' : '0px'); }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(lift) : null;
  ro?.observe(dash);

  function setState(next, { guide = false } = {}) {
    const leaving = state === 'expanded' && next !== 'expanded';
    if (leaving && fresh.length) { save({ seen: fresh[0].id }); fresh = []; } // seen once they have been on screen and put away
    state = next;
    if (next === 'expanded') {
      if (guide) guideOpen = true;
      if (isPhone()) panel.closeIfPhone();
      render();
      if (!load().welcomed) save({ welcomed: true });
    }
    dash.hidden = next !== 'expanded';
    peek.hidden = next !== 'peek';
    tab.hidden = next !== 'hidden';
    peek.setAttribute('aria-expanded', 'false');
    document.body.dataset.dash = next;
    lift();
  }

  $('dash-collapse').addEventListener('click', () => setState('peek'));
  $('dash-close').addEventListener('click', () => setState('hidden'));
  peek.addEventListener('click', () => setState('expanded'));
  tab.addEventListener('click', () => setState('expanded'));
  $('dash-snooze').addEventListener('click', () => { save({ hideUntil: todayISO() }); setState('peek'); });
  dash.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setState('peek'); peek.focus(); } });
  panel.onOpen?.(() => { if (isPhone() && state === 'expanded') setState('peek'); }); // on a phone the panel and the dashboard take turns
  store.onChange(() => { if (state === 'expanded') render(); else updatePeek(); });

  // a route being built: a desktop opens the dashboard at the second stop, a phone brings up the strip (the map needs the room); both go
  // back to how they were when selecting ends
  let beforeRoute = null;
  poi.route.onChange(() => {
    const rs = poi.route.state();
    if (rs.selecting && rs.stops.length >= 2 && beforeRoute === null) {
      if (!isPhone() && state !== 'expanded') { beforeRoute = state; setState('expanded'); }
      else if (isPhone() && state === 'hidden') { beforeRoute = state; setState('peek'); }
    } else if (!rs.selecting && beforeRoute !== null) { const back = beforeRoute; beforeRoute = null; setState(back); }
    if (state === 'expanded') render(); else updatePeek();
  });

  // the Help card: bring it back, and choose whether it opens at start
  $('help-open').addEventListener('click', () => { panel.closeIfPhone(); setState('expanded', { guide: true }); });
  const startSwitch = $('dash-start');
  startSwitch.checked = saved.showOnStart;
  startSwitch.addEventListener('change', () => save({ showOnStart: startSwitch.checked }));

  setState(startState({ firstRun, unseen: fresh.length, showOnStart: saved.showOnStart, hideUntil: saved.hideUntil, today: todayISO(), phone: isPhone(), shared }));

  return {
    /** The regions the map covers and how to go to one (known once the data index has loaded). */
    setRegions(countries, goTo) { regions = { countries, goTo }; if (state === 'expanded') render(); },
    open: (opts) => setState('expanded', opts),
    get state() { return state; },
  };
}
