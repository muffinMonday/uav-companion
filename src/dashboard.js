// The dashboard: a drawer along the bottom of the map with What's new, the next trip (and today's stops while it is under way), a backup
// reminder, buttons for the regions the map covers and a short guide. It never blocks the map. Three states: expanded, the one-line
// peek strip (V), and hidden behind a small ^ tab (close). How it starts is decided in dashstate.js.
import { comingTrips, countdownLabel, tripSummary, todayISO, tripLength, tripStatus, planDays, tripWarnings } from './trips.js';
import { WHATS_NEW } from './whatsnew.js';
import { load, save, unseenEntries, startState, backupDue, storageUse, sizeLabel } from './dashstate.js';
import { animateOut } from './motion.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { onSwipe, atTop } from './swipe.js';
import { routeLinks } from './maplinks-ui.js';
import { MODES, MAX_STOPS } from './maplinks.js';
import { typeOf } from './poi.js';
import { checkinCell } from './checkin-ui.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

export function initDashboard({ poi, panel, trips, cloud = {}, shared = false, actions = {} }) {
  const dash = $('dash'), body = $('dash-body'), peek = $('dash-peek'), tab = $('dash-tab');
  const store = poi.store;
  // parts that live elsewhere in the page and are shown on the dashboard while it is open (their handlers stay attached; they wait in
  // holders while the cards are rebuilt)
  const keystore = $('keystore'), datastore = $('datastore');
  const keyNodes = [$('regions-note'), $('legend')];
  const dataNodes = [$('poi-export'), $('poi-import'), $('poi-share'), $('poi-file'), $('poi-note')];
  const park = () => { keystore.append(...keyNodes); datastore.append(...dataNodes); };
  let todayShown = false;  // the Today card, with its check-in buttons, is on show
  const layerEls = {};     // the layer controls mirrored here, so changes made in Map Configs show
  const saved = load();
  const firstRun = !saved.welcomed && store.items().length === 0 && store.trips().length === 0;
  let fresh = unseenEntries(WHATS_NEW, saved.seen);   // entries to show until the visitor has seen them
  let state = null, stateToken = 0;
  let guideOpen = firstRun;
  let tripFade = false;                              // the trip card eases in after ‹ or ›
  let tripIx = 0;                                    // which of the coming trips the trip card shows
  let regions = { countries: [], goTo: null };

  // ---------- the cards ----------
  function welcomeLine() {
    const c = el('div', 'dash-welcome');
    const first = firstRun && !store.items().length && !store.trips().length;
    c.append(el('div', 'dash-hello', first ? 'Welcome!' : 'Welcome back!'));
    const sub = el('div', 'dash-hello-sub');
    if (first) sub.textContent = 'Check where you can fly a drone and plan your trip.';
    else {
      const coming = comingTrips(store.trips(), todayISO());
      if (!coming.length) {
        sub.append("You don't have any upcoming plans. ");
        const plan = el('button', 'dash-link', 'Plan a trip'); plan.type = 'button';
        plan.addEventListener('click', () => { panel.open('trips'); $('trip-new').click(); });
        sub.append(plan);
      } else {
        const { trip, status } = coming[0];
        const name = el('b', '', trip.name);
        if (status.state === 'upcoming') sub.append('Your next trip, ', name, status.days === 1 ? ', is tomorrow.' : ', is in ' + status.days + ' days.');
        else sub.append(name, status.of === 1 ? ' is today.' : ' is under way: day ' + status.day + ' of ' + status.of + '.');
      }
    }
    c.append(sub);
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
    const fc = trips.forecastFor?.(trip.id);
    if (fc) c.append(el('div', 'dash-sub', 'First day: ' + fc.text));
    const facts = [];
    if (tripLength(trip)) {
      const w = tripWarnings(store.items(), trip);
      const n = w.undated + w.outside + w.noHotel.length;
      if (n) facts.push('⚠ ' + n + ' to check');
    }
    if (trip.checklist?.length) facts.push(trip.checklist.filter((x) => x.done).length + ' of ' + trip.checklist.length + ' checked');
    if (facts.length) c.append(el('div', 'dash-sub', facts.join(' · ')));
    if (trip.checklist?.length) { // the checklist, to tick here
      const ul = el('ul', 'dash-check');
      trip.checklist.slice(0, 5).forEach((item, i) => {
        const li = el('li'), cb = el('input'); cb.type = 'checkbox'; cb.checked = item.done; cb.setAttribute('aria-label', item.text);
        cb.addEventListener('change', () => store.updateTrip(trip.id, { checklist: trip.checklist.map((x, j) => (j === i ? { ...x, done: cb.checked } : x)) }));
        li.append(cb, el('span', item.done ? 'done' : '', item.text)); ul.append(li);
      });
      if (trip.checklist.length > 5) ul.append(el('li', 'dash-more', '+' + (trip.checklist.length - 5) + ' more in the trip'));
      c.append(ul);
    }
    if (status.state === 'now' && tripLength(trip)) { // under way: today's stops
      const day = planDays(store.items(), trip).days[status.day - 1];
      if (day?.stops.length) {
        const list = el('div', 'dash-today');
        list.append(el('small', '', 'Today'));
        for (const s of day.stops) {
          const b = el('button', 'dash-stop'); b.type = 'button';
          b.append(el('span', 'plan-n', s.order !== undefined ? String(s.order) : '•'), el('span', '', s.name));
          b.addEventListener('click', () => { if (isPhone()) setState('peek'); poi.openMarker(s.id); }); // on a phone the map needs the room
          const line = el('div', 'dash-stop-row'); line.append(b);
          const cell = checkinCell({ cin: poi.checkin, store, id: s.id, ns: 'dash' }); // Check in, or what was recorded
          if (cell) line.append(cell);
          list.append(line);
          todayShown = true;
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
  function actionsCard() {
    const c = el('section', 'dash-card dash-actions');
    c.append(el('h3', '', 'Quick actions'));
    const grid = el('div', 'dash-btns');
    const mk = (text, fn, disabled = false, keep = false) => {
      const b = el('button', 'btn small', text); b.type = 'button'; b.disabled = disabled;
      b.addEventListener('click', () => { if (isPhone() && !keep) setState('peek'); fn(); }); // on a phone the map needs the room
      grid.append(b);
    };
    mk('Place at map centre', () => $('poi-center').click());
    mk('Place at my location', () => $('poi-here').click());
    mk('Select markers', () => $('poi-select').click(), !store.items().length);
    mk('Check my spot', () => actions.checkHere?.(), !actions.checkHere);
    if (actions.crosshair) mk(actions.crosshair.on ? 'Hide crosshair' : 'Show crosshair', () => actions.crosshair.toggle(), false, true);
    c.append(grid);
    return c;
  }
  function layersCard() {
    const c = el('section', 'dash-card dash-layers');
    c.append(el('h3', '', 'Layers'));
    const sw = el('label', 'switch'), cb = el('input'); cb.type = 'checkbox'; cb.checked = $('show').checked;
    cb.addEventListener('change', () => { $('show').checked = cb.checked; $('show').dispatchEvent(new Event('change')); });
    sw.append(el('span', '', 'Show zones'), cb);
    const op = el('label', 'field'), rg = el('input'); rg.type = 'range'; rg.min = '0.1'; rg.max = '0.9'; rg.step = '0.05'; rg.value = $('op').value;
    rg.addEventListener('input', () => { $('op').value = rg.value; $('op').dispatchEvent(new Event('input')); });
    rg.addEventListener('change', () => $('op').dispatchEvent(new Event('change')));
    op.append(el('span', '', 'Zone opacity'), rg);
    const bs = el('label', 'field'), sel = el('select');
    for (const o of $('base').options) { const n = el('option', '', o.textContent); n.value = o.value; sel.append(n); }
    sel.value = $('base').value;
    sel.addEventListener('change', () => { $('base').value = sel.value; $('base').dispatchEvent(new Event('change')); });
    bs.append(el('span', '', 'Basemap'), sel);
    Object.assign(layerEls, { cb, rg, sel });
    c.append(sw, op, bs);
    return c;
  }
  function dataCard() {
    const c = el('section', 'dash-card dash-data');
    c.append(el('h3', '', 'Your data'));
    const row = el('div', 'btn-row');
    row.append(...dataNodes.slice(0, 4)); // export, import, share link and the (hidden) file chooser
    c.append(row, dataNodes[4]);
    let use = null;
    try { use = storageUse(localStorage); } catch { /* storage blocked: no readout */ }
    if (use) {
      const p = el('p', 'hint storage-use' + (use.warn ? ' warn' : ''), 'Using ' + sizeLabel(use.chars) + ' of about 5 MB of this browser’s storage.' + (use.warn ? ' It is nearly full: export a backup and remove markers or trips you no longer need, or the browser may refuse to save new ones.' : ''));
      if (use.warn) p.setAttribute('role', 'alert');
      c.append(p);
    }
    const line = cloud.handle?.line();
    if (line) { // signed in to the optional cloud copy: one line of status that opens its settings
      const b = el('button', 'btn small cloud-line', 'Cloud copy: ' + line); b.type = 'button';
      b.addEventListener('click', () => cloud.handle.open());
      c.append(b);
    }
    return c;
  }
  function keyCard() {
    const c = el('section', 'dash-card dash-key');
    c.append(el('h3', '', 'Map key'), keyNodes[0], keyNodes[1]);
    const lines = el('div', 'key-lines');
    lines.append(el('small', 'key-title', 'Lines on the map'));
    const arrow = (attrs) => '<svg viewBox="0 0 44 12" aria-hidden="true"><line x1="2" y1="6" x2="33" y2="6" ' + attrs + '/><path d="M31 2l10 4-10 4z" fill="currentColor"/></svg>'; // built from constants only
    const row = (svg, text) => { const r = el('div', 'key-line'), s = el('span', 'key-sample'); s.innerHTML = svg; r.append(s, text); lines.append(r); };
    row(arrow('stroke="currentColor" stroke-width="2" opacity=".45"'), 'A day\'s stops, in order');
    row(arrow('stroke="currentColor" stroke-width="5"'), 'Into and out of the selected stop, with the distance');
    row(arrow('stroke="currentColor" stroke-width="5" stroke-dasharray="8 5"'), 'Overnight: through the hotel, or on to the next day');
    row('<svg viewBox="0 0 44 12" aria-hidden="true"><line x1="2" y1="6" x2="42" y2="6" stroke="currentColor" stroke-width="3" stroke-dasharray="6 5" opacity=".85"/></svg>', 'To the nearest hotel or Home point, with the distance');
    c.append(lines, el('p', 'hint', 'Arrows take the colour of their trip. A planning aid, not flight advice: zones can change, so check the official platform for the place you are flying (for China, UOM) before every flight.'));
    return c;
  }
  function friendsCard() { // friend requests waiting (only when signed in to the optional cloud features)
    const n = cloud.friends?.incoming ?? 0, v = cloud.friends?.invites ?? 0;
    if (!n && !v) return null;
    const c = el('section', 'dash-card dash-friends');
    const parts = [n && (n === 1 ? '1 friend request' : n + ' friend requests'), v && (v === 1 ? '1 trip invitation' : v + ' trip invitations')].filter(Boolean);
    c.append(el('h3', '', 'Friends'), el('p', 'hint', parts.join(' and ') + (n + v === 1 ? ' is' : ' are') + ' waiting for you.'));
    const b = el('button', 'btn small', 'Open Friends'); b.type = 'button';
    b.addEventListener('click', () => { cloud.friends.open(); if (isPhone()) setState('peek'); });
    c.append(b);
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
    const c = el('section', 'dash-card dash-fly');
    if (regions.countries.length) {
      c.append(el('h3', '', 'Fly in'));
      const row = el('div', 'btn-row');
      for (const k of regions.countries) {
        const b = el('button', 'btn small', k.name); b.type = 'button';
        b.addEventListener('click', () => { regions.goTo?.(k.id); panel.closeIfPhone(); if (isPhone()) setState('peek'); });
        row.append(b);
      }
      c.append(row);
    }
    const g = guideCard(); // How it works folds out under the buttons; open, the card takes the whole row so the steps stay readable
    c.classList.toggle('wide', g.open);
    g.addEventListener('toggle', () => c.classList.toggle('wide', g.open));
    c.append(g);
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
    park(); poi.checkin.unbind('dash'); todayShown = false;
    body.replaceChildren();
    body.append(welcomeLine());
    for (const card of [routeCard(), whatsNewCard(), friendsCard(), tripCard(), actionsCard(), layersCard(), backupCard(), dataCard(), keyCard(), regionsCard()]) if (card) body.append(card);
    updatePeek();
    poi.checkin.sync(); // the position is wanted while Today shows check-in buttons
  }
  function updatePeek() {
    const coming = comingTrips(store.trips(), todayISO());
    const rs = poi.route.state();
    const text = rs.selecting && rs.stops.length ? 'Route · ' + rs.stops.length + ' stop' + (rs.stops.length === 1 ? '' : 's') : coming.length ? coming[0].trip.name + ' · ' + countdownLabel(coming[0].status) : 'Dashboard';
    $('dash-peek-text').textContent = text;
    peek.setAttribute('aria-label', 'Open the dashboard: ' + text);
  }

  // ---------- the three states ----------
  // On a phone the dashboard can grow to 90% of the screen (the button beside close). The choice is remembered (prefs.dashTall).
  const expandBtn = $('dash-expand');
  function setTall(on, { save = true } = {}) {
    dash.classList.toggle('tall', on);
    if (save) savePrefs({ dashTall: on || null });
    expandBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Shrink the dashboard back to its usual height' : 'Expand the dashboard';
    expandBtn.setAttribute('aria-label', label); expandBtn.title = on ? 'Shrink back' : 'Expand';
    lift();
  }
  expandBtn.addEventListener('click', () => setTall(!dash.classList.contains('tall')));
  if (loadPrefs().dashTall) setTall(true, { save: false });
  // the forecast card and other bottom-left cards rise above the dashboard; a tall dashboard covers the screen, so they stay put behind it
  function lift() { document.documentElement.style.setProperty('--dash-lift', state === 'expanded' && !dash.classList.contains('tall') ? Math.round(dash.offsetHeight) + 'px' : '0px'); }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(lift) : null;
  ro?.observe(dash);

  function setState(next, { guide = false, instant = false } = {}) {
    const leaving = state === 'expanded' && next !== 'expanded';
    if (leaving && fresh.length) { save({ seen: fresh[0].id }); fresh = []; } // seen once they have been on screen and put away
    state = next;
    if (next === 'expanded') {
      if (guide) guideOpen = true;
      if (isPhone()) panel.closeIfPhone();
      render();
      if (!load().welcomed) save({ welcomed: true });
    }
    const token = ++stateToken; // a later change wins over one still on its way
    const apply = () => {
      if (token !== stateToken) return;
      dash.hidden = next !== 'expanded';
      peek.hidden = next !== 'peek';
      tab.hidden = next !== 'hidden';
      peek.setAttribute('aria-expanded', 'false');
      document.body.dataset.dash = next;
      lift();
      poi.checkin.sync();
    };
    if (leaving && !instant) animateOut(dash, 'closing', apply); else apply(); // slides down, then the strip or the tab appears (a swipe has already slid it away)
  }

  // Swipe down puts the dashboard away to its tab, like Close. It starts in the header, or in the cards once they are scrolled to the top; the strip swipes down too.
  onSwipe(dash, { direction: 'down', enabled: () => state === 'expanded', canStart: (t) => !!t.closest('.dash-head') || atTop(t, dash), onDismiss: () => setState('hidden', { instant: true }) });
  onSwipe(peek, { direction: 'down', distance: 24, enabled: () => state === 'peek', onDismiss: () => setState('hidden', { instant: true }) });
  $('dash-collapse').addEventListener('click', () => setState('peek'));
  $('dash-close').addEventListener('click', () => setState('hidden'));
  peek.addEventListener('click', () => setState('expanded'));
  tab.addEventListener('click', () => setState('expanded'));
  $('dash-snooze').addEventListener('click', () => { save({ hideUntil: todayISO() }); setState('peek'); });
  dash.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setState('peek'); peek.focus(); } });
  panel.onOpen?.(() => { if (isPhone() && state === 'expanded') setState('peek'); }); // on a phone the panel and the dashboard take turns
  store.onChange(() => { if (state === 'expanded') render(); else updatePeek(); });
  cloud.refresh = () => { if (state === 'expanded') render(); };
  poi.checkin.also(() => state === 'expanded' && todayShown);
  actions.crosshair?.onChange(() => { if (state === 'expanded') render(); });
  trips.onForecast?.(() => { if (state === 'expanded') render(); });
  // Map Configs changes show in the mirrored layer controls
  $('show').addEventListener('change', () => { if (layerEls.cb) layerEls.cb.checked = $('show').checked; });
  $('op').addEventListener('input', () => { if (layerEls.rg) layerEls.rg.value = $('op').value; });
  $('base').addEventListener('change', () => { if (layerEls.sel) layerEls.sel.value = $('base').value; });

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
