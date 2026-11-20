// Route domain: leg derivation, route identity and invalidation, country gate, polylines, provider answer validation, fallback. No browser, no network.
import { chainOf, stopDates, selectionLegs } from '../src/route/legs.js';
import { routeKey, matchesLeg, PROFILE, ROUTE_SCHEMA } from '../src/route/identity.js';
import { countryOf, sameCountry } from '../src/route/country.js';
import { encodePolyline, decodePolyline, simplify, fitPoints } from '../src/route/polyline.js';
import { ineligibleReason, fallbackFor, readOrsGeoJson, roadFrom, MAX_ROUTE_M } from '../src/route/result.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const T = 't1';
let n = 0;
const mk = (id, date, order, lat, lon, extra = {}) => ({ id, type: 'photo', name: id, tripId: T, date, order, lat, lon, created: `2026-11-01T00:00:${String(n++).padStart(2, '0')}Z`, ...extra });
const hotel = (id, date, endDate, lat, lon) => ({ id, type: 'hotel', name: id, tripId: T, date, endDate, lat, lon, created: '2026-11-01T00:00:00Z' });
const drawn = () => true;
const ids = (legs) => legs.map((l) => l.id).join(' ');

// ---------- leg derivation
const items = [
  mk('a', '2026-11-10', 1, 30.60, 114.30), mk('b', '2026-11-10', 2, 30.70, 114.40), mk('c', '2026-11-10', 3, 30.80, 114.50),
  mk('d', '2026-11-11', 1, 31.00, 114.60), mk('e', '2026-11-11', 2, 31.10, 114.70),
  hotel('h', '2026-11-10', '2026-11-11', 30.82, 114.52),
  mk('s', '2026-11-10', 9, 30.65, 114.35, { isSub: true }),                    // a Side Quest: never in a chain
  { id: 'home', type: 'residence', tripId: T, date: '2026-11-10', order: 5, lat: 30, lon: 114, created: 'x' },
  mk('z', '2026-11-12', 1, 31.5, 115.0, { tripId: 'other' }),
];
ok(ids(chainOf(items, T, '2026-11-10').map((x) => ({ id: x.id }))) === 'a b c', 'a day chain is its main stops in order: no hotel, no Side Quest, no Home marker');
ok(stopDates(items, T).join() === '2026-11-10,2026-11-11', 'the days of a trip with stops');
let r = selectionLegs({ items, it: items[1], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'a>b b>c' && r.selected.every((l) => !l.overnight) && r.selected.filter((l) => l.bold).length === 2, 'a middle stop: both its chain legs are bold, no overnight leg');
r = selectionLegs({ items, it: items[0], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'a>b b>c' && r.selected[0].bold && !r.selected[1].bold && r.selected.every((l) => !l.overnight), 'the first stop of the first day: its own leg is bold, the rest of the day is thin, no overnight leg in (nothing before it)');
r = selectionLegs({ items, it: items[2], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'a>b b>c c>h' && r.selected[2].overnight && r.selected[2].bold && !r.selected[1].overnight, 'the last stop of a day leads to its night\'s hotel: an overnight leg');
r = selectionLegs({ items, it: items[3], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'd>e h>d' && r.selected.find((l) => l.id === 'h>d').overnight, 'the first stop of the next day follows the hotel of the night before');
r = selectionLegs({ items, it: items[5], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'a>b b>c c>h h>d' && r.selected.filter((l) => l.overnight).map((l) => l.id).join() === 'c>h,h>d', 'a selected hotel (the day chain stays thin): a leg in from the last stop of its day and out to the first stop of the day after checking out');
const noHotel = items.filter((i) => i.id !== 'h');
r = selectionLegs({ items: noHotel, it: noHotel[2], shownDay: null, tripDrawn: drawn });
ok(ids(r.selected) === 'a>b b>c c>d' && r.selected[2].overnight, 'with no hotel the last stop leads to the first stop of the next day');
r = selectionLegs({ items, it: items[1], shownDay: { tripId: T, date: '2026-11-11' }, tripDrawn: drawn });
ok(ids(r.day) === 'd>e' && r.day.every((l) => !l.bold), 'a day shown from the trips screen: all legs thin, separate from the selection');
r = selectionLegs({ items, it: items[1], shownDay: { tripId: T, date: '2026-11-11' }, tripDrawn: (t) => t !== T });
ok(r.day.length === 0 && r.selected.length === 0, 'a hidden trip draws no leg at all');
r = selectionLegs({ items, it: null, shownDay: null, tripDrawn: drawn });
ok(r.day.length === 0 && r.selected.length === 0, 'nothing selected, nothing drawn');
r = selectionLegs({ items, it: items[6], shownDay: null, tripDrawn: drawn });
ok(!r.selected.some((l) => l.id.includes('s')) && r.selected.every((l) => !l.bold && !l.overnight), 'a selected Side Quest is in no leg: its day chain is drawn thin');
const l1 = selectionLegs({ items, it: items[1], shownDay: null, tripDrawn: drawn }).selected[0];
ok(l1.from.id === 'a' && l1.to.id === 'b' && Object.keys(l1.from).sort().join() === 'id,lat,lon' && !('name' in l1.from), 'a leg carries only ids and coordinates (no names or notes can reach a provider)');

// ---------- identity and invalidation
const leg = (o = {}) => ({ from: { id: 'a', lat: 30.6, lon: 114.3, ...o.from }, to: { id: 'b', lat: 30.7, lon: 114.4, ...o.to } });
const k0 = routeKey(leg());
ok(k0 === routeKey(leg()) && k0.startsWith(`${PROFILE}|v${ROUTE_SCHEMA}|`), 'the key is stable and names profile and schema');
ok(k0 === routeKey(leg({ from: { lat: 30.600001 } })), 'a sub-metre shift keeps the key (no needless recalculation)');
ok(k0 !== routeKey(leg({ from: { lat: 30.6001 } })) && k0 !== routeKey(leg({ to: { lon: 114.401 } })), 'moving either endpoint by about 10 m changes the key');
ok(k0 !== routeKey({ from: leg().to, to: leg().from }), 'the reverse direction is a different leg');
ok(k0 !== routeKey(leg({ from: { id: 'x' } })) && k0 !== routeKey(leg(), 'driving-hgv') && k0 !== routeKey(leg(), PROFILE, ROUTE_SCHEMA + 1), 'a different marker, profile or schema version changes the key');
const cached = { key: k0, state: 'road' };
ok(matchesLeg(cached, leg()) && !matchesLeg(cached, leg({ to: { lat: 30.75 } })) && !matchesLeg(null, leg()), 'a cached route matches only the leg as it is now');
// unrelated legs keep their key when one marker moves
const before = [leg(), { from: { id: 'b', lat: 30.7, lon: 114.4 }, to: { id: 'c', lat: 30.8, lon: 114.5 } }].map((x) => routeKey(x));
const after = [leg({ from: { lat: 31 } }), { from: { id: 'b', lat: 30.7, lon: 114.4 }, to: { id: 'c', lat: 30.8, lon: 114.5 } }].map((x) => routeKey(x));
ok(before[0] !== after[0] && before[1] === after[1], 'moving marker a changes only the leg that starts at a; the b to c key is unchanged');
// reorder: the directed adjacency changes
const reordered = items.map((i) => (i.id === 'b' ? { ...i, order: 3 } : i.id === 'c' ? { ...i, order: 2 } : i));
const keys = (its) => selectionLegs({ items: its, it: its[0], shownDay: null, tripDrawn: drawn }).selected.map((x) => routeKey(x));
const kOld = selectionLegs({ items, it: items[0], shownDay: null, tripDrawn: drawn }).selected.map((x) => routeKey(x));
ok(kOld.join() !== keys(reordered).join(), 'reordering stops creates different directed legs, so different keys');
// a date change moves a marker to another day: its old leg no longer exists
const moved = items.map((i) => (i.id === 'c' ? { ...i, date: '2026-11-11', order: 3 } : i));
ok(!selectionLegs({ items: moved, it: moved[1], shownDay: null, tripDrawn: drawn }).selected.some((x) => x.id === 'b>c'), 'a marker moved to another day takes its leg with it');
ok(!selectionLegs({ items: items.filter((i) => i.id !== 'b'), it: items[0], shownDay: null, tripDrawn: drawn }).selected.some((x) => x.id.includes('b')), 'a deleted marker leaves no leg');

// ---------- country gate
const city = { beijing: [39.9, 116.4], shanghai: [31.23, 121.47], chengdu: [30.67, 104.07], kunming: [25.04, 102.7], lhasa: [29.65, 91.1], urumqi: [43.8, 87.6], harbin: [45.8, 126.6], wuhan: [30.6, 114.3], guangzhou: [23.1, 113.3], xian: [34.3, 108.9], haikou: [20.0, 110.3], sanya: [18.25, 109.5], kashgar: [39.47, 75.99], hongkong: [22.32, 114.17], dalian: [38.9, 121.6], xiamen: [24.5, 118.1], sg: [1.35, 103.82], sentosa: [1.25, 103.83] };
for (const [k, [la, lo]] of Object.entries(city)) ok(countryOf(la, lo) === (k === 'sg' || k === 'sentosa' ? 'SG' : 'CN'), `${k} is inside its country's outline`);
const out = { seoul: [37.57, 126.98], tokyo: [35.68, 139.7], hanoi: [21.03, 105.85], mongcai: [21.53, 107.97], vientiane: [17.97, 102.6], kathmandu: [27.7, 85.3], thimphu: [27.47, 89.64], ulaanbaatar: [47.9, 106.9], vladivostok: [43.1, 131.9], khabarovsk: [48.5, 135.1], almaty: [43.3, 76.9], bishkek: [42.87, 74.6], taipei: [25.03, 121.5], taichung: [24.15, 120.67], johor: [1.4927, 103.76], batam: [1.13, 104.03], yangon: [16.8, 96.15], delhi: [28.6, 77.2], bangkok: [13.75, 100.5] };
for (const [k, [la, lo]] of Object.entries(out)) ok(countryOf(la, lo) === null, `${k} is not claimed by any outline (unknown, no request)`);
ok(sameCountry({ lat: 39.9, lon: 116.4 }, { lat: 31.23, lon: 121.47 }) === 'CN' && sameCountry({ lat: 1.35, lon: 103.82 }, { lat: 1.28, lon: 103.85 }) === 'SG', 'two points in one country: same country');
ok(sameCountry({ lat: 1.35, lon: 103.82 }, { lat: 39.9, lon: 116.4 }) === null, 'Singapore to Beijing: not the same country');
ok(sameCountry({ lat: 39.9, lon: 116.4 }, { lat: 21.03, lon: 105.85 }) === null && countryOf(NaN, 1) === null, 'a point outside, or a bad coordinate: no country, no same-country');

// ---------- eligibility
const L = (a, b) => ({ from: { id: 'a', lat: a[0], lon: a[1] }, to: { id: 'b', lat: b[0], lon: b[1] } });
ok(ineligibleReason(L([30.6, 114.3], [30.7, 114.4])) === null, 'an ordinary same-country leg is eligible');
ok(ineligibleReason(L([30.6, 114.3], [30.6, 114.3])) === 'too-short', 'identical points are not routed');
ok(ineligibleReason(L([30.6, 114.3], [25.04, 102.7])) === null && ineligibleReason(L([39.9, 116.4], [18.25, 109.5])) === null, 'long domestic legs are eligible (Hainan included in the same country)');
ok(ineligibleReason(L([30.6, 114.3], [21.03, 105.85])) === 'country', 'a leg to a point outside the outlines: country, no request');
ok(ineligibleReason(L([1.35, 103.82], [39.9, 116.4])) !== null && ineligibleReason(L([1.35, 103.82], [30.6, 114.3])) !== null, 'a cross-country leg: no request');
ok(ineligibleReason({ from: { id: 'a', lat: NaN, lon: 1 }, to: { id: 'b', lat: 1, lon: 1 } }) === 'bad-coordinates' && ineligibleReason({ from: null, to: null }) === 'bad-coordinates', 'bad coordinates are rejected');
ok(MAX_ROUTE_M === 6_000_000, 'the provider distance limit used is 6,000 km');

// ---------- polylines
const pts = [[30.60001, 114.30002], [30.61234, 114.31456], [30.62, 114.3], [-33.86, 151.21], [0, 0], [-0.00001, -0.00002]];
const dec = decodePolyline(encodePolyline(pts));
ok(dec.length === pts.length && dec.every((p, i) => Math.abs(p[0] - pts[i][0]) < 1.1e-5 && Math.abs(p[1] - pts[i][1]) < 1.1e-5), 'a polyline round-trips to 5 decimals, including negatives and large jumps');
ok(decodePolyline('').length === 0 && decodePolyline(null).length === 0 && decodePolyline('~~~~~~~~~~~~').length === 0 && decodePolyline('abc').length === 0 && decodePolyline(5).length === 0, 'malformed polylines decode to nothing');
ok(decodePolyline(encodePolyline(pts), 3).length === 0, 'a polyline over the point cap is refused');
const line = Array.from({ length: 2000 }, (_, i) => [30 + i * 0.0001, 114 + Math.sin(i / 50) * 0.01]);
const fit = fitPoints(line, 300);
ok(fit.length <= 300 && fit[0] === line[0] && fit[fit.length - 1] === line[1999], 'simplifying keeps both end points and honours the point cap');
ok(simplify([[0, 0], [0, 1], [0, 2]], 0.0001).length === 2 && simplify([[0, 0]], 1).length === 1, 'a straight line collapses to its ends; a single point stays');

// ---------- provider answer validation
const L2 = L([30.6, 114.3], [30.7, 114.4]);
const good = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[114.3001, 30.6001], [114.35, 30.62], [114.3999, 30.6999]] }, properties: { summary: { distance: 15500, duration: 1300 } } }] };
let g = readOrsGeoJson(good, L2);
ok(g.coords[0][0] === 30.6001 && g.coords[0][1] === 114.3001 && g.distanceM === 15500 && g.durationS === 1300, 'a good answer: [lon,lat] becomes [lat,lon], distance and duration kept');
const bad = (mut) => { try { readOrsGeoJson(mut, L2); return 'accepted'; } catch (e) { return e.message; } };
const clone = () => JSON.parse(JSON.stringify(good));
ok(bad(null) === 'malformed' && bad({}) === 'malformed' && bad({ type: 'FeatureCollection', features: [] }) === 'malformed', 'no features: malformed');
let m = clone(); m.features[0].geometry.type = 'Point'; ok(bad(m) === 'malformed', 'a geometry that is not a LineString: malformed');
m = clone(); m.features[0].geometry.coordinates = [[114.3, 30.6]]; ok(bad(m) === 'malformed', 'a one-point route: malformed');
m = clone(); m.features[0].geometry.coordinates[1] = [114.35, 95]; ok(bad(m) === 'malformed', 'a latitude out of range: malformed (coordinate order is checked)');
m = clone(); m.features[0].geometry.coordinates[1] = ['x', 30.6]; ok(bad(m) === 'malformed', 'a non-numeric coordinate: malformed');
m = clone(); delete m.features[0].properties.summary; ok(bad(m) === 'malformed', 'no summary: malformed');
m = clone(); m.features[0].geometry.coordinates[0] = [115.0, 31.0]; ok(bad(m) === 'mismatch', 'a route that does not start at the leg start: mismatch');
m = clone(); m.features[0].geometry.coordinates[2] = [116.0, 31.5]; ok(bad(m) === 'mismatch', 'a route that does not end at the leg end: mismatch');
m = clone(); m.features[0].properties.summary.distance = 100; ok(bad(m) === 'implausible', 'a road distance far below the straight line: implausible');
m = clone(); m.features[0].properties.summary.distance = 7e6; ok(bad(m) === 'implausible', 'a distance over the provider limit: implausible');
m = clone(); m.features[0].properties.summary.duration = -5; ok(bad(m) === 'implausible', 'a negative duration: implausible');
m = clone(); m.features[0].properties.summary.distance = 'abc'; ok(bad(m) === 'malformed', 'a non-numeric distance: malformed');

// ---------- result states
const road = roadFrom(L2, g, 'cache');
ok(road.state === 'road' && road.key === routeKey(L2) && road.durationS === 1300 && road.source === 'cache', 'a road result carries the key, distance, duration and where it came from');
const fb = fallbackFor(L2, 'offline');
ok(fb.state === 'fallback' && fb.durationS === null && fb.coords.length === 2 && fb.reason === 'offline' && fb.distanceM > 14000 && fb.distanceM < 15500, 'a fallback is a straight line with the displacement and no duration');
ok(fb.state !== road.state && fb.distanceM !== road.distanceM, 'road and fallback are different states with different distances: never mislabelled');
