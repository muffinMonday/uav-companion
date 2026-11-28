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
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile, hubeiView: true });
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
let ctx, p, g;

// ================= the adaptive host: a side panel on a desktop, a compact / expanded bottom sheet on a phone; the pin sits in the free part of the map
const hgeo = (p) => p.evaluate(() => {
  const h = document.getElementById('marker-host'), r = h.getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(), body = h.querySelector('.mh-body');
  const pin = document.querySelector('.poi-pin[title="Bridge"]')?.getBoundingClientRect();
  return { mode: h.dataset.mode, exp: h.dataset.expanded, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, mapH: m.height, mapTop: m.top, mapL: m.left,
    pin: pin ? { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2, top: pin.top } : null, scrolls: body.scrollHeight > body.clientHeight + 1 };
});
const hostShown = (p) => p.evaluate(() => { const e = document.getElementById('marker-host'); return !!e && !e.hidden; });
const hostSaved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').windowExpanded);

// ---- desktop: a side panel, fully on screen, the pin visible beside it
({ ctx, p } = await session({ width: 1200, height: 800 }));
await openMarker(p, 'Bridge');
g = await hgeo(p);
ok(g.mode === 'side' && g.top >= 0 && g.bottom <= g.mapH + g.mapTop, 'on a desktop the marker window is a side panel, fully on screen');
ok(g.h > 350 && g.h <= g.mapH + 2, 'it is tall (' + Math.round(g.h) + ' px) and within the map height (' + Math.round(g.mapH) + ' px)');
ok(g.pin && g.pin.x < g.left && g.pin.x > g.mapL && g.pin.y > g.mapTop && g.pin.y < g.mapTop + g.mapH, 'the pin is not covered: it sits in the free map area left of the panel (pin x ' + (g.pin && Math.round(g.pin.x)) + ', panel left ' + Math.round(g.left) + ')');
ok((await p.locator('#marker-host .pop-toggle').isHidden()) && (await p.locator('#marker-host .mh-handle').isHidden()), 'a side panel has no expand / collapse control');
await p.click('#marker-host .pop-close'); await p.waitForTimeout(400);
ok(!(await hostShown(p)), 'its close button closes it');
await openMarker(p, 'Bridge');
await p.mouse.click(120, 700); await p.waitForTimeout(500);
ok(!(await hostShown(p)), 'a click on blank map closes it');
await openMarker(p, 'Bridge');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok(!(await hostShown(p)), 'so does Escape');

// the Edit form keeps working
await openMarker(p, 'Bridge');
await p.evaluate(() => document.querySelector('#marker-host .mh-body').scrollTo(0, 9999)); await p.waitForTimeout(200);
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(300);
g = await hgeo(p);
ok(g.top >= 0 && g.bottom <= g.mapH + g.mapTop, 'the edit form fits on screen too');
await p.click('.poi-pop form button:has-text("Cancel")'); await p.waitForTimeout(400);
await ctx.close();

// ---- a short screen: the panel is capped to the screen, scrolls inside and stays on screen
({ ctx, p } = await session({ width: 1000, height: 520 }));
await openMarker(p, 'Bridge');
g = await hgeo(p);
ok(g.h <= g.mapH + 2 && g.scrolls && g.top >= 0 && g.bottom <= g.mapH + g.mapTop, 'on a short screen (520 px) the panel is capped to the screen (' + Math.round(g.h) + ' px), scrolls inside and stays on screen');
await ctx.close();

// ---- phone: a bottom sheet, compact first; the handle grows it to 60% of the map at most; the choice is remembered
({ ctx, p } = await session({ width: 390, height: 780 }, true));
await openMarker(p, 'Bridge');
g = await hgeo(p);
ok(g.mode === 'bottom' && g.exp === 'false', 'on a phone the window opens as a compact bottom sheet');
ok(g.pin && g.pin.y < g.top && g.top >= 0, 'the pin is above the sheet and on screen (pin y ' + (g.pin && Math.round(g.pin.y)) + ', sheet top ' + Math.round(g.top) + ')');
const compactH = g.h;
await p.tap('#marker-host .mh-handle'); await p.waitForTimeout(600);
g = await hgeo(p);
ok(g.exp === 'true' && g.h > compactH && g.h <= g.mapH * 0.6 + 2 && g.top >= 0 && g.bottom <= g.mapH + g.mapTop, 'expanded on a phone it is capped at 60% of the screen (' + Math.round(g.h) + ' of ' + g.mapH + ' px)');
ok((await hostSaved(p)) === true, 'the choice is remembered');
ok(g.pin && g.pin.y < g.top, 'the pin stays above the expanded sheet');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
await openMarker(p, 'Bridge');
ok((await hgeo(p)).exp === 'true', 'after a reload it still opens expanded');
g = await hgeo(p);
const before = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bridge"]').getBoundingClientRect(); return { y: r.y }; });
const cdp = await ctx.newCDPSession(p);
const y0 = Math.round(g.top * 0.6); // the map ends at the sheet: a point clear of the attribution line at its bottom edge
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const x0 = 220; // mid-map: the left edge now carries the map tool buttons, which would take the touch instead of the map
await touch('touchStart', x0, y0); await touch('touchMove', x0, y0 - 30); await touch('touchMove', x0, y0 - 70); await touch('touchEnd'); await p.waitForTimeout(500);
const after = await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bridge"]').getBoundingClientRect(); return { y: r.y }; });
ok(Math.abs(after.y - before.y) > 30, 'the map can still be dragged around the expanded sheet (pin moved ' + Math.round(before.y - after.y) + ' px)');
await p.screenshot({ path: SP + '/window-host-phone.png' });
await ctx.close();

({ ctx, p } = await session({ width: 390, height: 780 }, true, { windowExpanded: true, view: { lat: 30.6, lon: 114.3, zoom: 7 } }));
await openMarker(p, 'Bridge');
ok((await hgeo(p)).exp === 'true', 'a phone visitor who chose expanded gets it');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
