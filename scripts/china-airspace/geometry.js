// Conservative planar checks on unprojected small-area lon/lat polygons. No repairs or rounding.
// Work limits fail closed: a large dataset requires an external topology review, not a silent pass.
export const polygons = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
export const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (p, a, b) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
export const edges = ring => ring.slice(0, -1).map((p, i) => [p, ring[i + 1]]);
export function segmentIntersection(a, b, c, d, strict = false) {
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  if (x * y < 0 && z * w < 0) return true;
  return !strict && (on(c, a, b) || on(d, a, b) || on(a, c, d) || on(b, c, d));
}
export function inRing(p, r) {
  let inside = false;
  for (const [a, b] of edges(r)) {
    if (on(p, a, b)) return 0; // boundary
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}
export function inPolygon(p, poly) {
  const outer = inRing(p, poly[0]);
  if (outer !== 1) return outer;
  for (const hole of poly.slice(1)) { const h = inRing(p, hole); if (h >= 0) return h === 0 ? 0 : -1; }
  return 1;
}
export const inGeometry = (p, g) => Math.max(...polygons(g).map(poly => inPolygon(p, poly)));
export function boundsOf(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygons(g)) for (const ring of poly) for (const [x, y] of ring) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}
export const bboxIntersects = (a, b, strict = false) => strict
  ? a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
  : a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export function bboxGeometry([w, s, e, n]) { return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }; }
export function intersectsBox(g, box) {
  if (!bboxIntersects(boundsOf(g), box)) return false;
  const ring = bboxGeometry(box).coordinates[0];
  if (ring.some(p => inGeometry(p, g) >= 0)) return true;
  for (const poly of polygons(g)) {
    if (poly[0].some(p => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3])) return true;
    for (const r of poly) for (const [a, b] of edges(r)) for (const [c, d] of edges(ring)) if (segmentIntersection(a, b, c, d)) return true;
  }
  return false;
}
export function budget(limit = 2_000_000) {
  let remaining = limit;
  const tick = () => { if (--remaining < 0) throw new Error('topology-budget-exhausted'); };
  tick.indexes = new WeakMap(); // rings are immutable within one validation budget
  return tick;
}
// Bounded AABB tree: preserve exact segment predicates, prune disjoint candidates.
function ringIndex(ring, tick) {
  const cache = tick.indexes ??= new WeakMap();
  if (cache.has(ring)) return cache.get(ring);
  const items = edges(ring).map(([a,b], i) => { tick(); return { a,b,i,box:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])] }; });
  function build(entries) {
    const box = [Infinity,Infinity,-Infinity,-Infinity];
    for (const e of entries) { box[0]=Math.min(box[0],e.box[0]); box[1]=Math.min(box[1],e.box[1]); box[2]=Math.max(box[2],e.box[2]); box[3]=Math.max(box[3],e.box[3]); }
    if (entries.length <= 8) return {box,entries};
    const axis=box[2]-box[0] >= box[3]-box[1] ? 0 : 1;
    entries.sort((a,b)=>(a.box[axis]+a.box[axis+2])-(b.box[axis]+b.box[axis+2]) || a.i-b.i);
    const mid=Math.floor(entries.length/2);
    return {box,left:build(entries.slice(0,mid)),right:build(entries.slice(mid))};
  }
  const index = {items,tree:build([...items])}; cache.set(ring,index); return index;
}
function* candidates(node, box, tick) {
  tick(); if (!bboxIntersects(node.box,box)) return;
  if (node.entries) { for(const e of node.entries) { tick(); if(bboxIntersects(e.box,box)) yield e; } }
  else { yield* candidates(node.left,box,tick); yield* candidates(node.right,box,tick); }
}
function ringsIntersect(a, b, tick, strict = false) {
  const [small,large] = a.length <= b.length ? [ringIndex(a,tick),ringIndex(b,tick)] : [ringIndex(b,tick),ringIndex(a,tick)];
  for (const e of small.items) for (const f of candidates(large.tree,e.box,tick)) if (segmentIntersection(e.a,e.b,f.a,f.b,strict)) return true;
  return false;
}
export function polygonOverlap(a, b, tick) {
  for (const ar of a) for (const br of b) if (ringsIntersect(ar, br, tick, true)) return true;
  // Vertices plus edge midpoints detect containment and coincident collinear sections.
  for (const [p, q] of [[a, b], [b, a]]) for (const [x, y] of edges(p[0])) {
    tick(); if (inPolygon(x, q) === 1 || inPolygon([(x[0] + y[0]) / 2, (x[1] + y[1]) / 2], q) === 1) return true;
  }
  // Same outer boundary with differing holes still has overlapping area.
  return JSON.stringify(canonicalRing(a[0])) === JSON.stringify(canonicalRing(b[0]));
}
export function geometryOverlap(a, b, tick = budget()) {
  if (!bboxIntersects(boundsOf(a), boundsOf(b), true)) return false;
  for (const ap of polygons(a)) for (const bp of polygons(b)) if (polygonOverlap(ap, bp, tick)) return true;
  return false;
}
const area = r => edges(r).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0) / 2;
export function geometryErrors(g, tick = budget()) {
  const issues = [];
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates) || !g.coordinates.length) return ['unsupported-or-empty-geometry'];
  const ps = polygons(g);
  for (const p of ps) {
    if (!Array.isArray(p) || !p.length) { issues.push('empty-polygon'); continue; }
    let structured = true;
    for (const r of p) {
      if (!Array.isArray(r) || r.length < 4 || r.some(c => !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) { issues.push('invalid-ring-or-coordinate-range'); structured = false; continue; }
      if (!equal(r[0], r.at(-1))) { issues.push('unclosed-ring'); structured = false; continue; }
      if (Math.abs(area(r)) < 1e-14) issues.push('zero-area-ring');
      const index = ringIndex(r,tick);
      for (const e of index.items) {
        if (equal(e.a,e.b)) issues.push('zero-length-edge');
        for (const f of candidates(index.tree,e.box,tick)) {
          const i=e.i,j=f.i; if(j<=i) continue;
          if (j === i + 1 || (i === 0 && j === index.items.length - 1)) {
            // Adjacent edges may share one endpoint, but may not reverse/overlap.
            const a=e.a,b=e.b,c=f.a,d=f.b;
            const common = equal(b, c) ? b : a;
            const x = equal(common, a) ? b : a, y = equal(common, c) ? d : c;
            if (cross(x, common, y) === 0 && ((x[0] - common[0]) * (y[0] - common[0]) + (x[1] - common[1]) * (y[1] - common[1])) > 0) issues.push('adjacent-edge-overlap');
            continue;
          }
          if (segmentIntersection(e.a,e.b,f.a,f.b)) issues.push('self-intersection');
        }
      }
    }
    if (!structured) continue;
    for (let h = 1; h < p.length; h++) {
      if (inRing(p[h][0], p[0]) !== 1 || ringsIntersect(p[h], p[0], tick)) issues.push('hole-outside-or-touching-shell');
      for (let k = 1; k < h; k++) if (ringsIntersect(p[h], p[k], tick) || inRing(p[h][0], p[k]) >= 0 || inRing(p[k][0], p[h]) >= 0) issues.push('overlapping-or-nested-holes');
    }
  }
  if (!issues.length) for (let i = 0; i < ps.length; i++) for (let j = 0; j < i; j++) if (polygonOverlap(ps[i], ps[j], tick)) issues.push('overlapping-multipolygon-parts');
  return [...new Set(issues)];
}
// Stable start vertex, orientation and part/hole order, preserving every coordinate exactly.
export function canonicalRing(r, clockwise = false) {
  const initial = r.slice(0, -1);
  const body = (area(r) < 0) === clockwise ? initial : initial.reverse();
  const candidates = [];
  const min = body.reduce((a, b) => b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a);
  for (let i = 0; i < body.length; i++) if (equal(body[i], min)) candidates.push([...body.slice(i), ...body.slice(0, i)]);
  candidates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return [...candidates[0], candidates[0][0]];
}
export function canonicalGeometry(g) {
  const ps = polygons(g).map(p => [canonicalRing(p[0]), ...p.slice(1).map(r => canonicalRing(r, true)).sort(jsonOrder)]).sort(jsonOrder);
  return ps.length === 1 ? { type: 'Polygon', coordinates: ps[0] } : { type: 'MultiPolygon', coordinates: ps };
}
const jsonOrder = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en');
