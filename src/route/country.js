// Is a point in a country we can route in? A conservative coarse outline per country: every polygon lies INSIDE the real border (inset by tens of km
// near borders, into the sea along coasts), so a point inside is certainly in that country; a point near a border or outside is "unknown" and the leg
// is drawn as a straight line without any request. Same-country is a product gate, not proof of a road connection.
// Coordinates are [lon, lat]. Only countries the app covers are listed: anything else is unknown.
const CN = [
  [122.0, 52.2], [124.5, 52.4], [126.5, 51.2], [127.5, 49.8], [130.0, 48.8], [133.2, 48.0], [134.0, 47.2], [132.8, 45.8], [131.5, 45.0], [130.6, 44.2], [130.2, 42.8], [128.5, 42.0],
  [126.5, 41.2], [124.6, 40.2], [122.8, 39.4], [122.0, 38.4], [122.9, 37.2], [122.0, 36.0], [121.0, 34.6], [122.0, 32.6], [122.6, 30.8], [122.8, 29.0], [121.6, 27.6], [120.8, 25.8],
  [119.6, 24.5], [117.8, 23.0], [115.5, 22.2], [113.6, 21.5], [111.2, 20.9], [110.6, 19.9], [109.6, 20.5], [108.5, 21.3], [108.3, 21.7], [108.2, 22.0], [107.4, 22.3], [106.9, 22.7],
  [106.3, 23.1], [105.4, 23.4], [104.6, 23.3], [104.0, 23.2], [102.5, 22.9], [101.9, 22.6], [101.4, 22.0], [100.8, 21.7], [100.2, 21.8], [99.7, 22.1], [99.2, 22.5], [99.0, 23.0],
  [98.6, 23.8], [98.2, 24.3], [98.2, 25.2], [98.5, 26.5], [98.3, 28.0], [97.4, 28.5], [96.0, 28.9], [94.5, 29.0], [93.0, 28.7], [91.8, 28.3], [90.5, 28.2], [89.5, 28.4], [88.0, 28.6],
  [86.5, 28.5], [85.5, 28.8], [84.0, 29.2], [82.2, 30.2], [81.2, 30.4], [80.5, 30.9], [79.8, 32.6], [80.2, 33.5], [78.8, 35.5], [77.2, 36.3], [75.6, 37.0], [74.9, 37.5], [74.7, 39.3],
  [75.6, 40.1], [77.4, 40.7], [79.4, 41.0], [80.0, 42.0], [80.8, 43.2], [81.3, 44.9], [83.5, 46.3], [85.5, 47.7], [86.2, 48.9], [88.3, 48.2], [90.0, 47.6], [90.6, 46.0], [92.0, 44.9],
  [94.0, 43.9], [96.5, 43.0], [98.0, 42.4], [100.5, 41.8], [102.0, 41.9], [106.0, 41.8], [107.5, 41.5], [111.0, 42.8], [113.5, 44.1], [115.5, 45.2], [117.0, 46.3], [119.0, 47.2],
  [119.5, 48.5], [119.5, 49.8], [120.5, 51.5],
];
const HAINAN = [[108.5, 18.0], [111.3, 18.0], [111.3, 20.4], [108.5, 20.4]];
const SG = [[103.55, 1.15], [104.15, 1.15], [104.15, 1.462], [103.55, 1.462]];
export const OUTLINES = { CN: [CN, HAINAN], SG: [SG] };

function inside(lon, lat, poly) {
  let isIn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) isIn = !isIn;
  }
  return isIn;
}

/** 'CN', 'SG' or null (not in a covered country, or too near a border to be sure). */
export function countryOf(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const [code, polys] of Object.entries(OUTLINES)) if (polys.some((p) => inside(lon, lat, p))) return code;
  return null;
}
export function sameCountry(a, b) {
  const x = countryOf(a.lat, a.lon);
  return x !== null && x === countryOf(b.lat, b.lon) ? x : null;
}
