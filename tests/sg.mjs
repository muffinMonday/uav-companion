// Singapore no-fly zones: per-class drawing, point check, UAFA pins, official map button. Skips if the data was never built.
import fs from 'node:fs';
import { ROOT, CHANNEL, chromium } from './lib.mjs';
const openSearch = (p) => p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); }); // the search box starts folded into a magnifying glass
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
if (!fs.existsSync(`${ROOT}/public/data/sg/manifest.json`)) { console.log('skipped: no public/data/sg (Singapore data not built on this machine: npm run build:data)'); process.exit(0); }
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } });
await ctx.addInitScript(() => { localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.35, lon: 103.82, zoom: 11 }, basemap: 'osm' })); });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');

const check = async (coords) => {
  await openSearch(p); await p.fill('#q', ''); await openSearch(p); await p.fill('#q', coords); await p.waitForTimeout(200);
  await p.keyboard.press('Enter');
  await p.waitForSelector('.leaflet-popup .maplinks', { timeout: 8000 }); await p.waitForTimeout(900);
  return p.evaluate(() => { const w = document.querySelector('.leaflet-popup-content-wrapper'); return { text: w.innerText, official: !!w.querySelector('a.official-link[href*="onemap.gov.sg"]') }; });
};

ok((await p.$$eval('#legend > div', (d) => d.length)) >= 8, 'the legend has a row per Singapore layer');
ok((await p.locator('.uafa-pin').count()) === 3, 'three UA flying-area pins are drawn');

let w = await check('1.3020, 103.8291');
ok(/Restricted area/.test(w.text) && /4,000 feet/.test(w.text) && w.official, 'WSR38 (Padang): restricted area with its height limit, and the official map button');
w = await check('1.3500, 103.7760');
ok(/NParks/.test(w.text), 'Bukit Timah: NParks nature reserve');
w = await check('1.2552, 103.8172');
ok(/Prohibited area/.test(w.text), 'WSP24: prohibited area');
w = await check('1.3814, 103.7866');
ok(/Danger area/.test(w.text), 'WSD35: danger area');
w = await check('1.3875, 103.7090');
ok(/No-fly zone/.test(w.text) && / more/.test(w.text), 'Tengah: several overlapping zones are all listed');
w = await check('1.2800, 103.8600');
ok(/Not inside a mapped no-fly zone/.test(w.text) && w.official, 'Marina Bay: outside the mapped zones, official map still offered');
w = await check('1.4927, 103.7414');
ok(/No data for this area/i.test(w.text) && !w.official, 'Johor Bahru: no data, and no Singapore map button');
w = await check('30.5928, 114.3055');
ok(/zone/i.test(w.text) && !w.official, 'Wuhan still gets the Hubei check, without the OneMap button');
ok((await p.evaluate(() => fetch('/data/index.json').then((r) => r.text()))).includes('"sg"') && !fs.existsSync(`${ROOT}/public/data-local`), 'Singapore is in the public index, and nothing is built local-only');
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
