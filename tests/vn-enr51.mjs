// Vietnam ENR 5.1: P / R / D point checks in the real app, desktop and phone, plus unchanged China / Malaysia / Singapore behaviour.
// Skips if the data was never built. Needs the app on :5173.
import fs from 'node:fs';
import { ROOT, CHANNEL, chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
if (!fs.existsSync(`${ROOT}/public/data/vn/manifest.json`)) { console.log('skipped: no public/data/vn (npm run build:data)'); process.exit(0); }
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
for (const [label, vp] of [['desktop', { width: 1300, height: 850 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(() => { localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 21.0, lon: 105.8, zoom: 9 }, basemap: 'osm' })); });
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
  let t = await check('21.0305, 105.8000'); // inside VVP1 Ha Noi City
  ok(/Prohibited area: VVP1/.test(t) && /not permitted/.test(t), `${label}: inside VVP1 shows a prohibited area`);
  t = await check('15.4056, 108.7064'); // centre of VVR11 (15 km circle)
  ok(/Restricted area: VVR11/.test(t) && /conditions/.test(t) && !/not permitted/.test(t), `${label}: inside VVR11 shows a restricted area with conditions`);
  t = await check('10.9206, 106.7267'); // centre of VVD23 (5 km circle, Tan Son Nhat)
  ok(/Danger area: VVD23/.test(t) && /Caution/.test(t) && !/No-fly zone/.test(t), `${label}: inside VVD23 shows a danger area as a caution`);
  t = await check('20.5000, 105.0000'); // Vietnam, outside every polygon
  ok(/No data for this area/i.test(t), `${label}: a Vietnamese point outside every polygon is unknown, not clear`);
  t = await check('11.1000, 106.8000'); // inside VVR19 Bien Hoa (approximate boundary)
  ok(/Potential restricted airspace — approximate boundary: VVR19/.test(t) && /Boundary approximated from official AIP chart/.test(t) && !/^Restricted area/m.test(t), `${label}: inside VVR19 shows potential restricted airspace with the chart-approximation notice`);
  t = await check('10.7000, 106.8000'); // south of VVR19, outside every polygon
  ok(!/VVR19/.test(t) && /No data for this area/i.test(t), `${label}: just south of VVR19 is unknown, not inside it`);
  t = await check('21.0950, 105.4600'); // inside VVD43 (interpreted vertex 210333N)
  ok(/Potential danger airspace — approximate boundary: VVD43/.test(t) && /Caution|danger/i.test(t), `${label}: inside VVD43 shows potential danger airspace, approximate boundary`);
  t = await check('21.0150, 105.4700'); // inside VVD45 (interpreted vertex 1052002E)
  ok(/Potential danger airspace — approximate boundary: VVD45/.test(t), `${label}: inside VVD45 shows potential danger airspace, approximate boundary`);
  t = await check('1.2800, 103.8600'); // Marina Bay
  ok(/Not inside a mapped no-fly zone/.test(t), `${label}: Singapore verdicts are unchanged`);
  t = await check('2.9150, 101.7983'); // WMP220 Puspati
  ok(/Prohibited area: WMP220/.test(t), `${label}: Malaysia verdicts are unchanged`);
  await ctx.close();
}
ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
