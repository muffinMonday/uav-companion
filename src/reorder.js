// Moving a marker to a new place in the list: which date and stop it, and its neighbours, get. Pure: no DOM.
//
// The list is a group of markers (one trip, or the ones with no trip) shown under date headings. Dropping a marker into another
// heading changes its date (its day follows from the trip's start date); dropping it between two markers changes its stop, and the stops of its new group are renumbered 1, 2, 3. A hotel moved to another date gets that date as its
// start and the next day of the trip as its end (the trip's last day: start and end are both that day).
import { sortForList } from './poi.js';
import { addDays, daysBetween } from './dates.js';

export { addDays };
/** The end date for a stay starting on `date`: the next day of the trip, or `date` itself on the trip's last day. */
export function nextTripDate(date, trip) {
  return trip?.endDate && date >= trip.endDate ? date : addDays(date, 1);
}

/** The key of the heading a marker sits under: its date, its day, or 'none'. */
export const groupKey = (item, mode) => (mode === 'date' ? item.date ?? 'none' : mode === 'day' ? item.day ?? 'none' : 'none');

/** The most frequent defined value of `key` among items, or undefined. Ties go to the first. */
function common(list, key) {
  const count = new Map();
  for (const x of list) if (x[key] !== undefined) count.set(x[key], (count.get(x[key]) ?? 0) + 1);
  let best, n = 0;
  for (const [v, c] of count) if (c > n) { best = v; n = c; }
  return best;
}

/** The headings of a list in display order: [{ key, items }] (items in display order). */
export function groupsOf(members, mode) {
  const out = [];
  for (const it of sortForList(members, mode)) {
    const k = groupKey(it, mode);
    const last = out[out.length - 1];
    if (last && last.key === k) last.items.push(it); else out.push({ key: k, items: [it] });
  }
  return out;
}

const FIELDS = ['date', 'endDate', 'day', 'order'];

/**
 * Plans a move. `members` are the markers of the list group (not the Home marker), `mode` 'date' or 'day', `movedId` the marker,
 * `targetKey` the heading it is dropped under (a date, a day number or 'none') and `index` its position there among the others.
 * Returns { items: [the changed markers, complete], summary } or null when nothing changes or the move is not possible.
 */
export function planMove({ members, mode, movedId, targetKey, index, trip = null }) {
  if (mode !== 'date') return null; // lists with days only (old markers) are not reordered: a day can no longer be typed in
  const moved = members.find((x) => x.id === movedId);
  if (!moved) return null;
  const groups = new Map(groupsOf(members, mode).map((g) => [g.key, g.items.slice()]));
  const srcKey = groupKey(moved, mode);
  groups.set(srcKey, groups.get(srcKey).filter((x) => x.id !== movedId));
  const target = groups.get(targetKey) ?? [];
  const at = Math.max(0, Math.min(index, target.length));
  const next = new Map(); // id -> the new field values (undefined deletes)

  const set = (id, fields) => next.set(id, { ...(next.get(id) ?? {}), ...fields });
  const hotel = moved.type === 'hotel';

  if (targetKey === 'none') {
    // an undated group has no order of its own: the marker leaves the itinerary part of the list
    set(movedId, { date: undefined, endDate: undefined, day: undefined, order: undefined });
  } else if (targetKey !== srcKey) {
    // the day follows from the date (the trip's start date is day 1), so only the date and a stay's end are set
    const date = targetKey;
    let endDate;
    if (hotel) endDate = nextTripDate(date, trip);
    else if (moved.endDate && moved.date) endDate = addDays(date, daysBetween(moved.date, moved.endDate));
    set(movedId, { date, endDate, day: undefined });
  }

  if (targetKey !== 'none') {
    const ordered = target.slice(); ordered.splice(at, 0, moved);
    ordered.forEach((x, i) => set(x.id, { order: i + 1 }));
  }
  if (srcKey !== targetKey && srcKey !== 'none') {
    const rest = groups.get(srcKey);
    if (rest.some((x) => x.order !== undefined)) rest.forEach((x, i) => set(x.id, { order: i + 1 }));
  }

  const items = [];
  for (const [id, fields] of next) {
    const old = members.find((x) => x.id === id);
    const changed = FIELDS.some((f) => (f in fields) && fields[f] !== old[f]);
    if (!changed) continue;
    const merged = { ...old, ...fields };
    for (const f of FIELDS) if (merged[f] === undefined) delete merged[f];
    items.push(merged);
  }
  if (!items.length) return null;
  const after = items.find((x) => x.id === movedId) ?? moved;
  return { items, moved: after, summary: summarise(after, targetKey, mode) };
}

function summarise(item, targetKey, mode) {
  if (targetKey === 'none') return `Moved “${item.name}” out of the itinerary`;
  const where = [item.date, item.order !== undefined && `stop ${item.order}`].filter(Boolean).join(', ');
  return `Moved “${item.name}” to ${where || targetKey}`;
}

/** The slot after moving one step: { key, index } for "up" (-1) or "down" (+1) from marker `id`, or null at the very top or bottom. */
export function stepSlot(members, mode, id, dir) {
  const groups = groupsOf(members, mode);
  const gi = groups.findIndex((g) => g.items.some((x) => x.id === id));
  if (gi < 0) return null;
  const g = groups[gi], i = g.items.findIndex((x) => x.id === id);
  if (dir < 0) {
    if (i > 0) return { key: g.key, index: i - 1 };
    const prev = groups[gi - 1];
    return prev && prev.key !== 'none' ? { key: prev.key, index: prev.items.length } : null;
  }
  if (i < g.items.length - 1) return { key: g.key, index: i + 1 };
  const nxt = groups[gi + 1];
  return nxt && nxt.key !== 'none' ? { key: nxt.key, index: 0 } : null;
}
