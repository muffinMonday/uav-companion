// Saved-places search: finds every marker whatever is folded or hidden on the map, shows trip and day context, works with the filters,
// never changes a record or a fold, and the folds come back when it is cleared.
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
const typeIn = async (p, text) => { await p.fill('#poi-search', text); await p.waitForTimeout(250); };
const snap = (p) => p.$$eval('#poi-list .sec-toggle', (b) => b.map((x) => x.dataset.section + (x.dataset.day ? '|' + x.dataset.day : '') + ':' + x.getAttribute('aria-expanded')).join());

let { ctx, p } = await session();
const before = JSON.stringify(await stored(p));
ok(await p.isVisible('#poi-search') && await p.getAttribute('#poi-search', 'aria-label') === 'Search saved places' && !(await p.isVisible('#poi-filters-clear')), 'the search box is there, named, with no clear button yet');
const folds0 = await snap(p);
await typeIn(p, 'crane');
ok((await p.locator('#poi-list li[data-id]:not([hidden])').count()) === 0, 'no match for a word that is nowhere: nothing listed');
ok(/No saved place matches/.test(await p.textContent('#poi-list')) && /0 of 12/.test(await p.textContent('#poi-search-count')), 'it says so, and counts');
await typeIn(p, 'tower');
ok((await rowsShown(p)).join() === 'tower', 'a name inside a folded trip and folded day is found: ' + (await rowsShown(p)).join());
ok(/1 of 12 saved places shown for this search/.test(await p.textContent('#poi-search-count')), 'the count says 1 of 12');
const ctxLine = await p.$$eval('#poi-list li:not([hidden])', (l) => l.map((x) => x.classList.contains('trip-head') ? 'T:' + x.querySelector('.trip-head-name').textContent : x.classList.contains('day-head') ? 'D:' + x.textContent : x.dataset.id).join('|'));
ok(/T:Wuhan\|D:Thu, Nov 12.*\|tower/.test(ctxLine), 'the match sits under its trip and day, which gives the context: ' + ctxLine);
await typeIn(p, 'only a stay');
ok((await rowsShown(p)).sort().join() === 'base,lone', 'a trip name finds that trip\'s markers: ' + (await rowsShown(p)).join());
await typeIn(p, 'FOOD drink');
ok((await rowsShown(p)).join() === 'snack', 'the type label finds a Side Quest: ' + (await rowsShown(p)).join());
await typeIn(p, 'my flat');
ok((await rowsShown(p)).join() === 'flat', 'Home is found locally');
await typeIn(p, 'someday');
ok((await rowsShown(p)).join() === 'nodate', 'an undated marker is found');
// hidden on the map does not matter
await p.evaluate(() => { const e = document.getElementById('poi-show'); e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); });
await typeIn(p, 'tower');
ok((await rowsShown(p)).join() === 'tower', 'a marker is found even with every marker switched off on the map');
await p.evaluate(() => { const e = document.getElementById('poi-show'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
// no dragging in a result
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 0, 'a search result cannot be dragged');
// coexists with filters
await typeIn(p, 'e');
const wide = await rowsShown(p);
await p.locator('#poi-filter .chip', { hasText: 'Accommodation' }).click();
const narrow = await rowsShown(p);
ok(narrow.length < wide.length && narrow.every((id) => items.find((i) => i.id === id).type === 'hotel'), 'search and the type filter together narrow the list: ' + wide.length + ' to ' + narrow.length);
ok(await p.isVisible('#poi-filters-clear'), 'Clear filters is offered');
await p.click('#poi-filters-clear'); await p.waitForTimeout(250);
ok(await p.inputValue('#poi-search') === '' && !(await p.isVisible('#poi-filters-clear')) && await p.inputValue('#poi-trip-filter') === 'all' && await p.locator('#poi-filter .chip[aria-pressed=true]').first().textContent() === 'All', 'one button clears the search and both filters');
ok((await snap(p)) === folds0 && JSON.stringify(await rowsShown(p)) === JSON.stringify(['flat']), 'clearing gives back the folds exactly as they were: everything folded again');
// folds made before a search come back
await p.click(trip('Wuhan')); await p.click(day('t1', '2026-11-13'));
const open1 = await snap(p), rows1 = (await rowsShown(p)).join();
await typeIn(p, 'someday');
await typeIn(p, '');
ok((await snap(p)) === open1 && (await rowsShown(p)).join() === rows1, 'folds opened before a search are as they were after it');
// Escape clears
await typeIn(p, 'lake'); await p.focus('#poi-search'); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok(await p.inputValue('#poi-search') === '', 'Escape in the box clears it');
// the current trip for new markers is not touched
await p.selectOption('#poi-trip', 't2');
await typeIn(p, 'only a stay'); await p.waitForTimeout(100);
ok(await p.inputValue('#poi-trip') === 't2', 'searching does not change the trip chosen for new markers');
await typeIn(p, '');
ok(JSON.stringify(await stored(p)) === before, 'no saved marker was changed by any of it');
ok(!/only a stay|crane|tower/i.test(await p.evaluate(() => localStorage.getItem('uavzones.v1.prefs') ?? '')), 'the query is not stored');
// result click opens the marker
await typeIn(p, 'tower'); await p.click('#poi-list li[data-id="tower"] .poi-item'); await p.waitForSelector('.leaflet-popup h3', { timeout: 8000 });
ok((await p.textContent('.leaflet-popup h3')).includes('Tower'), 'a result opens its marker');
await p.screenshot({ path: SP + '/poisearch-desktop.png' });
await p.close(); await ctx.close();

for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['phone-landscape', { width: 844, height: 390 }, 'dark']]) {
  ({ ctx, p } = await session({ viewport: vp, touch: true, scheme }));
  await p.tap('#poi-search'); await p.keyboard.type('lake'); await p.waitForTimeout(300);
  ok((await rowsShown(p)).includes('lake') && (await rowsShown(p)).includes('stay'), name + ': typing finds markers in folded trips (' + (await rowsShown(p)).join() + ')');
  const bx = await p.locator('#poi-search').boundingBox();
  const over = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  ok(bx.height >= 36 && over, name + ': the box is a touch target and nothing overflows (' + Math.round(bx.height) + ' px)');
  await p.screenshot({ path: SP + '/poisearch-' + name + '.png' });
  await p.close(); await ctx.close();
}
ok(errs.length === 0, 'no page errors: ' + errs.join(' | ').slice(0, 300));
await b.close();
