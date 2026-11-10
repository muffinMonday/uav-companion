import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const seed = { v: 1, items: [
  { id: 'a1', type: 'home', name: 'Seed Home', note: '', lat: 30.5928, lon: 114.3055, created: '2026-11-01T00:00:00.000Z' },
  { id: 'b2', type: 'photo', name: 'Seed Photo', note: 'sunset', lat: 30.5960, lon: 114.3100, created: '2026-11-02T00:00:00.000Z' },
] };
const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const watch = (p) => { p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text())); };
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const rect = (p, sel = '.poi-pin') => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);

// ================= desktop: edit mode =================
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript((s) => { if (!localStorage.getItem('uavzones.v1.pois')) localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); }, seed);
const p = await ctx.newPage(); watch(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.click('#tab-poi');
await p.click('#poi-list .poi-item:has-text("Seed Home")');
await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(900); await p.keyboard.press('Escape');

// enter edit mode
await p.check('#poi-edit');
ok(await p.evaluate(() => document.getElementById('map').classList.contains('is-editing')), 'edit mode adds the editing state to the map');
ok(/Edit mode/.test(await p.textContent('#banner-text')) && (await p.textContent('#banner-action')) === 'Done', 'banner explains edit mode and offers Done');

// map is locked
const pin0 = await rect(p);
await p.mouse.move(700, 600); await p.mouse.down(); await p.mouse.move(520, 480, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500);
const pin1 = await rect(p);
ok(Math.abs(pin1.x - pin0.x) < 1 && Math.abs(pin1.y - pin0.y) < 1, 'map cannot be dragged in edit mode');

// plain click on a pin still opens its popup
await p.mouse.click(pin0.x, pin0.y); await p.waitForSelector('.poi-pop h3', { timeout: 3000 });
ok((await p.textContent('.poi-pop h3')) === 'Seed Home', 'a quick click on a pin opens its popup in edit mode');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
ok(await p.evaluate(() => document.getElementById('map').classList.contains('is-editing')), 'still in edit mode after closing the popup');

// swipe without holding: must not move the pin
const before = (await store(p)).find((i) => i.id === 'a1');
await p.mouse.move(pin0.x, pin0.y); await p.mouse.down(); await p.mouse.move(pin0.x + 70, pin0.y + 50, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
const afterSwipe = (await store(p)).find((i) => i.id === 'a1');
ok(afterSwipe.lat === before.lat && afterSwipe.lon === before.lon, 'moving before the hold finishes does not pick the pin up');

// press and hold, then drag
await p.mouse.move(pin0.x, pin0.y); await p.mouse.down(); await p.waitForTimeout(650);
ok(await p.evaluate(() => document.querySelector('.poi-pin.lifted') !== null), 'holding lifts the pin (visual state)');
await p.mouse.move(pin0.x + 90, pin0.y + 60, { steps: 10 });
const during = await rect(p, '.poi-pin.lifted');
await p.mouse.up(); await p.waitForTimeout(600);
ok(Math.abs(during.x - (pin0.x + 90)) <= 2 && Math.abs(during.y - (pin0.y + 60)) <= 2, `pin follows the pointer exactly (no jump): dx=${(during.x - pin0.x).toFixed(1)} dy=${(during.y - pin0.y).toFixed(1)}`);
const moved = (await store(p)).find((i) => i.id === 'a1');
ok(moved.lon > before.lon + 0.001 && moved.lon < before.lon + 0.01 && moved.lat < before.lat - 0.0005 && moved.lat > before.lat - 0.01, `new position saved: dLon=${(moved.lon - before.lon).toFixed(5)} dLat=${(moved.lat - before.lat).toFixed(5)}`);
ok((await p.locator('.leaflet-popup').count()) === 0, 'releasing a dragged pin does not open its popup');
ok(!(await p.evaluate(() => document.querySelector('.poi-pin.lifted'))), 'lifted state cleared after release');
ok(/Marker moved/.test(await p.textContent('#toast')), 'confirmation toast shown');
ok(/\d+\.\d{5}/.test(await p.textContent('#poi-list .poi-item:has-text("Seed Home") small')), 'list shows the new coordinates');
await p.screenshot({ path: SP + '/ui-edit-mode.png' });

// leave edit mode
await p.click('#banner-action');
ok(!(await p.evaluate(() => document.getElementById('map').classList.contains('is-editing'))) && !(await p.isChecked('#poi-edit')), 'Done leaves edit mode and syncs the switch');
const q0 = await rect(p, '.poi-pin');
await p.mouse.move(700, 600); await p.mouse.down(); await p.mouse.move(600, 520, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(500);
const q1 = await rect(p, '.poi-pin');
ok(Math.abs(q1.x - q0.x) > 20, 'map drags normally again after edit mode');
// pins cannot be moved outside edit mode
const pinNow = await rect(p, '.poi-pin');
const st0 = (await store(p)).map((i) => i.lat + ',' + i.lon).join('|');
await p.mouse.move(pinNow.x, pinNow.y); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.move(pinNow.x + 50, pinNow.y + 50, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
ok((await store(p)).map((i) => i.lat + ',' + i.lon).join('|') === st0, 'pins cannot be moved outside edit mode');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());

// Escape cancels place mode
await p.click('#poi-place'); ok(await p.isVisible('#banner'), 'place mode shows banner');
await p.keyboard.press('Escape'); ok(!(await p.isVisible('#banner')), 'Escape cancels place mode');

// delete with confirmation
await p.click('#poi-list .poi-item:has-text("Seed Photo")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(500);
await p.click('.poi-pop .btn:has-text("Delete")');
ok((await p.textContent('.poi-pop .btn.danger')) === 'Confirm delete', 'first Delete press asks to confirm');
ok((await store(p)).length === 2, 'nothing deleted yet');
await p.click('.poi-pop .btn.danger');
await p.waitForTimeout(300);
ok((await store(p)).length === 1 && (await p.locator('#poi-list .poi-item').count()) === 1 && (await p.locator('.poi-pin').count()) === 1, 'second press deletes (storage, list and map)');

// ================= storage unavailable =================
const ctx2 = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
const p2 = await ctx2.newPage(); watch(p2);
await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
await p2.click('#welcome-go'); // storage is blocked, so the welcome screen cannot remember an opt-out
await p2.click('#tab-poi');
ok(/unavailable/.test(await p2.textContent('#poi-note')), 'no storage: panel says saving is unavailable');
await p2.click('#poi-center'); await p2.waitForSelector('.poi-pop form');
ok((await p2.locator('#poi-list .poi-item').count()) === 1, 'no storage: markers still work for this session');

// ================= phone, touch =================
const ctx3 = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx3.addInitScript((s) => { if (!localStorage.getItem('uavzones.v1.pois')) localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); }, seed);
const p3 = await ctx3.newPage(); watch(p3);
await p3.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p3.waitForTimeout(1000);
ok(!(await p3.isVisible('#panel')) && await p3.isVisible('#dock'), 'phone: starts with the panel hidden and the dock showing');
ok((await p3.locator('#dock span').first().isVisible()) === false, 'phone: dock shows icons only');
await p3.screenshot({ path: SP + '/ui-phone-dock.png' });
await p3.tap('#dock [data-tab=poi]'); await p3.waitForTimeout(300);
await p3.screenshot({ path: SP + '/ui-phone-poi.png' });
await p3.tap('#poi-list .poi-item:has-text("Seed Home")'); await p3.waitForTimeout(1500);
ok(!(await p3.isVisible('#panel')), 'phone: choosing a list item closes the sheet so the map is visible');
await p3.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p3.tap('#dock [data-tab=poi]'); await p3.check('#poi-edit'); await p3.waitForTimeout(300);
ok(!(await p3.isVisible('#panel')) && await p3.isVisible('#banner'), 'phone: edit mode closes the sheet and shows the Done banner');
await p3.screenshot({ path: SP + '/ui-phone-edit.png' });

// touch long-press then drag, via real touch events
const cdp = await ctx3.newCDPSession(p3);
const t = await rect(p3, '.poi-pin');
const s0 = (await store(p3)).find((i) => i.id === 'a1');
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', t.x, t.y); await p3.waitForTimeout(650);
for (let i = 1; i <= 8; i++) { await touch('touchMove', t.x + i * 6, t.y + i * 5); await p3.waitForTimeout(16); }
await touch('touchEnd'); await p3.waitForTimeout(600);
const s1 = (await store(p3)).find((i) => i.id === 'a1');
ok(s1.lon > s0.lon && s1.lat < s0.lat, `phone: touch hold-and-drag moves the pin (dLon=${(s1.lon - s0.lon).toFixed(5)}, dLat=${(s1.lat - s0.lat).toFixed(5)})`);
// touch swipe without hold does not move it
const t2 = await rect(p3, '.poi-pin'); const s2 = (await store(p3)).find((i) => i.id === 'a1');
await touch('touchStart', t2.x, t2.y);
for (let i = 1; i <= 6; i++) { await touch('touchMove', t2.x + i * 10, t2.y + i * 8); await p3.waitForTimeout(16); }
await touch('touchEnd'); await p3.waitForTimeout(400);
const s3 = (await store(p3)).find((i) => i.id === 'a1');
ok(s3.lat === s2.lat && s3.lon === s2.lon, 'phone: a quick touch swipe does not move the pin');

console.log('errors:', errs.length ? errs : 'none');
await b.close();
