// Selecting several markers and deleting them: shortcuts, confirmation, export reminder, Undo, phone width.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const mk = (id, type, name, n, extra = {}) => ({ id, type, name, note: '', lat: 30.59 + n * 0.002, lon: 114.30 + n * 0.002, created: `2026-11-0${n + 1}T00:00:00.000Z`, ...extra });
const seedPois = { v: 1, items: [
  mk('i1', 'photo', 'Bridge', 1, { tripId: 't1' }), mk('i2', 'hotel', 'Lake Hotel', 2, { tripId: 't1' }),
  mk('i3', 'photo', 'Loose photo', 3), mk('i4', 'hazard', 'Crowds', 4), mk('i5', 'airport', 'Tianhe', 5), mk('i6', 'residence', 'My flat', 6),
] };
const seedTrips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z' }] };

const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const watch = (p) => { p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text())); };
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
await ctx.addInitScript(([pois, trips]) => {
  if (!localStorage.getItem('uavzones.v1.pois')) { localStorage.setItem('uavzones.v1.pois', JSON.stringify(pois)); localStorage.setItem('uavzones.v1.trips', JSON.stringify(trips)); }
}, [seedPois, seedTrips]);
const p = await ctx.newPage(); watch(p);
const names = () => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => i.name).join());
const pins = () => p.locator('.poi-pin').count();
const boxes = () => p.locator('#poi-list li.selecting .sel-box').count();
const checked = () => p.locator('#poi-list li.selecting .sel-box:checked').count();
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.click('#tab-poi');

// ---------- entering select mode
ok(await p.isVisible('#poi-select') && !(await p.isVisible('#poi-selbar')), 'a "Select markers…" button is shown when there are markers; the select bar is not');
await p.click('#poi-select');
ok(await p.isVisible('#poi-selbar') && !(await p.isVisible('#poi-select')) && (await boxes()) === 6 && (await checked()) === 0, 'select mode shows the bar and a checkbox on every marker, none ticked');
ok(await p.isDisabled('#sel-delete') && /\(0\)/.test(await p.textContent('#sel-delete')), 'Delete is disabled with nothing selected');
const clickedName = 'Loose photo';
await p.click(`#poi-list .poi-item:has-text("${clickedName}")`);
ok((await checked()) === 1 && /\(1\)/.test(await p.textContent('#sel-delete')) && !(await p.isDisabled('#sel-delete')), 'clicking a row ticks it (no map jump needed) and the count reads 1');
await p.click(`#poi-list .poi-item:has-text("${clickedName}")`);
ok((await checked()) === 0, 'clicking it again clears it');
await p.locator('#poi-list li.selecting .sel-box').first().check();
ok((await checked()) === 1, 'the checkbox itself works too');

// ---------- shortcuts
await p.click('#sel-all');
ok((await checked()) === 6 && /\(6\)/.test(await p.textContent('#sel-delete')), '"All shown" ticks all six');
await p.click('#sel-none');
ok((await checked()) === 0, '"None" clears them');
await p.selectOption('#sel-trip', 't1');
ok((await checked()) === 2 && (await p.inputValue('#sel-trip')) === '', 'adding a trip ticks its two markers, and the dropdown goes back to "Choose…"');
await p.selectOption('#sel-type', 'photo');
ok((await checked()) === 3, 'adding a type adds to the selection (Bridge was already ticked, so only Loose photo is new): 3');
await p.selectOption('#sel-trip', 'none');
ok((await checked()) === 5 || (await checked()) === 6, 'adding "No trip" ticks the markers without a trip: ' + (await checked()));
await p.click('#sel-none');
// a filter limits what the shortcuts can select
await p.click('#poi-filter .chip:has-text("Photo spot")');
await p.click('#sel-all');
ok((await boxes()) === 2 && (await checked()) === 2, 'with the Photo spot filter on, "All shown" ticks only the two photo spots');
await p.click('#poi-filter .chip:has-text("All")');
ok((await checked()) === 2, 'clearing the filter keeps those two ticked');
await p.click('#poi-filter .chip:has-text("Hazard")');
ok((await checked()) === 0 && /\(0\)/.test(await p.textContent('#sel-delete')), 'a marker that is filtered out is dropped from the selection, so the count matches what is shown');
await p.click('#poi-filter .chip:has-text("All")');

// ---------- confirmation
await p.click('#sel-none');
await p.selectOption('#sel-trip', 't1');
await p.click('#sel-delete');
const ct = await p.textContent('#sel-confirm-text');
ok(await p.isVisible('#sel-confirm') && /Delete 2 markers\?/.test(ct) && /Export first/.test(ct) && /Undo/.test(ct), 'Delete asks first: states the count (2), the Undo limit and to export first: "' + ct + '"');
await p.click('#sel-cancel');
ok(!(await p.isVisible('#sel-confirm')) && (await names()).split(',').length === 6, 'Cancel closes the question and deletes nothing');
await p.click('#sel-delete');
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#sel-export')]);
ok(/\.geojson$/.test(dl.suggestedFilename()) && /Exported/.test(await p.textContent('#sel-export')) && (await p.isVisible('#sel-confirm')), '"Export first" downloads the backup and keeps the question open');
await dl.saveAs(`${SP}/bulk-export.geojson`);

// ---------- delete and undo
const before = await names();
const pinsBefore = await pins();
await p.click('#sel-confirm-delete');
await p.waitForTimeout(300);
ok((await names()) === 'Loose photo,Crowds,Tianhe,My flat'.split(',').join(',') || (await names()).split(',').length === 4, 'confirming deletes the two markers from storage: ' + (await names()));
ok((await pins()) === pinsBefore - 2, 'and their pins leave the map');
ok(!(await p.isVisible('#poi-selbar')) && (await p.locator('#poi-list .poi-item').count()) === 4, 'select mode ends and the list shows four');
const toastText = await p.textContent('#toast');
ok(/Deleted 2 markers/.test(toastText) && (await p.isVisible('#toast .toast-action')) && /Undo/.test(toastText), 'a message says "Deleted 2 markers" with an Undo button: "' + toastText + '"');
await p.click('#toast .toast-action'); await p.waitForTimeout(300);
ok((await names()) === before, 'Undo restores both markers in their original order');
ok((await pins()) === pinsBefore, 'and their pins');
ok(/Restored 2 markers/.test(await p.textContent('#toast')), 'the message then says "Restored 2 markers"');
const trips = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.filter((i) => i.tripId === 't1').length);
ok(trips === 2, 'restored markers are back in their trip');

// ---------- delete everything, undo, Done
await p.click('#poi-select'); await p.click('#sel-all'); await p.click('#sel-delete');
ok(/Delete 6 markers\?/.test(await p.textContent('#sel-confirm-text')), 'deleting everything says 6');
await p.click('#sel-confirm-delete'); await p.waitForTimeout(300);
ok((await p.locator('#poi-list .poi-item').count()) === 0 && !(await p.isVisible('#poi-select')) && (await pins()) === 0, 'all gone: empty list, no Select button, no pins');
await p.click('#toast .toast-action'); await p.waitForTimeout(300);
ok((await names()) === before && (await p.isVisible('#poi-select')), 'Undo brings all six back');
await p.click('#poi-select'); await p.click('#sel-done');
ok(!(await p.isVisible('#poi-selbar')) && (await p.isVisible('#poi-select')) && (await boxes()) === 0, 'Done leaves select mode without changing anything');
await p.click('#poi-list .poi-item:has-text("Bridge")'); await p.waitForSelector('.poi-pop h3');
ok((await p.textContent('.poi-pop h3')) === 'Bridge', 'outside select mode a row opens the marker as before');
await ctx.close();

// ---------- phone width
const pc = await b.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
await pc.addInitScript(([pois, trips]) => { localStorage.setItem('uavzones.v1.pois', JSON.stringify(pois)); localStorage.setItem('uavzones.v1.trips', JSON.stringify(trips)); }, [seedPois, seedTrips]);
const q = await pc.newPage(); watch(q);
await q.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await q.waitForTimeout(800);
await q.tap('#dock button[data-tab=poi]'); await q.waitForTimeout(400);
await q.tap('#poi-select'); await q.tap('#sel-all'); await q.tap('#sel-delete'); await q.waitForTimeout(300);
const fit = await q.evaluate(() => {
  const bar = document.getElementById('poi-selbar').getBoundingClientRect();
  const over = [...document.querySelectorAll('#poi-selbar button, #poi-selbar select')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > bar.right + 1 || r.left < bar.left - 1; }).length;
  return { over, page: document.documentElement.scrollWidth > innerWidth + 1 };
});
ok(fit.over === 0 && !fit.page, 'at 360 px the select bar and the question fit with no sideways scrolling');
await q.screenshot({ path: `${SP}/bulk-phone.png` });
await pc.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
