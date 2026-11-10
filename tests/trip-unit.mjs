import { ROOT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const poi = await load('src/poi.js');
const dist = await load('src/distance.js');
const ai = await load('src/aiimport.js');
const prefs = await load('src/prefs.js');

// ================= the Home marker (residence) versus the Home point
const byId = Object.fromEntries(poi.TYPES.map((t) => [t.id, t]));
ok(byId.home.label === 'Home point' && byId.residence.label === 'Home', 'the drone home point is labelled "Home point"; the residence is labelled "Home"');
ok(byId.home.glyph !== byId.residence.glyph && byId.home.color !== byId.residence.color, 'they differ in glyph and colour, so they cannot be confused');
ok(poi.pinSvg('home') !== poi.pinSvg('residence') && /M8\.6 6v10/.test(byId.home.glyph) && /M12 5\.2 6\.2 10\.2/.test(byId.residence.glyph), 'Home point is drawn as an "H", Home as a house');
ok(new Set(poi.TYPES.map((t) => t.color)).size === poi.TYPES.length && new Set(poi.TYPES.map((t) => t.glyph)).size === poi.TYPES.length, 'all eight types have their own colour and glyph');
ok(poi.TYPES.every((t) => typeof t.hint === 'string' && t.hint.length > 5), 'every type has a hint (shown as a tooltip)');
ok(/not the drone's home point/.test(byId.residence.hint) && /home point/i.test(byId.home.hint), 'the hints spell out the difference');
ok(poi.typeOf('residence').label === 'Home' && poi.typeOf('nonsense').id === 'other', 'residence is a known type; unknown types still fall back to other');
const prompt = fs.readFileSync(path.join(ROOT, 'public/ai/prompt.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/ai/schema.json'), 'utf8'));
ok(poi.TYPES.every((t) => prompt.includes(`"${t.id}"`)) && JSON.stringify(schema.$defs.feature.properties.properties.properties.type.enum) === JSON.stringify(poi.TYPES.map((t) => t.id)), 'prompt.md and schema.json list all eight types, in the app\'s order');
ok(/NOT the drone's home point/.test(prompt) && /never guess an address/.test(prompt), 'the prompt tells an AI the difference and not to guess an address');
ok(/endDate/.test(prompt) && /YYYY-MM-DD/.test(prompt) && /Do not guess the year/.test(prompt) && /Never invent them/.test(prompt), 'the prompt covers date and endDate: ISO form, never guess the year, never invent');
const props = schema.$defs.feature.properties.properties;
ok(props.properties.date && props.properties.endDate && !props.required.includes('date') && !props.required.includes('endDate'), 'schema: date and endDate exist and are optional');
const ex = ai.parseItinerary(fs.readFileSync(path.join(ROOT, 'public/ai/example.geojson'), 'utf8'));
ok(ex.rows[0].date === '2026-11-12' && ex.rows[0].endDate === '2026-11-14' && ex.rows[1].date === '2026-11-13' && ex.rows[1].endDate === null, 'example.geojson carries a date range and a single date');

// ================= dates
ok(poi.isoDate('2026-11-12') === '2026-11-12' && poi.isoDate('2024-02-29') === '2024-02-29', 'real dates are accepted, including a leap day');
ok(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '2026-4-5', '12 Nov 2026', 'Nov 12', '2026/11/12', '20261112', '', ' ', null, undefined, 20261112, {}, '1999-12-31', '2101-01-01', '2026-11-12abc'].every((v) => poi.isoDate(v) === null), 'impossible or oddly formatted dates are refused, never guessed (30 Feb, month 13, 29 Feb in a non-leap year, other formats, years outside 2000–2100)');
ok(poi.isoDate('2026-11-12T08:30:00Z') === '2026-11-12' && poi.isoDate('2026-11-12 08:30') === '2026-11-12' && poi.isoDate(' 2026-11-12 ') === '2026-11-12', 'a date-time keeps its date part; spaces around are fine');
const base = { type: 'photo', name: 'N', note: '', lat: 1, lon: 2 };
const s1 = poi.sanitize({ ...base, date: '2026-11-12', endDate: '2026-11-14' });
ok(s1.date === '2026-11-12' && s1.endDate === '2026-11-14', 'start and end date are kept');
ok(!('endDate' in poi.sanitize({ ...base, endDate: '2026-11-14' })) && !('date' in poi.sanitize({ ...base, endDate: '2026-11-14' })), 'an end date with no start date is dropped');
ok(!('endDate' in poi.sanitize({ ...base, date: '2026-11-12', endDate: '2026-11-12' })), 'an end date equal to the start is just a single day');
ok(!('endDate' in poi.sanitize({ ...base, date: '2026-11-12', endDate: '2026-11-10' })) && poi.sanitize({ ...base, date: '2026-11-12', endDate: '2026-11-10' }).date === '2026-11-12', 'an end date before the start is dropped (the start is kept)');
ok(!('date' in poi.sanitize({ ...base, date: '2026-02-30', endDate: '2026-03-02' })) && !('endDate' in poi.sanitize({ ...base, date: '2026-02-30', endDate: '2026-03-02' })), 'an invalid start date removes the end date too');
ok(Object.keys(poi.sanitize({ ...base })).sort().join() === 'created,id,lat,lon,name,note,type', 'a marker with no optional fields still has exactly the original 7 fields');
ok(!('date' in poi.sanitize({ ...base, date: null })) && !('date' in poi.sanitize({ ...s1, date: null })), 'null clears a date (and so its end date)');
const gj = poi.toGeoJSON([s1, poi.sanitize(base)]);
ok(gj.features[0].properties.date === '2026-11-12' && gj.features[0].properties.endDate === '2026-11-14' && !('date' in gj.features[1].properties), 'export includes dates only where set');
const rt = poi.parseGeoJSON(JSON.stringify(gj)).items;
ok(rt[0].date === '2026-11-12' && rt[0].endDate === '2026-11-14' && rt[1].date === undefined, 'file import round-trips both dates');
const row = (p) => ai.parseItinerary(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [114, 30] }, properties: { name: 'x', ...p } }] })).rows[0];
ok(row({ date: '2026-11-12', endDate: '2026-11-14' }).endDate === '2026-11-14' && row({ date: '2026-11-12' }).endDate === null && row({}).date === null, 'AI import: both dates, one date, or none');
ok(row({ endDate: '2026-11-14' }).endDate === null && row({ date: '2026-11-12', endDate: '2026-11-11' }).endDate === null && row({ date: 'next Tuesday' }).date === null && row({ date: '2026-02-30' }).date === null && row({ date: 20261112 }).date === null, 'AI import: end without start, end before start, vague or impossible dates are all dropped');
ok(row({ date: '2026-11-12T00:00:00' }).date === '2026-11-12', 'AI import: a date-time keeps its date');

// ================= list order and headings
const mk = (name, extra, t) => ({ name, type: 'photo', ...extra, created: new Date(Date.UTC(2026, 0, t)).toISOString() });
ok(poi.listMode([mk('a', {}, 1)]) === 'plain' && poi.listMode([mk('a', { day: 1 }, 1)]) === 'day' && poi.listMode([mk('a', { day: 1 }, 1), mk('b', { date: '2026-11-12' }, 2)]) === 'date', 'list mode: plain, then day, then date takes precedence');
const dated = poi.sortForList([mk('later', { date: '2026-11-14' }, 1), mk('none', {}, 9), mk('first-o2', { date: '2026-11-12', order: 2 }, 2), mk('first-o1', { date: '2026-11-12', order: 1 }, 3), mk('first-day1', { date: '2026-11-12', day: 1, order: 5 }, 4), mk('first-noorder', { date: '2026-11-12' }, 5)]);
ok(dated.map((i) => i.name).join() === 'first-day1,first-o1,first-o2,first-noorder,later,none', 'by date, then day, then stop; unnumbered after numbered; undated last: ' + dated.map((i) => i.name).join());
ok(poi.sortForList([mk('d2', { day: 2 }, 1), mk('d1', { day: 1 }, 2), mk('x', {}, 3)]).map((i) => i.name).join() === 'd1,d2,x', 'no dates: still by day (unchanged behaviour)');
ok(poi.sortForList([mk('old', {}, 1), mk('new', {}, 3)]).map((i) => i.name).join() === 'new,old', 'nothing planned: newest first (unchanged behaviour)');
ok(poi.groupLabel(mk('a', { date: '2026-11-12' }, 1), 'date').includes('12') && poi.groupLabel(mk('a', {}, 1), 'date') === 'No date set' && poi.groupLabel(mk('a', { day: 3 }, 1), 'day') === 'Day 3' && poi.groupLabel(mk('a', {}, 1), 'day') === 'No day set' && poi.groupLabel(mk('a', {}, 1), 'plain') === '', 'group headings: date, "No date set", Day N, "No day set", none in a plain list');
const yr = new Date().getUTCFullYear();
ok(!poi.dateLabel({ date: `${yr}-11-12` }).includes(String(yr)) && poi.dateLabel({ date: '2031-11-12' }).includes('2031') && poi.dateLabel({ date: '' }) === '', 'the year is shown only when it is not this year');
const range = poi.dateLabel({ date: `${yr}-11-12`, endDate: `${yr}-11-14` });
ok(range.includes('–') && range.includes('12') && range.includes('14'), 'a range reads "start – end": ' + range);
ok(poi.dateLabel({ date: `${yr}-12-30`, endDate: `${yr + 1}-01-02` }).split('–').every((p) => /20\d\d/.test(p)), 'a range crossing a year shows the year on both ends');

// ================= distance maths
const WUHAN = [30.5928, 114.3055], BEIJING = [39.9042, 116.4074], SG = [1.3521, 103.8198], KL = [3.1390, 101.6869];
const wb = dist.haversineM(...WUHAN, ...BEIJING) / 1000, sk = dist.haversineM(...SG, ...KL) / 1000;
ok(near(wb, 1052.8, 2), `Wuhan to Beijing is 1,052.8 km (north 1,035.4 km and east 190.9 km, worked out by hand): ${wb.toFixed(1)}`);
ok(near(sk, 309.3, 1.5), `Singapore to Kuala Lumpur is 309.3 km (198.7 km north and 237.0 km east, worked out by hand): ${sk.toFixed(1)}`);
ok(near(dist.haversineM(0, 0, 1, 0), 111195, 200) && near(dist.haversineM(0, 0, 0, 90), 10007543, 3000), 'one degree of latitude is 111.2 km; a quarter of the equator is 10,007.5 km');
ok(dist.haversineM(30, 114, 30, 114) === 0 && near(dist.haversineM(10, 20, 11, 22), dist.haversineM(11, 22, 10, 20), 1e-6), 'zero for the same point; symmetric');
ok(near(dist.haversineM(0, 179.9, 0, -179.9), dist.haversineM(0, 0, 0, 0.2), 5), 'distances across the date line are short, not the long way round');
ok(near(dist.bearingDeg(0, 0, 1, 0), 0, 0.01) && near(dist.bearingDeg(0, 0, 0, 1), 90, 0.01) && near(dist.bearingDeg(0, 0, -1, 0), 180, 0.01) && near(dist.bearingDeg(0, 0, 0, -1), 270, 0.01), 'bearings: north 0, east 90, south 180, west 270');
ok(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].every((d, i) => dist.compass(i * 45) === d) && dist.compass(359) === 'N' && dist.compass(22) === 'N' && dist.compass(23) === 'NE' && dist.compass(337) === 'NW' && dist.compass(338) === 'N', 'compass points and their boundaries');
ok(dist.compass(dist.bearingDeg(...WUHAN, ...BEIJING)) === 'N' && dist.compass(dist.bearingDeg(...SG, ...KL)) === 'NW', 'Beijing is north of Wuhan; Kuala Lumpur is north-west of Singapore');

// ================= formatting and units
const f = dist.fmtDistance;
ok(f(4) === '<10 m' && f(12) === '10 m' && f(850) === '850 m' && f(999) === '1000 m' && f(1000) === '1.0 km' && f(1234) === '1.2 km' && f(9949) === '9.9 km' && f(14600) === '15 km' && f(250000) === '250 km', 'metric: m below 1 km, km with one decimal below 10 km, whole km above');
ok(f(5, 'imperial') === '<30 ft' && f(100, 'imperial') === '330 ft' && f(300, 'imperial') === '980 ft' && f(1609.344, 'imperial') === '1.0 mi' && f(1300, 'imperial') === '0.8 mi' && f(20000, 'imperial') === '12 mi', 'imperial: ft below 1000 ft, miles above');
ok(near(dist.toDisplay(5000, 'metric'), 5, 1e-9) && near(dist.toDisplay(1609.344, 'imperial'), 1, 1e-9) && near(dist.fromDisplay(5, 'metric'), 5000, 1e-6) && near(dist.fromDisplay(dist.toDisplay(12345, 'imperial'), 'imperial'), 12345, 1e-6), 'km and mile conversions round-trip');

// ================= dates matching, and the nearest home point / hotel
const it = (id, type, lat, lon, extra = {}) => ({ id, type, name: id, lat, lon, ...extra });
const m = 1 / 111195; // a metre, in degrees of latitude
ok(dist.datesMatch({ date: '2026-11-12' }, { date: '2026-11-12' }) && dist.datesMatch({ date: '2026-11-13' }, { date: '2026-11-12', endDate: '2026-11-14' }) && dist.datesMatch({ date: '2026-11-10', endDate: '2026-11-12' }, { date: '2026-11-12', endDate: '2026-11-14' }), 'dates match when the ranges overlap, including touching on one day');
ok(!dist.datesMatch({ date: '2026-11-15' }, { date: '2026-11-12', endDate: '2026-11-14' }) && !dist.datesMatch({ date: '2026-11-10' }, { date: '2026-11-12' }), 'dates do not match when they do not overlap');
ok(dist.datesMatch({}, { date: '2026-11-12' }) && dist.datesMatch({ date: '2026-11-12' }, {}) && dist.datesMatch({}, {}), 'a marker without a date matches anything (an undated hotel applies to the whole trip)');
ok(!dist.needsDistance(it('a', 'residence')) && ['home', 'hotel', 'takeoff', 'landing', 'photo', 'hazard', 'other'].every((t) => dist.needsDistance(it('a', t))), 'every marker shows a distance (to Home) except the Home marker itself');
ok(['takeoff', 'landing', 'photo', 'hazard', 'other'].every((t) => dist.isWaypoint(it('a', t))) && ['home', 'hotel', 'residence'].every((t) => !dist.isWaypoint(it('a', t))), 'waypoints are everything except Home points, hotels and the Home marker');
const baseOf = (id) => dist.BASE_TYPES.find((b) => b.id === id);
ok(dist.lineApplies(it('a', 'photo'), baseOf('home')) && dist.lineApplies(it('a', 'photo'), baseOf('hotel')) && dist.lineApplies(it('a', 'photo'), baseOf('residence')), 'a waypoint gets all three lines');
ok(!dist.lineApplies(it('a', 'hotel'), baseOf('home')) && !dist.lineApplies(it('a', 'hotel'), baseOf('hotel')) && dist.lineApplies(it('a', 'hotel'), baseOf('residence')) && !dist.lineApplies(it('a', 'home'), baseOf('hotel')) && dist.lineApplies(it('a', 'home'), baseOf('residence')), 'a hotel or a home point gets only the Home line');
ok(dist.BASE_TYPES.map((t) => t.id).join() === 'home,hotel,residence', 'waypoints are measured to Home points, Hotels and the Home marker, in that order');
ok(dist.BASE_TYPES.map((t) => t.launch).join() === 'true,true,false' && dist.BASE_TYPES.map((t) => t.short).join() === 'home point,hotel,home', 'Home points and Hotels are launch bases; the Home marker is not');

const W = it('W', 'photo', 30, 114);
const items = [
  W,
  it('hp-near', 'home', 30 + 500 * m, 114),         //  500 m north
  it('hp-far', 'home', 30 + 5000 * m, 114),         // 5 km north
  it('hotel-a', 'hotel', 30 - 2000 * m, 114, { date: '2026-11-10', endDate: '2026-11-12' }), // 2 km south, 10–12 Nov
  it('hotel-b', 'hotel', 30 + 3000 * m, 114, { date: '2026-11-12', endDate: '2026-11-15' }), // 3 km north, 12–15 Nov
  it('hotel-undated', 'hotel', 30 + 9000 * m, 114),  // 9 km, no dates
  it('home-marker', 'residence', 30 + 10 * m, 114),  // 10 m away: the residence, reported on its own line, never as a home point or hotel
];
let r = dist.nearestBases(W, items);
ok(r.home.found.item.id === 'hp-near' && near(r.home.found.m, 500, 2), 'nearest home point: the closer of two (500 m), not the farther');
ok(r.hotel.found.item.id === 'hotel-a' && near(r.hotel.found.m, 2000, 4), 'undated waypoint: nearest hotel regardless of dates (2 km)');
ok(r.nearestM !== null && near(r.nearestM, 500, 2), 'nearestM is the shorter of the home point and hotel distances; the 10 m Home marker does not pull it down');
ok(r.home.found.item.id !== 'home-marker' && r.hotel.found.item.type === 'hotel', 'the Home marker is never mistaken for a home point or a hotel, even when it is the closest thing');
ok(r.residence.exists && r.residence.found.item.id === 'home-marker' && near(r.residence.found.m, 10, 1), 'the Home marker has its own line: found at 10 m');
const away = dist.nearestBases(W, [W, it('res-far', 'residence', 30 + 800000 * m, 114), it('res-near', 'residence', 30 + 4000 * m, 114)]);
ok(away.residence.found.item.id === 'res-near' && !away.home.exists && !away.hotel.exists && away.nearestM === null, 'with only Home markers saved: the nearer Home is found, and there is no launch base, so nearestM is null');
ok(dist.beyondRange(dist.nearestBases({ ...W, lat: 31, lon: 114.5 }, [{ ...W, lat: 31, lon: 114.5 }, it('hp', 'home', 30, 114), it('res', 'residence', 31.0005, 114.5005)]), 10000) === true, 'a waypoint 100 km from its home point but 70 m from the Home marker is still beyond a 10 km range (Home does not count)');
const dres = dist.nearestBases({ ...W, date: '2026-11-13' }, [W, it('r1', 'residence', 30.01, 114, { date: '2026-11-01', endDate: '2026-11-05' }), it('r2', 'residence', 30.02, 114)]);
ok(dres.residence.found.item.id === 'r1', 'the Home marker ignores dates: the nearer Home is used even if it is dated outside the waypoint\'s dates');
const noDates = dist.nearestBases({ ...W, date: '2026-11-13' }, [W, it('r1', 'residence', 30.01, 114, { date: '2026-11-01', endDate: '2026-11-05' })]);
ok(noDates.residence.exists && noDates.residence.found !== null, 'a Home is always found when one exists: it is not tied to dates');
r = dist.nearestBases({ ...W, date: '2026-11-13' }, items);
ok(r.hotel.found.item.id === 'hotel-b' && near(r.hotel.found.m, 3000, 6), 'waypoint on 13 Nov: only hotel-b (12–15 Nov) overlaps, so it is chosen over the closer hotel-a (10–12 Nov)');
r = dist.nearestBases({ ...W, date: '2026-11-11' }, items);
ok(r.hotel.found.item.id === 'hotel-a', 'waypoint on 11 Nov: hotel-a (10–12 Nov), the closer one, and also the only dated match');
r = dist.nearestBases({ ...W, date: '2026-11-12' }, items);
ok(r.hotel.found.item.id === 'hotel-a', 'waypoint on 12 Nov: both hotels overlap (the checkout/check-in day), the nearer one wins');
r = dist.nearestBases({ ...W, date: '2026-12-25' }, items);
ok(r.hotel.found.item.id === 'hotel-undated', 'waypoint on a date no dated hotel covers: the undated hotel still counts (9 km)');
const datedOnly = items.filter((i) => i.id !== 'hotel-undated');
r = dist.nearestBases({ ...W, date: '2026-12-25' }, datedOnly);
ok(r.hotel.found === null && r.hotel.exists === true && r.home.found.item.id === 'hp-near', 'no hotel covers the date: found is null but exists is true (so the UI can say "none for these dates"); the home point is unaffected');
r = dist.nearestBases(W, [W, it('hp', 'home', 30.01, 114)]);
ok(r.hotel.exists === false && r.hotel.found === null && r.home.found !== null, 'no hotel saved at all: exists is false');
r = dist.nearestBases(W, [W]);
ok(!r.home.exists && !r.hotel.exists && r.nearestM === null, 'no bases at all: nothing to measure');
r = dist.nearestBases({ ...W, date: '2026-11-12', endDate: '2026-11-13' }, items);
ok(r.hotel.found.item.id === 'hotel-a', 'a waypoint with its own date range also matches by overlap');
r = dist.nearestBases(W, [W, it('u', 'hotel', 30.001, 114, { unverified: true })]);
ok(r.hotel.found.approx === true, 'a base with an unverified location makes the distance approximate');
r = dist.nearestBases({ ...W, unverified: true }, [W, it('h', 'hotel', 30.001, 114)]);
ok(r.hotel.found.approx === true, '... and so does an unverified waypoint');
r = dist.nearestBases(W, [W, it('h', 'hotel', 30.001, 114)]);
ok(r.hotel.found.approx === false, 'both verified: not approximate');
r = dist.nearestBases(it('p1', 'photo', 30, 114), [it('p1', 'photo', 30, 114), it('hp2', 'home', 30.01, 114)]);
ok(r.home.found.item.id === 'hp2', 'a marker is never its own nearest neighbour');
r = dist.nearestBases(it('hp1', 'home', 30, 114), [it('hp1', 'home', 30, 114), it('res', 'residence', 30.01, 114)]);
ok(r.residence.found.item.id === 'res', 'a home point still finds the Home marker');
const tie = dist.nearestBases(W, [W, it('t1', 'hotel', 30 + 1000 * m, 114), it('t2', 'hotel', 30 - 1000 * m, 114)]);
ok(['t1', 't2'].includes(tie.hotel.found.item.id) && near(tie.hotel.found.m, 1000, 3), 'equal distances: one of the two is chosen, without error');
ok(dist.beyondRange({ nearestM: 6000 }, 5000) === true && dist.beyondRange({ nearestM: 4000 }, 5000) === false && dist.beyondRange({ nearestM: 5000 }, 5000) === false && dist.beyondRange({ nearestM: null }, 5000) === false && dist.beyondRange({ nearestM: 6000 }, null) === false, 'beyond range: only when the nearest of all bases is over the limit; never with no limit or no bases');
const far = dist.nearestBases(it('Wf', 'photo', 30.5, 114), [it('Wf', 'photo', 30.5, 114), it('hp', 'home', 30, 114), it('ho', 'hotel', 31.5, 114)]);
ok(dist.beyondRange(far, 40000) === true && dist.beyondRange(far, 60000) === false, 'beyond range uses the nearest base: home point 55 km away, hotel 111 km away: over 40 km yes, over 60 km no');

// ================= saved settings
ok(JSON.stringify([prefs.loadPrefs()]) !== undefined, 'prefs module loads without a browser');
console.log('done');
