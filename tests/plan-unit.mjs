// The trip plan: days, distances, warnings, past trips, notes and the checklist. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const poi = await load('src/poi.js');
const T = await load('src/trips.js');

const trip = { id: 't', name: 'Hubei', startDate: '2026-11-12', endDate: '2026-11-15' }; // 4 days, 3 nights
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, tripId: 't', ...extra });
const items = [
  mk('a', 'Airport', 30.78, 114.21, { date: '2026-11-12', order: 1 }),
  mk('b', 'Tower', 30.59, 114.30, { date: '2026-11-12', order: 2 }),
  mk('h1', 'Hotel A', 30.58, 114.30, { type: 'hotel', date: '2026-11-12', endDate: '2026-11-13' }),
  mk('c', 'Lake', 30.55, 114.37, { date: '2026-11-13', order: 1 }),
  mk('u', 'Somewhere', 30.5, 114.3),
  mk('o', 'Too late', 30.5, 114.3, { date: '2026-11-20' }),
  mk('x', 'Other trip', 1.3, 103.8, { tripId: 'other', date: '2026-11-12' }),
];

// ---------- the plan
const plan = T.planDays(items, trip);
ok(plan.days.length === 4 && plan.days.map((d) => d.date).join() === '2026-11-12,2026-11-13,2026-11-14,2026-11-15', 'every day of the trip is there, with its date');
ok(plan.days[0].stops.map((s) => s.name).join() === 'Airport,Tower,Hotel A', 'a day lists its stops in stop order, markers with no stop last');
ok(plan.days[1].stops.map((s) => s.name).join() === 'Lake' && plan.days[2].stops.length === 0, 'a stay is listed on its first day only; an empty day stays empty');
ok(plan.undated.map((s) => s.name).join() === 'Somewhere' && plan.outside.map((s) => s.name).join() === 'Too late', 'undated and outside-the-dates markers are kept apart');
ok(!JSON.stringify(plan).includes('Other trip'), 'markers of another trip are not in it');
ok(plan.days[0].km > 22 && plan.days[0].km < 26 && plan.days[1].km === 0, 'a day has the straight-line length of its chain of stops: ' + plan.days[0].km.toFixed(1) + ' km');
ok(T.planDays([], { id: 'z', name: 'z' }).days.length === 0, 'a trip with no dates has no days');

// ---------- warnings
let w = T.tripWarnings(items, trip);
ok(w.undated === 1 && w.outside === 1, 'warnings count the undated and the outside markers');
ok(w.noHotel.join() === '2,3', 'nights with no hotel: the hotel covers the night of Day 1 only (check-in 12, out 13): ' + w.noHotel.join());
ok(T.tripWarnings(items.filter((i) => i.type !== 'hotel'), trip).noHotel.length === 0, 'a trip with no hotel at all has no hotel warning (staying with friends)');
const longStay = [...items, mk('h2', 'Hotel B', 30.6, 114.3, { type: 'hotel', date: '2026-11-13', endDate: '2026-11-15' })];
ok(T.tripWarnings(longStay, trip).noHotel.length === 0, 'two stays cover every night; the last day has no night');
ok(T.warningsLine(w) === '1 without a date · 1 outside the dates · no hotel for the night of Days 2, 3', 'one line for the card: ' + T.warningsLine(w));
ok(T.warningsLine({ undated: 0, outside: 0, noHotel: [] }) === '', 'nothing to say when all is well');

// ---------- past trips
ok(T.isPastTrip(trip, '2026-11-16') && !T.isPastTrip(trip, '2026-11-15') && !T.isPastTrip({ id: 'n', name: 'n' }, '2030-01-01'), 'a trip is past the day after it ends; an undated trip never is');

// ---------- notes and checklist
let f = poi.tripFields({ name: 'x', notes: 'Bring ND filters', checklist: [{ text: ' Batteries ', done: true }, { text: '', done: true }, { text: 'Permit' }, 'junk'] });
ok(f.notes === 'Bring ND filters' && f.checklist.length === 2 && f.checklist[0].text === 'Batteries' && f.checklist[0].done === true && f.checklist[1].done === false, 'notes and checklist are kept; empty and invalid items are dropped');
f = poi.tripFields({ name: 'x', notes: '  ', checklist: [] });
ok(f.notes === undefined && f.checklist === undefined, 'empty notes and an empty checklist are not stored');
f = poi.tripFields({ name: 'x', notes: 'n'.repeat(5000), checklist: Array.from({ length: 50 }, (_, i) => ({ text: 'item ' + i })) });
ok(f.notes.length === poi.MAX_NOTES && f.checklist.length === poi.MAX_CHECKLIST, 'notes are capped at 2000 characters and the checklist at 30 items');
const store = poi.createStore();
const t1 = store.addTrip({ name: 'Trip', startDate: '2026-11-12', endDate: '2026-11-13' }).trip;
store.updateTrip(t1.id, { notes: 'hello', checklist: [{ text: 'a', done: false }] });
store.updateTrip(t1.id, { name: 'Trip renamed' });
const t2 = store.getTrip(t1.id);
ok(t2.notes === 'hello' && t2.checklist.length === 1 && t2.name === 'Trip renamed', 'editing the name keeps the notes and the checklist');
const gj = poi.toGeoJSON(store.items(), store.trips());
const back = poi.parseGeoJSON(JSON.stringify(gj));
ok(back.trips[0].notes === 'hello' && back.trips[0].checklist[0].text === 'a', 'notes and checklist survive export and import');
