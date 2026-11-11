// Marker window: expanded (tall, centred on the coordinate, covering the pin) or collapsed (short, above it), with a toggle that is remembered.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const note = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: a note about the spot.`).join('\n');
const seed = { v: 1, items: [
  { id: 'a', type: 'photo', name: 'Bridge', note, lat: 30.5928, lon: 114.3055, created: '2026-11-01T00:00:00.000Z' },
  { id: 'b', type: 'hotel', name: 'Lake', note: 'x', lat: 30.9, lon: 113.9, created: '2026-11-02T00:00:00.000Z' },
] };

const b = await chromium.launch({ channel: CHANNEL });
async function session(viewport, mobile = false, prefs = null) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([s, pr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr)); } }, [seed, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
  await p.waitForTimeout(300);
  return { ctx, p };
}
const pinXY = (p, name) => p.evaluate((n) => { const r = document.querySelector(`.poi-pin[title="${n}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name);
const openMarker = async (p, name) => {
  const pin = await pinXY(p, name);
  await p.mouse.click(pin.x, pin.y);
  await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 });
  await p.waitForTimeout(1300);
};
const geo = (p) => p.evaluate(() => {
  const w = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect();
  const pin = document.querySelector('.poi-pin[title="Bridge"]')?.getBoundingClientRect();
  const m = document.getElementById('map').getBoundingClientRect();
  const c = document.querySelector('.leaflet-popup-content');
  return { top: w.top, bottom: w.bottom, left: w.left, right: w.right, h: w.height, cx: (w.left + w.right) / 2, cy: (w.top + w.bottom) / 2, mapCx: m.x + m.width / 2, mapCy: m.y + m.height / 2, mapH: m.height,
    pin: pin ? { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2, top: pin.top } : null, scrolls: c.scrollHeight > c.clientHeight + 1,
    cls: document.querySelector('.leaflet-popup').className, tip: getComputedStyle(document.querySelector('.leaflet-popup-tip-container')).display,
    toggle: document.querySelector('.pop-toggle')?.getAttribute('aria-expanded'), label: document.querySelector('.pop-toggle')?.getAttribute('aria-label') };
});
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').windowExpanded);

// ================= desktop
let { ctx, p } = await session({ width: 1200, height: 800 });
await openMarker(p, 'Bridge');
let g = await geo(p);
ok(/is-expanded/.test(g.cls) && g.toggle === 'true' && g.label === 'Collapse window' && g.tip === 'none', 'on a desktop the marker window opens expanded: no pointer tip, a Collapse button');
ok(g.h > 350 && g.h <= g.mapH * 0.85 + 2, 'it is tall (' + Math.round(g.h) + ' px) but within 85% of the map (' + Math.round(g.mapH * 0.85) + ' px)');
ok(Math.abs(g.cx - g.mapCx) < 14 && Math.abs(g.cy - g.mapCy) < 24, 'it is centred on the coordinate: window centre (' + Math.round(g.cx) + ',' + Math.round(g.cy) + ') vs map centre (' + Math.round(g.mapCx) + ',' + Math.round(g.mapCy) + ')');
ok(g.top >= 0 && g.bottom <= g.mapH, 'and fully on screen');
ok(g.pin && g.pin.x > g.left && g.pin.x < g.right && g.pin.y > g.top && g.pin.y < g.bottom, 'it covers the pin');

// collapse
await p.click('.pop-toggle'); await p.waitForTimeout(500);
const small = await geo(p);
ok((await p.textContent('.poi-pop h3')) === 'Bridge' && !/is-expanded/.test(small.cls) && small.toggle === 'false' && small.label === 'Expand window', 'Collapse shrinks the same window in place (nothing reopens)');
ok(small.h < g.h && small.bottom <= small.pin.top + 2 && small.top >= 0, 'collapsed, it sits above the pin: ' + Math.round(small.h) + ' px high, bottom ' + Math.round(small.bottom) + ' above pin top ' + Math.round(small.pin.top));
ok((await saved(p)) === false, 'the choice is remembered');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);

// another marker opens collapsed now
await openMarker(p, 'Lake');
let lk = await p.evaluate(() => ({ cls: document.querySelector('.leaflet-popup').className, toggle: document.querySelector('.pop-toggle').getAttribute('aria-expanded') }));
ok(!/is-expanded/.test(lk.cls) && lk.toggle === 'false', 'the next marker opens collapsed, as chosen');
await p.click('.pop-toggle'); await p.waitForTimeout(500);
ok((await saved(p)) === true && /is-expanded/.test(await p.evaluate(() => document.querySelector('.leaflet-popup').className)), 'Expand grows it again and is remembered');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
await openMarker(p, 'Bridge');
ok(/is-expanded/.test((await geo(p)).cls), 'after a reload it still opens expanded');

// closing
await p.mouse.click(120, 700); await p.waitForTimeout(500);
ok((await p.locator('.leaflet-popup').count()) === 0, 'a click on blank map closes it');
await openMarker(p, 'Bridge');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(400);
ok((await p.locator('.leaflet-popup').count()) === 0, 'so does its close button');

// the Edit form keeps working in either size
await openMarker(p, 'Bridge');
await p.evaluate(() => document.querySelector('.leaflet-popup-content').scrollTo(0, 9999)); await p.waitForTimeout(200);
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(300);
g = await geo(p);
ok(g.top >= 0 && g.bottom <= g.mapH, 'the edit form fits on screen too');
await p.click('.poi-pop form button:has-text("Cancel")'); await p.waitForTimeout(400);
await ctx.close();

// ---- a short screen: expanded is capped and scrolls
({ ctx, p } = await session({ width: 1000, height: 520 }));
await openMarker(p, 'Bridge');
g = await geo(p);
ok(g.h <= g.mapH * 0.85 + 2 && g.scrolls && g.top >= 0 && g.bottom <= g.mapH, 'on a short screen (520 px) the expanded window is capped at 85% (' + Math.round(g.h) + ' px), scrolls inside and stays on screen');
await ctx.close();

// ================= phone
({ ctx, p } = await session({ width: 390, height: 780 }, true));
await openMarker(p, 'Bridge');
g = await geo(p);
ok(!/is-expanded/.test(g.cls) && g.toggle === 'false' && g.label === 'Expand window', 'on a phone the window opens collapsed');
ok(g.bottom <= g.pin.top + 2 && g.top >= 0, 'above the pin and on screen');
await p.tap('.pop-toggle'); await p.waitForTimeout(600);
g = await geo(p);
ok(/is-expanded/.test(g.cls) && g.h <= g.mapH * 0.6 + 2 && g.top >= 0 && g.bottom <= g.mapH, 'expanded on a phone it is capped at 60% of the screen (' + Math.round(g.h) + ' of ' + g.mapH + ' px)');
// the map can still be dragged from outside the window
const before = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bridge"]').getBoundingClientRect(); return { y: r.y }; });
const cdp = await ctx.newCDPSession(p);
const y0 = Math.min(g.mapH - 40, Math.round(g.bottom + 40));
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
await touch('touchStart', 40, y0); await touch('touchMove', 40, y0 - 30); await touch('touchMove', 40, y0 - 70); await touch('touchEnd'); await p.waitForTimeout(500);
const after = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bridge"]').getBoundingClientRect(); return { y: r.y }; });
ok(Math.abs(after.y - before.y) > 30, 'the map can still be dragged around the expanded window (pin moved ' + Math.round(before.y - after.y) + ' px)');
await p.screenshot({ path: `${SP}/window-phone.png` });
await ctx.close();

({ ctx, p } = await session({ width: 390, height: 780 }, true, { windowExpanded: true }));
await openMarker(p, 'Bridge');
ok(/is-expanded/.test((await geo(p)).cls), 'a phone visitor who chose expanded gets it');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
