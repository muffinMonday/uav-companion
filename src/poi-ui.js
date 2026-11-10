// Points of interest on the map: placing, listing, editing, moving, backup. Data and storage live in poi.js.
import L from 'leaflet';
import { KEY, TRIPS_KEY, TYPES, typeOf, pinSvg, createStore, toGeoJSON, parseGeoJSON, sortForList, posInt, isoDate, listMode, groupLabel, dateLabel } from './poi.js';
import { createMarkerWeather, formatWhen } from './markerweather.js';
import { createMarkerElevation } from './elevation.js';
import { getPrivacy } from './privacy.js';
import { getWindLimit } from './weather.js';
import { getDistanceSettings, setDistanceSettings, onDistanceSettings } from './units.js';
import { BASE_TYPES, needsDistance, nearestBases, beyondRange, fmtDistance, compass, toDisplay, fromDisplay } from './distance.js';
import { sortTrips, tripSummary, tripDatesLabel, outsideTrip } from './trips.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { el, statusEl, tile, statsGrid, disclaimer } from './cards.js';

const $ = (id) => document.getElementById(id);
const HOLD_MS = 380; // press and hold this long before a pin can be moved
const SLOP = 8;      // px of movement during the hold that cancels it (it was a swipe, not a hold)

/** The pin, with a small dot in its trip's colour when the marker belongs to a trip. The colour comes from the fixed palette in poi.js. */
const makeIcon = (type, tripColor, seq = '') => L.divIcon({
  className: 'poi-pin',
  html: pinSvg(type) + (tripColor ? `<i class="trip-dot" style="background:${tripColor}"></i>` : '') + (seq ? `<b class="seq">${seq}</b>` : ''),
  iconSize: [30, 40], iconAnchor: [15, 38],
});
const fmt = (v) => v.toFixed(5);
/** Short form for the pin: "D2·3", "D2" or "#3"; '' when the marker has neither a day nor a stop. */
const seqBadge = (it) => (it.day !== undefined ? `D${it.day}${it.order !== undefined ? `·${it.order}` : ''}` : it.order !== undefined ? `#${it.order}` : '');
/** "Day 2 · Stop 3", or just one of them, or '' when the marker is not part of an itinerary. */
const tripLabel = (it) => [it.day !== undefined && `Day ${it.day}`, it.order !== undefined && `Stop ${it.order}`].filter(Boolean).join(' · ');

export function initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, locateOnce, panel }) {
  const store = createStore();
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
  let selecting = false;      // "Select markers" mode in the list, for deleting several at once
  const selected = new Set(); // ids ticked in that mode (only ever markers that are shown)
  let visibleIds = new Set(); // the markers the list shows now
  let wxLine = null; // { id, render } for the weather and elevation tiles in the open marker window, so they update in place

  // Weather summaries and ground elevation for markers: both opt-in, see privacy.js
  const mw = createMarkerWeather({ getItems: () => store.items(), onChange: () => { renderWxStatus(); wxLine?.render(); } });
  const elev = createMarkerElevation({ getItems: () => store.items(), onChange: () => { renderWxStatus(); wxLine?.render(); } });
  const mwStatus = $('mw-status');

  const typesEl = $('poi-types'), listEl = $('poi-list'), filterEl = $('poi-filter'), countEl = $('poi-count');
  const emptyEl = $('poi-empty'), noteEl = $('poi-note'), editSwitch = $('poi-edit'), showSwitch = $('poi-show');
  const banner = $('banner'), bannerText = $('banner-text'), bannerAction = $('banner-action');
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

    listEl.replaceChildren();
    const trips = store.trips();
    const visible = items.filter((i) => (filter === 'all' || i.type === filter)
      && (tripFilter === 'all' || (tripFilter === 'none' ? !i.tripId : i.tripId === tripFilter)));
    visibleIds = new Set(visible.map((i) => i.id));
    if (!items.length) selecting = false;
    for (const id of [...selected]) if (!visibleIds.has(id)) selected.delete(id); // the count always matches what is shown
    renderSelectBar(items);

    // One group of markers. Inside it: date headings once any marker has a date, else "Day N" headings once any has a day,
    // else a plain list, newest first. `mode` is decided by the caller so headings and order always agree.
    const renderGroup = (group, mode, head) => {
      if (head) listEl.append(head);
      let lastGroup = null;
      for (const it of sortForList(group, mode)) {
        if (mode !== 'plain') {
          const label = groupLabel(it, mode);
          if (label !== lastGroup) { const h = el('li', 'day-head', label); h.setAttribute('role', 'presentation'); listEl.append(h); lastGroup = label; }
        }
        listEl.append(renderItem(it, items, mode));
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
      renderGroup(visible, listMode(items), null); // no trips yet: the list is exactly as it was before trips existed
    } else {
      for (const t of sortTrips(trips)) {
        const group = visible.filter((i) => i.tripId === t.id);
        if (group.length || tripFilter === t.id) renderGroup(group, listMode(group), heading(t.name, t));
      }
      const loose = visible.filter((i) => !i.tripId && i.type !== 'residence');
      if (loose.length) renderGroup(loose, listMode(loose), heading('No trip'));
      const homes = visible.filter((i) => i.type === 'residence');
      if (homes.length) renderGroup(homes, 'plain', heading('Home'));
      if (!listEl.children.length) listEl.append(el('li', 'poi-none', 'Nothing matches this filter.'));
    }
  }

  // ---------- selecting several markers to delete ----------
  const selRow = $('poi-select-row'), selBar = $('poi-selbar'), selDelete = $('sel-delete'), selConfirm = $('sel-confirm');
  const selTrip = $('sel-trip'), selType = $('sel-type');
  const plural = (n) => `${n} marker${n === 1 ? '' : 's'}`;
  function renderSelectBar(items) {
    selRow.hidden = selecting || !items.length;
    selBar.hidden = !selecting;
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
    if (n === 0) selConfirm.hidden = true;
    $('sel-confirm-delete').textContent = `Delete ${plural(n)}`;
  }
  function setSelecting(on) {
    selecting = on; selected.clear(); selConfirm.hidden = true;
    renderList();
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
    const t = el('span', 't');
    const detail = it.note ? it.note.split('\n')[0] : `${fmt(it.lat)}, ${fmt(it.lon)}`;
    const when = [gmode === 'day' ? (it.order !== undefined && `Stop ${it.order}`) : tripLabel(it), gmode === 'date' && it.endDate && dateLabel(it)].filter(Boolean).join(' · ');
    const name = el('b', '', it.name);
    if (it.unverified) name.append(' ', el('span', 'badge', 'Unverified'));
    if (it.tripId && outsideTrip(it, store.getTrip(it.tripId))) name.append(' ', el('span', 'badge', 'Outside trip dates'));
    t.append(name, el('small', '', `${when ? `${when} · ` : ''}${typeOf(it.type).label} · ${detail}`));
    const d = distanceSummary(it, items);
    if (d) t.append(el('small', `dist-line${d.over ? ' over' : ''}`, d.text));
    b.append(t);
    if (selecting) {
      const cb = el('input', 'sel-box'); cb.type = 'checkbox'; cb.checked = selected.has(it.id); cb.setAttribute('aria-label', `Select ${it.name}`);
      const toggle = () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); selConfirm.hidden = true; updateSelectBar(); };
      cb.addEventListener('change', toggle);
      b.title = 'Select or clear';
      b.addEventListener('click', () => { cb.checked = !cb.checked; toggle(); });
      li.className = 'selecting';
      li.append(cb);
    } else {
      b.addEventListener('click', () => flyToItem(it.id));
    }
    li.append(b);
    return li;
  }

  /** Short distance line for the list: "0.8 km to home point · 3.2 km to hotel · 8 km to home". null for markers that have none. */
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
      + (store.items().some((i) => i.type === 'residence') ? ' An export includes your Home marker (your residence), so keep the file private. Share links leave it out.' : '');
  }

  // ---------- weather summary ----------
  /** The status line in the Points of Interest tab: automatic weather and altitude, and where to change them. */
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
    mwStatus.textContent = lines.join(' ');
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
      if (!box.hidden) box.append(el('div', 'dist-empty', 'Add a Home point, Hotel or Home marker to see how far this place is from it.'));
      return;
    }
    box.hidden = false;
    const over = beyondRange(b, maxRangeM);
    let approx = false;
    for (const t of lines) {
      const r = b[t.id];
      if (!r.exists) continue;
      const row = el("div", `dist-row${over && r.found && t.launch ? " over" : ""}`);
      const ic = el('span', 'dist-ic');
      ic.innerHTML = pinSvg(t.id); // built from constants only
      ic.firstChild.setAttribute('width', '16'); ic.firstChild.setAttribute('height', '21');
      const txt = el('div', 'dist-txt');
      if (r.found) {
        approx ||= r.found.approx;
        txt.append(el('div', 'dist-v', `${r.found.approx ? '≈ ' : ''}${fmtDistance(r.found.m, units)} ${compass(r.found.bearing)}`), el('small', '', `from ${t.short} ${r.found.item.name}`));
      } else if (!r.inTrip) {
        txt.append(el('div', 'dist-v none', `No ${t.short} ${it.tripId ? 'in this trip' : 'outside a trip'}`),
          el('small', '', it.tripId ? 'Distances only look within the waypoint\'s own trip.' : 'This waypoint has no trip, so it is only measured to ones with no trip.'));
      } else {
        txt.append(el('div', 'dist-v none', `No ${t.short} for these dates`), el('small', '', 'None of them overlaps this waypoint\'s dates.'));
      }
      row.append(ic, txt);
      box.append(row);
    }
    if (over) box.append(el('small', 'stats-note over', `Beyond your ${fmtDistance(maxRangeM, units)} max range from every home point and hotel that applies.`));
    if (approx) box.append(el('small', 'stats-note', '≈ means a location involved is unverified, so the distance is approximate.'));
  }

  /** Dashed lines on the map from the open marker to its nearest home point and hotel, labelled with the distance. */
  const links = L.layerGroup().addTo(map);
  let viewId = null; // the marker whose window is open
  function relink() {
    links.clearLayers();
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
  map.on('popupopen', (e) => { viewId = e.popup._poiId ?? null; relink(); });
  map.on('popupclose', (e) => { if (e.popup._poiId === viewId) { viewId = null; links.clearLayers(); } });

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
        notes.push(`${s.outdated ? 'Outdated. ' : ''}Next ${e.n} h · updated ${formatWhen(e.t)}${s.failed ? ' (latest refresh failed)' : ''} · forecast from ${e.start} local time there`);
      }
    }
    box.hidden = !tiles.length;
    if (!tiles.length) return;
    box.append(statsGrid(tiles));
    for (const n of notes.filter(Boolean)) box.append(el('small', 'stats-note', n));
  }

  // ---------- markers ----------
  function addMarker(item) {
    const m = L.marker([item.lat, item.lon], { icon: makeIcon(item.type, tripColor(item), seqBadge(item)), title: item.name, alt: item.name, keyboard: true, riseOnHover: true });
    m._sig = `${item.type}|${tripColor(item) ?? ''}|${seqBadge(item)}`;
    m.on('click', () => { if (!suppressClick) openPopup(item.id); });
    markers.set(item.id, m);
    layer.addLayer(m);
  }
  /** Redraws any pin whose type or trip colour changed (a trip was edited or deleted, a marker was re-tagged). */
  function refreshIcons() {
    for (const it of store.items()) {
      const m = markers.get(it.id);
      const sig = `${it.type}|${tripColor(it) ?? ''}|${seqBadge(it)}`;
      if (m && m._sig !== sig) { m.setIcon(makeIcon(it.type, tripColor(it), seqBadge(it))); m._sig = sig; }
    }
  }
  function rebuildMarkers() {
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
    // On a phone the window must fit the screen: narrower, with small margins instead of room for the zoom buttons.
    const phone = window.innerWidth <= 520;
    popup = L.popup({
      maxWidth: Math.min(340, window.innerWidth - 32), minWidth: Math.min(290, window.innerWidth - 40), offset: [0, -36],
      autoPanPaddingTopLeft: phone ? [12, 76] : [64, 76], autoPanPaddingBottomRight: [12, 16], closeButton: true,
      // on a phone the window never takes more than about 45% of the screen: it scrolls inside, and the map stays draggable around it
      ...(phone && { maxHeight: Math.round(window.innerHeight * 0.45) }),
    })
      .setLatLng(m.getLatLng())
      .setContent(popupContent(id, edit));
    popup._poiId = id; // read by the popupopen/popupclose handlers that draw and remove the distance lines
    popup.openOn(map);
  }

  function popupContent(id, startEditing) {
    const root = el('div', 'pop poi-pop');

    function view() {
      const it = store.get(id);
      if (!it) return;
      root.replaceChildren();

      // header: pin, type and name; coordinates underneath
      const head = el('div', 'pop-head');
      const badge = el('span', 'pop-badge');
      badge.innerHTML = pinSvg(it.type); // built from constants only
      badge.firstChild.setAttribute('width', '26'); badge.firstChild.setAttribute('height', '35');
      const titles = el('div', 'pop-titles');
      const trip = tripLabel(it);
      titles.append(el('div', 'pop-type', trip ? `${typeOf(it.type).label} · ${trip}` : typeOf(it.type).label), el('h3', '', it.name));
      const tripRec = it.tripId ? store.getTrip(it.tripId) : null;
      if (tripRec) {
        const line = el('div', 'pop-trip');
        const dot = el('i', 'trip-dot-sm'); dot.style.background = tripRec.color;
        line.append(dot, tripRec.name);
        titles.append(line);
      }
      if (it.date) titles.append(el('div', 'pop-dates', dateLabel(it)));
      titles.append(el('div', 'coords', `${fmt(it.lat)}, ${fmt(it.lon)}`));
      head.append(badge, titles);
      root.append(head);
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

      // how far this is from the nearest home point and hotel, then the numbers: elevation and the 5-hour weather (when enabled)
      const dist = el('div', 'dist-wrap');
      const stats = el('div', 'stats-wrap');
      wxLine = { id, render: () => { renderDist(dist, id); renderStats(stats, id); } };
      wxLine.render();
      root.append(dist, stats);
      elev.ensure(id); // no-op unless ground elevation is on

      if (it.note) root.append(el('p', 'note', it.note));

      const acts = el('div', 'acts');
      const edit = el('button', 'btn small', 'Edit'); edit.type = 'button';
      // Swap the popup contents after the click has finished. Removing the clicked button mid-click makes Leaflet
      // treat the click as a map click (it can no longer see the button was inside a popup), which closes the popup.
      edit.addEventListener('click', () => setTimeout(editForm, 0));
      const del = el('button', 'btn small danger', 'Delete'); del.type = 'button';
      let armed = null;
      del.addEventListener('click', () => {
        if (!armed) {
          del.textContent = 'Confirm delete';
          armed = setTimeout(() => { del.textContent = 'Delete'; armed = null; }, 4000);
          return;
        }
        clearTimeout(armed);
        remove(id);
      });
      acts.append(edit, del);
      root.append(weatherButton(() => { map.closePopup(); showWeather(it.lat, it.lon, it.name); }), acts, disclaimer());
    }

    function editForm() {
      const it = store.get(id);
      if (!it) return;
      wxLine = null; // the form has no weather line
      root.replaceChildren();
      const form = el('form');
      const name = el('input'); name.type = 'text'; name.maxLength = 80; name.value = it.name; name.required = true;
      const type = el('select');
      for (const t of TYPES) { const o = el('option', '', t.label); o.value = t.id; o.selected = t.id === it.type; type.append(o); }
      const note = el('textarea'); note.maxLength = 500; note.value = it.note; note.rows = 3;
      // Day and Order are for itineraries and entirely optional: leave them empty and the marker has neither.
      const day = el('input'); day.type = 'number'; day.min = '1'; day.max = '999'; day.step = '1'; day.placeholder = 'optional'; day.value = it.day ?? '';
      const order = el('input'); order.type = 'number'; order.min = '1'; order.max = '999'; order.step = '1'; order.placeholder = 'optional'; order.value = it.order ?? '';
      // Dates are optional too. The end date is for a stay of several days (a hotel), and only makes sense after a start date.
      const date = el('input'); date.type = 'date'; date.min = '2000-01-01'; date.max = '2100-12-31'; date.value = it.date ?? '';
      const endDate = el('input'); endDate.type = 'date'; endDate.max = '2100-12-31'; endDate.value = it.endDate ?? '';
      const syncEnd = () => { endDate.disabled = !date.value; endDate.min = date.value || '2000-01-01'; if (!date.value) endDate.value = ''; };
      date.addEventListener('input', syncEnd);
      syncEnd();
      const lab = (text, input) => { const l = el('label', '', text); l.append(input); return l; };
      const when = el('div', 'two'); when.append(lab('Start date', date), lab('End date', endDate));
      const trip = el('div', 'two'); trip.append(lab('Day', day), lab('Stop in the day', order));

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
      tripPick.addEventListener('change', () => {
        if (tripPick.value === '__new') { // hand over to the Trips tab, which tags this marker once the trip is saved
          tripPick.value = lastTrip;
          setTimeout(() => { map.closePopup(); newTripHandler?.(id); }, 0);
          return;
        }
        lastTrip = tripPick.value;
        showHint();
      });
      date.addEventListener('input', showHint);
      endDate.addEventListener('input', showHint);
      syncTripField();
      showHint();

      const acts = el('div', 'acts');
      const save = el('button', 'btn small primary', 'Save'); save.type = 'submit';
      const cancel = el('button', 'btn small', 'Cancel'); cancel.type = 'button';
      cancel.addEventListener('click', () => setTimeout(view, 0)); // deferred for the same reason as Edit
      acts.append(save, cancel);
      form.append(lab('Name', name), lab('Type', type), tripLab, when, trip, hint, el('small', 'form-hint', 'Trip, dates, day and stop are all optional. Use an end date for a stay of several days.'), lab('Note', note), acts);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const res = store.update(id, {
          name: name.value, type: type.value, note: note.value, day: posInt(day.value), order: posInt(order.value), date: isoDate(date.value), endDate: isoDate(endDate.value),
          tripId: type.value === 'residence' ? null : (tripPick.value || null), // a Home marker is never in a trip
        });
        if (!res.item) { toast('Could not save that change.'); return; }
        if (!res.ok) toast('Changed for now, but the browser would not store it. Export your markers to keep them.');
        const m = markers.get(id);
        if (m) {
          m.setIcon(makeIcon(res.item.type, tripColor(res.item), seqBadge(res.item))); m._sig = `${res.item.type}|${tripColor(res.item) ?? ''}|${seqBadge(res.item)}`;
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

  // ---------- placing ----------
  function place(latlng) {
    const ll = latlng.wrap();
    const t = typeOf(selectedType);
    // new markers go into the chosen "current trip"; a Home marker is never in one
    const res = store.add({ type: t.id, name: t.label, note: '', lat: ll.lat, lon: ll.lng, tripId: t.id === 'residence' ? undefined : currentTripId ?? undefined });
    if (!res.item) { toast('Could not add that marker.'); return; }
    if (!res.ok) toast('Added for now, but the browser would not store it. Export your markers to keep them.');
    ensureVisible();
    addMarker(res.item);
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
    banner.hidden = !mode;
  }
  function setMode(next) {
    if (mode === next) return;
    if (mode === 'edit') { map.dragging.enable(); container.classList.remove('is-editing'); }
    if (mode === 'place') container.classList.remove('is-placing');
    mode = next;
    if (mode) { map.closePopup(); panel.closeIfPhone(); ensureVisible(); }
    if (mode === 'edit') { map.dragging.disable(); container.classList.add('is-editing'); }
    if (mode === 'place') container.classList.add('is-placing');
    editSwitch.checked = mode === 'edit';
    updateBanner();
  }
  bannerAction.addEventListener('click', () => setMode(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode) setMode(null); });
  editSwitch.addEventListener('change', () => setMode(editSwitch.checked ? 'edit' : null));
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
    ensureVisible();
    const wasOpen = panel.isOpen();
    panel.closeIfPhone();
    const sideways = wasOpen && panel.isOpen() ? $('panel').offsetWidth + 24 : 0; // keep the point clear of a docked panel
    map.fitBounds(L.latLngBounds([it.lat, it.lon], [it.lat, it.lon]), { maxZoom: Math.max(map.getZoom(), 15), paddingBottomRight: [sideways, 0], animate: true });
    // Listen only after starting the move: stopping an earlier pan fires its own moveend, which must not open the popup early.
    let opened = false;
    const open = () => { if (!opened) { opened = true; map.off('moveend', open); openPopup(id); } };
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
    showTrip, fitTrip,
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
    handleMapClick(e) {
      if (mode === 'place') { setMode(null); place(e.latlng); return true; }
      return mode === 'edit';
    },
    /** For the privacy settings, which own the switches: they act on these and the tab status follows. */
    mw, elev,
    /** For the AI import: the current markers, bulk add, and zooming to what was added. */
    items: () => store.items(), addMany, fitToItems,
  };
}
