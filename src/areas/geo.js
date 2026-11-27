// Community flying areas, Phase 2 UX: the pure geometry the map interaction needs (no DOM, no Leaflet), so Node tests can use it.
//   - areaCentre(): a geographic centre that is always inside the polygon (area centroid, else the middle of the widest interior span at the centroid's latitude).
//   - pickArea(): which area a tap belongs to; overlapping areas resolve deterministically (smallest first, then oldest, then id).
//   - the setup-spot scale rule: spots show when the 140 px scale bar would span 500 m or less. Metric/imperial display is not an input.
import { pointInPolygon, openRing } from './core.js';

export const SPOT_SCALE_M = 500;      // setup spots show at this scale-bar distance or closer (owner decision 2026-11-27)
export const SCALE_BAR_PX = 140;      // the Leaflet scale control's maxWidth in map.js

/** Metres on the ground across `px` CSS pixels, east-west at the map centre. Uses the map's own projection, so it follows zoom and latitude. */
export function metresAcross(map, px = SCALE_BAR_PX) {
  const c = map.getCenter(), p = map.project(c);
  return map.distance(c, map.unproject(p.add([px, 0])));
}
/** True when the ground distance of the scale-bar width is at most SPOT_SCALE_M. */
export const spotsShown = (map) => metresAcross(map) <= SPOT_SCALE_M;

/** Local planar coordinates (metres-like) around `lat0`, good for polygons far smaller than the Earth. */
const toXY = (lat0) => { const k = Math.cos((lat0 * Math.PI) / 180); return (p) => [p[0] * k, p[1]]; };

/** The area centroid of a ring ([lng, lat], open or closed), or null for a degenerate ring. */
function centroid(v) {
  const f = toXY(v.reduce((s, p) => s + p[1], 0) / v.length), q = v.map(f);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], n = q[(i + 1) % q.length], w = p[0] * n[1] - n[0] * p[1];
    a += w; cx += (p[0] + n[0]) * w; cy += (p[1] + n[1]) * w;
  }
  if (Math.abs(a) < 1e-18) return null;
  const k = f([1, 0])[0];
  return [cx / (3 * a) / k, cy / (3 * a)];
}

/** The middle of the widest stretch inside the ring along the horizontal line `lat`, or null. */
function widestSpan(v, lat) {
  const xs = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    if ((a[1] > lat) !== (b[1] > lat)) xs.push(a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  xs.sort((x, y) => x - y);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? [(best[0] + best[1]) / 2, lat] : null;
}

/**
 * A point inside the polygon that stands for its centre: the area centroid when that lies inside (convex and most irregular shapes), otherwise the middle of the
 * widest interior span at the centroid's latitude, then at other latitudes. A concave "C" or "L" shape never gets a centre in its notch. -> [lng, lat].
 */
export function areaCentre(ring) {
  const v = openRing(ring);
  if (v.length < 3) return v[0] ? [v[0][0], v[0][1]] : null;
  const c = centroid(v);
  if (c && pointInPolygon(c, v)) return c;
  const lats = v.map((p) => p[1]), lo = Math.min(...lats), hi = Math.max(...lats);
  const tries = [c?.[1], ...[0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9].map((t) => lo + (hi - lo) * t)].filter((y) => y != null);
  for (const y of tries) { const s = widestSpan(v, y); if (s && pointInPolygon(s, v)) return s; }
  return [v[0][0], v[0][1]];
}

/** The area a tap at [lng, lat] belongs to: the smallest containing area (the most specific), then the earliest created, then the lowest id. null when none. */
export function pickArea(areas, lng, lat) {
  const hits = areas.filter((a) => a?.geometry?.coordinates?.[0] && pointInPolygon([lng, lat], a.geometry.coordinates[0]));
  hits.sort((a, b) => (a.areaM2 ?? 0) - (b.areaM2 ?? 0) || String(a.created ?? '').localeCompare(String(b.created ?? '')) || String(a.id).localeCompare(String(b.id)));
  return hits[0] ?? null;
}
