// Side Quests, phase 4: hold and drag. A Side Quest moves among its siblings, onto another main stop (it hangs from it and takes its date) or onto a heading;
// a main stop takes its Side Quests along when its date changes, and they fold away while it is lifted. Alt + arrows step among siblings.
import { CHANNEL, chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const HOLD = 1300;

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${Math.floor(n)}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('A', 'Alpha', 1, { date: '2026-11-12', order: 1 }),
  mk('B', 'Bravo', 2, { date: '2026-11-12', order: 2 }),
  mk('C', 'Charlie', 3, { date: '2026-11-13', order: 1 }),
  mk('S1', 'Snack bar', 1.2, { type: 'other', date: '2026-11-12', isSub: true, parentId: 'A', order: 1 }),
  mk('S2', 'Old gate', 1.4, { type: 'other', date: '2026-11-12', isSub: true, parentId: 'A', order: 2 }),
  mk('S3', 'Lookout', 3.3, { type: 'other', date: '2026-11-13', isSub: true, parentId: 'C', order: 1 }),
];
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); } }, [items, trips]);
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
await p.waitForTimeout(400);

const stored = () => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => [i.id, i])));
const f = (it) => `${it.parentId ?? '-'}|${it.date ?? '-'}|${it.order ?? '-'}`;
const rect = (id) => p.evaluate((i) => { const li = document.querySelector(`#poi-list li[data-id="${i}"]`); li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; }, id);
const headRect = (key) => p.evaluate((k) => { const h = document.querySelector(`#poi-list li.day-head[data-gkey="${k}"]`); h.scrollIntoView({ block: 'center' }); const r = h.getBoundingClientRect(); return { y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; }, key);
const hold = async (id) => { const r = await rect(id); await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.waitForTimeout(HOLD); };
const dragTo = async (y) => { await p.mouse.move(700, y, { steps: 8 }); await p.waitForTimeout(250); };
const drop = async () => { await p.mouse.up(); await p.waitForTimeout(600); };
const undo = async () => { await p.click('#toast .toast-action'); await p.waitForTimeout(500); };
const chip = (name) => p.locator('#poi-list li', { has: p.locator(`b:text-is("${name}")`) }).locator('.side-chip');
const rowIds = () => p.$$eval('#poi-list li[data-id]', (e) => e.map((x) => x.dataset.id).join(','));
const unfold = async (name) => { if ((await chip(name).getAttribute('aria-expanded')) !== 'true') { await chip(name).click(); await p.waitForTimeout(300); } };

const original = await stored();
await unfold('Alpha');
ok((await rowIds()) === 'A,S1,S2,B,C', 'Alpha unfolded: its two Side Quests sit under it: ' + await rowIds());
ok((await p.locator('#poi-list li.side-row[data-drag="1"][data-parent="A"]').count()) === 2, 'the Side Quest rows can be dragged and know their parent');

// ---- among siblings: Snack bar below Old gate
await hold('S1');
ok((await p.locator('.drag-ghost').count()) === 1, 'a Side Quest row lifts after the hold');
await dragTo((await rect('S2')).bottom);
ok((await p.locator('li.drop-line').count()) === 1, 'a line shows where it would land');
await drop();
let now = await stored();
ok(f(now.S1) === 'A|2026-11-12|2' && f(now.S2) === 'A|2026-11-12|1', 'dropped below Old gate: Snack bar is the second Side Quest, Old gate the first: ' + f(now.S1) + ' / ' + f(now.S2));
ok(f(now.A) === f(original.A) && f(now.B) === f(original.B), 'main stops are untouched');
ok(/Moved “Snack bar”/.test(await p.textContent('#toast')), 'a message names the move and offers Undo');
await undo();
now = await stored();
ok(Object.keys(original).every((k) => f(now[k]) === f(original[k])), 'Undo restores every marker');

// ---- onto another main stop: Snack bar goes to Charlie
await unfold('Alpha');
await hold('S1');
await dragTo((await rect('C')).bottom);
await drop();
now = await stored();
ok(f(now.S1) === 'C|2026-11-13|2' && f(now.S3) === 'C|2026-11-13|1', 'dropped on Charlie: Snack bar hangs from Charlie, takes 13 Nov and comes after Lookout: ' + f(now.S1));
ok(f(now.S2) === 'A|2026-11-12|1', 'Alpha\'s remaining Side Quest is renumbered to 1');
ok((await chip('Charlie').getAttribute('aria-expanded')) === 'true', 'Charlie stays unfolded so the moved row stays in view');
await undo();

// ---- onto a heading: Old gate leaves Alpha for 13 Nov
await unfold('Alpha');
await hold('S2');
await dragTo((await headRect('2026-11-13')).y);
await drop();
now = await stored();
ok(!now.S2.parentId && now.S2.date === '2026-11-13' && now.S2.order === undefined, 'dropped on the 13 Nov heading: no parent, date 13 Nov: ' + f(now.S2));
await undo();

// ---- a main stop takes its Side Quests along, and they fold away while it is lifted
await unfold('Alpha');
await hold('A');
ok((await p.locator('#poi-list li[data-sub][hidden]').count()) === 2, 'while Alpha is lifted its Side Quest rows fold away');
await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.mouse.up(); await p.waitForTimeout(400);
ok((await p.locator('#poi-list li[data-sub][hidden]').count()) === 0 && (await rowIds()) === 'A,S1,S2,B,C', 'Escape puts them back; nothing changed');
await hold('A');
await dragTo((await rect('C')).bottom);
await drop();
now = await stored();
ok(f(now.A).startsWith('-|2026-11-13') && now.S1.date === '2026-11-13' && now.S2.date === '2026-11-13' && now.S1.parentId === 'A' && now.S2.parentId === 'A', 'Alpha dropped on 13 Nov: its Side Quests get 13 Nov and stay under it: ' + f(now.S1));
ok(f(now.S3) === 'C|2026-11-13|1', 'Charlie\'s own Side Quest is untouched');
await undo();
now = await stored();
ok(Object.keys(original).every((k) => f(now[k]) === f(original[k])), 'Undo brings back the main stop and its Side Quests together');

// ---- keyboard
await unfold('Alpha');
await p.focus('#poi-list li[data-id="S1"] .poi-item');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(500);
now = await stored();
ok(f(now.S1) === 'A|2026-11-12|2' && f(now.S2) === 'A|2026-11-12|1', 'Alt + Down moves Snack bar one place down among its siblings');
ok(await p.evaluate(() => document.activeElement?.closest('li')?.dataset.id) === 'S1', 'and keeps the focus on it');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(400);
now = await stored();
ok(f(now.S1) === 'A|2026-11-12|2', 'Alt + Down at the last Side Quest does nothing');

// ================= the Trips tab: the same, within one day page
await p.evaluate(() => document.getElementById('tab-trips').click()); await p.waitForTimeout(400);
await p.locator('#trips-list .trip-card .trip-card-head').first().click(); await p.waitForTimeout(400);
await p.locator('#trip-detail .flip-dot').first().click(); await p.waitForTimeout(300);
const rectT = (id) => p.evaluate((i) => { const e = document.querySelector(`#trip-detail [data-id="${i}"]`); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; }, id);
const holdT = async (id) => { const r = await rectT(id); await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.waitForTimeout(HOLD); };
const chipT = () => p.locator('#trip-detail .side-chip').first();
const idsT = () => p.$$eval('#trip-detail [data-drag="1"]', (e) => e.map((x) => x.dataset.id).join(','));
await undo().catch(() => {});
now = await stored();
ok(Object.keys(original).every((k) => f(now[k]) === f(original[k])), 'back to the seeded data before the Trips tab checks');
if ((await chipT().getAttribute('aria-expanded')) === 'true') { await chipT().click(); await p.waitForTimeout(300); } // the list's Alpha was left unfolded
ok((await idsT()) === 'A,B', 'Day 1 page: Alpha and Bravo can be held (Charlie is on day 2): ' + await idsT());
await holdT('B');
ok((await p.locator('.drag-ghost').count()) === 1, 'a day-page stop lifts after the hold');
await dragTo((await rectT('A')).top);
ok((await p.locator('div.drop-line').count()) === 1, 'a line shows where it would land');
await drop();
now = await stored();
ok(f(now.B) === '-|2026-11-12|1' && f(now.A) === '-|2026-11-12|2', 'Bravo dropped above Alpha: Bravo is stop 1, Alpha stop 2, same day: ' + f(now.B) + ' / ' + f(now.A));
await undo();
if ((await chipT().getAttribute('aria-expanded')) !== 'true') { await chipT().click(); await p.waitForTimeout(300); }
ok((await idsT()) === 'A,S1,S2,B', 'Alpha unfolded on the page: its Side Quests can be held too: ' + await idsT());
await holdT('S1');
await dragTo((await rectT('S2')).bottom);
await drop();
now = await stored();
ok(f(now.S1) === 'A|2026-11-12|2' && f(now.S2) === 'A|2026-11-12|1', 'a Side Quest dropped below its sibling on the day page: ' + f(now.S1));
await undo();
await p.focus('#trip-detail [data-id="B"] .plan-stop, #trip-detail .plan-stop[data-id="B"]');
await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(400);
now = await stored();
ok(f(now.B) === f(original.B), 'Alt + Down on the last stop of a day does nothing here (a day change belongs to the Points of Interest tab)');
await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(500);
now = await stored();
ok(now.B.order === 1 && now.A.order === 2 && now.B.date === '2026-11-12', 'Alt + Up moves Bravo above Alpha within the day');

ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
