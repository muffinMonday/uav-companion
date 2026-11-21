// Parallel lanes for legs that run over the same road in opposite directions. Pure screen-space geometry on Leaflet layer points { x, y }.
//
// Each path is resampled every `step` px. A sample is "overlapping" when another leg passes within `tol` px of it going the opposite way (tangents more than
// ~120 degrees apart). Only those stretches are moved: each leg is shifted to its own right-hand side by `lane` px (the two lanes of a road), with a short ramp
// at both ends of a stretch so the band merges smoothly back into the true road geometry. Legs that never overlap an opposite leg are not touched, and
// same-direction duplicates keep sharing one geometry. The offset is in screen pixels, so lanes look the same at every zoom; they are recomputed on each draw.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Points every `step` px along the path (the end points are kept). */
export function resample(pts, step = 8) {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = dist(a, b);
    if (!len) continue;
    let at = step - carry;
    while (at <= len) { const f = at / len; out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }); at += step; }
    carry = len - (at - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (dist(tail, last) > 0.5) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}

const tangents = (pts) => pts.map((_, i) => {
  const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
});

/** Distance from p to a segment, and the segment's direction. */
function toSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { d: Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y), dir: l2 ? { x: dx / Math.sqrt(l2), y: dy / Math.sqrt(l2) } : { x: 1, y: 0 } };
}
const box = (pts, pad) => pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x - pad), y0: Math.min(b.y0, p.y - pad), x1: Math.max(b.x1, p.x + pad), y1: Math.max(b.y1, p.y + pad) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const CELL = 16; // px; at least the 8 px resample step, so a segment of a resampled path covers at most four cells
const meets = (a, b) =>a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Which samples of `a` run within `tol` px of `b` in the opposite direction. Returns a boolean array. */
export function oppositeFlags(a, ta, b, tol = 10) {
  const flags = new Array(a.length).fill(false);
  if (!meets(box(a, tol), box(b, tol))) return flags;
  // A sample can only be near the segments whose cell it reaches, so b's segments go into a grid: the work grows with the length of the paths, not with its square
  // (consecutive legs always touch at their shared stop, so the box test above never rules a pair out, and a long road has thousands of samples).
  const grid = new Map();
  const finite = (q) => Number.isFinite(q.x) && Number.isFinite(q.y);
  for (let k = 1; k < b.length; k++) {
    if (!finite(b[k - 1]) || !finite(b[k])) continue; // a non-finite point would make the cell loops endless; it has no place on the map anyway
    const x0 = Math.floor(Math.min(b[k - 1].x, b[k].x) / CELL), x1 = Math.floor(Math.max(b[k - 1].x, b[k].x) / CELL);
    const y0 = Math.floor(Math.min(b[k - 1].y, b[k].y) / CELL), y1 = Math.floor(Math.max(b[k - 1].y, b[k].y) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const key = cx + ',' + cy; const cell = grid.get(key); if (cell) cell.push(k); else grid.set(key, [k]); }
  }
  const seen = new Int32Array(b.length);
  for (let i = 0; i < a.length; i++) {
    let best = Infinity, bestK = Infinity, dir = null;
    const p = a[i];
    if (!finite(p)) continue;
    for (let cx = Math.floor((p.x - tol) / CELL); cx <= Math.floor((p.x + tol) / CELL); cx++) {
      for (let cy = Math.floor((p.y - tol) / CELL); cy <= Math.floor((p.y + tol) / CELL); cy++) {
        for (const k of grid.get(cx + ',' + cy) ?? []) {
          if (seen[k] === i + 1) continue;
          seen[k] = i + 1;
          const r = toSegment(p, b[k - 1], b[k]);
          if (r.d < best || (r.d === best && k < bestK)) { best = r.d; bestK = k; dir = r.dir; } // the nearest segment; the earlier one on a tie, as a full scan would pick
        }
      }
    }
    if (best <= tol && dir && ta[i].x * dir.x + ta[i].y * dir.y < -0.5) flags[i] = true;
  }
  return flags;
}

/** Offsets for the samples: 1 inside a flagged run, ramping to 0 over `ramp` samples either side; runs shorter than `minRun` samples are ignored. */
export function laneWeights(flags, { ramp = 3, minRun = 3 } = {}) {
  const n = flags.length, on = flags.slice();
  for (let i = 0; i < n;) { // drop short runs: two roads that merely cross are not a shared road
    if (!on[i]) { i++; continue; }
    let j = i; while (j < n && on[j]) j++;
    if (j - i < minRun) for (let k = i; k < j; k++) on[k] = false;
    i = j;
  }
  const w = new Array(n).fill(0);
  let d = Infinity;
  for (let i = 0; i < n; i++) { d = on[i] ? 0 : d + 1; w[i] = Math.max(w[i], Math.max(0, 1 - d / (ramp + 1))); }
  d = Infinity;
  for (let i = n - 1; i >= 0; i--) { d = on[i] ? 0 : d + 1; w[i] = Math.max(w[i], Math.max(0, 1 - d / (ramp + 1))); }
  return w;
}

/**
 * items: [{ pts, width, ... }] (several legs drawn together). Sets `drawPts` (the resampled, partly offset path) on the items that have an opposite-direction
 * overlap, and `lanes` (how many samples were moved); other items are left as they are. `lane(item)` is the offset in px (default half the band plus a gap).
 */
export function assignLanes(items, { lane = (it) => it.width / 2 + 1.5, step = 8, tol = 10 } = {}) {
  if (items.length < 2) return items;
  const rs = items.map((it) => { const p = resample(it.pts, step); return { p, t: tangents(p) }; });
  items.forEach((it, i) => {
    const flags = new Array(rs[i].p.length).fill(false);
    items.forEach((_, j) => { if (j !== i) oppositeFlags(rs[i].p, rs[i].t, rs[j].p, tol).forEach((f, k) => { if (f) flags[k] = true; }); });
    const w = laneWeights(flags);
    if (!w.some((x) => x > 0)) return;
    const o = lane(it);
    it.drawPts = rs[i].p.map((p, k) => {
      const t = rs[i].t[k], off = o * w[k]; // the right-hand side of travel on a screen whose y runs down is (-dy, dx)
      return { x: p.x - t.y * off, y: p.y + t.x * off };
    });
    it.lanes = w.filter((x) => x > 0).length;
  });
  return items;
}
