// Reader for OneMap "theme" responses (the JSON the OneMap web app and its themes API return for a layer).
//
// A response is { SrchResults: [ meta, feature, feature, ... ] }:
//   meta     { FeatCount, Theme_Name, Owner, DateTime, Published_Date, Formatted_DateTime, ... }
//   feature  { NAME, DESCRIPTION, Type: "Polygon" | "Point", LatLng: "lat,lng|lat,lng|..." }
// A polygon's LatLng can hold several parts separated by ";" : separate pieces and holes, told apart by containment.
// Coordinates are WGS84. Pure functions: no file access here.

const toPoint = (s) => { const [lat, lon] = s.split(',').map(Number); return [lon, lat]; }; // GeoJSON order

function ringOf(text) {
  const pts = text.split('|').map((s) => s.trim()).filter(Boolean).map(toPoint).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length >= 3 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push([...pts[0]]);
  return pts;
}
const area = (ring) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
function contains(ring, [px, py]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The parts of one feature as GeoJSON polygon coordinates: a part inside an odd number of other parts is a hole of the smallest part
 * around it, any other part is a polygon of its own. Returns an array of polygons ([outer, ...holes]); empty if nothing usable.
 */
export function partsToPolygons(latLng) {
  const rings = latLng.split(';').map(ringOf).filter((r) => r.length >= 4);
  const info = rings.map((ring, i) => ({ ring, i, a: area(ring) }));
  for (const r of info) r.depth = info.filter((o) => o !== r && o.a > r.a && contains(o.ring, r.ring[0])).length;
  const outers = info.filter((r) => r.depth % 2 === 0).map((r) => ({ ...r, holes: [] }));
  for (const h of info.filter((r) => r.depth % 2 === 1)) {
    const around = outers.filter((o) => o.a > h.a && contains(o.ring, h.ring[0])).sort((a, b) => a.a - b.a)[0];
    if (around) around.holes.push(h.ring);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

/** Parses a theme response. Returns { meta: { name, owner, updated, published }, features: [{ name, description, polygons?, point? }] }. */
export function parseTheme(json) {
  const list = json?.SrchResults;
  if (!Array.isArray(list) || list.length < 1) throw new Error('not a OneMap theme response (no SrchResults)');
  const [m, ...rest] = list;
  const meta = { name: m.Theme_Name ?? '', owner: m.Owner ?? '', updated: (m.DateTime ?? '').slice(0, 10), published: (m.Published_Date ?? '').slice(0, 10) };
  const features = [];
  for (const f of rest) {
    if (!f || typeof f.LatLng !== 'string') continue;
    const base = { name: String(f.NAME ?? '').trim(), description: String(f.DESCRIPTION ?? '').trim() };
    if (f.Type === 'Point') { const [lon, lat] = toPoint(f.LatLng); if (Number.isFinite(lon) && Number.isFinite(lat)) features.push({ ...base, point: [lon, lat], link: f.HYPERLINK ?? '' }); continue; }
    const polygons = partsToPolygons(f.LatLng);
    if (polygons.length) features.push({ ...base, polygons });
  }
  return { meta, features };
}
