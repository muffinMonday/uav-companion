// Coordinate conversion to WGS84. Add an entry to CONVERT for each source CRS that is not already WGS84.
// null = already WGS84, no conversion.

// GCJ-02 -> WGS84 (iterative inverse of the published GCJ-02 offset).
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
function wgs2gcj(lon, lat) {
  const dLat0 = tLat(lon - 105, lat - 35), dLon0 = tLon(lon - 105, lat - 35);
  const rad = lat / 180 * Math.PI, m = 1 - EE * Math.sin(rad) ** 2, sq = Math.sqrt(m);
  return [lon + dLon0 * 180 / (A / sq * Math.cos(rad) * Math.PI),
          lat + dLat0 * 180 / (A * (1 - EE) / (m * sq) * Math.PI)];
}
function gcj2wgs(lon, lat) {
  let x = lon, y = lat;
  for (let i = 0; i < 5; i++) { const [gx, gy] = wgs2gcj(x, y); x += lon - gx; y += lat - gy; }
  return [x, y];
}

export const CONVERT = { wgs84: null, gcj02: gcj2wgs };
