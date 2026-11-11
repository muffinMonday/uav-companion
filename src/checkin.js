// Check-in: record that you were at a marker. Pure rules here (no DOM, no storage), so Node tests can use them.
// A check-in is { at (ISO time), lat, lon (where you were), acc (GPS accuracy in metres, optional) } kept on the marker in this browser.
import { haversineM, fmtDistance } from './distance.js';

export const RADIUS_M = 300;        // how close you must be to a marker to check in
export const MAX_ACCURACY_M = 150;  // a fix rougher than this cannot be trusted to be within the radius

/**
 * Can this position check in at this marker? { can, reason, distanceM, accuracy }.
 * reason: 'waiting' (no position yet), 'rough' (fix too imprecise), 'far' (outside the radius), or undefined when can.
 */
export function checkinState(fix, item) {
  if (!fix) return { can: false, reason: 'waiting' };
  const distanceM = haversineM(fix.lat, fix.lon, item.lat, item.lon);
  if (!(fix.accuracy <= MAX_ACCURACY_M)) return { can: false, reason: 'rough', distanceM, accuracy: fix.accuracy };
  if (distanceM > RADIUS_M) return { can: false, reason: 'far', distanceM };
  return { can: true, distanceM };
}

/** The words for the button's tooltip. `status`: 'denied' | 'unavailable' | anything else. */
export function checkinTitle(st, units = 'metric', status = '') {
  if (status === 'denied') return 'Location is blocked for this page. Allow it in the browser settings to check in.';
  if (status === 'unavailable') return 'This browser cannot give a location, so check-in is not available.';
  if (st.reason === 'waiting') return 'Waiting for your location…';
  if (st.reason === 'rough') return `Your location is only accurate to about ${fmtDistance(st.accuracy, units)}. Check-in needs ${fmtDistance(MAX_ACCURACY_M, units)} or better.`;
  if (st.reason === 'far') return `You are ${fmtDistance(st.distanceM, units)} away. Check-in opens within ${fmtDistance(RADIUS_M, units)}.`;
  return 'Record that you are here: saves your position and the time.';
}

/** A stored check-in, validated, or null. */
export function sanitizeCheckin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = Date.parse(raw.at), lat = Number(raw.lat), lon = Number(raw.lon);
  if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const out = { at: new Date(t).toISOString(), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  const acc = Number(raw.acc);
  if (raw.acc !== undefined && Number.isFinite(acc) && acc >= 0 && acc <= 100000) out.acc = Math.round(acc);
  return out;
}

/** "Thu 12 Nov, 14:32" in the visitor's own time. */
export function checkinLabel(c) {
  const d = new Date(c.at);
  const day = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** How many of these markers have a check-in, out of those that can have one (the Home marker cannot). */
export function visitedCount(items) {
  const eligible = items.filter((i) => i.type !== 'residence');
  return { done: eligible.filter((i) => i.checkin).length, total: eligible.length };
}
