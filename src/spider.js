// Coincident markers: pins that sit on (almost) the same screen point are fanned out when the stack is clicked, so each one can be chosen. The records are never
// merged or changed: the fan only moves each pin's DISPLAY position while it is open (the stored coordinates are untouched), and it closes before anything else happens.
// The grouping and the layout are pure (tested in tests/spider-unit.mjs); createSpider() connects them to a Leaflet map and the marker layer.

export const COINCIDENT_PX = 14;  // pins closer than this on screen are one stack (a pin is 30 px wide)
export const MAX_FAN = 24;         // at most this many pins are fanned; a stack of more keeps the rest under the first ones

/** Groups of two or more points within `radius` px of each other (chains join): [{ id, x, y }] -> array of arrays, each in input order. Singles are left out. */
export function clusterByScreen(points, radius = COINCIDENT_PX) {
  const parent = points.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cell = radius, grid = new Map();
  points.forEach((p, i) => { const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      if (j > i && Math.hypot(points[j].x - p.x, points[j].y - p.y) <= radius) parent[find(j)] = find(i);
    }
  });
  const groups = new Map();
  points.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Where each of `n` pins goes: offsets in px from the stack, in a fixed order starting straight up and turning clockwise. Up to 8 pins sit on a circle
 * (radius grows with the count so neighbours never touch); more follow a spiral. `step` is the room one pin needs (a pin is 30 px wide).
 */
export function fanLayout(n, step = 36) {
  const out = [];
  if (n <= 0) return out;
  if (n <= 8) {
    const r = Math.max(40, (n * step) / (2 * Math.PI) + 8);
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
    return out;
  }
  let r = 48, a = -Math.PI / 2;
  for (let i = 0; i < n; i++) { out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); a += step / r; r += 3.4; }
  return out;
}

/**
 * The fan on a map. `markers`: Map id -> Leaflet marker; `visible(id)`: is this pin drawn right now (its trip is shown, a folded Side Quest is not);
 * `home(id)`: the stored [lat, lon] of the marker (what its pin goes back to); `enabled()`: false in a mode where pins must not move (edit mode);
 * `fanWhen(ids)`: is this stack one to fan out? (The app fans only stacks that mix trips: visits of one place within one trip keep their top pin and visit chips.)
 */
export function createSpider({ L, map, markers, visible, home, enabled = () => true, fanWhen = () => true, announce = () => {} }) {
  const stems = L.layerGroup().addTo(map);
  let open = null; // { ids: [...], origin }

  function collapse() {
    if (!open) return false;
    for (const id of open.ids) { const m = markers.get(id), h = home(id); if (m) { if (h) m.setLatLng(h); m.setZIndexOffset(0); m.getElement()?.classList.remove('spidered'); } }
    stems.clearLayers();
    open = null;
    return true;
  }

  /** The stack that holds this pin right now, as ids (the pin itself included), or null if it is alone. */
  function stackOf(id) {
    const pts = [];
    for (const [k, m] of markers) {
      if (!visible(k)) continue;
      const p = map.latLngToLayerPoint(m.getLatLng());
      pts.push({ id: k, x: p.x, y: p.y });
    }
    const group = clusterByScreen(pts).find((g) => g.some((p) => p.id === id));
    return group ? group.map((p) => p.id) : null;
  }

  /**
   * Call from a pin's click. Returns true when this click was used to open a fan (the caller then does nothing else); false when the pin is alone or already
   * part of the open fan (the click goes on as usual; an open fan closes first so the window opens where the pin really is).
   */
  function handle(id) {
    if (!enabled()) { collapse(); return false; }
    if (open) { const was = open.ids.includes(id); collapse(); if (was) return false; }
    const ids = stackOf(id);
    if (!ids || !fanWhen(ids)) return false;
    const shown = ids.slice(0, MAX_FAN);
    const centre = map.latLngToLayerPoint(markers.get(id).getLatLng());
    const offs = fanLayout(shown.length);
    shown.forEach((k, i) => {
      const m = markers.get(k), ll = map.layerPointToLatLng([centre.x + offs[i].x, centre.y + offs[i].y]);
      L.polyline([map.layerPointToLatLng([centre.x, centre.y]), ll], { color: '#607d8b', weight: 2, opacity: 0.8, className: 'spider-stem', interactive: false }).addTo(stems);
      m.setLatLng(ll); m.setZIndexOffset(600); m.getElement()?.classList.add('spidered');
    });
    L.circleMarker(map.layerPointToLatLng([centre.x, centre.y]), { radius: 3, color: '#607d8b', fillColor: '#607d8b', fillOpacity: 1, weight: 1, className: 'spider-hub', interactive: false }).addTo(stems);
    open = { ids: shown };
    announce(`${shown.length} markers at this spot. Press Tab to move between them, Enter to open one, Escape to close.`);
    markers.get(shown[0])?.getElement()?.focus?.({ preventScroll: true });
    return true;
  }

  map.on('click zoomstart movestart', collapse); // a click on the background, a zoom or a pan puts the pins back
  const onKey = (e) => { if (e.key === 'Escape' && open) { const first = open.ids[0]; collapse(); markers.get(first)?.getElement()?.focus?.({ preventScroll: true }); } };
  document.addEventListener('keydown', onKey);
  return { handle, collapse, isOpen: () => !!open, ids: () => (open ? open.ids.slice() : []), stackOf, destroy() { collapse(); map.off('click zoomstart movestart', collapse); document.removeEventListener('keydown', onKey); stems.remove(); } };
}
