// Side Quests, phase 3: folded away by default (a +N badge on the main stop's pin, a ▾ N chip on its card), unfolded by a tap, shown on the map only for the main stop that is open.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const D = '2027-03-10';
const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('H', 'Hotel', 1, { type: 'hotel', date: D, endDate: '2027-03-12' }),
  mk('A', 'Alpha', 2, { date: D, order: 1 }),
  mk('B', 'Bravo', 3, { date: D, order: 2 }),
  mk('S1', 'Snack bar', 2.2, { type: 'other', date: D, isSub: true, parentId: 'A' }),
  mk('S2', 'Old gate', 2.4, { type: 'other', date: D, isSub: true }), // no parent chosen: the nearest main stop, Alpha
  mk('S3', 'Lookout', 3.3, { type: 'other', date: D, isSub: true, parentId: 'B' }),
  mk('L', 'Lost', 8, { type: 'other', tripId: undefined, isSub: true }), // no main stop to hang from
];
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: D, endDate: '2027-03-12' }] };

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
const pin = (p, name) => p.locator(`.poi-pin[title="${name}"]`);
const shown = (p, name) => pin(p, name).evaluate((e) => getComputedStyle(e).display !== 'none').catch(() => false);
const rowsText = (p) => p.$$eval('#poi-list li[data-id]', (l) => l.map((x) => x.querySelector('.poi-item b')?.textContent.replace(/Side Quest|Unverified/g, '').trim() + (x.classList.contains('side-row') ? '*' : '')));
const mapView = (p) => p.evaluate(() => { const t = [...document.querySelectorAll('.leaflet-map-pane')][0]; return t.style.transform; });

let { ctx, p } = await session();

// ================= folded away by default
ok((await pin(p, 'Alpha').locator('.sidecount').textContent()) === '+2' && (await pin(p, 'Bravo').locator('.sidecount').textContent()) === '+1', 'a main stop\'s pin carries a +N badge: Alpha +2, Bravo +1');
ok(!(await shown(p, 'Snack bar')) && !(await shown(p, 'Old gate')) && !(await shown(p, 'Lookout')), 'its Side Quests are not on the map');
ok(await shown(p, 'Lost'), 'a Side Quest with no main stop stays on the map (nothing to fold into)');
ok((await pin(p, 'Lost').evaluate((e) => e.classList.contains('side-pin'))), 'and looks like a Side Quest (smaller, dashed)');
let rows = await rowsText(p);
ok(!rows.some((r) => /Snack|Old gate|Lookout/.test(r)) && rows.includes('Lost'), 'the list does not show them either, apart from the one with no main stop: ' + rows.join(', '));
ok((await p.locator('#poi-list li', { has: p.locator('b:text-is("Alpha")') }).locator('.side-chip').textContent()).trim() === '▾ 2', 'Alpha\'s card has a ▾ 2 chip');
const cardW = (name) => p.locator('#poi-list li', { has: p.locator(`b:text-is("${name}")`) }).locator('.poi-card').evaluate((e) => e.getBoundingClientRect().width);
{ const a = await cardW('Alpha'), h = await cardW('Hotel'); ok(Math.abs(a - h) < 1, `Alpha's card (with the chip) is as wide as Hotel's (without): ${a.toFixed(1)} vs ${h.toFixed(1)}`); }
ok((await p.locator('#poi-list li.side-row').count()) === 0 && (await p.locator('#poi-list li[data-drag]').count()) === 3, 'no nested rows yet; the three main stops can be dragged, the Side Quest in the flow cannot');

// ================= unfold with the chip: no map move, the pins appear with dotted links
const view0 = await mapView(p);
await p.locator('#poi-list li', { has: p.locator('b:text-is("Alpha")') }).locator('.side-chip').click(); await p.waitForTimeout(400);
rows = await rowsText(p);
const at = rows.indexOf('Alpha');
ok(rows[at + 1] === 'Snack bar*' && rows[at + 2] === 'Old gate*' && rows[at + 3] !== 'Lookout*', 'the chip unfolds Alpha\'s two Side Quests right under it, indented: ' + rows.join(', '));
ok((await p.locator('#poi-list li', { has: p.locator('b:text-is("Alpha")') }).locator('.side-chip').textContent()).trim() === '▴ 2', 'the chip turns to ▴ 2');
ok((await shown(p, 'Snack bar')) && (await shown(p, 'Old gate')) && !(await shown(p, 'Lookout')), 'on the map only Alpha\'s Side Quests appear');
ok((await p.locator('.leaflet-overlay-pane path[stroke-dasharray="2 6"]').count()) === 2, 'with a dotted line from each to Alpha');
ok(await mapView(p) === view0, 'the chip does not move the map');
ok((await p.locator('#poi-list li.side-row[data-drag="1"]').count()) === 2, 'the nested rows can be held and dragged like main cards');

// ================= tap a card: opens the marker, folds the other card, unfolds its own
await p.locator('#poi-list li', { has: p.locator('b:text-is("Bravo")') }).locator('.poi-item').click();
await p.waitForSelector('.poi-pop h3', { timeout: 8000 }); await p.waitForTimeout(600);
rows = await rowsText(p);
ok(rows.includes('Lookout*') && !rows.includes('Snack bar*'), 'tapping Bravo opens it and unfolds its Side Quest while Alpha\'s fold: ' + rows.join(', '));
ok((await shown(p, 'Lookout')) && !(await shown(p, 'Snack bar')), 'the map follows');
ok(/Side Quests \(1\)/.test(await p.textContent('.poi-pop .pop-side')) && (await p.locator('.poi-pop .pop-side-btn').textContent()) === 'Lookout', 'Bravo\'s window lists its Side Quest');
await p.click('.poi-pop .pop-side-btn'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Lookout', null, { timeout: 5000 }); await p.waitForTimeout(400);
ok(/Side Quest/.test(await p.textContent('.poi-pop .pop-type')) && /Side Quest near/.test(await p.textContent('.poi-pop .pop-side')) && (await p.locator('.poi-pop .pop-side-btn').textContent()) === 'Bravo', 'the Side Quest\'s window says it is near Bravo, with a button back');
ok(await shown(p, 'Lookout'), 'and its pin stays on show while its window is open');
await p.click('.poi-pop .pop-side-btn'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Bravo', null, { timeout: 5000 });
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);

// ================= fold again
await p.locator('#poi-list li', { has: p.locator('b:text-is("Bravo")') }).locator('.side-chip').click(); await p.waitForTimeout(300);
ok((await p.locator('#poi-list li.side-row').count()) === 0 && !(await shown(p, 'Lookout')), 'the chip folds them away again, in the list and on the map');

// ================= the switch: show all
await p.check('#poi-showside'); await p.waitForTimeout(300);
ok((await shown(p, 'Snack bar')) && (await shown(p, 'Old gate')) && (await shown(p, 'Lookout')), '"Show all Side Quests on the map" shows every one');
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).showSide)) === true, 'and is remembered');
await p.uncheck('#poi-showside'); await p.waitForTimeout(300);
ok(!(await shown(p, 'Snack bar')) && !('showSide' in (await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs'))))), 'switching it off folds them again and clears the setting');

// ================= Select mode shows them all
await p.click('#poi-select'); await p.waitForTimeout(400);
rows = await rowsText(p);
ok(['Snack bar*', 'Old gate*', 'Lookout*'].every((r) => rows.includes(r)) && (await shown(p, 'Snack bar')), 'while selecting, every Side Quest is listed and on the map so it can be ticked');
await p.click('#sel-done'); await p.waitForTimeout(400);
ok((await p.locator('#poi-list li.side-row').count()) === 0 && !(await shown(p, 'Snack bar')), 'and they fold away again afterwards');

// ================= the Trips tab
await p.click('#tab-trips'); await p.waitForTimeout(300);
await p.locator('#trips-list .trip-card .trip-card-head').first().click(); await p.waitForTimeout(500);
const plan = (sel) => p.locator('#trip-detail ' + sel);
ok((await plan('.plan-row:has-text("Alpha") .side-chip').textContent()).trim() === '▾ 2' && (await plan('.plan-side').count()) === 0, 'on the trip\'s day card Alpha has the same ▾ 2 chip and nothing is unfolded');
ok(/Side Quests with no main stop/.test(await p.textContent('#trip-detail')) === false, 'the orphan has no trip, so it is not listed under this one');
await p.locator('#trip-detail .plan-row:has-text("Alpha") .plan-stop').click(); await p.waitForTimeout(700);
ok((await plan('.plan-side').count()) === 2 && /Snack bar/.test(await plan('.plan-group').first().textContent()), 'tapping the stop opens it and unfolds its Side Quests under it');
ok((await shown(p, 'Snack bar')) && !(await shown(p, 'Lookout')), 'the map shows the same ones');
const nums = await p.$$eval('#trip-detail .plan-stop .plan-n', (n) => n.map((x) => x.textContent));
ok(nums.join('') === '1↳↳2•', 'the Side Quests carry ↳ instead of a stop number, and the main stops keep 1 and 2 (the hotel a dot): ' + nums.join(' '));
await p.screenshot({ path: SP + '/sidelist-trip.png' });
await p.click('#tab-poi'); await p.waitForTimeout(400);
rows = await rowsText(p);
ok(rows.includes('Snack bar*'), 'the Points of Interest list shares the unfolded card');
await p.screenshot({ path: SP + '/sidelist-poi.png' });

await ctx.close();
console.log('errors:', errs.length ? errs : 'none');
await b.close();
