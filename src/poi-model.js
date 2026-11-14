// The saved-places list as a derived view: which collapsible section holds a marker, what a section header counts, and
// which sections must open so a marker is on screen. Pure functions, no DOM and no storage; nothing here is saved.
//
// The hierarchy is Trip > day (date) > main stop > Side Quest, with "No trip" (Unassigned) and the private Home marker as
// sections of their own. A section is a scope: a trip id, 'none' (Unassigned) or 'home'. Day groups are the list's own
// grouping (listMode / groupKey), so the model and the list can never disagree about where a marker belongs.
import { listMode, isSub, typeOf } from './poi.js';
import { groupKey } from './reorder.js';
import { outsideTrip, sideQuestMap } from './trips.js';

export const SCOPE_NONE = 'none', SCOPE_HOME = 'home';
/** The section a marker belongs to. The Home marker (a residence) is never in a trip, whatever its record says. */
export const scopeOf = (item) => (item.type === 'residence' ? SCOPE_HOME : item.tripId ?? SCOPE_NONE);
/** Key of one day group inside a section. */
export const dayId = (scope, key) => `${scope}|${key}`;

/** A fresh, empty expansion state. Lives in memory for the page: nothing is stored, so every reload starts folded. */
export const newExpansion = () => ({ scopes: new Set(), days: new Set() });

/** Is a section open? `force` is true while the list must show everything (selecting markers, a filter or a search). */
export const scopeOpen = (state, scope, force = false) => force || state.scopes.has(scope);
export const dayOpen = (state, scope, key, force = false) => force || state.days.has(dayId(scope, key));

/**
 * What a section header counts, each marker once. A Side Quest is a place like any other (it is listed under its main stop,
 * not twice), so `places` is every marker in the group. `days` counts the dated groups that fall inside the trip's dates
 * (or the day numbers, for a list of days); undated markers and markers dated outside the trip are counted separately.
 */
export function summarise(group, trip, mode = listMode(group)) {
  const dayKeys = new Set();
  let unscheduled = 0, outside = 0;
  for (const it of group) {
    if (mode === 'plain') continue;
    const k = groupKey(it, mode);
    if (k === 'none') { unscheduled++; continue; }
    if (mode === 'date' && trip && outsideTrip(it, trip)) { outside++; continue; }
    dayKeys.add(k);
  }
  return { places: group.length, days: dayKeys.size, unscheduled, outside };
}

/** One line for a header: "12 places · 3 days", plus what is unscheduled or outside the dates when there is any. */
export function summaryText(sum) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  const parts = [n(sum.places, 'place', 'places')];
  if (sum.days) parts.push(n(sum.days, 'day', 'days'));
  if (sum.outside) parts.push(`${sum.outside} outside the dates`);
  return parts.join(' · ');
}

/** Is this marker's day group outside its trip's dates? (The heading says so; the marker is never changed.) */
export const isOutside = (item, trip, mode) => mode === 'date' && !!trip && !!item.date && outsideTrip(item, trip);

/**
 * The sections that hold a marker: its scope and its day key. `groupItems` are all the markers of that scope (a filter must not
 * change which group a marker is in), so the list mode is the same one the list draws with.
 */
export function ancestorsOf(item, items) {
  const scope = scopeOf(item);
  const group = items.filter((i) => scopeOf(i) === scope);
  const mode = listMode(group);
  return { scope, mode, key: String(groupKey(item, mode)) };
}

/**
 * Opens whatever must be open for a marker to be seen (its trip, its day), without touching anything else. Returns true if the
 * state changed. A Side Quest is opened by its main stop (the list's own `expandedParent`), not here.
 */
export function reveal(state, item, items) {
  const { scope, mode, key } = ancestorsOf(item, items);
  let changed = false;
  if (!state.scopes.has(scope)) { state.scopes.add(scope); changed = true; }
  if (mode !== 'plain' && scope !== SCOPE_NONE && scope !== SCOPE_HOME && !state.days.has(dayId(scope, key))) { state.days.add(dayId(scope, key)); changed = true; }
  return changed;
}

/** Drops open sections of trips that no longer exist, so the state cannot grow without bound. Never touches scopes 'none' and 'home'. */
export function prune(state, tripIds) {
  const live = new Set([SCOPE_NONE, SCOPE_HOME, ...tripIds]);
  for (const s of [...state.scopes]) if (!live.has(s)) state.scopes.delete(s);
  for (const d of [...state.days]) if (!live.has(d.slice(0, d.indexOf('|')))) state.days.delete(d);
}

/**
 * Side Quests that have no main stop to hang from, with where each would be shown: under its trip's matching day, under the trip's
 * Unscheduled group, or under Unassigned. A presentation helper only: a Side Quest is never changed because it is unlinked.
 * Returns [{ item, scope, key }] where `key` is the group key to list it under.
 */
export function unlinkedSideQuests(items) {
  const { orphans } = sideQuestMap(items.filter((i) => i.type !== 'residence'));
  return orphans.filter((o) => isSub(o)).map((o) => {
    const scope = scopeOf(o);
    const mode = listMode(items.filter((i) => scopeOf(i) === scope));
    return { item: o, scope, key: String(groupKey(o, mode)) };
  });
}

// ---------- search ----------
const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
/** The words of a query, folded for comparison. Empty when there is nothing to look for. */
export const queryTerms = (query) => fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
/**
 * Does a marker match a query? Every word must appear in its name, note, type label or trip name (case-insensitive, any order).
 * It looks at the whole store, never at what is drawn: a marker in a folded trip, or hidden on the map, matches all the same.
 * `tripName` is the name of the marker's trip, or '' (the Home marker has none).
 */
export function matches(item, terms, tripName = '') {
  if (!terms.length) return true;
  const hay = fold(`${item.name} ${item.note ?? ''} ${typeOf(item.type).label} ${item.type === 'residence' ? '' : tripName}`);
  return terms.every((t) => hay.includes(t));
}
