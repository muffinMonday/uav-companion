// Helpers for trips: wording, length, ordering and a date check. Pure functions; storage is in poi.js.
import { dateLabel, listMode, sortForList, isMain, isSub } from './poi.js';
import { countryName } from './countries.js';
import { daysBetween, addDays } from './dates.js';
import { haversineM } from './distance.js';

export { daysBetween, isMain, isSub };

/** Whole days from start to end, both counted (12 to 14 Nov is 3 days). null unless the trip has both dates. */
export function tripLength(t) {
  return t.startDate && t.endDate ? daysBetween(t.startDate, t.endDate) + 1 : null;
}

/** "Thu, Nov 12 – Sat, Nov 14", "Thu, Nov 12", or '' for a trip with no dates. */
export function tripDatesLabel(t) {
  if (!t.startDate) return '';
  return dateLabel({ date: t.startDate, endDate: t.endDate && t.endDate > t.startDate ? t.endDate : undefined });
}

/** "China · Thu, Nov 12 – Sat, Nov 14 · 3 days", leaving out whatever the trip does not have. */
export function tripSummary(t) {
  const n = tripLength(t);
  return [t.country && countryName(t.country), tripDatesLabel(t), n !== null && `${n} day${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}

/**
 * Is this marker's date outside its trip's dates? Only a warning, never a block: plans change.
 * A trip with just a start date is only "outside" for a marker dated before it. False if either has no date.
 */
export function outsideTrip(item, trip) {
  if (!trip || !trip.startDate || !item.date) return false;
  const itemEnd = item.endDate ?? item.date;
  if (item.date < trip.startDate) return true;
  return trip.endDate ? itemEnd > trip.endDate : false;
}

/** Trips in list order: by start date (undated last), then name. */
export function sortTrips(trips) {
  return trips.slice().sort((a, b) => (a.startDate ?? '9999-99-99').localeCompare(b.startDate ?? '9999-99-99') || a.name.localeCompare(b.name));
}

// ---------- countdown (for the welcome screen) ----------
// Trip dates are calendar dates without a time zone, so "today" is the visitor's own local date and everything is counted in whole days.

/** Local calendar date as YYYY-MM-DD. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Where a trip stands relative to `today`: { state: 'upcoming', days } before it starts, { state: 'now', day, of } while it runs
 * (a trip with only a start date runs for that one day), or null for a trip with no start date or one that is over.
 */
export function tripStatus(trip, today) {
  if (!trip.startDate) return null;
  const end = trip.endDate ?? trip.startDate;
  if (today < trip.startDate) return { state: 'upcoming', days: daysBetween(today, trip.startDate) };
  if (today <= end) return { state: 'now', day: daysBetween(trip.startDate, today) + 1, of: daysBetween(trip.startDate, end) + 1 };
  return null;
}
/** The trips still to come or under way, as [{ trip, status }]: under way first, then the soonest. */
export function comingTrips(trips, today) {
  const list = trips.map((trip) => ({ trip, status: tripStatus(trip, today) })).filter((x) => x.status);
  const rank = (x) => (x.status.state === 'now' ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || (a.status.days ?? 0) - (b.status.days ?? 0) || a.trip.startDate.localeCompare(b.trip.startDate));
}
/** "12 days to go", "Tomorrow", "Today" (a one-day trip under way) or "Day 2 of 3". */
export function countdownLabel(status) {
  if (status.state === 'upcoming') return status.days === 1 ? 'Tomorrow' : `${status.days} days to go`;
  return status.of === 1 ? 'Today' : `Day ${status.day} of ${status.of}`;
}

// ---------- the day of a marker within its trip ----------
// Day 1 is the trip's start date, so a marker's day is worked out from its date and nothing is typed in. Only a marker with no date (an old
// one that kept a day number) still shows its stored day.

/**
 * The day (or days, for a stay of several nights) a marker falls on: { day, last, derived } or null.
 * derived is false for the stored day of an old marker that has no date. A date before the trip starts or after it ends has no day.
 */
export function dayInfo(item, trip) {
  if (item.date && trip?.startDate) {
    if (item.date < trip.startDate || (trip.endDate && item.date > trip.endDate)) return null;
    const day = daysBetween(trip.startDate, item.date) + 1;
    let last = day;
    if (item.endDate) {
      const cap = trip.endDate ? daysBetween(trip.startDate, trip.endDate) + 1 : Infinity;
      last = Math.max(day, Math.min(daysBetween(trip.startDate, item.endDate) + 1, cap));
    }
    return { day, last, derived: true };
  }
  if (item.day !== undefined) return { day: item.day, last: item.day, derived: false };
  return null;
}
/** "Day 2", "Day 1–3" or ''. */
export const dayText = (info) => (info ? (info.last > info.day ? `Day ${info.day}–${info.last}` : `Day ${info.day}`) : '');

// ---------- the stops of a trip in order (for the previous / next buttons) ----------

/**
 * The markers of a trip that are part of its itinerary (they have a date, or an old stored day), in itinerary order: by date, then stop,
 * markers with no stop last within their day. Hotels are included. Markers with neither a date nor a day are left out.
 */
export function tripSequence(items, tripId) {
  const members = items.filter((i) => i.tripId === tripId && isMain(i) && (i.date !== undefined || i.day !== undefined)); // Side Quests are not stops
  return sortForList(members, listMode(members));
}

// ---------- the plan of a trip, day by day ----------

/** Has the trip ended before `today`? A trip with no dates never has. */
export function isPastTrip(trip, today) {
  const end = trip.endDate ?? trip.startDate;
  return !!end && end < today;
}

const byStop = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.created).localeCompare(String(b.created));

/**
 * A trip laid out by day: { days: [{ day, date, stops, km }], undated, outside }.
 * Every day of the trip is there, empty or not. A stay of several days is listed on its first day. `stops` are in stop order
 * (markers with no stop number last); `km` is the straight-line length of the chain of stops (0 for fewer than two).
 * `undated` have no date (an old stored day does not count); `outside` are dated before or after the trip.
 * Only main stops are laid out; the trip's Side Quests are in `sideQuests(items, trip.id)`.
 */
export function planDays(items, trip) {
  const mine = items.filter((i) => i.tripId === trip.id && isMain(i)); // Side Quests are not stops: no chain, no kilometres, no warnings (see sideQuests)
  const n = tripLength(trip) ?? 0;
  const days = Array.from({ length: n }, (_, k) => ({ day: k + 1, date: addDays(trip.startDate, k), stops: [], km: 0 }));
  const undated = [], outside = [];
  for (const it of mine) {
    if (!it.date) { undated.push(it); continue; }
    const info = dayInfo(it, trip);
    if (info && days[info.day - 1]) days[info.day - 1].stops.push(it); else outside.push(it);
  }
  for (const d of days) {
    d.stops.sort(byStop);
    let m = 0;
    for (let i = 1; i < d.stops.length; i++) m += haversineM(d.stops[i - 1].lat, d.stops[i - 1].lon, d.stops[i].lat, d.stops[i].lon);
    d.km = m / 1000;
  }
  undated.sort(byStop); outside.sort((a, b) => a.date.localeCompare(b.date) || byStop(a, b));
  return { days, undated, outside };
}

/**
 * What to look at in a trip: { undated, outside, noHotel } (counts and the days). `noHotel` lists the nights (day numbers) with no hotel,
 * but only when the trip has a hotel at all (staying with friends is not a gap). A hotel covers the nights from its first day up to
 * the day before it ends (a one-day entry covers that night). The last day of a trip has no night.
 */
export function tripWarnings(items, trip) {
  const plan = planDays(items, trip);
  const hotels = items.filter((i) => i.tripId === trip.id && i.type === 'hotel');
  const noHotel = [];
  if (hotels.length) {
    const covered = new Set();
    for (const h of hotels) {
      const info = dayInfo(h, trip);
      if (!info) continue;
      const lastNight = info.last > info.day ? info.last - 1 : info.day;
      for (let d = info.day; d <= lastNight; d++) covered.add(d);
    }
    for (let d = 1; d < plan.days.length; d++) if (!covered.has(d)) noHotel.push(d);
  }
  return { undated: plan.undated.length, outside: plan.outside.length, noHotel };
}

/** One line for the trip card: "2 without a date · 1 outside the dates · no accommodation on Day 2, 3", or '' when all is well. */
export function warningsLine(w) {
  const parts = [];
  if (w.undated) parts.push(`${w.undated} without a date`);
  if (w.outside) parts.push(`${w.outside} outside the dates`);
  if (w.noHotel.length) parts.push(`no accommodation for the night of ${w.noHotel.length === 1 ? 'Day' : 'Days'} ${w.noHotel.join(', ')}`);
  return parts.join(' · ');
}

// ---------- Side Quests: optional stops that hang from a main stop ----------

const BASE_PARENTS = new Set(['home', 'hotel', 'residence']);
const onDay = (sub, m) => Boolean(sub.date) && Boolean(m.date) && sub.date <= (m.endDate ?? m.date) && m.date <= (sub.endDate ?? sub.date);

/**
 * The main stop a Side Quest hangs from, or null for another kind of marker or a Side Quest with no main stop in its trip.
 * Its own `parentId` counts when that marker still exists, is a main stop (a hotel may be one) and is in the same trip. Otherwise the nearest
 * main stop of the trip is taken (not a Home point, Hotel or Home marker), preferring one on the same date when both are dated.
 */
export function parentOf(sub, items) {
  if (!isSub(sub)) return null;
  const inTrip = items.filter((i) => isMain(i) && i.type !== 'residence' && (i.tripId ?? null) === (sub.tripId ?? null));
  const own = sub.parentId ? inTrip.find((m) => m.id === sub.parentId) : null;
  if (own) return own;
  const stops = inTrip.filter((m) => !BASE_PARENTS.has(m.type));
  const sameDay = stops.filter((m) => onDay(sub, m));
  let best = null, bestM = Infinity;
  for (const m of sameDay.length ? sameDay : stops) {
    const d = haversineM(sub.lat, sub.lon, m.lat, m.lon);
    if (d < bestM) { best = m; bestM = d; }
  }
  return best;
}

const bySibling = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.created).localeCompare(String(b.created));

/**
 * Every Side Quest of the given markers laid out under its parent: { byParent: Map(parent id -> [Side Quests in order]), orphans: [Side Quests with no parent] }.
 * Pass the markers of one trip (or all of them: a Side Quest only ever hangs from a main stop of its own trip).
 */
export function sideQuestMap(items) {
  const byParent = new Map(), orphans = [];
  for (const s of items) {
    if (!isSub(s)) continue;
    const p = parentOf(s, items);
    if (!p) { orphans.push(s); continue; }
    if (!byParent.has(p.id)) byParent.set(p.id, []);
    byParent.get(p.id).push(s);
  }
  for (const list of byParent.values()) list.sort(bySibling);
  orphans.sort(bySibling);
  return { byParent, orphans };
}

/** The trip's Side Quests, flat (a trip with id `tripId`; null for the markers that are in no trip). */
export const sideQuests = (items, tripId) => items.filter((i) => isSub(i) && (i.tripId ?? null) === (tripId ?? null));

/** Where a new Side Quest at a spot { lat, lon, tripId?, date? } would hang: the nearest main stop of the trip (see parentOf), or null. */
export const defaultParent = (spot, items) => parentOf({ ...spot, isSub: true, parentId: undefined }, items);

/**
 * The changes that turn a main stop into a Side Quest (for store.update): it hangs from the nearest other main stop of its trip, loses its stop number
 * and, when it had no date, takes its parent's. Markers selected together are not each other's parents: pass `items` without the other selected ones.
 */
export function sideQuestPatch(item, items) {
  const parent = parentOf({ ...item, isSub: true, parentId: undefined }, items.filter((i) => i.id !== item.id));
  return { isSub: true, parentId: parent?.id, order: undefined, ...(!item.date && parent?.date ? { date: parent.date } : {}) };
}

/** The changes that turn a Side Quest back into a main stop: it leaves its parent and, if it has a date, becomes the last stop of that day. */
export function mainStopPatch(item, items) {
  const same = items.filter((i) => i.id !== item.id && isMain(i) && (i.tripId ?? null) === (item.tripId ?? null) && item.date && i.date === item.date && i.order !== undefined);
  return { isSub: false, parentId: undefined, order: item.date ? Math.max(0, ...same.map((i) => i.order)) + 1 : undefined };
}
