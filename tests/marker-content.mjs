// Review 01 S3 guard: the DOM of the marker window (view and edit form) for each kind of marker, compared with a recorded baseline.
// `node tests/marker-content.mjs --write` records the baseline (do this only on code whose window is known good). Needs the app on :5173.
import fs from 'node:fs';
import { ROOT, CHANNEL, chromium } from './lib.mjs';
const BASE = `${ROOT}/tests/fixtures/marker-content-baseline.json`;
const WRITE = process.argv.includes('--write');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const errs = [];
const mk = (id, lat, lon, extra) => ({ id, type: 'photo', name: 'Place ' + id, note: '', lat, lon, created: '2026-11-01T00:00:00.000Z', ...extra });
const items = [
  mk('a', 30.50, 114.30, { name: 'Tower', note: 'Best at dusk.', tripId: 't1', date: '2026-11-12', day: 1, order: 1 }),
  mk('b', 30.60, 114.40, { name: 'Bridge', tripId: 't1', date: '2026-11-12', day: 1, order: 2, type: 'viewpoint' }),
  mk('c', 30.70, 114.50, { name: 'Museum', tripId: 't1', date: '2026-11-13', day: 2, order: 3, type: 'landmark' }),
  mk('s', 30.6005, 114.4005, { name: 'Cafe', tripId: 't1', date: '2026-11-12', isSub: true, parentId: 'b', type: 'food' }),
  mk('h', 31.20, 114.30, { name: 'Lake Hotel', type: 'hotel', tripId: 't1', date: '2026-11-12', endDate: '2026-11-14' }),
  mk('r', 31.40, 114.60, { name: 'My flat', type: 'residence' }),
  mk('v1', 31.60, 114.20, { name: 'Pagoda', tripId: 't1', date: '2026-11-12', order: 4 }),
  mk('v2', 31.60, 114.20, { name: 'Pagoda', tripId: 't1', date: '2026-11-13' }),
  mk('u', 31.80, 114.90, { name: 'Guess spot', unverified: true }),
  mk('o', 32.00, 114.10, { name: 'Late spot', tripId: 't1', date: '2026-12-30' }),
  mk('k', 32.20, 114.70, { name: 'Done spot', checkin: { at: '2026-11-12T03:00:00.000Z', lat: 32.2, lon: 114.7, acc: 12 } }),
  mk('p', 32.40, 114.20, { name: 'Plain' }),
];
const trips = [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }];
const CASES = [
  ['saved-stop', 'a', 1200], ['saved-stop-phone', 'a', 390], ['middle-stop-with-side-quest', 'b', 1200], ['side-quest', 's', 1200], ['last-stop', 'c', 1200], ['hotel-stay', 'h', 1200],
  ['home', 'r', 1200], ['visit-1', 'v1', 1200], ['visit-2', 'v2', 1200], ['unverified', 'u', 1200], ['outside-dates', 'o', 1200], ['checked-in', 'k', 1200], ['plain-no-trip', 'p', 1200],
];
const EDITS = [['edit-saved-stop', 'a'], ['edit-home', 'r'], ['edit-side-quest', 's']];
const b = await chromium.launch({ channel: CHANNEL });

async function open(id, width, edit) {
  const it = items.find((x) => x.id === id);
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume();
  await ctx.addInitScript(([po, tr, v]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: v, basemap: 'osm', showSide: true }));
  }, [items, trips, { lat: it.lat, lon: it.lon, zoom: 14 }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
  await p.waitForTimeout(300);
  if (process.env.DBG) console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.poi-pin')].map((e) => [e.getAttribute('title'), Math.round(e.getBoundingClientRect().x)]))), await p.evaluate(() => localStorage.getItem('uavzones.v1.prefs')));
  const pin = await p.evaluate((n) => { const r = [...document.querySelectorAll('.poi-pin')].find((e) => e.getAttribute('title') === n && e.getBoundingClientRect().x > 0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, it.name);
  await p.mouse.click(pin.x, pin.y);
  await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
  await p.waitForTimeout(1500);
  if (edit) { await p.click('.poi-pop .pop-bar button[aria-label="Edit"], .poi-pop button:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(300); }
  const html = await p.evaluate(() => { const r = document.querySelector('.poi-pop').cloneNode(true); r.querySelectorAll('.zone').forEach((z) => z.replaceChildren()); return r.outerHTML; });
  await ctx.close();
  return html;
}

const got = {};
for (const [name, id, w] of CASES) got[name] = await open(id, w, false);
for (const [name, id] of EDITS) got[name] = await open(id, 1200, true);
if (WRITE) { fs.writeFileSync(BASE, JSON.stringify(got, null, 1)); console.log('baseline written: ' + Object.keys(got).length + ' windows'); }
else {
  const want = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  for (const k of Object.keys(want)) ok(got[k] === want[k], 'window DOM unchanged: ' + k);
  ok(Object.keys(got).length === Object.keys(want).length, 'same set of windows');
}
for (const k of Object.keys(got)) ok((/<h3[ >]/.test(got[k]) || /<form[ >]/.test(got[k])) && got[k].length > 200, 'captured: ' + k);
ok(errs.length === 0, 'no page errors ' + errs.join('|'));
await b.close();
process.exit(fails ? 1 : 0);
