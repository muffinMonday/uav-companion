import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const OFFSET = 28800; // mock location is UTC+8
const errs = [];

// ---- deterministic Open-Meteo mock: values depend on the hour index and the latitude, so every number is checkable
const hourNow = () => Math.floor(((Date.now() + OFFSET * 1000) % 86400000) / 3600000);
const expected = (lat) => { const h = hourNow(), r = Math.round(lat * 100) / 100; return { temp: 10 + 0.5 * (h + 2) + r / 100, wind: 2 + 0.25 * (h + 2), gust: 5 + 0.5 * (h + 4) + r / 10 }; };
function respond(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
  const day = Math.floor((Date.now() + OFFSET * 1000) / 86400000) * 86400000;
  const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
  const one = (lat, i) => ({ latitude: lat, longitude: lons[i], utc_offset_seconds: OFFSET, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8',
    hourly: { time, temperature_2m: time.map((_, k) => 10 + 0.5 * k + lat / 100), wind_speed_10m: time.map((_, k) => 2 + 0.25 * k), wind_gusts_10m: time.map((_, k) => 5 + 0.5 * k + lat / 10) } });
  return lats.length === 1 ? one(lats[0], 0) : lats.map(one);
}
const items = (n, base = 0) => Array.from({ length: n }, (_, i) => ({ id: 'm' + (base + i), type: i % 2 ? 'hotel' : 'home', name: 'Seed ' + String.fromCharCode(65 + ((base + i) % 26)) + (base + i >= 26 ? base + i : ''), note: '',
  lat: 30.5 + (base + i) * 0.013 + 0.000123, lon: 114.2 + (base + i) * 0.011 + 0.000456, created: new Date(Date.UTC(2026, 10, 1, 0, 0, base + i)).toISOString() }));

const b = await chromium.launch({ channel: CHANNEL });
async function session({ seed = items(3), prefs, cache, delay = 0, fail = false, viewport = { width: 1200, height: 800 } } = {}) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true });
  await ctx.addInitScript(([s, pr, ca]) => {
    if (!sessionStorage.__seeded) {
      sessionStorage.__seeded = '1';
      if (s) localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: s }));
      if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr));
      if (ca) localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(ca));
    }
  }, [seed, prefs, cache]);
  const s = { ctx, reqs: [], fail, delay };
  await ctx.route('**/api.open-meteo.com/**', async (route) => {
    const url = route.request().url();
    s.reqs.push(url);
    if (s.fail) return route.abort();
    if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(respond(url)) });
  });
  s.page = await ctx.newPage();
  s.page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  s.page.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await s.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await s.page.waitForTimeout(900);
  await s.page.click('#tab-poi');
  return s;
}
const nLocs = (url) => new URL(url).searchParams.get('latitude').split(',').length;
const lsGet = (p, k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), k);
const openMarker = async (p, name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(900); };
const wxText = (p) => p.locator('.poi-pop .stats-wrap').innerText().then((t) => t.replace(/\s+/g, ' '));
const num = (t, re) => parseFloat(t.match(re)[1]);
const setAuto = async (p, on) => { await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])'); await (on ? p.check('#pv-auto') : p.uncheck('#pv-auto')); await p.click('#privacy-back'); };
const isAuto = async (p) => { await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])'); const v = await p.isChecked('#pv-auto'); await p.click('#privacy-back'); return v; };
const closePopup = (p) => p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());

// ============ A. default: off, nothing sent
let S = await session();
ok(S.reqs.length === 0, 'A: page load with markers and the toggle off sends no weather request');
ok(!(await isAuto(S.page)) && /Automatic weather is off\./.test(await S.page.textContent('#mw-status')), 'A: toggle is off by default and the status says nothing is sent');
await openMarker(S.page, 'Seed A');
ok(!(await S.page.locator('.poi-pop .stats-wrap').isVisible()), 'A: popup shows no weather summary while off');
await closePopup(S.page);
await S.page.click('#poi-center'); await S.page.waitForSelector('.poi-pop form'); await S.page.waitForTimeout(500);
ok(S.reqs.length === 0, 'A: placing a marker while off sends no request');
await S.ctx.close();

// ============ B. turn on: one batched request for all markers, coordinates rounded
S = await session();
await setAuto(S.page, true);
await S.page.waitForFunction(() => /last refreshed/i.test(document.getElementById('mw-status').textContent), null, { timeout: 8000 });
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 3, 'B: turning on makes ONE request covering all 3 markers');
const u = new URL(S.reqs[0]);
const allCoords = [...u.searchParams.get('latitude').split(','), ...u.searchParams.get('longitude').split(',')];
ok(allCoords.every((c) => /^-?\d+\.\d{2}$/.test(c)), 'B: coordinates are rounded to 2 decimals: ' + allCoords.slice(0, 3).join(' '));
ok(u.searchParams.get('latitude') === '30.50,30.51,30.53', 'B: seed (30.500123, ...) sent as 30.50 etc.');
console.log('     status:', await S.page.textContent('#mw-status'));
ok(/Weather last refreshed: \d{2}:\d{2}/.test(await S.page.textContent('#mw-status')), 'B: "Last refreshed" timestamp shown');
ok((await lsGet(S.page, 'uavzones.v1.prefs')).autoWeather === true, 'B: the on/off choice is remembered');
const seeds = items(3);
await openMarker(S.page, 'Seed B');
let t = await wxText(S.page);
console.log('     popup:', t);
const eB = expected(seeds[1].lat);
ok(/Next 5 h/.test(t), 'B: popup shows "Next 5 h"');
ok(Math.abs(num(t, /(-?[\d.]+) °C/) - eB.temp) < 0.06, `B: average temperature correct (${eB.temp.toFixed(2)})`);
ok(Math.abs(num(t, /(-?[\d.]+) m\/s AVG WIND/i) - eB.wind) < 0.06, `B: average wind correct (${eB.wind.toFixed(2)})`);
ok(Math.abs(num(t, /(-?[\d.]+) m\/s PEAK GUST/i) - eB.gust) < 0.06, `B: peak gust correct (${eB.gust.toFixed(2)})`);
ok(/updated \d{2}:\d{2}/i.test(t) && /forecast from \d{2}:00 local time there/.test(t), 'B: popup shows when it was updated and the forecast window');
const cache = await lsGet(S.page, 'uavzones.v1.wxcache');
ok(Object.keys(cache.items).length === 3 && typeof cache.lastBulk === 'number', 'B: cache holds 3 markers and the bulk-refresh time');
const pois = await lsGet(S.page, 'uavzones.v1.pois');
ok(pois.items.every((i) => Object.keys(i).sort().join() === 'created,id,lat,lon,name,note,type'), 'B: weather is not stored on the markers themselves');
const [dl] = await Promise.all([S.page.waitForEvent('download'), S.page.click('#poi-export')]); await dl.saveAs(SP + '/mw-export.geojson');
ok(!/temp|wind|gust/i.test(fs.readFileSync(SP + '/mw-export.geojson', 'utf8')), 'B: the GeoJSON export contains no weather');
await closePopup(S.page);

// ============ C. placing a marker while on: one request for that marker only
S.reqs.length = 0;
await S.page.click('#poi-center'); await S.page.waitForSelector('.poi-pop form');
await S.page.waitForFunction(() => true); await S.page.waitForTimeout(800);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 1, 'C: placing a marker requests weather for just that marker');
await S.page.click('.poi-pop button[type=submit]'); await S.page.waitForSelector('.poi-pop h3'); await S.page.waitForTimeout(400);
t = await wxText(S.page);
ok(/-?[\d.]+ °C/.test(t), 'C: the new marker\'s popup already shows its weather: ' + t.slice(0, 70));
await closePopup(S.page);

// ============ D. reload within 30 min: nothing fetched, cached values shown
S.reqs.length = 0;
await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1200); await S.page.click('#tab-poi');
ok(S.reqs.length === 0, 'D: reload within 30 minutes sends no request');
ok(await isAuto(S.page), 'D: toggle still on after reload');
await openMarker(S.page, 'Seed A'); t = await wxText(S.page);
ok(/updated \d{2}:\d{2}/i.test(t) && /°C/.test(t), 'D: cached values and their time are shown without a new request');
await closePopup(S.page);

// ============ E. last bulk refresh 31 minutes ago: one request for everything
let c = await lsGet(S.page, 'uavzones.v1.wxcache'); const old31 = Date.now() - 31 * 60000;
await S.page.evaluate(([v]) => { const d = JSON.parse(localStorage.getItem('uavzones.v1.wxcache')); d.lastBulk = v; localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(d)); }, [old31]);
S.reqs.length = 0;
await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1500);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 4, 'E: 31 minutes after the last bulk refresh, a reload refreshes all 4 markers in one request');
c = await lsGet(S.page, 'uavzones.v1.wxcache');
ok(Date.now() - c.lastBulk < 20000, 'E: bulk-refresh time updated');
// 29 minutes: not due
await S.page.evaluate(([v]) => { const d = JSON.parse(localStorage.getItem('uavzones.v1.wxcache')); d.lastBulk = v; localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(d)); }, [Date.now() - 29 * 60000]);
S.reqs.length = 0; await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1200);
ok(S.reqs.length === 0, 'E: 29 minutes after the last bulk refresh, a reload sends nothing');

// ============ F. a marker with no cached weather is fetched even when the bulk refresh is recent
await S.page.evaluate(() => { const d = JSON.parse(localStorage.getItem('uavzones.v1.wxcache')); delete d.items.m1; localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(d)); });
S.reqs.length = 0; await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1500);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 1, 'F: only the marker missing from the cache is fetched');

// ============ G. refresh fails: earlier values kept and labelled, retry on next load
const oldBulk = Date.now() - 40 * 60000;
await S.page.evaluate(([v]) => { const d = JSON.parse(localStorage.getItem('uavzones.v1.wxcache')); d.lastBulk = v; localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(d)); }, [oldBulk]);
S.fail = true; S.reqs.length = 0;
await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1500); await S.page.click('#tab-poi');
console.log('     status:', await S.page.textContent('#mw-status'));
ok(/latest refresh failed, showing earlier values/.test(await S.page.textContent('#mw-status')), 'G: status says the refresh failed and earlier values are shown');
await openMarker(S.page, 'Seed A'); t = await wxText(S.page);
ok(/-?[\d.]+ °C/.test(t) && /latest refresh failed/.test(t), 'G: popup still shows the earlier values, labelled as from a failed refresh');
ok((await lsGet(S.page, 'uavzones.v1.wxcache')).lastBulk === oldBulk, 'G: a failed bulk refresh does not count, so the next load tries again');
await closePopup(S.page);
S.fail = false; S.reqs.length = 0;
await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1500);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 4, 'G: the next load retries the full refresh');

// ============ H. turning it off: forgets the data, sends nothing
await S.page.click('#tab-poi'); await setAuto(S.page, false); await S.page.waitForTimeout(400);
ok(Object.keys((await lsGet(S.page, 'uavzones.v1.wxcache')).items).length === 0, 'H: turning off clears the cached weather');
ok(/Automatic weather is off\./.test(await S.page.textContent('#mw-status')), 'H: status says off');
await openMarker(S.page, 'Seed A'); ok(!(await S.page.locator('.poi-pop .stats-wrap').isVisible()), 'H: popup summary hidden'); await closePopup(S.page);
S.reqs.length = 0; await S.page.click('#poi-center'); await S.page.waitForSelector('.poi-pop form'); await S.page.waitForTimeout(500);
await S.page.reload({ waitUntil: 'networkidle' }); await S.page.waitForTimeout(1000);
ok(S.reqs.length === 0 && !(await lsGet(S.page, 'uavzones.v1.prefs')).autoWeather, 'H: nothing sent after turning off, including after a reload');
await S.ctx.close();

// ============ I. first fetch fails with no earlier data
S = await session({ fail: true });
await setAuto(S.page, true); await S.page.waitForTimeout(1500);
ok(/Could not fetch weather yet/.test(await S.page.textContent('#mw-status')), 'I: no data and a failure: status says so');
await openMarker(S.page, 'Seed A'); ok(/Weather unavailable right now/.test(await wxText(S.page)), 'I: popup says weather is unavailable, not a made-up value');
await S.ctx.close();

// ============ J. 120 markers are fetched in batches of 50, one after another
S = await session({ seed: items(120) });
await setAuto(S.page, true); await S.page.waitForFunction(() => /last refreshed/i.test(document.getElementById('mw-status').textContent), null, { timeout: 15000 });
ok(S.reqs.map(nLocs).join(',') === '50,50,20', 'J: 120 markers go out as requests of 50, 50 and 20: ' + S.reqs.map(nLocs).join(','));
ok(Object.keys((await lsGet(S.page, 'uavzones.v1.wxcache')).items).length === 120, 'J: all 120 cached');
await S.ctx.close();

// ============ K. wind limit highlights the peak gust
S = await session({ prefs: { autoWeather: true } });
await S.page.waitForTimeout(1500);
await S.page.evaluate(() => localStorage.setItem('uavzones.windLimit', '1'));
await openMarker(S.page, 'Seed A');
ok((await S.page.locator('.poi-pop .stat.over').count()) === 1, 'K: peak gust above the wind limit is shown in red');
await S.ctx.close();

// ============ L. import: only imported markers are fetched
S = await session({ prefs: { autoWeather: true } });
await S.page.waitForTimeout(1500); S.reqs.length = 0;
fs.writeFileSync(SP + '/mw-import.geojson', JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'Imp1' }, geometry: { type: 'Point', coordinates: [114.5, 30.7] } },
  { type: 'Feature', properties: { name: 'Imp2' }, geometry: { type: 'Point', coordinates: [114.6, 30.8] } }] }));
await S.page.setInputFiles('#poi-file', SP + '/mw-import.geojson'); await S.page.waitForTimeout(1500);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 2, 'L: importing 2 markers requests weather for just those 2');
await S.ctx.close();

// ============ M. moving a marker refetches it at its new spot
S = await session({ prefs: { autoWeather: true } });
await S.page.waitForTimeout(1500);
await S.page.click('#poi-list .poi-item:has-text("Seed A")'); await S.page.waitForSelector('.poi-pop h3'); await S.page.waitForTimeout(1000); await closePopup(S.page);
await S.page.check('#poi-edit');
const pin = await S.page.evaluate(() => { const r = document.querySelector('.poi-pin').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
S.reqs.length = 0;
await S.page.mouse.move(pin.x, pin.y); await S.page.mouse.down(); await S.page.waitForTimeout(650); await S.page.mouse.move(pin.x + 40, pin.y + 120, { steps: 8 }); await S.page.mouse.up(); await S.page.waitForTimeout(1200);
ok(S.reqs.length === 1 && nLocs(S.reqs[0]) === 1, 'M: dropping a moved marker requests weather for its new position');
await S.ctx.close();

// ============ N. popup updates in place when data arrives while it is open
S = await session({ delay: 2500 });
await setAuto(S.page, true); await S.page.waitForTimeout(300);
await openMarker(S.page, 'Seed A');
ok(/…/.test(await wxText(S.page)), 'N: popup shows "loading" while the request is in flight');
await S.page.waitForFunction(() => /°C/.test(document.querySelector('.poi-pop .stats-wrap')?.textContent || ''), null, { timeout: 8000 });
ok(true, 'N: the open popup fills in by itself when the data arrives');
await S.ctx.close();

console.log('errors:', errs.length ? errs : 'none');
await b.close();
