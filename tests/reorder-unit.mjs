// Reordering saved places: what date, day and stop a marker and its neighbours get when it is dropped somewhere else. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const R = await load('src/reorder.js');
const poi = await load('src/poi.js');

const TRIP = { id: 't', name: 'Wuhan', startDate: '2026-11-12', endDate: '2026-11-14' };
let n = 0;
const it = (id, extra = {}) => ({ id, type: 'photo', name: id, note: '', lat: 30 + (++n) * 0.01, lon: 114, created: `2026-11-01T00:00:${String(n).padStart(2, '0')}.000Z`, tripId: 't', ...extra });
const by = (res, id) => res.items.find((x) => x.id === id);
const snapshot = (xs) => JSON.stringify(xs);

// ---------- dates
ok(R.addDays('2026-11-30', 1) === '2026-12-01' && R.addDays('2026-12-31', 1) === '2027-01-01' && R.addDays('2026-03-01', -1) === '2026-02-28' && R.addDays('2026-11-12', 0) === '2026-11-12', 'dates: addDays crosses month and year ends');
ok(R.nextTripDate('2026-11-12', TRIP) === '2026-11-13' && R.nextTripDate('2026-11-13', TRIP) === '2026-11-14', 'dates: the next day of the trip');
ok(R.nextTripDate('2026-11-14', TRIP) === '2026-11-14' && R.nextTripDate('2026-11-20', TRIP) === '2026-11-20', 'dates: on or after the trip\'s last day, the end is the same day');
ok(R.nextTripDate('2026-11-14', null) === '2026-11-15' && R.nextTripDate('2026-11-14', { startDate: '2026-11-12' }) === '2026-11-15', 'dates: with no trip or no end date, just the next day');

// ---------- within a date group: only the stops change
const A = it('A', { date: '2026-11-12', day: 1, order: 1 }), B = it('B', { date: '2026-11-12', day: 1, order: 2 }), C = it('C', { date: '2026-11-13', day: 2, order: 1 });
const members = [A, B, C];
const before = snapshot(members);
let r = R.planMove({ members, mode: 'date', movedId: 'A', targetKey: '2026-11-12', index: 1, trip: TRIP });
ok(r && r.items.length === 2 && by(r, 'A').order === 2 && by(r, 'B').order === 1 && by(r, 'A').date === '2026-11-12' && by(r, 'A').day === 1, 'same day: moving A below B swaps their stops (A 2, B 1) and changes nothing else');
ok(snapshot(members) === before, 'the original markers are not changed');
ok(R.planMove({ members, mode: 'date', movedId: 'A', targetKey: '2026-11-12', index: 0, trip: TRIP }) === null, 'dropping a marker where it already is changes nothing');

// ---------- to another date that has markers
r = R.planMove({ members, mode: 'date', movedId: 'B', targetKey: '2026-11-13', index: 0, trip: TRIP });
ok(by(r, 'B').date === '2026-11-13' && by(r, 'B').order === 1 && by(r, 'C').order === 2, 'to 13 Nov, first: B takes date 13 Nov and stop 1; C moves to stop 2 (the day follows from the date, nothing is set)');
ok(!by(r, 'A'), 'the group B left is renumbered only if needed (A is already stop 1)');
r = R.planMove({ members, mode: 'date', movedId: 'A', targetKey: '2026-11-13', index: 1, trip: TRIP });
ok(by(r, 'A').order === 2 && by(r, 'A').date === '2026-11-13' && !by(r, 'C') && by(r, 'B').order === 1, 'to 13 Nov, after C: A is stop 2 (C stays stop 1, untouched), and B, left alone in 12 Nov, becomes stop 1');

// ---------- to a trip date with no markers yet
r = R.planMove({ members, mode: 'date', movedId: 'C', targetKey: '2026-11-14', index: 0, trip: TRIP });
ok(by(r, 'C').date === '2026-11-14' && by(r, 'C').order === 1, 'to an empty trip day (14 Nov): date 14 Nov, stop 1');

// ---------- markers without days or stops
const P = it('P', { date: '2026-11-12' }), Q = it('Q', { date: '2026-11-13' });
r = R.planMove({ members: [P, Q], mode: 'date', movedId: 'P', targetKey: '2026-11-13', index: 1, trip: TRIP });
ok(by(r, 'P').date === '2026-11-13' && !('day' in by(r, 'P')) && by(r, 'P').order === 2 && by(r, 'Q').order === 1, 'no days anywhere: no day is invented, but the new order is kept as stops');

// ---------- hotels
const H = it('H', { type: 'hotel', date: '2026-11-12', endDate: '2026-11-14', day: 1, order: 3 });
const withH = [A, B, C, H];
r = R.planMove({ members: withH, mode: 'date', movedId: 'H', targetKey: '2026-11-13', index: 0, trip: TRIP });
ok(by(r, 'H').date === '2026-11-13' && by(r, 'H').endDate === '2026-11-14', 'hotel: moved to 13 Nov, it starts then and ends on the next trip day (14 Nov)');
r = R.planMove({ members: withH, mode: 'date', movedId: 'H', targetKey: '2026-11-14', index: 0, trip: TRIP });
ok(by(r, 'H').date === '2026-11-14' && by(r, 'H').endDate === '2026-11-14', 'hotel: moved to the trip\'s last day, start and end are both that day');
r = R.planMove({ members: withH, mode: 'date', movedId: 'H', targetKey: '2026-11-12', index: 0, trip: TRIP });
ok(r && by(r, 'H').order === 1 && by(r, 'H').endDate === '2026-11-14', 'hotel: reordered within its own day, its end date is left alone');
const H2 = it('H2', { type: 'hotel', date: '2026-11-12', tripId: undefined });
r = R.planMove({ members: [H2, it('Z', { date: '2026-11-20', tripId: undefined })], mode: 'date', movedId: 'H2', targetKey: '2026-11-20', index: 0, trip: null });
ok(by(r, 'H2').date === '2026-11-20' && by(r, 'H2').endDate === '2026-11-21', 'hotel with no trip: ends the next day');

// ---------- other markers with a date range keep their length
const W = it('W', { date: '2026-11-12', endDate: '2026-11-13' });
r = R.planMove({ members: [W, Q], mode: 'date', movedId: 'W', targetKey: '2026-11-13', index: 0, trip: TRIP });
ok(by(r, 'W').date === '2026-11-13' && by(r, 'W').endDate === '2026-11-14', 'a non-hotel with a range keeps its length (1 night) when moved');

// ---------- out of the itinerary
const D = it('D'); // no date
r = R.planMove({ members: [A, B, C, D], mode: 'date', movedId: 'A', targetKey: 'none', index: 0, trip: TRIP });
ok(!('date' in by(r, 'A')) && !('day' in by(r, 'A')) && !('order' in by(r, 'A')) && by(r, 'B').order === 1, 'into "No date set": date, day and stop are cleared, and the group it left is renumbered');
r = R.planMove({ members: [A, B, C, D], mode: 'date', movedId: 'D', targetKey: '2026-11-13', index: 0, trip: TRIP });
ok(by(r, 'D').date === '2026-11-13' && by(r, 'D').order === 1 && by(r, 'C').order === 2, 'out of "No date set" into a date: it gets that date and stop 1');
ok(R.planMove({ members: [A, B, C, D], mode: 'date', movedId: 'D', targetKey: 'none', index: 0, trip: TRIP }) === null, 'within "No date set" nothing changes');

// ---------- lists with days only (old markers) are not reordered: a day can no longer be typed in
const X = it('X', { day: 1, order: 1 }), Y = it('Y', { day: 2, order: 1 }), Z = it('Z', { day: 2, order: 2 });
ok(R.planMove({ members: [X, Y, Z], mode: 'day', movedId: 'X', targetKey: 2, index: 1, trip: null }) === null, 'a day-only list cannot be reordered');
ok(R.planMove({ members: [X, Y, Z], mode: 'plain', movedId: 'X', targetKey: 2, index: 0 }) === null, 'plain lists cannot be reordered');
ok(R.planMove({ members: [X], mode: 'day', movedId: 'nope', targetKey: 2, index: 0 }) === null, 'an unknown marker gives nothing');

// ---------- the result is accepted by the store
const store = poi.createStore();
const tr = store.addTrip({ name: 'Wuhan', startDate: '2026-11-12', endDate: '2026-11-14' }).trip;
const mk = (name, extra) => store.add({ type: 'photo', name, lat: 30, lon: 114, tripId: tr.id, ...extra }).item;
const s1 = mk('One', { date: '2026-11-12', day: 1, order: 1 }), s2 = mk('Two', { date: '2026-11-12', day: 1, order: 2 }), s3 = mk('Three', { date: '2026-11-13', day: 2, order: 1 });
const plan = R.planMove({ members: store.items(), mode: 'date', movedId: s1.id, targetKey: '2026-11-13', index: 1, trip: tr });
const res = store.setMany(plan.items);
const now = Object.fromEntries(store.items().map((x) => [x.name, x]));
ok(res.ok && now.One.date === '2026-11-13' && now.One.order === 2 && now.Three.order === 1 && now.Two.order === 1, 'store: setMany applies the plan');
store.setMany(res.previous);
const back = Object.fromEntries(store.items().map((x) => [x.name, x]));
ok(back.One.date === '2026-11-12' && back.One.order === 1 && back.Two.order === 2 && back.Three.order === 1, 'store: setMany with the returned previous values undoes it');
ok(store.items().map((x) => x.name).join() === 'Three,Two,One', 'store: the order of the stored list is untouched');

// ---------- keyboard steps
const g = [A, B, C, D];
ok(JSON.stringify(R.stepSlot(g, 'date', 'A', 1)) === JSON.stringify({ key: '2026-11-12', index: 1 }), 'step down: A moves below B in the same day');
ok(JSON.stringify(R.stepSlot(g, 'date', 'B', 1)) === JSON.stringify({ key: '2026-11-13', index: 0 }), 'step down from the last of a day: to the top of the next day');
ok(JSON.stringify(R.stepSlot(g, 'date', 'C', -1)) === JSON.stringify({ key: '2026-11-12', index: 2 }), 'step up from the first of a day: to the end of the previous day');
ok(R.stepSlot(g, 'date', 'A', -1) === null && R.stepSlot(g, 'date', 'C', 1) === null, 'step up at the very top and down into "No date set": not possible');
