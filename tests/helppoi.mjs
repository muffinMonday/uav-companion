// Contextual help for the POI explorer: the reworded poi hint keeps its seen state, the type-picker and trip-visibility hints show once at a first use,
// nothing shows while placing, editing, selecting or dragging, the older-version notice must be dismissed and waits for a quiet moment,
// and the dashboard shortcuts and Tips replay them. Screenshots go to tests/out/helppoi/.
import { chromium, CHANNEL, LATEST_SEEN, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/helppoi`; fs.mkdirSync(shots, { recursive: true });
const HELPKEY = 'uavzones.v1.help';
const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.004, lon: 114.3 + n * 0.004, created: `2026-11-01T00:00:${String(10 + n).padStart(2, '0')}.000Z`, ...extra });
const items = [mk('a', 'Alpha', 1, { tripId: 't1', date: '2026-11-12', order: 1 }), mk('b', 'Bravo', 2, { tripId: 't1', date: '2026-11-13', order: 1 }), mk('s', 'Shared stop', 3, { tripId: 't2', date: '2026-11-12', order: 1, updated: '2026-11-01T00:00:00.000Z' })];
const trips = { v: 1, trips: [
  { id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' },
  { id: 't2', name: 'With friends', color: '#3949ab', description: '', created: '2026-11-01T00:00:01.000Z', startDate: '2026-11-12', endDate: '2026-11-14', shared: { owner: true, ownerName: 'You' } },
] };
const b = await chromium.launch({ channel: CHANNEL });

async function open({ seen = null, vp = { width: 1200, height: 800 }, touch = false } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, addFolded: true, listFolded: true });
  await ctx.addInitScript(([po, tr, sn, lv, key]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: lv }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.52, lon: 114.32, zoom: 12 }, basemap: 'osm' }));
    if (sn) localStorage.setItem(key, JSON.stringify({ v: 1, seen: sn })); else localStorage.removeItem(key);
  }, [items, trips, seen, LATEST_SEEN, HELPKEY]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  while (await p.locator('.help-hint .help-ok').count()) { await p.click('.help-hint .help-ok'); await p.waitForTimeout(100); } // the Map Configs hint that opens with the panel is not what is tested here
  return { ctx, p };
}
const tab = async (p, n) => { await p.evaluate((x) => { if (document.getElementById('panel').hidden) document.querySelector(`#dock button[data-tab=${x}]`).click(); else document.getElementById('tab-' + x).click(); }, n); await p.waitForTimeout(300); };
const hint = (p) => p.$$eval('.help-hint', (l) => l.map((x) => x.dataset.hint));
const seenList = (p) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) ?? '{}').seen ?? []; } catch { return []; } }, HELPKEY);
const got = (p) => p.click('.help-hint .help-ok');

// ================= the reworded poi hint, and seen history
let { ctx, p } = await open();
await tab(p, 'poi');
for (let i = 0; i < 4 && !(await hint(p)).includes('poi'); i++) { await p.waitForTimeout(600); if (!(await hint(p)).includes('poi')) { await tab(p, 'trips'); await tab(p, 'poi'); } } // a window that is not in front (parallel runs) can skip the automatic showing; leaving and coming back asks again
ok((await hint(p)).join() === 'poi' && /Add a marker/.test(await p.textContent('.help-hint')) && /Search/i.test(await p.textContent('.help-hint')), 'first visit: the poi hint explains Add a marker and search');
await got(p);
await p.close(); await ctx.close();
({ ctx, p } = await open({ seen: ['poi', 'trips'] }));
await tab(p, 'poi');
ok((await hint(p)).length === 0 && (await seenList(p)).join() === 'poi,trips', 'a visitor who saw the old poi hint is not shown the new text, and their seen list is untouched');

// ================= type picker hint: once, at the first change of group
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.click('#type-tab-transport'); await p.waitForTimeout(200);
ok((await hint(p)).join() === 'poi-types' && /Travel & Places/.test(await p.textContent('.help-hint')), 'the first change of group in the picker shows the picker hint');
ok(await p.evaluate(() => document.getElementById('poi-type-now').nextElementSibling?.dataset.hint === 'poi-types'), 'it sits under the picker');
await p.screenshot({ path: shots + '/types-hint.png' });
await got(p); await p.waitForTimeout(100);
await p.click('#type-tab-drone'); await p.waitForTimeout(200);
ok((await hint(p)).length === 0 && (await seenList(p)).includes('poi-types'), 'dismissed once, it does not come back');

// ================= trip visibility hint: the first time a trip is opened
await p.click('#poi-list li.trip-head:has-text("Wuhan") .sec-toggle'); await p.waitForTimeout(200);
ok((await hint(p)).join() === 'trip-visibility' && /this device only/i.test(await p.textContent('.help-hint')), 'opening a trip for the first time shows the On map hint');
await p.screenshot({ path: shots + '/visibility-hint.png' });
await p.waitForTimeout(1700);
ok((await seenList(p)).includes('trip-visibility'), 'it counts as seen after it has stayed up a moment');
await p.click('#poi-list li.trip-head:has-text("Wuhan") .sec-toggle'); await p.click('#poi-list li.trip-head:has-text("Wuhan") .sec-toggle'); await p.waitForTimeout(200);
ok((await hint(p)).filter((h) => h === 'trip-visibility').length <= 1, 'and it is not shown again automatically');
await p.close(); await ctx.close();

// ================= nothing while busy
({ ctx, p } = await open());
await tab(p, 'poi'); await got(p);
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.click('#poi-place'); await p.waitForTimeout(200);
await p.evaluate(() => document.getElementById('type-tab-transport').click()); await p.waitForTimeout(200);
ok((await hint(p)).length === 0 && !(await seenList(p)).includes('poi-types'), 'while placing a marker the picker hint is held back and not used up');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.evaluate(() => { const e = document.getElementById('poi-edit'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
await p.evaluate(() => document.getElementById('type-tab-drone').click()); await p.waitForTimeout(200);
ok((await hint(p)).length === 0, 'while edit mode is on, no hint');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.click('#poi-select'); await p.waitForTimeout(200);
await p.evaluate(() => document.getElementById('type-tab-special').click()); await p.waitForTimeout(200);
ok((await hint(p)).length === 0, 'while selecting markers, no hint');
await p.click('#sel-done'); await p.waitForTimeout(200);
await p.evaluate(() => document.body.classList.add('reordering'));
await p.evaluate(() => document.getElementById('type-tab-travel').click()); await p.waitForTimeout(200);
ok((await hint(p)).length === 0, 'while a row is being dragged, no hint');
await p.evaluate(() => document.body.classList.remove('reordering'));
await p.evaluate(() => document.getElementById('type-tab-transport').click()); await p.waitForTimeout(200);
ok((await hint(p)).join() === 'poi-types', 'once the user is idle the next first use shows it');
await p.close(); await ctx.close();

// ================= the older-version notice
({ ctx, p } = await open({ seen: ['poi', 'poi-types', 'trip-visibility', 'trips', 'map-tools', 'point-check'] }));
await tab(p, 'poi');
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.selectOption('#poi-trip', 't2');
await p.click('#type-tab-travel');
await p.click('#poi-types [data-type=food]');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
ok((await hint(p)).length === 0, 'right after creating (the marker window is open) the notice waits');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p.waitForSelector('.help-hint[data-hint=newtype-shared]', { timeout: 8000 });
ok(/older app version/i.test(await p.textContent('.help-hint')), 'when the window is closed it appears and names the older-version risk');
await p.screenshot({ path: shots + '/newtype-notice.png' });
await p.waitForTimeout(2500);
ok(!(await seenList(p)).includes('newtype-shared') && (await hint(p)).includes('newtype-shared'), 'it is not used up by staying on screen');
ok(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.some((i) => i.type === 'food' && i.tripId === 't2')), 'and saving was never blocked: the marker is saved');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
ok(!(await seenList(p)).includes('newtype-shared'), 'after a reload it is still not seen');
await tab(p, 'poi');
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.selectOption('#poi-trip', 't2');
await p.click('#poi-types [data-type=food]').catch(async () => { await p.click('#type-tab-travel'); await p.click('#poi-types [data-type=food]'); });
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p.waitForSelector('.help-hint[data-hint=newtype-shared]', { timeout: 8000 });
await got(p); await p.waitForTimeout(150);
ok((await seenList(p)).includes('newtype-shared'), 'Got it marks it seen');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(2500);
ok(!(await hint(p)).includes('newtype-shared'), 'after that it does not return');
// a private trip, or an older type, gives no notice
await p.selectOption('#poi-trip', 't1');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await p.close(); await ctx.close();
({ ctx, p } = await open({ seen: ['poi', 'poi-types', 'trip-visibility', 'trips', 'map-tools', 'point-check'] }));
await tab(p, 'poi');
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.selectOption('#poi-trip', 't1');
await p.click('#type-tab-travel'); await p.click('#poi-types [data-type=food]');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(2500);
ok(!(await hint(p)).includes('newtype-shared'), 'a newer type in a private trip gives no notice');
await p.selectOption('#poi-trip', 't2');
await p.click('#type-tab-drone'); await p.click('#poi-types [data-type=photo]');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(2500);
ok(!(await hint(p)).includes('newtype-shared'), 'an older type in a shared trip gives no notice');
await p.close(); await ctx.close();

// ================= dashboard: shortcuts and Tips
({ ctx, p } = await open({ seen: ['poi', 'poi-types', 'trip-visibility', 'trips', 'map-tools', 'point-check'] }));
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
await p.evaluate(() => document.querySelectorAll('.dash-topic').forEach((d) => { d.open = true; }));
const tasks = await p.$$eval('.dash-help-view .btn', (l) => l.map((x) => x.textContent));
ok(['Find saved places', 'Save a place'].every((t) => tasks.includes(t)), 'Help (Trips topic) has Save a place and Find saved places: ' + tasks.join(' | '));
const tips = await p.$$eval('.dash-help-view [data-replay]', (l) => l.map((x) => x.dataset.replay));
ok(['poi-types', 'trip-visibility', 'newtype-shared', 'poi'].every((i) => tips.includes(i)), 'Help can replay the POI hints (poi, poi-types, trip-visibility, newtype-shared): ' + tips.join());
await p.click('#task-find'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.activeElement?.id === 'poi-search'), 'Find saved places opens the list and puts the cursor in the search box');
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
await p.evaluate(() => document.querySelectorAll('.dash-topic').forEach((d) => { d.open = true; }));
await p.click('.dash-help-view [data-replay=poi-types]'); await p.waitForTimeout(400);
ok((await hint(p)).includes('poi-types') && await p.evaluate(() => document.getElementById('poi-add').open), 'Choose a marker type opens Add a marker and shows the picker hint, though it was seen');
ok((await seenList(p)).join() === 'poi,poi-types,trip-visibility,trips,map-tools,point-check', 'a replay leaves the seen history as it was');
await p.screenshot({ path: shots + '/dashboard-replay.png' });
await p.close(); await ctx.close();

// ================= phone
({ ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true }));
await tab(p, 'poi'); await got(p);
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.tap('#type-tab-transport'); await p.waitForTimeout(250);
const box = await p.locator('.help-hint').boundingBox();
ok((await hint(p)).join() === 'poi-types' && box && box.width <= 390 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: the hint fits and nothing overflows');
await p.screenshot({ path: shots + '/phone.png' });
await p.close(); await ctx.close();

ok(errs.length === 0, 'no page errors: ' + errs.join(' | ').slice(0, 300));
await b.close();
