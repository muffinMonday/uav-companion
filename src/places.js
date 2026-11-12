// The same place saved more than once (a second visit on another date). Each visit is its own marker; this finds the ones that share a spot.
// Pure: no DOM, importable from Node tests.
import { dateLabel, stopNo } from './poi.js';
import { dayInfo, dayText } from './trips.js';

/** Markers closer than this are treated as the same place. */
export const SAME_PLACE_M = 15;

const R = 6371000;
/** Distance between two points in metres (haversine). */
export function metres(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Itinerary order for the visits of one place: by date, then day, then stop; undated last. */
const byVisit = (a, b) => (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99')
  || (a.day ?? Infinity) - (b.day ?? Infinity) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.created.localeCompare(b.created);

/**
 * Groups of markers that share a spot (two or more), as Map id -> the whole group in visit order (the marker itself included).
 * Markers with no group are not in the map. A Home marker (the residence) is never part of a group.
 * Uses a grid of cells about one radius wide, so it stays fast with thousands of markers.
 */
export function visitGroups(items) {
  const cellLat = SAME_PLACE_M / 111320;
  const cellLon = (it) => cellLat / Math.max(0.2, Math.cos(it.lat * Math.PI / 180));
  const cellOf = (it) => [Math.floor(it.lat / cellLat), Math.floor(it.lon / cellLon(it))];
  const key = (i, j) => `${i}:${j}`;
  const list = items.filter((x) => x.type !== 'residence');
  const grid = new Map();
  for (const it of list) {
    const k = key(...cellOf(it));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  const near = (it) => {
    const [ci, cj] = cellOf(it);
    const out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const o of grid.get(key(ci + di, cj + dj)) ?? []) if (metres(it, o) <= SAME_PLACE_M) out.push(o);
    return out;
  };
  // markers near each other join into one group (a chain of near neighbours is one place)
  const parent = new Map(list.map((x) => [x.id, x.id]));
  const find = (id) => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  for (const it of list) for (const o of near(it)) if (o.id !== it.id) parent.set(find(o.id), find(it.id));
  const groups = new Map();
  for (const it of list) {
    const r = find(it.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  }
  const out = new Map();
  for (const g of groups.values()) if (g.length > 1) { g.sort(byVisit); for (const it of g) out.set(it.id, g); }
  return out;
}

/** Short text for one visit: "Day 3 · Sat, Nov 14", or "No date"; with the trip's name when it is not the current marker's trip. */
export function visitLabel(item, { tripName = '', trip = null } = {}) {
  const parts = [dayText(dayInfo(item, trip)), stopNo(item) !== undefined && `Stop ${stopNo(item)}`, item.date !== undefined && dateLabel(item)].filter(Boolean);
  const text = parts.length ? parts.join(' · ') : 'No date';
  return tripName ? `${text} · ${tripName}` : text;
}
