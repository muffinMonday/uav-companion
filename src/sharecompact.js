// A compact form of a share link's contents (the #import=z2.… format). The same places, trips, dates and coordinates as the longer GeoJSON
// form, written as short rows: coordinates are whole numbers of millionths of a degree (exactly what the app stores), each as a step from
// the row before, dates are day counts, and the type is its position in the list of types. Pure: no DOM, so Node tests can use it.
// Private things never go in a link, so a trip's notes, checklist and colour are not part of this form (the receiver picks its own colour).
// A link stores a type as its position in this list, so the list is frozen: new types are only ever appended, and a link made today
// opens correctly in every build that knows the ids before it. (Not derived from TYPES, so reordering TYPES cannot break old links.)
export const SHARE_TYPE_ORDER = ['home', 'hotel', 'takeoff', 'landing', 'photo', 'train', 'airport', 'hazard', 'residence', 'other', 'food', 'attraction', 'shopping', 'nature', 'transport', 'meeting'];
const TYPE_IDS = SHARE_TYPE_ORDER;
const OTHER = TYPE_IDS.indexOf('other');
const BASE = Date.UTC(2000, 0, 1);
const toDays = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - BASE) / 86400000) + 1; // +1 so that 0 can mean "no date"
const fromDays = (n) => new Date(BASE + (n - 1) * 86400000).toISOString().slice(0, 10);
const trim = (row, keep) => { while (row.length > keep && (row[row.length - 1] === 0 || row[row.length - 1] === '')) row.pop(); return row; };

/** The compact form of an app export (a GeoJSON FeatureCollection with uavzones: 1 and optional trips). */
export function compactShare(gj) {
  const trips = Array.isArray(gj.trips) ? gj.trips : [];
  const tripAt = new Map(trips.map((t, i) => [t.id, i + 1]));
  const rowOf = new Map(gj.features.map((f, i) => [f.properties?.id, i + 1])); // a Side Quest names its parent by that row's number
  let la0 = 0, lo0 = 0;
  const m = gj.features.map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    const date = p.date ? toDays(p.date) : 0;
    const row = [TYPE_IDS.includes(p.type) ? TYPE_IDS.indexOf(p.type) : OTHER, p.name ?? '', la - la0, lo - lo0, date, date && p.endDate ? toDays(p.endDate) - date : 0, p.order ?? 0, p.unverified ? 1 : 0, tripAt.get(p.tripId) ?? 0, p.note ?? '', p.day ?? 0, p.isSub ? 1 : 0, (p.isSub && p.parentId !== undefined && rowOf.get(p.parentId)) || 0];
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
  const parents = new Set(obj.m.filter((r) => r[11] && r[12]).map((r) => r[12])); // rows that a Side Quest hangs from get an id to be found by
  let la = 0, lo = 0;
  const features = obj.m.map((r, i) => {
    la += r[2] ?? 0; lo += r[3] ?? 0;
    const p = { type: TYPE_IDS[r[0]] ?? 'other', name: r[1] ?? '', note: r[9] ?? '' };
    if (r[4]) { p.date = fromDays(r[4]); if (r[5]) p.endDate = fromDays(r[4] + r[5]); }
    if (r[6]) p.order = r[6];
    if (r[7]) p.unverified = true;
    if (r[8]) p.tripId = `t${r[8]}`;
    if (r[10]) p.day = r[10];
    if (parents.has(i + 1)) p.id = 'm' + (i + 1);
    if (r[11]) { p.isSub = true; if (r[12]) p.parentId = 'm' + r[12]; }
    return { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [lo / 1e6, la / 1e6] } };
  });
  return { type: 'FeatureCollection', uavzones: 1, ...(trips.length && { trips }), features };
}
