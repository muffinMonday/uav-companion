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
  t = await check('1.4850, 103.7600'); // Johor Bahru
  ok(/No data for this area/i.test(t), `${label}: Johor Bahru is unchanged (no data)`);
  t = await check('1.2800, 103.8600'); // Marina Bay
  ok(/Not inside a mapped no-fly zone/.test(t), `${label}: Singapore verdicts are unchanged`);
  await ctx.close();
}
ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
