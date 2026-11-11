// Snow in the weather: a snow strip, snow on the ground and a cold hint only where they apply; the forecast table; trip days. Singapore sees none of it.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const OFFSET = 28800;
const errs = [];
const hourNow = () => Math.floor(((Date.now() + OFFSET * 1000) % 86400000) / 3600000);
const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// replies by latitude: 46 is a cold snowy place, 1 is Singapore, 30 is a rainy day with a flurry
function respond(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(',').map(Number);
  const day = Math.floor((Date.now() + OFFSET * 1000) / 86400000) * 86400000;
  const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
  const win = (vals) => time.map((_, k) => (k >= hourNow() && k < hourNow() + 12 ? vals[(k - hourNow()) % vals.length] : 0));
  if (u.searchParams.get('daily')?.includes('weather_code')) { // the trip days
    const times = Array.from({ length: 16 }, (_, k) => iso(k));
    const one = (lat) => ({ utc_offset_seconds: OFFSET, timezone_abbreviation: 'GMT+8', daily: { time: times, weather_code: times.map(() => (lat > 40 ? 73 : 61)), temperature_2m_max: times.map(() => 0), temperature_2m_min: times.map(() => -5), precipitation_probability_max: times.map(() => 60), wind_speed_10m_max: times.map(() => 4), snowfall_sum: times.map((_, k) => (lat > 40 && k === 5 ? 3.2 : 0)) } });
    return lats.length === 1 ? one(lats[0]) : lats.map(one);
  }
  const one = (lat) => {
    const snowy = lat > 40, sg = lat < 5;
    const hourly = { time, temperature_2m: time.map(() => (snowy ? -2 : sg ? 29 : 12)), wind_speed_10m: time.map(() => 3), wind_gusts_10m: time.map(() => 6), wind_speed_120m: time.map(() => 5), visibility: time.map(() => 10000) };
    if (snowy) { hourly.precipitation_probability = win([60, 80, 90, 70, 40]); hourly.precipitation = win([0.4, 1.2, 0.8, 0.2, 0.1]); hourly.snowfall = win([0.4, 1.2, 0.8, 0.2, 0.1]); hourly.snow_depth = time.map(() => 0.12); }
    else if (sg) { hourly.precipitation_probability = win([10, 40, 70, 30, 0]); hourly.precipitation = win([0, 0.2, 1.4, 0.1, 0]); hourly.snowfall = win([0, 0, 0, 0, 0]); hourly.snow_depth = time.map(() => 0); }
    else { hourly.precipitation_probability = win([50, 60, 70, 60, 50]); hourly.precipitation = win([2, 3, 4, 3, 2]); hourly.snowfall = win([0, 0.3, 0, 0, 0]); hourly.snow_depth = time.map(() => 0); }
    return { latitude: lat, utc_offset_seconds: OFFSET, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8', hourly, daily: { time: [iso(0)], sunrise: [iso(0) + 'T06:30'], sunset: [iso(0) + 'T18:00'] } };
  };
  return lats.length === 1 ? one(lats[0]) : lats.map(one);
}
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [mk('sn', 'Snowfield', 46.0, 7.0, { tripId: 't1', date: iso(5), order: 1 }), mk('sg', 'Marina Bay', 1.29, 103.85), mk('ra', 'Rainy Hill', 30.5, 114.2)];
const trips = [{ id: 't1', name: 'Alps', startDate: iso(5), endDate: iso(6), description: '', color: '#3949ab', created: '2026-01-01T00:00:00.000Z' }];

const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(([po, tr]) => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ autoWeather: true, basemap: 'osm' })); }, [items, trips]);
await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(respond(route.request().url())) }));
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
await p.waitForTimeout(400);
const open = async (name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 }); await p.waitForTimeout(900); };
const close = async () => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300); };
const text = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText ?? '', sel);

await open('Snowfield');
ok(/Snow: 2\.7 cm/.test(await text('.poi-pop .rain-head')) && !/Rain/.test(await text('.poi-pop .rain-head')), 'a snowy place gets a Snow strip, not a rain strip: ' + (await text('.poi-pop .rain-head')).replace(/\n/g, ' '));
ok(/Expected snowfall in cm/.test(await p.getAttribute('.poi-pop .rain-strip', 'aria-label')), 'and the strip says so for screen readers');
ok(/12 cm of snow on the ground/.test(await text('.poi-pop .stats-wrap')), 'snow on the ground shows as a line, not a tile: ' + (await text('.poi-pop .stats-wrap')).split('\n').filter((x) => /❄/.test(x)).join(''));
ok(/Cold: batteries lose capacity/.test(await text('.poi-pop .stats-wrap')), 'at -2 °C the cold hint appears');
ok((await p.locator('.poi-pop .stats-wrap .stat').count()) <= 4, 'the tile grid is still at most four tiles');
await p.click('.poi-pop .wx-btn'); await p.waitForSelector('#weather table', { timeout: 8000 });
ok(/Snow/.test(await text('#weather thead')) && /12 cm of snow on the ground/.test(await text('#weather .wx-sub')), 'the forecast table has a Snow column and mentions the snow cover');
await p.click('#weather .wx-close'); await close();

await open('Marina Bay');
ok(/Rain chance up to 70%/.test(await text('.poi-pop .rain-head')) && !/snow|Snow|Cold/.test(await text('.poi-pop .stats-wrap')), 'Singapore: the rain strip, and no snow line or cold hint anywhere');
await p.click('.poi-pop .wx-btn'); await p.waitForSelector('#weather table', { timeout: 8000 });
ok(!/Snow/.test(await text('#weather thead')), 'and no Snow column in its forecast table');
await p.click('#weather .wx-close'); await close();

await open('Rainy Hill');
ok(/Rain chance up to 70%/.test(await text('.poi-pop .rain-head')) && !/Snow/.test(await text('.poi-pop .stats-wrap')), 'a flurry inside a rainy spell stays rain');
await close();

const cache = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.wxcache')).items);
const snowEntry = Object.values(cache).find((e) => e.sd >= 0.1);
ok(snowEntry && Array.isArray(snowEntry.sf) && snowEntry.sf.length === 5 && Math.abs(snowEntry.sd - 0.12) < 1e-9, 'the cache keeps the hourly snowfall and the depth');

// trip days
await p.click('#tab-trips'); await p.waitForTimeout(500);
await p.locator('#trips-list .trip-card .trip-card-head').click(); await p.waitForTimeout(1800);
const day = await text('#trip-detail .flip-body .plan-wx');
ok(/snow 3.2 cm/.test(day) && !/rain/.test(day), 'the trip day shows snowfall in place of the rain chance: ' + day);
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
