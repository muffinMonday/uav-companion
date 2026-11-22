// Itinerary routes on the map (browser): broad bands, chevrons fitted inside them, road geometry from the device cache or a mocked route function, a dashed
// straight-line fallback, segmented overnight legs, labels that never overlap, turning the map, dark theme, a phone, and no request when the view changes.
import { chromium, CHANNEL, ROOT, HOST, MW } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const { routeKey } = await imp('src/route/identity.js');
const { encodePolyline } = await imp('src/route/polyline.js');
const { STORE_KEY } = await imp('src/route/router.js');
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D = iso(5), D2 = iso(6);
const trips = [{ id: 't1', name: 'Hubei', startDate: D, endDate: D2, description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('a', 'Alpha', 30.590, 114.300, { tripId: 't1', date: D, order: 1 }),
  mk('b', 'Bravo', 30.600, 114.310, { tripId: 't1', date: D, order: 2 }),
  mk('c', 'Charlie', 30.610, 114.325, { tripId: 't1', date: D, order: 3 }),
  mk('h', 'Hotel', 30.585, 114.296, { tripId: 't1', type: 'hotel', date: D, endDate: D2 }),
  mk('x', 'Elsewhere', 30.620, 114.340, { tripId: 't1', date: D2, order: 1 }),
];
const leg = (a, b) => ({ from: { id: a.id, lat: a.lat, lon: a.lon }, to: { id: b.id, lat: b.lat, lon: b.lon } });
const I = Object.fromEntries(items.map((i) => [i.id, i]));
const bend = (a, b) => [[a.lat, a.lon], [a.lat + (b.lat - a.lat) * 0.3, a.lon + (b.lon - a.lon) * 0.7], [a.lat + (b.lat - a.lat) * 0.8, a.lon + (b.lon - a.lon) * 0.9], [b.lat, b.lon]];
const rowOf = (a, b, dist = 2000, dur = 300) => ({ key: routeKey(leg(a, b)), geometry: encodePolyline(bend(a, b)), distanceM: dist, durationS: dur, t: Date.now() });
const cacheDoc = JSON.stringify({ v: 1, items: [rowOf(I.a, I.b)] });
const table = {}; // what the mocked route function answers, by "from>to"
for (const [a, b] of [['a', 'b'], ['b', 'c'], ['c', 'h'], ['h', 'x']]) table[`${a}>${b}`] = { source: 'provider', route: { key: routeKey(leg(I[a], I[b])), from: a, to: b, geometry: encodePolyline(bend(I[a], I[b])), points: 4, distance_m: 3100, duration_s: 420 } };

const b = await chromium.launch({ channel: CHANNEL });
// A spy for the performance checks: it keeps the map (window.__map) and counts how many times the routes were drawn (a draw creates its casings in one go, so the
// first casing of a task opens a draw) and how many route layers were created.
const SPY = () => {
  window.__draws = 0; window.__casings = 0;
  let Lv; Object.defineProperty(window, 'L', { configurable: true, get() { return Lv; }, set(v) {
    Lv = v; if (!v || !v.Map || !v.Map.addInitHook) return;
    v.Map.addInitHook(function () { window.__map = this; });
    const ini = v.Polyline.prototype.initialize; let open = false;
    v.Polyline.prototype.initialize = function (ll, o) { if (o && o.className && o.className.startsWith('route-case')) { window.__casings++; if (!open) { open = true; window.__draws++; queueMicrotask(() => { open = false; }); } } return ini.call(this, ll, o); };
  } });
};
const requests = [];
async function open({ vp = { width: 1300, height: 900 }, cache = true, backend = false, zoom = 15, list = items, theme, delay = 900, spy = false } = {}) {
  const ctx = await b.newContext({ viewport: vp });
  if (spy) await ctx.addInitScript(SPY);
  await ctx.addInitScript(([po, tr, cd, key, useBackend, tbl, z, th, dl]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.60, lon: 114.31, zoom: z }, basemap: 'osm', ...(th ? { theme: th } : {}) }));
    if (cd) localStorage.setItem(key, cd);
    window.__routeCalls = [];
    if (useBackend) window.__uavRouteBackend = { signedIn: () => true, fetchShared: async () => [], invoke: async (body) => { window.__routeCalls.push(body); await new Promise((r) => setTimeout(r, dl)); const r = tbl[`${body.from.id}>${body.to.id}`]; if (!r) { const e = new Error('x'); e.code = 'no_route'; throw e; } return r; } };
  }, [list, trips, typeof cache === 'string' ? cache : cache ? cacheDoc : null, STORE_KEY, backend, table, zoom, theme ?? null, delay]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  p.on('request', (r) => requests.push(r.url()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.click('#panel-close').catch(() => {}); await p.waitForTimeout(250);
  return { ctx, p };
}
const pin = (p, name) => p.locator(`.leaflet-marker-icon[title="${name}"]`).first();
async function select(p, name) {
  await pin(p, name).click(); await p.waitForSelector(MW + ' h3', { timeout: 8000 }); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, #marker-host .pop-close')?.click()); await p.waitForTimeout(100); // close the window; the details-off path keeps the selection, this one clears it
}
const open1 = async (p, name) => { await pin(p, name).evaluate((e) => e.click()); await p.waitForSelector(MW + ' h3', { timeout: 8000 }); await p.waitForTimeout(500); };
const count = (p, sel) => p.locator(sel).count();
// the chevrons of a leg are one compound path (one "M x y L x y L x y" stroke each): how many strokes are on the page
const chevCount = (p) => p.evaluate(() => [...document.querySelectorAll('path.route-chev')].reduce((n, c) => n + (c.getAttribute('d') || '').split('M').filter((x) => (x.match(/-?\d+\.?\d*/g) || []).length >= 6).length, 0));
// is every chevron's centre inside the stroke of one of the bands?
const chevronsInside = (p) => p.evaluate(() => {
  const bands = [...document.querySelectorAll('path.route-band')], paths = [...document.querySelectorAll('path.route-chev')];
  const svg = bands[0]?.ownerSVGElement, strokes = (c) => (c.getAttribute('d') || '').split('M').map((x) => (x.match(/-?\d+\.?\d*/g) || []).map(Number)).filter((d) => d.length >= 6);
  const all = paths.flatMap(strokes);
  if (!svg || !all.length) return { n: all.length, inside: 0 };
  let inside = 0;
  for (const d of all) { const xs = [d[0], d[2], d[4]], ys = [d[1], d[3], d[5]]; const pt = new DOMPoint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2); if (bands.some((bd) => bd.isPointInStroke(pt))) inside++; }
  return { n: all.length, inside };
});
const labelRects = (p) => p.$$eval('.route-label', (e) => e.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, text: x.textContent, state: x.dataset.state, aria: x.getAttribute('aria-label') }; }));
const noOverlap = (rs) => rs.every((a, i) => rs.every((c, j) => j <= i || a.r <= c.l + 1 || c.r <= a.l + 1 || a.b <= c.t + 1 || c.b <= a.t + 1));

// ================= road from the device cache, fallback for the other leg; the details window is open (the default)
let { ctx, p } = await open();
await open1(p, 'Bravo');
ok(await count(p, 'path.route-band.road') === 1 && await count(p, 'path.route-band.route-fallback') === 1, 'a cached road leg and a leg with no road: one road band, one fallback band');
const dRoad = await p.getAttribute('path.route-band.road', 'd');
ok((dRoad.match(/L/g) || []).length >= 3, 'the road band follows the stored geometry (not a two-point line): ' + (dRoad.match(/L/g) || []).length + ' segments');
ok(await p.getAttribute('path.route-band.route-fallback', 'stroke-dasharray') !== null && await p.getAttribute('path.route-band.road', 'stroke-dasharray') === null, 'the fallback band is dashed and the road band is solid');
const widths = await p.$$eval('path.route-band', (e) => e.map((x) => Number(x.getAttribute('stroke-width'))));
ok(widths.every((w) => w >= 8 && w <= 12), 'bands are broad but restrained: 8 to 12 px (' + widths.join(', ') + ')');
ok(await count(p, 'path.route-case') === 2, 'each band has a light casing so it reads on any basemap');
let ci = await chevronsInside(p);
ok(ci.n >= 2 && ci.inside === ci.n, 'every chevron sits inside its band (' + ci.inside + ' of ' + ci.n + ')');
ok(await chevCount(p) >= 6 && await count(p, 'path.route-chev') <= 2, 'chevrons repeat along a route, not one arrow per leg, and a leg draws all of them as one path (' + await chevCount(p) + ' chevrons in ' + await count(p, 'path.route-chev') + ' paths)');
let labs = await labelRects(p);
ok(labs.length === 2 && labs.some((l) => l.state === 'road' && /· 5 min/.test(l.text)) && labs.some((l) => l.state === 'fallback' && /straight line/.test(l.text) && /≈/.test(l.text)), 'each leg has a label: driving distance and time for the road, "≈ ... straight line" for the fallback: ' + labs.map((l) => l.text).join(' | '));
ok(labs.every((l) => l.aria && (l.state !== 'fallback' || /Driving route unavailable/.test(l.aria)) && (l.state !== 'road' || /^Driving route/.test(l.aria))) && noOverlap(labs), 'labels have accessible text that says which is which, and do not overlap');
ok(requests.every((u) => !/heigit|openrouteservice/i.test(u)), 'the browser never talks to the routing provider');
// selected emphasis
ok(widths.every((w) => w === 12), 'both legs touch the selected stop, so both bands are emphasised (12 px)');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, #marker-host .pop-close').click()); await p.waitForTimeout(300);
ok(await count(p, 'path.route-band') === 0 && await count(p, 'path.route-chev') === 0 && await count(p, '.route-label') === 0 && await count(p, 'path.route-case') === 0, 'closing the window removes every route layer');
// thin legs for an unselected leg of the day: select the first stop
await open1(p, 'Alpha');
const w2 = await p.$$eval('path.route-band', (e) => e.map((x) => [x.classList.contains('road'), Number(x.getAttribute('stroke-width'))]));
ok(w2.length === 2 && w2.find((x) => x[0])[1] === 12 && w2.find((x) => !x[0])[1] === 9, 'the first stop: its own leg is emphasised (12 px), the rest of the day is normal (9 px)');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, #marker-host .pop-close').click()); await p.waitForTimeout(200);

// ================= overnight: segmented band
await open1(p, 'Charlie');
const ov = await p.$$eval('path.route-band.overnight', (e) => e.map((x) => ({ dash: x.getAttribute('stroke-dasharray'), fb: x.classList.contains('route-fallback') })));
ok(ov.length === 1 && ov[0].dash && ov[0].fb, 'an overnight leg is a segmented (dashed) band: ' + JSON.stringify(ov));
labs = await labelRects(p);
ok(labs.some((l) => /straight line/.test(l.text)) && await count(p, '.route-label.overnight') === 1, 'an overnight fallback is told apart by its label, not by dashes alone');
ci = await chevronsInside(p);
ok(ci.n > 0 && ci.inside === ci.n, 'the overnight leg has chevrons inside its band too');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, #marker-host .pop-close').click()); await p.waitForTimeout(200);

// ================= turning the map
await open1(p, 'Bravo');
await p.evaluate(() => document.querySelector('.leaflet-container')._rot.set(40, 'compass')); await p.waitForTimeout(700);
ci = await chevronsInside(p);
ok(ci.n >= 2 && ci.inside === ci.n, 'turned by 40 degrees: chevrons still lie inside their bands (they turn with the map)');
ok(await p.$$eval('.route-label-box', (e) => e.length > 0 && e.every((x) => getComputedStyle(x).rotate === '40deg')), 'labels are counter-rotated so they stay upright');
labs = await labelRects(p);
ok(labs.length === 2 && noOverlap(labs), 'labels still do not overlap after turning');
await p.evaluate(() => document.querySelector('.leaflet-container')._rot.set(0, 'reset')); await p.waitForTimeout(500);
// ================= dark theme
await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await p.waitForTimeout(300);
const caseDark = await p.$eval('path.route-case', (e) => getComputedStyle(e).stroke);
ok(/rgb\(24, 34, 44\)/.test(caseDark), 'dark theme: the casing takes the dark surface colour (' + caseDark + ')');
ok(await p.$eval('.route-label', (e) => getComputedStyle(e).backgroundColor) === 'rgb(24, 34, 44)', 'and the labels use the dark surface');
await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
// ================= zooming and panning draw again but ask for nothing
const before = requests.length;
await p.evaluate(() => { const c = document.querySelector('.leaflet-container'); c.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: 600, clientY: 400, bubbles: true })); }); await p.waitForTimeout(900);
ok(await count(p, 'path.route-band') >= 1, 'after zooming the routes are still drawn');
await ctx.close();

// ================= a phone
({ ctx, p } = await open({ vp: { width: 390, height: 800 }, zoom: 15 }));
await open1(p, 'Bravo');
labs = await labelRects(p);
ok(labs.length >= 1 && noOverlap(labs) && labs.every((l) => l.l >= -2 && l.r <= 392), 'on a phone the labels stay on screen and apart (' + labs.length + ')');
ci = await chevronsInside(p);
ok(ci.n >= 1 && ci.inside === ci.n, 'and the chevrons are inside the bands');
await ctx.close();

// ================= zoomed far out: legs are tiny, nothing breaks
({ ctx, p } = await open({ zoom: 10 }));
await open1(p, 'Bravo');
ok(await chevCount(p) === 0, 'when a leg is a few pixels long it gets no chevron (they would sit on the pins)');
await ctx.close();

// ================= a mocked route function: pending fallback, then the road; asked once; never again for pan, zoom or turn
({ ctx, p } = await open({ cache: false, backend: true }));
await open1(p, 'Bravo');
ok(await count(p, 'path.route-band.road') === 0 && await count(p, '.route-label[data-pending="1"]') >= 1, 'before the road arrives the leg is drawn as the straight line (pending)');
await p.waitForTimeout(1200);
ok(await count(p, 'path.route-band.road') === 2 && await count(p, 'path.route-band.route-fallback') === 0, 'then both legs become roads');
labs = await labelRects(p);
ok(labs.length === 2 && labs.every((l) => l.state === 'road' && /· 7 min/.test(l.text)), 'with the provider\'s distance and time on the labels: ' + labs.map((l) => l.text).join(' | '));
const calls = await p.evaluate(() => window.__routeCalls);
ok(calls.length === 2 && calls.every((c) => c.trip === null && Object.keys(c).sort().join() === 'from,to,trip' && Object.keys(c.from).sort().join() === 'id,lat,lon'), 'two requests, one per leg, holding only ids and coordinates (' + calls.length + ')');
const stored = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
ok(stored?.items?.length === 2 && !JSON.stringify(stored).includes('Bravo') && !JSON.stringify(stored).includes('t1'), 'the roads are kept on this device without names or trip ids');
await p.evaluate(() => document.querySelector('.leaflet-container')._rot.set(25, 'compass')); await p.waitForTimeout(500);
await p.mouse.move(600, 400); await p.mouse.wheel(0, -300); await p.waitForTimeout(900);
await p.mouse.move(600, 400); await p.mouse.down(); await p.mouse.move(520, 380, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(700);
ok((await p.evaluate(() => window.__routeCalls.length)) === 2, 'turning, zooming and panning ask for no route (still 2 requests)');
await open1(p, 'Bravo').catch(() => {});
await ctx.close();

// ================= a reload: the device cache answers first, no request
({ ctx, p } = await open({ cache: false, backend: true }));
await open1(p, 'Bravo'); await p.waitForTimeout(900);
const keep = await p.evaluate((k) => localStorage.getItem(k), STORE_KEY);
await p.evaluate(() => { window.__routeCalls = []; });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
await p.evaluate(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [STORE_KEY, keep]);
await p.evaluate(() => { window.__routeCalls = []; });
await open1(p, 'Bravo'); await p.waitForTimeout(500);
ok(await count(p, 'path.route-band.road') === 2 && (await p.evaluate(() => window.__routeCalls.length)) === 0, 'after a reload the stored roads are drawn at once and nothing is requested');
await ctx.close();

// ================= signed out and no cache: straight line, no request, and the reason is in the label text
({ ctx, p } = await open({ cache: false }));
await open1(p, 'Bravo');
labs = await labelRects(p);
ok(labs.length === 2 && labs.every((l) => l.state === 'fallback' && /straight line/.test(l.text)) && await count(p, 'path.route-band.road') === 0, 'with no account and no cached road, both legs are dashed straight lines labelled as such');
ok(requests.every((u) => !/route-leg|heigit/i.test(u)), 'and no routing request is made');
await ctx.close();

// ================= opposite directions over one road: parallel lanes
const back = { ...mk('c', 'Charlie', 30.590, 114.300, { tripId: 't1', date: D2, order: 1 }) }; // the next day starts where the first day began
const loop = [items[0], items[1], back];
({ ctx, p } = await open({ list: loop, cache: false }));
await open1(p, 'Bravo');
const lanes = await p.evaluate(() => {
  const bands = [...document.querySelectorAll('path.route-band')];
  const info = bands.map((bd) => { const L = bd.getTotalLength(), m = bd.getPointAtLength(L / 2), a = bd.getPointAtLength(L / 2 - 4), c = bd.getPointAtLength(L / 2 + 4); return { m: { x: m.x, y: m.y }, dir: { x: c.x - a.x, y: c.y - a.y } }; });
  const chev = [...document.querySelectorAll('path.route-chev')].flatMap((c) => (c.getAttribute('d') || '').split('M').map((x) => (x.match(/-?\d+\.?\d*/g) || []).map(Number)).filter((d) => d.length >= 6)).map((d) => { // M x y L x y L x y: the tip is the middle point
    const xs = [d[0], d[2], d[4]], ys = [d[1], d[3], d[5]], pt = new DOMPoint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2), own = bands.findIndex((bd) => bd.isPointInStroke(pt));
    return { own, dx: d[2] - (d[0] + d[4]) / 2, dy: d[3] - (d[1] + d[5]) / 2 };
  });
  return { n: bands.length, info, chev };
});
ok(lanes.n === 2, 'an out-and-back pair of legs: two bands');
const sep = Math.hypot(lanes.info[0].m.x - lanes.info[1].m.x, lanes.info[0].m.y - lanes.info[1].m.y);
ok(sep >= 13 && sep <= 17, 'they run as two parallel lanes, side by side without overlapping (' + sep.toFixed(1) + ' px apart for 12 px bands)');
const dot = lanes.info[0].dir.x * lanes.info[1].dir.x + lanes.info[0].dir.y * lanes.info[1].dir.y;
ok(dot < 0, 'in opposite directions');
const g0 = lanes.chev.filter((c) => c.own === 0), g1 = lanes.chev.filter((c) => c.own === 1);
ok(g0.length >= 1 && g1.length >= 1 && g0.length + g1.length === lanes.chev.length, 'each lane keeps its own chevrons, all inside its band (' + g0.length + ' and ' + g1.length + ')');
ok(g0[0].dx * g1[0].dx + g0[0].dy * g1[0].dy < 0, 'and the chevrons of the two lanes point opposite ways');
labs = await labelRects(p);
ok(labs.length === 2 && noOverlap(labs), 'both lanes keep a label and the labels do not overlap');
await ctx.close();

// ================= performance guards: answers that arrive together share a draw, redraws do not pile up layers, a leg has one chevron path
{
  const day = Array.from({ length: 7 }, (_, i) => mk('q' + i, 'Stop ' + i, 30.585 + i * 0.004 + (i % 2) * 0.001, 114.296 + i * 0.006, { tripId: 't1', date: D, order: i + 1 }));
  const Q = Object.fromEntries(day.map((i) => [i.id, i]));
  for (let i = 1; i < day.length; i++) { const a = day[i - 1], c = day[i]; table[a.id + '>' + c.id] = { source: 'provider', route: { key: routeKey(leg(a, c)), from: a.id, to: c.id, geometry: encodePolyline(bend(a, c)), points: 4, distance_m: 1500, duration_s: 200 } }; }
  ({ ctx, p } = await open({ list: day, cache: false, backend: true, delay: 30, spy: true, zoom: 14 }));
  const t0 = Date.now();
  await p.evaluate(() => { window.__draws = 0; window.__casings = 0; });
  await pin(p, 'Stop 3').evaluate((e) => e.click()); await p.waitForSelector(MW + ' h3', { timeout: 8000 });
  ok(await count(p, 'path.route-band') >= 1 && Date.now() - t0 < 2500, 'selecting a stop draws its day at once, before any road has arrived');
  await p.waitForFunction(() => document.querySelectorAll('path.route-band.road').length === 6, null, { timeout: 8000 });
  await p.waitForTimeout(600);
  const draws = await p.evaluate(() => window.__draws);
  ok(draws >= 2 && draws <= 4, 'six road answers that arrive within a few hundred ms are drawn in a few draws, not one each (' + draws + ' draws for 6 answers; it was 7)');
  ok(await count(p, 'path.route-band.road') === 6 && await count(p, 'path.route-band.route-fallback') === 0, 'and every leg ends up as a road');
  const before = await p.evaluate(() => ({ band: document.querySelectorAll('path.route-band').length, casing: document.querySelectorAll('path.route-case').length, chev: document.querySelectorAll('path.route-chev').length, label: document.querySelectorAll('.route-label').length, overlay: document.querySelectorAll('.leaflet-overlay-pane path').length, marker: document.querySelectorAll('.leaflet-marker-pane > *').length, ev: Object.fromEntries(Object.entries(window.__map._events).map(([k, v]) => [k, v.length])) }));
  await p.evaluate(async () => { for (let i = 0; i < 8; i++) { window.__map.fire('moveend'); await new Promise((r) => setTimeout(r, 20)); } });
  const afterwards = await p.evaluate(() => ({ band: document.querySelectorAll('path.route-band').length, casing: document.querySelectorAll('path.route-case').length, chev: document.querySelectorAll('path.route-chev').length, label: document.querySelectorAll('.route-label').length, overlay: document.querySelectorAll('.leaflet-overlay-pane path').length, marker: document.querySelectorAll('.leaflet-marker-pane > *').length, ev: Object.fromEntries(Object.entries(window.__map._events).map(([k, v]) => [k, v.length])) }));
  ok(JSON.stringify(before) === JSON.stringify(afterwards), 'eight more redraws leave the same layers and the same map listeners (no pile-up): ' + JSON.stringify({ ...afterwards, ev: undefined }));
  ok(before.band === 6 && before.casing === 6 && before.chev <= 6 && before.overlay <= 6 * 3, 'a leg is a casing, a band and at most one chevron path: ' + before.overlay + ' paths for 6 legs');
  const calls0 = await p.evaluate(() => window.__routeCalls.length);
  await p.evaluate(async () => { const m = window.__map; m.setZoom(m.getZoom() + 1, { animate: false }); m.panBy([60, 40], { animate: false }); m.setZoom(m.getZoom() - 1, { animate: false }); await new Promise((r) => setTimeout(r, 300)); });
  ok(await p.evaluate(() => window.__routeCalls.length) === calls0 && await count(p, 'path.route-band.road') === 6, 'zooming and panning ask for no route and keep every road');
  await ctx.close();
}

// ================= credit, privacy note
({ ctx, p } = await open());
const credit = () => p.$eval('.leaflet-control-attribution', (e) => e.textContent);
await open1(p, 'Bravo');
ok(/openrouteservice.org by HeiGIT/.test(await credit()) && /OpenStreetMap/.test(await credit()), 'while a road route is drawn the credit names openrouteservice.org by HeiGIT beside the OpenStreetMap credit');
ok(await p.$eval('.leaflet-control-attribution a[href*="openrouteservice"]', (e) => e.rel.includes('noopener') && e.target === '_blank'), 'and links out safely');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, #marker-host .pop-close').click()); await p.waitForTimeout(300);
ok(!/openrouteservice/.test(await credit()) && /OpenStreetMap/.test(await credit()), 'with no road route on show the routing credit is gone and the existing credits remain');
await p.evaluate(() => document.getElementById('privacy-btn')?.click()); await p.waitForTimeout(300);
ok(await count(p, '#route-privacy-card') === 1 && /two coordinate pairs/.test(await p.textContent('#route-privacy-card')) && /Home marker is never sent/.test(await p.textContent('#route-privacy-card')), 'the privacy panel explains what is sent for routes, and that the Home marker never is');
await p.click('#route-clear'); await p.waitForTimeout(300);
ok(await p.evaluate((k) => localStorage.getItem(k), STORE_KEY) === null, 'its button forgets the routes kept on this device');
await ctx.close();

// ================= base-reference links stay straight, thin, dotted, nondirectional, and ask for nothing
({ ctx, p } = await open({ cache: false, backend: true }));
await open1(p, 'Bravo'); await p.waitForTimeout(1500);
const base = await p.$$eval('path.base-link', (e) => e.map((x) => ({ w: Number(x.getAttribute('stroke-width')), dash: x.getAttribute('stroke-dasharray'), d: (x.getAttribute('d').match(/L/g) || []).length })));
ok(base.length === 1 && base[0].w <= 2.5 && base[0].dash === '1 6' && base[0].d === 1, 'the link to the hotel is a thin dotted straight line (' + JSON.stringify(base) + ')');
ok(await p.locator('path.base-link').evaluate((e) => !e.classList.contains('route-band')) && await count(p, '.base-label') === 1, 'it is not a route band, and has its own compact label');
const bl = await p.$eval('.base-label', (e) => ({ t: e.textContent, a: e.getAttribute('aria-label') }));
ok(/km|m$/.test(bl.t) && !/straight line|min/.test(bl.t) && /^Straight-line distance to the .*bearing \d+ degrees/.test(bl.a), 'the label is the straight-line distance; its accessible text gives the bearing: ' + bl.t + ' / ' + bl.a);
const asked = await p.evaluate(() => window.__routeCalls.map((c) => c.from.id + '>' + c.to.id));
ok(asked.length === 2 && asked.every((k) => k === 'a>b' || k === 'b>c') && !asked.some((k) => /h/.test(k)), 'only the two itinerary legs were requested; the hotel reference link used no routing request (' + asked.join(', ') + ')');
const row = await p.$eval('.dist-row', (e) => ({ title: e.querySelector('.dist-txt').title, road: !!e.querySelector('.dist-road') }));
ok(/Straight line, bearing \d+° \(\w+\)/.test(row.title) && !row.road, 'the distance row states bearing and that it is not a driving distance, and shows no road line when none is saved');
await ctx.close();
// a saved road between the two places is shown as extra detail in the window, still without any request
const hotelLeg = rowOf(I.h, I.b, 2500, 420);
({ ctx, p } = await open({ cache: JSON.stringify({ v: 1, items: [hotelLeg] }), backend: true }));
await open1(p, 'Bravo'); await p.waitForTimeout(300);
const road = await p.$eval('.dist-row .dist-road', (e) => e.textContent).catch(() => null);
ok(road && /By road \(saved\): .* · 7 min/.test(road), 'an already saved road between the hotel and this marker is shown as supplemental detail: ' + road);
ok(await count(p, 'path.base-link') === 1 && await count(p, '.base-label') === 1 && !(await p.$eval('.base-label', (e) => /min/.test(e.textContent))), 'the on-map link and label are still the straight-line reference');
const asked2 = await p.evaluate(() => window.__routeCalls.map((c) => c.from.id + '>' + c.to.id));
ok(!asked2.some((k) => /h/.test(k)), 'and nothing was requested for it');
await ctx.close();

await b.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
