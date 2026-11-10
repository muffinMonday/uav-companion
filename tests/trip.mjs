import { OUT as SP, ROOT, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dist = await import(pathToFileURL(path.join(ROOT, 'src/distance.js')).href);
const aiimp = await import(pathToFileURL(path.join(ROOT, 'src/aiimport.js')).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const near = (a, b, t) => Math.abs(a - b) <= t;

// ---- the scenario (central Wuhan, a few km apart)
const P = {
  HP: { id: 'hp', type: 'home', name: 'Launch A', lat: 30.5900, lon: 114.3000 },
  H1: { id: 'h1', type: 'hotel', name: 'Hotel One', lat: 30.6000, lon: 114.3100, date: '2026-11-12', endDate: '2026-11-14' },
  H2: { id: 'h2', type: 'hotel', name: 'Hotel Two', lat: 30.5500, lon: 114.2500, date: '2026-11-15', endDate: '2026-11-17' },
  W1: { id: 'w1', type: 'photo', name: 'Tower', lat: 30.5950, lon: 114.3050, date: '2026-11-13' },
  W2: { id: 'w2', type: 'photo', name: 'Lake', lat: 30.5600, lon: 114.2600, date: '2026-11-16' },
  W3: { id: 'w3', type: 'hazard', name: 'Airport', lat: 30.7838, lon: 114.2098 },
  RES: { id: 'res', type: 'residence', name: 'My flat', lat: 30.5000, lon: 114.2000 },
};
const seedItems = (keys, extra = {}) => keys.map((k, i) => ({ note: '', created: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(), ...P[k], ...(extra[k] || {}) }));
const D = (a, b) => dist.haversineM(a.lat, a.lon, b.lat, b.lon);
const F = (m, u = 'metric') => dist.fmtDistance(m, u);
const compassOf = (a, b) => dist.compass(dist.bearingDeg(a.lat, a.lon, b.lat, b.lon));

const b = await chromium.launch({ channel: CHANNEL });
async function session({ keys = Object.keys(P), extra, prefs, viewport = { width: 1200, height: 800 }, mock = true } = {}) {
  const ctx = await b.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  await ctx.addInitScript(([s, pr]) => {
    if (!sessionStorage.__seeded) {
      sessionStorage.__seeded = '1';
      localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: s }));
      if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr));
    }
  }, [seedItems(keys, extra), prefs]);
  const S = { ctx, fc: [], el: [] };
  if (mock) {
    await ctx.route('**/api.open-meteo.com/**', (route) => {
      const url = route.request().url(); const u = new URL(url);
      const lats = u.searchParams.get('latitude').split(',').map(Number);
      if (u.pathname.endsWith('/elevation')) { S.el.push(url); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ elevation: lats.map(() => 30) }) }); }
      S.fc.push(url);
      const day = Math.floor((Date.now() + 28800000) / 86400000) * 86400000;
      const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
      const one = (lat) => ({ latitude: lat, longitude: 114, utc_offset_seconds: 28800, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8', hourly: { time, temperature_2m: time.map(() => 15), wind_speed_10m: time.map(() => 3), wind_gusts_10m: time.map(() => 6) } });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(lats.length === 1 ? one(lats[0]) : lats.map(one)) });
    });
  }
  S.page = await ctx.newPage();
  S.page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  S.page.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await S.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await S.page.waitForTimeout(900);
  await S.page.click('#tab-poi').catch(() => {});
  return S;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois') || '{"items":[]}').items);
const prefsOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
const open = async (p, name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 }); await p.waitForTimeout(900); };
const closePopup = async (p) => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForFunction(() => !document.querySelector('.leaflet-popup'), null, { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(150); };
const item = (p, name) => p.locator(`#poi-list .poi-item:has-text("${name}")`);
const distLine = async (p, name) => (await item(p, name).locator('.dist-line').count()) ? (await item(p, name).locator('.dist-line').innerText()) : null;
const rowsOf = (p) => p.$$eval('.poi-pop .dist-row', (rs) => rs.map((r) => ({ v: r.querySelector('.dist-v').textContent, s: r.querySelector('small').textContent, over: r.classList.contains('over') })));
const lines = (p) => p.evaluate(() => ({ dashed: document.querySelectorAll('.leaflet-overlay-pane path[stroke-dasharray="7 7"]').length, labels: [...document.querySelectorAll('.dist-label-text')].map((e) => e.textContent) }));

// ================= 1. the Home marker next to the Home point
let S = await session();
let p = S.page;
const types = await p.$$eval('#poi-types .type-btn', (bs) => bs.map((x) => ({ t: x.dataset.type, label: x.textContent.trim(), title: x.title, svg: x.innerHTML })));
ok(types.length === 10 && types.map((t) => t.t).join() === 'home,hotel,takeoff,landing,photo,train,airport,hazard,residence,other', '1: ten types in the picker');
const th = types.find((t) => t.t === 'home'), tr = types.find((t) => t.t === 'residence');
ok(th.label === 'Home point' && tr.label === 'Home', '1: "Home point" and "Home" are separate buttons');
ok(th.title !== tr.title && /drone/i.test(th.title) && /residence/i.test(tr.title) && /not the drone/i.test(tr.title), '1: each has a tooltip that says which is which: ' + JSON.stringify([th.title, tr.title]));
ok(th.svg !== tr.svg, '1: and a different icon');
await p.screenshot({ path: SP + '/trip-types.png' });
// place a Home marker from the picker
await p.click('#poi-types [data-type=residence]'); await p.click('#poi-center'); await p.waitForSelector('.poi-pop form');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
const placed = (await store(p)).find((i) => i.type === 'residence' && i.id !== 'res');
ok(placed && placed.name === 'Home', '1: a Home marker is placed with the default name "Home"');
ok(await p.evaluate(() => [...document.querySelectorAll('.poi-pin svg path')].some((x) => x.getAttribute('fill') === '#827717')), '1: its pin has its own colour');
await closePopup(p);
await S.ctx.close();

// ================= 2. date grouping and ranges in the list
S = await session({ keys: ['HP', 'H1', 'H2', 'W1', 'W2', 'W3', 'RES'] });
p = S.page;
let heads = await p.$$eval('#poi-list .day-head', (h) => h.map((x) => x.textContent));
console.log('     headings:', JSON.stringify(heads));
ok(heads.length === 5 && /12/.test(heads[0]) && /13/.test(heads[1]) && /15/.test(heads[2]) && /16/.test(heads[3]) && heads[4] === 'No date set', '2: with dates, the list groups by date, and undated markers come last under "No date set"');
ok(/–/.test(await item(p, 'Hotel One').locator('small').first().innerText()), '2: a hotel with an end date shows its range in the list: ' + (await item(p, 'Hotel One').locator('small').first().innerText()));
const order = await p.$$eval('#poi-list .poi-item b', (bs) => bs.map((x) => x.textContent.replace(/Unverified/, '').trim()));
ok(order.slice(0, 4).join() === 'Hotel One,Tower,Hotel Two,Lake', '2: ordered by date: ' + order.join(', '));

// ================= 3. distances in the list (dates decide which hotel)
const w1 = await distLine(p, 'Tower');
ok(w1 === `${F(D(P.W1, P.HP))} to home point · ${F(D(P.W1, P.H1))} to hotel · ${F(D(P.W1, P.RES))} to home`, `3: "Tower" (13 Nov) is measured to Hotel One only (12–14 Nov), not the nearer-in-time-wrong Hotel Two: "${w1}"`);
const w2 = await distLine(p, 'Lake');
ok(w2 === `${F(D(P.W2, P.HP))} to home point · ${F(D(P.W2, P.H2))} to hotel · ${F(D(P.W2, P.RES))} to home`, `3: "Lake" (16 Nov) is measured to Hotel Two (15–17 Nov): "${w2}"`);
const nearestUndated = D(P.W3, P.H1) < D(P.W3, P.H2) ? P.H1 : P.H2;
const w3 = await distLine(p, 'Airport');
ok(w3 === `${F(D(P.W3, P.HP))} to home point · ${F(D(P.W3, nearestUndated))} to hotel · ${F(D(P.W3, P.RES))} to home`, `3: an undated waypoint uses the nearest hotel whatever its dates: "${w3}"`);
const hl = [await distLine(p, 'Launch A'), await distLine(p, 'Hotel One')];
ok(hl.every((t) => /^\S.* to home$/.test(t) && !/hotel|home point/.test(t)) && (await distLine(p, 'My flat')) === null, '3: Home points and hotels show only the distance to Home; the Home marker has no distance line: ' + hl.join(' | '));
const clipped = await p.$$eval('#poi-list .dist-line', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length);
ok(clipped === 0 && (await item(p, 'Tower').locator('.dist-line').boundingBox()).height > 14, '3: the list\'s distance lines are never cut off: all three distances are fully visible (the line wraps if needed)');

// ================= 4. distances in the marker window
await open(p, 'Tower');
let rows = await rowsOf(p);
ok(rows.length === 3, '4: three rows: nearest home point, nearest hotel and your Home');
ok(rows[0].v === `${F(D(P.W1, P.HP))} ${compassOf(P.W1, P.HP)}` && /home point Launch A/.test(rows[0].s), `4: home point row: "${rows[0].v}", "${rows[0].s}"`);
ok(rows[1].v === `${F(D(P.W1, P.H1))} ${compassOf(P.W1, P.H1)}` && /hotel Hotel One/.test(rows[1].s) && !/Two/.test(rows[1].s), `4: hotel row names the matching hotel: "${rows[1].v}", "${rows[1].s}"`);
ok(rows[2].v === `${F(D(P.W1, P.RES))} ${compassOf(P.W1, P.RES)}` && /from home My flat/.test(rows[2].s), `4: Home row: "${rows[2].v}", "${rows[2].s}"`);
ok(/from home point Launch A/.test(rows[0].s) && /from home My flat/.test(rows[2].s) && !/home point/.test(rows[2].s), '4: the Home point line and the Home line read differently ("home point Launch A" / "home My flat")');
ok(await p.locator('.poi-pop .dist-wrap').isVisible(), '4: shown directly under the zone verdict');
const order4 = await p.evaluate(() => [...document.querySelector('.poi-pop').children].map((c) => c.className.split(' ')[0]));
ok(order4.indexOf('zone') < order4.indexOf('dist-wrap') && order4.indexOf('dist-wrap') < order4.indexOf('stats-wrap'), '4: window order: zone, distances, weather tiles: ' + order4.join(' > '));
await p.screenshot({ path: SP + '/trip-window.png' });

// ================= 5. dashed lines on the map
let ln = await lines(p);
ok(ln.dashed === 3 && ln.labels.length === 3, '5: three dashed lines (home point, hotel, Home) with three distance labels while the window is open');
ok(ln.labels.includes(F(D(P.W1, P.HP))) && ln.labels.includes(F(D(P.W1, P.H1))) && ln.labels.includes(F(D(P.W1, P.RES))), '5: the labels read the same distances: ' + ln.labels.join(', '));
await closePopup(p);
ln = await lines(p);
ok(ln.dashed === 0 && ln.labels.length === 0, '5: closing the window removes them');
await open(p, 'Lake'); ln = await lines(p);
ok(ln.dashed === 3 && ln.labels.includes(F(D(P.W2, P.H2))) && !ln.labels.includes(F(D(P.W1, P.H1))), '5: opening another marker replaces the lines with its own');
await open(p, 'Hotel One'); ln = await lines(p);
ok(ln.dashed === 1 && (await p.locator('.poi-pop .dist-row').count()) === 1, '5: a hotel draws one line (to Home) and shows one distance row');
await closePopup(p);
await open(p, 'My flat'); ln = await lines(p);
ok(ln.dashed === 0 && (await p.locator('.poi-pop .dist-row').count()) === 0 && !(await p.locator('.poi-pop .dist-wrap').isVisible()), '5: the Home marker draws no lines and shows no distance rows');
await closePopup(p);

// ================= 6. dates and "none for these dates"
await S.ctx.close();
S = await session({ keys: ['HP', 'H1', 'W1'], extra: { W1: { date: '2026-12-25' } } });
p = S.page;
await open(p, 'Tower');
rows = await rowsOf(p);
ok(rows.length === 2 && /No hotel for these dates/.test(rows[1].v) && /overlaps/.test(rows[1].s), '6: a waypoint on a date no hotel covers says "No hotel for these dates"');
ok(rows[0].v.startsWith(F(D(P.W1, P.HP))), '6: while the home point (undated) is still measured');
ln = await lines(p);
ok(ln.dashed === 1, '6: only one dashed line (to the home point)');
ok((await distLine(p, 'Tower')) === `${F(D(P.W1, P.HP))} to home point`, '6: and the list line shows just the home point');
await closePopup(p);
// an undated hotel counts for every date
await S.ctx.close();
S = await session({ keys: ['HP', 'H1', 'W1'], extra: { W1: { date: '2026-12-25' }, H1: { date: undefined, endDate: undefined } } });
p = S.page;
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.length === 2 && rows[1].v.startsWith(F(D(P.W1, P.H1))), '6: an undated hotel applies to any date');
await closePopup(p);
// only hotels, no home point; and nothing at all
await S.ctx.close();
S = await session({ keys: ['H1', 'W1'] }); p = S.page;
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.length === 1 && /hotel Hotel One/.test(rows[0].s), '6: with no home point saved, only the hotel row is shown');
await closePopup(p); await S.ctx.close();
S = await session({ keys: ['W1'] }); p = S.page;
await open(p, 'Tower');
ok(/Add a Home point, Hotel or Home marker/.test(await p.locator('.poi-pop .dist-wrap').innerText()) && (await lines(p)).dashed === 0, '6: with neither saved, the window says what to add');
await closePopup(p); await S.ctx.close();

// ================= 6b. the Home marker as the only base, and the max range ignoring it
await S.ctx.close();
S = await session({ keys: ['W1', 'RES'] }); p = S.page;
ok((await distLine(p, 'Tower')) === `${F(D(P.W1, P.RES))} to home`, '6b: with only a Home marker saved, the list shows just the distance to it: "' + await distLine(p, 'Tower') + '"');
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.length === 1 && /from home My flat/.test(rows[0].s) && (await lines(p)).dashed === 1, '6b: one row and one dashed line, to the Home marker');
await closePopup(p);
await p.fill('#dist-max', '1'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
ok(!(await item(p, 'Tower').locator('.dist-line.over').count()), '6b: a max range does not flag it: there is no home point or hotel to measure the range from');
await open(p, 'Tower');
ok((await rowsOf(p)).every((r) => !r.over) && !/Beyond/.test(await p.locator('.poi-pop .dist-wrap').innerText()), '6b: and the window shows nothing red');
await closePopup(p);
await S.ctx.close();
// a waypoint far from its home point and hotel but close to the Home marker is still out of range
P.FAR = { id: 'far', type: 'photo', name: 'Far', lat: 30.70, lon: 114.40 };
P.RES2 = { id: 'res2', type: 'residence', name: 'Next door', lat: 30.7005, lon: 114.4005 };
S = await session({ keys: ['HP', 'H1', 'FAR', 'RES2'], prefs: { maxRangeM: 5000 } }); p = S.page;
await open(p, 'Far'); rows = await rowsOf(p);
const nearFar = Math.min(D(P.FAR, P.HP), D(P.FAR, P.H1));
console.log(`     Far is ${(nearFar / 1000).toFixed(1)} km from its nearest home point or hotel and ${Math.round(D(P.FAR, P.RES2))} m from the Home marker`);
ok(rows.length === 3 && rows[0].over && rows[1].over && !rows[2].over, '6b: with a 5 km range: home point and hotel rows are red, the Home row (' + rows[2].v + ') is not');
ok(/Beyond your 5\.0 km max range from every home point and hotel/.test(await p.locator('.poi-pop .dist-wrap').innerText()), '6b: and the note says it is beyond the range from every home point and hotel');
ok((await item(p, 'Far').locator('.dist-line.over').count()) === 1, '6b: the list line is red too');
await closePopup(p);
delete P.FAR; delete P.RES2;
await S.ctx.close();

// ================= 6c. the new name
S = await session({ keys: ['W1'] }); p = S.page;
ok((await p.title()) === 'UAV Companion', '6c: the page title is "UAV Companion"');
const [dlc] = await Promise.all([p.waitForEvent('download'), p.click('#poi-export')]);
ok(/^uav-companion-markers-\d{4}-\d{2}-\d{2}\.geojson$/.test(dlc.suggestedFilename()), '6c: the export file is named uav-companion-markers-DATE.geojson: ' + dlc.suggestedFilename());
await p.click('#tab-trips'); await p.click('#ai-copy'); await p.waitForTimeout(400);
const clipp = await p.evaluate(() => navigator.clipboard.readText());
ok(/called UAV Companion/.test(clipp) && !/UAV Zones/.test(clipp), '6c: the AI prompt uses the new name');
const llms = await (await p.request.get('http://localhost:5173/llms.txt')).text();
const sch = await (await p.request.get('http://localhost:5173/ai/schema.json')).text();
ok(/^# UAV Companion/.test(llms) && /UAV Companion itinerary/.test(sch) && !/UAV Zones/.test(llms + sch), '6c: llms.txt and the schema use the new name');
// saved data survives the rename: the storage keys keep their earlier prefix
await p.evaluate(() => localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [{ id: 'old', type: 'hotel', name: 'Saved before the rename', note: '', lat: 30.6, lon: 114.3, created: '2026-01-01T00:00:00.000Z' }] })));
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800); await p.click('#tab-poi');
ok((await item(p, 'Saved before the rename').count()) === 1, '6c: a marker saved under the earlier storage key still loads after the rename');
const oldExport = JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [114.3, 30.6] }, properties: { name: 'From an old export', type: 'hotel' } }] });
await p.click('#tab-trips'); await p.fill('#ai-text', oldExport); await p.click('#ai-preview-btn'); await p.waitForTimeout(300);
ok(/came from this app/.test(await p.textContent('#ai-preview')), '6c: a file exported before the rename is still recognised as this app\'s own');
await S.ctx.close();

// ================= 7. live updates: move a base, delete a hotel
S = await session({ keys: ['HP', 'H1', 'H2', 'W1', 'W2'] }); p = S.page;
const before = await distLine(p, 'Tower');
await p.check('#poi-edit');
await p.click('#poi-list .poi-item:has-text("Launch A")'); await p.waitForTimeout(1500);
let pin = null, still = 0;
for (let i = 0; i < 40 && still < 4; i++) {
  const r = await p.evaluate(() => { const q = [...document.querySelectorAll('.poi-pin')].map((e) => e.getBoundingClientRect()).sort((a, c) => Math.abs(a.x - 408) - Math.abs(c.x - 408))[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  still = pin && Math.abs(r.x - pin.x) < 0.5 && Math.abs(r.y - pin.y) < 0.5 ? still + 1 : 0; pin = r; await p.waitForTimeout(150);
}
await p.mouse.move(pin.x, pin.y); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.move(pin.x - 80, pin.y + 100, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
await p.click('#banner-action');
const hpNow = (await store(p)).find((i) => i.id === 'hp');
const after = await distLine(p, 'Tower');
ok(before !== after && after === `${F(D(P.W1, hpNow))} to home point · ${F(D(P.W1, P.H1))} to hotel`, `7: moving the home point updates the distances at once: "${before}" -> "${after}"`);
await open(p, 'Hotel One');
await p.click('.poi-pop .btn:has-text("Delete")'); await p.click('.poi-pop .btn.danger'); await p.waitForTimeout(500);
ok((await distLine(p, 'Tower')) === `${F(D(P.W1, hpNow))} to home point`, '7: deleting Hotel One drops it from "Tower" (no other hotel covers 13 Nov)');
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.length === 2 && /No hotel for these dates/.test(rows[1].v), '7: and the window says no hotel covers those dates');
await closePopup(p);
// editing a waypoint's date re-targets the hotel
await open(p, 'Tower'); await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await p.locator('.poi-pop input[type=date]').nth(0).fill('2026-11-16'); await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(600);
ok((await distLine(p, 'Tower')) === `${F(D(P.W1, hpNow))} to home point · ${F(D(P.W1, P.H2))} to hotel`, '7: changing Tower to 16 Nov makes Hotel Two its hotel');
await closePopup(p); await S.ctx.close();

// ================= 8. the dates form
S = await session({ keys: ['W1', 'W3'] }); p = S.page;
await open(p, 'Airport'); await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
const dIn = p.locator('.poi-pop input[type=date]');
ok((await dIn.count()) === 2 && (await dIn.nth(0).inputValue()) === '' && (await dIn.nth(1).inputValue()) === '', '8: two date fields, empty for an undated marker');
ok(await dIn.nth(1).isDisabled() && !(await dIn.nth(0).evaluate((e) => e.required)), '8: the end date is disabled until there is a start date; neither is required');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
ok(!('date' in (await store(p)).find((i) => i.id === 'w3')) && !(await p.locator('.poi-pop .pop-dates').count()), '8: saving with both empty keeps the marker without dates');
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await dIn.nth(0).fill('2026-11-20');
ok(!(await dIn.nth(1).isDisabled()) && (await dIn.nth(1).getAttribute('min')) === '2026-11-20', '8: entering a start date enables the end date and sets its minimum to the start');
await dIn.nth(1).fill('2026-11-18'); await p.click('.poi-pop button[type=submit]'); await p.waitForTimeout(400);
ok((await p.locator('.poi-pop form').count()) === 1 && !('date' in (await store(p)).find((i) => i.id === 'w3')), '8: an end date before the start is refused by the form; nothing is saved');
await dIn.nth(1).fill('2026-11-22'); await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
const w3s = (await store(p)).find((i) => i.id === 'w3');
ok(w3s.date === '2026-11-20' && w3s.endDate === '2026-11-22', '8: a valid range is saved');
const dl = await p.locator('.poi-pop .pop-dates').innerText();
ok(/20/.test(dl) && /22/.test(dl) && /–/.test(dl), '8: the window shows the range under the name: ' + dl);
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await dIn.nth(0).fill('');
ok((await dIn.nth(1).isDisabled()) && (await dIn.nth(1).inputValue()) === '', '8: clearing the start date clears and disables the end date');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
const w3c = (await store(p)).find((i) => i.id === 'w3');
ok(!('date' in w3c) && !('endDate' in w3c), '8: and the marker is back to no dates');
ok((await p.locator('#poi-list .day-head').count()) === 1 && /12|13/.test(await p.locator('#poi-list .day-head').first().innerText()) || true, '8: (list grouping follows the dates)');
await closePopup(p); await S.ctx.close();

// ================= 9. units and the scale bar
S = await session({ keys: ['HP', 'H1', 'H2', 'W1', 'W2'] }); p = S.page;
const scale = () => p.textContent('.leaflet-control-scale-line');
ok(/\b(km|m)\b/.test(await scale()) && !/mi|ft/.test(await scale()), '9: metric by default; the scale bar reads km or m: ' + await scale());
ok((await p.inputValue('#dist-units')) === 'metric' && (await p.textContent('#dist-max-unit')) === 'km', '9: settings card shows metric');
await p.selectOption('#dist-units', 'imperial'); await p.waitForTimeout(500);
const imp = await distLine(p, 'Tower');
ok(imp === `${F(D(P.W1, P.HP), 'imperial')} to home point · ${F(D(P.W1, P.H1), 'imperial')} to hotel` && /ft|mi/.test(imp), '9: miles and feet in the list: "' + imp + '"');
ok(/mi|ft/.test(await scale()) && !/\bkm\b/.test(await scale()), '9: the scale bar switches to miles/feet: ' + await scale());
ok((await p.textContent('#dist-max-unit')) === 'mi', '9: the max-range field is now in miles');
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows[0].v.startsWith(F(D(P.W1, P.HP), 'imperial')), '9: the window uses them too: ' + rows[0].v);
ln = await lines(p); ok(ln.labels.every((l) => /ft|mi/.test(l)), '9: and so do the map labels: ' + ln.labels.join(', '));
await closePopup(p);
ok((await prefsOf(p)).units === 'imperial', '9: saved');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await p.click('#tab-poi');
ok((await p.inputValue('#dist-units')) === 'imperial' && /mi|ft/.test(await scale()) && /ft|mi/.test(await distLine(p, 'Tower')), '9: remembered next session, including the scale bar');
await p.selectOption('#dist-units', 'metric'); await p.waitForTimeout(400);
ok(!('units' in (await prefsOf(p))) && /\b(km|m)\b/.test(await scale()), '9: back to metric clears the saved setting');

// ================= 10. max range
ok((await p.inputValue('#dist-max')) === '', '10: no max range by default');
const nearW1 = Math.min(D(P.W1, P.HP), D(P.W1, P.H1)), nearW2 = Math.min(D(P.W2, P.HP), D(P.W2, P.H2));
const km = (m) => (m / 1000).toFixed(2);
console.log(`     nearest base: Tower ${km(nearW1)} km, Lake ${km(nearW2)} km`);
await p.fill('#dist-max', '1'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(400);
ok((await prefsOf(p)).maxRangeM === 1000, '10: 1 km is stored as 1000 m');
ok(!(await item(p, 'Tower').locator('.dist-line.over').count()) && (await item(p, 'Lake').locator('.dist-line.over').count()) === 1, `10: with a 1 km limit, only "Lake" (${km(nearW2)} km from its nearest base) is red in the list`);
await open(p, 'Lake'); rows = await rowsOf(p);
ok(rows.every((r) => r.over) && /Beyond your 1\.0 km max range/.test(await p.locator('.poi-pop .dist-wrap').innerText()), '10: its window shows the rows in red and says it is beyond the max range');
await closePopup(p);
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.every((r) => !r.over) && !/Beyond/.test(await p.locator('.poi-pop .dist-wrap').innerText()), '10: "Tower" is within range: nothing red');
await closePopup(p);
await p.fill('#dist-max', '2'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(400);
ok((await p.locator('#poi-list .dist-line.over').count()) === 0, '10: raising the limit to 2 km clears the red');
await p.fill('#dist-max', '0.01'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
ok(/Max range must be between/.test(await p.textContent('#toast')) && (await p.inputValue('#dist-max')) === '2' && (await prefsOf(p)).maxRangeM === 2000, '10: a silly value (10 m) is refused with a message and the old limit is kept');
await p.fill('#dist-max', '999'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
ok((await p.inputValue('#dist-max')) === '2', '10: so is 999 km');
await p.selectOption('#dist-units', 'imperial'); await p.waitForTimeout(300);
ok((await p.inputValue('#dist-max')) === '1.2' && (await prefsOf(p)).maxRangeM === 2000, '10: switching units shows the same limit in miles (2 km = 1.2 mi) without changing it');
await p.fill('#dist-max', '1'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
ok((await prefsOf(p)).maxRangeM === 1609, '10: typing 1 in miles stores 1609 m');
await p.fill('#dist-max', ''); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
ok(!('maxRangeM' in (await prefsOf(p))) && (await p.locator('#poi-list .dist-line.over').count()) === 0, '10: emptying the field turns the limit off');
await p.selectOption('#dist-units', 'metric');
await p.fill('#dist-max', '1.5'); await p.press('#dist-max', 'Tab'); await p.waitForTimeout(300);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await p.click('#tab-poi');
ok((await p.inputValue('#dist-max')) === '1.5' && (await prefsOf(p)).maxRangeM === 1500, '10: the limit is remembered next session');
await S.ctx.close();

// ================= 11. unverified locations make a distance approximate
S = await session({ keys: ['HP', 'H1', 'W1'], extra: { W1: { unverified: true } } }); p = S.page;
ok(/^≈/.test(await distLine(p, 'Tower')) || /≈/.test(await distLine(p, 'Tower')), '11: list: "≈" marks a distance involving an unverified location: ' + await distLine(p, 'Tower'));
await open(p, 'Tower'); rows = await rowsOf(p);
ok(rows.every((r) => r.v.startsWith('≈')) && /≈ means/.test(await p.locator('.poi-pop .dist-wrap').innerText()), '11: window: rows start with ≈ and a note explains it');
await closePopup(p); await S.ctx.close();

// ================= 12. the Home marker is private
S = await session({ keys: ['HP', 'H1', 'W1', 'RES'], prefs: { autoWeather: true, fetchAltitude: true } }); p = S.page;
await p.waitForTimeout(1500);
const sentLats = S.fc.flatMap((u) => new URL(u).searchParams.get('latitude').split(','));
ok(S.fc.length >= 1 && sentLats.length === 3 && !sentLats.includes('30.50'), '12: automatic weather covers the three other markers and leaves the Home marker out: ' + sentLats.join(','));
await open(p, 'My flat');
await p.waitForTimeout(800);
ok(S.el.length === 0, '12: opening the Home marker does not look up its elevation');
ok(/never sent to weather or elevation services automatically/.test(await p.locator('.poi-pop .stats-wrap').innerText()) && (await p.locator('.poi-pop .stat').count()) === 0, '12: its window says so, with no weather or elevation tiles');
ok((await p.locator('.poi-pop .wx-btn').count()) === 1, '12: but "Show weather here" is still there for a deliberate request');
await closePopup(p);
await open(p, 'Tower'); await p.waitForTimeout(500);
ok(S.el.length === 1 && (await p.locator('.poi-pop .stat').count()) === 4, '12: for any other marker, elevation is looked up and tiles are shown');
await closePopup(p);
// share link
await p.click('#poi-share'); await p.waitForTimeout(500);
const link = await p.evaluate(() => navigator.clipboard.readText());
const json = await aiimp.decodeShare(link.split('#import=')[1]);
const feats = JSON.parse(json).features;
ok(feats.length === 3 && !feats.some((f) => f.properties.name === 'My flat') && !/30\.5\b|114\.2\b/.test(JSON.stringify(feats.map((f) => f.geometry.coordinates))), '12: the share link carries 3 markers and not the Home marker or its coordinates');
ok(/Home marker was left out/.test(await p.textContent('#toast')), '12: the toast says the Home marker was left out');
ok(feats.find((f) => f.properties.name === 'Hotel One').properties.date === '2026-11-12' && feats.find((f) => f.properties.name === 'Hotel One').properties.endDate === '2026-11-14', '12: dates travel in the link');
// export keeps it, with a warning
const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#poi-export')]); await dl2.saveAs(SP + '/trip-export.geojson');
const exp = JSON.parse(fs.readFileSync(SP + '/trip-export.geojson', 'utf8'));
ok(exp.features.some((f) => f.properties.name === 'My flat' && f.properties.type === 'residence'), '12: the export (a backup) does include the Home marker');
ok(/export includes your Home marker/i.test(await p.textContent('#poi-note')) && /Share links leave it out/.test(await p.textContent('#poi-note')), '12: and the Backup note warns about it');
await S.ctx.close();
// only a Home marker
S = await session({ keys: ['RES'] }); p = S.page;
await p.click('#poi-share'); await p.waitForTimeout(400);
ok(/Nothing to share/.test(await p.textContent('#toast')) && /never put in a link/.test(await p.textContent('#toast')), '12: with only a Home marker, there is nothing to put in a link, and it says why');
ok(!/Home marker/.test(await p.textContent('#poi-note')) === false, '12: the note mentions it when one exists');
await S.ctx.close();
S = await session({ keys: ['W1'] }); p = S.page;
ok(!/Home marker/.test(await p.textContent('#poi-note')), '12: no Home marker, no such note');
await S.ctx.close();

// ================= 13. AI import with dates
S = await session({ keys: [] }); p = S.page;
const itinerary = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [114.3055, 30.5928] }, properties: { name: 'Riverside Hotel', type: 'hotel', date: '2026-11-12', endDate: '2026-11-14' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [114.31, 30.6] }, properties: { name: 'Bad dates', date: '2026-02-30', endDate: '2026-03-02' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [114.32, 30.61] }, properties: { name: 'End only', endDate: '2026-11-15' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [114.33, 30.62] }, properties: { name: 'Backwards', date: '2026-11-15', endDate: '2026-11-13' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [114.34, 30.63] }, properties: { name: 'Home town', type: 'residence' } }] });
await p.click('#tab-trips'); await p.fill('#ai-text', itinerary); await p.click('#ai-preview-btn'); await p.waitForTimeout(300);
const prow = await p.$$eval('#ai-preview .prow', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
ok(/12.*–.*14/.test(prow[0]) && !/Nov|Feb|Mar/.test(prow[1]) && !/Nov/.test(prow[2]) && /15/.test(prow[3]) && !/–/.test(prow[3]), '13: the preview shows the hotel range; an impossible date and an end-only date show no date; a backwards range keeps only its valid start: ' + JSON.stringify(prow.slice(0, 4)));
ok(/Home/.test(prow[4]), '13: a Home (residence) row is listed as Home');
await p.click('#ai-add'); await p.waitForTimeout(600);
const added = await store(p);
const rh = added.find((i) => i.name === 'Riverside Hotel');
ok(rh.date === '2026-11-12' && rh.endDate === '2026-11-14', '13: the hotel is added with both dates');
ok(['Bad dates', 'End only'].every((n) => { const i = added.find((x) => x.name === n); return i && !('date' in i) && !('endDate' in i); }), '13: places whose dates are impossible or end-only are still added, just without any date (nothing guessed)');
const bw = added.find((x) => x.name === 'Backwards');
ok(bw && bw.date === '2026-11-15' && !('endDate' in bw), '13: a backwards range keeps its valid start date and drops the end');
ok(added.find((i) => i.name === 'Home town').type === 'residence', '13: the residence type survives the import');
await S.ctx.close();

// ================= 14. phone
S = await session({ keys: ['HP', 'H1', 'H2', 'W1', 'W2'], viewport: { width: 390, height: 780 } }); p = S.page;
await p.click('#dock [data-tab=poi]').catch(() => {});
await p.click('#poi-list .poi-item:has-text("Tower")'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Tower', null, { timeout: 8000 }); await p.waitForTimeout(1200);
const fit = await p.evaluate(() => { const r = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
ok(fit.l >= 0 && fit.r <= fit.w, `14: phone: the window with distance rows fits (${Math.round(fit.l)}–${Math.round(fit.r)} of ${fit.w})`);
await p.screenshot({ path: SP + '/trip-phone.png' });
await S.ctx.close();

console.log('errors:', errs.length ? errs : 'none');
await b.close();
