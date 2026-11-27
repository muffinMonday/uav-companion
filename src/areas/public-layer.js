// Community flying areas, Phase 4: the PUBLIC layer. It draws approved, published areas fetched for the current viewport (public-api.js) with the same community styling as
// layer.js, in the same non-interactive pane, and it is kept apart from the person's local drafts: separate data, separate source, and never saved anywhere.
//   - A tap is resolved by details.js through areaAt(); the polygons themselves take no pointer events, so map gestures, holds and point checks work as before. Nothing here is
//     read by pointcheck.js or any zone layer: a community area never changes an official verdict.
//   - An area the person's own local record already stands for (same server area id) is not drawn twice; the private draft stays in the local layer.
//   - The area that is open in the details panel is drawn by layer.js (setExtra), so this layer skips it (skip()).
//   - Spots follow the same 500 m scale rule as local areas.
import L from 'leaflet';
import { SPOT_LABELS } from './core.js';
import { spotsShown, pickArea } from './geo.js';
import { AREA_STYLE, ensurePanes, toLatLngs, spotIcon, spotPopup, popupOptions } from './layer.js';
import { createPublicLoader, createPublicApi, viewportQuery } from './public-api.js';

export const DEBOUNCE_MS = 450;
export const LOADING_DELAY_MS = 700; // the loading note appears only when a request is slow

/**
 * @param {object} o
 * @param {L.Map} o.map
 * @param {object} o.store         the local store (only read, to leave out areas the person already has)
 * @param {object} o.backend       createCloudBackend(...)
 * @param {(areaId: string) => void} [o.onView]  a spot popup's "View flying area"
 * @param {boolean} [o.enabled]    initial visibility (the saved preference)
 */
export function createPublicAreas({ map, store, backend, onView = null, enabled = true, debounceMs = DEBOUNCE_MS, loadingDelayMs = LOADING_DELAY_MS }) {
  ensurePanes(map);
  const api = createPublicApi(backend);
  const loader = createPublicLoader({ api });
  const polys = L.layerGroup().addTo(map), spots = L.layerGroup().addTo(map);
  let views = [], visible = !!enabled, skipId = null, near = spotsShown(map), timer = null, loadingTimer = null, note = '', noteEl = null;
  const stateListeners = new Set();
  let state = { phase: 'idle', truncated: false, failed: false, tooWide: false, offline: false };

  const hasLocal = (areaId) => store.list().some((a) => a.submission?.areaId === areaId);
  const shown = () => views.filter((v) => v.areaId !== skipId && !hasLocal(v.areaId));

  function paintPolys() {
    polys.clearLayers();
    if (!visible) return;
    for (const v of shown()) L.polygon(toLatLngs(v.area.geometry.coordinates[0]), { ...AREA_STYLE, className: 'community-area is-public' }).addTo(polys);
  }
  function paintSpots() {
    spots.clearLayers();
    near = spotsShown(map);
    if (!visible || !near) return;
    const b = map.getBounds().pad(0.2);
    for (const v of shown()) {
      for (const s of v.area.spots) {
        const ll = L.latLng(s.coordinates[1], s.coordinates[0]);
        if (!b.contains(ll)) continue;
        const m = L.marker(ll, { icon: spotIcon(s.type), keyboard: true, title: SPOT_LABELS[s.type], alt: SPOT_LABELS[s.type] });
        m.bindPopup(() => spotPopup(s, v.area, { onView: onView ? () => { map.closePopup(); onView(v.areaId); } : null }), popupOptions());
        m.addTo(spots);
      }
    }
  }
  const paint = () => { paintPolys(); paintSpots(); };
  const recheck = () => { if (near || spotsShown(map) !== near) paintSpots(); }; // when the scale rule flips, and while at spot scale (the shown spots follow the viewport)

  function setState(patch) { state = { ...state, ...patch }; for (const f of stateListeners) { try { f(state); } catch { /* ignore */ } } renderNote(); }
  function renderNote() {
    if (!noteEl) return;
    let t = '';
    if (visible) {
      if (state.phase === 'loading' && state.slow) t = 'Loading community flying areas…';
      else if (state.tooWide) t = 'Zoom in to see community flying areas.';
      else if (state.failed) t = 'Community flying areas could not be loaded.';
      else if (state.truncated) t = 'Many community areas here. Zoom in to see them all.';
    }
    note = t; noteEl.textContent = t; noteEl.hidden = !t;
  }

  async function refresh({ force = false } = {}) {
    clearTimeout(loadingTimer);
    if (!visible) return;
    const b = map.getBounds();
    const q = viewportQuery({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    if (!q) { loader.clear(); setState({ phase: 'idle', tooWide: true, failed: false, truncated: false, slow: false }); views = []; paint(); return; }
    if (!api.available()) { setState({ phase: 'idle', tooWide: false, failed: false, offline: true, slow: false }); return; } // the account code has not loaded (or accounts are off): try again when it does
    setState({ phase: 'loading', tooWide: false, offline: false, slow: false });
    loadingTimer = setTimeout(() => { if (state.phase === 'loading') setState({ slow: true }); }, loadingDelayMs);
    try {
      const r = await loader.load(q, { force });
      clearTimeout(loadingTimer);
      if (!r) return; // replaced by a newer request
      views = r.views; paint();
      setState({ phase: 'idle', failed: false, truncated: r.truncated, slow: false });
    } catch (e) {
      clearTimeout(loadingTimer);
      // a failure keeps the areas already on the map and says so; it is never shown as "no community areas here"
      setState({ phase: 'idle', failed: true, slow: false, errorCode: e?.code ?? 'network' });
    }
  }
  const schedule = () => { clearTimeout(timer); if (!visible) return; timer = setTimeout(() => refresh(), debounceMs); };

  map.on('moveend', schedule);
  map.on('zoomend moveend', recheck);
  store.onChange(paint);
  backend.onChange?.(() => { loader.clear(); schedule(); }); // signed in or out, or the account code arrived

  return {
    /** Starts loading for the current view (a no-op while switched off). Call once the map has its first view. */
    start() { if (visible) schedule(); },
    refresh,
    get visible() { return visible; },
    setVisible(v) {
      visible = !!v;
      if (!visible) { clearTimeout(timer); clearTimeout(loadingTimer); loader.clear(); views = []; polys.clearLayers(); spots.clearLayers(); setState({ phase: 'idle', failed: false, tooWide: false, truncated: false, slow: false }); }
      else schedule();
    },
    /** Leaves one area out (the details panel draws it). */
    skip(areaId) { if (skipId === areaId) return; skipId = areaId; paint(); },
    /** The public view under a tap ({ areaId, area, record, ... }), or null. Local areas are resolved first by details.js. */
    areaAt(latlng) {
      if (!visible) return null;
      const hit = pickArea(shown().map((v) => ({ ...v.area, _v: v })), latlng.lng, latlng.lat);
      return hit?._v ?? null;
    },
    find: (areaId) => views.find((v) => v.areaId === areaId) ?? null,
    /** One area was found to be unpublished: gone from the map and from every cached viewport at once. */
    forget(areaId) { loader.forget(areaId); views = views.filter((v) => v.areaId !== areaId); paint(); },
    /** A moderation decision or an account change: drop the cache and load the current view again. */
    invalidate() { loader.clear(); if (visible) refresh({ force: true }); },
    api,
    onState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    get state() { return state; },
    count: () => shown().length,
    /** The small status line (loading, zoom in, could not load); created on first use inside the map container. */
    mountNote() {
      if (noteEl) return noteEl;
      noteEl = document.createElement('div'); noteEl.className = 'areas-public-note'; noteEl.setAttribute('role', 'status'); noteEl.setAttribute('aria-live', 'polite'); noteEl.hidden = true;
      map.getContainer().append(noteEl); renderNote(); return noteEl;
    },
  };
}
