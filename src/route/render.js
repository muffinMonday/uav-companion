// Draws itinerary legs on a Leaflet map: a broad band in the trip colour, chevrons fitted inside it, and always-on distance labels. Road routes follow their
// geometry; a straight-line fallback is a dashed band with a "straight line" label. Everything is computed in layer (pixel) space and redrawn when the view
// changes (zoom, pan); nothing here ever asks for a route. The map's own rotation turns the layer pane, so bands and chevrons turn with the map for free and the
// labels (markers) stay upright through the existing marker patch in maprotate.js.
import { BAND, bandStyle, chevronMarks, chevronShape, armFor, cumulative, visibleSpan, layoutLabels, labelText, simplifyIdx } from './geometry.js';
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
  // The pixel path to draw for a road's coordinates, and the same selection of the stored coordinates (`ll`, for a band that is not moved into a lane).
  // In Web Mercator a point's pixel position at zoom z is its position at zoom 0 times 2^z, so each geometry is projected once (kept per coordinate array; the
  // router hands out the same array until the stored route changes) and a draw is a multiply and a round; the rounding is the one map.latLngToLayerPoint does.
  // Only the points that matter at half a pixel are kept. Panning moves every point by whole pixels, so what is kept depends on the zoom alone and is worked
  // out once per zoom, not on every draw. Any projection other than Web Mercator takes the map's own path, with no cache.
  const unit = new WeakMap();
  const mercator = () => map.options.crs === L.CRS.EPSG3857;
  function shape(coords) {
    if (!mercator()) {
      const raw = coords.map(([lat, lon]) => { const q = map.latLngToLayerPoint([lat, lon]); return { x: q.x, y: q.y }; }), keep = simplifyIdx(raw);
      return { pts: keep.map((i) => raw[i]), ll: keep.map((i) => coords[i]) };
    }
    let u = unit.get(coords);
    if (!u) { const p0 = new Float64Array(coords.length * 2); coords.forEach(([lat, lon], i) => { const q = map.options.crs.latLngToPoint(L.latLng(lat, lon), 0); p0[2 * i] = q.x; p0[2 * i + 1] = q.y; }); u = { p0, k: NaN, ax: null, ll: null }; unit.set(coords, u); }
    const k = Math.pow(2, map.getZoom()), o = map.getPixelOrigin();
    if (u.k !== k) {
      const n = coords.length, abs = new Array(n);
      for (let i = 0; i < n; i++) abs[i] = { x: Math.round(u.p0[2 * i] * k), y: Math.round(u.p0[2 * i + 1] * k) };
      const keep = simplifyIdx(abs);
      u.k = k; u.ll = keep.map((i) => coords[i]); u.ax = keep.map((i) => abs[i]);
    }
    return { pts: u.ax.map((q) => ({ x: q.x - o.x, y: q.y - o.y })), ll: u.ll };
  }
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
      const { pts, ll } = shape(e.result.coords);
      return { ...e, key: e.result.key + (e.bold ? '*' : ''), pts, ll, ...cumulative(pts), width: e.bold ? BAND.bold : BAND.normal };
    }).sort((a, b) => (a.bold === b.bold ? (a.result.key < b.result.key ? -1 : a.result.key > b.result.key ? 1 : 0) : a.bold ? -1 : 1));
    // 2. parallel lanes where two legs run over the same road in opposite directions (the overlapping stretch only)
    assignLanes(items, { lane: (it) => it.width * 0.5 + 1.5 });
    // 3. bands and chevrons; the emphasised (selected) legs are drawn last, so they lie on top where legs share a road
    for (const it of [...items].reverse()) {
      const road = it.result.state === 'road', ink = inkFor(it.color);
      const cls = ['route-band', it.bold ? 'bold' : '', road ? 'road' : 'route-fallback fallback', it.overnight ? 'overnight' : ''].filter(Boolean).join(' ');
      const ll = it.drawPts ? it.drawPts.map(toLL) : it.ll, st = bandStyle({ road, overnight: it.overnight }), dashed = !!st.dash;
      L.polyline(ll, { color: it.color, weight: it.width + 4, opacity: 1, className: 'route-case' + (it.bold ? ' bold' : ''), interactive: false, lineCap: 'butt', lineJoin: 'round', dashArray: st.dash, noClip: dashed }).addTo(it.layer);
      L.polyline(ll, { color: it.color, weight: it.width, opacity: it.bold ? 0.92 : 0.62, className: cls, interactive: false, lineCap: st.cap, lineJoin: 'round', dashArray: st.dash, noClip: dashed }).addTo(it.layer);
      // all the chevrons of a leg are one path of separate three-point strokes: a long day has hundreds, and one SVG element each was most of the layers drawn
      const marks = chevronMarks(it.drawPts ?? it.pts, { inView: near, spacing: st.spacing, first: st.first });
      if (marks.length) L.polyline(marks.map((m) => chevronShape(m, 3.4, armFor(it.width)).map(toLL)), { color: ink, weight: 2.1, opacity: 0.95, className: 'route-chev', interactive: false, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(it.layer);
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
