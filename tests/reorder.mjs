// Reordering saved places: press and hold a row for 1 s, drag it between dates, and the date, day and stop follow. Alt + arrows too.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const HOLD = 1300;

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const seed = { v: 1, items: [
  mk('H', 'Hotel', 1, { type: 'hotel', date: '2026-11-12', endDate: '2026-11-14', day: 1, order: 1 }),
  mk('A', 'Alpha', 2, { date: '2026-11-12', day: 1, order: 2 }),
  mk('B', 'Bravo', 3, { date: '2026-11-12', day: 1, order: 3 }),
  mk('C', 'Charlie', 4, { date: '2026-11-13', day: 2, order: 1 }),
  mk('D', 'Delta', 5, { date: '2026-11-13', day: 2, order: 2 }),
  { id: 'L', type: 'photo', name: 'Loose', note: '', lat: 30.9, lon: 114.9, created: '2026-11-01T00:00:06.000Z' },
  { id: 'R', type: 'residence', name: 'Flat', note: '', lat: 30.4, lon: 114.1, created: '2026-11-01T00:00:07.000Z' },
] };
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ items = seed, tripsData = trips, viewport = { width: 1200, height: 800 }, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify(po)); if (tr) localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); } }, [items, tripsData]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(400);
  return { ctx, p };
}
const stored = (p) => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => [i.id, i])));
const f = (it) => `${it.date ?? '-'}|${it.endDate ?? '-'}|${it.day ?? '-'}|${it.order ?? '-'}`;
const rect = (p, id) => p.evaluate((i) => { const li = document.querySelector(`#poi-list li[data-id="${i}"]`); li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, h: r.height }; }, id);
const headRect = (p, key) => p.evaluate((k) => { const h = document.querySelector(`#poi-list li.day-head[data-gkey="${k}"]`); h.scrollIntoView({ block: 'center' }); const r = h.getBoundingClientRect(); return { y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; }, key);
const toastText = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });
const hold = async (p, id) => { const r = await rect(p, id); await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.waitForTimeout(HOLD); return r; };
const dragTo = async (p, y) => { await p.mouse.move(700, y, { steps: 8 }); await p.waitForTimeout(250); };
const drop = async (p) => { await p.mouse.up(); await p.waitForTimeout(600); };

// ================= desktop
let { ctx, p } = await session();
const original = await stored(p);
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 5, 'the five markers of the dated trip can be dragged; the loose undated one and the Home marker cannot');
ok((await p.locator('#poi-list li[data-id="L"][data-drag], #poi-list li[data-id="R"][data-drag]').count()) === 0, '... (checked by name)');

// ---- a short hold is just a click
let r0 = await rect(p, 'B');
await p.mouse.move(r0.x, r0.y); await p.mouse.down(); await p.waitForTimeout(500);
ok((await p.locator('.poi-item.holding').count()) === 1 && (await p.locator('.drag-ghost').count()) === 0, 'while holding, the row shows a filling bar, and nothing is lifted yet');
await p.mouse.up(); await p.waitForTimeout(1500);
ok((await p.locator('.drag-ghost').count()) === 0 && (await p.locator('.poi-item.holding').count()) === 0, 'letting go early lifts nothing');
ok((await p.locator('.leaflet-popup').count()) === 1, 'and it was an ordinary click: the marker opened');
await p.mouse.click(120, 700); await p.waitForTimeout(400);
ok(JSON.stringify(await stored(p)) === JSON.stringify(original), 'nothing was changed');

// ---- moving during the hold cancels it
r0 = await rect(p, 'B');
await p.mouse.move(r0.x, r0.y); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.move(r0.x, r0.y + 40, { steps: 4 }); await p.waitForTimeout(HOLD);
ok((await p.locator('.drag-ghost').count()) === 0, 'moving during the 1 s cancels the hold (that was scrolling)');
await p.mouse.up(); await p.waitForTimeout(300);

// ---- lift, then Escape
await hold(p, 'B');
ok((await p.locator('.drag-ghost').count()) === 1 && (await p.locator('li.lift-source').count()) === 1 && (await p.evaluate(() => document.body.classList.contains('reordering'))), 'after 1 s the row is lifted: a copy follows the pointer and the original dims');
ok((await p.locator('#poi-list li.day-head.drop-only').count()) === 1 && (await headRect(p, '2026-11-14')).top > 0, 'the trip\'s empty last day (14 Nov) appears as a place to drop');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.mouse.up(); await p.waitForTimeout(400);
ok((await p.locator('.drag-ghost').count()) === 0 && (await p.locator('#poi-list li.drop-only').count()) === 0 && JSON.stringify(await stored(p)) === JSON.stringify(original), 'Escape drops it back: nothing changed, the extra date is gone');

// ---- drag Bravo into 13 Nov, between Charlie and Delta
await hold(p, 'B');
let rD = await rect(p, 'D');
await dragTo(p, rD.top + 2);
ok((await p.locator('li.drop-line').count()) === 1, 'a line shows where it would land');
await drop(p);
let now = await stored(p);
ok(f(now.B) === '2026-11-13|-|2|2' && f(now.C) === '2026-11-13|-|2|1' && f(now.D) === '2026-11-13|-|2|3', 'dropped between Charlie and Delta: Bravo is 13 Nov, day 2, stop 2; Delta moves to stop 3: ' + f(now.B) + ' / ' + f(now.D));
ok(f(now.H) === f(original.H) && f(now.A) === f(original.A), 'the markers of the day it left keep their stops');
ok((await p.locator('.leaflet-popup').count()) === 0, 'the release did not count as a click on the row');
let tt = await toastText(p);
ok(/Moved “Bravo”/.test(tt) && /Undo/.test(tt), 'a message says what moved and offers Undo: "' + tt + '"');
const order = await p.$$eval('#poi-list li[data-id]', (e) => e.map((x) => x.dataset.id).join(''));
ok(order.startsWith('HACBD'), 'the list shows the new order (H A | C B D): ' + order);
await p.click('#toast .toast-action'); await p.waitForTimeout(500);
now = await stored(p);
ok(Object.keys(original).every((k) => f(now[k]) === f(original[k])), 'Undo puts every marker back exactly as it was');

// ---- drag the hotel to 13 Nov: it ends on the next trip day
await hold(p, 'H');
rD = await rect(p, 'C');
await dragTo(p, rD.top + 2);
await drop(p);
now = await stored(p);
ok(f(now.H) === '2026-11-13|2026-11-14|2|1' && f(now.C) === '2026-11-13|-|2|2', 'the hotel dropped on 13 Nov starts then and ends on the next day (14 Nov), day 2, stop 1');
await p.click('#toast .toast-action'); await p.waitForTimeout(500);

// ---- drag Alpha onto the empty 14 Nov
await hold(p, 'A');
const h14 = await headRect(p, '2026-11-14');
await dragTo(p, h14.bottom + 1);
await drop(p);
now = await stored(p);
ok(f(now.A) === '2026-11-14|-|3|1', 'dropped on the empty 14 Nov: date 14 Nov, day 3 (from the trip start), stop 1: ' + f(now.A));
await p.click('#toast .toast-action'); await p.waitForTimeout(500);

// ---- the hotel on the trip's last day: start = end
await hold(p, 'H');
await dragTo(p, (await headRect(p, '2026-11-14')).bottom + 1);
await drop(p);
now = await stored(p);
ok(f(now.H) === '2026-11-14|-|3|1', 'the hotel dropped on the last day of the trip: start and end are both 14 Nov (stored as that one date): ' + f(now.H));
await p.click('#toast .toast-action'); await p.waitForTimeout(500);

// ---- a row cannot be dropped in another group
await p.evaluate(() => { document.getElementById('toast').hidden = true; }); // the earlier Undo message may still be showing
await hold(p, 'A');
const lr = await rect(p, 'L');
await dragTo(p, lr.y);
await drop(p);
now = await stored(p);
ok(Object.keys(original).every((k) => f(now[k]) === f(original[k])) && now.A.tripId === 't1' && !(await toastText(p)), 'letting go over the "No trip" list changes nothing: no move, no message');

// ---- keyboard: Alt + arrows
await p.focus('#poi-list li[data-id="A"] .poi-item');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(500);
now = await stored(p);
ok(now.A.order === 3 && now.B.order === 2, 'Alt + Down moves Alpha one place down (below Bravo)');
ok(await p.evaluate(() => document.activeElement?.closest('li')?.dataset.id) === 'A', 'and keeps the focus on it');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(500);
now = await stored(p);
ok(f(now.A) === '2026-11-13|-|2|1', 'Alt + Down from the last of a day moves it to the top of the next day (13 Nov, day 2, stop 1): ' + f(now.A));
await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(500);
now = await stored(p);
ok(f(now.A).startsWith('2026-11-12') && now.A.order === 3, 'Alt + Up takes it back to the end of 12 Nov');
await ctx.close();

// ================= lists that cannot be dragged
const plainItems = { v: 1, items: [mk('P1', 'One', 1, { tripId: undefined }), mk('P2', 'Two', 2, { tripId: undefined })] };
({ ctx, p } = await session({ items: plainItems, tripsData: null }));
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 0, 'a list with no dates or days has nothing to drag');
await ctx.close();

({ ctx, p } = await session());
await p.click('#poi-filter .chip:has-text("Photo spot")');
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 0, 'with a type filter on, nothing can be dragged');
await p.click('#poi-filter .chip:has-text("All")');
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 5, 'clearing the filter brings it back');
await p.click('#poi-select');
ok((await p.locator('#poi-list li[data-drag="1"]').count()) === 0, 'while selecting markers to delete, nothing can be dragged');
await ctx.close();

// ================= phone (touch)
({ ctx, p } = await session({ viewport: { width: 390, height: 780 }, mobile: true }));
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const rb = await rect(p, 'B');
await touch('touchStart', rb.x, rb.y); await p.waitForTimeout(HOLD);
ok((await p.locator('.drag-ghost').count()) === 1, 'phone: holding a row for 1 s lifts it');
const rdd = await rect(p, 'D');
await touch('touchMove', rb.x, (rb.y + rdd.top) / 2); await touch('touchMove', rb.x, rdd.top + 2); await p.waitForTimeout(250);
await touch('touchEnd'); await p.waitForTimeout(700);
now = await stored(p);
ok(f(now.B) === '2026-11-13|-|2|2' && f(now.D) === '2026-11-13|-|2|3', 'phone: dragging by touch moves Bravo between Charlie and Delta: ' + f(now.B));
await p.screenshot({ path: `${SP}/reorder-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
