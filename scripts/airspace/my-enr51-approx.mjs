// Malaysia ENR 5.1: conservative APPROXIMATE geometry for areas whose published boundary follows a coastline or the Malaysia/Thailand border.
// Output: data/regions/my/my-enr51/layers/approx-{prohibited,restricted,danger}.geojson and approx-provenance.json. Never mixed into the verified layers.
// CAAM stays the source of identity, class, anchor coordinates, vertical limits and boundary semantics. The shape of the referenced coastline / border comes from the
// OpenStreetMap extract (approx-sources/osm-extract.json, scripts/airspace/my-enr51-osm.mjs). A coastline or border edge is pushed OUTWARD from the area by a buffer
// (derived from how far CAAM's own "on the coast" anchors lie from the OSM line, 500-2500 m), so the polygon errs towards over-covering, never under-covering.
// Usage: node scripts/airspace/my-enr51-approx.mjs [--html <file>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { direct, inverse, coords, arcPoints, ring, ccw, signedArea, selfIntersects, parseRows, circleRing, REFS_DOC, EDITION, CACHE } from './my-enr51.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'my', 'my-enr51');
const OSM = JSON.parse(fs.readFileSync(path.join(OUT, 'approx-sources', 'osm-extract.json'), 'utf8'));
const verified = Object.fromEntries(['prohibited', 'restricted', 'danger'].flatMap((k) => JSON.parse(fs.readFileSync(path.join(OUT, 'layers', k + '.geojson'), 'utf8')).features.map((f) => [f.properties.id, f])));
const NM = 1852, MAX_ARC_RADIUS_ERR = 0.06;
const P = (s) => coords(s)[0].p;
const datasetLines = (key) => OSM.features[key].lines;

// ---- the area definitions: CAAM anchor coordinates exactly as published; steps walk the boundary in the published order ----
// ['pt', coord] | ['arc', centre, rNM, 'cw'|'ccw'|'short', coord] | ['coast'|'border', dataset, coord] | ['bdry', verifiedId, coord, 'cw'|'ccw'|'short'] | ['pol', ...] (see below)
const HELI = '041358N 1003704E', HELI_C = '041357N 1003657E';
const DEFS = {
  WMR239A: { ref: 'coastline', start: '020900N 1022100E', steps: [['pt', '021715.30N 1022913.30E'], ['pt', '020900N 1024612E'], ['pt', '015500N 1023900E'], ['coast', 'coast_melaka', '020900N 1022100E']] },
  WMR239B: { ref: 'coastline', start: '020900N 1022100E', steps: [['coast', 'coast_melaka', '015500N 1023900E'], ['pt', '014700N 1023500E'], ['pt', '020000N 1021700E'], ['pt', '020700N 1022000E']] },
  WMR240A: { ref: 'coastline; arc centred on SJ DVOR/DME', start: '014409N 1030026E', centreNote: 'SJ (Sinjon DVOR/DME) 011322N 1035116E, CAAM ENR 4.1', steps: [['coast', 'coast_johor', '013202N 1032147E'], ['arc', '011322N 1035116E', 35, 'short', '011721N 1031628E'], ['pt', '012442N 1025342E']] },
  WMR240B: { ref: 'coastline', start: '015514N 1023907E', steps: [['coast', 'coast_johor', '014409N 1030026E'], ['pt', '012442N 1025342E'], ['pt', '013309N 1022758E']] },
  WMR416A: { ref: 'coastline; WMR416 boundary', start: '041614N 1003900E', steps: [['pt', '042247N 1004543E'], ['pt', '042747N 1004325E'], ['arc', HELI, 15, 'ccw', '042857N 1003715E'], ['coast', 'coast_lumut', '041624N 1003523E'], ['bdry', 'WMR416', '041614N 1003900E', 'short']] },
  WMR416B: { ref: 'coastline; WMR416 boundary', start: '041357N 1003357E', steps: [['pt', '041357N 1002157E'], ['arc', HELI, 15, 'cw', '042857N 1003715E'], ['coast', 'coast_lumut', '041624N 1003524E'], ['bdry', 'WMR416', '041357N 1003357E', 'short']] },
  WMR416C: { ref: 'coastline; WMR416 boundary', start: '041357N 1003357E', note: 'the straight line along bearing 270 from the WMR416 boundary to the 15 NM arc is implied (as in WMR416B)', steps: [['west15', HELI_C, 15], ['arc', HELI_C, 15, 'ccw', '040157N 1004455E'], ['coast', 'coast_lumut', '041057N 1003653E'], ['bdry', 'WMR416', '041357N 1003357E', 'cw']] },
  WMR419: { ref: 'coastline; western boundary of WMR416C (15 NM arc)', start: '041103N 1002216E', steps: [['arc', HELI_C, 15, 'ccw', '040135N 1004531E'], ['coast', 'coast_lumut', '034840N 1004623E'], ['pt', '032400N 1001705E'], ['pt', '041705N 0992000E']] },
  WBR524: { ref: 'coastline', start: '063400N 1160200E', steps: [['arc', '055400N 1160200E', 40, 'cw', '062742N 1162524E'], ['coast', 'coast_sabah', '061230N 1161030E'], ['arc', '055400N 1160200E', 20, 'ccw', '061400N 1160200E']] },
  WMR407: { ref: 'Malaysia/Thailand border', start: '061538N 1005220E', note: 'the published start "061538N 005220E" is read as 1005220E (as in WMR406)', steps: [['border', 'border_th', '055759N 1010705E'], ['pt', '055759N 1010155E']] },
  WMD419: { ref: 'Malaysia/Thailand border; arc centred on VKB', start: '055800N 1010659E', steps: [['pt', '055800N 1005700E'], ['pt', '054530N 1004820E'], ['pt', '053750N 1005100E'], ['pt', '052600N 1010730E'], ['pt', '052700N 1011240E'], ['pt', '053040N 1012030E'], ['pt', '053910N 1015254E'], ['arc', 'VKB', 40, 'cw', '054450N 1014729E'], ['border', 'border_th', '055800N 1010659E']] },
  WMP228: { ref: 'coastline', special: 'circle-coast', centre: '012845N 1034433E', rNM: 2, dataset: 'coast_johor' },
};
const SECONDARY = { coast: 'OpenStreetMap natural=coastline (ODbL), simplified to 3 m', border: 'OpenStreetMap boundary=administrative admin_level=2 (ODbL), simplified to 3 m' };

// ---- polyline utilities ----
const dM = (a, b) => inverse(a[0], a[1], b[0], b[1]).s;
function snap(lines, p) {
  let best = null; const k = Math.cos((p[1] * Math.PI) / 180);
  lines.forEach((l, li) => {
    for (let i = 0; i < l.length - 1; i++) {
      const a = l[i], b = l[i + 1], ax = a[0] * k, dx = b[0] * k - ax, dy = b[1] - a[1], len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] * k - ax) * dx + (p[1] - a[1]) * dy) / len)) : 0, q = [a[0] + t * (b[0] - a[0]), a[1] + t * dy], d = dM(p, q);
      if (!best || d < best.d) best = { d, li, s: i + t, q };
    }
  });
  return best;
}
/** Polyline vertices between the projections of A and B on the same merged polyline, in travel order A to B (closed rings take the shorter way). */
function between(lines, A, B, maxSnap) {
  const a = snap(lines, A), b = snap(lines, B);
  if (a.d > maxSnap || b.d > maxSnap) throw new Error(`anchor ${a.d > maxSnap ? 'A' : 'B'} is ${Math.round(Math.max(a.d, b.d))} m from the reference line`);
  if (a.li !== b.li) throw new Error('the two anchors lie on different reference polylines');
  const l = lines[a.li], mid = [];
  if (a.s <= b.s) for (let m = Math.floor(a.s) + 1; m <= Math.floor(b.s); m++) mid.push(l[m]);
  else for (let m = Math.floor(a.s); m > Math.floor(b.s); m--) mid.push(l[m]);
  return { snapA: a.q, snapB: b.q, mid, devA: a.d, devB: b.d };
}
const wrap = (az) => ((az % 360) + 360) % 360;
const centreOf = (c) => (c === 'VKB' ? REFS_DOC.points.VKB : P(c));

/** Builds the ring as [{p, f}] (f = vertex lies on an approximated edge). */
function build(id, def, lines = null) {
  const V = [], notes = [], anchors = [], devs = [];
  const add = (p, f = false) => V.push({ p, f });
  const anchor = (s, role) => { const p = P(s); anchors.push({ coord: s, lonlat: p, role }); return p; };
  if (def.special === 'circle-coast') return buildCircleCoast(def, anchors, devs);
  let cur = anchor(def.start, 'start'); add(cur);
  for (const st of def.steps) {
    const kind = st[0];
    if (kind === 'pt') { cur = anchor(st[1], 'vertex'); add(cur); }
    else if (kind === 'west15') { // implied line from the WMR416 boundary west point to the 15 NM arc, then the arc start
      const c = P(st[1]), w = direct(c[0], c[1], 270, st[2] * NM).map((v) => +v.toFixed(6)); anchors.push({ coord: st[1], lonlat: c, role: 'arc centre (helipad reference point)' }); add(w); cur = w;
    } else if (kind === 'arc') {
      const [, ctr, rNM, dir, to] = st, c = centreOf(ctr), end = anchor(to, 'arc end'), rM = rNM * NM;
      if (ctr !== 'VKB') anchors.push({ coord: ctr, lonlat: c, role: 'arc centre' }); else anchors.push({ coord: 'VKB DVOR/DME (ENR 4.1)', lonlat: c, role: 'arc centre' });
      const e1 = Math.abs(dM(c, cur) - rM) / rM, e2 = Math.abs(dM(c, end) - rM) / rM;
      if (e1 > MAX_ARC_RADIUS_ERR || e2 > MAX_ARC_RADIUS_ERR) throw new Error(`arc endpoints are ${(Math.max(e1, e2) * 100).toFixed(1)}% off the stated ${rNM} NM radius`);
      let cw = dir === 'cw';
      if (dir === 'short') { const sw = wrap(inverse(c[0], c[1], end[0], end[1]).az - inverse(c[0], c[1], cur[0], cur[1]).az); cw = sw <= 180; notes.push(`arc direction not published for the ${rNM} NM arc: the shorter arc (${Math.min(sw, 360 - sw).toFixed(0)} degrees) was taken`); }
      for (const q of arcPoints(c, rM, cur, end, cw, 1)) add(q);
      add(end); cur = end;
    } else if (kind === 'coast' || kind === 'border') {
      const [, ds, to] = st, B = anchor(to, kind + ' anchor'), r = between(datasetLines(ds), cur, B, 6000);
      devs.push(r.devA, r.devB);
      add(r.snapA, true); for (const q of r.mid) add(q, true); add(r.snapB, true); add(B); cur = B;
    } else if (kind === 'bdry') { // along a verified CAAM area boundary (exact geometry, not approximated)
      const [, vid, to, dir] = st, B = anchor(to, 'boundary anchor'), rg = verified[vid].geometry.coordinates[0].slice(0, -1), n = rg.length;
      const near = (p) => rg.reduce((bi, q, i) => (dM(p, q) < dM(p, rg[bi]) ? i : bi), 0), ia = near(cur), ib = near(B);
      const fwd = [], back = []; for (let i = (ia + 1) % n; i !== (ib + 1) % n; i = (i + 1) % n) fwd.push(rg[i]); for (let i = (ia - 1 + n) % n; i !== (ib - 1 + n) % n; i = (i - 1 + n) % n) back.push(rg[i]);
      const len = (pts) => pts.reduce((s, q, i) => s + dM(i ? pts[i - 1] : cur, q), 0), ccwFirst = signedArea(ring(rg)) > 0; // fwd runs counter-clockwise when the ring does
      const choice = dir === 'short' ? (len(fwd) < len(back) ? fwd : back) : (dir === 'cw') === ccwFirst ? back : fwd;
      for (const q of choice.slice(0, -1)) add(q); add(B); cur = B; notes.push(`follows the verified ${vid} boundary`);
    }
  }
  if (V.length > 1 && V.at(-1).p[0] === V[0].p[0] && V.at(-1).p[1] === V[0].p[1]) V.pop(); // the last step ends on the start: the ring closes there
  return { V, notes, anchors, devs };
}

/** Circle limited by a coastline (WMP228): the coast between its two intersections with the circle, and the circle arc on the centre's side. */
function buildCircleCoast(def, anchors, devs) {
  const c = P(def.centre), rM = def.rNM * NM, lines = datasetLines(def.dataset), notes = [];
  anchors.push({ coord: def.centre, lonlat: c, role: 'circle centre' });
  const X = []; // intersections of the coast with the circle, in polyline order
  lines.forEach((l, li) => { for (let i = 0; i < l.length - 1; i++) {
    const a = l[i], b = l[i + 1], da = dM(c, a) - rM, db = dM(c, b) - rM;
    if (da * db < 0) { const t = da / (da - db); X.push({ li, i, t, p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] }); }
  } });
  const near = X.filter((x) => dM(c, x.p) < rM * 1.05); const byLine = near.filter((x) => x.li === near[0]?.li);
  if (byLine.length < 2) throw new Error('the coast does not cross the circle twice');
  byLine.sort((a, b) => a.i + a.t - (b.i + b.t)); const first = byLine[0], last = byLine.at(-1), l = lines[first.li];
  const pts = [first.p]; for (let m = first.i + 1; m <= last.i; m++) pts.push(l[m]); pts.push(last.p);
  const chord = (p) => (last.p[0] - first.p[0]) * (p[1] - first.p[1]) - (last.p[1] - first.p[1]) * (p[0] - first.p[0]);
  const aFirst = inverse(c[0], c[1], first.p[0], first.p[1]).az, aLast = inverse(c[0], c[1], last.p[0], last.p[1]).az;
  const side = (cwArc) => { const sw = cwArc ? wrap(aFirst - aLast) : -wrap(aLast - aFirst), mid = direct(c[0], c[1], aLast + sw / 2, rM); return Math.sign(chord(mid)) === Math.sign(chord(c)); };
  const cw = side(true); // the arc from `last` back to `first` that lies on the centre's side of the coast
  const V = pts.map((p) => ({ p, f: true }));
  V.push(...arcPoints(c, rM, last.p, first.p, cw, 1).map((p) => ({ p, f: false })));
  notes.push('the circle is limited by the coast on the side of its centre');
  return { V, notes, anchors, devs };
}

/** Douglas-Peucker on each run of approximated vertices (with its two exact neighbours), tolerance in metres: a smoother edge that the outward offset can follow without loops. */
function smoothRuns(V, tolM) {
  const n = V.length, k = Math.cos((V[0].p[1] * Math.PI) / 180), m = 111320, xy = (p) => [p[0] * k * m, p[1] * m], keep = V.map(() => true);
  const start = V.findIndex((v, i) => !v.f && V[(i + 1) % n].f); if (start < 0) return V;
  for (let off = 0; off < n;) {
    const i = (start + off) % n;
    if (!V[i].f && V[(i + 1) % n].f) {
      let len = 1; while (V[(i + len) % n].f) len++; // indices i .. i+len: exact, run..., exact
      const idx = Array.from({ length: len + 1 }, (_, t) => (i + t) % n), pts = idx.map((j) => xy(V[j].p)), kp = new Set([0, len]), stack = [[0, len]];
      while (stack.length) {
        const [a, b] = stack.pop(); let best = -1, bi = -1; const dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], l = dx * dx + dy * dy;
        for (let t = a + 1; t < b; t++) { const px = pts[t][0] - pts[a][0], py = pts[t][1] - pts[a][1], u = l ? Math.max(0, Math.min(1, (px * dx + py * dy) / l)) : 0, d = Math.hypot(px - u * dx, py - u * dy); if (d > best) { best = d; bi = t; } }
        if (best > tolM) { kp.add(bi); stack.push([a, bi], [bi, b]); }
      }
      idx.forEach((j, t) => { if (t > 0 && t < len && !kp.has(t)) keep[j] = false; });
      off += len;
    } else off++;
  }
  return V.filter((_, i) => keep[i]);
}

/** Removes small loops (cusps and spurs) from a vertex list: a crossing between edges i and j (j - i <= 400) whose in-between vertices are all approximated is replaced by the crossing point.
 *  Anchors (f = false) are never removed. Returns the repaired list, or null if a crossing remains. */
function repairLoops(V) {
  let v = V.map((x) => ({ ...x })), guard = 0;
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (;;) {
    const n = v.length; let found = null;
    for (let i = 0; i < n && !found; i++) for (let j = i + 2; j < n && !found; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = v[i].p, b = v[(i + 1) % n].p, c = v[j].p, e = v[(j + 1) % n].p;
      if (o(a, b, c) !== o(a, b, e) && o(c, e, a) !== o(c, e, b)) found = [i, j];
    }
    if (!found) return v;
    const [i, j] = found, n2 = v.length; if (process.env.APPROX_TRACE) console.error('loop', i, j, n2, v.slice(i + 1, j + 1).filter((x) => !x.f).length, JSON.stringify(v[i].p));
    if (j - i > 400 || ++guard > 400) return null;
    for (let t = i + 1; t <= j; t++) if (!v[t].f) return null;
    const a = v[i].p, b = v[i + 1].p, c = v[j].p, e = v[(j + 1) % n2].p, d = (b[0] - a[0]) * (e[1] - c[1]) - (b[1] - a[1]) * (e[0] - c[0]);
    const u = ((c[0] - a[0]) * (e[1] - c[1]) - (c[1] - a[1]) * (e[0] - c[0])) / d;
    v = [...v.slice(0, i + 1), { p: [+(a[0] + u * (b[0] - a[0])).toFixed(6), +(a[1] + u * (b[1] - a[1])).toFixed(6)], f: true }, ...v.slice(j + 1)];
  }
}

/** Pushes every approximated vertex outward by dM metres (outward = away from the interior); null if that makes the ring self-intersect. */
function outward(V, dMetres, force = false) {
  const n = V.length, k = Math.cos((V[0].p[1] * Math.PI) / 180), m = 111320;
  const loc = (p) => [p[0] * k * m, p[1] * m];
  // the offset tapers to nothing at the exact CAAM anchors that end each run (full strength 1.5 x buffer along the edge from them)
  const scale = V.map(() => 1), pos = V.map((v, i) => i);
  for (let i = 0; i < n; i++) {
    if (!V[i].f || V[(i - 1 + n) % n].f) continue;
    let j = i, len = 0; const cum = [0];
    while (V[(j + 1) % n].f) { const a = loc(V[j].p), b = loc(V[(j + 1) % n].p); len += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(len); j++; }
    for (let t = 0; t < cum.length; t++) scale[(i + t) % n] = Math.max(0, Math.min(1, Math.min(cum[t], len - cum[t]) / (1.5 * dMetres)));
  }
  void pos;
  const out = V.map((v, i) => {
    if (!v.f) return v.p;
    const a = loc(V[(i - 1 + n) % n].p), b = loc(v.p), c = loc(V[(i + 1) % n].p), u1 = [b[0] - a[0], b[1] - a[1]], u2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...u1) || 1, l2 = Math.hypot(...u2) || 1, n1 = [u1[1] / l1, -u1[0] / l1], n2 = [u2[1] / l2, -u2[0] / l2]; // right-hand normals (interior is on the left of a counter-clockwise ring)
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1]; const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) { nx = n1[0]; ny = n1[1]; } else { const miter = Math.min(2, 2 / nl); nx = (nx / nl) * miter; ny = (ny / nl) * miter; }
    return [+(v.p[0] + (nx * dMetres * scale[i]) / (k * m)).toFixed(6), +(v.p[1] + (ny * dMetres * scale[i]) / m).toFixed(6)];
  });
  const fixed = repairLoops(out.map((p, i) => ({ p, f: V[i].f })));
  return fixed ? ring(fixed.map((x) => x.p)) : force ? ring(out) : null;
}
const areaKm2 = (r) => { const k = Math.cos((r[0][1] * Math.PI) / 180); return Math.abs(signedArea(r.map((p) => [p[0] * k * 111.32, p[1] * 111.32]))); };

function main() {
  const html = fs.readFileSync(process.argv.includes('--html') ? process.argv[process.argv.indexOf('--html') + 1] : CACHE, 'utf8');
  const { rows } = parseRows(html), byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const layers = { prohibited: [], restricted: [], danger: [] }, provenance = [], failed = [], DEBUG = {};
  const CLS = { P: 'prohibited', R: 'restricted', D: 'danger' };
  for (const [id, def] of Object.entries(DEFS)) {
    const r = byId[id];
    try {
      let { V, notes, anchors, devs } = build(id, def);
      let sv = V; if (signedArea(ring(V.map((v) => v.p))) < 0) sv = [...V].reverse(); // counter-clockwise
      if (process.env.APPROX_DEBUG) DEBUG[id] = { sv, anchors: anchors.map((a) => a.lonlat), devs };
      const maxDev = Math.max(0, ...devs), bufferM = Math.max(500, Math.min(2500, Math.round((maxDev * 1.25) / 100) * 100));
      let used = bufferM, res = null;
      // smooth each coast/border run (tolerance buffer/3), then offset it outward by the buffer; if the ring crosses itself, retry without the snap points next to the anchors, then with a smaller buffer
      const trimEnds = (v, k) => { const n = v.length, keep = v.map(() => true); for (let i = 0; i < n; i++) { if (!v[i].f) continue; let d1 = 0, d2 = 0; while (d1 < k && v[(i - 1 - d1 + n) % n].f) d1++; while (d2 < k && v[(i + 1 + d2) % n].f) d2++; if (d1 < k || d2 < k) keep[i] = false; } return v.filter((_, i) => keep[i]); }; // drops up to k approximated vertices beside each exact anchor
      let smooth = sv;
      for (const variant of [sv, trimEnds(sv, 1), trimEnds(sv, 4), trimEnds(sv, 12), trimEnds(sv, 40)]) { if (res) break; for (used = bufferM; !res && used >= 250; used = Math.round(used / 2)) { const fixed = repairLoops(smoothRuns(variant, used / 3)); if (!fixed) continue; smooth = fixed; res = outward(smooth, used); if (res) break; } }
      if (!res) { if (process.env.APPROX_DEBUG) DEBUG[id].off = outward(smooth, used, true); throw new Error('the coast/border offset self-intersects'); }
      const exactAnchors = anchors.filter((a) => a.role !== 'arc centre' && a.role !== 'circle centre' && !/centre/.test(a.role));
      const chord = ring(smooth.filter((v) => !v.f).map((v) => v.p)), ratio = chord.length > 3 ? areaKm2(res) / areaKm2(chord) : null, area = areaKm2(res);
      if (Math.abs(signedArea(res)) < 1e-9) throw new Error('zero area');
      if (area > 20000) throw new Error('area exceeds 20,000 km2 (malformed)');
      if (ratio !== null && (ratio < 0.5 || ratio > 5)) throw new Error(`area is ${ratio.toFixed(2)}x the straight-line polygon through the anchors`);
      for (const a of exactAnchors) { const hit = res.some((q) => Math.abs(q[0] - a.lonlat[0]) < 1e-6 && Math.abs(q[1] - a.lonlat[1]) < 1e-6); if (!hit && a.role !== 'implied') throw new Error('anchor not preserved: ' + a.coord); }
      const cls = CLS[id[2]], types = def.ref.split(/;\s*/);
      const desc = [`Upper ${r.upper}`, `lower ${r.lower || 'n/a'}`].join(', ') + `. ${r.restriction ? r.restriction + '. ' : ''}${r.remarks}`.replace(/\.\s*\./g, '.');
      layers[cls].push({ type: 'Feature', properties: { id, name: `${id}${r.name !== id ? ' ' + r.name : ''}`, class: id[2], upper: r.upper, lower: r.lower, vertical: r.vertical, restriction: r.restriction, remarks: r.remarks, description: desc.trim().slice(0, 500), geometryKind: 'approximate', approximate: true, bufferM: used }, geometry: { type: 'Polygon', coordinates: [res] } });
      provenance.push({
        id, class: id[2], approximate: true, confidence: 'approximate', caamEdition: { edition: 'AIP AMDT 04/26', effective: EDITION }, caamSource: 'ENR 5.1 ' + id,
        caamText: r.text, anchors: anchors.map((a) => ({ caam: a.coord, role: a.role, lonlat: a.lonlat, inPolygon: !/centre/.test(a.role) })), referencedFeatureTypes: types,
        secondaryDataset: { name: 'OpenStreetMap contributors', licence: 'ODbL 1.0', extract: 'approx-sources/osm-extract.json', used: [...new Set(def.steps?.filter((s) => s[0] === 'coast' || s[0] === 'border').map((s) => SECONDARY[s[0]]) ?? [SECONDARY.coast])] },
        method: 'CAAM anchor points and stated arcs are kept exactly; each coastline/border edge between two anchors follows the OpenStreetMap line and is then offset outward from the area by the buffer.',
        bufferM: used, bufferBasis: `1.25 x the largest distance (${Math.round(maxDev)} m) between a CAAM coastline/border anchor and the OpenStreetMap line, within 500-2500 m`,
        areaKm2: +area.toFixed(1), straightLineAreaRatio: ratio === null ? null : +ratio.toFixed(2), notes: [...notes, ...(def.note ? [def.note] : [])],
        limitations: 'Not an official CAAM polygon. The referenced coastline/border is reproduced from OpenStreetMap, not from CAAM GIS data, and the edge is deliberately widened. Treat as potentially restricted and verify with current CAAM information.',
      });
    } catch (e) { failed.push({ id, reason: e.message }); }
  }
  if (process.env.APPROX_DEBUG) fs.writeFileSync(process.env.APPROX_DEBUG, JSON.stringify(DEBUG));
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  for (const [k, features] of Object.entries(layers)) fs.writeFileSync(path.join(OUT, 'layers', `approx-${k}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  fs.writeFileSync(path.join(OUT, 'approx-provenance.json'), JSON.stringify({ note: 'Approximate (conservatively reconstructed) ENR 5.1 areas. Not official CAAM polygons.', features: provenance, notReconstructed: failed }, null, 1) + '\n');
  const exFile = path.join(OUT, 'exceptions.json'), ex = JSON.parse(fs.readFileSync(exFile, 'utf8')), done = new Set(provenance.map((p) => p.id));
  ex.approximation = { approximate: provenance.map((p) => p.id), approximateCount: done.size, unresolvedAfterApproximation: ex.exceptions.filter((e) => !done.has(e.id)).map((e) => e.id), note: 'Approximate areas are in layers/approx-*.geojson with approx-provenance.json; they are not verified geometry.' };
  for (const e of ex.exceptions) if (done.has(e.id)) e.approximated = true;
  fs.writeFileSync(exFile, JSON.stringify(ex, null, 2) + '\n');
  console.log(JSON.stringify({ built: provenance.map((p) => `${p.id} ${p.areaKm2}km2 r${p.straightLineAreaRatio} b${p.bufferM}`), failed }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
void circleRing; void ccw;
