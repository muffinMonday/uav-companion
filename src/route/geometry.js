// Screen-space geometry for drawing routes: chevron placement along a path, label text, and deterministic label placement. Pure functions on pixel points
// { x, y } (Leaflet layer points, which stay put while the map is turned); no Leaflet, no DOM. Tested in tests/route-geometry-unit.mjs.

export const BAND = { normal: 9, bold: 12 };        // band width in CSS px: "balanced": readable, not dominant (tuning targets, not constants of the design)
export const CHEVRON_SPACING = 80;                   // px between chevrons along the path
const deg = (r) => (r * 180) / Math.PI;

/**
 * Which points of a pixel path to draw (indices, ascending, always including the first and the last): the points that matter at `tol` px. A road geometry has a
 * point every few metres, many of them in the same pixel; every one costs a projection, a path segment and a pass in each step below, and none of the ones left
 * out moves the line by more than `tol` px (Douglas-Peucker, iterative, so a long path cannot overflow the stack). Only what is drawn is simplified; the stored geometry is not touched.
 */
export function simplifyIdx(pts, tol = 0.5) {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  // points that are not finite cannot be measured: they are kept (and break nothing: the test below is false for them)
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const t2 = tol * tol, stack = [0, n - 1];
  while (stack.length) {
    const hi = stack.pop(), lo = stack.pop();
    if (hi - lo < 2) continue;
    const a = pts[lo], b = pts[hi], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let far = -1, farD = t2;
    for (let i = lo + 1; i < hi; i++) {
      const p = pts[i];
      let d;
      if (l2 === 0) d = (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
      else { const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); d = (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2; }
      if (d > farD || !Number.isFinite(d)) { farD = Number.isFinite(d) ? d : Infinity; far = i; if (!Number.isFinite(d)) break; }
    }
    if (far >= 0) { keep[far] = 1; stack.push(lo, far, far, hi); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Cumulative path length at each point, and the total. */
export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { cum, total: cum[cum.length - 1] ?? 0 };
}

/** The point at path length s, and the local direction (degrees, 0 = to the right on the screen, y down). */
export function pointAt(pts, cum, s) {
  if (pts.length < 2) return pts[0] ? { x: pts[0].x, y: pts[0].y, angle: 0 } : null;
  const t = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < t) lo = mid + 1; else hi = mid; }
  const a = pts[lo - 1], b = pts[lo], span = cum[lo] - cum[lo - 1] || 1, f = (t - cum[lo - 1]) / span;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: deg(Math.atan2(b.y - a.y, b.x - a.x)) };
}

/** The direction of the path around length s, taken over a short window so a one-pixel zig-zag does not turn the chevron. */
export function tangentAt(pts, cum, s, win = 8) {
  const a = pointAt(pts, cum, s - win), b = pointAt(pts, cum, s + win);
  return deg(Math.atan2(b.y - a.y, b.x - a.x));
}
const turn = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Where chevrons go: every `spacing` px of path, starting half a spacing in, rotated to the local tangent. Chevrons that fall outside `inView(p)`,
 * on a bend sharper than `bendLimit` degrees over about 28 px, or too near either end (where the pins are) are left out. A path shorter than `minLen` has none.
 * Positions are measured from the start of the whole path, so panning does not shift them.
 */
export function chevronMarks(pts, { spacing = CHEVRON_SPACING, first: start = null, minLen = 44, endGap = 20, bendLimit = 70, inView = () => true, maxCount = 400 } = {}) {
  const { cum, total } = cumulative(pts);
  if (pts.length < 2 || total < minLen) return [];
  const out = [];
  const first = total < spacing ? total / 2 : start ?? spacing / 2;
  for (let s = first; s < total - endGap + 0.001 && out.length < maxCount; s += spacing) {
    if (s < endGap) continue;
    const p = pointAt(pts, cum, s);
    if (!inView(p)) continue;
    if (turn(tangentAt(pts, cum, s - 14, 6), tangentAt(pts, cum, s + 14, 6)) > bendLimit) continue;
    out.push({ x: p.x, y: p.y, angle: tangentAt(pts, cum, s) });
  }
  return out;
}

/**
 * How a band is stroked and where its chevrons go. A solid road band takes chevrons every 80 px. A dashed band (a straight-line fallback, or the leg between two
 * days) puts one chevron on every few dashes, centred on a dash, so a chevron never floats in a gap: the spacing is a whole number of dash periods.
 */
export function bandStyle({ road, overnight }) {
  if (overnight) return { dash: '16 9', spacing: 75, first: 33, cap: 'butt' };   // 25 px period: every 3rd dash, centred (8 + 25)
  if (!road) return { dash: '12 7', spacing: 76, first: 25, cap: 'butt' };      // 19 px period: every 4th dash, centred (6 + 19)
  return { dash: undefined, spacing: CHEVRON_SPACING, first: null, cap: 'round' };
}

/** The three points of one chevron (a V pointing along `angle`), `half` px long and `arm` px to each side. */
export function chevronShape(m, half = 3.6, arm = 3.8) {
  const a = (m.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const at = (dx, dy) => ({ x: m.x + dx * c - dy * s, y: m.y + dx * s + dy * c });
  return [at(-half, -arm), at(half, 0), at(-half, arm)];
}
/** A chevron that fits inside a band of this width: the arm is kept inside the band edges. */
export const armFor = (bandWidth) => Math.max(2, Math.min(4.2, bandWidth / 2 - 1.4));

/** The span of path length that is on screen ([from, to]) or null. */
export function visibleSpan(pts, cum, inView) {
  let from = null, to = null;
  const step = Math.max(1, Math.floor(cum[cum.length - 1] / 600));
  for (let s = 0; s <= cum[cum.length - 1]; s += step) { if (inView(pointAt(pts, cum, s))) { if (from === null) from = s; to = s; } }
  return from === null ? null : [from, to];
}

// ---------- labels
export function fmtDuration(s) {
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 45) return '<1 min';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * The words on a leg: { full, compact, aria }. A road shows driving distance and time; a straight-line fallback is marked with ≈ and the words "straight line"
 * (in the full label and always in the accessible text), so a displacement is never read as a driving distance.
 */
export function labelText(result, fmtDist) {
  const d = fmtDist(result.distanceM);
  if (result.state === 'road') {
    const t = fmtDuration(result.durationS);
    return { full: t ? `${d} · ${t}` : d, compact: d, aria: `Driving route, ${d}${t ? `, about ${t}` : ''}` };
  }
  return { full: `≈ ${d} · straight line`, compact: `≈ ${d}`, aria: `Straight-line distance, ${d}. Driving route unavailable` };
}
/** Estimated label size in px (the same for both themes; the real element is a pill with 7 px side padding and a 2 px border). */
export const labelSize = (text) => ({ w: Math.round(text.length * 6.6 + 22), h: 24 });

const hit = (a, b, pad = 2) => Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;
const FRACTIONS = [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85, 0.07, 0.93];

/**
 * Chooses one label place per leg, deterministically: legs are taken in the order given (callers sort: selected first, then by key); each tries its text in
 * three steps (full, compact) at fixed fractions of the visible part of its path, and takes the first place that overlaps neither an earlier label nor a pin.
 * Degradation, in order: the full text at the first clear place; the compact text at the first clear place; the compact text at the first place that merely
 * clears the other labels (it may sit on a pin); if even that is impossible the label is left out and `omitted` is true (the leg is still drawn and still has its
 * accessible text). A leg whose visible path is shorter than `minPath` is too short to carry a label at all.
 * items: [{ key, pts, cum, texts: { full, compact }, span: [from, to] | null, bold }]; `screen(p)` maps a layer point to a screen-aligned point (it undoes the map's
 * rotation, so rectangles are tested the way the viewer sees them); `obstacles`: pins as screen-aligned { x, y, w, h } boxes.
 * Returns Map key -> { x, y (layer point), text, mode: 'full' | 'compact' | 'forced', omitted }.
 */
export function layoutLabels(items, { screen = (p) => p, obstacles = [], minPath = 40 } = {}) {
  const taken = [], out = new Map(), seen = new Set();
  for (const it of items) {
    if (!it.span || it.span[1] - it.span[0] < minPath) { out.set(it.key, { omitted: true, reason: 'short' }); continue; }
    const dup = `${it.dupKey ?? ''}`; // identical legs (same road, same direction, same text) share one label
    if (it.dupKey && seen.has(dup)) { out.set(it.key, { omitted: true, reason: 'duplicate' }); continue; }
    const [s0, s1] = it.span;
    const cands = FRACTIONS.map((f) => pointAt(it.pts, it.cum, s0 + (s1 - s0) * f));
    const attempt = (text, checkPins) => {
      const sz = labelSize(text);
      for (const c of cands) {
        const sp = screen(c), box = { x: sp.x, y: sp.y, w: sz.w, h: sz.h };
        if (taken.some((t) => hit(box, t))) continue;
        if (checkPins && obstacles.some((o) => hit(box, o, 0))) continue;
        return { box, c };
      }
      return null;
    };
    let got = attempt(it.texts.full, true), mode = 'full', text = it.texts.full;
    if (!got) { got = attempt(it.texts.compact, true); mode = 'compact'; text = it.texts.compact; }
    if (!got) { got = attempt(it.texts.compact, false); mode = 'forced'; text = it.texts.compact; }
    if (!got) { out.set(it.key, { omitted: true, reason: 'crowded' }); continue; }
    taken.push(got.box);
    if (it.dupKey) seen.add(dup);
    out.set(it.key, { x: got.c.x, y: got.c.y, text, mode, omitted: false });
  }
  return out;
}
