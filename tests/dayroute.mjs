// Selecting a marker: the day's route with the selected stop's arrows in bold, and the switch that stops the details window opening.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const D = '2026-11-20';
const trips = [{ id: 't1', name: 'Hubei', startDate: D, endDate: '2026-11-21', description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('a', 'Alpha', 30.590, 114.300, { tripId: 't1', date: D, order: 1 }),
  mk('b', 'Bravo', 30.600, 114.310, { tripId: 't1', date: D, order: 2 }),
  mk('c', 'Charlie', 30.610, 114.325, { tripId: 't1', date: D, order: 3 }),
  mk('h', 'Hotel', 30.585, 114.296, { tripId: 't1', type: 'hotel', date: D, endDate: '2026-11-21' }),
  mk('x', 'Elsewhere', 30.620, 114.340, { tripId: 't1', date: '2026-11-21', order: 1 }),
];
const b = await chromium.launch({ channel: CHANNEL });
async function open(prefs = {}, vp = { width: 1300, height: 900 }) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(([po, tr, pf]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.60, lon: 114.31, zoom: 13 }, basemap: 'osm', ...pf }));
  }, [items, trips, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.click('#panel-close'); await p.waitForTimeout(250);
  return { ctx, p };
}
const pin = (p, name) => p.locator(`.leaflet-marker-icon[title="${name}"]`).first();
const segs = (p) => p.$$eval('path.route-seg', (e) => e.map((x) => x.classList.contains('bold')));
const count = (p, sel) => p.locator(sel).count();
const popup = (p) => p.locator('.leaflet-popup').count();

// ================= details on (the default)
let { ctx, p } = await open();
await pin(p, 'Bravo').click(); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 }); await p.waitForTimeout(300);
ok((await segs(p)).length === 2 && (await segs(p)).every(Boolean), 'selecting the middle stop draws its day, and both arrows touching it are bold');
ok(await count(p, '.route-arrow') === 2 && await count(p, '.route-arrow.bold') === 2, 'each segment has an arrow, bold when it touches the selected stop');
ok(await count(p, '.seg-label') === 2 && /\d/.test(await p.locator('.seg-label').first().textContent()), 'the bold segments say how far: ' + await p.locator('.seg-label').first().textContent());
ok(await count(p, '.dist-label-text:not(.seg-label)') >= 1, 'the dashed displacement line to the hotel is still drawn, with its own label');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(300);
ok(await count(p, 'path.route-seg') === 0 && await count(p, '.route-arrow') === 0, 'closing the window clears the route');
await pin(p, 'Alpha').click(); await p.waitForSelector('.leaflet-popup h3'); await p.waitForTimeout(300);
let s = await segs(p);
ok(s.length === 2 && s.filter(Boolean).length === 1 && s[0] === true, 'the first stop: only the arrow out of it is bold');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(250);
await pin(p, 'Charlie').click(); await p.waitForSelector('.leaflet-popup h3'); await p.waitForTimeout(300);
s = await segs(p);
ok(s.length === 2 && s.filter(Boolean).length === 1 && s[1] === true, 'the last stop: only the arrow into it is bold');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(250);
await pin(p, 'Hotel').click(); await p.waitForSelector('.leaflet-popup h3'); await p.waitForTimeout(300);
s = await segs(p);
ok(s.length === 2 && s.every((x) => !x), 'the hotel is not part of the chain: the day shows thin, nothing bold');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(250);
await pin(p, 'Elsewhere').click(); await p.waitForSelector('.leaflet-popup h3'); await p.waitForTimeout(300);
ok(await count(p, 'path.route-seg') === 0, 'a day with a single stop has nothing to join');
await ctx.close();

// ================= the switch
({ ctx, p } = await open());
ok(await p.locator('.details-btn').isVisible() && (await p.locator('.details-btn').boundingBox()).y > (await p.locator('.locate-btn').boundingBox()).y, 'the button on the map sits below the location button');
ok((await p.locator('.details-btn').getAttribute('title')).includes('on'), 'it says details are on');
await p.click('.details-btn'); await p.waitForTimeout(200);
ok(await p.locator('.details-btn.off').count() === 1 && (await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).markerDetails)) === false, 'one tap turns details off and it is remembered');
await pin(p, 'Bravo').click(); await p.waitForTimeout(500);
ok(await popup(p) === 0, 'a click on a marker opens no window');
ok(/Bravo/.test(await p.textContent('.name-tag')) && await count(p, '.name-tag-info') === 1, 'it shows a name tag with an ⓘ');
ok((await segs(p)).filter(Boolean).length === 2 && await count(p, '.dist-label-text:not(.seg-label)') >= 1, 'the day\'s route and the displacement line to the hotel are there');
ok(await count(p, '.poi-pin.focused') === 1, 'and the pin stands out');
await p.click('.name-tag-info'); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 });
ok((await p.textContent('.leaflet-popup h3')) === 'Bravo' && await count(p, '.name-tag') === 0, 'the ⓘ opens that marker\'s window (and the tag gives way to it)');
ok(/Hide/.test(await p.getAttribute('.leaflet-popup .pop-toggle', 'aria-label')) && await p.locator('.leaflet-popup .pop-eye.off').count() === 1, 'with details off the window\'s v button says it hides into the ⓘ, and its eye shows the setting as off');
await p.click('.leaflet-popup .pop-toggle'); await p.waitForTimeout(500);
ok(await popup(p) === 0 && await count(p, '.name-tag') === 1 && (await segs(p)).filter(Boolean).length === 2, 'pressing it tucks the window away into the name tag, and the marker stays selected with its routes');
await p.click('.name-tag-info'); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 });
await p.click('.leaflet-popup .pop-eye'); await p.waitForTimeout(400);
ok(await popup(p) === 1 && await p.locator('.details-btn.off').count() === 0 && await p.locator('#poi-details').isChecked() && await p.locator('.leaflet-popup .pop-eye.off').count() === 0, 'the eye in the window turns details back on: the window stays, and the map button and the switch follow');
ok(/Collapse|Expand/.test(await p.getAttribute('.leaflet-popup .pop-toggle', 'aria-label')), 'and the v button is a collapse/expand button again');
await p.click('.leaflet-popup .pop-eye'); await p.waitForTimeout(500);
ok(await popup(p) === 0 && await count(p, '.name-tag') === 1 && await p.locator('.details-btn.off').count() === 1 && !(await p.locator('#poi-details').isChecked()), 'pressing it again turns details off: the window closes into the name tag, and the button and the switch follow');
await p.click('.name-tag-info'); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 }); // reopened for the steps that follow
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(300);
await pin(p, 'Alpha').click(); await p.waitForTimeout(400);
await p.mouse.click(1000, 800); await p.waitForTimeout(400);
ok(await count(p, '.name-tag') === 0 && await count(p, 'path.route-seg') === 0 && await count(p, '.poi-pin.focused') === 0, 'a click on blank map clears the selection');
await pin(p, 'Charlie').click(); await p.waitForTimeout(400);
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(await count(p, '.name-tag') === 0 && await count(p, 'path.route-seg') === 0, 'Escape clears it too');
// from the list
await p.click('#dock button[data-tab=poi]'); await p.waitForTimeout(300);
await p.locator('#poi-list .poi-item:has-text("Bravo")').click(); await p.waitForTimeout(1200);
ok(await popup(p) === 0 && /Bravo/.test(await p.textContent('.name-tag')), 'a tap on a row in the list selects the marker the same way');
ok(!(await p.locator('#poi-details').isChecked()), 'the switch in the Points of Interest tab shows the same setting');
await p.locator('#poi-details').check(); await p.waitForTimeout(250);
ok(await count(p, '.details-btn.off') === 0 && await count(p, '.name-tag') === 0, 'turning it back on there updates the map button and drops the tag');
await pin(p, 'Bravo').click(); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 });
ok(true, 'and clicks open the window again');
await ctx.close();

// remembered
({ ctx, p } = await open({ markerDetails: false }));
ok(await p.locator('.details-btn.off').count() === 1, 'with the setting saved, the next visit starts with details off');
await ctx.close();

// ================= a day on the trip screen is drawn on the map
({ ctx, p } = await open());
await p.click('#dock button[data-tab=trips]'); await p.waitForTimeout(300);
await p.locator('#trips-list .trip-card .trip-card-head').click(); await p.waitForTimeout(500);
s = await segs(p);
ok(s.length === 2 && s.every((x) => !x), 'the trip screen draws the day on show, all thin: ' + s.length + ' segments');
await p.locator('#trip-detail .flip-btn').nth(1).click(); await p.waitForTimeout(400);
ok(await count(p, 'path.route-seg') === 0, 'turning to a day with a single stop leaves nothing to draw');
await p.locator('#trip-detail .flip-btn').nth(0).click(); await p.waitForTimeout(300);
await p.click('#trip-detail >> text=‹ Trips'); await p.waitForTimeout(400);
ok(await count(p, 'path.route-seg') === 0, 'leaving the trip screen clears it');
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
