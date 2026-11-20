// Draws itinerary legs on a Leaflet map: a broad band in the trip colour, chevrons fitted inside it, and always-on distance labels. Road routes follow their
// geometry; a straight-line fallback is a dashed band with a "straight line" label. Everything is computed in layer (pixel) space and redrawn when the view
// changes (zoom, pan); nothing here ever asks for a route. The map's own rotation turns the layer pane, so bands and chevrons turn with the map for free and the
// labels (markers) stay upright through the existing marker patch in maprotate.js.
import { BAND, bandStyle, chevronMarks, chevronShape, armFor, cumulative, visibleSpan, layoutLabels, labelText } from './geometry.js';
import { assignLanes } from './overlap.js';

const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c)); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Chevron ink that stays readable on the trip colour: white on dark and mid colours, near-black on light ones. */
export function inkFor(color) {
  const rgb = hex(color);
  if (!rgb) return '#fff';
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.4 ? '#1b1b1b' : '#fff';
}

/**
 * `entries`: [{ layer, leg, result, color, bold, overnight, pending }]; `layer` is the layer group each leg goes to (the caller clears them before each draw).
 * `fmt(m)` formats a distance in the person's units; `pins()` returns the on-screen pin positions as latlngs.
 */
export function createRouteRenderer({ L, map, el, fmt, pins = () => [] }) {
  const bearing = () => map._rot?.bearing?.() ?? 0;
  // layer point -> screen-aligned point: undoes the pane rotation (`rotate(-bearing)`), so label rectangles are compared as they look
  const screen = (p) => { const a = (bearing() * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };
  const toPts = (coords) => coords.map(([lat, lon]) => { const p = map.latLngToLayerPoint([lat, lon]); return { x: p.x, y: p.y }; });
  const toLL = (p) => map.layerPointToLatLng([p.x, p.y]);
  function viewTest(pad) {
    const size = map.getSize(), b = bearing();
    return (p) => {
      const c = map.layerPointToContainerPoint([p.x, p.y]);
      if (b) { const r = Math.hypot(size.x, size.y) / 2 + pad; return Math.hypot(c.x - size.x / 2, c.y - size.y / 2) <= r; } // turned: a circle that holds the view
      return c.x >= -pad && c.x <= size.x + pad && c.y >= -pad && c.y <= size.y + pad;
    };
  }

  function draw(entries) {
    if (!entries.length) return;
    const size = map.getSize();
    const near = viewTest(Math.max(size.x, size.y) * 0.5), onScreen = viewTest(0);
    // 1. pixel paths, in a fixed order (selected first, then by key) so every choice below is the same on every draw
    const items = entries.map((e) => {
      const pts = toPts(e.result.coords);
      return { ...e, key: e.result.key + (e.bold ? '*' : ''), pts, ...cumulative(pts), width: e.bold ? BAND.bold : BAND.normal };
    }).sort((a, b) => (a.bold === b.bold ? (a.result.key < b.result.key ? -1 : a.result.key > b.result.key ? 1 : 0) : a.bold ? -1 : 1));
    // 2. parallel lanes where two legs run over the same road in opposite directions (the overlapping stretch only)
    assignLanes(items, { lane: (it) => it.width * 0.5 + 1.5 });
    // 3. bands and chevrons
    for (const it of items) {
      const road = it.result.state === 'road', ink = inkFor(it.color);
      const cls = ['route-band', it.bold ? 'bold' : '', road ? 'road' : 'route-fallback fallback', it.overnight ? 'overnight' : ''].filter(Boolean).join(' ');
      const ll = (it.drawPts ?? it.pts).map(toLL), st = bandStyle({ road, overnight: it.overnight }), dashed = !!st.dash;
      L.polyline(ll, { color: it.color, weight: it.width + 4, opacity: 1, className: 'route-case' + (it.bold ? ' bold' : ''), interactive: false, lineCap: 'butt', lineJoin: 'round', dashArray: st.dash, noClip: dashed }).addTo(it.layer);
      L.polyline(ll, { color: it.color, weight: it.width, opacity: it.bold ? 0.92 : 0.62, className: cls, interactive: false, lineCap: st.cap, lineJoin: 'round', dashArray: st.dash, noClip: dashed }).addTo(it.layer);
      for (const m of chevronMarks(it.drawPts ?? it.pts, { inView: near, spacing: st.spacing, first: st.first })) {
        L.polyline(chevronShape(m, 3.4, armFor(it.width)).map(toLL), { color: ink, weight: 2.1, opacity: 0.95, className: 'route-chev', interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(it.layer);
      }
    }
    // 4. labels, one per leg, placed without overlap (geometry.js documents the degradation order)
    const pinBoxes = pins().map((ll) => { const p = map.latLngToLayerPoint(ll), s = screen(p); return { x: s.x, y: s.y - 18, w: 32, h: 44 }; });
    const placed = layoutLabels(items.map((it) => {
      const pts = it.drawPts ?? it.pts, c = it.drawPts ? cumulative(pts) : it;
      const texts = labelText(it.result, fmt);
      return { key: it.key, pts, cum: c.cum, texts: { full: texts.full, compact: texts.compact }, span: visibleSpan(pts, c.cum, onScreen), dupKey: `${it.result.key}|${texts.full}` };
    }), { screen, obstacles: pinBoxes });
    for (const it of items) {
      const spot = placed.get(it.key);
      if (!spot || spot.omitted) continue;
      const t = labelText(it.result, fmt);
      const lab = el('span', `dist-label-text seg-label route-label ${it.result.state === 'road' ? 'road' : 'fallback'}${it.bold ? ' bold' : ''}${it.overnight ? ' overnight' : ''}`, spot.text);
      lab.style.borderColor = it.color;
      lab.setAttribute('role', 'img'); lab.setAttribute('aria-label', t.aria + (it.overnight ? ', overnight leg' : ''));
      lab.dataset.state = it.result.state; lab.dataset.mode = spot.mode;
      if (it.pending) lab.dataset.pending = '1';
      L.marker(toLL({ x: spot.x, y: spot.y }), { icon: L.divIcon({ className: 'dist-label route-label-box', html: lab, iconSize: null }), interactive: false, keyboard: false }).addTo(it.layer);
    }
  }
  return { draw };
}
