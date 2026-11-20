// The route result model and its validation. A leg is drawn from exactly one of two states, and a fallback distance is never presented as a driving distance:
//   road      { state:'road', key, coords:[[lat,lon]...], distanceM, durationS, source:'cache'|'provider' }
//   fallback  { state:'fallback', key, coords:[a,b], distanceM (straight line), durationS:null, reason }
import { haversineM } from '../distance.js';
import { routeKey, validCoord } from './identity.js';
import { sameCountry } from './country.js';

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

export function fallbackFor(leg, reason = 'unavailable') {
  const { from, to } = leg;
  return { state: 'fallback', key: routeKey(leg), coords: [[from.lat, from.lon], [to.lat, to.lon]], distanceM: haversineM(from.lat, from.lon, to.lat, to.lon), durationS: null, reason };
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

export const roadFrom = (leg, r, source) => ({ state: 'road', key: routeKey(leg), coords: r.coords, distanceM: r.distanceM, durationS: r.durationS, source });
