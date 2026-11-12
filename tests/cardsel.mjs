// A selected marker highlights its card in the open panel (Points of Interest list or a trip's day), a click on a marker scrolls that panel to the card,
// and a Side Quest's selection keeps its parent card highlighted. Run with reduced motion, so the scrolling is instant.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });

const D1 = '2027-03-10', D2 = '2027-03-11', D3 = '2027-03-12';
const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.01, lon: 114.2 + n * 0.01, created: `2026-11-01T00:00:${String(n).padStart(2, '0')}.000Z`, tripId: 't1', ...extra });
const items = [mk('H', 'Hotel', 1, { type: 'hotel', date: D1, endDate: D3 })];
[[D1, 'A'], [D2, 'B'], [D3, 'C']].forEach(([date, k], d) => { for (let i = 1; i <= 5; i++) items.push(mk(k + i, `${k}${i}`, 2 + d * 5 + i, { date, order: i })); });
items.push(mk('S1', 'Snack bar', 14.5, { type: 'other', date: D2, isSub: true, parentId: 'B3' }), mk('S2', 'Old gate', 15.5, { type: 'other', date: D2, isSub: true, parentId: 'B3' }));
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: D1, endDate: D3 }] };

async function session(prefs = {}) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([po, tr, seen, pr]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po }));
    localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, seen, showOnStart: false, welcomed: true }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.62, lon: 114.3, zoom: 11 }, basemap: 'osm', currentTrip: 't1', ...pr }));
  }, [items, trips, LATEST_SEEN, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const tab = async (p, name) => { await p.evaluate((n) => { if (document.getElementById('panel').hidden) document.querySelector(`#dock button[data-tab=${n}]`).click(); else document.getElementById('tab-' + n).click(); }, name); await p.waitForTimeout(300); };
const pin = (p, name) => p.locator(`.poi-pin[title="${name}"]`);
const clickPin = async (p, name) => { await pin(p, name).dispatchEvent('click'); await p.waitForTimeout(350); }; // the panel may cover the pin, so the click is sent to it directly
const sel = (p, scope) => p.$$eval(`${scope} [data-stop-id].is-sel`, (l) => l.map((x) => x.dataset.stopId).sort());
const inView = (p, q) => p.$eval(q, (n) => {
  let s = n.parentElement;
  while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement;
  const r = n.getBoundingClientRect(), v = s ? s.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  return r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
}).catch(() => false);
const same = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);

// ================= the Points of Interest list, details on (a click opens the window)
{
  const { ctx, p } = await session();
  await tab(p, 'poi');
  const c5 = '#poi-list li[data-id="C5"] .poi-item';
  ok(!(await inView(p, c5)), 'to start with, the card of the last stop (C5) is out of view in the list');
  await clickPin(p, 'C5');
  ok(await inView(p, c5), 'clicking its marker scrolls the list to its card');
  ok(same(await sel(p, '#poi-list'), ['C5']), 'and the card is highlighted, alone: ' + JSON.stringify(await sel(p, '#poi-list')));
  ok((await p.getAttribute(c5, 'aria-current')) === 'true', 'it is marked as the current item for screen readers');
  await clickPin(p, 'A2');
  ok(await inView(p, '#poi-list li[data-id="A2"] .poi-item') && same(await sel(p, '#poi-list'), ['A2']), 'another marker moves the highlight and the scroll to its card');
  await p.evaluate(() => document.querySelector('.poi-pop .pop-close')?.click()); await p.waitForTimeout(300);
  ok((await sel(p, '#poi-list')).length === 0, 'closing the window clears the highlight');

  // a tap on a card marks it at once, before the map has finished moving
  await p.locator('#poi-list li[data-id="B2"] .poi-item').click();
  ok(same(await sel(p, '#poi-list'), ['B2']), 'tapping a card highlights it straight away');
  await p.waitForTimeout(1200);
  ok(same(await sel(p, '#poi-list'), ['B2']), 'and it stays highlighted once its window has opened');

  // Side Quests: the parent card stays highlighted with them
  await clickPin(p, 'B3');
  ok(same(await sel(p, '#poi-list'), ['B3']), 'a main stop selected: only its card is highlighted');
  await clickPin(p, 'Snack bar');
  ok(await p.locator('#poi-list li.side-row[data-id="S1"]').count() === 1, 'clicking a Side Quest marker unfolds its parent in the list');
  ok(await inView(p, '#poi-list li[data-id="S1"] .poi-item'), 'and scrolls to the Side Quest\'s row');
  ok(same(await sel(p, '#poi-list'), ['B3', 'S1']), 'the Side Quest and its parent are both highlighted: ' + JSON.stringify(await sel(p, '#poi-list')));
  await p.locator('#poi-list li.side-row[data-id="S2"] .poi-item').click();
  ok(same(await sel(p, '#poi-list'), ['B3', 'S2']), 'tapping the other Side Quest\'s row: it is highlighted, the first is not, the parent stays');
  await p.waitForTimeout(1200);
  ok(same(await sel(p, '#poi-list'), ['B3', 'S2']), 'the same once its window has opened');
  await p.locator('#poi-list li[data-id="A1"] .poi-item').click(); await p.waitForTimeout(1200);
  ok(same(await sel(p, '#poi-list'), ['A1']), 'tapping an unrelated main card highlights only that one');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

// ================= the Trips tab: a trip's days
{
  const { ctx, p } = await session();
  await tab(p, 'trips');
  await p.locator('#trips-list .trip-card .trip-card-head').first().click(); await p.waitForTimeout(300);
  const title = () => p.$eval('#trip-detail .flip-title', (e) => e.textContent);
  ok(/Day 1 of 3/.test(await title()), 'the trip opens on Day 1: ' + (await title()));
  await clickPin(p, 'C5');
  ok(/Day 3 of 3/.test(await title()), 'clicking a marker of another day turns the day card to that day: ' + (await title()));
  ok(await inView(p, '#trip-detail .plan-stop[data-stop-id="C5"]'), 'and scrolls to its row');
  ok(same(await sel(p, '#trip-detail'), ['C5']), 'the row is highlighted: ' + JSON.stringify(await sel(p, '#trip-detail')));
  await clickPin(p, 'B3');
  ok(/Day 2 of 3/.test(await title()) && same(await sel(p, '#trip-detail'), ['B3']), 'another day, another row');
  await clickPin(p, 'Snack bar');
  ok(await p.locator('#trip-detail .plan-stop[data-stop-id="S1"]').count() === 1, 'a Side Quest marker unfolds its parent on the day card');
  ok(same(await sel(p, '#trip-detail'), ['B3', 'S1']), 'its row and its parent\'s row are both highlighted: ' + JSON.stringify(await sel(p, '#trip-detail')));
  await p.locator('#trip-detail .plan-stop[data-stop-id="S2"]').click(); await p.waitForTimeout(300);
  ok(same(await sel(p, '#trip-detail'), ['B3', 'S2']), 'tapping the other Side Quest\'s row highlights it and keeps the parent');
  await p.locator('#trip-detail .plan-stop[data-stop-id="B4"]').click(); await p.waitForTimeout(300);
  ok(same(await sel(p, '#trip-detail'), ['B4']), 'tapping a main row highlights only that one');
  // the Points of Interest tab follows the same selection
  await tab(p, 'poi');
  ok(await p.locator('#poi-list li[data-id="B4"] .poi-item.is-sel').count() === 1, 'the list in the other tab shows the same card highlighted');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

// ================= details off: a click only selects the marker (a name tag)
{
  const { ctx, p } = await session({ markerDetails: false });
  await tab(p, 'poi');
  await clickPin(p, 'C4');
  ok(await p.locator('.name-tag').count() === 1 && same(await sel(p, '#poi-list'), ['C4']), 'a selected marker (name tag) highlights its card');
  ok(await inView(p, '#poi-list li[data-id="C4"] .poi-item'), 'and the list is scrolled to it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok((await sel(p, '#poi-list')).length === 0, 'Escape clears the selection and the highlight');
  // with another tab open nothing is scrolled or unfolded
  await tab(p, 'config');
  await clickPin(p, 'Hotel');
  await tab(p, 'poi');
  ok(same(await sel(p, '#poi-list'), ['H']), 'the highlight follows the selection even when the list was not on show');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

await b.close();
process.exit(errs.length ? 1 : 0);
