import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium, dashClick } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const OFFSET = 28800;
const errs = [];

// ---- mocks: forecast (values checkable) and elevation (value = latitude x 100, so each point is identifiable)
function forecast(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
  const day = Math.floor((Date.now() + OFFSET * 1000) / 86400000) * 86400000;
  const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
  const one = (lat, i) => ({ latitude: lat, longitude: lons[i], utc_offset_seconds: OFFSET, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8',
    hourly: { time, temperature_2m: time.map((_, k) => 10 + 0.5 * k), wind_speed_10m: time.map((_, k) => 2 + 0.25 * k), wind_gusts_10m: time.map((_, k) => 5 + 0.5 * k),
      precipitation: time.map(() => 0), wind_speed_120m: time.map(() => 3), visibility: time.map(() => 14000) },
    daily: { time: [time[0].slice(0, 10), time[24].slice(0, 10)], sunrise: [time[0].slice(0, 11) + '06:44', time[24].slice(0, 11) + '06:45'], sunset: [time[0].slice(0, 11) + '17:28', time[24].slice(0, 11) + '17:28'] } });
  return lats.length === 1 ? one(lats[0], 0) : lats.map(one);
}
const elevationOf = (lat) => Math.round(lat * 100);

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, type: i % 2 ? 'hotel' : 'home', name: 'Seed ' + String.fromCharCode(65 + i), note: i === 0 ? 'Room 12, early checkout' : '',
  lat: 30.5 + i * 0.013 + 0.000123, lon: 114.2 + i * 0.011 + 0.000456, created: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString() }));

const b = await chromium.launch({ channel: CHANNEL });
async function session({ seed = items(3), prefs, viewport = { width: 1200, height: 800 }, colorScheme, failElevation = false } = {}) {
  const ctx = await b.newContext({ viewport, colorScheme, geolocation: { latitude: 30.5928, longitude: 114.3055 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([s, pr]) => {
    if (!sessionStorage.__seeded) {
      sessionStorage.__seeded = '1';
      if (s) localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: s }));
      if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr));
    }
  }, [seed, prefs]);
  const S = { ctx, fc: [], el: [], failElevation };
  await ctx.route('**/api.open-meteo.com/**', async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (path.endsWith('/elevation')) {
      S.el.push(url);
      if (S.failElevation) return route.abort();
      const lats = new URL(url).searchParams.get('latitude').split(',').map(Number);
      return reply({ elevation: lats.map(elevationOf) });
    }
    S.fc.push(url);
    return reply(forecast(url));
  });
  S.page = await ctx.newPage();
  S.page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  S.page.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await S.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await S.page.waitForTimeout(900);
  return S;
}
const decimals = (list) => list.map((c) => (c.split('.')[1] || '').length);
const params = (url) => { const u = new URL(url); return { lat: u.searchParams.get('latitude').split(','), lon: u.searchParams.get('longitude').split(',') }; };
const openMarker = async (p, name) => { await p.click('#tab-poi').catch(() => {}); await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1100); };
const closePopup = async (p) => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForFunction(() => !document.querySelector('.leaflet-popup'), null, { timeout: 3000 }).catch(() => {}); };
const tileVal = (p, k) => p.locator(`.poi-pop .stat[data-k=${k}] .v`).innerText();

// ================= 1. the sub-panel
let S = await session();
const p = S.page;
ok(await p.isVisible('#privacy-btn') && (await p.getAttribute('#privacy-btn', 'aria-expanded')) === 'false', '1: shield button in the panel header, collapsed');
ok(!(await p.isVisible('#privacy')), '1: sub-panel hidden at first');
await p.click('#privacy-btn');
ok(await p.isVisible('#privacy') && (await p.getAttribute('#privacy-btn', 'aria-expanded')) === 'true', '1: button opens the privacy sub-panel');
ok(/Privacy settings/.test(await p.textContent('#privacy .sub-title')), '1: titled "Privacy settings"');
await p.screenshot({ path: SP + '/privacy-panel.png' });
ok(!(await p.isChecked('#pv-auto')) && !(await p.isChecked('#pv-alt')) && (await p.isChecked('input[name=pv-prec][value=estimated]')), '1: defaults: auto weather off, altitude off, estimated location');
ok(/Open-Meteo/.test(await p.textContent('#privacy')) && /Never sent/.test(await p.textContent('#privacy')), '1: explains what leaves the browser');
await p.click('#privacy-back'); ok(!(await p.isVisible('#privacy')), '1: Back closes it');
await p.click('#privacy-btn'); await p.keyboard.press('Escape'); ok(!(await p.isVisible('#privacy')), '1: Escape closes it');
await p.click('#tab-poi'); ok(!(await p.locator('#poi-privacy').count()) && !(await p.locator('#pane-poi #mw-status, #pane-poi #pv-mw-status').count()), '1: the Points of Interest tab no longer has a weather and privacy card (privacy is one shield button away)'); await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])'); await p.waitForTimeout(400); ok(await p.isVisible('#privacy #pv-mw-status') && /Automatic weather is off/.test(await p.textContent('#privacy #pv-mw-status')), '1: the privacy panel opens from the shield and shows its own weather status line');
await p.click('#privacy-close'); ok(!(await p.isVisible('#panel')) && await p.isVisible('#dock'), '1: the sub-panel has its own close button that hides the panel'); await p.click('#dock [data-tab=poi]'); ok(!(await p.isVisible('#privacy')), '1: reopening the panel starts from the tab, not the sub-panel');
await S.ctx.close();

// ================= 2. weather location precision
S = await session();
await S.page.click('#privacy-btn');
await S.page.check('#pv-auto'); await S.page.waitForFunction(() => document.querySelectorAll('input[name=pv-prec]').length > 0); await S.page.waitForTimeout(900);
let q = params(S.fc[0]);
ok(decimals([...q.lat, ...q.lon]).every((d) => d === 2), '2: estimated (default): weather coordinates have 2 decimals: ' + q.lat.join(','));
S.fc.length = 0;
await S.page.check('input[name=pv-prec][value=precise]');
ok((await S.page.isChecked('input[name=pv-prec][value=precise]')) && !(await S.page.isChecked('input[name=pv-prec][value=estimated]')), '2: precise selected');
await S.page.click('#privacy-back'); await S.page.click('#tab-poi'); await S.page.click('#poi-center'); await S.page.waitForSelector('.poi-pop form'); await S.page.waitForTimeout(900);
q = params(S.fc[S.fc.length - 1]);
ok(S.fc.length >= 1 && decimals([...q.lat, ...q.lon]).every((d) => d === 4), '2: precise: a new marker\'s weather is requested with 4 decimals: ' + q.lat.join(','));
ok(JSON.parse(await S.page.evaluate(() => localStorage.getItem('uavzones.v1.prefs'))).weatherPrecision === 'precise', '2: choice remembered');
await closePopup(S.page);
// on-demand button follows the setting, and says so
await openMarker(S.page, 'Seed A');
ok(/exact location/.test(await S.page.locator('.poi-pop .wx-opt small').innerText()), '2: weather button says it sends the exact location in precise mode');
S.fc.length = 0; await S.page.click('.poi-pop .wx-btn'); await S.page.waitForSelector('#weather .wx-table'); q = params(S.fc[0]);
ok(decimals([...q.lat, ...q.lon]).every((d) => d === 4), '2: the on-demand weather card also uses 4 decimals');
await S.page.click('#weather .wx-close');
await S.page.click('#privacy-btn'); await S.page.check('input[name=pv-prec][value=estimated]'); await S.page.click('#privacy-back');
await openMarker(S.page, 'Seed A');
ok(/rounded to about 1 km/.test(await S.page.locator('.poi-pop .wx-opt small').innerText()), '2: and says "rounded to about 1 km" in estimated mode');
S.fc.length = 0; await S.page.click('.poi-pop .wx-btn'); await S.page.waitForSelector('#weather .wx-table'); q = params(S.fc[0]);
ok(decimals([...q.lat, ...q.lon]).every((d) => d === 2), '2: the on-demand weather card is back to 2 decimals');
await S.ctx.close();

// ================= 3. altitude
S = await session({ prefs: { weatherPrecision: 'estimated' } });
await openMarker(S.page, 'Seed B');
ok(S.el.length === 0 && (await S.page.locator('.poi-pop .stat[data-k=elev]').count()) === 0, '3: altitude off: nothing requested, no elevation tile');
await closePopup(S.page);
await S.page.click('#privacy-btn'); await S.page.check('#pv-alt'); await S.page.click('#privacy-back');
ok(S.el.length === 0, '3: turning altitude on does not itself fetch anything (it is looked up when a marker or point is opened)');
const seeds = items(3);
await openMarker(S.page, 'Seed B');
ok(S.el.length === 1, '3: opening a marker looks its elevation up once');
const eq = params(S.el[0]);
ok(decimals([...eq.lat, ...eq.lon]).every((d) => d === 4), '3: elevation always uses precise coordinates (4 decimals): ' + eq.lat[0] + ',' + eq.lon[0]);
ok((await tileVal(S.page, 'elev')) === `${elevationOf(seeds[1].lat)} m`, `3: marker window shows the elevation tile: ${await tileVal(S.page, 'elev')}`);
ok(/terrain model/.test(await S.page.locator('.poi-pop .stats-note').first().innerText()), '3: noted as a terrain-model estimate');
await closePopup(S.page);
await openMarker(S.page, 'Seed B');
ok(S.el.length === 1, '3: reopening uses the cached elevation (no new request)');
await closePopup(S.page);
ok(Object.keys(JSON.parse(await S.page.evaluate(() => localStorage.getItem('uavzones.v1.elevcache'))).items).length === 1, '3: cached per marker, separate from the markers');
const pois = JSON.parse(await S.page.evaluate(() => localStorage.getItem('uavzones.v1.pois')));
ok(pois.items.every((i) => !('elevation' in i) && Object.keys(i).length === 7), '3: elevation is not written onto the marker records');
// weather stays estimated while elevation is precise
await S.page.click('#privacy-btn'); await S.page.check('#pv-auto'); await S.page.click('#privacy-back'); await S.page.waitForTimeout(1000);
ok(S.fc.length >= 1 && decimals([...params(S.fc[0]).lat]).every((d) => d === 2), '3: with altitude on, weather still follows its own (estimated) setting: ' + params(S.fc[0]).lat.join(','));
await openMarker(S.page, 'Seed B');
const order = await S.page.evaluate(() => [...document.querySelector('.poi-pop').children].map((c) => c.className.split(' ')[0]));
console.log('     window order:', order.join(' > '));
ok(order.indexOf('zone') > order.indexOf('pop-head') && order.indexOf('stats-wrap') > order.indexOf('zone') && order.indexOf('disclaimer') > order.indexOf('stats-wrap') && order.indexOf('pop-bar') < order.indexOf('pop-head'), '3: layout order: tool bar, header, zone verdict, number tiles, disclaimer');
ok((await S.page.locator('.poi-pop .stat').count()) === 4, '3: four tiles: elevation, avg temp, avg wind, peak gust');
await closePopup(S.page);
// move invalidates elevation
await S.page.click('#tab-poi'); await S.page.check('#poi-edit');
await S.page.click('#poi-list .poi-item:has-text("Seed A")'); await S.page.waitForTimeout(1200);
// the window grows as tiles arrive and the map pans to keep it in view: wait until the pin holds still before pressing it
if (await S.page.locator('.poi-pop .pop-toggle[aria-expanded=true]').count()) await S.page.evaluate(() => document.querySelector('.poi-pop .pop-toggle').click()); // collapsed, so the pin is not under the window
let pin = null, still = 0;
for (let i = 0; i < 40 && still < 4; i++) {
  const r = await S.page.evaluate(() => { const q = [...document.querySelectorAll('.poi-pin')].map((e) => e.getBoundingClientRect()).sort((a, b) => Math.abs(a.x - 408) - Math.abs(b.x - 408))[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  still = pin && Math.abs(r.x - pin.x) < 0.5 && Math.abs(r.y - pin.y) < 0.5 ? still + 1 : 0;
  pin = r;
  await S.page.waitForTimeout(150);
}
await S.page.mouse.move(pin.x, pin.y); await S.page.mouse.down(); await S.page.waitForTimeout(650);
console.log('     pin at', JSON.stringify(pin), '| editing class:', await S.page.evaluate(() => document.getElementById('map').classList.contains('is-editing')), '| lifted:', await S.page.evaluate(() => !!document.querySelector('.poi-pin.lifted')),
  '| under pointer:', await S.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + (e.getAttribute('class') || '').slice(0, 40) : null; }, [pin.x, pin.y]));
await S.page.mouse.move(pin.x + 30, pin.y + 80, { steps: 6 }); await S.page.mouse.up(); await S.page.waitForTimeout(500);
await S.page.click('#banner-action');
const before = S.el.length;
await S.page.click('#poi-list .poi-item:has-text("Seed A")'); await S.page.waitForSelector('.poi-pop h3'); await S.page.waitForTimeout(1200);
const posNow = JSON.parse(await S.page.evaluate(() => localStorage.getItem('uavzones.v1.pois'))).items.map((i) => [i.name, i.lat]);
console.log('     requests', before, '->', S.el.length, '| positions', JSON.stringify(posNow), '| requested lats:', S.el.map((u) => new URL(u).searchParams.get('latitude')).join(' '));
ok(S.el.length === before + 1, '3: a moved marker elevation is looked up again at its new position');
await closePopup(S.page);

// point-check popup (map click) and location pin
await S.page.mouse.move(300, 300); await S.page.mouse.down(); await S.page.waitForTimeout(2300); await S.page.mouse.up(); await S.page.waitForSelector('.leaflet-popup .status'); await S.page.waitForTimeout(900);
ok((await S.page.locator('.leaflet-popup .stat[data-k=elev] .v').count()) === 1 && /^\d+ m$/.test(await S.page.locator('.leaflet-popup .stat[data-k=elev] .v').innerText()), '3: a point check also shows elevation: ' + await S.page.locator('.leaflet-popup .stat[data-k=elev] .v').innerText());
await closePopup(S.page);
await S.page.click('.locate-btn'); await S.page.waitForSelector('.you-dot', { timeout: 8000 }); await S.page.waitForTimeout(1200);
ok((await S.page.locator('.leaflet-popup').count()) === 0, '3: locating no longer runs a point check or opens a popup by itself');
await dashClick(S.page, 'text=Check my spot'); await S.page.waitForSelector('.leaflet-popup .stat[data-k=elev]', { timeout: 8000 });
ok(true, '3: "Check my spot" shows a popup for where you are, with elevation');
await closePopup(S.page);

// turning altitude off forgets and hides
await S.page.click('#privacy-btn'); await S.page.uncheck('#pv-alt'); await S.page.click('#privacy-back');
ok(Object.keys(JSON.parse(await S.page.evaluate(() => localStorage.getItem('uavzones.v1.elevcache'))).items).length === 0, '3: turning altitude off clears the cached elevations');
const n = S.el.length;
await openMarker(S.page, 'Seed B');
ok((await S.page.locator('.poi-pop .stat[data-k=elev]').count()) === 0 && S.el.length === n, '3: no elevation tile and no request after turning it off');
await S.page.mouse.click(300, 300); await S.page.waitForTimeout(500);
await S.ctx.close();

// ================= 4. persistence across a reload
S = await session({ prefs: { autoWeather: true, weatherPrecision: 'precise', fetchAltitude: true } });
await S.page.click('#privacy-btn');
ok((await S.page.isChecked('#pv-auto')) && (await S.page.isChecked('#pv-alt')) && (await S.page.isChecked('input[name=pv-prec][value=precise]')), '4: saved privacy choices are restored in the sub-panel');
await S.page.click('#privacy-back');
const configStatus = await S.page.textContent('#pane-config #mw-status');
ok(/Ground elevation is on/.test(configStatus) && configStatus === await S.page.textContent('#privacy #pv-mw-status'), '4: both status lines restore the saved elevation choice');
await S.ctx.close();

// ================= 5. elevation lookup fails
S = await session({ prefs: { fetchAltitude: true }, failElevation: true });
await openMarker(S.page, 'Seed A');
ok((await tileVal(S.page, 'elev')) === '–', '5: elevation unavailable shows a dash, not a made-up number');
ok(/Elevation unavailable/.test(await S.page.locator('.poi-pop .stats-note').first().innerText()), '5: and says so');
await S.ctx.close();

// ================= 6. the redesigned window
S = await session({ prefs: { autoWeather: true, fetchAltitude: true } });
await S.page.waitForTimeout(1200);
await openMarker(S.page, 'Seed A');
const st = await S.page.locator('.poi-pop .status').first();
ok(await st.isVisible() && /\b(ok|no|unk)\b/.test(await st.getAttribute('class')), '6: the zone verdict is a status banner with a colour class');
ok(/Seed A/.test(await S.page.textContent('.poi-pop h3')) && /Home point/i.test(await S.page.textContent('.pop-type')), '6: header shows type and name');
ok((await S.page.locator('.poi-pop .note').innerText()).includes('Room 12'), '6: the note is set apart');
const sizes = await S.page.evaluate(() => { const g = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize); return { h3: g('.poi-pop h3'), tile: g('.poi-pop .stat .v'), body: g('.poi-pop .coords') }; });
ok(sizes.tile >= 18 && sizes.h3 >= 17 && sizes.tile > sizes.body * 1.4, `6: key numbers are large (tile ${sizes.tile}px, name ${sizes.h3}px, coordinates ${sizes.body}px)`);
await S.page.screenshot({ path: SP + '/popup-light.png' });
await S.ctx.close();

S = await session({ prefs: { autoWeather: true, fetchAltitude: true }, colorScheme: 'dark' });
await S.page.waitForTimeout(1200);
await openMarker(S.page, 'Seed A');
const bg = await S.page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-popup-content-wrapper')).backgroundColor);
const fg = await S.page.evaluate(() => getComputedStyle(document.querySelector('.poi-pop h3')).color);
const lum = (c) => { const [r, g, b2] = c.startsWith('color(') ? c.match(/[\d.]+/g).slice(0, 3).map((x) => +x * 255) : c.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
ok(lum(bg) < 80 && lum(fg) > 180, `6: dark theme: popup is dark (${bg}) with light text (${fg})`);
await S.page.screenshot({ path: SP + '/popup-dark.png' });
await S.ctx.close();

// phone
S = await session({ prefs: { autoWeather: true, fetchAltitude: true }, viewport: { width: 390, height: 780 } });
await S.page.waitForTimeout(1200);
await S.page.click('#dock [data-tab=poi]'); await S.page.click('#poi-list .poi-item:has-text("Seed A")'); await S.page.waitForSelector('.poi-pop h3'); await S.page.waitForTimeout(1500);
const fits = await S.page.evaluate(() => { const r = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
ok(fits.l >= 0 && fits.r <= fits.w, `6: on a phone the marker window fits the screen (${Math.round(fits.l)}–${Math.round(fits.r)} of ${fits.w})`);
await S.page.screenshot({ path: SP + '/popup-phone.png' });
await S.page.click('#dock [data-tab=poi]').catch(() => {});
await S.ctx.close();

console.log('errors:', errs.length ? errs : 'none');
await b.close();
