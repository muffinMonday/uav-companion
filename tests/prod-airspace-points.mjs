// Live production point checks: Malaysia P/R/D (incl. approximate boundaries), Singapore unchanged, China suitable-flight zones.
// Runs against the deployed site (default https://uavcompanion.com/, override with APP_URL). Not part of `npm test`: it needs network access.
// Usage: BROWSER_CHANNEL=msedge node tests/prod-airspace-points.mjs
// China: only points whose verdict was confirmed on the live site are asserted. Chongqing and Kunming return "No data" and are NOT asserted here (open question, see CURRENT_STATUS.md).
import { CHANNEL, chromium } from './lib.mjs';
const APP = process.env.APP_URL || 'https://uavcompanion.com/';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const CASES = [
  // [label, coords, check(text) -> boolean, description]
  ['Malaysia', '2.9150, 101.7983', (t) => /Prohibited area: WMP220/.test(t) && /not permitted/.test(t), 'inside WMP220 is prohibited'],
  ['Malaysia', '3.5500, 101.9000', (t) => /Restricted area: WMR101A/.test(t) && /conditions/.test(t) && !/not permitted/.test(t), 'inside WMR101A is restricted with conditions'],
  ['Malaysia', '1.4300, 103.0800', (t) => /Danger area: WMD224/.test(t) && /Caution/.test(t) && !/No-fly zone/.test(t), 'inside WMD224 is a danger area (caution)'],
  ['Malaysia', '3.3000, 102.2000', (t) => /No data for this area/i.test(t), 'Malaysian point outside every polygon is unknown, not clear'],
  ['Malaysia', '1.4850, 103.7600', (t) => /Potential prohibited airspace — approximate boundary/.test(t) && /WMP228/.test(t), 'Johor Bahru centre: potential prohibited (WMP228, approximate)'],
  ['Malaysia', '1.6661, 102.7367', (t) => /Potential restricted airspace — approximate boundary/.test(t) && !/^Restricted area/m.test(t), 'WMR240B: potential restricted (approximate), never an exact verdict'],
  ['Malaysia', '5.7000, 101.3436', (t) => /Potential danger airspace — approximate boundary/.test(t), 'WMD419: potential danger (approximate)'],
  ['Singapore', '1.2800, 103.8600', (t) => /Not inside a mapped no-fly zone/.test(t), 'Marina Bay: Singapore verdict unchanged'],
  ['China', '31.8206, 117.2272', (t) => /Suitable-flight zone \(selected source\)/.test(t), 'Hefei (Anhui): suitable-flight zone'],
  ['China', '30.5928, 114.3055', (t) => /Suitable-flight zone, below 120 m true height/.test(t), 'Wuhan (Hubei): suitable-flight zone below 120 m'],
];
for (const [label, vp] of [['desktop', { width: 1300, height: 850 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(() => { localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 10, lon: 106, zoom: 6 }, basemap: 'osm' })); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(label + ' pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(label + ' ' + m.text()));
  await p.goto(APP, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close').catch(() => {});
  for (const [country, coords, check, desc] of CASES) {
    await p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); });
    await p.fill('#q', coords); await p.keyboard.press('Enter');
    await p.waitForSelector('.leaflet-popup .maplinks', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(900);
    const t = await p.evaluate(() => document.querySelector('.leaflet-popup-content-wrapper')?.innerText || '');
    ok(check(t), `${label} ${country}: ${desc}`);
  }
  await ctx.close();
}
ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
