// Remembered map visibility per trip and for Unassigned: pins, routes and links go with a hidden trip, the global switches keep their meaning,
// creating or opening a hidden marker explains itself, and nothing is written to a record. Starts folded, as a visitor sees it.
import { OUT as SP, CHANNEL, chromium, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.004, lon: 114.3 + n * 0.004, created: `2026-11-01T00:00:${String(10 + n).padStart(2, '0')}.000Z`, ...extra });
const items = [
  mk('stay', 'Lake Stay', 1, { type: 'hotel', tripId: 't1', date: '2026-11-12', endDate: '2026-11-14', order: 1 }),
  mk('tower', 'Tower', 2, { tripId: 't1', date: '2026-11-12', order: 2 }),
  mk('lake', 'Lake', 3, { tripId: 't1', date: '2026-11-13', order: 1 }),
  mk('snack', 'Snack', 4, { tripId: 't1', date: '2026-11-13', isSub: true, parentId: 'lake', type: 'food' }),
  mk('later', 'Late Visit', 5, { tripId: 't1', date: '2026-11-20', order: 1 }),
  mk('nodate', 'Someday', 6, { tripId: 't1' }),
  mk('d1', 'Day One', 7, { tripId: 't2', day: 1 }),
  mk('d3', 'Day Three', 8, { tripId: 't2', day: 3 }),
  mk('base', 'Base Hotel', 9, { type: 'hotel', tripId: 't3', date: '2026-12-01' }),
  mk('lone', 'Lone Quest', 10, { tripId: 't3', date: '2026-12-01', isSub: true, type: 'nature' }),
  mk('loose', 'Loose Spot', 11),
  mk('flat', 'My Flat', 12, { type: 'residence' }),
];
const trips = { v: 1, trips: [
  { id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' },
  { id: 't2', name: 'By days', color: '#3949ab', description: '', created: '2026-11-01T00:00:01.000Z' },
  { id: 't3', name: 'Only a stay', color: '#00897b', description: '', created: '2026-11-01T00:00:02.000Z', startDate: '2026-12-01', endDate: '2026-12-02' },
] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, touch = false, scheme = 'light', prefs = {} } = {}) {
  const ctx = await b.newContext({ viewport, listFolded: true, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  await ctx.addInitScript(([po, tr, seen, pr]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, seen, showOnStart: false, welcomed: true }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.52, lon: 114.32, zoom: 12 }, basemap: 'osm', ...pr }));
  }, [items, trips, LATEST_SEEN, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await tab(p, 'poi');
  return { ctx, p };
}
const tab = async (p, name) => { await p.evaluate((n) => { if (document.getElementById('panel').hidden) document.querySelector(`#dock button[data-tab=${n}]`).click(); else document.getElementById('tab-' + n).click(); }, name); await p.waitForTimeout(300); };
const rowsShown = (p) => p.$$eval('#poi-list li[data-id]:not([hidden])', (l) => l.map((x) => x.dataset.id));
const noHome = async (p) => (await rowsShown(p)).filter((id) => id !== 'flat');
const rowsAll = (p) => p.$$eval('#poi-list li[data-id]', (l) => l.map((x) => x.dataset.id));
const vis = (p, sel) => p.locator(sel).first().isVisible();
const trip = (name) => `#poi-list li.trip-head:has-text("${name}") .sec-toggle`;
const day = (scope, key) => `#poi-list .sec-toggle[data-section="${scope}"][data-day="${key}"]`;
const pins = (p) => p.locator('.poi-pin').count();
const clickPin = async (p, name) => { await p.locator(`.poi-pin[title="${name}"]`).dispatchEvent('click'); await p.waitForTimeout(500); };
const inView = (p, q) => p.$eval(q, (n) => { let s = n.parentElement; while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement; if (!s) return true; const r = n.getBoundingClientRect(), c = s.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; });
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const hiddenPref = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') ?? '{}'));
const visBtn = (scope) => `#poi-list .vis-toggle[data-vis-scope="${scope}"]`;
const pinTitles = (p) => p.$$eval('.poi-pin', (l) => l.map((x) => x.getAttribute('title')).sort());
const toastText = (p) => p.evaluate(() => (document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent));
const paths = (p) => p.locator('.leaflet-overlay-pane path').count();
const tripsBtn = '.leaflet-bar a[data-tool="trips"]';
const T1 = ['Lake', 'Lake Stay', 'Late Visit', 'Snack', 'Someday', 'Tower'];

let { ctx, p } = await session({ prefs: { showSide: true } });
const all = await pinTitles(p);
ok(all.length === 12 && !(await hiddenPref(p)).tripHidden, 'by default every marker is on the map and nothing is hidden: ' + all.length);
ok(await p.getAttribute(visBtn('t1'), 'aria-pressed') === 'true' && (await p.textContent(visBtn('t1'))) === 'On map' && await p.getAttribute(visBtn('none'), 'aria-pressed') === 'true', 'each trip and Unassigned has an On map button, pressed');
ok(!(await p.locator('#poi-list li.trip-head:has-text("Home") .vis-toggle').count()), 'Home has none');
const recs = JSON.stringify(await stored(p));

// hide a trip
await p.click(visBtn('t1')); await p.waitForTimeout(300);
const afterHide = await pinTitles(p);
ok(T1.every((n) => !afterHide.includes(n)) && afterHide.length === 6 && afterHide.includes('My Flat') && afterHide.includes('Loose Spot') && afterHide.includes('Day One'), 'hiding Wuhan takes exactly its markers off the map: ' + afterHide.join());
ok(await p.getAttribute(visBtn('t1'), 'aria-pressed') === 'false' && (await p.textContent(visBtn('t1'))) === 'Off map', 'the button says Off map');
ok(JSON.stringify((await hiddenPref(p)).tripHidden) === '["t1"]', 'the choice is saved on this device');
ok(JSON.stringify(await stored(p)) === recs && !(await p.evaluate(() => localStorage.getItem('uavzones.v1.trips'))).includes('hidden'), 'no marker or trip record changed');
ok((await p.locator('#poi-list li[data-id="tower"]').count()) === 1, 'the places are still in the list');
ok(await p.isChecked('#poi-show') && await p.getAttribute(tripsBtn, 'aria-pressed') === 'true', 'the POI switch and the map trip button are as they were');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
ok((await pinTitles(p)).length === 6, 'after a reload the trip is still hidden');
await tab(p, 'poi');
await p.click(visBtn('t1')); await p.waitForTimeout(300);
ok((await pinTitles(p)).length === 12 && !(await hiddenPref(p)).tripHidden, 'showing it again puts them back and clears the setting');

// Unassigned; Home is exempt
await p.click(visBtn('none')); await p.waitForTimeout(300);
const noLoose = await pinTitles(p);
ok(!noLoose.includes('Loose Spot') && noLoose.includes('My Flat') && noLoose.length === 11, 'hiding Unassigned takes off the markers with no trip, never the Home marker');
await p.click(visBtn('none')); await p.waitForTimeout(200);

// routes, Side Quest links and distance lines go with a hidden trip
await clickPin(p, 'Lake');
await p.waitForSelector('.leaflet-popup h3', { timeout: 6000 });
const drawn = await paths(p);
ok(drawn > 0, 'with a marker open there are route and link lines on the map (' + drawn + ')');
await p.click(visBtn('t1')); await p.waitForTimeout(400);
ok((await paths(p)) === 0 && (await p.locator('.leaflet-popup').count()) === 0, 'hiding its trip removes every line and closes its window');
await p.click(visBtn('t1')); await p.waitForTimeout(300);

// the global switches keep their meaning
await p.click(visBtn('t2')); await p.waitForTimeout(200); // t2 hidden by hand
await p.evaluate(() => document.querySelector('.leaflet-bar a[data-tool="trips"]')?.click()); await p.waitForTimeout(300);
ok(await p.getAttribute(tripsBtn, 'aria-pressed') === 'false' && (await pinTitles(p)).length === 2, 'the map button hides all trip markers: only Loose Spot and My Flat remain');
await p.click(visBtn('t2')); await p.waitForTimeout(300);
ok(await p.getAttribute(tripsBtn, 'aria-pressed') === 'false' && (await pinTitles(p)).length === 2, 'showing a trip while that button is off does not switch it back on: its markers stay off');
ok(/trip markers button/i.test(await p.textContent('#poi-list li.trip-head:has-text("Wuhan")')) && await p.getAttribute(visBtn('t2'), 'aria-pressed') === 'true', 'the list says a trip is on but held back by the map button');
await p.evaluate(() => document.querySelector('.leaflet-bar a[data-tool="trips"]')?.click()); await p.waitForTimeout(300);
ok((await pinTitles(p)).length === 12, 'switching the button on shows what the trips allow');
await p.evaluate(() => { const e = document.getElementById('poi-show'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);
ok(/switched off on the map/i.test(await p.textContent('#poi-list li.trip-head:has-text("Wuhan")')), 'with the POI layer off the list says so on each trip');
await p.click(visBtn('t2')); await p.waitForTimeout(200);
ok(!(await p.isChecked('#poi-show')) && (await pinTitles(p)).length === 0, 'toggling a trip does not switch the POI layer on');
await p.click(visBtn('t2'));
await p.evaluate(() => { const e = document.getElementById('poi-show'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);

// creating into a hidden trip
await p.click(visBtn('t1')); await p.waitForTimeout(200); // Wuhan hidden
await p.selectOption('#poi-trip', 't1');
await p.evaluate(() => { document.getElementById('poi-add').open = true; });
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
const msg = await toastText(p);
ok(/not on the map/.test(msg) && /Wuhan/.test(msg) && (await p.locator('#toast .toast-action').textContent()) === 'Show on map', 'a marker made in a hidden trip is saved and the message says it is not on the map, with a Show on map button: ' + msg);
ok((await pinTitles(p)).length === 6, 'the new pin is not drawn, and the rest of the hidden trip stays hidden (' + (await pinTitles(p)).length + ' pins)');
ok(JSON.stringify((await hiddenPref(p)).tripHidden) === '["t1"]', 'making it did not change the setting');
await p.click('#toast .toast-action'); await p.waitForTimeout(400);
ok(!(await hiddenPref(p)).tripHidden && (await pinTitles(p)).length === 13, 'the button shows that trip and nothing else changed');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());

// a result that is hidden on the map: explained, not silently revealed
await p.click(visBtn('t1')); await p.waitForTimeout(200);
await p.fill('#poi-search', 'tower'); await p.waitForTimeout(300);
await p.click('#poi-list li[data-id="tower"] .poi-item'); await p.waitForTimeout(500);
ok(/"Tower" is not on the map/.test(await toastText(p)) && (await p.locator('.leaflet-popup').count()) === 0, 'tapping a result that is hidden on the map explains why instead of opening a window');
ok(JSON.stringify((await hiddenPref(p)).tripHidden) === '["t1"]', 'and the setting is untouched');
await p.click('#toast .toast-action'); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 });
ok((await p.textContent('.leaflet-popup h3')).includes('Tower') && !(await hiddenPref(p)).tripHidden, 'Show on map shows the trip and opens the marker');
await p.fill('#poi-search', '');
await p.screenshot({ path: SP + '/visibility-desktop.png' });
await p.close(); await ctx.close();

// damaged storage
({ ctx, p } = await session({ prefs: { tripHidden: 5, unassignedHidden: 'x' } }));
ok((await pinTitles(p)).length === 12, 'damaged settings: everything is shown and the page works');
await p.close(); await ctx.close();
({ ctx, p } = await session({ prefs: { tripHidden: ['gone-trip', 't2'] } }));
ok((await pinTitles(p)).length === 10, 'an id for a trip that no longer exists is harmless; the others apply');
await p.close(); await ctx.close();

// phone
({ ctx, p } = await session({ viewport: { width: 390, height: 844 }, touch: true }));
const vb = await p.locator(visBtn('t1')).boundingBox();
ok(vb && vb.height >= 32, 'phone: the On map button is a touch target (' + Math.round(vb?.height) + ' px)');
await p.tap(visBtn('t1')); await p.waitForTimeout(300);
ok((await pinTitles(p)).length === 6 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: a tap hides the trip and nothing overflows');
await p.screenshot({ path: SP + '/visibility-phone.png' });
await p.close(); await ctx.close();
ok(errs.length === 0, 'no page errors: ' + errs.join(' | ').slice(0, 300));
await b.close();
