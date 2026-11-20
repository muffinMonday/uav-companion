// The route rules shared by the app and the route-leg edge function: route identity, the same-country gate, eligibility and the check of a provider answer.
// One file, no imports, so the browser and Deno both load it unchanged (src/route/*.js re-export from here). Coordinates in a leg are { id, lat, lon }.
// Route identity: what makes a cached route still valid. A route is tied to the two markers, their coordinates (to 5 decimals, about 1 m),
// the profile and the schema version. Move an endpoint, change the profile or bump the version and the key changes, so a stale route can never be
// served; a leg whose endpoints did not change keeps its key (and its cache entry).
export const PROFILE = 'driving-car';
export const ROUTE_SCHEMA = 1; // bump when the stored shape or the provider's meaning changes: every cached route is then ignored
const c5 = (v) => (Math.round(Number(v) * 1e5) / 1e5).toFixed(5);

/** The stable key of a directed leg ({ from: {id,lat,lon}, to: {id,lat,lon} }). */
export function routeKey(leg, profile = PROFILE, schema = ROUTE_SCHEMA) {
  const { from, to } = leg;
  return `${profile}|v${schema}|${from.id}:${c5(from.lat)},${c5(from.lon)}>${to.id}:${c5(to.lat)},${c5(to.lon)}`;
}
export const validCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
/** Does a stored route belong to the leg as it is now? (The key carries the coordinates, so a moved endpoint never matches.) */
export const matchesLeg = (route, leg) => !!route && route.key === routeKey(leg);


const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
/** Great-circle distance in metres (the same formula as src/distance.js; this file stands alone so the edge function can bundle it). */
export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

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

// The route result model and its validation. A leg is drawn from exactly one of two states, and a fallback distance is never presented as a driving distance:
//   road      { state:'road', key, coords:[[lat,lon]...], distanceM, durationS, source:'cache'|'provider' }
//   fallback  { state:'fallback', key, coords:[a,b], distanceM (straight line), durationS:null, reason }

export const MAX_ROUTE_M = 6_000_000; // HeiGIT driving profiles: 6,000 km per request (hosted-api-restrictions page, read 2026-11-21)
export const MIN_LEG_M = 30;           // closer than this a route adds nothing: the markers sit on the line

/** Why a leg gets no road request, or null when it is eligible. Never calls anything. */
export function ineligibleReason(leg) {
  const { from, to } = leg;
  if (!from || !to || !validCoord(from.lat, from.lon) || !validCoord(to.lat, to.lon)) return 'bad-coordinates';
  const m = haversineM(from.lat, from.lon, to.lat, to.lon);
  if (m < MIN_LEG_M) return 'too-short';
  if (m > MAX_ROUTE_M * 0.5) return 'too-far'; // a straight line above half the provider's limit is no sensible road leg
  if (!sameCountry(from, to)) return 'country';
  return null;
}

/**
 * Checks a HeiGIT/ORS GeoJSON directions answer for `leg` and returns { coords:[[lat,lon]...], distanceM, durationS }, or throws Error(code):
 * 'malformed' (not the shape we asked for), 'mismatch' (the route does not start and end at the leg's points), 'implausible' (distance or time nonsense).
 */
export function readOrsGeoJson(json, leg) {
  const f = json && json.type === 'FeatureCollection' && Array.isArray(json.features) ? json.features[0] : null;
  const g = f?.geometry, s = f?.properties?.summary;
  if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2 || g.coordinates.length > 100000) throw new Error('malformed');
  const coords = [];
  for (const c of g.coordinates) {
    if (!Array.isArray(c) || c.length < 2 || !validCoord(c[1], c[0])) throw new Error('malformed'); // ORS is [lon, lat]; the app keeps [lat, lon]
    coords.push([c[1], c[0]]);
  }
  const distanceM = Number(s?.distance), durationS = Number(s?.duration);
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) throw new Error('malformed');
  const line = haversineM(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon);
  const first = coords[0], last = coords[coords.length - 1];
  if (haversineM(leg.from.lat, leg.from.lon, first[0], first[1]) > 2000 || haversineM(leg.to.lat, leg.to.lon, last[0], last[1]) > 2000) throw new Error('mismatch'); // ORS snaps to the nearest road
  if (distanceM <= 0 || distanceM > MAX_ROUTE_M || durationS < 0 || durationS > 14 * 86400 || distanceM < line * 0.8 - 100) throw new Error('implausible');
  return { coords, distanceM, durationS };
}


