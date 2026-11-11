// Press and hold to check a spot, plain clicks only close windows, and the clicked coordinate is centred (with a scrolling window if it is tall).
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const HOLD = 2300; // a little over the 2 s hold

const longNote = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long note about the spot.`).join('\n').slice(0, 480);
const seed = { v: 1, items: [
  { id: 'a', type: 'photo', name: 'Bridge', note: longNote, lat: 30.5928, lon: 114.3055, created: '2026-11-01T00:00:00.000Z' },
  { id: 'b', type: 'hotel', name: 'Short', note: 'ok', lat: 30.9, lon: 113.9, created: '2026-11-02T00:00:00.000Z' },
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
const popups = (p) => p.locator('.leaflet-popup').count();
const markerPopups = (p) => p.locator('.poi-pop').count();
const mapRect = (p) => p.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const pinRect = (p, name = 'Bridge') => p.evaluate((k) => { const r = document.querySelector(`.poi-pin[title="${k}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom, top: r.top }; }, name);
const tipRect = (p) => p.evaluate(() => { const r = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { cx: r.x + r.width / 2, bottom: r.bottom, top: r.top, h: r.height }; });
const hold = async (p, x, y, ms = HOLD) => { await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); await p.waitForTimeout(500); };
const toastText = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });
const BLANK = { x: 300, y: 600 }; // blank map on desktop (no pins there)

// ================= desktop
let { ctx, p } = await session({ width: 1200, height: 800 });

// ---- a quick click
await p.mouse.click(BLANK.x, BLANK.y); await p.waitForTimeout(600);
ok((await popups(p)) === 0, 'a quick click on blank map opens nothing');
ok(/press and hold/i.test(await toastText(p)), 'the first one says how to check a spot: "' + (await toastText(p)) + '"');
await p.evaluate(() => { document.getElementById('toast').hidden = true; });
await p.mouse.click(BLANK.x + 40, BLANK.y); await p.waitForTimeout(500);
ok(!(await toastText(p)), 'the hint is shown only once');
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).holdHint)) === true, '... and remembered');

// ---- hold fires
await p.mouse.move(BLANK.x, BLANK.y); await p.mouse.down(); await p.waitForTimeout(700);
ok((await p.locator('.hold-ring').count()) === 1, 'while holding, a ring shows at the press point');
const ringAt = await p.evaluate(() => { const r = document.querySelector('.hold-ring').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
ok(Math.abs(ringAt.x - BLANK.x) < 3 && Math.abs(ringAt.y - BLANK.y) < 3, 'the ring is centred on the pointer');
await p.waitForTimeout(900);
ok((await popups(p)) === 0, 'after 1.6 s nothing has happened yet');
await p.waitForTimeout(HOLD - 1600);
ok((await popups(p)) === 1 && (await markerPopups(p)) === 0, 'after 2 s the point check opens');
ok((await p.locator('.hold-ring').count()) === 0, 'the ring is gone');
await p.mouse.up(); await p.waitForTimeout(500);
ok((await popups(p)) === 1, 'letting go does not close the new window (the release is not a click)');
const mr = await mapRect(p);
let t = await tipRect(p);
ok(Math.abs(t.cx - (mr.x + mr.w / 2)) < 14 && Math.abs(t.bottom + 20 - (mr.y + mr.h / 2)) < 8, 'the held spot is centred on the map: window tip at (' + Math.round(t.cx) + ',' + Math.round(t.bottom + 20) + ') vs centre (' + Math.round(mr.x + mr.w / 2) + ',' + Math.round(mr.y + mr.h / 2) + ')');
ok(t.top >= 0, 'the window is fully on screen');
await p.mouse.click(BLANK.x + 200, BLANK.y + 100); await p.waitForTimeout(500);
ok((await popups(p)) === 0, 'a quick click on blank map closes the open window');

// ---- cancelled holds
await p.mouse.move(BLANK.x, BLANK.y); await p.mouse.down(); await p.waitForTimeout(500);
await p.mouse.move(BLANK.x + 30, BLANK.y + 10, { steps: 5 }); await p.waitForTimeout(HOLD); await p.mouse.up(); await p.waitForTimeout(400);
ok((await popups(p)) === 0 && (await p.locator('.hold-ring').count()) === 0, 'moving during a hold cancels it (that was a drag)');
await hold(p, BLANK.x, BLANK.y, 1000);
ok((await popups(p)) === 0 && (await p.locator('.hold-ring').count()) === 0, 'letting go after 1 s does nothing');
const pr0 = await pinRect(p);
await hold(p, pr0.x, pr0.y);
ok((await p.locator('.leaflet-popup .check').count()) === 0 && (await p.locator('.hold-ring').count()) === 0, 'holding on a pin does not start a point check');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);

// ---- right click and Enter
await p.mouse.click(BLANK.x, BLANK.y, { button: 'right' }); await p.waitForTimeout(600);
ok((await popups(p)) === 1 && (await markerPopups(p)) === 0, 'a right-click checks the spot at once');
await p.mouse.click(BLANK.x + 300, BLANK.y, { button: 'left' }); await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('map').focus());
await p.keyboard.press('Enter'); await p.waitForTimeout(700);
t = await tipRect(p);
ok((await popups(p)) === 1 && Math.abs(t.cx - (mr.x + mr.w / 2)) < 14, 'Enter on the focused map checks its centre');
await p.mouse.click(BLANK.x + 300, BLANK.y); await p.waitForTimeout(400);

// ---- a marker click centres the marker; a tall window scrolls
const far = await pinRect(p);
await p.mouse.click(far.x, far.y); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1200);
const pinNow = await pinRect(p);
ok(Math.abs(pinNow.x - (mr.x + mr.w / 2)) < 14 && Math.abs(pinNow.bottom - 2 - (mr.y + mr.h / 2)) < 50, 'clicking a pin centres the map on it: pin at (' + Math.round(pinNow.x) + ',' + Math.round(pinNow.y) + '), map centre (' + Math.round(mr.x + mr.w / 2) + ',' + Math.round(mr.y + mr.h / 2) + ')');
await p.click('.poi-pop .pop-toggle'); await p.waitForTimeout(400); // collapsed: the short window above the pin
const sc = await p.evaluate(() => { const c = document.querySelector('.leaflet-popup-content'); const w = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect(); const pin = document.querySelector('.poi-pin').getBoundingClientRect(); return { scrolls: c.scrollHeight > c.clientHeight + 1, top: w.top, bottom: w.bottom, pinTop: pin.top }; });
ok(sc.scrolls && sc.top >= 0 && sc.bottom <= sc.pinTop + 2, 'a window too tall for the space above the pin scrolls inside and stays on screen (top ' + Math.round(sc.top) + ', bottom ' + Math.round(sc.bottom) + ', pin top ' + Math.round(sc.pinTop) + ')');
const zoomBefore = await p.evaluate(() => document.querySelector('.leaflet-control-scale-line').textContent);
await p.evaluate(() => document.querySelector('.leaflet-popup-content').scrollTo(0, 9999)); await p.waitForTimeout(200);
ok((await p.locator('.poi-pop .acts').isVisible()), 'scrolling the window reaches its Edit and Delete buttons');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(400);
const pinB = await pinRect(p, 'Short').catch(() => null);
if (pinB && pinB.x > 0 && pinB.x < 1200 && pinB.y > 0 && pinB.y < 800) {
  await p.mouse.click(pinB.x, pinB.y); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Short', null, { timeout: 8000 }); await p.waitForTimeout(1000);
  const pb = await pinRect(p, 'Short');
  ok(Math.abs(pb.x - (mr.x + mr.w / 2)) < 14, 'a second pin is centred the same way');
}
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);

// ---- with the side panel open, centred in the visible part of the map
await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]').click()); await p.waitForTimeout(400);
await p.click('#poi-list .poi-item:has-text("Bridge")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1500);
const side = await p.evaluate(() => ({ panelW: document.getElementById('panel').offsetWidth + 24, w: document.getElementById('map').clientWidth }));
const pin3 = await pinRect(p);
ok(Math.abs(pin3.x - (side.w - side.panelW) / 2) < 16, 'with the side panel open the pin is centred in the uncovered part of the map: x ' + Math.round(pin3.x) + ' vs ' + Math.round((side.w - side.panelW) / 2));
await ctx.close();

// ================= place mode: a click places, a hold does not check
({ ctx, p } = await session({ width: 1200, height: 800 }));
await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]').click()); await p.waitForTimeout(400);
await p.click('#poi-place'); await p.waitForTimeout(300);
await p.mouse.move(BLANK.x + 500, BLANK.y); await p.mouse.down(); await p.waitForTimeout(HOLD); await p.mouse.up(); await p.waitForTimeout(500);
ok((await p.locator('.hold-ring').count()) === 0 && (await p.locator('.leaflet-popup .check').count()) === 0, 'while placing a marker, holding does not start a point check');
await ctx.close();

// ================= phone (touch)
({ ctx, p } = await session({ width: 390, height: 780 }, true));
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const m2 = await mapRect(p);
await touch('touchStart', 200, 600); await p.waitForTimeout(400); await touch('touchEnd'); await p.waitForTimeout(500);
ok((await popups(p)) === 0, 'phone: a quick tap on blank map opens nothing');
await touch('touchStart', 200, 600); await p.waitForTimeout(700);
ok((await p.locator('.hold-ring').count()) === 1, 'phone: a ring shows while holding');
await p.waitForTimeout(HOLD - 700); await touch('touchEnd'); await p.waitForTimeout(700);
t = await tipRect(p).catch(() => null);
ok(t && (await popups(p)) === 1 && Math.abs(t.cx - (m2.x + m2.w / 2)) < 16, 'phone: holding 2 s checks the spot and centres it');
ok(t && t.top >= 0 && t.bottom <= m2.y + m2.h / 2 + 14, 'phone: the window sits above the centred spot, fully on screen');
await touch('touchStart', 100, 700); await touch('touchEnd'); await p.waitForTimeout(600);
ok((await popups(p)) === 0, 'phone: a tap on blank map closes the window');
await touch('touchStart', 200, 600); await p.waitForTimeout(500);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 640, id: 1 }] });
await p.waitForTimeout(HOLD); await touch('touchEnd'); await p.waitForTimeout(500);
ok((await popups(p)) === 0, 'phone: moving the finger cancels the hold');
// marker tap with the sheet open: it closes and the pin is centred
await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]').click()); await p.waitForTimeout(400);
await p.click('#poi-list .poi-item:has-text("Bridge")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1500);
const ph = await p.evaluate(() => { const pin = document.querySelector('.poi-pin').getBoundingClientRect(); const w = document.querySelector('.leaflet-popup').getBoundingClientRect(); return { px: pin.x + pin.width / 2, py: pin.y + pin.height / 2, top: w.top, bottom: w.bottom, pinTop: pin.top, panelHidden: document.getElementById('panel').hidden }; });
ok(ph.panelHidden && Math.abs(ph.px - (m2.x + m2.w / 2)) < 16 && ph.top >= 0 && ph.bottom <= ph.pinTop + 2, 'phone: opening a marker closes the sheet, centres the pin and keeps the window on screen');
await p.screenshot({ path: `${SP}/hold-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
