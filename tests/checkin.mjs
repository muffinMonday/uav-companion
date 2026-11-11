// Check-in at markers: enabled within 300 m, recorded with position and time, shown at the right of the rows, opt-in and only while markers show.
import { chromium, CHANNEL, ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dashClick } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const trips = [{ id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('tw', 'Tower', 30.5928, 114.3055, { tripId: 't1', date: iso(5), order: 1 }),
  mk('lk', 'Lake', 30.55, 114.37, { tripId: 't1', date: iso(5), order: 2 }),
  mk('hm', 'Flat', 30.4, 114.1, { type: 'residence' }),
];
const FAR = { latitude: 30.70, longitude: 114.30, accuracy: 20 };
const NEAR_TOWER = { latitude: 30.5930, longitude: 114.3057, accuracy: 20 };

const b = await chromium.launch({ channel: CHANNEL });
async function open({ checkIn = true, geo = FAR, vp = { width: 1300, height: 900 } } = {}) {
  const ctx = await b.newContext({ viewport: vp, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], geolocation: geo });
  await ctx.addInitScript(([po, tr, ci]) => {
    const g = navigator.geolocation, w = g.watchPosition.bind(g), c = g.clearWatch.bind(g);
    window.__watches = new Set();
    g.watchPosition = (a, e, o) => { const id = w(a, e, o); window.__watches.add(id); return id; };
    g.clearWatch = (id) => { window.__watches.delete(id); return c(id); };
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', checkIn: ci }));
  }, [items, trips, checkIn]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(800);
  return { ctx, p };
}
const row = (p, name) => p.locator('#poi-list li', { hasText: name });
const watches = (p) => p.evaluate(() => window.__watches.size);
const stored = (p, id) => p.evaluate((i) => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((x) => x.id === i), id);

let { ctx, p } = await open();
ok(await watches(p) === 1, 'with check-in on and the markers showing, the position is being watched');
ok(await row(p, 'Tower').locator('.checkin-btn').isDisabled() && await row(p, 'Lake').locator('.checkin-btn').isDisabled(), 'far from every marker, the buttons are disabled');
ok(/away/.test(await row(p, 'Tower').locator('.checkin-btn').getAttribute('title')) && /300 m/.test(await row(p, 'Tower').locator('.checkin-btn').getAttribute('title')), 'and say how far you are: ' + await row(p, 'Tower').locator('.checkin-btn').getAttribute('title'));
ok((await row(p, 'Flat').locator('.checkin').count()) === 0, 'the Home marker has no check-in');
await ctx.setGeolocation(NEAR_TOWER);
await p.waitForFunction(() => { const b = [...document.querySelectorAll('#poi-list li')].find((l) => l.textContent.includes('Tower'))?.querySelector('.checkin-btn'); return b && !b.disabled; }, null, { timeout: 15000 });
ok(await row(p, 'Lake').locator('.checkin-btn').isDisabled(), 'next to the Tower its button opens, the Lake\'s stays shut');
await ctx.setGeolocation({ ...NEAR_TOWER, accuracy: 400 });
await p.waitForFunction(() => [...document.querySelectorAll('#poi-list li')].find((l) => l.textContent.includes('Tower'))?.querySelector('.checkin-btn')?.disabled, null, { timeout: 15000 });
ok(/accurate to about 400 m/.test(await row(p, 'Tower').locator('.checkin-btn').getAttribute('title')), 'a rough fix closes it again, and the tooltip says why');
await ctx.setGeolocation(NEAR_TOWER);
await p.waitForFunction(() => { const b = [...document.querySelectorAll('#poi-list li')].find((l) => l.textContent.includes('Tower'))?.querySelector('.checkin-btn'); return b && !b.disabled; }, null, { timeout: 15000 });
await row(p, 'Tower').locator('.checkin-btn').click(); await p.waitForTimeout(500);
const rec = await stored(p, 'tw');
ok(rec.checkin && Math.abs(rec.checkin.lat - 30.5930) < 0.0002 && Math.abs(rec.checkin.lon - 114.3057) < 0.0002 && rec.checkin.acc === 20 && Math.abs(Date.parse(rec.checkin.at) - Date.now()) < 60000, 'Check in saves your position, the accuracy and the time: ' + JSON.stringify(rec.checkin));
const done = row(p, 'Tower').locator('.checkin-done');
ok(/^✓/.test(await done.textContent()) && /\d{2}:\d{2}/.test(await done.textContent()), 'the row shows what was recorded: ' + await done.textContent());
const item = await row(p, 'Tower').locator('.poi-item').boundingBox(), cell = await done.boundingBox();
ok(cell.x > item.x + item.width * 0.4, 'and it sits at the right of the row');
await p.screenshot({ path: 'tests/out/checkin-poi.png' });
await row(p, 'Tower').locator('.poi-item').click(); await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
ok(/Checked in/.test(await p.textContent('.poi-pop .pop-checkin')), 'the marker window says so too');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click());

// the trip screens
await p.click('#tab-trips'); await p.waitForTimeout(300);
ok(/1 of 2 visited/.test(await p.textContent('#trips-list .trip-card')), 'the trip card counts the visited markers');
await p.locator('#trips-list .trip-card .trip-card-head').click(); await p.waitForTimeout(400);
ok(/1 of 2 visited/.test(await p.textContent('#trip-detail .flip-body')), 'and so does the day card');
ok(/✓/.test(await p.locator('#trip-detail .plan-row', { hasText: 'Tower' }).locator('.checkin-done').textContent()) && await p.locator('#trip-detail .plan-row', { hasText: 'Lake' }).locator('.checkin-btn').isDisabled(), 'the stops on the day card show the check-in, or a shut button');

// clearing
await p.click('#trip-detail >> text=‹ Trips'); await p.click('#tab-poi'); await p.waitForTimeout(300);
const clear = row(p, 'Tower').locator('.checkin-clear');
await clear.click(); await p.waitForTimeout(150);
ok(/Clear\?/.test(await clear.textContent()) && (await stored(p, 'tw')).checkin, 'the ✕ asks first');
await clear.click(); await p.waitForTimeout(400);
ok(!(await stored(p, 'tw')).checkin && await row(p, 'Tower').locator('.checkin-btn').isVisible(), 'the second press clears it and the button is back');
await row(p, 'Tower').locator('.checkin-btn').click(); await p.waitForTimeout(400);

// a share link leaves it out, the export keeps it
await dashClick(p, '#poi-share'); await p.waitForTimeout(600);
const link = await p.evaluate(() => navigator.clipboard.readText());
const { decodeShare } = await import(pathToFileURL(path.join(ROOT, 'src/aiimport.js')).href);
const shared = JSON.stringify(await decodeShare(link.split('#import=')[1]));
ok(shared.includes('Tower') && !/checkin/.test(shared), 'a share link carries the markers but not where you were');
ok(/check-in positions/.test(await p.textContent('#poi-note')), 'the backup note says an export includes the check-in positions');

// only while markers are on show
ok(await watches(p) === 1, 'watching on the Points of Interest tab');
await p.click('#tab-config'); await p.waitForTimeout(400);
ok(await watches(p) === 0, 'it stops when the panel shows Map Configs');
await p.click('#tab-poi'); await p.waitForTimeout(400);
ok(await watches(p) === 1, 'and starts again on the markers');
await p.click('#panel-roll'); await p.waitForTimeout(400);
ok(await watches(p) === 0, 'it stops when the panel is rolled up');
await p.click('#panel-roll'); await p.waitForTimeout(300);
await p.click('#panel-close'); await p.waitForTimeout(400);
ok(await watches(p) === 0, 'and when the panel is hidden');
await ctx.close();

// ================= off by default
({ ctx, p } = await open({ checkIn: false }));
ok(await watches(p) === 0 && (await p.locator('#poi-list .checkin-btn').count()) === 0, 'with check-in off nothing is watched and there are no buttons');
await p.click('#privacy-btn'); await p.check('#pv-checkin'); await p.waitForTimeout(300); await p.click('#privacy-back'); await p.waitForTimeout(1200);
ok(await watches(p) === 1 && (await p.locator('#poi-list .checkin-btn').count()) === 2, 'turning the switch on in the privacy settings starts it, and the buttons appear');
await ctx.close();

// ================= blocked location
{
  const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } }); // no geolocation permission
  await ctx2.addInitScript(([po, tr]) => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ basemap: 'osm', checkIn: true })); }, [items, trips]);
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
  await p2.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p2.waitForTimeout(1500);
  const btn = p2.locator('#poi-list li', { hasText: 'Tower' }).locator('.checkin-btn');
  ok(await btn.isDisabled() && /blocked|Waiting/.test(await btn.getAttribute('title')), 'with the location blocked the button stays disabled and says so: ' + await btn.getAttribute('title'));
  await ctx2.close();
}
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
