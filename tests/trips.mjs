// Trips tab in the browser: create, validate, edit, delete, current trip, filter, dots, the marker form, phone width.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from 'playwright-core';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const seedPois = { v: 1, items: [
  { id: 'r1', type: 'residence', name: 'My flat', note: '', lat: 1.3521, lon: 103.8198, created: '2026-11-01T00:00:00.000Z' },
  { id: 'p1', type: 'photo', name: 'Bridge', note: '', lat: 30.5928, lon: 114.3055, created: '2026-11-02T00:00:00.000Z', date: '2026-11-20', tripId: 't1' },
  { id: 'h1', type: 'hotel', name: 'Lake Hotel', note: '', lat: 30.59, lon: 114.30, created: '2026-11-03T00:00:00.000Z', tripId: 't1' },
  { id: 'p2', type: 'photo', name: 'Loose', note: '', lat: 30.6, lon: 114.31, created: '2026-11-04T00:00:00.000Z' },
] };
const seedTrips = { v: 1, trips: [
  { id: 't1', name: 'Wuhan', country: 'CN', startDate: '2026-11-12', endDate: '2026-11-14', description: 'Lakes', color: '#e91e63', created: '2026-11-01T00:00:00.000Z' },
] };

const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const watch = (p) => { p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text())); };
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(([pois, trips]) => {
  if (!localStorage.getItem('uavzones.v1.pois')) { localStorage.setItem('uavzones.v1.pois', JSON.stringify(pois)); localStorage.setItem('uavzones.v1.trips', JSON.stringify(trips)); }
}, [seedPois, seedTrips]);
const p = await ctx.newPage(); watch(p);
const trips = () => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.trips')).trips);
const pois = () => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const toast = () => p.evaluate(() => document.querySelector('#toast, .toast')?.textContent || '');
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);

// ---------- tab
ok((await p.$$eval('[role=tab]', (t) => t.map((x) => x.textContent.trim()))).join('|') === 'Map Configs|Trips|Points of Interest', 'three tabs in order: Map Configs, Trips, Points of Interest');
await p.click('#tab-trips');
ok(await p.isVisible('#pane-trips') && !(await p.isVisible('#pane-poi')), 'the Trips tab opens its own pane');
ok((await p.locator('#trips-list .trip-card').count()) === 1 && /Wuhan/.test(await p.textContent('#trips-list')) && /China/.test(await p.textContent('#trips-list')) && /3 days/.test(await p.textContent('#trips-list')), 'the saved trip is listed with country and length');
ok(/2 markers/.test(await p.textContent('#trips-list .trip-card-count')) && !(await p.isVisible('#trips-empty')), 'it counts its markers (2) and the empty hint is hidden');

// ---------- validation
await p.click('#trip-new');
ok(await p.isVisible('#trip-form-card') && (await p.isDisabled('#trip-end')), 'new trip form opens; end date is disabled until a start date is set');
await p.click('#trip-save');
ok(/name/i.test(await p.textContent('#trip-error')) && (await p.isVisible('#trip-error')), 'empty name is refused with a message');
await p.fill('#trip-name', 'Singapore'); await p.fill('#trip-country', 'Atlantis'); await p.click('#trip-save');
ok(/country/i.test(await p.textContent('#trip-error')) && (await trips()).length === 1, 'an unknown country is refused');
await p.fill('#trip-country', 'Singapore'); await p.fill('#trip-start', '2026-12-05'); await p.fill('#trip-end', '2026-12-03'); await p.click('#trip-save');
ok(/before/i.test(await p.textContent('#trip-error')) && (await trips()).length === 1, 'an end date before the start is refused');
await p.fill('#trip-end', '2026-12-07');
ok(/3 days/.test(await p.textContent('#trip-length')), 'the form shows the length (3 days)');
await p.fill('#trip-desc', 'Marina Bay');
await p.click('#trip-save');
const ts = await trips();
const sg = ts.find((t) => t.name === 'Singapore');
ok(ts.length === 2 && sg.country === 'SG' && sg.startDate === '2026-12-05' && sg.endDate === '2026-12-07' && sg.description === 'Marina Bay', 'a valid trip is saved with the country as its code');
ok(!(await p.isVisible('#trip-form-card')) && (await p.locator('#trips-list .trip-card').count()) === 2, 'the form closes and the list shows both trips');
const prefsNow = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
ok(prefsNow.currentTrip === sg.id && /For new markers/.test(await p.textContent('#trips-list')), 'a new trip becomes the current trip for new markers');
ok((await p.$$eval('#trips-list .trip-card b', (x) => x.map((e) => e.textContent))).join('|').startsWith('Wuhan'), 'trips are ordered by start date');

// ---------- edit
await p.locator('#trips-list .trip-card', { hasText: 'Singapore' }).getByRole('button', { name: 'Edit' }).click();
ok((await p.inputValue('#trip-name')) === 'Singapore' && (await p.inputValue('#trip-country')) === 'Singapore' && (await p.inputValue('#trip-start')) === '2026-12-05', 'Edit fills the form with the trip');
await p.fill('#trip-name', 'Singapore trip'); await p.click('#trip-save');
ok((await trips()).find((t) => t.id === sg.id).name === 'Singapore trip' && (await trips()).length === 2, 'saving an edit updates the trip in place');
await p.locator('#trips-list .trip-card', { hasText: 'Singapore trip' }).getByRole('button', { name: 'Edit' }).click();
await p.click('#trip-cancel');
ok(!(await p.isVisible('#trip-form-card')), 'Cancel closes the form');

// ---------- POI tab: filter, grouping, dots
await p.click('#tab-poi');
ok(await p.isVisible('#poi-trip-field') && await p.isVisible('#poi-trip-filter-field'), 'with trips saved, the "trip for new markers" and the trip filter are shown');
ok((await p.locator('#poi-list .trip-head').count()) >= 1 && /Wuhan/.test(await p.textContent('#poi-list')) && /No trip/i.test(await p.textContent('#poi-list')), 'the list is grouped by trip, with a "No trip" group');
ok((await p.locator('.poi-pin .trip-dot').count()) === 2, 'the two Wuhan markers carry the trip colour dot on the map');
await p.selectOption('#poi-trip-filter', 't1');
ok((await p.locator('#poi-list .poi-item').count()) === 2 && !/Loose/.test(await p.textContent('#poi-list')), 'the trip filter narrows the list to that trip (2 markers)');
await p.selectOption('#poi-trip-filter', { index: 0 });
ok((await p.locator('#poi-list .poi-item').count()) === 4, 'clearing the filter shows all four markers');

// ---------- marker window: warning, form
await p.click('#poi-list .poi-item:has-text("Bridge")');
await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(500);
ok(/Wuhan/.test(await p.textContent('.poi-pop')) && /Outside the trip/.test(await p.textContent('.poi-pop')), 'a marker dated outside its trip (20 Nov vs 12–14 Nov) says so');
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
ok((await p.locator('.poi-pop form select').count()) >= 2 && /New trip/.test(await p.textContent('.poi-pop form')), 'the marker form has a Trip select with "New trip…"');
await p.locator('.poi-pop form select').nth(1).selectOption('');
await p.click('.poi-pop form button[type=submit]'); await p.waitForTimeout(400);
ok((await pois()).find((i) => i.id === 'p1').tripId === undefined, 'choosing "No trip" in the form removes the tag');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

await p.click('#poi-list .poi-item:has-text("My flat")');
await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(500);
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
ok(!(await p.locator('.poi-pop form label:has-text("Trip")').first().isVisible().catch(() => false)) || (await p.locator('.poi-pop form select').count()) === 1, 'the Home marker\'s form has no Trip field');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

// ---------- delete (two steps), markers are kept
await p.click('#tab-trips');
const del = p.locator('#trips-list .trip-card', { hasText: 'Wuhan' }).locator('button.danger');
await del.click();
ok((await trips()).length === 2 && /Confirm/.test(await del.textContent()), 'the first Delete click only asks for confirmation');
await del.click(); await p.waitForTimeout(300);
ok((await trips()).length === 1 && (await pois()).length === 4 && (await pois()).every((i) => i.tripId !== 't1'), 'confirming deletes the trip and keeps all four markers, untagged');

// ---------- persistence
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.click('#tab-trips');
ok((await p.locator('#trips-list .trip-card').count()) === 1 && /Singapore trip/.test(await p.textContent('#trips-list')), 'trips survive a reload');
await ctx.close();

// ---------- phone width
const pc = await b.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
await pc.addInitScript(([pois, trips]) => { localStorage.setItem('uavzones.v1.pois', JSON.stringify(pois)); localStorage.setItem('uavzones.v1.trips', JSON.stringify(trips)); }, [seedPois, seedTrips]);
const q = await pc.newPage(); watch(q);
await q.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await q.waitForTimeout(800);
await q.tap('#dock button[data-tab=trips]'); await q.waitForTimeout(500);
const fit = await q.evaluate(() => { const l = document.querySelector('[role=tablist]'); return { over: l.scrollWidth > l.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth + 1 }; });
ok(!fit.over && !fit.page, 'at 360 px wide the three tabs fit with no horizontal scrolling');
await q.screenshot({ path: `${SP}/trips-phone.png` });
await pc.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
