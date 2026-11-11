// A compact form of a share link's contents (the #import=z2.… format). The same places, trips, dates and coordinates as the longer GeoJSON
// form, written as short rows: coordinates are whole numbers of millionths of a degree (exactly what the app stores), each as a step from
// the row before, dates are day counts, and the type is its position in the list of types. Pure: no DOM, so Node tests can use it.
// Private things never go in a link, so a trip's notes, checklist and colour are not part of this form (the receiver picks its own colour).
import { TYPES } from './poi.js';

const TYPE_IDS = TYPES.map((t) => t.id);
const BASE = Date.UTC(2000, 0, 1);
const toDays = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - BASE) / 86400000) + 1; // +1 so that 0 can mean "no date"
const fromDays = (n) => new Date(BASE + (n - 1) * 86400000).toISOString().slice(0, 10);
const trim = (row, keep) => { while (row.length > keep && (row[row.length - 1] === 0 || row[row.length - 1] === '')) row.pop(); return row; };

/** The compact form of an app export (a GeoJSON FeatureCollection with uavzones: 1 and optional trips). */
export function compactShare(gj) {
  const trips = Array.isArray(gj.trips) ? gj.trips : [];
  const tripAt = new Map(trips.map((t, i) => [t.id, i + 1]));
  let la0 = 0, lo0 = 0;
  const m = gj.features.map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    const date = p.date ? toDays(p.date) : 0;
    const row = [Math.max(0, TYPE_IDS.indexOf(p.type)), p.name ?? '', la - la0, lo - lo0, date, date && p.endDate ? toDays(p.endDate) - date : 0, p.order ?? 0, p.unverified ? 1 : 0, tripAt.get(p.tripId) ?? 0, p.note ?? '', p.day ?? 0];
    la0 = la; lo0 = lo;
    return trim(row, 4);
  });
  const t = trips.map((x) => trim([x.name ?? '', x.country ?? '', x.startDate ? toDays(x.startDate) : 0, x.endDate ? toDays(x.endDate) : 0, x.description ?? ''], 1));
  return { v: 2, ...(t.length && { t }), m };
}

/** The longer form back again: what parseItinerary reads. Throws if this is not the compact form. */
export function expandShare(obj) {
  if (!obj || obj.v !== 2 || !Array.isArray(obj.m)) throw new Error('not the compact form');
  const trips = (obj.t ?? []).map((t, i) => ({
    id: `t${i + 1}`, name: t[0] ?? '', ...(t[1] && { country: t[1] }), ...(t[2] && { startDate: fromDays(t[2]) }), ...(t[3] && { endDate: fromDays(t[3]) }), description: t[4] ?? '',
  }));
  let la = 0, lo = 0;
  const features = obj.m.map((r) => {
    la += r[2] ?? 0; lo += r[3] ?? 0;
    const p = { type: TYPE_IDS[r[0]] ?? 'other', name: r[1] ?? '', note: r[9] ?? '' };
    if (r[4]) { p.date = fromDays(r[4]); if (r[5]) p.endDate = fromDays(r[4] + r[5]); }
    if (r[6]) p.order = r[6];
    if (r[7]) p.unverified = true;
    if (r[8]) p.tripId = `t${r[8]}`;
    if (r[10]) p.day = r[10];
    return { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [lo / 1e6, la / 1e6] } };
  });
  return { type: 'FeatureCollection', uavzones: 1, ...(trips.length && { trips }), features };
}
