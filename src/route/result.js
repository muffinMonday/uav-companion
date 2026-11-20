// The route result model. A leg is drawn from exactly one of two states, and a fallback distance is never presented as a driving distance:
//   road      { state:'road', key, coords:[[lat,lon]...], distanceM, durationS, source:'cache'|'provider' }
//   fallback  { state:'fallback', key, coords:[a,b], distanceM (straight line), durationS:null, reason }
// Eligibility and the check of a provider answer are shared with the edge function (supabase/functions/_shared/route-rules.js).
import { haversineM } from '../distance.js';
import { routeKey } from './identity.js';
export { MAX_ROUTE_M, MIN_LEG_M, ineligibleReason, readOrsGeoJson } from '../../supabase/functions/_shared/route-rules.js';

export function fallbackFor(leg, reason = 'unavailable') {
  const { from, to } = leg;
  return { state: 'fallback', key: routeKey(leg), coords: [[from.lat, from.lon], [to.lat, to.lon]], distanceM: haversineM(from.lat, from.lon, to.lat, to.lon), durationS: null, reason };
}

export const roadFrom = (leg, r, source) => ({ state: 'road', key: routeKey(leg), coords: r.coords, distanceM: r.distanceM, durationS: r.durationS, source });
