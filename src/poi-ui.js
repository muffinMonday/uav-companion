// Points of interest on the map: placing, listing, editing, moving, backup. Data and storage live in poi.js.
import { log } from './log.js';
import L from 'leaflet';
import { KEY, TRIPS_KEY, TYPES, typeOf, pinSvg, createStore, toGeoJSON, parseGeoJSON, sortForList, posInt, isoDate, listMode, groupLabel, dateLabel, isMain, isSub, stopNo, NOT_SUB } from './poi.js';
import { createMarkerWeather, formatWhen, rainOutlook } from './markerweather.js';
import { createMarkerElevation } from './elevation.js';
import { getPrivacy, onPrivacyChange } from './privacy.js';
import { createCheckin, checkinCell, checkinStamp } from './checkin-ui.js';
import { reduced, EASE } from './motion.js';
import { getWindLimit } from './weather.js';
import { getDistanceSettings, setDistanceSettings, onDistanceSettings } from './units.js';
import { BASE_TYPES, needsDistance, nearestBases, beyondRange, fmtDistance, compass, toDisplay, fromDisplay, haversineM } from './distance.js';
import { sortTrips, tripSummary, tripDatesLabel, outsideTrip } from './trips.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { visitGroups, visitLabel } from './places.js';
import { dayInfo, dayText, tripSequence, defaultParent, sideQuestPatch, mainStopPatch, sideQuestMap } from './trips.js';
import { mapLinkIcons } from './maplinks-ui.js';
import { MODES } from './maplinks.js';
import { planMove, planSideMove, stepSideIndex, stepSlot, groupKey, addDays } from './reorder.js';
import { initReorder } from './reorder-ui.js';
import { centreOn, popupMaxHeight, expandedMaxHeight, defaultExpanded } from './view.js';
import { el, statusEl, tile, statsGrid, rainBlock, disclaimer, toolBar } from './cards.js';
import { onPopupSwipe } from './swipe.js';

const $ = (id) => document.getElementById(id);
const HOLD_MS = 380; // press and hold this long before a pin can be moved
const SLOP = 8;      // px of movement during the hold that cancels it (it was a swipe, not a hold)

/** The pin, with a small dot in its trip's colour when the marker belongs to a trip. The colour comes from the fixed palette in poi.js. */
// `side`: { sub: a Side Quest (smaller, dashed), hidden: folded away until its main stop is open, count: how many Side Quests hang from this main stop (the +N badge) }
const makeIcon = (type, tripColor, seq = '', visits = 0, side = null) => L.divIcon({
  className: 'poi-pin' + (side?.sub ? ' side-pin' : '') + (side?.hidden ? ' side-hidden' : ''),
  html: pinSvg(type) + (tripColor ? `<i class="trip-dot" style="background:${tripColor}"></i>` : '') + (seq ? `<b class="seq">${seq}</b>` : '') + (visits > 1 ? `<b class="visits">×${visits}</b>` : '') + (side?.count ? `<b class="sidecount">+${side.count}</b>` : ''),
  iconSize: [30, 40], iconAnchor: [15, 38],
});
const fmt = (v) => v.toFixed(5);
/** Short form for the pin: "D2·3", "D2" or "#3"; '' when the marker has neither a day nor a stop. */
const seqBadge = (it, trip) => { const d = dayInfo(it, trip)?.day, n = stopNo(it); return d !== undefined ? `D${d}${n !== undefined ? `·${n}` : ''}` : n !== undefined ? `#${n}` : ''; };
/** "Day 2 · Stop 3", or just one of them, or '' when the marker is not part of an itinerary. */
const tripLabel = (it, trip) => [dayText(dayInfo(it, trip)), stopNo(it) !== undefined && `Stop ${stopNo(it)}`].filter(Boolean).join(' · ');

export function initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, locateOnce, panel }) {
  const store = createStore();
  const cin = createCheckin({ store, panel, toast }); // check-in at markers: opt-in, only while the panel shows them
  const layer = L.layerGroup().addTo(map);
  const markers = new Map(); // id -> L.Marker
  const container = map.getContainer();
  let selectedType = TYPES[0].id;
  let mode = null; // null | 'place' | 'edit'
  let filter = 'all';         // marker type filter
  let tripFilter = 'all';     // 'all' | 'none' | a trip id
  let currentTripId = null;   // the trip new markers are put in (never applies to a Home marker)
  let newTripHandler = null;  // set by the Trips tab: starts a new trip and tags a marker with it
  let suppressClick = false;
  let popup = null;
  let visitMap = new Map();   // id -> every marker at the same spot (two or more), see places.js
  let sideMap = { byParent: new Map(), orphans: [] }; // Side Quests under their parent main stops (trips.js sideQuestMap)
  let subParent = new Map();  // Side Quest id -> its parent's id (a Side Quest with no parent is not in it)
  let expandedParent = null;  // the main stop whose Side Quests are unfolded in the lists (one at a time)
  let showAllSide = !!loadPrefs().showSide;
  let hideTrips = !!loadPrefs().hideTrips; // trip markers, their routes and Side Quest links are taken off the map
  const expandListeners = new Set();
  let pickId = null;          // a card was just tapped: its marker is on its way (the map is moving), so the card is marked at once
  const revealListeners = new Set(); // the Trips tab hears that a marker was clicked on the map, to bring its row into view
  const visitCount = (id) => visitMap.get(id)?.length ?? 0;
  let selecting = false;      // "Select markers" mode in the list, for deleting several at once
  const selected = new Set(); // ids ticked in that mode (only ever markers that are shown)
  let visibleIds = new Set(); // the markers the list shows now
  let wxLine = null; // { id, render } for the weather and elevation tiles in the open marker window, so they update in place

  // Weather summaries and ground elevation for markers: both opt-in, see privacy.js
  const mw = createMarkerWeather({ getItems: () => store.items(), onChange: () => { renderWxStatus(); wxLine?.render(); } });
  const elev = createMarkerElevation({ getItems: () => store.items(), onChange: () => { renderWxStatus(); wxLine?.render(); } });
  { const live = store.items().map((i) => i.id); mw.prune(live); elev.prune(live); } // forget weather and elevation for markers that are gone
  const mwStatusEls = [$('mw-status'), $('pv-mw-status')];

  const typesEl = $('poi-types'), listEl = $('poi-list'), filterEl = $('poi-filter'), countEl = $('poi-count');
  const emptyEl = $('poi-empty'), noteEl = $('poi-note'), editSwitch = $('poi-edit'), showSwitch = $('poi-show');
  const banner = $('banner'), bannerText = $('banner-text'), bannerAction = $('banner-action'), bannerReview = $('banner-review');
  const tripSel = $('poi-trip'), tripField = $('poi-trip-field'), tripFilterSel = $('poi-trip-filter'), tripFilterField = $('poi-trip-filter-field');

  // ---------- trips: selectors in this tab ----------
  const tripColor = (it) => store.getTrip(it.tripId)?.color;
  const tripOptions = (sel, extra) => {
    sel.replaceChildren();
    for (const [value, label] of extra) { const o = el('option', '', label); o.value = value; sel.append(o); }
    for (const t of sortTrips(store.trips())) { const o = el('option', '', t.country ? `${t.name} (${t.country})` : t.name); o.value = t.id; sel.append(o); }
  };
  /** Rebuilds the "trip for new markers" and "show trip" selectors from the saved trips, and keeps their values valid. */
  function renderTripSelects() {
    const hasTrips = store.trips().length > 0;
    if (currentTripId && !store.getTrip(currentTripId)) currentTripId = null;
    if (tripFilter !== 'all' && tripFilter !== 'none' && !store.getTrip(tripFilter)) tripFilter = 'all';
    tripOptions(tripSel, [['', 'No trip']]);
    tripSel.value = currentTripId ?? '';
    tripFilterField.hidden = !hasTrips;
    tripField.hidden = !hasTrips || selectedType === 'residence'; // a Home marker belongs to no trip, so there is nothing to choose
    tripOptions(tripFilterSel, [['all', 'All trips'], ['none', 'No trip']]);
    tripFilterSel.value = tripFilter;
  }
  tripSel.addEventListener('change', () => { currentTripId = tripSel.value || null; savePrefs({ currentTrip: currentTripId }); });
  tripFilterSel.addEventListener('change', () => { tripFilter = tripFilterSel.value; renderList(); });

  // ---------- type picker ----------
  function renderTypes() {
    typesEl.replaceChildren();
    for (const t of TYPES) {
      const b = el('button', 'type-btn');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === selectedType));
      b.dataset.type = t.id;
      b.title = t.hint; // "Home point" and "Home" are easy to mix up, so each type explains itself
      b.innerHTML = pinSvg(t.id); // built from constants only
      b.append(el('span', '', t.label));
      b.addEventListener('click', () => {
        selectedType = t.id;
        for (const x of typesEl.children) x.setAttribute('aria-checked', String(x.dataset.type === selectedType));
        tripField.hidden = store.trips().length === 0 || selectedType === 'residence';
        if (mode === 'place') updateBanner();
      });
      typesEl.append(b);
    }
  }

  // ---------- list ----------
  function renderList() {
    const items = store.items();
    countEl.textContent = items.length ? `(${items.length})` : '';
    emptyEl.hidden = items.length > 0;

    const present = TYPES.filter((t) => items.some((i) => i.type === t.id));
    if (filter !== 'all' && !present.some((t) => t.id === filter)) filter = 'all';
    filterEl.replaceChildren();
    filterEl.hidden = present.length < 2;
    for (const [id, label] of [['all', 'All'], ...present.map((t) => [t.id, t.label])]) {
      const c = el('button', 'chip', label);
      c.type = 'button';
      c.setAttribute('aria-pressed', String(filter === id));
      c.addEventListener('click', () => { filter = id; renderList(); });
      filterEl.append(c);
    }

    const before = new Map([...listEl.querySelectorAll('li[data-id]')].map((li) => [li.dataset.id, li.getBoundingClientRect().top])); // where each row is now, to glide it to where it will be
    cin.unbind('poi');
    listEl.replaceChildren();
    const trips = store.trips();
    const visible = items.filter((i) => (filter === 'all' || i.type === filter)
      && (tripFilter === 'all' || (tripFilter === 'none' ? !i.tripId : i.tripId === tripFilter)));
    visibleIds = new Set(visible.map((i) => i.id));
    const nestedIds = new Set(); // Side Quests listed under their (shown) main stop instead of in the flow
    for (const [pid, subs] of sideMap.byParent) if (visibleIds.has(pid)) for (const s of subs) if (visibleIds.has(s.id)) nestedIds.add(s.id);
    if (!items.length) selecting = false;
    for (const id of [...selected]) if (!visibleIds.has(id)) selected.delete(id); // the count always matches what is shown
    renderSelectBar(items);
    $('poi-drag-hint').hidden = true; // shown below once the list is drawn, if any row can be dragged

    // One group of markers. Inside it: date headings once any marker has a date, else "Day N" headings once any has a day,
    // else a plain list, newest first. `mode` is decided by the caller so headings and order always agree.
    const renderGroup = (group, mode, head, scope = 'none') => {
      if (head) listEl.append(head);
      // dragging is for dated or day-numbered lists only, with no type filter on, and not while selecting
      const dragOk = !selecting && filter === 'all' && mode === 'date';
      const heading = (label, key) => { const h = el('li', 'day-head', label); h.setAttribute('role', 'presentation'); h.dataset.scope = scope; h.dataset.gkey = String(key); return h; };
      let lastGroup = null;
      for (const it of sortForList(group.filter((x) => !nestedIds.has(x.id)), mode)) {
        if (mode !== 'plain') {
          const label = groupLabel(it, mode);
          if (label !== lastGroup) {
            listEl.append(heading(label, groupKey(it, mode)));
            lastGroup = label;
          }
        }
        const row = renderItem(it, items, mode);
        row.dataset.id = it.id; row.dataset.scope = scope; row.dataset.mode = mode; row.dataset.gkey = String(groupKey(it, mode));
        if (dragOk && it.type !== 'residence' && isMain(it)) row.dataset.drag = '1';
        listEl.append(row);
        if (expandedParent === it.id || selecting) { // its Side Quests, indented under it
          for (const k of sideMap.byParent.get(it.id) ?? []) {
            if (!visibleIds.has(k.id)) continue;
            const kr = renderItem(k, items, mode);
            kr.classList.add('side-row'); kr.dataset.id = k.id; kr.dataset.sub = '1'; kr.dataset.scope = scope; kr.dataset.parent = it.id;
            if (dragOk) { kr.dataset.drag = '1'; kr.dataset.mode = mode; kr.dataset.gkey = String(groupKey(it, mode)); } // held and dragged like a main card
            listEl.append(kr);
          }
        }
      }
    };
    const heading = (text, trip) => {
      const h = el('li', 'trip-head');
      h.setAttribute('role', 'presentation');
      if (trip) { const dot = el('i', 'trip-dot-sm'); dot.style.background = trip.color; h.append(dot); }
      h.append(el('span', 'trip-head-name', text));
      if (trip && tripSummary(trip)) h.append(el('small', '', tripSummary(trip)));
      return h;
    };

    if (!trips.length) {
      renderGroup(visible, listMode(items), null, 'none'); // no trips yet: the list is exactly as it was before trips existed
    } else {
      for (const t of sortTrips(trips)) {
        const group = visible.filter((i) => i.tripId === t.id);
        if (group.length || tripFilter === t.id) renderGroup(group, listMode(group), heading(t.name, t), t.id);
      }
      const loose = visible.filter((i) => !i.tripId && i.type !== 'residence');
      if (loose.length) renderGroup(loose, listMode(loose), heading('No trip'), 'none');
      const homes = visible.filter((i) => i.type === 'residence');
      if (homes.length) renderGroup(homes, 'plain', heading('Home'));
      if (!listEl.children.length) listEl.append(el('li', 'poi-none', 'Nothing matches this filter.'));
    }
    $('poi-drag-hint').hidden = !listEl.querySelector('li[data-drag="1"]');
    settleRows(before);
  }
  /** New rows ease in; rows that moved glide from their old place. Not on the first drawing, and not with reduced motion. */
  function settleRows(before) {
    if (reduced() || !before.size) return;
    for (const li of listEl.querySelectorAll('li[data-id]')) {
      const was = before.get(li.dataset.id);
      if (was === undefined) { li.classList.add('enter'); continue; }
      const dy = was - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 4) li.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: 240, easing: EASE });
    }
  }

  // ---------- reordering by holding a row ----------
  /** The markers a drag works on: those of one trip (or none), without the Home marker. */
  const scopeMembers = (scope) => store.items().filter((i) => (i.tripId ?? 'none') === scope && i.type !== 'residence' && isMain(i)); // Side Quests are not reordered with the stops
  function applyMove(id, scope, mode, key, index) {
    const members = scopeMembers(scope);
    const targetKey = mode === 'day' && key !== 'none' ? Number(key) : key;
    const plan = planMove({ members, mode, movedId: id, targetKey, index, trip: scope === 'none' ? null : store.getTrip(scope), sides: sideQuestMap(store.items().filter((i) => (i.tripId ?? 'none') === scope)).byParent });
    if (!plan) return false;
    const res = store.setMany(plan.items);
    const m = plan.moved;
    const where = targetKey === 'none' ? 'out of the itinerary' : `to ${[m.date && dateLabel({ date: m.date }), tripLabel(m, tripOf(m))].filter(Boolean).join(' · ')}`;
    toast(`Moved “${m.name}” ${where}.${res.ok ? '' : ' The browser would not store it.'}`, 10000, { label: 'Undo', run: () => { store.setMany(res.previous); toast('Move undone.', 3000); } });
    return true;
  }
  /** Moves a Side Quest: under a main stop (`parent`, at `index` among its Side Quests) or onto a date heading (`head`). The new parent stays unfolded. */
  function applySideMove(id, scope, { parent, index, head, key }) {
    const items = store.items().filter((i) => (i.tripId ?? 'none') === scope);
    const plan = planSideMove({ items, movedId: id, parentId: head ? null : parent, index, date: head ? key : undefined });
    if (!plan) return false;
    const res = store.setMany(plan.items);
    if (!head) setExpanded(parent);
    toast(`${plan.summary}.${res.ok ? '' : ' The browser would not store it.'}`, 10000, { label: 'Undo', run: () => { store.setMany(res.previous); toast('Move undone.', 3000); } });
    return true;
  }
  /** A row was dropped (by the list or a day page of the Trips tab). */
  const dropRow = ({ id, scope, mode, key, index, sub, parent, kind }) => {
    if (sub) applySideMove(id, scope, { parent, index, head: kind === 'head', key });
    else applyMove(id, scope, mode, key, index);
  };
  /** Alt + arrow on a row: one place up or down (a Side Quest: among its siblings). True when something moved. */
  const stepRow = (id, scope, mode, dir) => {
    const me = store.get(id);
    if (me && isSub(me)) {
      const pid = subParent.get(id), to = stepSideIndex(sideMap.byParent.get(pid) ?? [], id, dir);
      return to !== null && applySideMove(id, scope, { parent: pid, index: to });
    }
    const slot = stepSlot(scopeMembers(scope), mode, id, dir);
    return !!slot && applyMove(id, scope, mode, slot.key, slot.index);
  };
  initReorder({
    list: listEl, scroller: listEl.closest('.sp-body') || listEl,
    // While a row is lifted, the trip's dates that have no markers yet appear as places to drop. They are added to the list as it is,
    // not by drawing it again: the row under the finger must stay in the page, or the touch loses its target and the browser scrolls instead.
    onLift: (scope) => {
      const trip = scope === 'none' ? null : store.getTrip(scope);
      if (!trip?.startDate || !trip.endDate) return;
      const heads = [...listEl.querySelectorAll(`li.day-head[data-scope="${scope}"]`)];
      if (!heads.length || heads.every((h) => h.dataset.gkey !== 'none' && !/^\d{4}-/.test(h.dataset.gkey))) return; // not a list of dates
      const have = new Set(heads.map((h) => h.dataset.gkey));
      for (let d = trip.startDate, n = 0; d <= trip.endDate && n < 62; d = addDays(d, 1), n++) {
        if (have.has(d)) continue;
        const h = el('li', 'day-head drop-only', groupLabel({ date: d }, 'date'));
        h.setAttribute('role', 'presentation'); h.dataset.scope = scope; h.dataset.gkey = d;
        const later = [...listEl.querySelectorAll(`li.day-head[data-scope="${scope}"]`)].find((x) => x.dataset.gkey === 'none' || x.dataset.gkey > d);
        if (later) later.before(h);
        else [...listEl.querySelectorAll(`li[data-scope="${scope}"]`)].pop().after(h);
      }
    },
    onEnd: () => { for (const h of listEl.querySelectorAll('li.drop-only')) h.remove(); },
    onDrop: dropRow,
    onStep: (id, scope, mode, dir) => {
      if (stepRow(id, scope, mode, dir)) requestAnimationFrame(() => listEl.querySelector(`li[data-id="${CSS.escape(id)}"] .poi-item`)?.focus());
    },
  });

  onPrivacyChange(() => renderList()); // check-in switched on or off changes the rows

  // ---------- selecting several markers to delete ----------
  const selRow = $('poi-select-row'), selBar = $('poi-selbar'), selDelete = $('sel-delete'), selConfirm = $('sel-confirm');
  const selTrip = $('sel-trip'), selType = $('sel-type');
  const plural = (n) => `${n} marker${n === 1 ? '' : 's'}`;
  function renderSelectBar(items) {
    selRow.hidden = selecting || !items.length;
    selBar.hidden = !selecting;
    paintPins(); updateBanner();
    if (!selecting) return;
    const option = (sel, value, text) => { const o = el('option', '', text); o.value = value; sel.append(o); };
    selTrip.replaceChildren(); option(selTrip, '', 'Choose…');
    for (const t of sortTrips(store.trips())) option(selTrip, t.id, t.name);
    if (items.some((i) => !i.tripId)) option(selTrip, 'none', 'No trip');
    selType.replaceChildren(); option(selType, '', 'Choose…');
    for (const t of TYPES) if (items.some((i) => i.type === t.id)) option(selType, t.id, t.label);
    updateSelectBar();
  }
  function updateSelectBar() {
    const n = selected.size;
    selDelete.textContent = `Delete selected (${n})`;
    selDelete.disabled = n === 0;
    $('sel-side').disabled = $('sel-main').disabled = n === 0;
    if (n === 0) selConfirm.hidden = true;
    $('sel-confirm-delete').textContent = `Delete ${plural(n)}`;
    syncRoute();
    renderRoute();
    paintSelNums();
    paintPins(); updateBanner();
  }
  /**
   * Pins on the map follow the selection: a ring on the ticked ones, their route number once there are two or more,
   * and the pins the list filter hides are dimmed and cannot be ticked from the map.
   */
  function paintPins() {
    for (const [id, m] of markers) {
      const e = m.getElement();
      if (!e) continue;
      const on = selecting && selected.has(id);
      const i = routeOrder.indexOf(id);
      e.classList.toggle('sel-pin', on);
      e.classList.toggle('sel-dim', selecting && !visibleIds.has(id));
      if (on && selected.size >= 2 && i >= 0) e.dataset.n = String(i + 1); else delete e.dataset.n;
    }
  }
  /** A click on a pin while selecting: tick or untick it (the list row follows). Pins the filter hides are ignored. */
  function pickOnMap(id) {
    if (!visibleIds.has(id)) return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    const cb = listEl.querySelector(`li[data-id="${id}"] .sel-box`);
    if (cb) cb.checked = selected.has(id);
    selConfirm.hidden = true;
    updateSelectBar();
  }
  // ----- a route through the ticked places -----
  let routeOrder = [];            // the ticked places in route order (tick order, until the visitor moves them)
  let routeMode = loadPrefs().mapMode ?? MODES[0].id;
  const routeListeners = new Set(); // the dashboard draws the route and hears about every change
  /** Keeps routeOrder to the ticked places: new ticks go to the end, unticked ones drop out. */
  function syncRoute() {
    routeOrder = routeOrder.filter((id) => selected.has(id));
    for (const id of selected) if (!routeOrder.includes(id)) routeOrder.push(id);
  }
  /** The numbers 1, 2, 3 beside the ticked rows (only when there are two or more: that is a route). */
  function paintSelNums() {
    for (const li of listEl.querySelectorAll('li.selecting')) {
      const i = routeOrder.indexOf(li.dataset.id);
      const n = li.querySelector('.sel-num');
      if (n) n.textContent = selected.size >= 2 && i >= 0 ? String(i + 1) : '';
    }
    paintPins(); // the pins carry the same numbers
  }
  function renderRoute() { for (const fn of routeListeners) { try { fn(); } catch (e) { log.error('poi', 'a listener failed', e); } } }
  const routeStops = () => routeOrder.map((id) => store.get(id)).filter(Boolean);
  const routeApi = {
    /** The route as it stands: { selecting, stops (markers, in order), mode, canSort }. */
    state() { const stops = routeStops(); return { selecting, stops, mode: routeMode, canSort: stops.length > 0 && listMode(stops) !== 'plain' }; },
    onChange(fn) { routeListeners.add(fn); },
    setMode(m) { if (MODES.some((x) => x.id === m)) { routeMode = m; renderRoute(); } },
    move(id, d) { const i = routeOrder.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= routeOrder.length) return; [routeOrder[i], routeOrder[j]] = [routeOrder[j], routeOrder[i]]; renderRoute(); paintSelNums(); },
    reverse() { routeOrder.reverse(); renderRoute(); paintSelNums(); },
    sort() { const items = routeStops(); const mode = listMode(items); if (mode === 'plain') return; routeOrder = sortForList(items, mode).map((x) => x.id); renderRoute(); paintSelNums(); },
    remove(id) { selected.delete(id); selConfirm.hidden = true; renderList(); },
    done() { setSelecting(false); },
  };
  function setSelecting(on) {
    setTimeout(refreshIcons, 0); // while selecting, every Side Quest is on show so it can be ticked
    if (on) { setMode(null); map.closePopup(); panel.closeIfPhone(); } // exclusive with placing and editing; the map must be free to tap
    selecting = on; selected.clear(); selConfirm.hidden = true;
    renderList();
    renderRoute(); // selecting ended (or began): the route card follows
  }
  const addToSelection = (match) => {
    for (const it of store.items()) if (visibleIds.has(it.id) && match(it)) selected.add(it.id);
    selConfirm.hidden = true;
    renderList();
  };
  $('poi-select').addEventListener('click', () => setSelecting(true));
  $('sel-done').addEventListener('click', () => setSelecting(false));
  $('sel-all').addEventListener('click', () => addToSelection(() => true));
  $('sel-none').addEventListener('click', () => { selected.clear(); selConfirm.hidden = true; renderList(); });
  selTrip.addEventListener('change', () => { const v = selTrip.value; if (v) addToSelection((i) => (v === 'none' ? !i.tripId : i.tripId === v)); });
  selType.addEventListener('change', () => { const v = selType.value; if (v) addToSelection((i) => i.type === v); });
  selDelete.addEventListener('click', () => {
    const n = selected.size;
    if (!n) return;
    $('sel-confirm-text').textContent = `Delete ${plural(n)}? This can't be undone once the Undo message disappears. Export first if you want a copy.`;
    $('sel-export').textContent = 'Export first';
    selConfirm.hidden = false;
  });
  $('sel-cancel').addEventListener('click', () => { selConfirm.hidden = true; });
  $('sel-export').addEventListener('click', () => { $('poi-export').click(); $('sel-export').textContent = 'Exported'; });
  $('sel-confirm-delete').addEventListener('click', () => {
    const ids = [...selected];
    if (!ids.length) return;
    for (const id of ids) {
      const m = markers.get(id);
      if (m) layer.removeLayer(m);
      markers.delete(id); mw.forget(id); elev.forget(id);
    }
    map.closePopup();
    const res = store.removeMany(ids);
    setSelecting(false);
    const n = res.removed.length;
    toast(res.ok ? `Deleted ${plural(n)}.` : `Deleted ${plural(n)} for now, but the browser would not update its storage.`, 10000, {
      label: 'Undo',
      run: () => {
        const back = store.restore(res.removed);
        for (const { item } of res.removed) { const it = store.get(item.id); if (it && !markers.has(it.id)) addMarker(it); }
        toast(`Restored ${plural(back.restored)}.`, 4000);
      },
    });
  });

  function renderItem(it, items, gmode) {
    const li = el('li');
    const b = el('button', 'poi-item');
    b.type = 'button';
    b.title = 'Centre the map here';
    b.innerHTML = pinSvg(it.type);
    markCard(b, it.id); // highlighted while this marker (or, for a parent, one of its Side Quests) is selected
    const t = el('span', 't');
    const detail = it.note ? it.note.split('\n')[0] : `${fmt(it.lat)}, ${fmt(it.lon)}`;
    const when = [gmode === 'day' ? (stopNo(it) !== undefined && `Stop ${stopNo(it)}`) : tripLabel(it, tripOf(it)), gmode === 'date' && it.endDate && dateLabel(it)].filter(Boolean).join(' · ');
    const name = el('b', '', it.name);
    if (isSub(it)) name.append(' ', el('span', 'badge', 'Side Quest'));
    if (it.unverified) name.append(' ', el('span', 'badge', 'Unverified'));
    if (it.tripId && outsideTrip(it, store.getTrip(it.tripId))) name.append(' ', el('span', 'badge', 'Outside trip dates'));
    t.append(name, el('small', '', `${when ? `${when} · ` : ''}${typeOf(it.type).label} · ${detail}`));
    const d = distanceSummary(it, items);
    if (d) t.append(el('small', `dist-line${d.over ? ' over' : ''}`, d.text));
    b.append(t);
    if (selecting) {
      const cb = el('input', 'sel-box'); cb.type = 'checkbox'; cb.checked = selected.has(it.id); cb.setAttribute('aria-label', `Select ${it.name}`);
      const num = el('span', 'sel-num');
      const toggle = () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); selConfirm.hidden = true; updateSelectBar(); };
      cb.addEventListener('change', toggle);
      b.title = 'Select or clear';
      b.addEventListener('click', () => { cb.checked = !cb.checked; toggle(); });
      li.className = 'selecting';
      li.append(cb, num);
    } else {
      b.addEventListener('click', () => { if (isMain(it)) setExpanded(it.id); flyToItem(it.id); }); // a tap opens the marker and unfolds its Side Quests (any other card folds them)
    }
    // The card wraps the button and the Side Quest chip, so every card has the same width whether or not it has a chip.
    const card = el('div', 'poi-card');
    card.append(b);
    li.append(card);
    const kids = !selecting && isMain(it) ? (sideMap.byParent.get(it.id) ?? []).filter((k) => visibleIds.has(k.id)) : [];
    if (kids.length) {
      const open = expandedParent === it.id;
      const chip = el('button', 'side-chip', `${open ? '▴' : '▾'} ${kids.length}`); chip.type = 'button';
      chip.title = `${kids.length} Side Quest${kids.length === 1 ? '' : 's'}: ${open ? 'fold away' : 'show'}`; chip.setAttribute('aria-expanded', String(open)); chip.setAttribute('aria-label', chip.title);
      chip.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(open ? null : it.id); });
      card.classList.add('has-side'); card.append(chip);
    }
    const cell = checkinCell({ cin, store, id: it.id, ns: 'poi' }); // Check in, or what was recorded, at the right of the row
    if (cell) { li.classList.add('with-checkin'); li.append(cell); }
    return li;
  }

  /** Short distance line for the list: "0.8 km to home point · 3.2 km to accommodation · 8 km to home". null for markers that have none. */
  function distanceSummary(it, items) {
    if (!needsDistance(it)) return null;
    const b = nearestBases(it, items), { units, maxRangeM } = getDistanceSettings();
    const parts = BASE_TYPES.filter((t) => b[t.id].applies && b[t.id].found).map((t) => `${b[t.id].found.approx ? '≈' : ''}${fmtDistance(b[t.id].found.m, units)} to ${t.short}`);
    return parts.length ? { text: parts.join(' · '), over: beyondRange(b, maxRangeM) } : null;
  }

  function renderNote() {
    if (!store.persistent) {
      noteEl.textContent = 'Saving is unavailable here (private window or blocked storage). Markers last until this page is closed. Export to keep them.';
      return;
    }
    const last = store.lastBackup();
    noteEl.textContent = 'Saved only in this browser on this device, and never uploaded. '
      + (last ? `Last backup: ${new Date(last).toLocaleDateString()}. ` : 'Not backed up yet. ')
      + 'Clearing site data erases them, so export now and then.'
      + (store.items().some((i) => i.checkin) ? ' An export includes your check-in positions (where you were and when), so keep the file private.' : '')
      + (store.items().some((i) => i.type === 'residence') ? ' An export includes your Home marker (your residence), so keep the file private. Share links leave it out.' : '');
  }

  // ---------- weather summary ----------
  /** The shared automatic-weather and altitude status in Map Configs and Privacy. */
  function renderWxStatus() {
    const p = getPrivacy(), s = mw.status();
    const lines = [];
    if (!p.autoWeather) lines.push('Automatic weather is off.');
    else if (s.busy) lines.push('Weather: refreshing…');
    else {
      const parts = [];
      if (s.lastRefreshed) parts.push(`Weather last refreshed: ${formatWhen(s.lastRefreshed)}`);
      else parts.push(s.markers ? (s.failed ? 'Could not fetch weather yet' : 'Weather not refreshed yet') : 'No markers to fetch weather for yet');
      if (s.failed && s.lastRefreshed) parts.push('the latest refresh failed, showing earlier values');
      parts.push('refreshes when the page loads, at most every 30 minutes');
      lines.push(parts.join(' · ') + '.');
    }
    lines.push(p.fetchAltitude ? 'Ground elevation is on (exact location).' : 'Ground elevation is off.');
    const text = lines.join(' ');
    for (const el of mwStatusEls) el.textContent = text;
  }

  /** Straight-line distance to the nearest home point and the nearest hotel whose dates fit, in a marker window. */
  function renderDist(box, id) {
    box.replaceChildren();
    const it = store.get(id);
    if (!it || !needsDistance(it)) { box.hidden = true; return; }
    const items = store.items(), b = nearestBases(it, items), { units, maxRangeM } = getDistanceSettings();
    const lines = BASE_TYPES.filter((t) => b[t.id].applies);
    if (!lines.some((t) => b[t.id].exists)) {
      // a waypoint is told what to add; a hotel or home point simply has nothing to show until a Home marker exists
      box.hidden = lines.length < BASE_TYPES.length;
      if (!box.hidden) box.append(el('div', 'dist-empty', 'Add a Home point, Accommodation or Home marker to see how far this place is from it.'));
      return;
    }
    box.hidden = false;
    const over = beyondRange(b, maxRangeM);
    let approx = false;
    let shown = 0;
    for (const t of lines) {
      const r = b[t.id];
      if (!r.found) continue; // nothing to measure to (none in this trip, or none for these dates): say nothing
      shown++;
      const row = el("div", `dist-row${over && r.found && t.launch ? " over" : ""}`);
      const ic = el('span', 'dist-ic');
      ic.innerHTML = pinSvg(t.id); // built from constants only
      ic.firstChild.setAttribute('width', '16'); ic.firstChild.setAttribute('height', '21');
      const txt = el('div', 'dist-txt');
      approx ||= r.found.approx;
      txt.append(el('div', 'dist-v', `${r.found.approx ? '≈ ' : ''}${fmtDistance(r.found.m, units)} ${compass(r.found.bearing)}`), el('small', '', `from ${t.short} ${r.found.item.name}`));
      row.append(ic, txt);
      box.append(row);
    }
    box.hidden = shown === 0;
    if (over) box.append(el('small', 'stats-note over', `Beyond your ${fmtDistance(maxRangeM, units)} max range from every home point and accommodation that applies.`));
    if (approx) box.append(el('small', 'stats-note', '≈ means a location involved is unverified, so the distance is approximate.'));
  }

  // ---------- the day's route, and selecting a marker without its window ----------
  let detailsOn = loadPrefs().markerDetails !== false; // a click opens the details window (off: it only selects the marker)
  let shownDay = null;                                   // a day shown from the trip screen: { tripId, date }
  const routes = L.layerGroup().addTo(map);              // the selected marker's day, bold around it
  const dayLayer = L.layerGroup().addTo(map);            // a day shown from the trip screen, all thin
  const tagLayer = L.layerGroup().addTo(map);            // the name tag of a selected marker
  const tripColour = (tripId) => store.getTrip(tripId)?.color ?? '#1a73e8';
  /** The stops of one trip on one date, joined in stop order. Hotels and the Home marker are not part of the chain. */
  function chainOf(tripId, date) {
    return store.items().filter((i) => i.tripId === tripId && i.date === date && isMain(i) && i.order !== undefined && i.type !== 'hotel' && i.type !== 'residence')
      .sort((a, b) => a.order - b.order || String(a.created).localeCompare(String(b.created)));
  }
  /** One arrow from stop a to stop b: bold ones say how far; an overnight link (to the next or from the previous day) is bold and dashed. */
  function drawSeg(layer, a, b, color, bold, overnight = false) {
    const { units } = getDistanceSettings();
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: bold ? 6 : 2.5, opacity: bold ? 0.95 : 0.4, className: bold ? (overnight ? 'route-seg bold overnight' : 'route-seg bold') : 'route-seg', dashArray: overnight ? '12 9' : undefined, interactive: false, lineCap: 'round' }).addTo(layer);
    const pa = map.latLngToLayerPoint([a.lat, a.lon]), pb = map.latLngToLayerPoint([b.lat, b.lon]);
    const deg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
    const px = Math.hypot(pb.x - pa.x, pb.y - pa.y); // how long it is on screen: short ones get no arrow or label (they would sit on the pins)
    const at = (f) => [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
    const arrow = el('span', bold ? 'route-arrow bold' : 'route-arrow');
    arrow.style.setProperty('--rot', deg.toFixed(1) + 'deg'); arrow.style.color = color;
    arrow.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 5-10 5 3-5z"/></svg>'; // built from constants only
    if (px >= 36) L.marker(at(0.62), { icon: L.divIcon({ className: 'route-arrow-box', html: arrow, iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(layer);
    if (bold && px >= 80) {
      const lab = el('span', 'dist-label-text seg-label', fmtDistance(haversineM(a.lat, a.lon, b.lat, b.lon), units));
      lab.style.borderColor = color;
      L.marker(at(0.36), { icon: L.divIcon({ className: 'dist-label', html: lab, iconSize: null }), interactive: false, keyboard: false }).addTo(layer);
    }
  }
  /** Arrows between consecutive stops; those into and out of the selected stop are bold and say how far. */
  function drawChain(layer, chain, selId, color) {
    for (let i = 1; i < chain.length; i++) drawSeg(layer, chain[i - 1], chain[i], color, !!selId && (chain[i - 1].id === selId || chain[i].id === selId));
  }
  /** The days of a trip that have stops, in order. */
  const stopDates = (tripId) => [...new Set(store.items().filter((i) => i.tripId === tripId && i.date && isMain(i) && i.order !== undefined && i.type !== 'hotel' && i.type !== 'residence').map((i) => i.date))].sort();
  function redrawRoutes() {
    routes.clearLayers(); dayLayer.clearLayers();
    if (hideTrips) return; // trip routes are off with the trip markers
    if (shownDay) { const chain = chainOf(shownDay.tripId, shownDay.date); if (chain.length >= 2) drawChain(dayLayer, chain, null, tripColour(shownDay.tripId)); }
    const it = viewId && store.get(viewId);
    if (!it?.tripId || !it.date) return;
    const color = tripColour(it.tripId), chain = chainOf(it.tripId, it.date);
    if (chain.length >= 2) drawChain(routes, chain, it.id, color);
    const dates = stopDates(it.tripId);
    // a hotel is where the day ends: an arrow in from the last stop of its first day, and one out to the first stop of the day after it checks out
    if (it.type === 'hotel') {
      const day = [...dates].reverse().find((d) => d <= it.date);
      if (day) { const c = chainOf(it.tripId, day); if (c.length) drawSeg(routes, c[c.length - 1], it, color, true, true); }
      const morning = it.endDate && it.endDate > it.date ? it.endDate : addDays(it.date, 1);
      const next = dates.find((d) => d >= morning);
      if (next) { const c = chainOf(it.tripId, next); if (c.length) drawSeg(routes, it, c[0], color, true, true); }
      return;
    }
    // the first stop of a day follows the hotel of the night before (or, with none, the last stop of the day before); the last stop leads to
    // its night's hotel (or, with none, the first stop of the next day)
    const at = chain.findIndex((x) => x.id === it.id);
    if (at < 0) return;
    const di = dates.indexOf(it.date);
    const hotels = store.items().filter((h) => h.tripId === it.tripId && h.type === 'hotel' && h.date);
    const hotelFor = (night) => hotels.find((h) => h.date <= night && night <= (h.endDate && h.endDate > h.date ? addDays(h.endDate, -1) : h.date));
    if (at === 0 && di >= 0) {
      const hotel = hotelFor(addDays(it.date, -1));
      if (hotel) drawSeg(routes, hotel, it, color, true, true);
      else if (di > 0) { const before = chainOf(it.tripId, dates[di - 1]); if (before.length) drawSeg(routes, before[before.length - 1], it, color, true, true); }
    }
    if (at === chain.length - 1 && di >= 0) {
      const hotel = hotelFor(it.date);
      if (hotel) drawSeg(routes, it, hotel, color, true, true);
      else if (di < dates.length - 1) { const after = chainOf(it.tripId, dates[di + 1]); if (after.length) drawSeg(routes, it, after[0], color, true, true); }
    }
  }
  /** The selected marker's pin stands out. */
  function paintFocus() { for (const [id, m] of markers) m.getElement()?.classList.toggle('focused', id === viewId); }
  /** A click with details off: select the marker, show its links and a name tag (with an ⓘ that opens the window). */
  function selectMarker(id) {
    const it = store.get(id), m = markers.get(id);
    if (!it || !m) return;
    map.closePopup();
    tagLayer.clearLayers();
    pickId = null; viewId = id; relink();
    const box = el('div', 'name-tag');
    box.append(el('b', '', it.name));
    const info = el('button', 'name-tag-info', 'ⓘ'); info.type = 'button';
    info.setAttribute('aria-label', 'Open details for ' + it.name); info.title = 'Open details';
    info.addEventListener('click', (e) => { L.DomEvent.stop(e); openPopup(id); });
    box.append(info);
    L.marker(m.getLatLng(), { icon: L.divIcon({ className: 'name-tag-box', html: box, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 900 }).addTo(tagLayer);
  }
  /** Clears a selection made without a window (a click on blank map, or Escape). */
  function clearSelection() {
    if (!tagLayer.getLayers().length) return;
    tagLayer.clearLayers(); viewId = null; relink();
  }
  map.on('click', clearSelection);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSelection(); });
  // the switch: a button on the map and a switch in the Points of Interest tab share one setting
  let detailsBtn = null;
  const eyeLabel = () => `Open details when I click a marker: ${detailsOn ? 'on (press to turn off)' : 'off (press to turn on)'}`;
  function setDetails(on) {
    detailsOn = on;
    savePrefs({ markerDetails: on ? null : false });
    $('poi-details').checked = on;
    for (const t of document.querySelectorAll('.poi-pop .pop-toggle')) t.dispatchEvent(new Event('detailschange'));
    for (const eye of document.querySelectorAll('.pop-eye')) { eye.classList.toggle('off', !on); eye.title = eyeLabel(); const t = eye.querySelector('.tool-label'); if (t) t.textContent = eyeLabel(); } // a window that is open follows
    if (detailsBtn) { detailsBtn.classList.toggle('off', !on); detailsBtn.setAttribute('aria-pressed', String(on)); detailsBtn.title = 'Marker details: ' + (on ? 'on' : 'off') + ' (click to switch)'; }
    if (on) clearSelection();
  }
  const DetailsControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'details-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'details'; a.setAttribute('aria-label', 'Open marker details when a marker is clicked');
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path class="slash" d="M4 3l16 18"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); setDetails(!detailsOn); });
      detailsBtn = a;
      return bar;
    },
  });
  new DetailsControl().addTo(map);
  $('poi-details').addEventListener('change', (e) => setDetails(e.target.checked));
  setDetails(detailsOn);

  // two map toggles on the left, under the other buttons: Side Quests (the same setting as the POI tab switch) and trip markers
  let sideBtn = null, tripBtn = null;
  // a button with a slash across it when the thing is off (same look as the ⓘ button)
  const ToggleControl = (icon, label, onClick, onAdded, tool) => L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'map-toggle', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = tool; a.setAttribute('aria-label', label);
      a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"/><path class="slash" d="M4 3l16 18"/></svg>`;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); onClick(); });
      onAdded(a);
      return bar;
    },
  });
  function sideBtnPaint() {
    if (!sideBtn) return;
    sideBtn.classList.toggle('off', !showAllSide); sideBtn.setAttribute('aria-pressed', String(showAllSide));
    sideBtn.title = 'Side Quests on the map: ' + (showAllSide ? 'all shown' : 'only the open stop\'s') + ' (click to switch)';
  }
  function tripBtnPaint() {
    if (!tripBtn) return;
    tripBtn.classList.toggle('off', hideTrips); tripBtn.setAttribute('aria-pressed', String(!hideTrips));
    tripBtn.title = 'Trip markers on the map: ' + (hideTrips ? 'hidden' : 'shown') + ' (click to switch)';
  }
  new (ToggleControl('M7 21V4M7 5h10l-2 3.5 2 3.5H7', 'Show Side Quests on the map', () => setShowAllSide(!showAllSide), (a) => { sideBtn = a; }, 'side-quests'))().addTo(map);
  new (ToggleControl('M4 8h16v11H4zM9 8V5h6v3M4 13h16', 'Show trip markers on the map', () => setHideTrips(!hideTrips), (a) => { tripBtn = a; }, 'trips'))().addTo(map);
  /** Takes the trip markers off the map (and their routes and Side Quest links) or puts them back. Lists and the Trips tab are unchanged. */
  function setHideTrips(on) {
    hideTrips = on; savePrefs({ hideTrips: on ? true : null });
    for (const [id, m] of markers) {
      const it = store.get(id);
      const hidden = hideTrips && !!it?.tripId;
      if (hidden && layer.hasLayer(m)) layer.removeLayer(m);
      else if (!hidden && !layer.hasLayer(m)) layer.addLayer(m);
      if (hidden && viewId === id) map.closePopup();
    }
    tripBtnPaint();
    redrawRoutes(); refreshIcons();
  }
  sideBtnPaint(); tripBtnPaint();

  /** Dashed lines on the map from the open marker to its nearest home point and hotel, labelled with the distance. */
  const links = L.layerGroup().addTo(map);
  let viewId = null; // the marker whose window is open
  /** The cards to mark in the lists: the selected stop's (a card just tapped counts at once) and, for a Side Quest, its parent's. */
  function cardIds() {
    const id = pickId ?? viewId, ids = new Set();
    if (id) { ids.add(id); const p = subParent.get(id); if (p) ids.add(p); }
    return ids;
  }
  /** Marks one card (a row of the POI list, or of a trip's day) as selected or not. `data-stop-id` is how paintCards finds the cards again. */
  function markCard(node, id, ids = cardIds()) {
    node.dataset.stopId = id;
    node.classList.toggle('is-sel', ids.has(id));
    if (id === (pickId ?? viewId)) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
  }
  function paintCards() { const ids = cardIds(); for (const n of document.querySelectorAll('[data-stop-id]')) markCard(n, n.dataset.stopId, ids); }
  const scrollToCard = (node) => node?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  /** A marker was clicked on the map: bring its card into view in the panel that is open (the POI list, or the trip's day in Trips). A Side Quest unfolds its parent first. */
  function revealCard(id) {
    const tab = panel.getTab();
    if (!panel.isOpen() || selecting || (tab !== 'poi' && tab !== 'trips')) return;
    const pid = subParent.get(id);
    if (pid && pid !== expandedParent) setExpanded(pid); // both lists are drawn again
    if (tab === 'poi') scrollToCard(listEl.querySelector(`li[data-id="${CSS.escape(id)}"]`));
    else for (const fn of revealListeners) { try { fn(id, tab); } catch (e) { log.error('poi', 'a listener failed', e); } }
  }
  /** Opens another marker's window from a button inside a window (Previous/Next, visit chip, Side Quest link) and scrolls the panel to its card, as a map click does. After the click, so the old window going away is not seen as a map click. */
  const goTo = (id) => setTimeout(() => { openPopup(id); revealCard(id); }, 0);
  function relink() {
    links.clearLayers();
    refreshIcons(); // the open or selected marker decides which Side Quests are on show
    redrawRoutes(); paintFocus(); paintCards();
    const it = viewId && store.get(viewId);
    if (!it || !needsDistance(it)) return;
    const b = nearestBases(it, store.items()), { units } = getDistanceSettings();
    for (const t of BASE_TYPES) {
      const f = b[t.id].found;
      if (!f) continue;
      const color = typeOf(t.id).color;
      L.polyline([[it.lat, it.lon], [f.item.lat, f.item.lon]], { color, weight: 3, opacity: 0.85, dashArray: '7 7', interactive: false }).addTo(links);
      const label = el('span', 'dist-label-text', `${f.approx ? '≈ ' : ''}${fmtDistance(f.m, units)}`);
      label.style.borderColor = color;
      L.marker([(it.lat + f.item.lat) / 2, (it.lon + f.item.lon) / 2], { icon: L.divIcon({ className: 'dist-label', html: label, iconSize: null }), interactive: false, keyboard: false }).addTo(links);
    }
  }
  map.on('popupopen', (e) => { tagLayer.clearLayers(); pickId = null; viewId = e.popup._poiId ?? null; relink(); });
  map.on('popupclose', (e) => { if (e.popup._poiId === viewId) { viewId = null; relink(); } });
  map.on('zoomend', () => { if (viewId || shownDay) redrawRoutes(); }); // the arrows turn with the map's scale

  /** Fills the tiles under the zone verdict in a marker window: elevation and the 5-hour weather, as enabled. */
  function renderStats(box, id) {
    box.replaceChildren();
    const p = getPrivacy();
    const tiles = [], notes = [];
    const f = (v, dp) => (v === null ? '–' : v.toFixed(dp));

    // The Home marker is the traveller's residence: it is never sent to weather or elevation services automatically.
    if (store.get(id)?.type === 'residence') {
      box.hidden = !(p.fetchAltitude || p.autoWeather);
      if (!box.hidden) box.append(el('small', 'stats-note', 'Your Home marker is never sent to weather or elevation services automatically. Use Show weather here for a forecast.'));
      return;
    }

    if (p.fetchAltitude) {
      const e = elev.get(id);
      tiles.push(tile('elev', 'Elevation', e.value !== null ? `${Math.round(e.value)} m` : e.loading ? '…' : '–'));
      notes.push(e.value !== null ? 'Ground elevation from a terrain model, approximate.' : e.failed ? 'Elevation unavailable right now.' : '');
    }
    if (p.autoWeather) {
      const s = mw.get(id), e = s.entry;
      if (!e) {
        const v = s.loading ? '…' : '–';
        tiles.push(tile('temp', 'Avg temp', v), tile('wind', 'Avg wind', v), tile('gust', 'Peak gust', v));
        if (!s.loading) notes.push('Weather unavailable right now.');
      } else {
        const limit = getWindLimit();
        const over = limit !== null && e.gust !== null && e.gust > limit;
        tiles.push(tile('temp', 'Avg temp', `${f(e.temp, 1)} °C`), tile('wind', 'Avg wind', `${f(e.wind, 1)} m/s`), tile('gust', 'Peak gust', `${f(e.gust, 1)} m/s`, over ? 'over' : ''));
        if (e.sd !== null && e.sd >= 0.01) notes.push(`❄ ${Math.round(e.sd * 100)} cm of snow on the ground`);
        if (e.temp !== null && e.temp <= 5) notes.push('Cold: batteries lose capacity and flight time');
        notes.push(`${s.outdated ? 'Outdated. ' : ''}Next ${e.n} h · updated ${formatWhen(e.t)}${s.failed ? ' (latest refresh failed)' : ''} · forecast from ${e.start} local time there`);
      }
    }
    box.hidden = !tiles.length;
    if (!tiles.length) return;
    box.append(statsGrid(tiles));
    if (p.autoWeather) {
      const outlook = rainOutlook(mw.get(id).entry);
      if (outlook) box.append(rainBlock(outlook));
    }
    for (const n of notes.filter(Boolean)) box.append(el('small', 'stats-note', n));
  }

  // ---------- markers ----------
  const tripOf = (it) => (it.tripId ? store.getTrip(it.tripId) : null);
  function computeSide(items) {
    sideMap = sideQuestMap(items);
    subParent = new Map();
    for (const [pid, list] of sideMap.byParent) for (const s of list) subParent.set(s.id, pid);
  }
  /** The main stop whose Side Quests are on show: the one open or selected on the map (or the parent of the open Side Quest). */
  const focusParent = () => { const v = viewId && store.get(viewId); return v ? (isSub(v) ? subParent.get(v.id) ?? null : v.id) : null; };
  /** A Side Quest is folded away until its parent is open, expanded in a list or being selected; one with no parent has nothing to fold into. */
  function sideHidden(it) {
    if (!isSub(it)) return false;
    const pid = subParent.get(it.id);
    return !!pid && !(showAllSide || selecting || pid === expandedParent || pid === focusParent());
  }
  const sideOf = (it) => ({ sub: isSub(it), hidden: sideHidden(it), count: sideMap.byParent.get(it.id)?.length ?? 0 });
  const iconOf = (it) => makeIcon(it.type, tripColor(it), isSub(it) ? '' : seqBadge(it, tripOf(it)), visitCount(it.id), sideOf(it));
  const sigOf = (it) => { const s = sideOf(it); return `${it.type}|${tripColor(it) ?? ''}|${isSub(it) ? '' : seqBadge(it, tripOf(it))}|${visitCount(it.id)}|${s.sub ? 1 : 0}${s.hidden ? 1 : 0}${s.count}`; };
  const sideLinks = L.layerGroup().addTo(map); // dotted lines from the Side Quests on show to their main stop
  function drawSideLinks() {
    sideLinks.clearLayers();
    for (const pid of new Set([expandedParent, focusParent()])) {
      const parent = pid && store.get(pid);
      if (!parent) continue;
      for (const s of sideMap.byParent.get(pid) ?? []) {
        if (sideHidden(s) || (hideTrips && (parent.tripId || s.tripId))) continue;
        L.polyline([[parent.lat, parent.lon], [s.lat, s.lon]], { color: tripColor(parent) ?? '#546e7a', weight: 2, opacity: 0.8, dashArray: '2 6', interactive: false }).addTo(sideLinks);
      }
    }
  }
  /** Unfolds the Side Quests of one main stop in the lists (and on the map), or folds them all (null). */
  function setExpanded(id) {
    const next = id && sideMap.byParent.has(id) ? id : null;
    if (next === expandedParent) return;
    expandedParent = next;
    refreshIcons(); renderList();
    for (const fn of expandListeners) { try { fn(); } catch (e) { log.error('poi', 'a listener failed', e); } }
  }
  function addMarker(item) {
    const m = L.marker([item.lat, item.lon], { icon: iconOf(item), title: item.name, alt: item.name, keyboard: true, riseOnHover: true });
    m._sig = sigOf(item);
    m.on('click', () => {
      if (suppressClick) return;
      if (selecting) { pickOnMap(item.id); return; }
      if (detailsOn) openPopup(item.id); else selectMarker(item.id);
      revealCard(item.id); // the open panel scrolls to this marker's card
    });
    markers.set(item.id, m);
    if (!(hideTrips && item.tripId)) layer.addLayer(m);
    paintPins();
  }
  /** Redraws any pin whose type or trip colour changed (a trip was edited or deleted, a marker was re-tagged). */
  function refreshIcons() {
    const items = store.items();
    visitMap = visitGroups(items);
    computeSide(items);
    if (expandedParent && !sideMap.byParent.has(expandedParent)) expandedParent = null; // its Side Quests are gone
    for (const it of items) {
      const m = markers.get(it.id);
      if (m && m._sig !== sigOf(it)) { m.setIcon(iconOf(it)); m._sig = sigOf(it); }
    }
    paintPins();
    drawSideLinks();
  }
  function rebuildMarkers() {
    visitMap = visitGroups(store.items());
    computeSide(store.items());
    layer.clearLayers();
    markers.clear();
    for (const it of store.items()) addMarker(it);
  }
  const ensureVisible = () => {
    if (!map.hasLayer(layer)) { map.addLayer(layer); showSwitch.checked = true; }
  };

  // ---------- popup ----------
  function openPopup(id, edit = false) {
    const item = store.get(id), m = markers.get(id);
    if (!item || !m) return;
    // The pin is centred on the map and the window opens above it. A window too tall for that space scrolls inside, so it never
    // runs off the screen and the map is never moved to fit it. On a phone the sheet is closed first so it does not cover the pin.
    const OFFSET_Y = -36;
    panel.closeIfPhone();
    // Expanded: a tall window centred on the coordinate (covering the pin). Collapsed: a short one above the pin. The visitor's choice is remembered.
    expanded = windowExpanded();
    popup = L.popup({
      maxWidth: Math.min(340, window.innerWidth - 32), minWidth: Math.min(290, window.innerWidth - 40), offset: [0, OFFSET_Y],
      autoPan: false, closeOnClick: false, closeButton: true, maxHeight: windowMaxHeight(expanded), className: expanded ? 'is-expanded' : '',
    }).setLatLng(m.getLatLng());
    popup.setContent(popupContent(id, edit)); // after `popup` is set: the content reads it to close this window
    popup._poiId = id; // read by the popupopen/popupclose handlers that draw and remove the distance lines
    centreOn(map, m.getLatLng());
    popup.openOn(map);
  }

  let expanded = true; // whether the open marker window is expanded
  const windowExpanded = () => { const v = loadPrefs().windowExpanded; return typeof v === 'boolean' ? v : defaultExpanded(); };
  const windowMaxHeight = (on) => (on ? expandedMaxHeight(map) : popupMaxHeight(map, -36));
  /** Switches the open window between expanded and collapsed in place (no reopening, so a form or scroll position survives). */
  function setWindowMode(on) {
    expanded = on;
    savePrefs({ windowExpanded: on });
    if (!popup) return;
    popup.options.maxHeight = windowMaxHeight(on);
    popup.getElement()?.classList.toggle('is-expanded', on);
    popup.update();
  }

  function popupContent(id, startEditing) {
    const root = el('div', 'pop poi-pop');
    const win = popup; // this window's own popup (read now, while it is the one being opened)
    let editing = false; // the edit form is up: a swipe does not close the window then
    // swipe left or right anywhere, or up or down from the top bar (with the close and collapse buttons) or the previous / next footer
    onPopupSwipe(root, { close: () => win.close(), enabled: () => !editing, borders: (t) => !!t.closest('.pop-bar, .pop-seq, .pop-toggle, .pop-close') });

    function view() {
      editing = false;
      const it = store.get(id);
      if (!it) return;
      root.replaceChildren();

      // header: pin, type and name; coordinates underneath
      const toggle = el('button', 'pop-toggle'); toggle.type = 'button';
      // both arrows are always there and CSS shows one: replacing the clicked element mid-click would make Leaflet close the window
      toggle.innerHTML = '<svg class="ic-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg><svg class="ic-down" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      const paintToggle = () => {
        if (!detailsOn) { // details off: the button tucks the window away into the name tag's ⓘ
          toggle.setAttribute('aria-label', 'Hide the window (back to the name tag)'); toggle.title = 'Hide into the ⓘ'; toggle.setAttribute('aria-expanded', 'true');
          return;
        }
        toggle.setAttribute('aria-label', expanded ? 'Collapse window' : 'Expand window'); toggle.title = expanded ? 'Collapse' : 'Expand'; toggle.setAttribute('aria-expanded', String(expanded));
      };
      paintToggle();
      toggle.addEventListener('detailschange', paintToggle); // the setting changed while this window is open
      toggle.addEventListener('click', () => { if (!detailsOn) { selectMarker(id); return; } setWindowMode(!expanded); paintToggle(); });
      // expanded: Leaflet's close button sits on the popup container, which the expanded layout moves away from this window, so the window has its own
      const close = el('button', 'pop-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.title = 'Close';
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      close.addEventListener('click', () => popup?.close());
      root.append(toggle, close);
      const trip0 = tripLabel(it, store.getTrip(it.tripId));
      const phone = window.matchMedia('(max-width: 520px)').matches;
      // the eye: the same setting as the map button and the switch in the Points of Interest tab
      const tEye = { icon: 'eye', label: eyeLabel(), cls: detailsOn ? 'pop-eye' : 'pop-eye off', onClick: () => { const turningOff = detailsOn; setDetails(!detailsOn); if (turningOff) selectMarker(id); } };
      const tEdit = { icon: 'edit', label: 'Edit', onClick: () => setTimeout(editForm, 0) };
      // swap the contents after the click has finished: removing the clicked button mid-click would make Leaflet close the window
      const tVisit = { icon: 'visit', label: 'Add visit', onClick: () => setTimeout(() => addVisit(id), 0) };
      const tDelete = { icon: 'trash', label: 'Delete', danger: true, onClick: () => remove(id) };
      const canSub = !NOT_SUB.has(it.type); // a Home point, Hotel or Home marker is never a Side Quest
      const tSide = { icon: 'flag', label: isSub(it) ? 'Make main stop' : 'Make Side Quest', onClick: () => setTimeout(() => { if (convert(id, !isSub(it))) openPopup(id); }, 0) };
      const isHome = it.type === 'residence';
      root.append(toolBar({
        caption: [typeOf(it.type).label, isSub(it) && 'Side Quest', trip0].filter(Boolean).join(' · '),
        tools: phone ? [tEye, tEdit] : isHome ? [tEye, tEdit, tDelete] : [tEye, tEdit, tVisit, ...(canSub ? [tSide] : []), tDelete],
        menu: phone ? (isHome ? [tDelete] : [tVisit, ...(canSub ? [tSide] : []), tDelete]) : [],
      }));
      const head = el('div', 'pop-head');
      const badge = el('span', 'pop-badge');
      badge.innerHTML = pinSvg(it.type); // built from constants only
      badge.firstChild.setAttribute('width', '26'); badge.firstChild.setAttribute('height', '35');
      const titles = el('div', 'pop-titles');
      titles.append(el('h3', '', it.name));
      const tripRec = it.tripId ? store.getTrip(it.tripId) : null;
      if (tripRec) {
        const line = el('div', 'pop-trip');
        const dot = el('i', 'trip-dot-sm'); dot.style.background = tripRec.color;
        line.append(dot, tripRec.name);
        titles.append(line);
      }
      if (it.date) titles.append(el('div', 'pop-dates', dateLabel(it)));
      const coordRow = el('div', 'coords-row');
      coordRow.append(el('span', 'coords', `${fmt(it.lat)}, ${fmt(it.lon)}`), mapLinkIcons({ lat: it.lat, lon: it.lon, name: it.name, home: it.type === 'residence' }));
      titles.append(coordRow);
      { const stamp = checkinStamp({ cin, store, id }); if (stamp) titles.append(stamp); }
      head.append(badge, titles);
      root.append(head);
      const visits = visitMap.get(id);
      if (visits) {
        // the same place saved for other dates: each visit is a button that switches the window to it
        const strip = el('div', 'pop-visits');
        strip.append(el('span', 'pop-visits-label', `${visits.length} visits here`));
        for (const v of visits) {
          const chip = el('button', 'chip visit-chip', visitLabel(v, { trip: store.getTrip(v.tripId), tripName: v.tripId && v.tripId !== it.tripId ? store.getTrip(v.tripId)?.name ?? '' : '' }));
          chip.type = 'button';
          if (v.id === id) chip.setAttribute('aria-current', 'true');
          else chip.addEventListener('click', () => goTo(v.id));
          strip.append(chip);
        }
        root.append(strip);
      }
      if (tripRec && outsideTrip(it, tripRec)) {
        const w = el('div', 'trip-warn');
        w.append(el('strong', '', 'Outside the trip\'s dates'), el('small', '', `This marker is dated ${dateLabel(it)}, but the trip runs ${tripDatesLabel(tripRec)}. Change one of them if that is a mistake.`));
        root.append(w);
      }

      // a location that came from an AI or a name lookup is a guess until someone has looked at it
      if (it.unverified) {
        const u = el('div', 'unverified');
        u.append(el('strong', '', 'Unverified location'), el('small', '', 'It came from an AI or a name lookup. Check it on the map, then mark it as checked.'));
        const ok = el('button', 'btn small', 'Mark as checked'); ok.type = 'button';
        ok.addEventListener('click', () => setTimeout(() => {
          store.update(id, { unverified: false });
          view();
          popup?.update();
        }, 0)); // deferred like Edit: the button is removed by the redraw
        u.append(ok);
        root.append(u);
      }

      // the verdict, most prominent
      const zone = el('div', 'zone');
      zone.append(el('div', 'status skeleton', 'Checking zone…'));
      root.append(zone);
      checkPoint(it.lat, it.lon)
        .then((res) => { zone.replaceChildren(statusEl(zoneSummary(res))); popup?.update(); })
        .catch(() => { zone.replaceChildren(el('div', 'status unk', 'Zone check unavailable right now.')); });

      // the numbers (elevation and the 5-hour weather, when enabled), then how far this is from the nearest home point and hotel
      const dist = el('div', 'dist-wrap');
      const stats = el('div', 'stats-wrap');
      wxLine = { id, render: () => { renderDist(dist, id); renderStats(stats, id); } };
      wxLine.render();
      root.append(stats, weatherButton(() => { map.closePopup(); showWeather(it.lat, it.lon, it.name); }), dist); // conditions first, distances after
      elev.ensure(id); // no-op unless ground elevation is on

      if (it.note) root.append(el('p', 'note', it.note));
      { // Side Quests: this main stop's own, or the main stop a Side Quest hangs from
        const kids = sideMap.byParent.get(id) ?? [];
        const par = isSub(it) ? store.get(subParent.get(id)) : null;
        if (kids.length || par) {
          const box = el('div', 'pop-side');
          const jump = (target, text) => { const bt = el('button', 'pop-side-btn', text); bt.type = 'button'; bt.addEventListener('click', () => goTo(target.id)); return bt; };
          if (par) box.append(el('small', '', 'Side Quest near'), jump(par, par.name));
          else { box.append(el('small', '', `Side Quests (${kids.length})`)); for (const k of kids) box.append(jump(k, k.name)); }
          root.append(box);
        }
      }

      root.append(disclaimer());

      // previous / next stop of the trip, in itinerary order, pinned to the bottom of the window
      const seq = it.tripId ? tripSequence(store.items(), it.tripId) : [];
      const at = seq.findIndex((x) => x.id === id);
      if (at >= 0 && seq.length > 1) {
        const bar = el('div', 'pop-seq');
        const stopBtn = (target, arrow, word) => {
          const b = el('button', 'pop-seq-btn'); b.type = 'button';
          b.textContent = arrow === '‹' ? `‹ ${word}` : `${word} ›`;
          if (!target) { b.disabled = true; return b; }
          const where = [dayText(dayInfo(target, tripOf(target))), stopNo(target) !== undefined && `Stop ${stopNo(target)}`].filter(Boolean).join(' · ');
          b.title = `${word} stop: ${target.name}${where ? ` (${where})` : ''}`;
          b.setAttribute('aria-label', b.title);
          b.addEventListener('click', () => goTo(target.id));
          return b;
        };
        bar.append(stopBtn(seq[at - 1], '‹', 'Previous'), el('span', 'pop-seq-pos', `${at + 1} of ${seq.length}`), stopBtn(seq[at + 1], '›', 'Next'));
        root.append(bar);
      }
    }

    function editForm() {
      const it = store.get(id);
      if (!it) return;
      editing = true;
      wxLine = null; // the form has no weather line
      root.replaceChildren();
      const form = el('form');
      const name = el('input'); name.type = 'text'; name.maxLength = 80; name.value = it.name; name.required = true;
      const type = el('select');
      for (const t of TYPES) { const o = el('option', '', t.label); o.value = t.id; o.selected = t.id === it.type; type.append(o); }
      const note = el('textarea'); note.maxLength = 500; note.value = it.note; note.rows = 3;
      // The stop is optional. The day is not typed in: it follows from the date and the trip's start date.
      const order = el('input'); order.type = 'number'; order.min = '1'; order.max = '999'; order.step = '1'; order.placeholder = 'optional'; order.value = it.order ?? '';
      // Dates are optional too. The end date is for a stay of several days (a hotel), and only makes sense after a start date.
      const date = el('input'); date.type = 'date'; date.min = '2000-01-01'; date.max = '2100-12-31'; date.value = it.date ?? '';
      const endDate = el('input'); endDate.type = 'date'; endDate.max = '2100-12-31'; endDate.value = it.endDate ?? '';
      const syncEnd = () => { endDate.disabled = !date.value; endDate.min = date.value || '2000-01-01'; if (!date.value) endDate.value = ''; };
      date.addEventListener('input', syncEnd);
      syncEnd();
      const lab = (text, input) => { const l = el('label', '', text); l.append(input); return l; };
      const when = el('div', 'two'); when.append(lab('Start date', date), lab('End date', endDate));
      const trip = el('div'); trip.append(lab('Stop in the day', order));
      const dayLine = el('small', 'form-hint day-line');

      // Trip: which trip the marker belongs to. A Home marker (a residence) belongs to none, so the field goes away for that type.
      const tripPick = el('select');
      const none = el('option', '', 'No trip'); none.value = ''; tripPick.append(none);
      for (const t of sortTrips(store.trips())) { const o = el('option', '', t.name); o.value = t.id; tripPick.append(o); }
      const nw = el('option', '', 'New trip…'); nw.value = '__new'; tripPick.append(nw);
      tripPick.value = it.tripId ?? '';
      let lastTrip = tripPick.value;
      const tripLab = lab('Trip', tripPick);
      const hint = el('small', 'form-hint warn');
      const showHint = () => {
        const t = store.getTrip(tripPick.value);
        hint.textContent = t && outsideTrip({ date: date.value || undefined, endDate: endDate.value || undefined }, t)
          ? `That date is outside the trip's dates (${tripDatesLabel(t)}). You can still save it.` : '';
      };
      const syncTripField = () => { tripLab.hidden = type.value === 'residence'; };
      type.addEventListener('change', syncTripField);

      // Side Quest: an optional stop near a main stop. Not for a Home point, Hotel or Home marker. "Near" picks the main stop it hangs from (the nearest one by default).
      const subBox = el('input'); subBox.type = 'checkbox'; subBox.checked = isSub(it); subBox.id = 'edit-side';
      const subLab = el('label', 'check-row'); subLab.setAttribute('for', 'edit-side');
      subLab.append(subBox, el('span', '', 'Side Quest: an optional stop near a main stop'));
      const nearPick = el('select');
      const nearLab = lab('Near', nearPick); nearLab.classList.add('near-lab');
      const fillNear = () => {
        const keep = nearPick.value || (isSub(it) ? it.parentId ?? '' : '');
        nearPick.replaceChildren();
        const auto = el('option', '', 'The nearest main stop (automatic)'); auto.value = ''; nearPick.append(auto);
        const tid = tripPick.value || null;
        const mains = store.items().filter((m) => m.id !== id && isMain(m) && m.type !== 'residence' && (m.tripId ?? null) === tid);
        for (const m of sortForList(mains, listMode(mains))) {
          const o = el('option', '', [m.name, m.date && dateLabel(m)].filter(Boolean).join(' · ')); o.value = m.id; nearPick.append(o);
        }
        nearPick.value = [...nearPick.options].some((o) => o.value === keep) ? keep : '';
      };
      const syncSub = () => {
        subLab.hidden = NOT_SUB.has(type.value);
        const on = subBox.checked && !subLab.hidden;
        nearLab.hidden = !on;
        trip.hidden = on; // a Side Quest has no stop number of its own
      };
      subBox.addEventListener('change', () => { if (!subBox.checked && isSub(it)) order.value = ''; syncSub(); });
      type.addEventListener('change', syncSub);
      tripPick.addEventListener('change', fillNear);
      fillNear();
      syncSub();
      tripPick.addEventListener('change', () => {
        if (tripPick.value === '__new') { // hand over to the Trips tab, which tags this marker once the trip is saved
          tripPick.value = lastTrip;
          setTimeout(() => { map.closePopup(); newTripHandler?.(id); }, 0);
          return;
        }
        lastTrip = tripPick.value;
        showHint();
      });
      // which day the date is, worked out from the trip (nothing to type)
      const paintDay = () => {
        const t = store.getTrip(tripPick.value), d = isoDate(date.value);
        const info = d ? dayInfo({ date: d, endDate: isoDate(endDate.value) || undefined }, t) : null;
        dayLine.textContent = tripLab.hidden || !t ? (it.day !== undefined && !d ? `Day ${it.day} (kept from before: give this marker a date and the day is worked out)` : '')
          : !t.startDate ? 'Add dates to the trip to see day numbers.'
          : !d ? 'Pick a date to see which day of the trip it is.'
          : info ? `${dayText(info)} of the trip (worked out from the date)` : 'This date is outside the trip, so it has no day.';
      };
      tripPick.addEventListener('change', paintDay);
      type.addEventListener('change', paintDay);
      date.addEventListener('input', () => { showHint(); paintDay(); });
      endDate.addEventListener('input', () => { showHint(); paintDay(); });
      syncTripField();
      showHint();
      paintDay();

      const acts = el('div', 'acts');
      const save = el('button', 'btn small primary', 'Save'); save.type = 'submit';
      const cancel = el('button', 'btn small', 'Cancel'); cancel.type = 'button';
      cancel.addEventListener('click', () => setTimeout(view, 0)); // deferred for the same reason as Edit
      acts.append(save, cancel);
      form.append(lab('Name', name), lab('Type', type), subLab, tripLab, nearLab, when, dayLine, trip, hint, el('small', 'form-hint', 'Trip, dates and stop are all optional. Use an end date for a stay of several days.'), lab('Note', note), acts);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const sub = subBox.checked && !NOT_SUB.has(type.value);
        const res = store.update(id, {
          name: name.value, type: type.value, note: note.value, order: sub ? (isSub(it) ? it.order : undefined) : posInt(order.value), date: isoDate(date.value), endDate: isoDate(endDate.value),
          isSub: sub, parentId: sub ? (nearPick.value || null) : null,
          tripId: type.value === 'residence' ? null : (tripPick.value || null), // a Home marker is never in a trip
        });
        if (!res.item) { toast('Could not save that change.'); return; }
        if (!res.ok) toast('Changed for now, but the browser would not store it. Export your markers to keep them.');
        const m = markers.get(id);
        if (m) {
          m.setIcon(iconOf(res.item)); m._sig = sigOf(res.item);
          m.options.title = res.item.name;
          m.getElement()?.setAttribute('title', res.item.name);
        }
        view();
        popup?.update();
      });
      root.append(form);
      popup?.update();
      setTimeout(() => { name.focus(); name.select(); }, 0);
    }

    if (startEditing) editForm(); else view();
    return root;
  }

  function remove(id) {
    const m = markers.get(id);
    if (m) layer.removeLayer(m);
    markers.delete(id);
    mw.forget(id);
    elev.forget(id);
    const res = store.remove(id);
    map.closePopup();
    if (!res.ok) toast('Deleted for now, but the browser would not update its storage.');
  }

  /** Saves the same place again, with the dates and stop cleared, and opens its form to set them. */
  function addVisit(id) {
    const it = store.get(id);
    if (!it || it.type === 'residence') return;
    const res = store.add({ type: it.type, name: it.name, note: it.note, lat: it.lat, lon: it.lon, tripId: it.tripId, unverified: it.unverified });
    if (!res.item) { toast('Could not add that visit.'); return; }
    if (!res.ok) toast('Added for now, but the browser would not store it. Export your markers to keep them.');
    addMarker(res.item);
    mw.refresh([res.item.id]);
    openPopup(res.item.id, true); // the form, to give it its date
  }

  // ---------- Side Quests: turning a marker into one, and back ----------
  /** Turns one marker into a Side Quest (toSub) or back into a main stop. A Home point, Hotel or Home marker cannot be one. The message offers Undo. */
  function convert(id, toSub) {
    const it = store.get(id);
    if (!it || NOT_SUB.has(it.type) || isSub(it) === toSub) return false;
    const res = store.update(id, toSub ? sideQuestPatch(it, store.items()) : mainStopPatch(it, store.items()));
    if (!res.item) { toast('Could not change that marker.'); return false; }
    toast(toSub ? `“${it.name}” is now a Side Quest.` : `“${it.name}” is now a main stop.`, 10000, { label: 'Undo', run: () => { store.setMany([it]); toast('Change undone.', 3000); } });
    return true;
  }
  /** The same for every selected marker at once (Select mode). Selected markers are not each other's parents. */
  function convertMany(toSub) {
    const all = store.items(), chosen = new Set(selected);
    let work = all.slice(), skipped = 0;
    const changed = [];
    for (const id of selected) {
      const it = work.find((x) => x.id === id);
      if (!it || NOT_SUB.has(it.type)) { skipped++; continue; }
      if (isSub(it) === toSub) continue;
      const pool = toSub ? work.filter((i) => i.id === id || isSub(i) || !chosen.has(i.id)) : work;
      const merged = { ...it, ...(toSub ? sideQuestPatch(it, pool) : mainStopPatch(it, pool)) };
      work = work.map((x) => (x.id === id ? merged : x));
      changed.push(merged);
    }
    if (!changed.length) { toast(skipped ? 'Home points, Accommodation and Home markers cannot be Side Quests.' : 'Nothing to change.'); return; }
    const res = store.setMany(changed);
    toast(`${plural(changed.length)} ${changed.length === 1 ? 'is' : 'are'} now ${toSub ? (changed.length === 1 ? 'a Side Quest' : 'Side Quests') : (changed.length === 1 ? 'a main stop' : 'main stops')}.${skipped ? ` ${skipped} skipped (Home points, Accommodation and Home markers cannot be Side Quests).` : ''}`, 10000, { label: 'Undo', run: () => { store.setMany(res.previous); toast('Change undone.', 3000); } });
    renderList();
  }
  $('sel-side').addEventListener('click', () => convertMany(true));
  $('sel-main').addEventListener('click', () => convertMany(false));

  // ---------- placing ----------
  function place(latlng) { addAt(latlng, ''); }
  /** Saves a marker at a spot, of the chosen type and in the chosen trip, and opens its form. `name` defaults to the type's name. */
  function addAt(latlng, name, opts = {}) {
    const ll = latlng.wrap ? latlng.wrap() : L.latLng(latlng.lat, latlng.lng).wrap();
    const sub = opts.sub === true; // a Side Quest: never a Home point, Hotel or Home marker, so those chosen types become Other
    const t = typeOf(sub && NOT_SUB.has(selectedType) ? 'other' : selectedType);
    // new markers go into the chosen "current trip"; a Home marker is never in one
    const tripId = t.id === 'residence' ? undefined : currentTripId ?? undefined;
    const parent = sub ? defaultParent({ lat: ll.lat, lon: ll.lng, tripId }, store.items()) : null; // the nearest main stop of that trip
    const res = store.add({ type: t.id, name: (name || t.label).slice(0, 80), note: '', lat: ll.lat, lon: ll.lng, tripId, ...(sub && { isSub: true, parentId: parent?.id, date: parent?.date }) });
    if (!res.item) { toast('Could not add that marker.'); return; }
    if (!res.ok) toast('Added for now, but the browser would not store it. Export your markers to keep them.');
    ensureVisible();
    addMarker(res.item);
    markers.get(res.item.id)?.getElement()?.classList.add('drop'); // the new pin drops onto the map
    mw.refresh([res.item.id]); // no-op unless automatic weather is on
    openPopup(res.item.id, true); // opens in edit form so it can be named straight away
  }

  /** Adds several markers at once (a confirmed import). Returns { added: the stored markers, stored: false if the browser refused to save }. */
  function addMany(partials) {
    const added = [];
    let stored = true;
    for (const p of partials) {
      const res = store.add(p);
      if (!res.item) continue;
      if (!res.ok) stored = false;
      added.push(res.item);
      addMarker(res.item);
    }
    if (added.length) { ensureVisible(); mw.refreshMissing(); }
    return { added, stored };
  }

  /** Zooms the map to show the given markers, clear of a docked panel. */
  function fitToItems(list) {
    if (!list.length) return;
    panel.closeIfPhone();
    const sideways = panel.isOpen() ? $('panel').offsetWidth + 24 : 0;
    map.fitBounds(L.latLngBounds(list.map((i) => [i.lat, i.lon])), { maxZoom: 14, paddingTopLeft: [60, 90], paddingBottomRight: [sideways + 60, 60], animate: true });
  }

  // ---------- modes ----------
  function updateBanner() {
    if (mode === 'place') { bannerText.textContent = `Tap the map to place: ${typeOf(selectedType).label}`; bannerAction.textContent = 'Cancel'; }
    else if (mode === 'edit') { bannerText.textContent = 'Edit mode: map locked. Press and hold a pin, then drag it.'; bannerAction.textContent = 'Done'; }
    else if (selecting) { bannerText.textContent = selected.size ? `${plural(selected.size)} selected. Tap pins to add or remove.` : 'Tap pins on the map to select them.'; bannerAction.textContent = 'Done'; }
    bannerReview.hidden = mode || !selecting;
    banner.hidden = !mode && !selecting;
  }
  function setMode(next) {
    if (mode === next) return;
    if (next && selecting) setSelecting(false); // placing or editing ends selecting
    if (mode === 'edit') { map.dragging.enable(); container.classList.remove('is-editing'); }
    if (mode === 'place') container.classList.remove('is-placing');
    mode = next;
    if (mode) { map.closePopup(); clearSelection(); panel.closeIfPhone(); ensureVisible(); }
    if (mode === 'edit') { map.dragging.disable(); container.classList.add('is-editing'); }
    if (mode === 'place') container.classList.add('is-placing');
    editSwitch.checked = mode === 'edit';
    updateBanner();
  }
  bannerAction.addEventListener('click', () => { if (mode) setMode(null); else setSelecting(false); });
  bannerReview.addEventListener('click', () => panel.open('poi')); // the list, with the route and the delete button
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode) setMode(null); else if (selecting) setSelecting(false); } });
  editSwitch.addEventListener('change', () => setMode(editSwitch.checked ? 'edit' : null));
  function setShowAllSide(on) {
    showAllSide = on; savePrefs({ showSide: on ? true : null });
    $('poi-showside').checked = on; sideBtnPaint();
    refreshIcons();
  }
  $('poi-showside').checked = showAllSide;
  $('poi-showside').addEventListener('change', (e) => setShowAllSide(e.target.checked));
  showSwitch.addEventListener('change', () => {
    if (showSwitch.checked) map.addLayer(layer); else { map.removeLayer(layer); map.closePopup(); }
  });

  $('poi-place').addEventListener('click', () => setMode(mode === 'place' ? null : 'place'));
  $('poi-center').addEventListener('click', () => { setMode(null); panel.closeIfPhone(); place(map.getCenter()); });
  $('poi-here').addEventListener('click', () => {
    setMode(null);
    panel.closeIfPhone(); // on phones the sheet would hide the new marker's popup
    locateOnce().then((ll) => place(ll)).catch(() => { /* the location control has already said why */ });
  });

  // ---------- press and hold, then drag (edit mode) ----------
  function markerAt(target) {
    const icon = target.closest?.('.poi-pin');
    if (!icon) return null;
    for (const [id, m] of markers) if (m.getElement() === icon) return { id, m, icon };
    return null;
  }

  container.addEventListener('contextmenu', (e) => { if (mode === 'edit' && e.target.closest?.('.poi-pin')) e.preventDefault(); });
  container.addEventListener('pointerdown', (down) => {
    if (mode !== 'edit' || down.button > 0) return;
    const hit = markerAt(down.target);
    if (!hit) return;
    const { id, m, icon } = hit;
    const pid = down.pointerId, start = { x: down.clientX, y: down.clientY };
    let last = down, lifted = false, grab = null;

    const lift = () => {
      lifted = true;
      map.closePopup();
      icon.classList.add('lifted');
      navigator.vibrate?.(15);
      // keep the pin where it is under the finger or cursor: remember the offset between the pointer and the pin's tip
      grab = map.mouseEventToContainerPoint(last).subtract(map.latLngToContainerPoint(m.getLatLng()));
    };
    const timer = setTimeout(lift, HOLD_MS);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      last = ev;
      if (!lifted) { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > SLOP) stop(); return; } // moved before the hold: not a pick-up
      ev.preventDefault();
      m.setLatLng(map.containerPointToLatLng(map.mouseEventToContainerPoint(ev).subtract(grab)));
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      stop();
      if (!lifted) return; // a plain click: let the marker's click handler open its popup
      icon.classList.remove('lifted');
      const ll = m.getLatLng().wrap();
      const res = store.update(id, { lat: ll.lat, lon: ll.lng });
      mw.invalidate(id); // the old forecast and elevation belong to the old spot
      elev.invalidate(id);
      mw.refresh([id]);
      suppressClick = true; // the click that follows the release must not open the popup
      setTimeout(() => { suppressClick = false; }, 400);
      toast(res.ok ? 'Marker moved.' : 'Moved for now, but the browser would not store it. Export your markers to keep them.', 2500);
    };
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });

  // ---------- list click: recentre ----------
  function flyToItem(id) {
    const it = store.get(id);
    if (!it) return;
    pickId = id; paintCards(); // the card is marked at once; the marker follows when the map has moved
    ensureVisible();
    const wasOpen = panel.isOpen();
    panel.closeIfPhone();
    const sideways = wasOpen && panel.isOpen() ? $('panel').offsetWidth + 24 : 0; // keep the point clear of a docked panel
    map.fitBounds(L.latLngBounds([it.lat, it.lon], [it.lat, it.lon]), { maxZoom: Math.max(map.getZoom(), 15), paddingBottomRight: [sideways, 0], animate: true });
    // Listen only after starting the move: stopping an earlier pan fires its own moveend, which must not open the popup early.
    let opened = false;
    const open = () => { if (!opened) { opened = true; map.off('moveend', open); if (detailsOn) openPopup(id); else selectMarker(id); pickId = null; paintCards(); } }; // from here the selected marker decides
    map.on('moveend', open);
    setTimeout(open, 700); // the map may already be there, in which case no move happens
  }

  // ---------- backup ----------
  $('poi-export').addEventListener('click', () => {
    const items = store.items();
    if (!items.length) { toast('Nothing to export yet.'); return; }
    const blob = new Blob([JSON.stringify(toGeoJSON(items, store.trips()), null, 2)], { type: 'application/geo+json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `uav-companion-markers-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    store.markBackup();
    renderNote();
  });
  const fileInput = $('poi-file');
  $('poi-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { items, trips, skipped } = parseGeoJSON(await file.text());
      const res = store.merge(items, trips);
      rebuildMarkers();
      mw.refreshMissing(); // fetches only the imported markers that have no weather yet
      toast(`Imported ${res.added} marker${res.added === 1 ? '' : 's'}${res.addedTrips ? ` and ${res.addedTrips} trip${res.addedTrips === 1 ? '' : 's'}` : ''}`
        + `${res.skipped ? `, ${res.skipped} already here` : ''}${skipped ? `, ${skipped} skipped (not valid points)` : ''}.`
        + `${res.ok ? '' : ' The browser would not store them: export to keep them.'}`, 7000);
    } catch (e) {
      toast(e.message || 'Could not read that file.', 7000);
    }
  });

  // another tab changed the markers
  window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === TRIPS_KEY) { store.reload(); rebuildMarkers(); } });

  // ---------- distance settings: units and an optional max range ----------
  const unitSel = $('dist-units'), maxInput = $('dist-max'), maxUnit = $('dist-max-unit');
  function syncDistanceSettings() {
    const s = getDistanceSettings();
    unitSel.value = s.units;
    maxUnit.textContent = s.units === 'imperial' ? 'mi' : 'km';
    maxInput.value = s.maxRangeM === null ? '' : String(Math.round(toDisplay(s.maxRangeM, s.units) * 10) / 10);
  }
  unitSel.addEventListener('change', () => setDistanceSettings({ units: unitSel.value }));
  maxInput.addEventListener('change', () => {
    const { units, maxRangeM } = getDistanceSettings();
    const v = parseFloat(maxInput.value);
    if (maxInput.value.trim() === '' || !Number.isFinite(v)) { setDistanceSettings({ maxRangeM: null }); return; }
    const m = Math.round(fromDisplay(v, units));
    if (m < 100 || m > 200000) { // 100 m to 200 km: anything else is a typo, not a range
      toast(`Max range must be between ${fmtDistance(100, units)} and ${fmtDistance(200000, units)}. Leave it empty for no limit.`, 6000);
      syncDistanceSettings();
      return;
    }
    setDistanceSettings({ maxRangeM: m });
  });
  onDistanceSettings(() => { syncDistanceSettings(); renderList(); wxLine?.render(); relink(); });

  renderTypes();
  rebuildMarkers();
  syncDistanceSettings();
  renderList();
  renderNote();
  renderWxStatus();
  const savedTrip = loadPrefs().currentTrip;
  currentTripId = savedTrip && store.getTrip(savedTrip) ? savedTrip : null; // a saved choice only counts if that trip still exists
  renderTripSelects();
  renderList();
  // any change to the markers or trips (added, moved, edited, deleted, imported) also refreshes distances, pins and selectors
  store.onChange(() => {
    const had = currentTripId;
    renderTripSelects();
    if (had !== currentTripId) savePrefs({ currentTrip: currentTripId }); // the current trip was deleted
    refreshIcons(); renderList(); renderNote(); wxLine?.render(); relink();
  });
  mw.init(); // refreshes now if automatic weather is on and the last bulk refresh is more than 30 minutes old

  /** Shows only this trip's markers in the Points of Interest tab. */
  function showTrip(id) {
    tripFilter = store.getTrip(id) ? id : 'all';
    renderTripSelects(); renderList();
    panel.open('poi');
  }
  /** Zooms the map to a trip's markers. */
  function fitTrip(id) {
    const list = store.items().filter((i) => i.tripId === id);
    if (!list.length) { toast('This trip has no markers yet.'); return false; }
    fitToItems(list);
    return true;
  }

  return {
    store,
    route: routeApi,
    checkin: cin,
    showTrip, fitTrip,
    /** Flies to a marker and opens its window (the Trips tab's day list uses it). */
    openMarker: (id) => flyToItem(id),
    /** Draws the route of one day of a trip (thin) while the trip screen shows it; showDay(null) clears it. */
    showDay(tripId, date) { shownDay = tripId ? { tripId, date } : null; redrawRoutes(); },
    /** Zooms the map to these markers (a day of a trip). */
    fitItems(ids) { const list = ids.map((id) => store.get(id)).filter(Boolean); if (!list.length) { toast('Nothing to show on the map for this page.'); return false; } fitToItems(list); return true; },
    getCurrentTrip: () => currentTripId,
    setCurrentTrip(id) {
      currentTripId = id && store.getTrip(id) ? id : null;
      savePrefs({ currentTrip: currentTripId });
      renderTripSelects();
    },
    /** The Trips tab registers how a marker's "New trip…" choice starts a new trip. */
    setNewTripHandler(fn) { newTripHandler = fn; },
    /** Gives a marker a trip (or none), e.g. right after "New trip…" saved one. */
    tagMarker(markerId, tripId) { return store.update(markerId, { tripId: tripId ?? null }); },
    /** True if the click was used by a marker mode, so the normal point check should be skipped. */
    isBusy: () => mode !== null,
    addAt,
    handleMapClick(e) {
      if (mode === 'place') { setMode(null); place(e.latlng); return true; }
      return mode === 'edit';
    },
    /** For the privacy settings, which own the switches: they act on these and the tab status follows. */
    mw, elev,
    /** For the AI import: the current markers, bulk add, and zooming to what was added. */
    items: () => store.items(), addMany, fitToItems,
    /** For the Trips tab: which main stop has its Side Quests unfolded (one at a time), and a way to hear about changes. */
    moveStop: dropRow, stepStop: stepRow, // for the day pages of the Trips tab, which hold and drag with the same rules
    sideState: { expanded: () => expandedParent, set: setExpanded, onChange: (fn) => expandListeners.add(fn) },
    /** For the Trips tab: `mark` highlights a stop row it draws while its marker (or one of its Side Quests) is selected, `scrollTo` brings a row into view,
     *  and `onReveal(fn(id, tab))` hears that a marker was clicked on the map. */
    cards: { mark: markCard, scrollTo: scrollToCard, onReveal: (fn) => revealListeners.add(fn) },
  };
}
