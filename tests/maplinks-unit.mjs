// Coordinates, the China outline and the Google Maps / Amap links. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const near = (a, b, t) => Math.abs(a - b) <= t;

const C = await load('src/coords.js');
const L = await load('src/maplinks.js');

// ---------- inside China
const places = [['Wuhan', 30.5928, 114.3055, true], ['Beijing', 39.9042, 116.4074, true], ['Hong Kong (Kowloon)', 22.3193, 114.1694, true], ['Macao', 22.1987, 113.5439, true],
  ['Sanya (Hainan)', 18.2528, 109.512, true], ['Urumqi', 43.8256, 87.6168, true], ['Lhasa', 29.65, 91.1, true], ['Harbin', 45.8, 126.53, true],
  ['Taipei', 25.033, 121.5654, false], ['Singapore', 1.3521, 103.8198, false], ['Tokyo', 35.68, 139.69, false], ['Ulaanbaatar', 47.9, 106.9, false],
  ['Hanoi', 21.03, 105.85, false], ['Seoul', 37.5665, 126.978, false], ['Bangkok', 13.75, 100.5, false], ['London', 51.5, -0.12, false], ['Null Island', 0, 0, false]];
for (const [n, la, lo, want] of places) ok(C.inChina(la, lo) === want, `China outline: ${n} is ${want ? '' : 'not '}in China`);

// ---------- GCJ-02
const w = { lat: 30.5928, lon: 114.3055 };
const g = C.wgs84ToGcj02(w);
const shift = Math.hypot((g.lat - w.lat) * 111000, (g.lon - w.lon) * 96000);
ok(shift > 400 && shift < 800, 'GCJ-02: Wuhan shifts by roughly 590 m (' + Math.round(shift) + ' m)');
const back = C.gcj02ToWgs84(g);
ok(Math.hypot((back.lat - w.lat) * 111000, (back.lon - w.lon) * 96000) < 0.5, 'GCJ-02: converting there and back lands within half a metre');
for (const [la, lo] of [[39.9042, 116.4074], [22.3193, 114.1694], [43.8256, 87.6168], [18.2528, 109.512]]) {
  const b = C.gcj02ToWgs84(C.wgs84ToGcj02({ lat: la, lon: lo }));
  ok(Math.hypot((b.lat - la) * 111000, (b.lon - lo) * 96000) < 0.5, `GCJ-02: round trip at ${la}, ${lo}`);
}
const sg = C.wgs84ToGcj02({ lat: 1.3521, lon: 103.8198 });
ok(sg.lat === 1.3521 && sg.lon === 103.8198, 'GCJ-02: outside China nothing changes');
ok(Math.abs(C.wgs84ToGcj02({ lat: 39.9042, lon: 116.4074 }).lat - 39.9059) < 0.0015 && Math.abs(C.wgs84ToGcj02({ lat: 39.9042, lon: 116.4074 }).lon - 116.4137) < 0.0015, 'GCJ-02: Beijing (Tiananmen) lands where the published offset puts it (about 39.9059, 116.4137)');

// ---------- which apps
const wuhan = { lat: 30.5928, lon: 114.3055, name: 'Yellow Crane Tower' }, singapore = { lat: 1.2894, lon: 103.8500, name: 'Marina Bay' }, beijing = { lat: 39.9163, lon: 116.3972, name: 'Forbidden City' };
ok(L.appsFor([wuhan]).join() === 'amap,google', 'apps: a place in China gets Amap first, then Google Maps');
ok(L.appsFor([singapore]).join() === 'google', 'apps: a place outside China gets Google Maps only');
ok(L.appsFor([wuhan, beijing]).join() === 'amap,google' && L.appsFor([wuhan, singapore]).join() === 'google' && L.appsFor([]).join() === 'google', 'apps: a route needs every stop in China for Amap; a mixed route is Google Maps only');

// ---------- one place
let u = L.placeUrl('google', wuhan);
ok(u === 'https://www.google.com/maps/search/?api=1&query=30.592800%2C114.305500', 'Google place link: api=1, query=lat%2Clon: ' + u);
u = L.placeUrl('amap', wuhan);
ok(u.startsWith('https://uri.amap.com/marker?position=114.305500,30.592800&') && /name=Yellow%20Crane%20Tower/.test(u) && /coordinate=wgs84/.test(u) && /src=uav-companion/.test(u) && /callnative=1/.test(u), 'Amap place link: position is lon,lat, with the name, coordinate=wgs84, src and callnative: ' + u);
ok(/name=%E9%BB%84%E9%B9%A4%E6%A5%BC/.test(L.placeUrl('amap', { ...wuhan, name: '黄鹤楼' })), 'Amap place link: a Chinese name is percent-encoded');
ok(!/name=/.test(L.placeUrl('amap', { ...wuhan, name: '' })), 'Amap place link: no name, no name parameter');
ok(!/&name=[^&]*[&]x/.test(L.placeUrl('amap', { ...wuhan, name: 'A&B=C?D#E' })) && /name=A%26B%3DC%3FD%23E/.test(L.placeUrl('amap', { ...wuhan, name: 'A&B=C?D#E' })), 'Amap place link: & = ? # in a name cannot break the link');
ok(L.placeUrl('amap', { ...wuhan, name: 'a'.repeat(200) }).length < 400, 'Amap place link: a very long name is cut');

// ---------- directions here
u = L.hereUrl('google', singapore, 'walk');
ok(u === 'https://www.google.com/maps/dir/?api=1&destination=1.289400%2C103.850000&travelmode=walking', 'Google directions here: destination only (the start is the device), travelmode walking: ' + u);
u = L.hereUrl('amap', wuhan, 'drive');
const gw = C.wgs84ToGcj02(wuhan);
ok(u.startsWith('https://uri.amap.com/navigation?to=') && u.includes(`to=${gw.lon.toFixed(6)},${gw.lat.toFixed(6)},Yellow%20Crane%20Tower`) && !/from=/.test(u) && /mode=car/.test(u) && /callnative=1/.test(u), 'Amap directions here: no start, the destination in GCJ-02, mode=car: ' + u);
ok(/travelmode=driving/.test(L.hereUrl('google', wuhan)) && /travelmode=transit/.test(L.hereUrl('google', wuhan, 'transit')) && /travelmode=bicycling/.test(L.hereUrl('google', wuhan, 'bike')), 'directions here: the modes map to Google\'s names (driving, transit, bicycling)');
ok(/mode=bus/.test(L.hereUrl('amap', wuhan, 'transit')) && /mode=walk/.test(L.hereUrl('amap', wuhan, 'walk')) && /mode=ride/.test(L.hereUrl('amap', wuhan, 'bike')) && /mode=car/.test(L.hereUrl('amap', wuhan, 'nonsense')), 'directions here: and to Amap\'s (bus, walk, ride); an unknown mode means driving');

// ---------- chunking
const mk = (n) => Array.from({ length: n }, (_, i) => ({ lat: 30 + i * 0.01, lon: 114 + i * 0.01, name: `S${i + 1}` }));
ok(JSON.stringify(L.chunk(mk(5), 5).map((c) => c.length)) === '[5]' && JSON.stringify(L.chunk(mk(6), 5).map((c) => c.map((s) => s.name).join(''))) === '["S1S2S3S4S5","S5S6"]', 'chunks: pieces overlap by one stop, so the legs join up');
ok(JSON.stringify(L.chunk(mk(9), 5).map((c) => c.map((s) => s.name).join(''))) === '["S1S2S3S4S5","S5S6S7S8S9"]' && L.chunk(mk(10), 5).length === 3, 'chunks: nine stops make two pieces of five, ten make three');
ok(L.chunk(mk(2), 2).length === 1 && L.chunk(mk(3), 2).length === 2, 'chunks: pairs');

// ---------- routes
let r = L.routeUrls('google', mk(4), 'drive', { mobile: false });
ok(r.parts.length === 1 && r.parts[0].label === 'Open in Google Maps' && r.note === '', 'Google route: four stops are one link');
u = r.parts[0].url;
ok(u.startsWith('https://www.google.com/maps/dir/?api=1&origin=30.000000%2C114.000000&destination=30.030000%2C114.030000&travelmode=driving&waypoints=30.010000%2C114.010000%7C30.020000%2C114.020000'), 'Google route: origin, destination and the stops between them joined with %7C, in order: ' + u);
r = L.routeUrls('google', mk(11), 'drive', { mobile: false });
ok(r.parts.length === 1 && r.parts[0].url.length < 2048 && (r.parts[0].url.match(/%7C/g) || []).length === 8, 'Google route: 11 stops (9 between) on a desktop is one link, well under the 2,048-character limit (' + r.parts[0].url.length + ')');
r = L.routeUrls('google', mk(12), 'drive', { mobile: false });
ok(r.parts.length === 2 && /part 1: S1 → S11/.test(r.parts[0].label) && /part 2: S11 → S12/.test(r.parts[1].label) && /9 stops/.test(r.note), 'Google route: 12 stops on a desktop is two parts sharing S11, with a note');
r = L.routeUrls('google', mk(5), 'drive', { mobile: true });
ok(r.parts.length === 1, 'Google route: on a phone, 5 stops (3 between) is still one link');
r = L.routeUrls('google', mk(6), 'drive', { mobile: true });
ok(r.parts.length === 2 && /3 stops/.test(r.note) && /on a phone/.test(r.note), 'Google route: on a phone, 6 stops is two parts');
r = L.routeUrls('google', mk(3), 'transit');
ok(/travelmode=transit/.test(r.parts[0].url), 'Google route: travel mode is passed on');

const cn = [{ lat: 30.5928, lon: 114.3055, name: 'Yellow Crane Tower' }, { lat: 30.5446, lon: 114.3025, name: 'East Lake' }, { lat: 30.6, lon: 114.4, name: 'Airport' }, { lat: 30.7, lon: 114.2, name: 'Hotel' }];
r = L.routeUrls('amap', cn.slice(0, 3), 'drive');
u = r.parts[0].url;
const g1 = C.wgs84ToGcj02(cn[0]), g2 = C.wgs84ToGcj02(cn[1]), g3 = C.wgs84ToGcj02(cn[2]);
ok(r.parts.length === 1 && u.includes(`from=${g1.lon.toFixed(6)},${g1.lat.toFixed(6)},Yellow%20Crane%20Tower`) && u.includes(`via=${g2.lon.toFixed(6)},${g2.lat.toFixed(6)},East%20Lake`) && u.includes(`to=${g3.lon.toFixed(6)},${g3.lat.toFixed(6)},Airport`) && /mode=car/.test(u) && /src=uav-companion/.test(u), 'Amap route: three stops driving is one link with from, via and to, in GCJ-02 (lon,lat): ' + u);
r = L.routeUrls('amap', cn, 'drive');
ok(r.parts.length === 2 && /part 1: Yellow Crane Tower → Airport/.test(r.parts[0].label) && /part 2: Airport → Hotel/.test(r.parts[1].label) && /one stop/.test(r.note) && !/via=/.test(r.parts[1].url), 'Amap route: four stops driving need two parts (Amap takes one via point): the second has no via');
r = L.routeUrls('amap', cn.slice(0, 3), 'transit');
ok(r.parts.length === 2 && /mode=bus/.test(r.parts[0].url) && !/via=/.test(r.parts.map((p) => p.url).join('')) && /each leg/.test(r.note), 'Amap route: by public transport there is no via point, so each leg opens on its own');
r = L.routeUrls('amap', cn.slice(0, 2), 'bike');
ok(r.parts.length === 1 && /mode=ride/.test(r.parts[0].url) && /phone app only/.test(r.note), 'Amap route: bike is mode=ride, with a note that it needs the phone app');
ok(L.routeUrls('amap', [{ lat: 30.5, lon: 114.3, name: 'A, B | C; D' }, cn[1]], 'walk').parts[0].url.includes('A%20B%20C%20D'), 'Amap route: commas, bars and semicolons in a name are removed (they separate fields)');
ok(L.routeUrls('google', mk(2)).parts[0].url.includes('origin=30.000000%2C114.000000'), 'a route needs only coordinates, so a name with odd characters cannot affect a Google link');
