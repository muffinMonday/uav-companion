// The same place saved for several dates: the x2 badge, the visit chips, Add visit, the AI import, and one weather request per spot.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const OFFSET = 28800;

const tower = (id, extra) => ({ id, type: 'photo', name: 'Yellow Crane Tower', note: '', lat: 30.5446, lon: 114.3025, created: `2026-11-0${id.length}T00:00:00.000Z`, tripId: 't1', ...extra });
const pois = { v: 1, items: [
  tower('a', { date: '2026-11-12', day: 1, order: 2 }),
  tower('bb', { date: '2026-11-14', day: 3, order: 1 }),
  { id: 'c', type: 'hotel', name: 'Lake Hotel', note: '', lat: 30.9, lon: 113.9, created: '2026-11-03T00:00:00.000Z', tripId: 't1', date: '2026-11-12', endDate: '2026-11-14' },
] };
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

function respond(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
  const day = Math.floor((Date.now() + OFFSET * 1000) / 86400000) * 86400000;
  const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
  const one = (lat, i) => ({ latitude: lat, longitude: lons[i], utc_offset_seconds: OFFSET, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8',
    hourly: { time, temperature_2m: time.map(() => 12), wind_speed_10m: time.map(() => 3), wind_gusts_10m: time.map(() => 6) } });
  return lats.length === 1 ? one(lats[0], 0) : lats.map(one);
}

const b = await chromium.launch({ channel: CHANNEL });
async function session({ prefs = null, viewport = { width: 1200, height: 800 } } = {}) {
  const ctx = await b.newContext({ viewport });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume(); // fixtures are dated around 12 to 14 Nov 2026: completed trips are off the map from 15 Nov
  await ctx.addInitScript(([po, tr, pr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify(po)); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr)); } }, [pois, trips, prefs]);
  const s = { ctx, reqs: [] };
  await ctx.route('**/api.open-meteo.com/**', (route) => { s.reqs.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(respond(route.request().url())) }); });
  s.p = await ctx.newPage();
  s.p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  s.p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await s.p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1200);
  if (await s.p.evaluate(() => !document.getElementById('panel').hidden)) await s.p.click('#panel-close');
  await s.p.waitForTimeout(300);
  return s;
}
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const badges = (p) => p.$$eval('.poi-pin', (els) => els.map((e) => ({ t: e.getAttribute('title'), v: e.querySelector('.visits')?.textContent || '' })));
const openFirst = async (p) => {
  const pin = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Yellow Crane Tower"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(pin.x, pin.y);
  try { await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Yellow Crane Tower', null, { timeout: 8000 }); } catch (e) { console.log('DBG', JSON.stringify(await p.evaluate(() => [document.querySelectorAll('.leaflet-popup').length, document.querySelector('.leaflet-popup')?.innerText.slice(0, 200), document.getElementById('toast').textContent]))); throw e; }
  await p.waitForTimeout(1200);
};
const chips = (p) => p.$$eval('.pop-visits .visit-chip', (c) => c.map((x) => ({ t: x.textContent, cur: x.getAttribute('aria-current') === 'true' })));

// ================= badge, chips
let S = await session(); let p = S.p;
let bd = await badges(p);
ok(bd.filter((x) => x.t === 'Yellow Crane Tower').every((x) => x.v === '×2') && bd.find((x) => x.t === 'Lake Hotel').v === '', 'both pins of the shared place show ×2; the hotel shows nothing');
await openFirst(p);
let ch = await chips(p);
ok(ch.length === 2 && /2 visits here/.test(await p.textContent('.pop-visits-label')), 'the window lists the two visits');
ok(/Day 1 · Stop 2 · Thu, Nov 12/.test(ch[0].t) && /Day 3 · Stop 1 · Sat, Nov 14/.test(ch[1].t), 'in date order, with day, stop and date: ' + ch.map((c) => c.t).join(' | '));
const first = await p.textContent('.poi-pop .pop-type');
const shown = ch.findIndex((c) => c.cur);
ok(ch.filter((c) => c.cur).length === 1, 'exactly one visit is marked as the one being shown');
await p.click('.pop-visits .visit-chip:not([aria-current])'); await p.waitForTimeout(900);
ch = await chips(p);
ok((await p.locator('.leaflet-popup').count()) === 1 && ch.findIndex((c) => c.cur) === 1 - shown && (await p.textContent('.poi-pop .pop-type')) !== first, 'tapping the other visit switches the window to it (still one window, other day and stop)');
ok(new RegExp(shown === 0 ? 'Sat, Nov 14' : 'Thu, Nov 12').test(await p.textContent('.poi-pop .pop-dates')), 'it shows the date of that visit');

// ================= add visit
await p.click('.poi-pop .btn:has-text("Add visit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(500);
let items = await stored(p);
const added = items.find((i) => i.id !== 'a' && i.id !== 'bb' && i.id !== 'c');
ok(items.length === 4 && added && added.name === 'Yellow Crane Tower' && added.lat === 30.5446 && added.lon === 114.3025 && added.tripId === 't1', 'Add visit saves the same place again, in the same trip');
ok(!('date' in added) && !('day' in added) && !('order' in added) && !('endDate' in added), '... with no date, day or stop yet');
ok((await p.locator('.poi-pop form').count()) === 1 && (await p.inputValue('.poi-pop form input[type=text]')) === 'Yellow Crane Tower', 'and opens its form to set them');
await p.fill('.poi-pop .date-field input >> nth=0', '2026-11-13');
await p.click('.poi-pop form button[type=submit]'); await p.waitForTimeout(800);
bd = await badges(p);
ok(bd.filter((x) => x.t === 'Yellow Crane Tower').length === 3 && bd.filter((x) => x.t === 'Yellow Crane Tower').every((x) => x.v === '×3'), 'all three pins now show ×3');
ch = await chips(p);
ok(ch.length === 3 && /Nov 12/.test(ch[0].t) && /Nov 13/.test(ch[1].t) && /Nov 14/.test(ch[2].t) && ch[1].cur, 'the three visits are listed in date order, the new one marked: ' + ch.map((c) => c.t).join(' | '));
// delete it again
await p.click('.poi-pop .btn.danger'); await p.click('.poi-pop .btn.danger'); await p.waitForTimeout(600);
bd = await badges(p);
ok((await stored(p)).length === 3 && bd.filter((x) => x.t === 'Yellow Crane Tower').every((x) => x.v === '×2'), 'deleting one visit takes the others back to ×2');
// a Home marker has no Add visit
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('uavzones.v1.pois')); s.items.push({ id: 'h', type: 'residence', name: 'Flat', note: '', lat: 30.4, lon: 114.2, created: '2026-11-05T00:00:00.000Z' }); localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]').click()); await p.waitForTimeout(300);
await p.click('#poi-list .poi-item:has-text("Flat")'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Flat', null, { timeout: 8000 }); await p.waitForTimeout(600);
ok((await p.locator('.poi-pop .btn:has-text("Add visit")').count()) === 0 && (await badges(p)).find((x) => x.t === 'Flat').v === '', 'the Home marker has no Add visit and no badge');
await S.ctx.close();

// ================= weather: one request per spot
S = await session({ prefs: { autoWeather: true } }); p = S.p;
await p.waitForTimeout(1500);
const lat = S.reqs.map((u) => new URL(u).searchParams.get('latitude')).find((l) => l);
ok(lat && lat.split(',').length === 2, 'weather: three markers at two spots are requested as two locations: ' + lat);
await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]').click()); await p.waitForTimeout(300);
await p.click('#poi-list .poi-item:has-text("Yellow Crane Tower") >> nth=0'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Yellow Crane Tower', null, { timeout: 8000 }); await p.waitForTimeout(800);
ok(/12\.0 °C/.test(await p.textContent('.poi-pop .stats-wrap')), 'weather: the first visit shows the shared forecast');
await p.click('.pop-visits .visit-chip:not([aria-current])'); await p.waitForTimeout(900);
ok(/12\.0 °C/.test(await p.textContent('.poi-pop .stats-wrap')), 'weather: and so does the other visit');
await S.ctx.close();

// ================= AI import: another visit is added, a repeat is not
S = await session(); p = S.p;
const feat = (name, date, lon, lat) => ({ type: 'Feature', properties: { name, ...(date ? { date } : {}) }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const text = JSON.stringify({ type: 'FeatureCollection', features: [
  feat('Yellow Crane Tower', '2026-11-16', 114.3025, 30.5446), // another date: another visit
  feat('Yellow Crane Tower', '2026-11-12', 114.3025, 30.5446), // same date: already saved
  feat('Yellow Crane Tower', null, 114.3025, 30.5446),          // no date: already saved
  feat('East Lake', '2026-11-13', 114.37, 30.55),
] });
await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click()); await p.waitForTimeout(300);
await p.fill('#ai-text', text); await p.click('#ai-preview-btn'); await p.waitForTimeout(500);
const rows = await p.$$eval('#ai-preview .prow', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
console.log('     rows:', JSON.stringify(rows));
ok(/another visit/i.test(rows[0]) && !/Already saved/.test(rows[0]), 'import preview: the same place on a new date says "another visit"');
ok(/Already saved/.test(rows[1]) && /Already saved/.test(rows[2]), 'import preview: the same place on a date you have, or with no date, is "Already saved"');
ok(!/another visit|Already saved/.test(rows[3]), 'import preview: a new place has neither note');
await p.click('#ai-add'); await p.waitForTimeout(800);
items = await stored(p);
ok(items.length === 5 && items.filter((i) => i.name === 'Yellow Crane Tower').length === 3 && items.some((i) => i.date === '2026-11-16'), 'import: the new visit and the new place were added (5 markers), the repeats were not');
await p.screenshot({ path: `${SP}/visits-import.png` });
await S.ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
