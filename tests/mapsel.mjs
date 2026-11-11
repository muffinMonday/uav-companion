// Selecting markers by tapping their pins on the map: shared with the list, numbered, exclusive with placing/editing, phone banner.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('a', 'Alpha', 30.60, 114.30, { date: '2026-11-12', order: 1 }),
  mk('b', 'Bravo', 30.62, 114.34, { date: '2026-11-12', order: 2 }),
  mk('c', 'Charlie', 30.58, 114.36, { date: '2026-11-13', order: 1, type: 'hotel' }),
  mk('d1', 'Delta first', 30.64, 114.28, { date: '2026-11-12' }),
  mk('d2', 'Delta second', 30.64, 114.28, { date: '2026-11-14' }),
];
const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((po) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.61, lon: 114.31, zoom: 11 }, basemap: 'osm' })); } }, items);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const pin = (p, name) => p.locator(`.leaflet-marker-icon[title="${name}"]`).first();
const state = (p) => p.evaluate(() => ({
  ring: [...document.querySelectorAll('.poi-pin.sel-pin')].map((e) => e.getAttribute('title')).sort(),
  nums: Object.fromEntries([...document.querySelectorAll('.poi-pin.sel-pin[data-n]')].map((e) => [e.getAttribute('title'), e.dataset.n])),
  dim: [...document.querySelectorAll('.poi-pin.sel-dim')].map((e) => e.getAttribute('title')).sort(),
  ticked: [...document.querySelectorAll('#poi-list .sel-box:checked')].map((c) => c.getAttribute('aria-label').replace('Select ', '')).sort(),
  banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner-text').textContent,
  popup: !!document.querySelector('.leaflet-popup'),
}));

let { ctx, p } = await open({ width: 1300, height: 850 }, false);
await p.click('#poi-select'); await p.waitForTimeout(300);
let s = await state(p);
ok(/Tap pins/.test(s.banner), 'selecting shows a banner: "' + s.banner + '"');
await pin(p, 'Alpha').click(); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.join() === 'Alpha' && s.ring.join() === 'Alpha' && !s.popup && Object.keys(s.nums).length === 0, 'tapping a pin ticks it (list and pin), opens no window, and a single pin has a ring but no number');
await pin(p, 'Bravo').click(); await p.waitForTimeout(200);
await pin(p, 'Charlie').click(); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.join() === 'Alpha,Bravo,Charlie' && s.nums.Alpha === '1' && s.nums.Bravo === '2' && s.nums.Charlie === '3', 'three ticked: the pins carry their route numbers 1, 2, 3: ' + JSON.stringify(s.nums));
ok(await p.isVisible('#route-box') && (await p.$$eval('#route-stops .route-name', (e) => e.map((x) => x.textContent))).join() === 'Alpha,Bravo,Charlie', 'the route block in the list has the same order');
await p.click('#route-reverse'); await p.waitForTimeout(200);
s = await state(p);
ok(s.nums.Charlie === '1' && s.nums.Alpha === '3', 'reversing the route renumbers the pins');
await pin(p, 'Bravo').click(); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.join() === 'Alpha,Charlie' && !s.ring.includes('Bravo') && s.nums.Charlie === '1' && s.nums.Alpha === '2', 'tapping a ticked pin unticks it and the numbers close up');
await p.locator('#poi-list li.selecting', { hasText: 'Bravo' }).click(); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.join() === 'Alpha,Bravo,Charlie' && s.ring.includes('Bravo'), 'ticking in the list rings the pin (one shared selection)');

// stacked visits: the top pin only
await p.click('#sel-none'); await p.waitForTimeout(200);
const top = await p.evaluate(() => {
  const pins = [...document.querySelectorAll('.poi-pin')].filter((e) => /Delta/.test(e.getAttribute('title')));
  const r = pins[0].getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { n: pins.length, x: r.x + r.width / 2, y: r.y + r.height / 2, hit: hit?.closest('.poi-pin')?.getAttribute('title') };
});
await p.mouse.click(top.x, top.y); await p.waitForTimeout(200);
s = await state(p);
ok(top.n === 2 && s.ticked.length === 1 && s.ticked[0] === top.hit, 'stacked visits: a tap ticks only the top pin (' + top.hit + ', ticked ' + s.ticked.join() + ')');

// the list filter hides a type: its pin is dimmed and ignored
await p.click('#sel-none'); await p.waitForTimeout(200);
await p.locator('#poi-filter .chip', { hasText: 'Hotel' }).click(); await p.waitForTimeout(300);
s = await state(p);
ok(s.dim.includes('Alpha') && !s.dim.includes('Charlie'), 'with the Hotel filter on, pins it hides are dimmed: ' + s.dim.join());
await pin(p, 'Alpha').click({ force: true }); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.length === 0, 'and a tap on a dimmed pin does nothing');
await pin(p, 'Charlie').click(); await p.waitForTimeout(200);
s = await state(p);
ok(s.ticked.join() === 'Charlie', 'the visible one can be ticked');
await p.locator('#poi-filter .chip', { hasText: 'All' }).click(); await p.waitForTimeout(300);

// exclusive with placing and editing
await p.click('#poi-edit', { force: true }); await p.waitForTimeout(300);
s = await state(p);
ok(/Edit mode/.test(s.banner) && s.ticked.length === 0 && s.ring.length === 0, 'turning on Edit mode ends selecting');
await p.click('#poi-edit', { force: true }); await p.waitForTimeout(200);
await p.click('#poi-select'); await p.waitForTimeout(200);
await pin(p, 'Alpha').click(); await p.waitForTimeout(200);
await p.click('#banner-action'); await p.waitForTimeout(300);
s = await state(p);
ok(s.banner === '' && s.ring.length === 0 && s.dim.length === 0, 'Done in the banner ends selecting and clears the rings');
await pin(p, 'Alpha').click(); await p.waitForSelector('.poi-pop h3', { timeout: 5000 });
ok((await p.textContent('.poi-pop h3')) === 'Alpha', 'afterwards a tap on a pin opens its window again');
await p.keyboard.press('Escape');
await p.click('#poi-select'); await p.waitForTimeout(200);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok((await state(p)).banner === '', 'Escape ends selecting too');
await ctx.close();

// phone: the sheet gets out of the way, the banner brings it back
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await p.tap('#poi-select'); await p.waitForTimeout(400);
ok(await p.evaluate(() => document.getElementById('panel').hidden), 'on a phone the list closes so the map can be tapped');
ok((await p.isVisible('#banner-review')) && (await p.isVisible('#banner-action')), 'the banner offers Review and Done');
await pin(p, 'Alpha').tap(); await p.waitForTimeout(250);
await pin(p, 'Bravo').tap(); await p.waitForTimeout(250);
s = await state(p);
ok(/2 markers selected/.test(s.banner) && s.nums.Alpha === '1' && s.nums.Bravo === '2', 'the banner counts them and the pins are numbered: ' + s.banner);
await p.tap('#banner-review'); await p.waitForTimeout(400);
ok(await p.evaluate(() => !document.getElementById('panel').hidden), 'Review opens the list');
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
