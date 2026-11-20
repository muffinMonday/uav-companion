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
