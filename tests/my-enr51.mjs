// Malaysia ENR 5.1: P / R / D point checks in the real app, desktop and phone. Skips if the data was never built. Needs the app on :5173.
import fs from 'node:fs';
import { ROOT, CHANNEL, chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
if (!fs.existsSync(`${ROOT}/public/data/my/manifest.json`)) { console.log('skipped: no public/data/my (npm run build:data)'); process.exit(0); }
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
for (const [label, vp] of [['desktop', { width: 1300, height: 850 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(() => { localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 3.0, lon: 101.7, zoom: 9 }, basemap: 'osm' })); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close').catch(() => {});
  const check = async (coords) => {
    await p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); });
    await p.fill('#q', coords); await p.keyboard.press('Enter');
    await p.waitForSelector('.leaflet-popup .maplinks', { timeout: 8000 }); await p.waitForTimeout(900);
    return p.evaluate(() => document.querySelector('.leaflet-popup-content-wrapper').innerText);
  };
  let t = await check('2.9150, 101.7983'); // WMP220 Puspati, 1.6 km circle
  ok(/Prohibited area: WMP220/.test(t) && /not permitted/.test(t), `${label}: inside WMP220 shows a prohibited area`);
  t = await check('3.5500, 101.9000'); // inside WMR101A (3 NM around Bentong airstrip)
  ok(/Restricted area: WMR101A/.test(t) && /conditions/.test(t) && !/not permitted/.test(t), `${label}: inside WMR101A shows a restricted area with conditions`);
  t = await check('1.4300, 103.0800'); // inside WMD224 (naval exercise area off Johor)
  ok(/Danger area: WMD224/.test(t) && /Caution/.test(t) && !/No-fly zone/.test(t), `${label}: inside WMD224 shows a danger area as a caution`);
  t = await check('3.3000, 102.2000'); // outside every polygon, in Malaysia
  ok(/No data for this area/i.test(t), `${label}: a Malaysian point outside every polygon is unknown, not clear`);
  t = await check('1.4850, 103.7600'); // central Johor Bahru, inside the 2 NM Bukit Serene prohibited area WMP228 (its southern edge follows the coast: approximate)
  ok(/Potential prohibited airspace — approximate boundary/.test(t) && /WMP228/.test(t), `${label}: Johor Bahru centre is potentially prohibited (WMP228, approximate boundary)`);
  t = await check('1.5600, 103.7800'); // north Johor Bahru, outside every polygon
  ok(/No data for this area/i.test(t), `${label}: a Johor Bahru point outside every polygon is unchanged (no data)`);
  t = await check('1.2800, 103.8600'); // Marina Bay
  ok(/Not inside a mapped no-fly zone/.test(t), `${label}: Singapore verdicts are unchanged`);
  t = await check('1.6661, 102.7367'); // inside WMR240B only: an approximate (reconstructed) restricted boundary
  ok(/Potential restricted airspace — approximate boundary/.test(t) && /conservatively reconstructed from CAAM ENR 5.1/.test(t) && /verify with current CAAM information/.test(t) && !/^Restricted area/m.test(t), `${label}: inside an approximate R boundary shows the uncertainty warning, not an exact verdict`);
  t = await check('5.7000, 101.3436'); // inside WMD419 only: approximate danger
  ok(/Potential danger airspace — approximate boundary/.test(t) && !/Danger area: WMD419/.test(t), `${label}: inside an approximate D boundary is worded as potential danger airspace`);
  t = await check('2.7433, 101.6981'); // KLIA ARP (WMKK): 5 NM airport traffic zone
  ok(/^Airport traffic zone — authorisation required: WMKK/m.test(t) && /not an outright ban/.test(t) && !/Prohibited area|Restricted area|No-fly/.test(t), `${label}: the KLIA ARP shows "Airport traffic zone — authorisation required", not a ban`);
  t = await check('5.9319, 116.0503'); // Kota Kinabalu ARP (WBKK)
  ok(/Airport traffic zone — authorisation required: WBKK/.test(t), `${label}: the Kota Kinabalu ARP shows its airport traffic zone`);
  t = await check('2.7433, 101.8100'); // 12 km east of the KLIA ARP: outside the 9.26 km circle
  ok(/No data for this area/i.test(t), `${label}: 12 km from the KLIA ARP is outside the zone (no data, not clear)`);
  t = await check('3.5497, 101.8819'); // Bentong airstrip ARP: inside the airport zone and the WMR101A restricted area
  ok(/^Restricted area: WMR101A/m.test(t) && /Also inside: Airport traffic zone — authorisation required/.test(t), `${label}: overlapping WMR101A and an airport zone: the restricted area leads, the airport zone is listed`);
  const line = (theme) => p.evaluate((th) => { document.documentElement.setAttribute('data-theme', th); return getComputedStyle(document.documentElement).getPropertyValue('--zone-approx-line').trim(); }, theme);
  const [lt, dk] = [await line('light'), await line('dark')];
  ok(!!lt && !!dk && lt !== dk, `${label}: the approximate-zone outline token differs between the light and dark themes (${lt} / ${dk})`);
  await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await ctx.close();
}
ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
