// Helpers for trips: wording, length, ordering and a date check. Pure functions; storage is in poi.js.
import { dateLabel } from './poi.js';
import { countryName } from './countries.js';

const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** Whole days from start to end, both counted (12 to 14 Nov is 3 days). null unless the trip has both dates. */
export function tripLength(t) {
  return t.startDate && t.endDate ? Math.round((ms(t.endDate) - ms(t.startDate)) / 86400000) + 1 : null;
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
