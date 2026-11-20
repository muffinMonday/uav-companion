// Itinerary legs: which directed hops between stops are drawn on the map. Pure functions, no map or storage.
// This is the sequencing that poi-ui.js used to do inline (chain of a day, overnight links through a hotel); routing never changes it,
// it only changes the geometry, distance and duration of a leg.
import { isMain } from '../poi.js';
import { addDays } from '../dates.js';

/** The stops of one trip on one date, joined in stop order. Hotels and the Home marker are not part of the chain. */
export function chainOf(items, tripId, date) {
  return items.filter((i) => i.tripId === tripId && i.date === date && isMain(i) && i.order !== undefined && i.type !== 'hotel' && i.type !== 'residence')
    .sort((a, b) => a.order - b.order || String(a.created).localeCompare(String(b.created)));
}

/** The days of a trip that have stops, in order. */
export const stopDates = (items, tripId) => [...new Set(items.filter((i) => i.tripId === tripId && i.date && isMain(i) && i.order !== undefined && i.type !== 'hotel' && i.type !== 'residence').map((i) => i.date))].sort();

const end = (m) => ({ id: m.id, lat: m.lat, lon: m.lon });
/** One directed leg. `bold`: the selected marker's own legs; `overnight`: a link between days (through a hotel or straight to the next day). */
export function makeLeg(a, b, tripId, { bold = false, overnight = false } = {}) {
  return { id: `${a.id}>${b.id}`, tripId: tripId ?? null, from: end(a), to: end(b), bold, overnight };
}

/** Legs between consecutive stops of a chain; those into and out of `selId` are bold. */
export function chainLegs(chain, selId, tripId) {
  const out = [];
  for (let i = 1; i < chain.length; i++) out.push(makeLeg(chain[i - 1], chain[i], tripId, { bold: !!selId && (chain[i - 1].id === selId || chain[i].id === selId) }));
  return out;
}

/**
 * The legs on show. `day`: a day shown from the trips screen (all thin). `selected`: the chain of the selected marker's day plus its overnight links.
 * `it` is the selected marker (or null); `tripDrawn(tripId)` says whether the trip is on the map (a hidden trip draws nothing).
 */
export function selectionLegs({ items, it, shownDay, tripDrawn }) {
  const day = [], selected = [];
  if (shownDay && tripDrawn(shownDay.tripId)) {
    const chain = chainOf(items, shownDay.tripId, shownDay.date);
    if (chain.length >= 2) day.push(...chainLegs(chain, null, shownDay.tripId));
  }
  if (!it?.tripId || !it.date || !tripDrawn(it.tripId)) return { day, selected };
  const tripId = it.tripId, chain = chainOf(items, tripId, it.date);
  if (chain.length >= 2) selected.push(...chainLegs(chain, it.id, tripId));
  const dates = stopDates(items, tripId);
  const over = (a, b) => selected.push(makeLeg(a, b, tripId, { bold: true, overnight: true }));
  // a hotel is where the day ends: a leg in from the last stop of its first day, and one out to the first stop of the day after it checks out
  if (it.type === 'hotel') {
    const d = [...dates].reverse().find((x) => x <= it.date);
    if (d) { const c = chainOf(items, tripId, d); if (c.length) over(c[c.length - 1], it); }
    const morning = it.endDate && it.endDate > it.date ? it.endDate : addDays(it.date, 1);
    const next = dates.find((x) => x >= morning);
    if (next) { const c = chainOf(items, tripId, next); if (c.length) over(it, c[0]); }
    return { day, selected };
  }
  // the first stop of a day follows the hotel of the night before (or, with none, the last stop of the day before); the last stop leads to
  // its night's hotel (or, with none, the first stop of the next day)
  const at = chain.findIndex((x) => x.id === it.id);
  if (at < 0) return { day, selected };
  const di = dates.indexOf(it.date);
  const hotels = items.filter((h) => h.tripId === tripId && h.type === 'hotel' && h.date);
  const hotelFor = (night) => hotels.find((h) => h.date <= night && night <= (h.endDate && h.endDate > h.date ? addDays(h.endDate, -1) : h.date));
  if (at === 0 && di >= 0) {
    const hotel = hotelFor(addDays(it.date, -1));
    if (hotel) over(hotel, it);
    else if (di > 0) { const before = chainOf(items, tripId, dates[di - 1]); if (before.length) over(before[before.length - 1], it); }
  }
  if (at === chain.length - 1 && di >= 0) {
    const hotel = hotelFor(it.date);
    if (hotel) over(it, hotel);
    else if (di < dates.length - 1) { const after = chainOf(items, tripId, dates[di + 1]); if (after.length) over(it, after[0]); }
  }
  return { day, selected };
}
