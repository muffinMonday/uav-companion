// Rain chance in the marker window: peak and the hour strip, the fallbacks, and that nothing shows when weather is off.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const OFFSET = 28800; // mock location is UTC+8
const errs = [];
const hourNow = () => Math.floor(((Date.now() + OFFSET * 1000) % 86400000) / 3600000);
const hh = (k) => String((hourNow() + k) % 24).padStart(2, '0') + ':00';

// each marker gets a different kind of reply, chosen by its latitude (30.50 none, 30.51 chance, 30.52 millimetres only)
const kind = (lat) => { const k = Math.round(lat * 100) % 100; return k % 3; };
function respond(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
  const day = Math.floor((Date.now() + OFFSET * 1000) / 86400000) * 86400000;
  const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
  const base = (k0) => time.map((_, k) => (k >= hourNow() && k < hourNow() + 5 ? k0[k - hourNow()] : 0));
  const one = (lat, i) => {
    const hourly = { time, temperature_2m: time.map(() => 12), wind_speed_10m: time.map(() => 3), wind_gusts_10m: time.map(() => 6) };
    const t = kind(lat);
    if (t === 0) { hourly.precipitation_probability = base([10, 40, 70, 30, 0]); hourly.precipitation = base([0, 0.2, 1.4, 0.1, 0]); }
    else if (t === 1) { hourly.precipitation = base([0, 0.3, 0.9, 0, 0]); }
    return { latitude: lat, longitude: lons[i], utc_offset_seconds: OFFSET, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8', hourly };
  };
  return lats.length === 1 ? one(lats[0], 0) : lats.map(one);
}
const items = [
  { id: 'n', type: 'photo', name: 'Nothing', note: '', lat: 30.5, lon: 114.2, created: '2026-11-01T00:00:00.000Z' },
  { id: 'c', type: 'photo', name: 'Chance', note: '', lat: 30.51, lon: 114.21, created: '2026-11-01T00:00:01.000Z' },
  { id: 'm', type: 'photo', name: 'Millimetres', note: '', lat: 30.52, lon: 114.22, created: '2026-11-01T00:00:02.000Z' },
];

const b = await chromium.launch({ channel: CHANNEL });
async function session({ prefs = { autoWeather: true }, cache, viewport = { width: 1200, height: 800 } } = {}) {
  const ctx = await b.newContext({ viewport });
  await ctx.addInitScript(([s, pr, ca]) => {
    if (!sessionStorage.__seeded) {
      sessionStorage.__seeded = '1';
      localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: s }));
      if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr));
      if (ca) localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(ca));
    }
  }, [items, prefs, cache]);
  const s = { ctx, reqs: [] };
  await ctx.route('**/api.open-meteo.com/**', async (route) => {
    s.reqs.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(respond(route.request().url())) });
  });
  s.page = await ctx.newPage();
  s.page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  s.page.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await s.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await s.page.waitForTimeout(1200);
  await s.page.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await s.page.waitForTimeout(300);
  return s;
}
const openMarker = async (p, name) => {
  await p.click(`#poi-list .poi-item:has-text("${name}")`);
  await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 });
  await p.waitForTimeout(700);
};
const rain = (p) => p.evaluate(() => {
  const r = document.querySelector('.poi-pop .rain');
  if (!r) return null;
  return {
    head: r.querySelector('.rain-head').textContent,
    cols: [...r.querySelectorAll('.rain-col')].map((c) => ({ v: c.querySelector('.rain-v').textContent, t: c.querySelector('.rain-t').textContent, h: c.querySelector('.rain-bar').getBoundingClientRect().height })),
    aria: r.querySelector('.rain-strip')?.getAttribute('aria-label') || null,
    width: r.getBoundingClientRect().width, pop: document.querySelector('.leaflet-popup-content').getBoundingClientRect().width,
  };
});

// ---- chance of rain
let S = await session();
let p = S.page;
await p.waitForFunction(() => /last refreshed/i.test(document.getElementById('mw-status').textContent), null, { timeout: 8000 });
ok(S.reqs.some((u) => /precipitation_probability/.test(u)), 'the weather request now includes the rain chance');
await openMarker(p, 'Chance');
let r = await rain(p);
ok(r && /Rain chance up to 70%/.test(r.head) && r.head.includes(hh(2)), 'a place with a chance: "up to 70% around ' + hh(2) + '": ' + (r && r.head));
ok(r.cols.length === 5 && r.cols.map((c) => c.v).join() === '10%,40%,70%,30%,0%', 'the strip has five hours with 10, 40, 70, 30 and 0%: ' + r.cols.map((c) => c.v));
ok(r.cols.map((c) => c.t).join() === [0, 1, 2, 3, 4].map((k) => hh(k).slice(0, 2)).join(), 'each bar is labelled with its hour');
const hs = r.cols.map((c) => c.h);
ok(hs[2] > hs[1] && hs[1] > hs[3] && hs[3] > hs[0] && hs[0] > hs[4] && hs[2] > 20, 'bar heights follow the chance (70 > 40 > 30 > 10 > 0): ' + hs.map((x) => Math.round(x)));
ok(/Rain chance by hour/.test(r.aria) && r.aria.includes(hh(2) + ' 70%'), 'the strip has a text equivalent for screen readers');
ok(r.width <= r.pop + 1, 'the rain block fits inside the window');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p.waitForTimeout(400);

// ---- only millimetres
await openMarker(p, 'Millimetres');
r = await rain(p);
ok(r && /Rain expected: 1\.2 mm/.test(r.head) && /no chance given/.test(r.head), 'a place with only expected rain: "1.2 mm", noting that no chance was given: ' + (r && r.head));
ok(r.cols.map((c) => c.v).join() === '0.0,0.3,0.9,0.0,0.0', 'the bars show millimetres per hour: ' + r.cols.map((c) => c.v));
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p.waitForTimeout(400);

// ---- nothing from the model
await openMarker(p, 'Nothing');
r = await rain(p);
ok(r && /Rain chance unavailable/.test(r.head) && r.cols.length === 0, 'a place the model has nothing for: says unavailable, no empty bars');
await S.ctx.close();

// ---- weather off: no rain block, no request
S = await session({ prefs: {} }); p = S.page;
await openMarker(p, 'Chance');
ok((await rain(p)) === null && S.reqs.length === 0, 'with automatic weather off there is no rain block and nothing was requested');
await S.ctx.close();

// ---- a cache entry from before rain existed: no rain block until the next refresh
const oldEntry = { t: Date.now(), temp: 11, wind: 2, gust: 4, n: 5, start: hh(0), tz: 'GMT+8' };
S = await session({ cache: { v: 1, lastBulk: Date.now(), items: { c: oldEntry } } }); p = S.page;
await openMarker(p, 'Chance');
ok((await rain(p)) === null && /Avg temp/.test(await p.textContent('.poi-pop .stats-wrap')), 'an older cached entry still shows its temperature and wind, and no rain block');
await S.ctx.close();

// ---- phone
S = await session({ viewport: { width: 360, height: 740 } }); p = S.page;
await p.waitForFunction(() => /last refreshed/i.test(document.getElementById('mw-status').textContent), null, { timeout: 8000 });
await openMarker(p, 'Chance');
r = await rain(p);
const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
ok(r && r.width <= r.pop + 1 && !over, 'at 360 px the rain block fits and the page does not scroll sideways');
await p.screenshot({ path: `${SP}/rain-phone.png` });
await p.evaluate(() => { document.querySelector('.leaflet-popup-content').scrollTop = 9999; }); await p.waitForTimeout(200);
await p.screenshot({ path: `${SP}/rain-phone2.png` });
await S.ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
