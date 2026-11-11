// Previous / next stop in the marker window: the order, the ends, who gets the bar, and that it stays in view.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('H', 'Hotel', 1, { type: 'hotel', date: '2026-11-12', endDate: '2026-11-14', order: 1 }),
  mk('A', 'Alpha', 2, { date: '2026-11-12', order: 2 }),
  mk('B', 'Bravo', 3, { date: '2026-11-13', order: 1 }),
  mk('C', 'Charlie', 4, { date: '2026-11-13', order: 2 }),
  mk('D', 'Delta', 5, { date: '2026-11-14' }),
  mk('U', 'Undated', 6),
  mk('L', 'Loose', 7, { tripId: undefined, date: '2026-11-13' }),
  mk('S', 'Solo', 8, { tripId: 't2', date: '2026-12-01' }),
];
const trips = { v: 1, trips: [
  { id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' },
  { id: 't2', name: 'Later', color: '#3949ab', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-12-01', endDate: '2026-12-01' },
] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, mobile = false, prefs = null } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([po, tr, pr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr)); } }, [items, trips, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const openName = async (p, name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 }); await p.waitForTimeout(800); };
const title = (p) => p.locator('.poi-pop h3').textContent();
const bar = (p) => p.evaluate(() => { const b = document.querySelector('.pop-seq'); if (!b) return null; const [prev, next] = b.querySelectorAll('button'); return { pos: b.querySelector('.pop-seq-pos').textContent, prevDisabled: prev.disabled, nextDisabled: next.disabled, prevTitle: prev.title, nextTitle: next.title }; });
const goNext = async (p) => { const before = await title(p); await p.click('.pop-seq-btn:has-text("Next")'); await p.waitForFunction((t) => document.querySelector('.poi-pop h3')?.textContent !== t, before, { timeout: 8000 }); await p.waitForTimeout(900); };

// ================= desktop
let { ctx, p } = await session();
await openName(p, 'Alpha');
let s = await bar(p);
ok(s && s.pos === '2 of 5' && !s.prevDisabled && !s.nextDisabled, 'Alpha is stop 2 of 5 (hotel, Alpha, Bravo, Charlie, Delta): ' + JSON.stringify(s && s.pos));
ok(/Previous stop: Hotel/.test(s.prevTitle) && /Next stop: Bravo/.test(s.nextTitle) && /Day 2/.test(s.nextTitle) && /Stop 1/.test(s.nextTitle), 'each button names its destination, with its day and stop: "' + s.nextTitle + '"');
await goNext(p);
ok((await title(p)) === 'Bravo' && (await bar(p)).pos === '3 of 5', 'Next opens Bravo, the first stop of the next day');
const pin = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bravo"]').getBoundingClientRect(); const m = document.getElementById('map').getBoundingClientRect(); const pn = document.getElementById('panel'); const inset = pn.hidden ? 0 : pn.offsetWidth + 24; return { x: r.x + r.width / 2, mx: m.x + (m.width - inset) / 2, bottom: r.bottom, my: m.y + m.height / 2 }; });
ok(Math.abs(pin.x - pin.mx) < 14 && Math.abs(pin.bottom - 2 - pin.my) < 16, 'and the map moved to centre it: pin (' + Math.round(pin.x) + ',' + Math.round(pin.bottom) + ') map centre (' + Math.round(pin.mx) + ',' + Math.round(pin.my) + ')');
await goNext(p); await goNext(p);
s = await bar(p);
ok((await title(p)) === 'Delta' && s.pos === '5 of 5' && s.nextDisabled && !s.prevDisabled, 'at the last stop (Delta, which has no stop number) Next is disabled');
await p.click('.pop-seq-btn:has-text("Previous")'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Charlie', null, { timeout: 8000 }); await p.waitForTimeout(600);
ok((await bar(p)).pos === '4 of 5', 'Previous goes back to Charlie');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);
await openName(p, 'Hotel');
s = await bar(p);
ok(s.pos === '1 of 5' && s.prevDisabled && !s.nextDisabled, 'the hotel is the first stop: Previous is disabled (hotels are in the sequence)');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);

// who has no bar
for (const [name, why] of [['Undated', 'a marker in the trip with no date'], ['Loose', 'a marker in no trip'], ['Solo', 'the only dated marker of its trip']]) {
  await openName(p, name);
  ok((await bar(p)) === null, `no bar for ${why}`);
  await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);
}

// the form has none
await openName(p, 'Alpha');
await p.evaluate(() => document.querySelector('.leaflet-popup-content').scrollTo(0, 9999));
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(300);
ok((await bar(p)) === null, 'the edit form has no previous / next bar');
await p.click('.poi-pop form button:has-text("Cancel")'); await p.waitForTimeout(500);
ok((await bar(p)) !== null, 'and it is back when the form is closed');

// the window keeps its size
await p.click('.pop-toggle'); await p.waitForTimeout(400);
ok(!/is-expanded/.test(await p.evaluate(() => document.querySelector('.leaflet-popup').className)), 'collapsed...');
await goNext(p);
ok(!/is-expanded/.test(await p.evaluate(() => document.querySelector('.leaflet-popup').className)) && (await bar(p)) !== null, '... Next keeps it collapsed, and the bar is there');
await p.click('.pop-toggle'); await p.waitForTimeout(300);
await ctx.close();

// ================= a short screen: the bar stays in view while the window scrolls
({ ctx, p } = await session({ viewport: { width: 1000, height: 520 } }));
await openName(p, 'Alpha');
const vis = await p.evaluate(() => { const c = document.querySelector('.leaflet-popup-content'); const b = document.querySelector('.pop-seq').getBoundingClientRect(); const w = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect(); return { scrolls: c.scrollHeight > c.clientHeight + 1, inside: b.bottom <= w.bottom + 1 && b.top >= w.top }; });
ok(vis.scrolls && vis.inside, 'on a short screen the window scrolls and the bar stays inside it, not scrolled away');
await p.evaluate(() => document.querySelector('.leaflet-popup-content').scrollTo(0, 0)); await p.waitForTimeout(200);
ok(await p.locator('.pop-seq-btn:has-text("Next")').isVisible(), '... even scrolled to the top');
await ctx.close();

// ================= phone
({ ctx, p } = await session({ viewport: { width: 360, height: 740 }, mobile: true }));
await openName(p, 'Alpha');
const fit = await p.evaluate(() => { const w = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect(); const b = document.querySelector('.pop-seq').getBoundingClientRect(); return { l: b.left >= w.left - 1, r: b.right <= w.right + 1, vis: b.bottom <= innerHeight }; });
ok(fit.l && fit.r && fit.vis, 'phone: the bar fits inside the window and the screen');
await p.tap('.pop-seq-btn:has-text("Next")'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Bravo', null, { timeout: 8000 });
ok(true, 'phone: Next works by touch');
await p.screenshot({ path: `${SP}/stops-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
