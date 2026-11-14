// Trip marker view: "Show this trip" shows one trip's pins, routes, Side Quest links and window on the map and nothing else, without touching the saved
// switches; it clears when the Trips tab is left, the trip is deleted or a global switch is used. Completed trips are off the global map unless
// "Show completed trips" is on, but a completed trip opened in Trips still shows. The page clock is pinned to 15 Nov 2026.
import { CHANNEL, chromium, LATEST_SEEN, moreTool } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.004, lon: 114.3 + n * 0.004, created: `2026-11-01T00:00:${String(10 + n).padStart(2, '0')}.000Z`, ...extra });
const items = [
  mk('a1', 'Alpha One', 1, { tripId: 'ta', date: '2026-11-14', order: 1 }),
  mk('a2', 'Alpha Two', 2, { tripId: 'ta', date: '2026-11-14', order: 2 }),
  mk('a3', 'Alpha Three', 3, { tripId: 'ta', date: '2026-11-15', order: 1 }),
  mk('aq', 'Alpha Quest', 4, { tripId: 'ta', date: '2026-11-14', isSub: true, parentId: 'a1', type: 'food' }),
  mk('b1', 'Beta One', 5, { tripId: 'tb', date: '2026-12-01', order: 1 }),
  mk('b2', 'Beta Two', 6, { tripId: 'tb', date: '2026-12-01', order: 2 }),
  mk('c1', 'Gamma One', 7, { tripId: 'tc', date: '2026-11-01', order: 1 }),
  mk('c2', 'Gamma Two', 8, { tripId: 'tc', date: '2026-11-02', order: 1 }),
  mk('loose', 'Loose Spot', 9),
  mk('flat', 'My Flat', 10, { type: 'residence' }),
];
const trips = { v: 1, trips: [
  { id: 'ta', name: 'Alpha active', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-14', endDate: '2026-11-16' },
  { id: 'tb', name: 'Beta upcoming', color: '#3949ab', description: '', created: '2026-11-01T00:00:01.000Z', startDate: '2026-12-01', endDate: '2026-12-02' },
  { id: 'tc', name: 'Gamma completed', color: '#00897b', description: '', created: '2026-11-01T00:00:02.000Z', startDate: '2026-11-01', endDate: '2026-11-03' },
  { id: 'td', name: 'Delta empty', color: '#fb8c00', description: '', created: '2026-11-01T00:00:03.000Z', startDate: '2026-12-10', endDate: '2026-12-11' },
] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, touch = false, prefs = {} } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.clock.install({ time: new Date('2026-11-15T10:00:00+08:00') }); await ctx.clock.resume();
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
  return { ctx, p };
}
const tab = async (p, name) => { await p.evaluate((n) => { if (document.getElementById('panel').hidden) document.querySelector(`#dock button[data-tab=${n}]`).click(); else document.getElementById('tab-' + n).click(); }, name); await p.waitForTimeout(300); };
const pinTitles = (p) => p.$$eval('.poi-pin', (l) => l.map((x) => x.getAttribute('title')).sort());
const prefsRaw = (p) => p.evaluate(() => localStorage.getItem('uavzones.v1.prefs'));
const switches = async (p) => { const o = JSON.parse(await prefsRaw(p)); return JSON.stringify([o.hideTrips, o.tripHidden, o.unassignedHidden, o.showCompleted]); };
const recsRaw = (p) => p.evaluate(() => localStorage.getItem('uavzones.v1.pois') + localStorage.getItem('uavzones.v1.trips'));
const paths = (p) => p.locator('.leaflet-overlay-pane path').count();
const toastText = (p) => p.evaluate(() => (document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent));
const card = (p, name) => p.locator('#trips-list .trip-card, #trips-past-list .trip-card', { hasText: name });
const viewBtn = (p, name) => card(p, name).locator('button.btn', { hasText: /(Show|Showing) this trip/ });
const openPast = (p) => p.evaluate(() => { document.getElementById('trips-past').open = true; });
const clickPin = async (p, name) => { await p.locator(`.poi-pin[title="${name}"]`).dispatchEvent('click'); await p.waitForTimeout(500); };
const ALPHA = ['Alpha One', 'Alpha Quest', 'Alpha Three', 'Alpha Two'].sort();

let { ctx, p } = await session({ prefs: { showSide: true } });
// ---------- the default: completed trips are off the global map
let t = await pinTitles(p);
ok(!t.some((x) => x.startsWith('Gamma')) && t.includes('Alpha One') && t.includes('Beta One') && t.includes('Loose Spot') && t.includes('My Flat'), 'by default the completed trip is off the map; active, upcoming, unassigned and Home are drawn: ' + t.join());
await tab(p, 'poi');
await p.evaluate(() => { document.getElementById('poi-add').open = true; }); await p.waitForTimeout(200);
ok(!(await p.isChecked('#poi-showcompleted')), 'the Show completed trips switch is off by default');
const note = await p.locator('#poi-list li.trip-head:has-text("Gamma completed") .vis-note').textContent().catch(() => '');
ok(/Completed trip/.test(note), 'the completed trip heading says why it is not drawn: ' + note);
await p.locator('label.switch:has(#poi-showcompleted)').click(); await p.waitForTimeout(300);
ok((await pinTitles(p)).includes('Gamma One') && (await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).showCompleted)) === true, 'turning it on draws the completed trip and remembers the choice');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
ok((await pinTitles(p)).includes('Gamma One'), 'after a reload it is still on');
await tab(p, 'poi'); await p.evaluate(() => { document.getElementById('poi-add').open = true; }); await p.locator('label.switch:has(#poi-showcompleted)').click(); await p.waitForTimeout(300);
ok(!(await pinTitles(p)).includes('Gamma One') && (await prefsRaw(p)).indexOf('showCompleted') < 0, 'turning it off hides it again and clears the key');

// ---------- show one trip
await tab(p, 'trips');
const swBefore = await switches(p), recs = await recsRaw(p);
ok(await viewBtn(p, 'Alpha active').getAttribute('aria-pressed') === 'false' && (await viewBtn(p, 'Alpha active').textContent()) === 'Show this trip', 'the card button reads Show this trip, not pressed');
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(400);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify([...ALPHA, 'My Flat'].sort()), 'Show this trip draws only that trip (and Home): ' + (await pinTitles(p)).join());
ok(await viewBtn(p, 'Alpha active').getAttribute('aria-pressed') === 'true' && (await viewBtn(p, 'Alpha active').textContent()) === 'Showing this trip' && await viewBtn(p, 'Beta upcoming').getAttribute('aria-pressed') === 'false', 'the button shows Showing this trip, pressed; the others are not');
ok(/Showing only "Alpha active"/.test(await toastText(p)) && (await p.locator('#toast button').textContent()) === 'Show all', 'a toast says so and offers Show all: ' + await toastText(p));
ok((await switches(p)) === swBefore && (await recsRaw(p)) === recs, 'the saved switches and the records are untouched');
ok(await p.getAttribute('.leaflet-bar a[data-tool="trips"]', 'aria-pressed') === 'true', 'the map trips button is not shown as off');
// a window and its lines
await clickPin(p, 'Alpha One');
const drawn = await paths(p);
ok(drawn > 0 && (await p.locator('.leaflet-popup').count()) === 1, 'an open stop shows its route and links (' + drawn + ')');
await viewBtn(p, 'Beta upcoming').click(); await p.waitForTimeout(500);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['Beta One', 'Beta Two', 'My Flat']) && (await p.locator('.leaflet-popup').count()) === 0 && (await paths(p)) === 0, 'switching to another trip swaps the pins and closes the other trip\'s window and lines');
ok(await viewBtn(p, 'Alpha active').getAttribute('aria-pressed') === 'false' && await viewBtn(p, 'Beta upcoming').getAttribute('aria-pressed') === 'true', 'only the new trip is pressed');
await card(p, 'Beta upcoming').locator('button.btn', { hasText: 'Fit map' }).click(); await p.waitForTimeout(700);
ok(!/Nothing to show/.test(await toastText(p)), 'Fit map still fits the viewed trip');
// a completed trip opened on purpose
await openPast(p);
await viewBtn(p, 'Gamma completed').click(); await p.waitForTimeout(400);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['Gamma One', 'Gamma Two', 'My Flat']), 'a completed trip shown on its own is drawn');
// leaving the tab restores
await tab(p, 'poi');
ok((await pinTitles(p)).includes('Alpha One') && (await pinTitles(p)).includes('Beta One') && !(await pinTitles(p)).some((x) => x.startsWith('Gamma')), 'opening Points of Interest restores the global map (completed trips off again)');
ok((await switches(p)) === swBefore, 'no visibility switch was saved or changed along the way');
await tab(p, 'trips'); await openPast(p);
ok(await viewBtn(p, 'Gamma completed').getAttribute('aria-pressed') === 'false', 'the buttons are not pressed after coming back');

// ---------- clearing
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(300);
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(300);
ok((await pinTitles(p)).includes('Beta One') && (await pinTitles(p)).includes('Alpha One'), 'pressing the pressed button shows every trip again');
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(300);
await p.locator('#toast button', { hasText: 'Show all' }).click(); await p.waitForTimeout(300);
ok((await pinTitles(p)).includes('Beta One') && await viewBtn(p, 'Alpha active').getAttribute('aria-pressed') === 'false', 'the toast Show all clears it and the button follows');
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(300);
await moreTool(p, 'trips'); await p.waitForTimeout(300);
ok((await pinTitles(p)).includes('Beta One') && await p.getAttribute('.leaflet-bar a[data-tool="trips"]', 'aria-pressed') === 'true' && await viewBtn(p, 'Alpha active').getAttribute('aria-pressed') === 'false', 'the map trips button clears the view (and does not switch trip markers off)');
await viewBtn(p, 'Alpha active').click(); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('tab-poi').click()); await p.waitForTimeout(200);
await tab(p, 'poi'); await p.click('#poi-list .vis-toggle[data-vis-scope="tb"]'); await p.waitForTimeout(300);
ok(!(await pinTitles(p)).includes('Beta One') && (await pinTitles(p)).includes('Alpha One'), 'a global switch (hide Beta) works on the normal rules');
await p.click('#poi-list .vis-toggle[data-vis-scope="tb"]'); await p.waitForTimeout(300);

// ---------- an empty trip, a deleted trip, a trip hidden by hand or by the global button
await tab(p, 'trips');
await viewBtn(p, 'Delta empty').click(); await p.waitForTimeout(400);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['My Flat']) && /no markers yet/.test(await toastText(p)), 'a trip with no markers shows an empty map and says so');
const del = card(p, 'Delta empty').locator('button.btn.danger');
await del.click(); await del.click(); await p.waitForTimeout(500);
ok((await pinTitles(p)).includes('Alpha One') && (await pinTitles(p)).includes('Beta One'), 'deleting the viewed trip restores the global map');
await ctx.close();

({ ctx, p } = await session({ prefs: { hideTrips: true, tripHidden: ['tb'] } }));
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['Loose Spot', 'My Flat']), 'with the global trips switch off only unassigned and Home are drawn');
await tab(p, 'trips');
const pre = await switches(p);
await viewBtn(p, 'Beta upcoming').click(); await p.waitForTimeout(400);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['Beta One', 'Beta Two', 'My Flat']) && (await switches(p)) === pre, 'a viewed trip is drawn even when hidden by hand and by the global switch, without saving anything: ' + (await pinTitles(p)).join() + ' / ' + await switches(p) + ' vs ' + pre);
ok(await p.getAttribute('.leaflet-bar a[data-tool="trips"]', 'aria-pressed') === 'true', 'the map trips button reports the view');
await tab(p, 'poi');
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify(['Loose Spot', 'My Flat']) && await p.getAttribute('.leaflet-bar a[data-tool="trips"]', 'aria-pressed') === 'false', 'leaving the tab brings the saved switches back');
await ctx.close();

// ---------- name tag, accessible names, duplicate labels
({ ctx, p } = await session({ prefs: { markerDetails: false, showSide: true } }));
await tab(p, 'poi');
const names = await p.$$eval('.poi-pin', (l) => l.map((x) => [x.getAttribute('title'), x.getAttribute('aria-label')]));
ok(names.length > 0 && names.every(([t, a]) => a === t || a.startsWith(t + ', ')) && names.some(([, a]) => a === 'Alpha One, Alpha active') && names.some(([, a]) => a === 'Loose Spot') && names.some(([, a]) => a === 'My Flat'), 'every pin has an aria-label: name, then trip (none for unassigned and Home); the tooltip stays the name');
const seqs = await p.$$eval('.poi-pin', (l) => l.map((x) => x.querySelector('.seq')?.textContent).filter(Boolean));
ok(new Set(seqs).size < seqs.length, 'the fixture has duplicate compact labels (' + seqs.join(' ') + '), which the names tell apart');
await clickPin(p, 'Alpha One');
const tag = async () => p.evaluate(() => { const t = document.querySelector('.name-tag'), s = document.querySelector('.poi-pin.focused .seq'); if (!t) return null; const a = t.getBoundingClientRect(), b = s?.getBoundingClientRect(); return { text: t.textContent, trip: t.querySelector('.name-tag-trip')?.textContent ?? '', bottom: a.bottom, top: a.top, seqTop: b?.top ?? null, w: a.width, vw: innerWidth }; });
let g = await tag();
ok(g && g.trip === 'Alpha active' && /Alpha One/.test(g.text), 'the name tag shows the marker name and, under it, the trip name: ' + g?.text);
ok(g.seqTop !== null && g.bottom <= g.seqTop + 0.5, 'the two-line tag stays above the stop badge (tag bottom ' + g.bottom.toFixed(1) + ', badge top ' + g.seqTop?.toFixed(1) + ')');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await clickPin(p, 'Loose Spot');
g = await p.evaluate(() => ({ trip: document.querySelector('.name-tag-trip'), n: document.querySelectorAll('.name-tag').length }));
ok(g.n === 1 && g.trip === null, 'a marker with no trip has no trip line');
// a rename of the trip reaches the pin label
await p.keyboard.press('Escape');
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.trips')); o.trips[0].name = 'Alpha renamed'; localStorage.setItem('uavzones.v1.trips', JSON.stringify(o)); window.dispatchEvent(new StorageEvent('storage', { key: 'uavzones.v1.trips' })); });
await p.waitForTimeout(500);
ok((await p.$$eval('.poi-pin', (l) => l.map((x) => x.getAttribute('aria-label')))).includes('Alpha One, Alpha renamed'), 'renaming a trip updates the pin labels');
await ctx.close();
// long and CJK trip names stay inside the screen
({ ctx, p } = await session({ viewport: { width: 360, height: 700 }, touch: true, prefs: { markerDetails: false } }));
await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('uavzones.v1.trips')); o.trips[0].name = '这是一个非常非常长的旅行名称'.repeat(4) + ' A very long trip name indeed '.repeat(4); localStorage.setItem('uavzones.v1.trips', JSON.stringify(o)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
await p.locator('.poi-pin', { hasText: 'D1' }).first().dispatchEvent('click'); await p.waitForTimeout(500);
g = await tag();
ok(g && g.w <= g.vw - 16 && g.w <= 262, 'a very long CJK and Latin trip name is clamped (tag ' + g?.w.toFixed(0) + ' of ' + g?.vw + ' px)');
await ctx.close();

// ---------- phone: the sheet closes on Fit map, the view stays, a toast offers Show all
({ ctx, p } = await session({ viewport: { width: 390, height: 844 }, touch: true }));
await tab(p, 'trips');
await viewBtn(p, 'Alpha active').tap(); await p.waitForTimeout(400);
ok(JSON.stringify(await pinTitles(p)) === JSON.stringify([...ALPHA, 'My Flat'].sort()), 'phone: Show this trip isolates the trip');
await card(p, 'Alpha active').locator('button.btn', { hasText: 'Fit map' }).tap(); await p.waitForTimeout(700);
ok((await p.evaluate(() => document.getElementById('panel').hidden)) && JSON.stringify(await pinTitles(p)) === JSON.stringify([...ALPHA, 'My Flat'].sort()), 'phone: Fit map closes the sheet and the view stays');
await ctx.close();

await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
