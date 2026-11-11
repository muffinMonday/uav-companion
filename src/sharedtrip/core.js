// The rules of shared trips, with no network, storage or DOM, so they can be tested exhaustively. See sharedtrip/engine.js for the part that acts on them.
//
// A shared trip is one document { v: 1, trip, items }: the trip and the markers tagged with it. Several people edit their own copies; when their
// changes meet, mergeDocs() combines them. It is a three-way merge: `base` is the version this device last synced, `mine` is the device's copy now,
// `theirs` is what the server holds now.
//
//   - A trip or a marker is merged field by field. A field changed on one side only takes that side's value.
//   - A field changed on both sides takes the value of the record that was changed more recently (its `updated` time); equal times fall back to a
//     fixed order, so the result does not depend on which side runs the merge.
//   - A marker added on either side is kept. A marker deleted on one side and unchanged on the other is deleted; if the other side changed it, it is
//     kept (an edit wins over a delete, so nobody loses work they have just done).
//
// Home markers and check-ins are personal and never part of a shared document.

export const DOC_VERSION = 1;
const TRIP_FIELDS = ['id', 'name', 'description', 'notes', 'checklist', 'country', 'startDate', 'endDate', 'color', 'created', 'updated'];

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
const key = (v) => JSON.stringify(canon(v)); // undefined for undefined
const eq = (a, b) => key(a) === key(b);

/** The shared part of a trip: no local-only fields (the link to the shared trip, anything else added later). */
export function tripToDoc(trip) {
  const out = {};
  for (const k of TRIP_FIELDS) if (trip[k] !== undefined) out[k] = trip[k];
  return out;
}

/** The document for a trip and its markers: markers tagged with the trip, without Home markers and check-ins. */
export function buildSharedDoc(trip, items) {
  return {
    v: DOC_VERSION,
    trip: tripToDoc(trip),
    items: items.filter((i) => i.tripId === trip.id && i.type !== 'residence').map((i) => { if (!i.checkin) return i; const { checkin, ...rest } = i; return rest; }), // eslint-disable-line no-unused-vars
  };
}

/** Do two documents hold the same trip and markers (marker order does not matter)? */
export function sameDoc(a, b) {
  const norm = (d) => key({ trip: d?.trip ?? null, items: [...(d?.items ?? [])].sort((x, y) => String(x.id).localeCompare(String(y.id))) });
  return norm(a) === norm(b);
}

const stamp = (r) => r?.updated ?? r?.created ?? '';
/** Which of two copies of a record is the later one: 1 for the first, -1 for the second, with a fixed tie-break so both sides agree. */
function later(a, b) {
  const x = stamp(a), y = stamp(b);
  if (x !== y) return x > y ? 1 : -1;
  const kx = key(a) ?? '', ky = key(b) ?? '';
  return kx >= ky ? 1 : -1;
}

/** Merges three versions of one record (trip or marker), field by field. `base` may be undefined (no common version). */
export function mergeRecord(base, mine, theirs) {
  const out = {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(mine), ...Object.keys(theirs)]);
  keys.delete('updated');
  const mineWins = later(mine, theirs) > 0;
  for (const k of keys) {
    const b = base?.[k], m = mine[k], t = theirs[k];
    let v;
    if (eq(m, t)) v = m;
    else if (base && eq(m, b)) v = t; // only they changed it
    else if (base && eq(t, b)) v = m; // only I changed it
    else v = mineWins ? m : t;        // both changed it: the more recent record wins
    if (v !== undefined) out[k] = v;
  }
  const u = [mine.updated, theirs.updated].filter(Boolean).sort().pop();
  if (u) out.updated = u;
  return out;
}

/** Merges the three documents. `base` may be null (a device that has no record of the last synced version). */
export function mergeDocs(base, mine, theirs) {
  const mapOf = (d) => new Map((d?.items ?? []).map((i) => [i.id, i]));
  const bm = mapOf(base), mm = mapOf(mine), tm = mapOf(theirs);
  const ids = new Set([...bm.keys(), ...mm.keys(), ...tm.keys()]);
  const items = [];
  for (const id of ids) {
    const b = bm.get(id), m = mm.get(id), t = tm.get(id);
    if (m && t) items.push(mergeRecord(b, m, t));
    else if (m) { if (!b || !eq(m, b)) items.push(m); }       // theirs has none: new here, or they deleted it (kept only if I changed it)
    else if (t) { if (!b || !eq(t, b)) items.push(t); }       // mine has none: new there, or I deleted it (kept only if they changed it)
  }
  items.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')) || String(a.id).localeCompare(String(b.id)));
  return { v: DOC_VERSION, trip: mergeRecord(base?.trip, mine.trip, theirs.trip), items };
}

/** What changed between two documents, in words for a notice: { added, removed, changed, trip }. */
export function describeChange(before, after) {
  const bm = new Map((before?.items ?? []).map((i) => [i.id, i])), am = new Map((after?.items ?? []).map((i) => [i.id, i]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, i] of am) { if (!bm.has(id)) added++; else if (!eq(i, bm.get(id))) changed++; }
  for (const id of bm.keys()) if (!am.has(id)) removed++;
  return { added, removed, changed, trip: !eq(before?.trip, after?.trip) };
}
