import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from 'playwright-core';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const seed = { v: 1, items: [{ id: 'a1', type: 'home', name: 'Seed Home', note: 'n', lat: 30.5928, lon: 114.3055, created: '2026-11-01T00:00:00.000Z' }] };
const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript((s) => { if (!localStorage.getItem('uavzones.v1.pois')) localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); }, seed);
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.click('#tab-poi'); await p.click('#poi-list .poi-item'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1200);

// Edit -> form (popup must stay open, and no stray map-click popup may appear)
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForTimeout(500);
ok((await p.locator('.poi-pop form').count()) === 1, 'Edit opens the form');
ok((await p.locator('.leaflet-popup').count()) === 1 && (await p.locator('.poi-pop .check').count()) === 0, 'exactly one popup, no stray point-check popup');
ok((await p.evaluate(() => document.activeElement?.tagName)) === 'INPUT', 'name field has focus');

// Cancel -> back to view, popup stays
await p.click('.poi-pop .btn:has-text("Cancel")'); await p.waitForTimeout(500);
ok((await p.locator('.poi-pop h3').count()) === 1 && (await p.locator('.leaflet-popup').count()) === 1, 'Cancel returns to the marker view and keeps the popup');

// Edit -> change name/type/note -> Save
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await p.fill('.poi-pop input[type=text]', 'Renamed spot'); await p.selectOption('.poi-pop select', 'hazard'); await p.fill('.poi-pop textarea', 'new note');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
ok((await p.textContent('.poi-pop h3')) === 'Renamed spot' && /new note/.test(await p.textContent('.poi-pop')), 'Save shows the new name and note');
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items[0]);
ok(st.name === 'Renamed spot' && st.type === 'hazard' && st.note === 'new note', 'saved to storage');
ok((await p.textContent('#poi-list .poi-item b')) === 'Renamed spot' && /Hazard/.test(await p.textContent('#poi-list .poi-item small')), 'list updated');
ok(await p.evaluate(() => document.querySelector('.poi-pin svg path').getAttribute('fill') === '#e65100'), 'pin on the map changed to the Hazard colour');

// Edit again straight after saving (the popup was rebuilt)
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForTimeout(400);
ok((await p.locator('.poi-pop form').count()) === 1, 'Edit works again after a save');

// phone / touch
const ctx2 = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
await ctx2.addInitScript((s) => { if (!localStorage.getItem('uavzones.v1.pois')) localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); }, seed);
const p2 = await ctx2.newPage();
await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
await p2.tap('#dock [data-tab=poi]'); await p2.tap('#poi-list .poi-item'); await p2.waitForSelector('.poi-pop h3'); await p2.waitForTimeout(1200);
await p2.tap('.poi-pop .btn:has-text("Edit")'); await p2.waitForTimeout(500);
ok((await p2.locator('.poi-pop form').count()) === 1 && (await p2.locator('.leaflet-popup').count()) === 1, 'phone: tapping Edit opens the form');
await p2.screenshot({ path: SP + '/e-phone.png' });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
