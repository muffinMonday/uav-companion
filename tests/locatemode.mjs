// The locate button's three steps (locate, follow and turn with the phone, back to normal), the direction arrow on the location marker, the compass button,
// the screen wake lock and the permission paths. Positions come from the browser's emulated geolocation; the compass from real DeviceOrientationEvents.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = { latitude: 30.59, longitude: 114.30, accuracy: 15 };

async function open({ vp = { width: 390, height: 780 }, touch = true, compass = true, perm = null, wake = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'], geolocation: HOME }); // (the sensors too: newer Chromium answers requestPermission from them)
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([seen, hasCompass, permAnswer, hasWake]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.59, lon: 114.30, zoom: 13 }, basemap: 'osm' }));
    window.__wl = [];
    if (hasWake) Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (t) => { window.__wl.push('request:' + t); return { release() { window.__wl.push('release'); }, addEventListener() {} }; } } });
    if (!hasCompass) delete window.DeviceOrientationEvent;
    else if (permAnswer) { window.__perm = []; window.DeviceOrientationEvent.requestPermission = async () => { window.__perm.push('asked'); return permAnswer; }; }
  }, [LATEST_SEEN, compass, perm, wake]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(p);
  return { ctx, p, send: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }) };
}
/** The phone points toward `deg` (lying flat): a run of orientation events so the smoothing settles. */
const face = async (p, deg, n = 14) => { for (let i = 0; i < n; i++) { await p.evaluate((d) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: (360 - d) % 360, beta: 0, gamma: 0, absolute: true })), deg); await sleep(130); } };
const bearing = (p) => p.$eval('#map', (e) => parseFloat(e.style.getPropertyValue('--unrot')) || 0);
const arrow = (p) => p.evaluate(() => { const w = document.querySelector('.you-wrap'); return w ? { has: w.classList.contains('has-heading'), deg: parseFloat(w.style.getPropertyValue('--ya')), title: w.closest('.leaflet-marker-icon')?.title } : null; });
const btn = (p) => p.$eval('.locate-btn', (e) => ({ following: e.classList.contains('following'), active: e.classList.contains('active'), label: e.getAttribute('aria-label') }));
const dotOff = (p) => p.evaluate(() => { const m = document.querySelector('#map').getBoundingClientRect(), d = document.querySelector('.you-dot').getBoundingClientRect(); return { x: Math.round(d.x + d.width / 2 - (m.x + m.width / 2)), y: Math.round(d.y + d.height / 2 - (m.y + m.height / 2)) }; });
const wl = (p) => p.evaluate(() => window.__wl.join());
const toast = (p) => p.evaluate(() => document.getElementById('toast').textContent);
const near = (a, b, t = 6) => Math.abs(((a - b + 540) % 360) - 180) < t;

// ================= the three steps, with a compass
let s = await open();
let st = await btn(s.p);
ok(!st.active && /Show my location/.test(st.label), 'before anything the button offers to show your location');
ok(!(await s.p.locator('.you-dot').count()) && await bearing(s.p) === 0, 'nothing is shown and the map is north-up');

await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(800);
st = await btn(s.p);
ok(st.active && !st.following && /Follow me and turn/.test(st.label), 'press 1: your position is shown and the button now offers to follow and turn the map');
ok(!(await arrow(s.p)).has, 'there is no arrow until the phone says which way it points');
ok((await s.p.locator('.leaflet-popup').count()) === 0, 'locating does not run a point check or open a popup by itself');
ok(await bearing(s.p) === 0, 'and the map is still north-up');

await face(s.p, 90, 3);
let a = await arrow(s.p);
ok(a.has && near(a.deg, 90, 3) && /facing east/.test(a.title), 'the arrow appears on the marker, pointing east (' + Math.round(a.deg) + '°): ' + a.title);

await s.p.click('.locate-btn'); await sleep(900);
st = await btn(s.p);
ok(st.following && /Stop following/.test(st.label), 'press 2: the button shows it is following');
ok(near(await bearing(s.p), 90, 3), 'the map turned so that east is at the top (' + Math.round(await bearing(s.p)) + '°)');
a = await arrow(s.p);
ok(near(a.deg, 0, 3), 'and the arrow on the marker points straight up');
ok(/request:screen/.test(await wl(s.p)), 'the screen is kept awake while following');
let off = await dotOff(s.p);
ok(Math.abs(off.x) < 6 && Math.abs(off.y) < 6, 'your position is at the centre of the screen (' + off.x + ', ' + off.y + ')');

await face(s.p, 180);
ok(near(await bearing(s.p), 180, 8), 'turning the phone to face south turns the map (' + Math.round(await bearing(s.p)) + '°)');
ok(near((await arrow(s.p)).deg, 0, 8), 'and the arrow still points up');

// moving: the map follows
await s.ctx.setGeolocation({ latitude: 30.595, longitude: 114.305, accuracy: 10 }); await sleep(2500);
off = await dotOff(s.p);
ok(Math.abs(off.x) < 8 && Math.abs(off.y) < 8, 'when you move, the map follows and keeps you at the centre (' + off.x + ', ' + off.y + ')');
ok((await btn(s.p)).following, 'and it is still following');

// a pinch to zoom keeps following
const c = await s.p.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const two = (d) => [{ x: c.x - d, y: c.y, id: 1 }, { x: c.x + d, y: c.y, id: 2 }];
await s.send('touchStart', two(50)); for (let i = 1; i <= 8; i++) { await s.send('touchMove', two(50 + 8 * i)); await sleep(16); } await s.send('touchEnd', []); await sleep(800);
ok((await btn(s.p)).following, 'pinching to zoom does not stop following');
await s.p.click('.leaflet-control-zoom-in'); await sleep(800);
ok((await btn(s.p)).following, 'nor do the zoom buttons');

// turning by hand pauses the compass but keeps following
const b0 = await bearing(s.p);
const tw = (ang) => [0, 180].map((o, i) => ({ x: c.x + 80 * Math.cos(((ang + o) * Math.PI) / 180), y: c.y + 80 * Math.sin(((ang + o) * Math.PI) / 180), id: i + 1 }));
await s.send('touchStart', tw(0)); for (let i = 1; i <= 10; i++) { await s.send('touchMove', tw(6 * i)); await sleep(16); } await s.send('touchEnd', []); await sleep(400);
const b1 = await bearing(s.p);
ok(Math.abs(b1 - b0) > 25 && (await btn(s.p)).following, 'turning the map with two fingers turns it, and it keeps following (' + Math.round(b0) + '° to ' + Math.round(b1) + '°)');
await face(s.p, 270, 14);
ok(Math.abs(await bearing(s.p) - b1) < 3, 'the compass no longer turns the map: it stays at the angle you chose');
const hand = await arrow(s.p), want = (270 - b1 + 360) % 360;
ok(near(hand.deg, want, 8), 'and the arrow on the marker shows the way you face on the turned map (' + Math.round(hand.deg) + '°, expected ' + Math.round(want) + '°)');
ok(await s.p.locator('.compass-bar').isVisible(), 'the compass button is shown');
await s.ctx.setGeolocation({ latitude: 30.597, longitude: 114.307, accuracy: 10 }); await sleep(2500);
off = await dotOff(s.p);
ok(Math.abs(off.x) < 8 && Math.abs(off.y) < 8, 'and the map still keeps you at the centre (' + off.x + ', ' + off.y + ')');

// the compass button: north-up, not following
await s.p.click('.compass-btn'); await sleep(900);
ok(Math.abs(await bearing(s.p)) < 0.5 && !(await btn(s.p)).following && !(await s.p.locator('.compass-bar').isVisible()), 'the compass button turns the map north and stops following');
ok(/release/.test(await wl(s.p)), 'and lets the screen sleep again');
ok((await btn(s.p)).active && await s.p.locator('.you-dot').count() === 1, 'your position is still shown');
await face(s.p, 45, 14);
ok(Math.abs(await bearing(s.p)) < 0.5 && near((await arrow(s.p)).deg, 45, 8), 'the arrow keeps following the compass, on the north-up map');

// press 2 again, then press 3
await s.p.click('.locate-btn'); await sleep(700);
ok((await btn(s.p)).following && near(await bearing(s.p), 45, 8), 'pressing again follows and turns once more');
await s.p.click('.locate-btn'); await sleep(900);
st = await btn(s.p);
ok(!st.following && Math.abs(await bearing(s.p)) < 0.5 && st.active, 'press 3: back to a normal north-up map, with your position still shown');

// a one-finger drag ends following and the turning
await face(s.p, 90, 14);
await s.p.click('.locate-btn'); await sleep(700);
ok((await btn(s.p)).following && near(await bearing(s.p), 90, 8), 'following and turning again');
await s.send('touchStart', [{ x: c.x, y: c.y + 220, id: 1 }]); for (let i = 1; i <= 8; i++) { await s.send('touchMove', [{ x: c.x + 8 * i, y: c.y + 220, id: 1 }]); await sleep(16); } await s.send('touchEnd', []); await sleep(900);
ok(!(await btn(s.p)).following && Math.abs(await bearing(s.p)) < 0.5, 'pulling the map with one finger stops following and turns the map back to north-up');
await s.ctx.close();

// ================= a tap on a marker, which recentres the map elsewhere, ends following too
// (covered by the "anything that moves the map away" rule; the pin below is away from the user)
s = await open();
await s.p.evaluate(() => { localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [{ id: 'far', type: 'photo', name: 'Far pin', note: '', lat: 30.60, lon: 114.30, created: '2026-11-01T00:00:00.000Z' }] })); });
await s.p.reload({ waitUntil: 'networkidle' }); await sleep(1200);
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(600);
await face(s.p, 0, 3);
await s.p.click('.locate-btn'); await sleep(700);
ok((await btn(s.p)).following, 'following with a marker on the map');
await s.p.evaluate(() => document.querySelector('.poi-pin')?.click()); await sleep(1200);
ok(!(await btn(s.p)).following, 'tapping a marker, which moves the map to it, ends following');
await s.ctx.close();

// ================= no compass at all
s = await open({ compass: false });
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(500);
ok(!(await arrow(s.p)).has, 'a phone with no compass shows no arrow while it is standing still');
await s.p.click('.locate-btn'); await sleep(900);
ok((await btn(s.p)).following && await bearing(s.p) === 0 && /no usable compass/.test(await toast(s.p)), 'press 2 follows without turning the map, and says there is no compass: ' + (await toast(s.p)).slice(0, 70));
await s.ctx.setGeolocation({ latitude: 30.595, longitude: 114.305, accuracy: 10 }); await sleep(2500);
off = await dotOff(s.p);
ok(Math.abs(off.x) < 8 && Math.abs(off.y) < 8, 'it still keeps you at the centre (' + off.x + ', ' + off.y + ')');
await s.ctx.close();

// a compass that never sends an event (a browser with the API but no sensor)
s = await open();
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 });
await sleep(2400); // longer than the sensor's wait
await s.p.click('.locate-btn'); await sleep(900);
ok((await btn(s.p)).following && await bearing(s.p) === 0 && /no usable compass/.test(await toast(s.p)), 'a sensor that never reports is treated as no compass: following, north-up, with the message');
await s.ctx.close();

// ================= iOS: permission asked on the first press, once
s = await open({ perm: 'granted' });
ok(await s.p.evaluate(() => window.__perm.length) === 0, 'iOS: the permission is not asked when the page opens');
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(500);
ok(await s.p.evaluate(() => window.__perm.join()) === 'asked', 'iOS: it is asked on the first press');
await face(s.p, 90, 3);
ok((await arrow(s.p)).has, 'iOS: once granted, the compass works');
await s.p.click('.locate-btn'); await sleep(500); await s.p.click('.locate-btn'); await sleep(500); await s.p.click('.locate-btn'); await sleep(500);
ok(await s.p.evaluate(() => window.__perm.length) === 1, 'iOS: and it is not asked again');
await s.ctx.close();

s = await open({ perm: 'denied' });
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(700);
ok(/Compass permission was refused/.test(await toast(s.p)) && (await btn(s.p)).active, 'iOS: a refused permission says so, and locating still works');
ok(!(await arrow(s.p)).has, 'with no arrow');
await s.p.click('.locate-btn'); await sleep(800);
ok((await btn(s.p)).following && await bearing(s.p) === 0, 'and following works north-up');
await s.ctx.close();

// ================= a computer: no sensor, no turning, following works
s = await open({ vp: { width: 1300, height: 850 }, touch: false, compass: false });
await s.p.click('.locate-btn'); await s.p.waitForSelector('.you-dot', { timeout: 15000 }); await sleep(600);
await s.p.click('.locate-btn'); await sleep(800);
ok((await btn(s.p)).following && await bearing(s.p) === 0 && !(await s.p.locator('.compass-bar').isVisible()), 'on a computer the second press follows and the map is never turned');
await s.p.click('.locate-btn'); await sleep(500);
ok(!(await btn(s.p)).following, 'and the third press stops following');
await s.ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
