// Side Quests, phase 2: making one (point-check window, edit form), turning a marker into one and back (window, Select mode), and Undo.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('H', 'Hotel', 1, { type: 'hotel', date: '2026-11-12', endDate: '2026-11-14' }),
  mk('A', 'Alpha', 2, { date: '2026-11-12', order: 1 }),
  mk('B', 'Bravo', 3, { date: '2026-11-13', order: 1 }),
  mk('C', 'Charlie', 4, { date: '2026-11-13', order: 2 }),
  mk('D', 'Delta', 5, { date: '2026-11-13', order: 3 }),
  mk('R', 'Flat', 9, { type: 'residence', tripId: undefined }),
];
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, prefs = null } = {}) {
  const ctx = await b.newContext({ viewport });
  await ctx.addInitScript(([po, tr, pr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr)); } }, [items, trips, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const stored = (p, id) => p.evaluate((i) => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((x) => x.id === i), id);
const openName = async (p, name) => { await p.click(`#poi-list .poi-item:has(b:text-is("${name}"))`); await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 }); await p.waitForTimeout(400); };
const closeWin = async (p) => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForFunction(() => !document.querySelector('.poi-pop'), null, { timeout: 5000 }); };
const toolTitles = (p) => p.$$eval('.poi-pop .pop-tools button', (bs) => bs.map((x) => x.title));
const toastText = (p) => p.textContent('#toast');

let { ctx, p } = await session({ prefs: { currentTrip: 't1' } });

// ================= in the marker window
await openName(p, 'Charlie');
ok((await toolTitles(p)).includes('Make Side Quest'), 'a main stop\'s window has "Make Side Quest"');
await closeWin(p);
await openName(p, 'Hotel');
ok(!(await toolTitles(p)).some((t) => /Side Quest|main stop/.test(t)), 'a Hotel\'s window has no such button');
await closeWin(p);
await openName(p, 'Flat');
ok(!(await toolTitles(p)).some((t) => /Side Quest|main stop/.test(t)), 'nor does the Home marker');
await closeWin(p);

await openName(p, 'Charlie');
await p.click('.poi-pop .pop-tools button[title="Make Side Quest"]'); await p.waitForTimeout(700);
let c = await stored(p, 'C');
ok(c.isSub === true && c.parentId && !('order' in c) && c.date === '2026-11-13', 'it becomes a Side Quest, loses its stop number, keeps its date: parent ' + c.parentId);
ok(['B', 'D'].includes(c.parentId), 'and hangs from the nearest main stop (a neighbour on its day, not the hotel)');
ok(/Charlie.* is now a Side Quest/.test(await toastText(p)) && (await p.isVisible('#toast .toast-action')), 'a message says so, with Undo: ' + await toastText(p));
await p.waitForFunction(() => /Side Quest/.test(document.querySelector('.poi-pop .pop-type')?.textContent || ''), null, { timeout: 5000 });
ok((await toolTitles(p)).includes('Make main stop'), 'the window reopens as a Side Quest, offering "Make main stop"');
await p.click('#toast .toast-action'); await p.waitForTimeout(500);
c = await stored(p, 'C');
ok(!c.isSub && !c.parentId && c.order === 2, 'Undo restores the marker exactly (a main stop, stop 2)');
await closeWin(p);

await openName(p, 'Charlie');
await p.click('.poi-pop .pop-tools button[title="Make Side Quest"]'); await p.waitForTimeout(600);
await p.click('.poi-pop .pop-tools button[title="Make main stop"]'); await p.waitForTimeout(600);
c = await stored(p, 'C');
ok(!c.isSub && !c.parentId && c.order === 4, 'turning it back makes it the last stop of its day (stop ' + c.order + ')');
await closeWin(p);

// ================= the edit form
await openName(p, 'Delta');
await p.click('.poi-pop .pop-tools button[title="Edit"]'); await p.waitForSelector('.poi-pop form', { timeout: 5000 });
ok(await p.isVisible('#edit-side') && !(await p.isVisible('.poi-pop .near-lab')), 'the form has a Side Quest box; "Near" appears only once it is ticked');
await p.check('#edit-side'); await p.waitForTimeout(150);
ok(await p.isVisible('.poi-pop .near-lab') && !(await p.isVisible('.poi-pop label:has-text("Stop in the day")')), 'ticking it shows "Near" and hides the stop number');
const near = await p.$$eval('.poi-pop .near-lab option', (o) => o.map((x) => x.textContent));
ok(/nearest/i.test(near[0]) && ['Alpha', 'Bravo', 'Charlie', 'Hotel'].every((n) => near.some((t) => t.startsWith(n))) && !near.some((t) => /Delta|Flat/.test(t)), 'it offers "the nearest main stop" and the other main stops of the trip (a hotel may be one), not itself or the Home marker: ' + near.join(' | '));
await p.selectOption('.poi-pop .near-lab select', { label: near.find((t) => /Alpha/.test(t)) });
await p.selectOption('.poi-pop label:has-text("Type") select', 'hotel'); await p.waitForTimeout(150);
ok(!(await p.isVisible('#edit-side')) && !(await p.isVisible('.poi-pop .near-lab')), 'choosing the Hotel type hides the box and "Near"');
await p.selectOption('.poi-pop label:has-text("Type") select', 'photo'); await p.waitForTimeout(150);
await p.click('.poi-pop button[type=submit]'); await p.waitForTimeout(500);
let d = await stored(p, 'D');
ok(d.isSub === true && d.parentId === 'A' && !('order' in d), 'saving stores a Side Quest with the chosen parent and no stop number');
await closeWin(p);
ok((await p.locator('#poi-list li', { has: p.locator('b:text-is("Delta")') }).count()) === 0, 'it is now folded under Alpha, so the list no longer shows it on its own');
await p.locator('#poi-list li', { has: p.locator('b:text-is("Alpha")') }).locator('.side-chip').click(); await p.waitForTimeout(300);
await openName(p, 'Delta');
await p.click('.poi-pop .pop-tools button[title="Edit"]'); await p.waitForSelector('.poi-pop form', { timeout: 5000 });
ok(await p.isChecked('#edit-side') && (await p.inputValue('.poi-pop .near-lab select')) === 'A', 'the form reopens with the box ticked and Alpha chosen');
await p.uncheck('#edit-side'); await p.waitForTimeout(100);
await p.click('.poi-pop button[type=submit]'); await p.waitForTimeout(500);
d = await stored(p, 'D');
ok(!d.isSub && !d.parentId && d.order === undefined, 'unticking and saving makes it a main stop again, with no leftover stop number or parent');
await closeWin(p);

// ================= from the point-check window
await p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); });
await p.waitForTimeout(200);
await p.fill('#q', '30.5700, 114.3100'); await p.waitForTimeout(250);
await p.keyboard.press('Enter');
await p.waitForSelector('.leaflet-popup .pop-tools button[title="Add as Side Quest"]', { timeout: 8000 });
ok(await p.isVisible('.leaflet-popup .pop-tools button[title="Add as marker"]'), 'the point-check window has both "Add as marker" and "Add as Side Quest"');
await p.click('.leaflet-popup .pop-tools button[title="Add as Side Quest"]'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
const all = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const fresh = all.find((x) => !items.some((o) => o.id === x.id));
ok(fresh && fresh.isSub === true && fresh.type === 'other' && fresh.tripId === 't1' && ['C', 'D'].includes(fresh.parentId) && fresh.date === '2026-11-13', 'it adds a Side Quest of type Other in the current trip, hung from the nearest main stop (' + (fresh && fresh.parentId) + ') on its date, and opens its form');
ok(await p.isChecked('#edit-side') && await p.isVisible('.poi-pop .near-lab'), 'the form opens with the Side Quest box ticked');
await p.evaluate(() => { document.querySelector(".leaflet-popup-close-button")?.click(); }); await p.waitForTimeout(500);

// ================= Select mode
await p.click('#poi-select'); await p.waitForTimeout(200);
ok((await p.isDisabled('#sel-side')) && (await p.isDisabled('#sel-main')), 'in Select mode the two buttons are disabled until something is ticked');
await p.check('#poi-list .sel-box[aria-label="Select Alpha"]');
await p.check('#poi-list .sel-box[aria-label="Select Bravo"]');
await p.check('#poi-list .sel-box[aria-label="Select Hotel"]');
await p.click('#sel-side'); await p.waitForTimeout(600);
const a2 = await stored(p, 'A'), b2 = await stored(p, 'B'), h2 = await stored(p, 'H');
ok(a2.isSub && b2.isSub && !h2.isSub, 'two main stops become Side Quests; the Hotel is skipped');
ok(a2.parentId && b2.parentId && ![a2.parentId, b2.parentId].some((x) => ['A', 'B'].includes(x)), 'and neither is the other\'s parent (they hang from stops that were not selected)');
ok(/2 markers are now Side Quests/.test(await toastText(p)) && /1 skipped/.test(await toastText(p)), 'the message counts them and the skipped one: ' + await toastText(p));
await p.click('#toast .toast-action'); await p.waitForTimeout(500);
const a3 = await stored(p, 'A'), b3 = await stored(p, 'B');
ok(!a3.isSub && !b3.isSub && a3.order === 1 && b3.order === 1, 'Undo puts both back exactly');
await p.screenshot({ path: SP + '/side-select.png' });
await ctx.close();

console.log('errors:', errs.length ? errs : 'none');
await b.close();
