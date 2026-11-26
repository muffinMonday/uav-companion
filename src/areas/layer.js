// Community flying areas, Phase 1: how saved local areas look on the map. Display only.
//   - Polygons are NOT interactive (pointer-events none), so they never take a tap, a drag, a hold or a right-click from the map: the point check works
//     inside and outside an area exactly as before, and the verdict never reads these shapes.
//   - They have their own pane under the markers and their own purple dashed outline (--community in styles.css), unlike the teal/red official zones.
//   - Pilot setup spots are small markers shown at zoom 13 and closer (owner decision 2026-11-27) or whenever their area is selected.
import L from 'leaflet';
import { SPOT_LABELS, formatArea } from './core.js';
import { el } from '../cards.js';

export const SPOT_ZOOM = 13;
export const DISCLAIMER = 'Community recommendation, not flight authorization. Check current official restrictions and local conditions before flying.';
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const SPOT_ICONS = {
  shelter: SVG('<path d="M3 11 12 4l9 7"/><path d="M5 11v8h14v-8"/>'),
  seating: SVG('<path d="M4 11h16"/><path d="M6 11v7M18 11v7"/><path d="M5 7h14"/>'),
  open: SVG('<rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 3"/>'),
  other: SVG('<circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="8"/>'),
};

const toLatLngs = (ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng]);

/** Creates the panes and the two vector styles shared with the drawing controller. */
export function ensurePanes(map) {
  if (!map.getPane('community-areas')) { const p = map.createPane('community-areas'); p.style.zIndex = 410; p.style.pointerEvents = 'none'; }
}
// (colours come from the .community-area rules in styles.css, which follow the theme; SVG attributes cannot hold var(), so these are only the fallback)
export const AREA_STYLE = { pane: 'community-areas', interactive: false, className: 'community-area', color: '#7b4fd0', weight: 2.5, dashArray: '7 6', fillColor: '#7b4fd0', fillOpacity: 0.14, lineJoin: 'round' };

export function spotIcon(type, { out = false, selected = false } = {}) {
  return L.divIcon({ className: `area-spot area-spot-${type}${out ? ' out' : ''}${selected ? ' sel' : ''}`, html: SPOT_ICONS[type] ?? SPOT_ICONS.other, iconSize: [28, 28], iconAnchor: [14, 14] });
}

/** The popup for a spot: type, note, parent area and the standing disclaimer. Text only. */
export function spotPopup(spot, area) {
  const box = el('div', 'area-popup');
  box.append(el('strong', 'area-popup-type', SPOT_LABELS[spot.type] ?? SPOT_LABELS.other));
  if (spot.note) box.append(el('p', 'area-popup-note', spot.note));
  box.append(el('p', 'area-popup-parent', `Pilot setup spot in “${area.name}” (${formatArea(area.areaM2 ?? 0)})`));
  box.append(el('p', 'area-popup-disclaimer', DISCLAIMER));
  return box;
}

export function createAreaLayer(map, store) {
  ensurePanes(map);
  const polys = L.layerGroup().addTo(map), spots = L.layerGroup().addTo(map);
  let visible = true, selected = null, hiddenId = null;

  function paint() {
    polys.clearLayers(); spots.clearLayers();
    if (!visible) return;
    const near = map.getZoom() >= SPOT_ZOOM;
    for (const a of store.list()) {
      if (a.id === hiddenId) continue; // being edited: the drawing controller paints it
      L.polygon(toLatLngs(a.geometry.coordinates[0]), { ...AREA_STYLE, weight: a.id === selected ? 4 : 2.5 }).addTo(polys);
      if (!near && a.id !== selected) continue;
      for (const s of a.spots) {
        const m = L.marker([s.coordinates[1], s.coordinates[0]], { icon: spotIcon(s.type), keyboard: true, title: SPOT_LABELS[s.type], alt: SPOT_LABELS[s.type] });
        m.bindPopup(() => spotPopup(s, a), { closeOnClick: false, autoPan: true, className: 'area-popup-wrap' });
        m.addTo(spots);
      }
    }
  }
  map.on('zoomend', paint);
  store.onChange(paint);
  paint();
  return {
    refresh: paint,
    setVisible(v) { visible = !!v; paint(); },
    get visible() { return visible; },
    /** The area whose spots stay shown at any zoom (null: none). */
    select(id) { selected = id; paint(); },
    /** An area to leave out of the layer while it is being edited. */
    hide(id) { hiddenId = id; paint(); },
    fit(id) {
      const a = store.get(id); if (!a) return;
      const b = L.latLngBounds(toLatLngs(a.geometry.coordinates[0]));
      map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    },
  };
}
