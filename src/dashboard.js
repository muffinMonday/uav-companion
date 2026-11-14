// The dashboard: a drawer along the bottom of the map with four task shortcuts, the route being built, the next trip (and today's stops while it is under
// way), what needs attention (invitations, backup, storage, What's new) and a folded data row. Help is a second subview of the same drawer (the ? button). It never blocks the map. Three states: expanded, the one-line
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
import { whenText } from './sessions.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

export function initDashboard({ poi, panel, trips, cloud = {}, shared = false, splash = false, actions = {} }) {
  const dash = $('dash'), body = $('dash-body'), peek = $('dash-peek'), tab = $('dash-tab');
  const store = poi.store;
  // parts that live elsewhere in the page and are shown on the dashboard while it is open (their handlers stay attached; they wait in
  // holders while the cards are rebuilt)
  const keystore = $('keystore'), datastore = $('datastore');
  const keyNodes = [$('regions-note'), $('legend')];
  const dataNodes = [$('poi-export'), $('poi-import'), $('poi-share'), $('poi-file'), $('poi-note')];
  const park = () => { keystore.append(...keyNodes); datastore.append(...dataNodes); };
  let todayShown = false;  // the Today card, with its check-in buttons, is on show
  let view = 'dash';       // the subview: 'dash' (default) or 'help'; page memory only, never stored
  let freshShown = false;  // What's new has been on screen (only then does leaving the dashboard count as having seen it)
  const topicOpen = new Set(); // Help topics the visitor has unfolded, kept across redraws
  let dataOpen = false;    // the folded data row, kept open across redraws
  const scrollOf = { dash: 0, help: 0 };
  const saved = load();
  const firstRun = !saved.welcomed && store.items().length === 0 && store.trips().length === 0;
  let fresh = unseenEntries(WHATS_NEW, saved.seen);   // entries to show until the visitor has seen them
  let state = null, stateToken = 0, renderedView = 'dash';
  const splashFirst = firstRun && splash;           // a first visit that the quick-setup splash will greet: the dashboard waits as its strip
  let quickSetup = null;                             // opens the quick setup again (set by the page once it exists)
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
    freshShown = true;
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
      return null; // nothing planned: the task shortcuts above are the way in, so no empty card
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
    const lines = el('details', 'dash-subtopic dash-lines'); lines.append(el('summary', '', 'What do the lines on the map mean?'), routeLinesKey());
    c.append(lines);
    return c;
  }
  /** Storage nearly full: a visible alert on the default dashboard (the one actionable warning that stays out of Help and the data section). */
  function storageCard() {
    let use = null;
    try { use = storageUse(localStorage); } catch { /* storage blocked: no readout */ }
    if (!use?.warn) return null;
    const c = el('section', 'dash-card dash-warn');
    c.append(el('h3', '', 'Storage is nearly full'));
    const p = el('p', 'hint storage-use warn', 'Using ' + sizeLabel(use.chars) + ' of about 5 MB of this browser’s storage. It is nearly full: export a backup and remove markers or trips you no longer need, or the browser may refuse to save new ones.');
    p.setAttribute('role', 'alert');
    c.append(p);
    const b = el('button', 'btn small', 'Export now'); b.type = 'button';
    b.addEventListener('click', () => $('poi-export').click());
    c.append(b);
    return c;
  }
  /** Import, export, share link and cloud status: one folded row at the end of the dashboard, so they keep a place without taking one. */
  function dataSection() {
    const c = el('details', 'dash-card dash-data'); c.open = dataOpen;
    c.addEventListener('toggle', () => { dataOpen = c.open; });
    c.append(el('summary', '', 'Your data: export, import, share'));
    const row = el('div', 'btn-row');
    row.append(...dataNodes.slice(0, 4)); // export, import, share link and the (hidden) file chooser
    c.append(row, dataNodes[4]);
    let use = null;
    try { use = storageUse(localStorage); } catch { /* storage blocked: no readout */ }
    if (use && !use.warn) c.append(el('p', 'hint storage-use', 'Using ' + sizeLabel(use.chars) + ' of about 5 MB of this browser’s storage.'));
    const line = cloud.handle?.line();
    if (line) { // signed in to the optional cloud copy: one line of status that opens its settings
      const b = el('button', 'btn small cloud-line', 'Cloud copy: ' + line); b.type = 'button';
      b.addEventListener('click', () => cloud.handle.open());
      c.append(b);
    }
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
  function sessionsCard() { // flight sessions: what is soonest for this person, else invitations, else public sessions near the map centre (opt-in), else a way in
    const hub = cloud.sessions;
    if (!hub) return null;
    const s = hub.summary(), c = el('section', 'dash-card dash-sessions');
    const go = (label, fn, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', () => { fn(); if (isPhone()) setState('peek'); }); return b; };
    const row = el('div', 'btn-row');
    c.append(el('h3', '', 'Flight sessions'));
    if (s.soon) {
      c.dataset.kind = 'soon';
      c.append(el('p', 'hint', `${s.soon.isHost ? 'You host' : 'You are going to'} “${s.soon.title}”, ${whenText(s.soon.startsAt, s.soon.endsAt)}.`));
      row.append(go('Open session', () => hub.open('detail', { id: s.soon.id, fallback: s.soon }), 'btn small primary'));
    } else if (s.invites || s.updates) {
      c.dataset.kind = 'invites';
      c.append(el('p', 'hint', [s.invites && (s.invites === 1 ? '1 private invitation' : s.invites + ' private invitations'), s.updates && (s.updates === 1 ? '1 update' : s.updates + ' updates')].filter(Boolean).join(' and ') + ' waiting for you.'));
      row.append(go(s.invites ? 'See invitations' : 'See updates', () => hub.open(s.invites ? 'invites' : 'mine'), 'btn small primary'));
    } else if (s.nearbyOn && s.nearby?.count) {
      c.dataset.kind = 'nearby';
      c.append(el('p', 'hint', `${s.nearby.count}${s.nearby.more ? '+' : ''} public ${s.nearby.count === 1 ? 'session' : 'sessions'} within 10 km of the map centre.`));
      row.append(go('See them', () => hub.open('discover', { near: 10 }), 'btn small primary'));
    } else return null; // nothing to act on: Find sessions in the task row is the way in, and Help has the nearby switch
    c.append(row);
    if (s.nearbyOn) c.append(nearbySwitch(hub, s));
    return c;
  }
  /** The opt-in for the nearby line on the dashboard (it uses the map centre, never the position). */
  function nearbySwitch(hub, s = hub.summary()) {
    const lab = el('label', 'ses-check ses-nearby'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = s.nearbyOn;
    cb.addEventListener('change', () => hub.setNearby(cb.checked));
    lab.append(cb, el('span', '', 'Show sessions within 10 km of the map centre here (uses the map centre, never your position)'));
    return lab;
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
    return c;
  }
  /** The four task shortcuts, always on the default dashboard. Each goes through the same panel, POI and hub calls the rest of the page uses; Sessions only where this build has it. */
  function taskShortcuts() {
    const box = el('div', 'dash-tasks');
    const grid = el('div', 'dash-btns');
    const mk = (id, text, fn) => {
      const b = el('button', 'btn small', text); b.type = 'button'; b.id = id;
      b.addEventListener('click', () => { if (isPhone()) setState('peek'); fn(); }); // on a phone the map needs the room
      grid.append(b);
    };
    mk('task-check', 'Check a location', checkHint);
    mk('task-trip', 'Plan a trip', () => { panel.open('trips'); $('trip-new').click(); });
    mk('task-save', 'Save a place', saveAPlace);
    if (cloud.sessions) mk('task-sessions', 'Find sessions', () => cloud.sessions.open('discover'));
    box.append(grid);
    return box;
  }
  const checkHint = () => { setState('peek'); actions.toast?.('Press and hold on the map for 2 seconds (or right-click) to check a spot. Search takes places and coordinates.', 8000); };
  /** Opens the Points of Interest explorer with its Add a marker section unfolded. The selected type, search and folds stay as they were. */
  const saveAPlace = () => { panel.open('poi'); poi.openAdd?.(); };
  /** Opens the explorer at its search box, without touching the query, filters, folds or what is shown on the map. */
  const findPlaces = () => { panel.open('poi'); setTimeout(() => poi.focusSearch?.(), 150); };

  // The Help subview: topics hold the existing hint replays (help-content.js owns the ids and texts) and the actions that moved off the dashboard.
  const HELP_TOPICS = [
    { id: 'start', title: 'Getting started', ids: [] },
    { id: 'map', title: 'Map basics and location checking', ids: ['map-tools', 'point-check'] },
    { id: 'trips', title: 'Trips, saved places and Side Quests', ids: ['poi', 'poi-types', 'trip-visibility', 'newtype-shared', 'trips'] },
    { id: 'social', title: 'Flight Sessions and Friends', ids: ['sessions', 'friends'] },
    { id: 'settings', title: 'Map settings', ids: ['map-config'] },
    { id: 'data', title: 'Data, privacy and safety', ids: [] },
  ];
  function helpView() {
    const d = el('section', 'dash-card dash-guide dash-help-view wide');
    const head = el('div', 'dash-help-head');
    const back = el('button', 'btn small dash-back', '‹ Back to the dashboard'); back.type = 'button'; back.id = 'dash-back';
    back.addEventListener('click', () => showView('dash'));
    const h = el('h3', '', 'Help'); h.id = 'dash-help-title'; h.tabIndex = -1;
    head.append(back, h);
    d.append(head);
    const replayable = actions.help?.replayable() ?? [];
    const claimed = new Set(HELP_TOPICS.flatMap((t) => t.ids));
    const act = (text, fn, id, keep = false) => { const b = el('button', 'btn small', text); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', () => { if (isPhone() && !keep) setState('peek'); fn(); }); return b; };
    const names = regions.countries.map((k) => k.name);
    for (const t of HELP_TOPICS) {
      const box = el('details', 'dash-topic'); box.dataset.topic = t.id; box.open = topicOpen.has(t.id);
      box.addEventListener('toggle', () => { if (box.open) topicOpen.add(t.id); else topicOpen.delete(t.id); });
      box.append(el('summary', '', t.title));
      const inner = el('div', 'dash-topic-body'); box.append(inner);
      const buttons = el('div', 'dash-btns');
      if (t.id === 'start') {
        const ol = el('ol', 'w-steps');
        for (const s of [
          ['Check a spot.', 'Press and hold on the map for 2 seconds (or right-click) to see whether you can fly there. Search takes places and coordinates.'],
          ['Plan your trip.', 'Create a trip under Trips, then drop markers for accommodation, takeoff spots and photo spots, or paste an AI-made itinerary. Press and hold a saved place to move it to another day.'],
          ['See the conditions.', 'Open a marker for its zone verdict and its distance to your accommodation and Home. Open a trip for a plan of each day and, if you turn weather on, a forecast.'],
          ['Your data stays yours.', 'Markers and trips are saved only in this browser. Weather, elevation and name lookups are off until you allow them (shield button). Export a backup now and then.'],
        ]) { const li = el('li'); li.append(el('b', '', s[0] + ' '), s[1]); ol.append(li); }
        inner.append(ol);
        buttons.append(act('Run the quick setup again', () => quickSetup?.(), 'dash-setup', true));
        // hints that belong to no topic (a future feature adds one declaratively) still show up here
        for (const r of replayable) if (!claimed.has(r.id)) buttons.append(replayBtn(r));
      }
      if (t.id === 'map') {
        if (actions.checkHere) buttons.append(act('Check where I am', () => actions.checkHere()));
        if (actions.crosshair) buttons.append(act(actions.crosshair.on ? 'Hide crosshair' : 'Show crosshair', () => actions.crosshair.toggle(), 'help-crosshair', true));
        inner.append(el('p', 'hint', 'Zoom, My location and More tools are on the left of the map. More tools holds marker details, Side Quests, trip markers, the crosshair and Flight Sessions.'));
        const key = el('details', 'dash-subtopic'); key.append(el('summary', '', 'What the colours and lines mean'));
        const kb = el('div', 'key-body'); kb.append(keyNodes[1], routeLinesKey()); key.append(kb);
        inner.append(key);
      }
      if (t.id === 'trips') {
        buttons.append(act('Save a place', saveAPlace, 'task-save-help'), act('Find saved places', findPlaces, 'task-find'), act('Plan a trip', () => { panel.open('trips'); $('trip-new').click(); }));
      }
      if (t.id === 'social' && cloud.sessions) { buttons.append(act('Find sessions', () => cloud.sessions.open('discover'))); inner.append(nearbySwitch(cloud.sessions)); }
      if (t.id === 'settings') {
        inner.append(el('p', 'hint', 'Basemap, zone display and opacity, theme, units and the Maps app live in Map Configs.'));
        buttons.append(act('Open Map Configs', () => panel.open('config')));
      }
      if (t.id === 'data') {
        inner.append(el('p', 'hint', 'A planning aid, not flight advice: check the official platform before every flight. Zone data covers ' + (names.length ? names.join(' and ') : 'a few regions') + '. Singapore’s no-fly zones are approximate; every window links to the official OneMap Drone Query. Not being inside a mapped zone, or being outside the data, is never permission to fly.'), keyNodes[0]);
      }
      for (const r of replayable.filter((x) => t.ids.includes(x.id))) buttons.append(replayBtn(r));
      if (buttons.children.length) inner.append(buttons);
      d.append(box);
    }
    return d;
  }
  function replayBtn(h) {
    const b = el('button', 'btn small', h.replay); b.type = 'button'; b.dataset.replay = h.id;
    b.addEventListener('click', () => { if (isPhone()) setState('peek'); actions.help.replay(h.id); });
    return b;
  }
  /** The lines the trip plan draws on the map, explained next to where they show (the trip card, and Help). Built from constants only. */
  function routeLinesKey() {
    const lines = el('div', 'key-lines');
    lines.append(el('small', 'key-title', 'Lines on the map'));
    const arrow = (attrs) => '<svg viewBox="0 0 44 12" aria-hidden="true"><line x1="2" y1="6" x2="33" y2="6" ' + attrs + '/><path d="M31 2l10 4-10 4z" fill="currentColor"/></svg>';
    const row = (svg, text) => { const r = el('div', 'key-line'), s = el('span', 'key-sample'); s.innerHTML = svg; r.append(s, text); lines.append(r); };
    row(arrow('stroke="currentColor" stroke-width="2" opacity=".45"'), 'A day\'s stops, in order');
    row(arrow('stroke="currentColor" stroke-width="5"'), 'Into and out of the selected stop, with the distance');
    row(arrow('stroke="currentColor" stroke-width="5" stroke-dasharray="8 5"'), 'Overnight: through the accommodation, or on to the next day');
    row('<svg viewBox="0 0 44 12" aria-hidden="true"><line x1="2" y1="6" x2="42" y2="6" stroke="currentColor" stroke-width="3" stroke-dasharray="6 5" opacity=".85"/></svg>', 'Straight-line distance to the nearest Home point or accommodation');
    lines.append(el('p', 'hint', 'Arrows take the colour of their trip.'));
    return lines;
  }

  function render() {
    scrollOf[renderedView] = body.scrollTop;
    park(); poi.checkin.unbind('dash'); todayShown = false;
    body.replaceChildren();
    renderedView = view;
    if (view === 'help') body.append(helpView());
    else {
      body.append(welcomeLine(), taskShortcuts());
      for (const card of [routeCard(), tripCard(), friendsCard(), sessionsCard(), storageCard(), backupCard(), whatsNewCard(), regionsCard(), dataSection()]) if (card) body.append(card);
    }
    body.scrollTop = scrollOf[view];
    syncHelp();
    updatePeek();
    poi.checkin.sync(); // the position is wanted while Today shows check-in buttons
  }
  /** Switches between the default dashboard and Help inside the same drawer; scroll, route, trip and What's new state stay as they are. */
  function showView(next, { focus = true } = {}) {
    if (view === next) return;
    view = next; render();
    if (!focus) return;
    if (next === 'help') $('dash-help-title')?.focus();
    else helpBtn.focus();
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
  const helpBtn = $('dash-help');
  function syncHelp() { helpBtn.setAttribute('aria-pressed', String(view === 'help')); }
  helpBtn.addEventListener('click', () => showView(view === 'help' ? 'dash' : 'help'));
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

  function setState(next, { guide = false, instant = false, data = false } = {}) {
    const leaving = state === 'expanded' && next !== 'expanded';
    if (leaving && fresh.length && freshShown) { save({ seen: fresh[0].id }); fresh = []; } // seen once they have been on screen and put away
    state = next;
    if (next === 'expanded') {
      if (guide) view = 'help';
      if (data) { view = 'dash'; dataOpen = true; } // export, import and share live in the folded data row
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
  // and swiping the collapsed dashboard up (the strip, or the chevron when it is put away) opens it
  onSwipe(peek, { direction: 'up', distance: 24, enabled: () => state === 'peek', onDismiss: () => setState('expanded', { instant: true }) });
  onSwipe(tab, { direction: 'up', distance: 24, enabled: () => state === 'hidden', onDismiss: () => setState('expanded', { instant: true }) });
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

  $('setup-open').addEventListener('click', () => { panel.closeIfPhone(); quickSetup?.(); });
  setState(splashFirst ? 'peek' : startState({ firstRun, unseen: fresh.length, showOnStart: saved.showOnStart, hideUntil: saved.hideUntil, today: todayISO(), phone: isPhone(), shared }));

  return {
    /** The regions the map covers and how to go to one (known once the data index has loaded). */
    setRegions(countries, goTo) { regions = { countries, goTo }; if (state === 'expanded') render(); },
    open: (opts) => setState('expanded', opts),
    /** Fold to the one-line strip. */
    fold: () => setState('peek'),
    /** True on a first visit that the splash should greet (the dashboard waits as its strip). */
    splashFirst,
    onQuickSetup(fn) { quickSetup = fn; },
    get regions() { return regions; },
    get state() { return state; },
  };
}
