// Straight-line distance from a waypoint to the nearest home point and the nearest hotel. Pure functions, no map or storage.
//
// Straight-line (great-circle) because that is the figure a drone cares about: line of sight and control range from the
// home point. It needs no network and sends no coordinates anywhere. Road or walking distance is deliberately not offered.
const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial compass bearing from point 1 to point 2, degrees clockwise from north (0 to 360). */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

/**
 * What a waypoint is measured to, in display order. `short` is the wording in running text.
 * `launch` marks the places you could fly from (a home point, a hotel). The Home marker (the traveller's residence) is
 * measured to as well, but it is not a launch base, so it does not count toward the max range: on a trip it is usually
 * hundreds of kilometres from anywhere you would take off.
 */
export const BASE_TYPES = [
  { id: 'home', label: 'Home point', short: 'home point', launch: true },
  { id: 'hotel', label: 'Accommodation', short: 'accommodation', launch: true },
  { id: 'residence', label: 'Home', short: 'home', launch: false },
];
const BASES = new Set(['home', 'hotel', 'residence']); // the markers waypoints are measured to

/** A waypoint is any marker that is not itself a Home point, Hotel or Home marker (takeoff, landing, photo, hazard, other). */
export const isWaypoint = (item) => !BASES.has(item.type);

/**
 * Every marker except the Home marker itself shows its distance to the nearest Home marker. Waypoints also show their
 * nearest Home point and Hotel, so a Hotel or a Home point shows just the Home line.
 */
export const needsDistance = (item) => item.type !== 'residence';

/** Whether this line applies to this marker: the launch bases only to waypoints, the Home line to every marker. */
export const lineApplies = (item, base) => (base.launch ? isWaypoint(item) : true);

/** Trips scope the launch bases: a waypoint is only measured to a Home point or Hotel in its own trip (no trip counts as a trip of its own). */
export const inSameTrip = (a, b) => (a.tripId ?? null) === (b.tripId ?? null);

const span = (i) => (i.date ? [i.date, i.endDate ?? i.date] : null);

/**
 * Do the dates of two markers overlap? A marker with no date matches anything: an undated hotel is taken to apply to the
 * whole trip, and an undated waypoint cannot rule any base out.
 */
export function datesMatch(a, b) {
  const sa = span(a), sb = span(b);
  if (!sa || !sb) return true;
  return sa[0] <= sb[1] && sb[0] <= sa[1];
}

/**
 * For one marker: the nearest home point, hotel and Home marker (residence) that apply to it.
 *   - Home point and Hotel: only for waypoints, only in the waypoint's own trip, and only if their dates overlap.
 *   - Home: for every marker; a Home belongs to no trip and is not tied to dates, so neither is checked.
 * Returns { home, hotel, residence, nearestM }, each of the first three being
 *   { applies, exists, inTrip, found: { item, m, bearing, approx } | null }
 * `applies`: whether this line is shown for this marker at all. `exists`: any marker of that type is saved. `inTrip`: one
 * exists in this marker's trip (always true for Home), so "none saved", "none in this trip" and "none for these dates" can
 * be told apart. `approx`: either end is an unverified location. nearestM is the shortest distance found to a launch base
 * (home point or hotel; Home is left out), which is what the max range is judged against.
 */
export function nearestBases(item, items) {
  const out = {};
  let nearestM = null;
  for (const base of BASE_TYPES) {
    const { id, launch } = base;
    if (!lineApplies(item, base)) { out[id] = { applies: false, exists: false, inTrip: false, found: null }; continue; }
    const all = items.filter((i) => i.type === id && i.id !== item.id);
    const scoped = launch ? all.filter((b) => inSameTrip(item, b)) : all;
    const candidates = launch ? scoped.filter((b) => datesMatch(item, b)) : scoped;
    let best = null;
    for (const b of candidates) {
      const m = haversineM(item.lat, item.lon, b.lat, b.lon);
      if (!best || m < best.m) best = { item: b, m, bearing: bearingDeg(item.lat, item.lon, b.lat, b.lon), approx: !!(item.unverified || b.unverified) };
    }
    out[id] = { applies: true, exists: all.length > 0, inTrip: scoped.length > 0, found: best };
    if (launch && best && (nearestM === null || best.m < nearestM)) nearestM = best.m;
  }
  out.nearestM = nearestM;
  return out;
}

/** True when the waypoint is beyond maxM from every home point and hotel that applies to it (the Home marker does not count). False if there is none to measure from. */
export function beyondRange(bases, maxM) {
  return maxM !== null && maxM !== undefined && bases.nearestM !== null && bases.nearestM > maxM;
}

/** "850 m", "1.2 km", "14 km"; or "450 ft", "0.8 mi". Very short distances read "<10 m" / "<30 ft". */
export function fmtDistance(m, units = 'metric') {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 30) return '<30 ft';
    if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`;
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 10) return '<10 m';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** The max-range number as the person types it: kilometres or miles, from the stored metres (and back). */
export const toDisplay = (m, units) => (units === 'imperial' ? m / 1609.344 : m / 1000);
export const fromDisplay = (v, units) => (units === 'imperial' ? v * 1609.344 : v * 1000);
