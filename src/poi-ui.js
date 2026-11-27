// Points of interest on the map: placing, listing, editing, moving, backup. Data and storage live in poi.js.
import { log } from './log.js';
import L from 'leaflet';
import { KEY, TRIPS_KEY, TYPES, TYPE_GROUPS, groupOf, typeOf, pinSvg, createStore, toGeoJSON, parseGeoJSON, sortForList, posInt, isoDate, listMode, groupLabel, dateLabel, isMain, isSub, stopNo, NOT_SUB } from './poi.js';
import { createMarkerWeather, formatWhen, rainOutlook } from './markerweather.js';
import { createMarkerElevation } from './elevation.js';
import { getPrivacy, onPrivacyChange } from './privacy.js';
import { createCheckin, checkinCell, checkinStamp } from './checkin-ui.js';
import { reduced, EASE } from './motion.js';
import { getWindLimit } from './weather.js';
import { getDistanceSettings, setDistanceSettings, onDistanceSettings } from './units.js';
import { BASE_TYPES, needsDistance, nearestBases, beyondRange, fmtDistance, compass, toDisplay, fromDisplay, haversineM } from './distance.js';
import { sortTrips, tripSummary, tripDatesLabel, outsideTrip, todayISO, tripPhase } from './trips.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { visitGroups, visitLabel } from './places.js';
import { dayInfo, dayText, tripSequence, defaultParent, sideQuestPatch, mainStopPatch, sideQuestMap } from './trips.js';
import { mapLinkIcons } from './maplinks-ui.js';
import { MODES } from './maplinks.js';
import { planMove, planSideMove, stepSideIndex, stepSlot, groupKey, addDays } from './reorder.js';
import { initReorder } from './reorder-ui.js';
import { queryTerms, matches, newExpansion, scopeOpen, dayOpen, dayId, summarise, summaryText, isOutside, reveal as revealSection, prune as pruneSections, unlinkedSideQuests, SCOPE_HOME, mapHiddenReason, markerLabel } from './poi-model.js';
import { defaultExpanded } from './view.js';
import { el, statusEl, tile, statsGrid, rainBlock, disclaimer, toolBar } from './cards.js';
import { zoneExplanation } from './legends.js';
import { onPopupSwipe } from './swipe.js';
import { mascotEl } from './mascot-ui.js';
import { createMarkerContent, fmt, tripLabel } from './marker-content.js';
import { createMarkerMove } from './marker-move.js';
import { createMarkerHost } from './marker-host.js';
import { selectionLegs } from './route/legs.js';
import { createRouter } from './route/router.js';
import { createSpider } from './spider.js';
import { createRouteRenderer } from './route/render.js';
import { fmtDuration } from './route/geometry.js';

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
/** Short form for the pin: "D2·3", "D2" or "#3"; '' when the marker has neither a day nor a stop. */
const seqBadge = (it, trip) => { const d = dayInfo(it, trip)?.day, n = stopNo(it); return d !== undefined ? `D${d}${n !== undefined ? `·${n}` : ''}` : n !== undefined ? `#${n}` : ''; };
/** "Day 2 · Stop 3", or just one of them, or '' when the marker is not part of an itinerary. */

export function initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, locateOnce, panel }) {
  const store = createStore();
  const cin = createCheckin({ store, panel, toast }); // check-in at markers: opt-in, only while the panel shows them
  const layer = L.layerGroup().addTo(map);
  const markers = new Map(); // id -> L.Marker
  const container = map.getContainer();
  let selectedType = 'hotel'; // the picker opens on Accommodation, in Travel & Places; it is page state, never stored
  let activeGroup = groupOf(selectedType);
  let mode = null; // null | 'place' | 'edit'
  let filter = 'all';         // marker type filter
  let tripFilter = 'all';     // 'all' | 'none' | a trip id
  let query = '';             // the words typed in the saved-places search (page state; never stored, never changes a marker)
  let currentTripId = null;   // the trip new markers are put in (never applies to a Home marker)
  let newTripHandler = null;  // set by the Trips tab: starts a new trip and tags a marker with it
  let suppressClick = false;
  let visitMap = new Map();   // id -> every marker at the same spot (two or more), see places.js
  let sideMap = { byParent: new Map(), orphans: [] }; // Side Quests under their parent main stops (trips.js sideQuestMap)
  let subParent = new Map();  // Side Quest id -> its parent's id (a Side Quest with no parent is not in it)
  let expandedParent = null;  // the main stop whose Side Quests are unfolded in the lists (one at a time)
  const expansion = newExpansion(); // which trips and days are open in the saved list: this page only, so every reload starts folded (poi-model.js)
  let listForce = false;      // true while the list must show everything (selecting, a type or trip filter): sections read as open without changing `expansion`
  let listCollapsible = false; // there are trips, so the list has trip sections to fold
  let showAllSide = !!loadPrefs().showSide;
  let hideTrips = !!loadPrefs().hideTrips; // trip markers, their routes and Side Quest links are taken off the map
  const expandListeners = new Set();
  // What is on the map, besides the whole POI layer (#poi-show) and the global trip switch (hideTrips): a trip, or the markers with no trip, can be taken off
  // the map by hand. Device-local preferences (prefs.js); never part of a marker, a trip or a shared trip. The Home marker is never affected.
  const tripHidden = new Set(loadPrefs().tripHidden ?? []);
  let unassignedHidden = !!loadPrefs().unassignedHidden;
  let showCompleted = !!loadPrefs().showCompleted; // markers of completed trips are drawn on the map (off by default; this device only)
  // A trip shown on its own (Trips tab: Show this trip): page state only, never stored, never touches the switches above. null = the normal rules.
  let tripViewId = null;
  const viewListeners = new Set();
  const saveHidden = () => { while (tripHidden.size > 200) tripHidden.delete(tripHidden.values().next().value); savePrefs({ tripHidden: tripHidden.size ? [...tripHidden] : null, unassignedHidden: unassignedHidden ? true : null }); };
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

  const addCard = $('poi-add');
  const typesEl = $('poi-types'), listEl = $('poi-list'), filterEl = $('poi-filter'), countEl = $('poi-count');
  const emptyEl = $('poi-empty'), noteEl = $('poi-note'), editSwitch = $('poi-edit'), showSwitch = $('poi-show');
  emptyEl.classList.add('has-mascot'); emptyEl.prepend(mascotEl('thinking', 56));
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
  const tabsEl = el('div', 'type-tabs'); tabsEl.id = 'poi-type-tabs'; tabsEl.setAttribute('role', 'group'); tabsEl.setAttribute('aria-label', 'Marker type groups'); // buttons with aria-pressed, like the filter chips (role=tab is the panel's own tabs)
  const typeNow = el('p', 'hint type-now'); typeNow.id = 'poi-type-now'; typeNow.setAttribute('aria-live', 'polite');
  typesEl.before(tabsEl); typesEl.after(typeNow);
  /** Shows the buttons of the open group, marks the chosen one, and says which type is chosen (it may be in another group). */
  function paintPicker() {
    for (const b of tabsEl.children) {
      const on = b.dataset.group === activeGroup;
      b.setAttribute('aria-pressed', String(on));
      b.dataset.hasSelected = String(groupOf(selectedType) === b.dataset.group);
    }
    for (const b of typesEl.children) { b.hidden = groupOf(b.dataset.type) !== activeGroup; b.setAttribute('aria-checked', String(b.dataset.type === selectedType)); }
    typeNow.textContent = `Chosen: ${typeOf(selectedType).label}`;
  }
  /** The one place the chosen type changes (a click, or a Side Quest that cannot keep an Accommodation, Home point or Home type). */
  function setSelectedType(id) {
    if (!TYPES.some((t) => t.id === id)) return false;
    selectedType = id; activeGroup = groupOf(id);
    paintPicker();
    tripField.hidden = store.trips().length === 0 || selectedType === 'residence';
    if (mode === 'place') updateBanner();
    return true;
  }
  function renderTypes() {
    tabsEl.replaceChildren(); typesEl.replaceChildren();
    for (const g of TYPE_GROUPS) {
      const tab = el('button', 'chip', g.label);
      tab.type = 'button'; tab.id = 'type-tab-' + g.id; tab.dataset.group = g.id;
      tab.setAttribute('aria-controls', 'poi-types');
      tab.addEventListener('click', () => { activeGroup = g.id; paintPicker(); });
      tabsEl.append(tab);
    }
    for (const t of TYPE_GROUPS.flatMap((g) => g.types.map((id) => typeOf(id)))) {
      const b = el('button', 'type-btn');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === selectedType));
      b.dataset.type = t.id;
      b.title = t.hint; // "Home point" and "Home" are easy to mix up, so each type explains itself
      b.innerHTML = pinSvg(t.id); // built from constants only
      b.append(el('span', '', t.label));
      b.addEventListener('click', () => setSelectedType(t.id));
      typesEl.append(b);
    }
    paintPicker();
  }

  // ---------- list ----------
  const searchEl = $('poi-search'), clearEl = $('poi-filters-clear'), searchCount = $('poi-search-count');
  /** Says how many places match, and offers one button that clears the search and both filters. */
  function paintSearchState(searching, shown, total) {
    const filtered = filter !== 'all' || tripFilter !== 'all';
    searchCount.hidden = !searching && !filtered;
    searchCount.textContent = searching || filtered ? `${shown} of ${total} saved place${total === 1 ? '' : 's'} shown${searching ? ' for this search' : ' with this filter'}.` : '';
    clearEl.hidden = !searching && !filtered;
  }
  let searchTimer = 0;
  searchEl.addEventListener('input', () => { query = searchEl.value; cancelAnimationFrame(searchTimer); searchTimer = requestAnimationFrame(() => renderList()); });
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchEl.value) { e.stopPropagation(); searchEl.value = ''; query = ''; renderList(); } });
  /** Clears the search and both filters. Nothing else changes: not the folds, not a marker, not the current trip for new markers. */
  function resetFilters() { query = ''; searchEl.value = ''; filter = 'all'; tripFilter = 'all'; renderTripSelects(); renderList(); }
  clearEl.addEventListener('click', resetFilters);
  let renderPending = false; // a redraw asked for while a row is being dragged waits until the drag is over (the row under the finger must stay in the page)
  function renderList() {
    if (document.body.classList.contains('reordering')) { renderPending = true; return; }
    renderPending = false;
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
    const terms = queryTerms(query);
    const tripName = (i) => store.getTrip(i.tripId)?.name ?? '';
    const visible = items.filter((i) => (filter === 'all' || i.type === filter)
      && (tripFilter === 'all' || (tripFilter === 'none' ? !i.tripId : i.tripId === tripFilter))
      && matches(i, terms, tripName(i))); // the search looks at every saved marker, whatever is folded or drawn on the map
    paintSearchState(terms.length > 0, visible.length, items.length);
    visibleIds = new Set(visible.map((i) => i.id));
    const nestedIds = new Set(); // Side Quests listed under their (shown) main stop instead of in the flow
    for (const [pid, subs] of sideMap.byParent) if (visibleIds.has(pid)) for (const s of subs) if (visibleIds.has(s.id)) nestedIds.add(s.id);
    if (!items.length) selecting = false;
    listForce = selecting || filter !== 'all' || tripFilter !== 'all' || terms.length > 0;
    listCollapsible = trips.length > 0;
    pruneSections(expansion, trips.map((t) => t.id));
    const orphanIds = new Set(unlinkedSideQuests(items).map((u) => u.item.id));
    for (const id of [...selected]) if (!visibleIds.has(id)) selected.delete(id); // the count always matches what is shown
    renderSelectBar(items);
    $('poi-drag-hint').hidden = true; // shown below once the list is drawn, if any row can be dragged

    // One group of markers. Inside it: date headings once any marker has a date, else "Day N" headings once any has a day,
    // else a plain list, newest first. `mode` is decided by the caller so headings and order always agree.
    const renderGroup = (group, mode, head, scope = 'none') => {
      if (head) listEl.append(head);
      // dragging is for dated or day-numbered lists only, with no type filter on, and not while selecting
      const dragOk = !selecting && filter === 'all' && !terms.length && mode === 'date'; // no dragging in a search result
      const trip = scope === 'none' || scope === SCOPE_HOME ? null : store.getTrip(scope);
      const dayFold = listCollapsible && trip && mode !== 'plain'; // days fold inside a trip; Unassigned and Home have no day sections
      const heading = (label, key, outside) => {
        const h = el('li', 'day-head'); h.setAttribute('role', 'presentation'); h.dataset.scope = scope; h.dataset.gkey = String(key); h.dataset.dayKey = String(key);
        if (dayFold) { const b = secToggle(label, scope, String(key)); h.append(b); } else h.append(label);
        if (outside) h.append(el('span', 'out-tag', 'outside trip dates'));
        return h;
      };
      let lastGroup = null, lastOrphan = false;
      // a Side Quest with no main stop to hang from is listed last in its day, under a small heading (nothing about it is changed)
      const flow = sortForList(group.filter((x) => !nestedIds.has(x.id)), mode);
      const ordered = [];
      { let bucket = [], bucketKey = null; // per day group, in order, the unlinked Side Quests after the rest
        const flush = () => { ordered.push(...bucket.filter((x) => !orphanIds.has(x.id)), ...bucket.filter((x) => orphanIds.has(x.id))); bucket = []; };
        for (const it of flow) { const k = groupKey(it, mode); if (k !== bucketKey) { flush(); bucketKey = k; } bucket.push(it); }
        flush(); }
      for (const it of ordered) {
        if (mode !== 'plain') {
          const label = groupLabel(it, mode);
          if (label !== lastGroup) {
            listEl.append(heading(label, groupKey(it, mode), isOutside(it, trip, mode)));
            lastGroup = label; lastOrphan = false;
          }
        }
        if (orphanIds.has(it.id) && !lastOrphan) {
          const u = el('li', 'unlinked-head', 'Unlinked Side Quests'); u.setAttribute('role', 'presentation'); u.dataset.section = scope; u.dataset.dayKey = String(groupKey(it, mode));
          listEl.append(u);
        }
        lastOrphan = orphanIds.has(it.id);
        const row = renderItem(it, items, mode);
        row.dataset.id = it.id; row.dataset.scope = scope; row.dataset.mode = mode; row.dataset.gkey = String(groupKey(it, mode)); row.dataset.dayKey = String(groupKey(it, mode));
        if (dragOk && it.type !== 'residence' && isMain(it)) row.dataset.drag = '1';
        listEl.append(row);
        if (expandedParent === it.id || selecting) { // its Side Quests, indented under it
          for (const k of sideMap.byParent.get(it.id) ?? []) {
            if (!visibleIds.has(k.id)) continue;
            const kr = renderItem(k, items, mode);
            kr.classList.add('side-row'); kr.dataset.id = k.id; kr.dataset.sub = '1'; kr.dataset.scope = scope; kr.dataset.parent = it.id; kr.dataset.dayKey = String(groupKey(it, mode));
            if (dragOk) { kr.dataset.drag = '1'; kr.dataset.mode = mode; kr.dataset.gkey = String(groupKey(it, mode)); } // held and dragged like a main card
            listEl.append(kr);
          }
        }
      }
    };
    const heading = (text, trip, scope, group) => {
      const h = el('li', 'trip-head');
      h.setAttribute('role', 'presentation'); h.dataset.section = scope;
      const label = el('span', 'trip-head-name', text);
      if (scope !== SCOPE_HOME) { const b = secToggle('', scope, null); if (trip) { const dot = el('i', 'trip-dot-sm'); dot.style.background = trip.color; b.append(dot); } b.append(label); h.append(b); }
      else h.append(label);
      if (trip && tripSummary(trip)) h.append(el('small', '', tripSummary(trip)));
      if (scope !== SCOPE_HOME) h.append(el('small', 'sec-count', summaryText(summarise(group, trip))));
      if (scope !== SCOPE_HOME) { // whether this trip's markers are drawn on the map (this device only)
        const on = scope === 'none' ? !unassignedHidden : !tripHidden.has(scope);
        const v = el('button', 'vis-toggle', on ? 'On map' : 'Off map'); v.type = 'button'; v.dataset.visScope = scope;
        v.setAttribute('aria-pressed', String(on));
        v.setAttribute('aria-label', `${text}: ${on ? 'shown' : 'hidden'} on the map. ${on ? 'Hide' : 'Show'} on map`);
        v.title = on ? 'Hide these markers on the map' : 'Show these markers on the map';
        h.append(v);
        const why = !on ? '' : !map.hasLayer(layer) ? 'Markers are switched off on the map (Show markers on map).' : tripViewId && scope !== tripViewId ? 'Not drawn while one trip is shown on its own (Trips tab).' : hideTrips && scope !== 'none' ? 'Hidden for now by the trip markers button on the map.' : scope !== 'none' && !tripViewId && !showCompleted && tripPhase(trip, todayISO()) === 'completed' ? 'Completed trip: hidden on the map. Turn on Show completed trips to draw it.' : '';
        if (why) h.append(el('small', 'vis-note', why));
      }
      return h;
    };

    if (!trips.length) {
      renderGroup(visible, listMode(items), null, 'none'); // no trips yet: the list is exactly as it was before trips existed
    } else {
      for (const t of sortTrips(trips)) {
        const group = visible.filter((i) => i.tripId === t.id);
        if (group.length || tripFilter === t.id) renderGroup(group, listMode(group), heading(t.name, t, t.id, group), t.id);
      }
      const loose = visible.filter((i) => !i.tripId && i.type !== 'residence');
      if (loose.length) renderGroup(loose, listMode(loose), heading('No trip', null, 'none', loose), 'none');
      const homes = visible.filter((i) => i.type === 'residence');
      if (homes.length) renderGroup(homes, 'plain', heading('Home', null, SCOPE_HOME, homes), SCOPE_HOME);
      if (!listEl.children.length) listEl.append(el('li', 'poi-none', terms.length ? 'No saved place matches that search.' : 'Nothing matches this filter.'));
    }
    syncSections();
    $('poi-drag-hint').hidden = !listEl.querySelector('li[data-drag="1"]');
    settleRows(before);
  }
  // ---------- folding trips and days in the saved list (list only: the map is not touched) ----------
  /** A header's fold button. Its text is the label, so reading the heading still gives the label. */
  function secToggle(label, scope, day) {
    const b = el('button', 'sec-toggle'); b.type = 'button';
    b.dataset.section = scope; if (day !== null) b.dataset.day = day;
    if (label) b.append(label);
    b.setAttribute('aria-expanded', 'false');
    return b;
  }
  /** Hides the rows of folded trips and days (they stay in the page, so a drag and the keyboard still see the same list) and paints the buttons. */
  function syncSections() {
    for (const b of listEl.querySelectorAll('.sec-toggle')) {
      const day = b.dataset.day, scope = b.dataset.section;
      const open = day === undefined ? scopeOpen(expansion, scope, listForce) : dayOpen(expansion, scope, day, listForce);
      b.setAttribute('aria-expanded', String(open)); b.disabled = listForce;
      b.title = listForce ? 'Everything is shown while you select or filter' : open ? 'Fold' : 'Unfold';
    }
    for (const li of listEl.querySelectorAll('li[data-scope], li.day-head, li.unlinked-head')) {
      const scope = li.dataset.scope ?? li.dataset.section;
      let folded = false;
      if (listCollapsible && scope !== SCOPE_HOME && !listForce) {
        folded = !scopeOpen(expansion, scope);
        const dayKey = li.dataset.dayKey;
        if (!folded && dayKey !== undefined && scope !== 'none' && !li.classList.contains('day-head') && listEl.querySelector(`.sec-toggle[data-section="${CSS.escape(scope)}"][data-day]`)) folded = !dayOpen(expansion, scope, dayKey);
      }
      li.hidden = folded;
    }
  }
  listEl.addEventListener('click', (e) => {
    const vis = e.target.closest?.('.vis-toggle');
    if (vis) { setTripShown(vis.dataset.visScope, vis.getAttribute('aria-pressed') !== 'true'); return; }
    const b = e.target.closest?.('.sec-toggle');
    if (!b || b.disabled) return;
    const scope = b.dataset.section, day = b.dataset.day;
    const set = day === undefined ? expansion.scopes : expansion.days, key = day === undefined ? scope : dayId(scope, day);
    if (set.has(key)) set.delete(key); else set.add(key);
    syncSections();
  });
  /** Opens whatever holds a marker so its row can be seen. Nothing is stored; returns true when something opened. */
  function revealRow(id) {
    const it = store.get(id);
    if (!it || !revealSection(expansion, it, store.items())) return false;
    syncSections();
    return true;
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
    onEnd: () => { for (const h of listEl.querySelectorAll('li.drop-only')) h.remove(); if (renderPending) renderList(); },
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
    if (on) { setMode(null); closeWindow(); panel.closeIfPhone(); } // exclusive with placing and editing; the map must be free to tap
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
    closeWindow();
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
      txt.title = `Straight line, bearing ${Math.round(r.found.bearing)}° (${compass(r.found.bearing)}). Not a driving distance.`;
      // a saved driving route between these two places, shown only when one is already known: nothing is requested for a reference link
      const ends = (m) => ({ id: m.id, lat: m.lat, lon: m.lon });
      const road = router.peek({ from: ends(r.found.item), to: ends(it) }) ?? router.peek({ from: ends(it), to: ends(r.found.item) });
      if (road) txt.append(el('small', 'dist-road', `By road (saved): ${fmtDistance(road.distanceM, units)} · ${fmtDuration(road.durationS)}`));
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
  // The legs on show are drawn by route/render.js: a broad band, chevrons, a label; road geometry from route/router.js (device cache, shared-trip cache, the route-leg
  // function) and a dashed straight line while there is none. Redrawn on zoom and pan; routes are asked for only when a leg first comes on show.
  // Route answers arrive one by one (a day of ten legs is ten answers): the first is drawn at once, later ones that come within REDRAW_GAP of the last draw
  // share one draw at the end of the gap. A draw for any other reason (selection, zoom, pan) happens at once and takes the place of a pending one.
  const REDRAW_GAP = 150;
  let redrawTimer = 0, lastRedraw = -Infinity;
  const redrawSoon = () => { if (!redrawTimer) redrawTimer = setTimeout(redrawRoutes, Math.max(0, lastRedraw + REDRAW_GAP - performance.now())); };
  const router = createRouter({ onChange: redrawSoon, isShared: (id) => !!store.getTrip(id)?.shared, log: (a, c) => log.warn(a, c) });
  const renderer = createRouteRenderer({ L, map, el, fmt: (m) => fmtDistance(m, getDistanceSettings().units), pins: () => [...markers].filter(([id]) => shownOnMap(store.get(id))).map(([, m]) => m.getLatLng()) });
  const legEntries = (layer, legs, color) => legs.map((l) => { const r = router.resolve(l); return { layer, leg: l, result: r.result, pending: r.pending, color, bold: l.bold, overnight: l.overnight }; });
  let rotHooked = false;
  // MAP-10's contextual route summary sheet is presentation only: it reads the same entries redrawRoutes() just built for the renderer,
  // never a second computation of distance/status/source. `lastSummary` is null exactly when nothing is drawn (the sheet then hides).
  let lastSummary = null;
  const summaryListeners = new Set();
  const notifySummary = () => { for (const fn of summaryListeners) fn(lastSummary); };
  function buildSummary(entries) {
    if (!entries.length) return null;
    const legs = entries.map((e) => {
      const r = e.result;
      return {
        from: store.get(e.leg.from.id)?.name ?? '?',
        to: store.get(e.leg.to.id)?.name ?? '?',
        state: r.state, // 'road' | 'fallback' (route/result.js) - never relabeled
        distanceM: r.distanceM,
        durationS: r.durationS,
        source: r.state === 'road' ? r.source : r.reason, // 'cache'|'provider', or the fallback reason - as route/result.js already states it
        pending: e.pending,
        overnight: e.overnight,
        bold: e.bold,
      };
    });
    return {
      legs,
      totalM: legs.reduce((s, l) => s + l.distanceM, 0),
      units: getDistanceSettings().units,
      anyRoad: legs.some((l) => l.state === 'road'),
      allRoad: legs.every((l) => l.state === 'road'),
      anyPending: legs.some((l) => l.pending),
    };
  }
  function redrawRoutes() {
    clearTimeout(redrawTimer); redrawTimer = 0; lastRedraw = performance.now();
    routes.clearLayers(); dayLayer.clearLayers();
    if (!rotHooked && map._rot?.onChange) { rotHooked = true; let t = 0; map._rot.onChange(() => { clearTimeout(t); t = setTimeout(() => { if (viewId || shownDay) redrawRoutes(); }, 250); }); }
    const it = viewId && store.get(viewId);
    const { day, selected } = selectionLegs({ items: store.items(), it, shownDay, tripDrawn }); // the sequencing lives in route/legs.js
    const entries = [];
    if (shownDay && day.length) entries.push(...legEntries(dayLayer, day, tripColour(shownDay.tripId)));
    if (it?.tripId && selected.length) entries.push(...legEntries(routes, selected, tripColour(it.tripId)));
    if (!entries.length) { routeCredit(false); lastSummary = null; notifySummary(); return; }
    router.ensure(entries.map((e) => e.leg));
    renderer.draw(entries);
    routeCredit(entries.some((e) => e.result.state === 'road'));
    lastSummary = buildSummary(entries);
    notifySummary();
  }
  // the routing credit shows while a road route is drawn, beside (never instead of) the map's own credits
  const ROUTE_CREDIT = 'Routes: <a href="https://openrouteservice.org/" target="_blank" rel="noopener">openrouteservice.org</a> by HeiGIT';
  let credited = false;
  function routeCredit(on) {
    if (on === credited || !map.attributionControl) return;
    credited = on;
    if (on) map.attributionControl.addAttribution(ROUTE_CREDIT); else map.attributionControl.removeAttribution(ROUTE_CREDIT);
  }
  /** The selected marker's pin stands out. */
  function paintFocus() { for (const [id, m] of markers) m.getElement()?.classList.toggle('focused', id === viewId); }
  /** A click with details off: select the marker, show its links and a name tag (with an ⓘ that opens the window). */
  function selectMarker(id) {
    const it = store.get(id), m = markers.get(id);
    if (!it || !m) return;
    closeWindow();
    tagLayer.clearLayers();
    pickId = null; viewId = id; relink();
    const box = el('div', 'name-tag');
    const txt = el('span', 'name-tag-text');
    txt.append(el('b', '', it.name));
    const tripName = store.getTrip(it.tripId)?.name;
    if (tripName) txt.append(el('small', 'name-tag-trip', tripName)); // which trip, in text: two trips can both have a D1·1
    box.append(txt);
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
    const off = hideTrips && !tripViewId;
    tripBtn.classList.toggle('off', off); tripBtn.setAttribute('aria-pressed', String(!off));
    tripBtn.title = tripViewId ? 'Only one trip is shown on the map (click to show all)' : 'Trip markers on the map: ' + (hideTrips ? 'hidden' : 'shown') + ' (click to switch)';
  }
  new (ToggleControl('M7 21V4M7 5h10l-2 3.5 2 3.5H7', 'Show Side Quests on the map', () => setShowAllSide(!showAllSide), (a) => { sideBtn = a; }, 'side-quests'))().addTo(map);
  new (ToggleControl('M4 8h16v11H4zM9 8V5h6v3M4 13h16', 'Show trip markers on the map', () => (tripViewId ? setTripView(null) : setHideTrips(!hideTrips)), (a) => { tripBtn = a; }, 'trips'))().addTo(map);
  /** Takes the trip markers off the map (and their routes and Side Quest links) or puts them back. Lists and the Trips tab are unchanged. */
  function setHideTrips(on) {
    setTripView(null);
    hideTrips = on; savePrefs({ hideTrips: on ? true : null });
    tripBtnPaint();
    applyMarkerVisibility(); renderList(); // the list explains an override
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
    revealRow(id);
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
    if (!it || !needsDistance(it) || !shownOnMap(it)) return;
    const b = nearestBases(it, store.items()), { units } = getDistanceSettings();
    for (const t of BASE_TYPES) {
      const f = b[t.id].found;
      if (!f || !shownOnMap(f.item)) continue;
      const color = typeOf(t.id).color;
      // a thin dotted line, no arrow: the straight-line reference from the launch base (FPV range), never a route
      L.polyline([[it.lat, it.lon], [f.item.lat, f.item.lon]], { color, weight: 2, opacity: 0.9, dashArray: '1 6', lineCap: 'round', className: 'base-link', interactive: false }).addTo(links);
      const label = el('span', 'dist-label-text base-label', `${f.approx ? '≈ ' : ''}${fmtDistance(f.m, units)}`);
      label.style.borderColor = color;
      label.setAttribute('role', 'img'); label.setAttribute('aria-label', `Straight-line distance to the ${t.short}, ${fmtDistance(f.m, units)}, bearing ${Math.round(f.bearing)} degrees ${compass(f.bearing)}`);
      L.marker([(it.lat + f.item.lat) / 2, (it.lon + f.item.lon) / 2], { icon: L.divIcon({ className: 'dist-label', html: label, iconSize: null }), interactive: false, keyboard: false }).addTo(links);
    }
  }
  map.on('popupopen', (e) => { tagLayer.clearLayers(); pickId = null; viewId = e.popup._poiId ?? null; relink(); });
  map.on('popupclose', (e) => { if (e.popup._poiId === viewId) { viewId = null; relink(); } });
  map.on('moveend', () => { if (viewId || shownDay) redrawRoutes(); }); // bands, chevrons and labels are laid out in screen pixels: again after a zoom or a pan (no route is asked for)

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
        if (sideHidden(s) || !shownOnMap(parent) || !shownOnMap(s)) continue; // a link never outlives either end
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
  /** The pin's name for screen readers: the marker's name, then its trip. */
  const pinLabel = (it) => markerLabel(it.name, store.getTrip(it.tripId)?.name);
  /** The icon's content is only the badge text (D1·1), so the name goes in aria-label. Run after a pin is drawn and whenever a name or trip changes. */
  function labelPin(m, id) {
    const it = store.get(id), e = m.getElement();
    if (!it || !e) return;
    const l = pinLabel(it);
    e.setAttribute('aria-label', l); // the tooltip (title) stays the marker's own name
  }
  // Pins that sit on one screen point are fanned out by a click on the stack (spider.js); the records and their coordinates are never touched.
  const say = el('span', 'sr-only'); say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite'); document.body.append(say);
  const spider = createSpider({
    L, map, markers,
    visible: (id) => { const it = store.get(id), m = markers.get(id); return !!it && !!m && layer.hasLayer(m) && shownOnMap(it) && !sideHidden(it); },
    home: (id) => { const it = store.get(id); return [it.lat, it.lon]; },
    enabled: () => mode !== 'edit', // pins must not move while the map is locked for editing
    fanWhen: (ids) => new Set(ids.map((k) => store.get(k)?.tripId ?? null)).size > 1, // only stacks that mix trips: the visits of one place within a trip keep the top pin and the visit chips of their window
    announce: (t) => { say.textContent = ''; setTimeout(() => { say.textContent = t; }, 30); },
  });
  function addMarker(item) {
    const m = L.marker([item.lat, item.lon], { icon: iconOf(item), title: item.name, alt: item.name, keyboard: true, riseOnHover: true });
    m.on('add', () => labelPin(m, item.id));
    m._sig = sigOf(item);
    const activate = () => {
      if (suppressClick) return;
      if (spider.handle(item.id)) return; // a stack: fan it out first; a pin of an open fan closes it and goes on
      if (selecting) { pickOnMap(item.id); return; }
      if (detailsOn) openPopup(item.id); else selectMarker(item.id);
      revealCard(item.id); // the open panel scrolls to this marker's card
    };
    m.on('click', activate);
    m.on('keypress', (e) => { if (e.originalEvent?.keyCode === 13) activate(); }); // Enter on a focused pin does what a click does (Leaflet only does this for bound popups)
    markers.set(item.id, m);
    if (shownOnMap(item)) layer.addLayer(m);
    paintPins();
  }
  const mapState = () => ({ viewId: tripViewId, hideTrips, tripHidden, unassignedHidden, showCompleted, getTrip: (id) => store.getTrip(id), today: todayISO() });
  /** Why a marker is off the map (poi-model.js mapHiddenReason), or null when it is drawn. */
  const hiddenReason = (it) => mapHiddenReason(it, mapState());
  /** One answer to "is this marker drawn on the map?", besides the POI layer switch: a trip shown on its own, hideTrips, the trip's own setting, completed trips, then Unassigned. */
  const shownOnMap = (it) => !!it && hiddenReason(it) === null;
  /** Would the markers of this trip be drawn? (Routes follow their trip.) */
  const tripDrawn = (tripId) => mapHiddenReason({ tripId, type: 'other' }, mapState()) === null;
  /** What keeps a marker off the map, first match only, with the one action that lifts exactly that: { text, label, run } or null. Changes nothing itself. */
  function restrictionOf(it) {
    const why = it && hiddenReason(it), trip = it && store.getTrip(it.tripId);
    if (!why) return null;
    if (why === 'view') return { text: `Only "${store.getTrip(tripViewId)?.name ?? 'one trip'}" is shown on the map.`, label: 'Show all', run: () => setTripView(null) };
    if (why === 'hideTrips') return { text: 'Trip markers are switched off on the map.', label: 'Show on map', run: () => setHideTrips(false) };
    if (why === 'tripHidden') return { text: `"${trip?.name ?? 'This trip'}" is hidden on the map.`, label: 'Show on map', run: () => setTripShown(it.tripId, true) };
    if (why === 'completed') return { text: `"${trip?.name ?? 'This trip'}" is a completed trip, so it is hidden on the map.`, label: 'Show on map', run: () => setShowCompleted(true) };
    return { text: 'Markers with no trip are hidden on the map.', label: 'Show on map', run: () => setTripShown('none', true) };
  }
  /** Draws or removes every pin to match the rules above and closes a window whose marker went (no redraw of routes and links). */
  function syncPins() {
    spider.collapse(); // pins are about to be drawn or removed: put any fanned-out ones back first
    for (const [id, m] of markers) {
      const on = shownOnMap(store.get(id));
      if (!on && layer.hasLayer(m)) layer.removeLayer(m);
      else if (on && !layer.hasLayer(m)) layer.addLayer(m);
      if (!on && viewId === id) { closeWindow(); tagLayer.clearLayers(); viewId = null; }
    }
  }
  /** syncPins, then routes, Side Quest links and pin badges. */
  function applyMarkerVisibility() {
    syncPins();
    redrawRoutes(); refreshIcons(); paintPins();
  }
  /** Shows one trip's markers, routes and links on the map and nothing else (null: back to the normal rules). Not stored; the switches are not touched. */
  function setTripView(id, { announce = true } = {}) {
    const next = id && store.getTrip(id) ? id : null;
    if (next === tripViewId) return;
    tripViewId = next;
    applyMarkerVisibility(); relink(); renderList(); tripBtnPaint();
    for (const fn of viewListeners) { try { fn(); } catch (e) { log.error('poi', 'a listener failed', e); } }
    if (next && announce) {
      const n = store.items().filter((i) => i.tripId === next).length;
      toast(`Showing only "${store.getTrip(next).name}" on the map.${n ? '' : ' It has no markers yet.'}`, 8000, { label: 'Show all', run: () => setTripView(null) });
    }
  }
  /** Completed trips on or off the map (the switch in the Points of Interest tab). Remembered on this device. */
  function setShowCompleted(on) {
    showCompleted = on; savePrefs({ showCompleted: on ? true : null });
    $('poi-showcompleted').checked = on;
    applyMarkerVisibility(); renderList();
  }
  /** The map switch for a trip (or 'none': markers with no trip). Remembered on this device. */
  function setTripShown(scope, on) {
    setTripView(null);
    if (scope === 'none') unassignedHidden = !on; else if (on) tripHidden.delete(scope); else tripHidden.add(scope);
    saveHidden();
    applyMarkerVisibility(); renderList();
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
      if (m && m.getElement()?.getAttribute('aria-label') !== pinLabel(it)) labelPin(m, it.id); // a rename of the marker or its trip
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

  // ---------- marker window (Review 01 S9: the adaptive host is the single path for a saved marker; a Leaflet popup is still how a point check and a live pin open) ----------
  function openPopup(id, edit = false) {
    const item = store.get(id), m = markers.get(id);
    if (!item || !m) return;
    move?.abort(); // a staged Move ends when another marker window opens
    map.closePopup(); panel.closeIfPhone(); expanded = windowExpanded(); // recentres through free-area.js; a point check or live pin keeps view.js centreOn (DEF-S2-01)
    hostFor().open(id, { edit });
  }

  let expanded = true; // whether the open marker window is expanded
  const windowExpanded = () => { const v = loadPrefs().windowExpanded; return typeof v === 'boolean' ? v : defaultExpanded(); };
  /** Switches the open window between expanded and collapsed in place (no reopening, so a form or scroll position survives). */
  function setWindowMode(on) {
    expanded = on;
    savePrefs({ windowExpanded: on });
    markerHost?.isOpen() && markerHost.layout();
  }

  // the content builder lives in marker-content.js; the host only hosts it
  const content = createMarkerContent({
    store, cin, elev, toast, checkPoint, zoneSummary, weatherButton, showWeather, tripOf, iconOf, sigOf, eyeLabel, renderDist, renderStats, addVisit, convert, remove, openPopup, selectMarker, setDetails, setWindowMode, goTo,
    detailsOn: () => detailsOn, expanded: () => expanded, markers: () => markers, visitMap: () => visitMap, sideMap: () => sideMap, subParent: () => subParent,
    newTripHandler: () => newTripHandler, setWxLine: (line) => { wxLine = line; },
    closeWindow, startMove: (id) => move?.start(id),
  });
  // staged Move (Review 01 S7). Save uses the drag's own update and invalidation; see marker-move.js
  function applyStagedMove(id, lat, lon) {
    const m = markers.get(id);
    if (m) m.setLatLng([lat, lon]);
    const res = store.update(id, { lat, lon }); // persists and emits: routes, distance lines, spider fan, list and shared sync follow, as for a drag
    if (!res.item) return res;
    if (m) m.setLatLng([res.item.lat, res.item.lon]); // the pin is not re-read from the store on a change
    mw.invalidate(id); // the old forecast and elevation belong to the old spot
    elev.invalidate(id);
    mw.refresh([id]);
    return res;
  }
  const move = createMarkerMove({ map, panel, get: (id) => store.get(id), apply: applyStagedMove, isShared: (it) => !!store.getTrip(it.tripId)?.shared, closeWindow, reopen: (id) => openPopup(id), toast });
  let markerHost = null; // the adaptive marker host (Review 01 S4, S5); see marker-host.js
  /** Closes the marker window: the host, or (a point check, a live pin) the Leaflet popup those still use. The one place every "close the window" goes through. */
  function closeWindow() { map.closePopup(); markerHost?.close(); }
  // A second kind of window can share this one host: a provider (src/areas/details.js, community flying areas) owns the ids it claims ("area:<id>") and supplies their content,
  // map position and focus return; every other id is a saved marker. The host stays the single owner of the lifecycle, placement, recentring, Escape and focus.
  let ext = null;
  const extOf = (id) => (ext?.owns?.(id) ? ext : null);
  const hostFor = () => markerHost ??= createMarkerHost({
    map, panel, build: (id, edit, h) => (extOf(id) ? ext.build(id, edit, h) : content.buildContent(id, edit, h)), getExpanded: () => expanded,
    setExpanded: (on) => setWindowMode(on), latlngOf: (id) => (extOf(id) ? ext.latlngOf(id) : markers.get(id)?.getLatLng()),
    onOpen: (id) => {
      if (extOf(id)) { tagLayer.clearLayers(); pickId = null; if (viewId) { viewId = null; relink(); } ext.onOpen(id); return; }
      ext?.onClose?.(); // an area panel is replaced by a marker: its selection goes
      tagLayer.clearLayers(); pickId = null; viewId = id; relink();
    },
    onClose: (id) => { if (extOf(id)) { ext.onClose(id); return; } if (viewId === id) { viewId = null; relink(); } },
    returnFocusTo: (id) => (extOf(id) ? ext.returnFocusTo?.(id) : markers.get(id)?.getElement()) ?? null,
  });
  /** The shared host for other windows (see `ext` above): register(provider), open(id), close(), id() (the open id or null). */
  const externalHost = { register: (p) => { ext = p; }, open: (id) => hostFor().open(id), close: () => markerHost?.close(), id: () => (markerHost?.isOpen() ? markerHost.id() : null) };

  function remove(id) {
    const m = markers.get(id);
    if (m) layer.removeLayer(m);
    markers.delete(id);
    mw.forget(id);
    elev.forget(id);
    const res = store.remove(id);
    closeWindow();
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
    const sub = opts.sub === true; // a Side Quest: never a Home point, Accommodation or Home marker
    let switched = false;
    if (sub && NOT_SUB.has(selectedType)) { setSelectedType('other'); switched = true; } // the picker shows the change and keeps it until the person changes it
    const t = typeOf(selectedType);
    // new markers go into the chosen "current trip"; a Home marker is never in one
    const tripId = t.id === 'residence' ? undefined : currentTripId ?? undefined;
    const parent = sub ? defaultParent({ lat: ll.lat, lon: ll.lng, tripId }, store.items()) : null; // the nearest main stop of that trip
    const res = store.add({ type: t.id, name: (name || t.label).slice(0, 80), note: '', lat: ll.lat, lon: ll.lng, tripId, ...(sub && { isSub: true, parentId: parent?.id, date: parent?.date }) });
    if (!res.item) { toast('Could not add that marker.'); return; }
    const why = restrictionOf(res.item); // a marker made into a hidden trip is saved, but not drawn: say so, one message
    const said = [!res.ok && 'Added for now, but the browser would not store it. Export your markers to keep them.', switched && "Side Quests can't be Home point, Accommodation or Home (residence), so the type is now Other.", why && `Saved, but not on the map: ${why.text}`].filter(Boolean);
    if (said.length) toast(said.join(' '), 8000, why ? { label: why.label, run: why.run } : null);
    ensureVisible();
    addMarker(res.item);
    revealRow(res.item.id); // its trip and day open in the list
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
    for (const it of added) revealRow(it.id); // the trips and days they went into are open in the list
    if (added.length) mw.refreshMissing(); // an import never switches the POI layer on or lifts a hide: it says what keeps the markers off the map
    const hidden = added.filter((it) => !shownOnMap(it));
    const why = hidden.length ? restrictionOf(hidden[0]) : !map.hasLayer(layer) && added.length ? { text: 'Markers are switched off on the map.', label: 'Show on map', run: () => { map.addLayer(layer); showSwitch.checked = true; renderList(); } } : null;
    return { added, stored, notice: why && { text: hidden.length && hidden.length < added.length ? `${hidden.length} of them are not on the map: ${why.text}` : `Not on the map: ${why.text}`, label: why.label, run: why.run }, anyShown: added.some((it) => shownOnMap(it)) && map.hasLayer(layer) };
  }

  /** Zooms the map to show the given markers, clear of a docked panel. */
  function fitToItems(all) {
    const list = all.filter(shownOnMap); // never zoom to markers that are not drawn
    if (!list.length) return false;
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
    spider.collapse();
    if (mode === next) return;
    if (next && selecting) setSelecting(false); // placing or editing ends selecting
    if (mode === 'edit') { map.dragging.enable(); container.classList.remove('is-editing'); }
    if (mode === 'place') container.classList.remove('is-placing');
    mode = next;
    if (mode) { closeWindow(); clearSelection(); panel.closeIfPhone(); ensureVisible(); addCard.open = true; } // the controls that end a mode are never hidden by a folded card
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
  $('poi-showcompleted').checked = showCompleted;
  $('poi-showcompleted').addEventListener('change', (e) => setShowCompleted(e.target.checked));
  panel.onChange?.(() => { if (tripViewId && panel.getTab() !== 'trips') setTripView(null); }); // a trip shown on its own lasts while the Trips tab is the open tab
  showSwitch.addEventListener('change', () => {
    if (showSwitch.checked) map.addLayer(layer); else { map.removeLayer(layer); closeWindow(); }
    renderList(); // the list explains an override
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
      closeWindow();
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
    if (['view', 'completed'].includes(hiddenReason(it))) setTripView(it.tripId ?? null); // asked for by name: that trip is shown on its own (no trip: back to all)
    const why = restrictionOf(it); // hidden by hand or by the trip switch: say why, offer to show it, do not open a window on a marker that is not there
    if (why) { toast(`"${it.name}" is not on the map. ${why.text}`, 8000, { label: why.label, run: () => { why.run(); flyToItem(id); } }); return; }
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
  // A newer marker type (the six added after the first ten) put into a shared trip by this person: older app versions show it as Other, so one notice says so.
  const NEWER = new Set(['food', 'attraction', 'shopping', 'nature', 'transport', 'meeting']);
  const newerShared = () => new Set(store.items().filter((i) => NEWER.has(i.type) && store.getTrip(i.tripId)?.shared).map((i) => i.id));
  let knownNewer = newerShared();
  const newerListeners = new Set();
  store.onChange((kind) => {
    const now = newerShared();
    const fresh = [...now].some((id) => !knownNewer.has(id));
    knownNewer = now;
    if (fresh && kind !== 'shared') for (const fn of newerListeners) { try { fn(); } catch (e) { log.error('poi', 'a listener failed', e); } } // not for markers that arrived from the server
  });
  store.onChange(() => {
    const had = currentTripId;
    renderTripSelects();
    if (had !== currentTripId) savePrefs({ currentTrip: currentTripId }); // the current trip was deleted
    if (tripViewId && !store.getTrip(tripViewId)) setTripView(null); // the trip shown on its own was deleted
    syncPins(); // a marker moved to another trip, or a trip's dates changed, may enter or leave the map
    refreshIcons(); renderList(); renderNote(); wxLine?.render(); relink();
  });
  mw.init(); // refreshes now if automatic weather is on and the last bulk refresh is more than 30 minutes old

  /** Zooms to the markers that are drawn; if none are, says why (and offers to show them) instead of moving the map to nothing. */
  function fitShown(list) {
    if (fitToItems(list) !== false) return true;
    const why = restrictionOf(list[0]);
    toast(why ? `Nothing to show: ${why.text}` : 'Nothing to show on the map for this page.', 6000, why ? { label: why.label, run: () => { why.run(); fitToItems(list); } } : null);
    return false;
  }
  /** Zooms the map to a trip's markers. */
  function fitTrip(id) {
    const list = store.items().filter((i) => i.tripId === id);
    if (!list.length) { toast('This trip has no markers yet.'); return false; }
    return fitShown(list);
  }

  return {
    store,
    route: routeApi,
    closeWindow,
    externalHost,
    checkin: cin,
    fitTrip,
    /** The trip shown on its own on the map (Trips tab), or null; set it (null clears), and hear about changes. */
    getTripView: () => tripViewId, setTripView, onTripViewChange: (fn) => viewListeners.add(fn),
    /** Changes the type chosen in the Add a marker picker (and opens the group it is in). */
    setSelectedType,
    /** Unfolds Add a marker (the dashboard’s Save a place) without changing the chosen type, the search, the filters or the folds of the saved list. */
    openAdd() { addCard.open = true; addCard.scrollIntoView?.({ block: "nearest" }); addCard.querySelector("summary")?.focus({ preventScroll: true }); },
    /** Puts the cursor in the saved-places search box; the query and everything else stay as they are. */
    focusSearch() { searchEl.focus({ preventScroll: false }); },
    onNewTypeShared: (fn) => newerListeners.add(fn),
    /** The route router (route/router.js): main.js gives it the account backend once sign-in is available. */
    routeRouter: router,
    /** Whether a marker is drawn on the map under the trip rules (not counting the POI layer switch). */
    isShownOnMap: (id) => shownOnMap(store.get(id)),
    setTripShown,
    getSelectedType: () => selectedType,
    /** Flies to a marker and opens its window (the Trips tab's day list uses it). */
    openMarker: (id) => flyToItem(id),
    /** Draws the route of one day of a trip (thin) while the trip screen shows it; showDay(null) clears it. */
    showDay(tripId, date) { shownDay = tripId ? { tripId, date } : null; redrawRoutes(); },
    /** MAP-10: the read-only summary of the routes currently drawn (null when none are) - presentation only, see buildSummary above. */
    routeSummary: () => lastSummary,
    onRouteSummaryChange: (fn) => { summaryListeners.add(fn); return () => summaryListeners.delete(fn); },
    /** Zooms the map to these markers (a day of a trip). */
    fitItems(ids) { const list = ids.map((id) => store.get(id)).filter(Boolean); if (!list.length) { toast('Nothing to show on the map for this page.'); return false; } return fitShown(list); },
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
