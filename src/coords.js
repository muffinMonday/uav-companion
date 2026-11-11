// Coordinates: WGS-84 (GPS, what this app uses) and GCJ-02 (the offset system Amap and other maps of China use), and whether a place is in China.
// Pure: no DOM, importable from Node tests. The conversion is the published GCJ-02 offset and its iterative inverse; it is good to a few metres.
import outline from './data/china-outline.js';

const A = 6378245.0, EE = 0.00669342162296594323;
const tLat = (x, y) => {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  return r + (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
};
const tLon = (x, y) => {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  return r + (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
};
const inBox = (lat, lon) => lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
/**
 * The offset applies in China only; elsewhere GCJ-02 and WGS-84 are the same. The usual box test also covers Singapore, Thailand and
 * more, which Amap does not shift, so the outline decides, with a margin of about 5 km because the outline is coarse.
 */
const shifted = (lat, lon) => inBox(lat, lon) && (inChina(lat, lon) || [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]].some(([a, b]) => inChina(lat + a, lon + b)));

/** WGS-84 -> GCJ-02, as { lat, lon }. */
export function wgs84ToGcj02({ lat, lon }) {
  if (!shifted(lat, lon)) return { lat, lon };
  const rad = lat / 180 * Math.PI, m = 1 - EE * Math.sin(rad) ** 2, sq = Math.sqrt(m);
  const dLat = tLat(lon - 105, lat - 35), dLon = tLon(lon - 105, lat - 35);
  return {
    lat: lat + dLat * 180 / (A * (1 - EE) / (m * sq) * Math.PI),
    lon: lon + dLon * 180 / (A / sq * Math.cos(rad) * Math.PI),
  };
}
/** GCJ-02 -> WGS-84 (iterative inverse), as { lat, lon }. */
export function gcj02ToWgs84({ lat, lon }) {
  if (!shifted(lat, lon)) return { lat, lon };
  let x = lon, y = lat;
  for (let i = 0; i < 8; i++) { const g = wgs84ToGcj02({ lat: y, lon: x }); x += lon - g.lon; y += lat - g.lat; }
  return { lat: y, lon: x };
}

/** Is the point inside the outline of China (mainland, Hong Kong, Macao; not Taiwan)? The outline is coarse (about 3 km). */
export function inChina(lat, lon) {
  if (!inBox(lat, lon)) return false;
  for (const ring of outline.rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
