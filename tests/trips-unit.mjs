// Trips: validation, countries, store, distance scoping, export/import and the AI `trip` object. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const poi = await load('src/poi.js');
const dist = await load('src/distance.js');
const ai = await load('src/aiimport.js');
const trips = await load('src/trips.js');
const countries = await load('src/countries.js');

// ---------- countries
ok(countries.countryCode('cn') === 'CN' && countries.countryCode('Singapore') === 'SG' && countries.countryCode(' singapore ') === 'SG', 'country: a code (any case) or a name resolves to the ISO code');
ok(countries.countryCode('UK') === 'GB' || countries.countryCode('uk') === 'GB', 'country: alias "UK" resolves to GB');
ok(countries.countryCode('Atlantis') === null && countries.countryCode('') === null && countries.countryCode(5) === null, 'country: unknown names and non-strings give null');
ok(countries.countryName('SG') === 'Singapore' && countries.countryName('ZZ') === '', 'country: name from code; unknown code gives an empty string');

// ---------- tripFields / sanitizeTrip
ok(poi.tripFields({}) === null && poi.tripFields({ name: '   ' }) === null && poi.tripFields(null) === null, 'trip: a name is required');
let f = poi.tripFields({ name: ' Hubei 2026 ', country: 'China', startDate: '2026-11-12', endDate: '2026-11-14', description: 'd' });
ok(f.name === 'Hubei 2026' && f.country === 'CN' && f.startDate === '2026-11-12' && f.endDate === '2026-11-14' && f.description === 'd', 'trip: fields are trimmed and the country is stored as its code');
f = poi.tripFields({ name: 'x', startDate: '2026-11-12', endDate: '2026-11-10' });
ok(f.startDate === '2026-11-12' && f.endDate === undefined, 'trip: an end date before the start is dropped');
f = poi.tripFields({ name: 'x', endDate: '2026-11-14' });
ok(f.startDate === undefined && f.endDate === undefined, 'trip: an end date without a start date is dropped');
f = poi.tripFields({ name: 'x', country: 'Nowhere', startDate: '2026-02-31' });
ok(f.country === undefined && f.startDate === undefined, 'trip: an unknown country and an impossible date are dropped');
f = poi.tripFields({ name: 'n'.repeat(200), description: 'd'.repeat(900) });
ok(f.name.length === 80 && f.description.length === 500, 'trip: name capped at 80, description at 500');
const st = poi.sanitizeTrip({ name: 'x', color: 'red', id: 'a'.repeat(100) });
ok(poi.TRIP_COLORS.includes(st.color) && st.id.length <= 64 && st.id !== 'a'.repeat(100) && Number.isFinite(Date.parse(st.created)), 'trip: bad colour falls back to the palette, over-long id is replaced, created is set');

// ---------- helpers
const T = { startDate: '2026-11-12', endDate: '2026-11-14', country: 'CN' };
ok(trips.tripLength(T) === 3 && trips.tripLength({ startDate: '2026-11-12' }) === null && trips.tripLength({}) === null, 'helpers: length counts both days, null without both dates');
ok(/3 days/.test(trips.tripSummary({ ...T, name: 'x' })) && /China/.test(trips.tripSummary({ ...T, name: 'x' })) && trips.tripSummary({ name: 'x' }) === '', 'helpers: summary lists country, dates, days; empty for a bare trip');
ok(/1 day$/.test(trips.tripSummary({ name: 'x', startDate: '2026-11-12', endDate: '2026-11-12' })), 'helpers: one day is singular');
ok(trips.outsideTrip({ date: '2026-11-11' }, T) && trips.outsideTrip({ date: '2026-11-14', endDate: '2026-11-15' }, T) && !trips.outsideTrip({ date: '2026-11-13' }, T) && !trips.outsideTrip({ date: '2026-11-14' }, T), 'helpers: outsideTrip flags dates before the start or after the end');
ok(!trips.outsideTrip({}, T) && !trips.outsideTrip({ date: '2026-01-01' }, {}) && !trips.outsideTrip({ date: '2026-12-01' }, { startDate: '2026-11-12' }) && trips.outsideTrip({ date: '2026-11-01' }, { startDate: '2026-11-12' }), 'helpers: no date on either side is never outside; a start-only trip only flags earlier dates');
const sorted = trips.sortTrips([{ name: 'b' }, { name: 'z', startDate: '2026-12-01' }, { name: 'a', startDate: '2026-11-01' }, { name: 'a2' }]).map((t) => t.name);
ok(sorted.join() === 'a,z,a2,b', 'helpers: trips sort by start date, undated last, then name: ' + sorted);

// ---------- store
const s = poi.createStore();
const a = s.addTrip({ name: 'Hubei', country: 'CN', startDate: '2026-11-12', endDate: '2026-11-14' });
const b = s.addTrip({ name: 'Singapore', country: 'SG' });
ok(a.ok && b.ok && s.trips().length === 2 && a.trip.id !== b.trip.id && a.trip.color !== b.trip.color, 'store: trips are added, each with its own id and a different colour');
ok(s.addTrip({ name: '' }).ok === false, 'store: a trip without a name is refused');
ok(s.getTrip(a.trip.id).name === 'Hubei' && s.getTrip('nope') === undefined, 'store: getTrip');
const u = s.updateTrip(a.trip.id, { description: 'hello', color: b.trip.color });
ok(u.ok && s.getTrip(a.trip.id).description === 'hello' && s.getTrip(a.trip.id).id === a.trip.id && s.updateTrip('nope', {}).ok === false, 'store: updateTrip keeps the id, unknown id fails');
const m1 = s.add({ type: 'photo', name: 'P1', lat: 30, lon: 114, tripId: a.trip.id });
const m2 = s.add({ type: 'hotel', name: 'H1', lat: 30.1, lon: 114, tripId: a.trip.id });
const mh = s.add({ type: 'residence', name: 'Flat', lat: 1.3, lon: 103.8, tripId: a.trip.id });
const mb = s.add({ type: 'photo', name: 'Ghost', lat: 30, lon: 114, tripId: 'missing' });
ok(m1.item.tripId === a.trip.id && m2.item.tripId === a.trip.id, 'store: a marker keeps the trip it is tagged with');
ok(mh.item.tripId === undefined, 'store: a Home marker never has a trip');
ok(mb.item.tripId === undefined, 'store: a tag pointing at a trip that does not exist is dropped');
ok(s.update(mh.item.id, { tripId: a.trip.id }).item.tripId === undefined, 'store: updating a Home marker cannot give it a trip');
ok(s.update(m1.item.id, { type: 'residence' }).item.tripId === undefined, 'store: turning a marker into Home removes its trip');
s.update(m1.item.id, { type: 'photo', tripId: a.trip.id });
const e1 = s.ensureTrip({ name: 'hubei', country: 'China', startDate: '2026-11-12', endDate: '2026-11-14' });
ok(e1.trip.id === a.trip.id && e1.created === false, 'store: ensureTrip finds the same trip (name in any case, same country and dates)');
const e2 = s.ensureTrip({ name: 'Hubei', country: 'China', startDate: '2026-12-01' });
ok(e2.created === true && s.trips().length === 3, 'store: ensureTrip creates a trip when the dates differ');
const r = s.removeTrip(a.trip.id);
ok(r.untagged === 2 && s.trips().length === 2 && s.items().length === 4 && s.items().every((i) => i.tripId !== a.trip.id), 'store: deleting a trip keeps its markers (2 untagged)');

// ---------- export / import
const s2 = poi.createStore();
const t2 = s2.addTrip({ name: 'Trip X', country: 'JP', startDate: '2026-05-01', endDate: '2026-05-03' }).trip;
s2.add({ type: 'photo', name: 'Fuji', lat: 35.36, lon: 138.73, tripId: t2.id });
s2.add({ type: 'residence', name: 'Flat', lat: 1.3, lon: 103.8 });
const gj = poi.toGeoJSON(s2.items(), s2.trips());
ok(Array.isArray(gj.trips) && gj.trips.length === 1 && gj.trips[0].id === t2.id && gj.trips[0].country === 'JP', 'export: top-level trips array');
ok(gj.features.filter((x) => x.properties.tripId === t2.id).length === 1 && gj.features.every((x) => x.properties.type !== 'residence' || x.properties.tripId === undefined), 'export: tripId on tagged markers only');
ok(poi.toGeoJSON(s2.items()).trips === undefined, 'export: no trips key when there are none');
const back = poi.parseGeoJSON(JSON.stringify(gj));
ok(back.trips.length === 1 && back.trips[0].id === t2.id && back.items.find((i) => i.name === 'Fuji').tripId === t2.id, 'import: trips and tags survive an export/import round trip');
const s3 = poi.createStore();
const mr = s3.merge(back.items, back.trips);
ok(mr.added === 2 && mr.addedTrips === 1 && s3.trips().length === 1 && s3.items().find((i) => i.name === 'Fuji').tripId === t2.id, 'import: merge adds the trip and keeps the tag');
const mr2 = s3.merge(back.items, back.trips);
ok(mr2.added === 0 && mr2.addedTrips === 0 && s3.trips().length === 1, 'import: merging the same file again adds nothing');
const s4 = poi.createStore();
s4.merge(back.items, []);
ok(s4.items().every((i) => i.tripId === undefined), 'import: markers whose trip is not included arrive untagged');

// ---------- distance scoping
const it = (id, type, lat, lon, extra = {}) => ({ id, type, name: id, lat, lon, ...extra });
const m = 1 / 111195; // degrees of latitude per metre
const W = it('W', 'photo', 30, 114, { tripId: 'A' });
const set = [W,
  it('hA', 'hotel', 30 + 3000 * m, 114, { tripId: 'A' }), it('hB', 'hotel', 30 + 500 * m, 114, { tripId: 'B' }), it('hN', 'hotel', 30 + 800 * m, 114),
  it('pA', 'home', 30 + 4000 * m, 114, { tripId: 'A' }), it('pB', 'home', 30 + 600 * m, 114, { tripId: 'B' }),
  it('res', 'residence', 30 + 9000 * m, 114)];
let d = dist.nearestBases(W, set);
ok(d.hotel.found.item.id === 'hA' && d.home.found.item.id === 'pA', 'scope: a waypoint in trip A uses only trip A hotels and home points, ignoring closer ones in B or in no trip');
ok(d.residence.found.item.id === 'res', 'scope: Home is found whatever the trip');
d = dist.nearestBases(it('W2', 'photo', 30, 114), set);
ok(d.hotel.found.item.id === 'hN' && d.home.found === null && d.home.exists === true && d.home.inTrip === false, 'scope: a waypoint with no trip is measured only to bases with no trip');
d = dist.nearestBases(it('W3', 'photo', 30, 114, { tripId: 'C' }), set);
ok(d.hotel.found === null && d.hotel.exists === true && d.hotel.inTrip === false && d.home.found === null && d.home.inTrip === false, 'scope: a trip with no hotel or home point shows none');
d = dist.nearestBases(it('hx', 'hotel', 30, 114, { tripId: 'A' }), set);
ok(d.residence.found.item.id === 'res' && d.hotel.applies === false && d.home.applies === false, 'scope: a hotel gets only the Home line');
ok(dist.inSameTrip({ tripId: 'A' }, { tripId: 'A' }) && dist.inSameTrip({}, { tripId: undefined }) && !dist.inSameTrip({ tripId: 'A' }, {}), 'scope: inSameTrip treats a missing tripId as "no trip"');

// ---------- AI `trip` object
const reply = JSON.stringify({
  type: 'FeatureCollection',
  trip: { name: 'Wuhan weekend', country: 'China', startDate: '2026-11-12', endDate: '2026-11-14', description: 'Bridges and lakes' },
  features: [
    { type: 'Feature', properties: { name: 'Yangtze Bridge', type: 'photo' }, geometry: { type: 'Point', coordinates: [114.28, 30.55] } },
    { type: 'Feature', properties: { name: 'My flat', type: 'residence' }, geometry: { type: 'Point', coordinates: [103.8, 1.3] } },
  ],
});
const pr = ai.parseItinerary(reply);
ok(pr.trips.length === 1 && pr.trips[0].ref === '@trip' && pr.trips[0].country === 'CN' && pr.trips[0].name === 'Wuhan weekend', 'AI: the top-level trip is read, with its country as a code');
ok(pr.rows.find((x) => x.name === 'Yangtze Bridge').tripRef === '@trip' && pr.rows.find((x) => x.name === 'My flat').tripRef === null, 'AI: every row gets the trip, except a Home marker');
const none = ai.parseItinerary(JSON.stringify({ type: 'FeatureCollection', trip: { description: 'no name' }, features: [{ type: 'Feature', properties: { name: 'P', type: 'photo' }, geometry: { type: 'Point', coordinates: [114.28, 30.55] } }] }));
ok(none.trips.length === 0 && none.rows[0].tripRef === null, 'AI: a trip without a name is ignored');
const own = ai.parseItinerary(JSON.stringify(gj));
ok(own.trips.length === 1 && own.trips[0].ref === t2.id && own.rows.find((x) => x.name === 'Fuji').tripRef === t2.id, 'AI: this app\'s own export keeps each marker in its trip');

// ---------- bulk delete and undo (store)
const bs = poi.createStore();
const bt = bs.addTrip({ name: 'B' }).trip;
const ids = ['a', 'b', 'c', 'd', 'e'].map((n) => bs.add({ type: n === 'e' ? 'residence' : 'photo', name: n, lat: 1, lon: 2, tripId: n === 'b' ? bt.id : undefined }).item.id);
const order0 = bs.items().map((i) => i.name).join();
const rm = bs.removeMany([ids[1], ids[3], 'nope']);
ok(rm.ok && rm.removed.length === 2 && bs.items().length === 3 && bs.items().every((i) => ![ids[1], ids[3]].includes(i.id)), 'bulk: removeMany deletes the given markers and ignores unknown ids');
ok(bs.removeMany([]).removed.length === 0 && bs.removeMany(['nope']).removed.length === 0 && bs.items().length === 3, 'bulk: nothing to delete changes nothing');
const undone = bs.restore(rm.removed);
ok(undone.restored === 2 && bs.items().map((i) => i.name).join() === order0, 'bulk: restore puts the markers back in their original order');
ok(bs.items().find((i) => i.name === 'b').tripId === bt.id, 'bulk: a restored marker keeps its trip');
ok(bs.restore(rm.removed).restored === 0 && bs.items().length === 5, 'bulk: restoring twice adds nothing');
const rm2 = bs.removeMany([ids[1]]);
bs.removeTrip(bt.id);
bs.restore(rm2.removed);
ok(bs.items().find((i) => i.name === 'b').tripId === undefined, 'bulk: if the trip was deleted meanwhile, the restored marker comes back without it');
const all = bs.removeMany(bs.items().map((i) => i.id));
ok(bs.items().length === 0 && all.removed.length === 5 && bs.restore(all.removed).restored === 5 && bs.items().map((i) => i.name).join() === order0, 'bulk: deleting everything and undoing restores all five in order');

// ---------- new marker types
const nt = Object.fromEntries(poi.TYPES.map((t) => [t.id, t]));
ok(nt.train.label === 'Train station' && nt.airport.label === 'Airport', 'types: Train station and Airport exist');
ok(poi.sanitize({ type: 'train', name: 'x', lat: 1, lon: 2 }).type === 'train' && poi.sanitize({ type: 'airport', name: 'x', lat: 1, lon: 2 }).type === 'airport', 'types: both survive sanitize');
ok(dist.isWaypoint(it('s', 'train')) && dist.isWaypoint(it('s', 'airport')) && dist.needsDistance(it('s', 'airport')), 'types: both are waypoints with distances');
