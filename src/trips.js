// Helpers for trips: wording, length, ordering and a date check. Pure functions; storage is in poi.js.
import { dateLabel } from './poi.js';
import { countryName } from './countries.js';
import { daysBetween } from './dates.js';

export { daysBetween };

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
