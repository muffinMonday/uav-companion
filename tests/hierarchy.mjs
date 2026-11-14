// Saved places as a hierarchy: trips and days folded on load, counts, list-only folding, map selection reveals the row, selecting and filtering
// show everything, unlinked Side Quests, Unassigned and Home, keyboard and touch. Starts with the list folded, as a visitor sees it.
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
async function session({ viewport = { width: 1200, height: 800 }, touch = false, scheme = 'light' } = {}) {
  const ctx = await b.newContext({ viewport, listFolded: true, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume(); // fixtures are dated around 12 to 14 Nov 2026: completed trips are off the map from 15 Nov
  await ctx.addInitScript(([po, tr, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, seen, showOnStart: false, welcomed: true }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.52, lon: 114.32, zoom: 12 }, basemap: 'osm' }));
  }, [items, trips, LATEST_SEEN]);
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

// ================= folded on load
let { ctx, p } = await session();
const heads = await p.$$eval('#poi-list li.trip-head', (l) => l.map((x) => x.querySelector('.trip-head-name').textContent));
ok(heads.join('|') === 'Wuhan|Only a stay|By days|No trip|Home', 'the sections are the three trips, No trip and Home: ' + heads.join('|'));
ok((await p.$$eval('#poi-list .trip-head .sec-toggle', (b) => b.every((x) => x.getAttribute('aria-expanded') === 'false'))), 'every trip is folded on load');
ok(JSON.stringify(await rowsShown(p)) === JSON.stringify(['flat']), 'only the private Home marker is on show; every other row is folded away: ' + (await rowsShown(p)).join());
ok((await rowsAll(p)).length >= 9, 'folded rows stay in the page (hidden), so every record is still there to reach: ' + (await rowsAll(p)).length);
const counts = await p.$$eval('#poi-list li.trip-head .sec-count', (l) => l.map((x) => x.textContent));
ok(counts[0] === '6 places · 2 days · 1 outside the dates' && counts[1] === '2 places · 1 day' && counts[2] === '2 places · 2 days' && counts[3] === '1 place', 'headers count places, days and what is outside the dates, each marker once: ' + counts.join(' | '));
ok(!(await vis(p, day('t1', '2026-11-12'))), 'day headings are inside the folded trip');
const pinsBefore = await pins(p);
ok(pinsBefore >= 11, 'the map still shows every marker while the list is folded (' + pinsBefore + ' pins)');
await p.screenshot({ path: SP + '/hierarchy-folded.png' });

// ================= unfold a trip, then a day
await p.click(trip('Wuhan'));
ok(await vis(p, day('t1', '2026-11-12')) && await vis(p, day('t1', '2026-11-13')) && await vis(p, day('t1', '2026-11-20')) && await vis(p, day('t1', 'none')), 'opening a trip shows its days: two inside the dates, one outside, and No date set');
ok(JSON.stringify(await rowsShown(p)) === JSON.stringify(['flat']), 'but its days are still folded: no rows yet');
ok((await p.locator('#poi-list li.day-head:has-text("outside trip dates")').count()) === 1 && (await p.locator('#poi-list li.day-head:has-text("No date set")').count()) === 1, 'the day outside the trip dates says so, and the undated group is "No date set"');
await p.click(day('t1', '2026-11-12'));
ok((await noHome(p)).join() === 'stay,tower', 'opening a day shows its stops, in stop order: ' + (await noHome(p)).join());
await p.click(day('t1', '2026-11-13'));
ok((await noHome(p)).join() === 'stay,tower,lake', 'the Side Quest is folded under its stop, not a second row: ' + (await noHome(p)).join());
ok((await p.locator('#poi-list .side-chip').count()) >= 1, 'the Side Quest chip is on its main stop');
await p.screenshot({ path: SP + '/hierarchy-open.png' });
await p.click(day('t1', '2026-11-12'));
ok((await noHome(p)).join() === 'lake', 'folding a day hides only that day: ' + (await noHome(p)).join());
ok((await pins(p)) === pinsBefore && (await stored(p)).length === items.length, 'folding changes neither the map nor the saved markers');

// ================= stays across tabs, resets on reload
await tab(p, 'trips'); await tab(p, 'poi');
ok((await rowsShown(p)).includes('lake') && await p.getAttribute(trip('Wuhan'), 'aria-expanded') === 'true', 'what is open stays open after visiting another tab');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900); await tab(p, 'poi');
ok(JSON.stringify(await rowsShown(p)) === JSON.stringify(['flat']) && await p.getAttribute(trip('Wuhan'), 'aria-expanded') === 'false', 'after a reload everything is folded again');
ok(!/expan|fold|open/i.test(await p.evaluate(() => localStorage.getItem('uavzones.v1.prefs') ?? '')), 'nothing about folding is stored');

// ================= selecting on the map reveals the row
await clickPin(p, 'Lake');
ok(await p.locator('#poi-list li[data-id="lake"]').isVisible() && await p.getAttribute(trip('Wuhan'), 'aria-expanded') === 'true' && await p.getAttribute(day('t1', '2026-11-13'), 'aria-expanded') === 'true', 'selecting a pin opens its trip and its day');
ok(await p.getAttribute(day('t1', '2026-11-12'), 'aria-expanded') === 'false' && !(await p.locator('#poi-list li[data-id="tower"]').isVisible()), 'and only that day: its neighbours stay folded');
ok(await inView(p, '#poi-list li[data-id="lake"] .poi-item') && (await p.locator('#poi-list [data-stop-id="lake"].is-sel').count()) >= 1, 'its row is scrolled into view and marked as selected');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await clickPin(p, 'Snack');
ok(await p.locator('#poi-list li[data-id="snack"]').isVisible(), 'selecting a Side Quest shows it, under its main stop');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await clickPin(p, 'Loose Spot');
ok(await p.locator('#poi-list li[data-id="loose"]').isVisible() && await p.getAttribute(trip('No trip'), 'aria-expanded') === 'true', 'an unassigned marker opens No trip');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok((await stored(p)).length === items.length && JSON.stringify((await stored(p)).find((i) => i.id === 'lake')) === JSON.stringify(items.find((i) => i.id === 'lake')), 'none of that changed a saved marker');

// ================= selecting and filtering show everything, then give the folds back
await p.click(trip('Wuhan')); // fold Wuhan again so there is something to restore
const foldedBefore = await p.$$eval('#poi-list .sec-toggle', (b) => b.map((x) => x.dataset.section + (x.dataset.day ? '|' + x.dataset.day : '') + ':' + x.getAttribute('aria-expanded')).join());
await p.click('#poi-select'); await p.waitForTimeout(300);
const all = await rowsShown(p);
ok(all.length === items.length, 'Select markers shows every marker, so a selection can never hide behind a fold: ' + all.length + ' of ' + items.length);
ok(await p.$$eval('#poi-list .sec-toggle', (b) => b.every((x) => x.disabled)), 'the fold buttons are off while selecting');
await p.click('#poi-list li[data-id="d1"] .sel-box, #poi-list li[data-id="d1"] .poi-item');
await p.waitForTimeout(150);
await p.click('#sel-done'); await p.waitForTimeout(300);
ok((await p.$$eval('#poi-list .sec-toggle', (b) => b.map((x) => x.dataset.section + (x.dataset.day ? '|' + x.dataset.day : '') + ':' + x.getAttribute('aria-expanded')).join())) === foldedBefore, 'leaving Select mode puts the folds back as they were');
await p.selectOption('#poi-trip-filter', 't2');
ok((await noHome(p)).join() === 'd1,d3', 'the trip filter shows that trip open: ' + (await noHome(p)).join());
await p.selectOption('#poi-trip-filter', 'all');
ok(await p.getAttribute(trip('By days'), 'aria-expanded') === 'false', 'clearing the filter gives back the earlier folds');
const chip = p.locator('#poi-filter .chip', { hasText: 'Food & Drink' });
await chip.click();
ok((await rowsShown(p)).join() === 'snack', 'a type filter shows its matches even in folded trips: ' + (await rowsShown(p)).join());
await p.locator('#poi-filter .chip', { hasText: 'All' }).click();
ok(!(await p.locator('#poi-list li[data-id="snack"]').isVisible()), 'and clearing it folds them again');

// ================= unlinked Side Quests, Unassigned, Home
await p.click(trip('Only a stay')); await p.click(day('t3', '2026-12-01'));
const t3 = await p.$$eval('#poi-list li[data-scope="t3"], #poi-list li.unlinked-head[data-section="t3"]', (l) => l.filter((x) => !x.hidden).map((x) => x.className.includes('unlinked-head') ? 'HEAD' : x.dataset.id || x.className));
ok(t3.includes('HEAD') && t3.indexOf('HEAD') < t3.indexOf('lone') && t3.includes('base'), 'a Side Quest with no main stop is listed under "Unlinked Side Quests", after the base marker: ' + t3.join());
const lone = (await stored(p)).find((i) => i.id === 'lone');
ok(lone.isSub === true && lone.parentId === undefined && lone.date === '2026-12-01' && lone.type === 'nature', 'and its record is as it was');
ok(await p.getAttribute(trip('No trip'), 'aria-expanded') === 'true' && await p.locator('#poi-list li[data-id="loose"]').isVisible() && !(await p.locator('#poi-list li.trip-head:has-text("Home") .sec-toggle').count()), 'Unassigned holds its markers (opened by the pin earlier); Home has no fold button and is always shown');
await p.screenshot({ path: SP + '/hierarchy-sections.png' });

// ================= keyboard
await p.focus(trip('By days')); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
ok(await p.getAttribute(trip('By days'), 'aria-expanded') === 'true' && await p.evaluate(() => document.activeElement?.classList.contains('sec-toggle')), 'Enter on a trip button opens it and keeps the focus there');
await p.keyboard.press('Space'); await p.waitForTimeout(100);
ok(await p.getAttribute(trip('By days'), 'aria-expanded') === 'false', 'Space folds it');
ok(await p.$$eval('#poi-list .sec-toggle', (b) => b.every((x) => x.tagName === 'BUTTON' && x.hasAttribute('aria-expanded'))), 'every fold control is a real button with aria-expanded');

// ================= a redraw is held back while a row is being dragged
const first = await p.evaluate(() => { document.body.classList.add('reordering'); return document.querySelector('#poi-list li').dataset.token = 'kept'; });
await p.selectOption('#poi-trip-filter', 't2'); await p.waitForTimeout(200);
ok(await p.evaluate(() => document.querySelector('#poi-list li')?.dataset.token === 'kept'), 'while a drag is on, the list is not redrawn');
await p.evaluate(() => document.body.classList.remove('reordering'));
await p.selectOption('#poi-trip-filter', 'all'); await p.waitForTimeout(200);
ok(await p.evaluate(() => document.querySelector('#poi-list li')?.dataset.token === undefined), 'and it is redrawn once the drag is over');
await p.close(); await ctx.close();

// ================= small screens, touch and dark
for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['phone-landscape', { width: 844, height: 390 }, 'dark'], ['tablet', { width: 768, height: 1024 }, 'dark']]) {
  ({ ctx, p } = await session({ viewport: vp, touch: true, scheme }));
  ok(JSON.stringify(await rowsShown(p)) === JSON.stringify(['flat']), name + ': folded on load');
  const bx = await p.locator(trip('Wuhan')).boundingBox();
  ok(bx && bx.height >= 32, name + ': a trip fold button is a touch-sized target (' + Math.round(bx?.height) + ' px)');
  await p.tap(trip('Wuhan')); await p.waitForTimeout(150);
  await p.tap(day('t1', '2026-11-13')); await p.waitForTimeout(150);
  ok((await rowsShown(p)).includes('lake'), name + ': taps open a trip and a day');
  const over = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, lr: Math.max(...[...document.querySelectorAll('#poi-list li:not([hidden])')].map((x) => x.getBoundingClientRect().right)), pr: document.getElementById('panel').getBoundingClientRect().right }));
  ok(over.sw <= over.iw + 1 && over.lr <= over.pr + 1, name + ': nothing overflows sideways');
  await p.screenshot({ path: SP + '/hierarchy-' + name + '.png' });
  await p.close(); await ctx.close();
}

ok(errs.length === 0, 'no page errors: ' + errs.join(' | ').slice(0, 300));
await b.close();
