// Turning the map (src/maprotate.js) in a real browser with real touch events: the two-finger twist, and that everything still lands where it should on a
// turned map: markers upright on the spot they mark, popups upright, a press-and-hold and a drag at the right coordinates, tiles to the corners.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });

// Web Mercator, to know which coordinates a screen offset from the map centre stands for
const LAT0 = 30.58, LON0 = 114.33, Z = 15;
const W = (z) => 256 * 2 ** z;
const px = (lat, lon, z = Z) => { const s = Math.sin((lat * Math.PI) / 180); return { x: ((lon + 180) / 360) * W(z), y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W(z) }; };
const ll = (x, y, z = Z) => { const n = Math.PI - (2 * Math.PI * y) / W(z); return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (x / W(z)) * 360 - 180 }; };
/** The coordinates of the point a screen offset (dx, dy) from the centre of a map turned to `bearing` shows. */
const under = (c, dx, dy, bearing, z = Z) => {
  const a = (bearing * Math.PI) / 180, c0 = px(c.lat, c.lon, z);
  return ll(c0.x + dx * Math.cos(a) - dy * Math.sin(a), c0.y + dx * Math.sin(a) + dy * Math.cos(a), z);
};

const east = ll(px(LAT0, LON0).x + 100, px(LAT0, LON0).y); // a marker 100 px east of the centre
const items = [{ id: 'p1', type: 'photo', name: 'East pin', note: '', lat: LAT0, lon: east.lon, created: '2026-11-01T00:00:00.000Z' }];

async function open({ vp = { width: 390, height: 780 }, touch = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([po, lat, lon, z, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat, lon, zoom: z }, basemap: 'osm' }));
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po }));
  }, [items, LAT0, LON0, Z, LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(p);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return { ctx, p, cdp, send };
}
const centre = (p) => p.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
const bearing = (p) => p.$eval('#map', (e) => parseFloat(e.style.getPropertyValue('--unrot')) || 0);
const rotated = (p) => p.$eval('#map', (e) => e.classList.contains('rotated'));
const mapCentre = async (p) => { const t = await p.evaluate(() => { const b = document.querySelector('.crosshair-label, #crosshair-label, .crosshair .coords'); return b ? b.textContent : ''; }); const m = /(-?\d+\.\d+)\D+(-?\d+\.\d+)/.exec(t); return m ? { lat: +m[1], lon: +m[2] } : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Two fingers 80 px either side of the centre, turned from angle a0 to a1 degrees (clockwise on the screen), at a constant distance. */
async function twist(h, c, a0, a1, steps = 10) {
  const pts = (a) => [0, 180].map((o, i) => ({ x: c.x + 80 * Math.cos(((a + o) * Math.PI) / 180), y: c.y + 80 * Math.sin(((a + o) * Math.PI) / 180), id: i + 1 }));
  await h.send('touchStart', pts(a0));
  for (let i = 1; i <= steps; i++) { await h.send('touchMove', pts(a0 + ((a1 - a0) * i) / steps)); await sleep(16); }
  await h.send('touchEnd', []); await sleep(250);
}
async function pinch(h, c, d0, d1, steps = 8) {
  const pts = (d) => [{ x: c.x - d, y: c.y, id: 1 }, { x: c.x + d, y: c.y, id: 2 }];
  await h.send('touchStart', pts(d0));
  for (let i = 1; i <= steps; i++) { await h.send('touchMove', pts(d0 + ((d1 - d0) * i) / steps)); await sleep(16); }
  await h.send('touchEnd', []); await sleep(400);
}

// ================= not turned: nothing is different
let s = await open();
let c = await centre(s.p);
ok(!(await rotated(s.p)) && await bearing(s.p) === 0, 'an ordinary map is not turned');
ok(!(await s.p.locator('.compass-bar').isVisible()), 'and the compass button is not shown');
ok(await s.p.$eval('.leaflet-map-pane', (e) => e.style.rotate === '' || e.style.rotate === 'none'), 'the map pane has no rotation');

// ================= a pinch only zooms
await pinch(s, c, 60, 120);
ok(await bearing(s.p) === 0 && !(await rotated(s.p)), 'pinching without twisting does not turn the map');

// ================= two fingers turn it
await twist(s, c, 0, 90);
const b1 = await bearing(s.p);
ok(b1 < -70 && b1 > -95, 'turning two fingers a quarter turn clockwise turns the map clockwise: north is now at the right, the compass direction at the top is west (' + Math.round(b1) + '°)');
ok(await rotated(s.p) && await s.p.locator('.compass-bar').isVisible(), 'the compass button appears');
const needle = await s.p.$eval('.compass-btn .needle', (e) => getComputedStyle(e).transform);
ok(needle !== 'none', 'with a needle that points to north');

await s.ctx.close();

// ================= on a fresh page at the seeded zoom: the pin is 100 px east of the centre, so a quarter turn clockwise puts it 100 px below the centre
s = await open();
c = await centre(s.p);
const tilesNow = () => s.p.evaluate(() => document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile').length);
const flat = await tilesNow(); // tiles on an unturned map
await twist(s, c, 0, 90);
const bq = await bearing(s.p);
const pin = await s.p.$eval('.poi-pin', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height, w: r.width, h: r.height, rot: getComputedStyle(e).rotate }; });
ok(pin.h > pin.w, 'the pin stays upright (it is taller than it is wide: ' + Math.round(pin.w) + ' x ' + Math.round(pin.h) + ')');
const phi = (-bq * Math.PI) / 180; // the map is turned by minus the bearing
ok(Math.abs(pin.x - (c.x + 100 * Math.cos(phi))) < 6 && Math.abs(pin.y - (c.y + 100 * Math.sin(phi) + 2)) < 8, 'and it is still on the spot it marks: 100 px east of the centre, turned with the map (' + Math.round(bq) + '°), is at ' + Math.round(100 * Math.cos(phi)) + ', ' + Math.round(100 * Math.sin(phi)) + ' from the centre (tip at ' + Math.round(pin.x - c.x) + ', ' + Math.round(pin.y - c.y) + ')');

// ================= a popup stays upright, above the pin
await s.p.tap('.poi-pin'); await s.p.waitForSelector('.leaflet-popup', { timeout: 8000 });
await sleep(400);
const pop = await s.p.$eval('.leaflet-popup', (e) => { const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, bottom: r.bottom, w: r.width, h: r.height, rot: getComputedStyle(e).rotate }; });
const pin2 = await s.p.$eval('.poi-pin', (e) => { const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, top: r.y }; });
ok(pop.w > pop.h * 0.6 && Math.abs(pop.cx - pin2.cx) < 14 && pop.bottom <= pin2.top + 30, 'the popup is upright and sits above the pin it belongs to (centre off by ' + Math.round(Math.abs(pop.cx - pin2.cx)) + ' px)');
await s.p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await sleep(300);

// ================= a press-and-hold checks the point that is under the finger
await sleep(600);
const viewNow = () => s.p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).view);
const v0 = await viewNow(); // (tapping the pin centred the map on it)
const target = under({ lat: v0.lat, lon: v0.lon }, 120, 0, bq, v0.zoom);
await s.send('touchStart', [{ x: c.x + 120, y: c.y, id: 1 }]); await sleep(2300); await s.send('touchEnd', []);
await s.p.waitForSelector('.leaflet-popup', { timeout: 8000 }); await sleep(500);
const title = await s.p.$eval('.leaflet-popup', (e) => e.textContent);
const m = /(-?\d+\.\d{4,})\D+(-?\d+\.\d{4,})/.exec(title);
ok(m && Math.abs(+m[1] - target.lat) < 0.0004 && Math.abs(+m[2] - target.lon) < 0.0004, 'holding at a point 120 px right of the centre of the turned map checks that point: expected ' + target.lat.toFixed(4) + ', ' + target.lon.toFixed(4) + ', got ' + (m ? m[1] + ', ' + m[2] : title.slice(0, 60)));
await s.p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await sleep(300);

// ================= a one-finger drag moves the map the way the finger goes
const before = await viewNow();
await s.send('touchStart', [{ x: c.x, y: c.y + 200, id: 1 }]);
for (let i = 1; i <= 10; i++) { await s.send('touchMove', [{ x: c.x + 10 * i, y: c.y + 200, id: 1 }]); await sleep(16); }
await s.send('touchEnd', []); await sleep(1500);
const after = await s.p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).view);
const wantC = under({ lat: before.lat, lon: before.lon }, -100, 0, bq, before.zoom); // dragging the content right by 100 px moves the view 100 px the other way, as the turned map sees it
ok(Math.abs(after.lat - wantC.lat) < 0.0006 && Math.abs(after.lon - wantC.lon) < 0.0006, 'dragging the turned map 100 px to the right moves the view 100 px to the left on the screen, as the turned map sees it: from ' + before.lat.toFixed(4) + ', ' + before.lon.toFixed(4) + ' to ' + after.lat.toFixed(4) + ', ' + after.lon.toFixed(4) + ' (expected ' + wantC.lat.toFixed(4) + ', ' + wantC.lon.toFixed(4) + ')');

// ================= tiles reach the corners of the turned screen
await twist(s, c, 0, 45); // a further 45 degrees
await sleep(500);
const turned = await tilesNow();
const near = await s.p.evaluate(([w, h]) => [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [...document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].some((t) => { const r = t.getBoundingClientRect(); return r.left <= x + 30 && r.right >= x - 30 && r.top <= y + 30 && r.bottom >= y - 30; })), [c.w, c.h]);
ok(turned > flat && near.every(Boolean), 'at ' + Math.round(await bearing(s.p)) + '° more tiles are loaded (' + flat + ' to ' + turned + ') and every corner of the screen has tiles at it');

// ================= back to north
await s.p.click('.compass-btn'); await sleep(800);
ok(Math.abs(await bearing(s.p)) < 0.1 && !(await rotated(s.p)) && !(await s.p.locator('.compass-bar').isVisible()), 'the compass button turns the map back to north and hides itself');
await s.ctx.close();

// ================= a computer with no touch: the map cannot be turned by hand and is unchanged
s = await open({ vp: { width: 1300, height: 850 }, touch: false });
ok(!(await rotated(s.p)) && !(await s.p.locator('.compass-bar').isVisible()), 'on a computer the map is not turned and there is no compass button');
await s.p.mouse.move(600, 400); await s.p.mouse.down(); await s.p.mouse.move(700, 400, { steps: 8 }); await s.p.mouse.up(); await sleep(500);
ok(await bearing(s.p) === 0, 'dragging with the mouse only pans');
await s.ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
