// Community flying areas, Phase 1: how saved local areas look on the map. Display only.
//   - Polygons are NOT interactive (pointer-events none), so they never take a tap, a drag, a hold or a right-click from the map: the point check works
//     inside and outside an area exactly as before, and the verdict never reads these shapes.
//   - They have their own pane under the markers and their own purple dashed outline (--community in styles.css), unlike the teal/red official zones.
//   - Pilot setup spots are small markers shown only when the 140 px scale bar spans 500 m or less (geo.js spotsShown; owner decision 2026-11-27, replacing the
//     fixed zoom 13). Selecting an area never bypasses that: the details panel lists every spot at any zoom, and "show spot" zooms in on purpose.
//   - Selecting is done by details.js (a tap inside a polygon); this file only draws the selection and answers "which area is here".
import L from 'leaflet';
import { SPOT_LABELS, formatArea } from './core.js';
import { spotsShown, metresAcross, SPOT_SCALE_M, SCALE_BAR_PX, pickArea } from './geo.js';
import { mapLinkIcons } from '../maplinks-ui.js';
import { el } from '../cards.js';

export const DISCLAIMER = 'Community recommendation, not flight authorization. Check current official restrictions and local conditions before flying.';
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const SPOT_ICONS = {
  shelter: SVG('<path d="M3 11 12 4l9 7"/><path d="M5 11v8h14v-8"/>'),
  seating: SVG('<path d="M4 11h16"/><path d="M6 11v7M18 11v7"/><path d="M5 7h14"/>'),
  open: SVG('<rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 3"/>'),
  other: SVG('<circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="8"/>'),
};

export const toLatLngs = (ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng]);

/** Creates the panes and the two vector styles shared with the drawing controller. */
export function ensurePanes(map) {
  if (!map.getPane('community-areas')) { const p = map.createPane('community-areas'); p.style.zIndex = 410; p.style.pointerEvents = 'none'; }
}
// (colours come from the .community-area rules in styles.css, which follow the theme; SVG attributes cannot hold var(), so these are only the fallback)
export const AREA_STYLE = { pane: 'community-areas', interactive: false, className: 'community-area', color: '#7b4fd0', weight: 2.5, dashArray: '7 6', fillColor: '#7b4fd0', fillOpacity: 0.14, lineJoin: 'round' };

export function spotIcon(type, { out = false, selected = false } = {}) {
  return L.divIcon({ className: `area-spot area-spot-${type}${out ? ' out' : ''}${selected ? ' sel' : ''}`, html: SPOT_ICONS[type] ?? SPOT_ICONS.other, iconSize: [28, 28], iconAnchor: [14, 14] });
}

/**
 * The popup for a spot: a compact card with the type and icon, the optional note, the parent area, Navigate (the app-wide map-link control) and, when
 * `onView` is given, "View flying area". Text only (el/textContent). The standing disclaimer stays.
 */
export function spotPopup(spot, area, { onView = null } = {}) {
  const label = SPOT_LABELS[spot.type] ?? SPOT_LABELS.other;
  const box = el('div', 'area-popup');
  const head = el('div', 'area-popup-head'), ic = el('span', `area-popup-icon area-spot-${spot.type in SPOT_ICONS ? spot.type : 'other'}`);
  ic.innerHTML = SPOT_ICONS[spot.type] ?? SPOT_ICONS.other; // constant markup
  head.append(ic, el('strong', 'area-popup-type', label));
  box.append(head);
  if (spot.note) box.append(el('p', 'area-popup-note', spot.note));
  box.append(el('p', 'area-popup-parent', `Pilot setup spot in “${area.name}”${area.areaM2 ? ` · ${formatArea(area.areaM2)}` : ''}`));
  const row = el('div', 'area-popup-actions');
  const [lng, lat] = spot.coordinates ?? [];
  if (Number.isFinite(lat) && Number.isFinite(lng)) row.append(mapLinkIcons({ lat, lon: lng, name: `${label}, ${area.name}` }));
  if (onView) { const v = el('button', 'btn area-popup-view', 'View flying area'); v.type = 'button'; v.dataset.act = 'view-area'; v.addEventListener('click', () => onView()); row.append(v); }
  if (row.children.length) box.append(row);
  box.append(el('p', 'area-popup-disclaimer', DISCLAIMER));
  return box;
}

const POPUP = { closeOnClick: false, autoPan: true, className: 'area-popup-wrap', maxWidth: 280, autoPanPaddingTopLeft: [60, 70], autoPanPaddingBottomRight: [24, 90] };

export function createAreaLayer(map, store) {
  ensurePanes(map);
  const polys = L.layerGroup().addTo(map), spots = L.layerGroup().addTo(map);
  const markers = new Map(); // spot id -> marker
  let visible = true, selected = null, hiddenId = null, extra = null, near = spotsShown(map), onView = null;
  const all = () => [...store.list(), ...(extra ? [extra] : [])];
  const find = (id) => all().find((a) => a.id === id) ?? null;

  function paintPolys() {
    polys.clearLayers();
    if (!visible) return;
    for (const a of all()) {
      if (a.id === hiddenId) continue; // being edited: the drawing controller paints it (and its spots, whatever the scale)
      const sel = a.id === selected;
      L.polygon(toLatLngs(a.geometry.coordinates[0]), { ...AREA_STYLE, weight: sel ? 4 : 2.5, className: sel ? 'community-area is-selected' : 'community-area' }).addTo(polys);
    }
  }
  function paintSpots() {
    spots.clearLayers(); markers.clear();
    near = spotsShown(map);
    if (!visible || !near) return; // zoomed out: no spot markers, selected or not (the details panel still lists them)
    for (const a of all()) {
      if (a.id === hiddenId) continue;
      for (const s of a.spots) {
        const m = L.marker([s.coordinates[1], s.coordinates[0]], { icon: spotIcon(s.type), keyboard: true, title: SPOT_LABELS[s.type], alt: SPOT_LABELS[s.type] });
        m.bindPopup(() => spotPopup(s, a, { onView: onView ? () => { map.closePopup(); onView(a.id); } : null }), POPUP);
        m.addTo(spots); markers.set(s.id, m);
      }
    }
  }
  const paint = () => { paintPolys(); paintSpots(); };
  // the ground distance of the scale bar changes with zoom and, slowly, with latitude: repaint only when the rule flips
  const recheck = () => { if (spotsShown(map) !== near) paintSpots(); };
  map.on('zoomend moveend', recheck);
  store.onChange(paint);
  paint();

  /** The zoom at which the scale bar spans SPOT_SCALE_M or less at `ll` (never lower than the current zoom). */
  function zoomForSpots(ll) {
    let z = map.getZoom();
    const max = map.getMaxZoom() === Infinity ? 19 : map.getMaxZoom();
    const wide = (zz) => map.distance(ll, map.unproject(map.project(ll, zz).add([SCALE_BAR_PX, 0]), zz));
    while (z < max && wide(z) > SPOT_SCALE_M) z++;
    return z;
  }
  return {
    refresh: paint,
    setVisible(v) { visible = !!v; paint(); },
    get visible() { return visible; },
    get nearScale() { return near; },
    /** Highlights an area (null: none). It does not change which spots are shown. */
    select(id) { if (selected === id) return; selected = id; paintPolys(); }, // polygons only: an open spot popup must survive the panel giving way to it
    get selected() { return selected; },
    /** An area-shaped record that is not in the local store (a public area) to draw with the same rules; null clears it. */
    setExtra(area) { if (extra === area) return; extra = area; paint(); },
    /** Called with an area id when a spot popup's "View flying area" is pressed. */
    setOnView(fn) { onView = fn; },
    /** An area to leave out of the layer while it is being edited. */
    hide(id) { hiddenId = id; paint(); },
    /** The area under a tap, or null: local areas only, none while hidden or switched off. */
    areaAt(latlng) {
      if (!visible) return null;
      return pickArea(store.list().filter((a) => a.id !== hiddenId), latlng.lng, latlng.lat);
    },
    fit(id) {
      const a = find(id); if (!a) return;
      const b = L.latLngBounds(toLatLngs(a.geometry.coordinates[0]));
      map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    },
    /** Zooms in on a spot if the scale hides it, then opens its popup. */
    showSpot(areaId, spotId) {
      const a = find(areaId), s = a?.spots.find((x) => x.id === spotId);
      if (!s) return false;
      if (!visible) return false;
      const ll = L.latLng(s.coordinates[1], s.coordinates[0]);
      map.setView(ll, zoomForSpots(ll), { animate: false });
      paint();
      markers.get(s.id)?.openPopup();
      return true;
    },
    metresAcross: () => metresAcross(map),
  };
}
