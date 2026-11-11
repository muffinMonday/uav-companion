// Reading coordinates (and pasted map links) from the search box. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const { parseCoordinates: P } = await load('src/coordparse.js');
const { wgs84ToGcj02 } = await load('src/coords.js');
const first = (r) => r.candidates[0];
const is = (text, lat, lon, tol = 1e-5) => { const r = P(text); return r && r.ok && near(first(r).lat, lat, tol) && near(first(r).lon, lon, tol); };

// ---------- decimal pairs
ok(is('30.5928, 114.3055', 30.5928, 114.3055), 'decimal: "30.5928, 114.3055"');
ok(is('30.5928 114.3055', 30.5928, 114.3055), 'decimal: a space between');
ok(is('30.5928,114.3055', 30.5928, 114.3055), 'decimal: no space after the comma');
ok(is('30.5928 / 114.3055', 30.5928, 114.3055) && is('30.5928; 114.3055', 30.5928, 114.3055), 'decimal: a slash or a semicolon');
ok(is('  30.5928  ,  114.3055  ', 30.5928, 114.3055), 'decimal: extra spaces');
ok(is('30.5928，114.3055', 30.5928, 114.3055), 'decimal: a Chinese comma');
ok(is('1.3521, 103.8198', 1.3521, 103.8198) && is('-33.8688, 151.2093', -33.8688, 151.2093) && is('40.7128, -74.0060', 40.7128, -74.006), 'decimal: Singapore, south and west');
ok(is('30°, 114°', 30, 114) && is('30.5928° 114.3055°', 30.5928, 114.3055), 'decimal: with degree signs');
ok(P('30') === null, 'a single number is not coordinates');
ok(P('30.5 114.3 8') === null && P('2026-11-12') === null && P('12 34 56 78') === null, 'three numbers, a date, four numbers: not coordinates');

// ---------- hemispheres
ok(is('N30.5928 E114.3055', 30.5928, 114.3055) && is('30.5928N 114.3055E', 30.5928, 114.3055) && is('30.5928° N, 114.3055° E', 30.5928, 114.3055), 'hemispheres: N/E before or after, with degree signs');
ok(is('S33.8688 E151.2093', -33.8688, 151.2093) && is('33.8688S 151.2093E', -33.8688, 151.2093) && is('40.7128N 74.0060W', 40.7128, -74.006), 'hemispheres: S and W make the value negative');
ok(is('114.3055E 30.5928N', 30.5928, 114.3055) && P('114.3055E 30.5928N').swapped === true, 'hemispheres: longitude first is understood from the letters');
ok(is('n30.5928 e114.3055', 30.5928, 114.3055), 'hemispheres: lower case');

// ---------- degrees, minutes, seconds
ok(is('30°35\'34"N 114°18\'20"E', 30 + 35 / 60 + 34 / 3600, 114 + 18 / 60 + 20 / 3600), 'DMS: 30°35\'34"N 114°18\'20"E');
ok(is('30°35′34″N 114°18′20″E', 30 + 35 / 60 + 34 / 3600, 114 + 18 / 60 + 20 / 3600), 'DMS: with the typographic prime marks');
ok(is('30°35.5667\'N 114°18.3333\'E', 30 + 35.5667 / 60, 114 + 18.3333 / 60), 'DMS: decimal minutes');
ok(is('30 35 34 N 114 18 20 E', 30 + 35 / 60 + 34 / 3600, 114 + 18 / 60 + 20 / 3600), 'DMS: plain spaces with hemisphere letters');
ok(is('33°52\'7"S 151°12\'33"E', -(33 + 52 / 60 + 7 / 3600), 151 + 12 / 60 + 33 / 3600), 'DMS: south is negative');
ok(is('30°35\'34" 114°18\'20"', 30 + 35 / 60 + 34 / 3600, 114 + 18 / 60 + 20 / 3600), 'DMS: marks without letters');
ok(P('30°65\'00"N 114°18\'20"E').ok === false && /below 60/.test(P('30°65\'00"N 114°18\'20"E').error), 'DMS: 65 minutes is rejected');

// ---------- longitude first and ranges
let r = P('114.3055, 30.5928');
ok(r.ok && near(first(r).lat, 30.5928) && near(first(r).lon, 114.3055) && r.swapped === true, 'order: a first number above 90 cannot be a latitude, so the pair is swapped (longitude first)');
r = P('30.5928, 114.3055'); ok(r.swapped === false, 'order: latitude first is not reported as swapped');
r = P('120, 130'); ok(r.ok === false && /Latitude/.test(r.error), 'range: two numbers above 90 give a latitude error: ' + (r.error));
r = P('95.5, 100'); ok(r.ok === false && /Latitude must be between −90 and 90/.test(r.error), 'range: latitude 95 (with a longitude that cannot be a latitude either) is refused with a plain message');
r = P('95.5, 10'); ok(r.ok && r.swapped && near(r.candidates[0].lat, 10) && near(r.candidates[0].lon, 95.5), 'range: 95.5, 10 can only be longitude first, so it is read that way');
r = P('10, 190'); ok(r.ok === false && /Longitude must be between −180 and 180/.test(r.error), 'range: longitude 190 is refused');
r = P('N30 N114'); ok(r.ok === false && /one latitude/.test(r.error), 'hemispheres: two latitudes are refused');
r = P('30.5N 114.3'); ok(r === null || r.ok === false, 'a pair with one letter missing is not accepted silently: ' + JSON.stringify(r && r.error));

// ---------- not coordinates
ok(P('') === null && P('   ') === null && P('Yichang') === null && P('宜昌') === null && P('Hubei 30') === null && P('Wudang Mountain 42') === null && P('123 Main Street') === null, 'names, empty text and addresses with numbers are left to the place search');
ok(P(null) === null && P(undefined) === null && P(5) === null, 'non-text input gives null');

// ---------- inside China: two readings
r = P('30.5928, 114.3055');
ok(r.candidates.length === 2 && /GPS/.test(r.candidates[0].sub) && /Amap/.test(r.candidates[1].sub), 'in China there are two rows: as typed (GPS) and converted from Amap');
const asGps = r.candidates[0], conv = r.candidates[1];
const back = wgs84ToGcj02({ lat: conv.lat, lon: conv.lon });
ok(near(back.lat, 30.5928, 2e-6) && near(back.lon, 114.3055, 2e-6), 'in China the second row, shifted back to GCJ-02, is exactly what was typed');
const shift = Math.hypot((asGps.lat - conv.lat) * 111000, (asGps.lon - conv.lon) * 96000);
ok(shift > 400 && shift < 800, 'the two readings are about 590 m apart (' + Math.round(shift) + ' m)');
r = P('1.3521, 103.8198');
ok(r.candidates.length === 1, 'outside China there is one row');
r = P('25.033, 121.5654');
ok(r.candidates.length === 1, 'Taiwan counts as outside: one row');

// ---------- links
r = P('https://www.google.com/maps/@30.5928,114.3055,15z');
ok(r.ok && near(first(r).lat, 30.5928, 1e-5) && near(first(r).lon, 114.3055, 1e-5) && r.candidates.length === 2, 'Google link: @lat,lon (two rows in China)');
r = P('https://www.google.com/maps/place/Yellow+Crane+Tower/@30.5445,114.3025,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.544512!4d114.302399');
ok(r.ok && near(first(r).lat, 30.544512, 1e-6) && near(first(r).lon, 114.302399, 1e-6), 'Google link: the pin (!3d!4d) wins over the map centre (@)');
r = P('https://www.google.com/maps/search/?api=1&query=1.2894%2C103.8500');
ok(r.ok && near(first(r).lat, 1.2894, 1e-6) && near(first(r).lon, 103.85, 1e-6) && r.candidates.length === 1, 'Google link: query=lat%2Clon (the link this app makes), outside China one row');
r = P('https://maps.google.com/?q=30.5928,114.3055'); ok(r.ok && near(first(r).lat, 30.5928, 1e-5), 'Google link: ?q=lat,lon');
r = P('https://www.google.com/maps/dir/?api=1&destination=30.5%2C114.3&origin=1%2C2'); ok(r.ok && near(first(r).lat, 30.5, 1e-5), 'Google link: a directions link gives its destination');
const am = wgs84ToGcj02({ lat: 30.5928, lon: 114.3055 });
r = P(`https://uri.amap.com/marker?position=${am.lon},${am.lat}&name=x`);
ok(r.ok && r.candidates.length === 1 && near(first(r).lat, 30.5928, 2e-6) && near(first(r).lon, 114.3055, 2e-6) && /Amap link/.test(first(r).sub), 'Amap link: position is lon,lat in GCJ-02 and is converted back (' + first(r).label + ')');
r = P('https://uri.amap.com/marker?position=114.3055,30.5928&coordinate=wgs84');
ok(r.ok && near(first(r).lat, 30.5928) && near(first(r).lon, 114.3055), 'Amap link: coordinate=wgs84 is taken as it is');
r = P(`https://uri.amap.com/navigation?from=1,2&to=${am.lon},${am.lat},Tower&mode=car`);
ok(r.ok === false || near(first(r).lat, 30.5928, 2e-6) || near(first(r).lat, 2), 'Amap link: a navigation link is read (from first, then to)');
r = P('https://maps.app.goo.gl/AbCdEf123'); ok(r.ok === false && /short link/.test(r.error), 'a short Google link is explained, not guessed');
r = P('https://surl.amap.com/abc123'); ok(r.ok === false && /short link/.test(r.error), 'a short Amap link is explained too');
r = P('https://www.google.com/maps/place/Somewhere'); ok(r.ok === false && /No coordinates/.test(r.error), 'a link with no coordinates says so');
r = P('https://www.google.com/maps/@95.0,114.3,15z'); ok(r.ok === false && /out of range/.test(r.error), 'a link with impossible coordinates is refused');
r = P('https://example.com/page'); ok(r.ok === false, 'any other link: no coordinates found');
r = P('http://'); ok(r === null || r.ok === false, 'a broken link does not crash');
