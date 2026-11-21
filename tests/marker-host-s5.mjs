// Review 01 S5: the marker host's recentring (free-area service), lifecycle, gestures, keyboard and motion. Development switch only (?markerhost=1).
// Emulated: Playwright viewports, CDP touch events, an overridden visualViewport for the on-screen keyboard. No real phone, foldable or keyboard.
import { chromium, CHANNEL, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/marker-host`; fs.mkdirSync(SHOTS, { recursive: true });
const item = (id, name, lat, lon, extra) => ({ id, type: 'photo', name, note: '', lat, lon, created: '2026-11-01T00:00:00.000Z', ...extra });
const items = [item('a', 'Tower', 30.5, 114.3, { tripId: 't1', date: '2026-11-12', day: 1, order: 1 }), item('b', 'Bridge', 30.503, 114.303, { tripId: 't1', date: '2026-11-12', day: 1, order: 2 })];
const trips = [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session({ width, height = 800, host = true, touch = false, panelOpen = false, motion = false, bearingTwist = 0 }) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume();
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api.open-meteo.com/**', (r) => r.abort());
  await ctx.addInitScript(([po, tr]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.5, lon: 114.3, zoom: 15 }, basemap: 'osm' }));
  }, [items, trips]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + (host ? '?markerhost=1' : ''), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const open = await p.evaluate(() => !document.getElementById('panel').hidden);
  if (open !== panelOpen) await p.click(open ? '#panel-close' : '#dock button >> nth=0');
  await p.waitForTimeout(300);
  const s = { ctx, p };
  if (touch) {
    s.cdp = await ctx.newCDPSession(p);
    s.send = (type, pts) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    s.swipe = async ([x0, y0], [x1, y1], steps = 10) => {
      await s.send('touchStart', [{ x: x0, y: y0, id: 1 }]);
      for (let i = 1; i <= steps; i++) { await s.send('touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id: 1 }]); await sleep(14); }
      await s.send('touchEnd', []); await sleep(350);
    };
  }
  if (bearingTwist) {
    const c = await p.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const pts = (a) => [0, 180].map((o, i) => ({ x: c.x + 80 * Math.cos(((a + o) * Math.PI) / 180), y: c.y + 80 * Math.sin(((a + o) * Math.PI) / 180), id: i + 1 }));
    await s.send('touchStart', pts(0));
    for (let i = 1; i <= 10; i++) { await s.send('touchMove', pts((bearingTwist * i) / 10)); await sleep(16); }
    await s.send('touchEnd', []); await sleep(400);
  }
  return s;
}
const H = '#marker-host';
const box = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const shown = (p) => p.evaluate(() => { const e = document.getElementById('marker-host'); return !!e && !e.hidden; });
const pinPos = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === n); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
const click = async (p, name) => { const q = await pinPos(p, name); await p.mouse.click(q.x, q.y); await p.waitForTimeout(1200); };
/** Centre of what the host and an open side panel leave of the map (from the DOM). */
const free = (p) => p.evaluate(() => {
  const m = document.getElementById('map').getBoundingClientRect(), h = document.getElementById('marker-host'), pn = document.getElementById('panel');
  const r = { l: m.left, t: m.top, r: m.right, b: m.bottom };
  if (h && !h.hidden) { const q = h.getBoundingClientRect(); if (h.dataset.mode === 'side') r.r = Math.min(r.r, q.left); else r.b = Math.min(r.b, q.top); }
  if (pn && !pn.hidden) { const q = pn.getBoundingClientRect(); if (q.height > 0.7 * (r.b - r.t)) r.r = Math.min(r.r, q.left); }
  return { cx: (r.l + r.r) / 2, cy: (r.t + r.b) / 2, w: r.r - r.l, h: r.b - r.t, l: r.l, t: r.t, r: r.r, b: r.b };
});
const off = async (p, name = 'Tower') => { const f = await free(p), q = await pinPos(p, name); return Math.hypot(q.x - f.cx, q.y - f.cy); };
const tileZoom = (p) => p.evaluate(() => { const t = document.querySelector('.leaflet-tile-pane img.leaflet-tile'); const m = t && /\/(\d+)\/\d+\/\d+/.exec(t.src); return m ? +m[1] : null; });
const mapGeo = (p) => p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view));

// ---------------------------------------------------------------- 1. recentring: phone, desktop, switch off
{
  const s = await session({ width: 360, height: 740, touch: true });
  const z0 = await tileZoom(s.p), before = await pinPos(s.p, 'Tower');
  await click(s.p, 'Tower');
  const o = await off(s.p), f = await free(s.p), z1 = await tileZoom(s.p);
  ok(o <= 40, `phone sheet: the pin sits at the middle of the map above the sheet (${Math.round(o)} px off; free ${Math.round(f.w)}x${Math.round(f.h)})`);
  ok(before.y > f.b - 10 || Math.abs(before.y - f.cy) > 60, `... it was under the sheet or far from the middle before (y ${Math.round(before.y)}, free middle ${Math.round(f.cy)})`);
  ok(z0 !== null && z0 === z1, `the zoom is kept (tile zoom ${z0} to ${z1})`);
  const q = await pinPos(s.p, 'Tower');
  ok(q.y < (await box(s.p, H)).t, 'the selected pin is visible above the sheet');
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  const o = await off(s.p), f = await free(s.p);
  ok(o <= 40 && f.w > 600, `desktop: the pin sits at the middle of the map left of the panel (${Math.round(o)} px off; free width ${Math.round(f.w)})`);
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900, panelOpen: true });
  await click(s.p, 'Tower');
  const o = await off(s.p);
  ok(o <= 40, `desktop with the side panel open: the pin sits at the middle of what both leave free (${Math.round(o)} px off)`);
  await s.ctx.close();
}
{
  const s = await session({ width: 1200, height: 800, host: false });
  await click(s.p, 'Tower');
  const q = await pinPos(s.p, 'Tower'), m = await box(s.p, '#map');
  ok(Math.abs(q.x - (m.l + m.w / 2)) <= 3, `switch off: the popup keeps view.js centring (the pin is at the horizontal middle of the map: ${Math.round(q.x)} of ${Math.round(m.l + m.w / 2)})`);
  await s.p.mouse.click(60, 600); await s.p.waitForTimeout(400);
  ok(await s.p.locator('.leaflet-popup').count() === 0, 'switch off: a map click still closes the popup');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 2. rotation
{
  const s = await session({ width: 390, height: 780, touch: true, bearingTwist: 90 });
  const bearing = await s.p.$eval('#map', (e) => parseFloat(e.style.getPropertyValue('--unrot')) || 0);
  ok(Math.abs(bearing) > 60, `the map is turned (${Math.round(bearing)} degrees)`);
  await click(s.p, 'Tower');
  const o = await off(s.p), f = await free(s.p);
  ok(o <= 50, `turned map: the pin still sits at the middle of the free area (${Math.round(o)} px off; the sheet covers ${Math.round(780 - f.b)} px)`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 3. manual panning is respected until the next explicit selection
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower');
  await s.swipe([260, 160], [200, 120]); // a drag on the map above the sheet, keeping the pin in view
  const moved = await pinPos(s.p, 'Tower'), f0 = await free(s.p);
  ok(Math.hypot(moved.x - f0.cx, moved.y - f0.cy) > 40, `the visitor panned the map by hand (the pin is now ${Math.round(Math.hypot(moved.x - f0.cx, moved.y - f0.cy))} px from the middle)`);
  await s.p.click('.mh-handle'); await s.p.waitForTimeout(500); // the sheet grows: that is not a selection
  const after = await pinPos(s.p, 'Tower');
  ok(Math.hypot(after.x - moved.x, after.y - moved.y) <= 3, `growing the sheet leaves a hand-panned map where it is (${Math.round(Math.hypot(after.x - moved.x, after.y - moved.y))} px)`);
  const q = await pinPos(s.p, 'Tower');
  await s.p.mouse.click(q.x, q.y); await s.p.waitForTimeout(1200);
  ok(await shown(s.p) && await off(s.p) <= 40, `tapping the pin again is an explicit selection: the pin is back at the middle (${Math.round(await off(s.p))} px)`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 4. gestures on the sheet
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower');
  const h0 = (await box(s.p, H)).h, pin0 = await pinPos(s.p, 'Tower'), hb = await box(s.p, '.mh-handle');
  const hx = hb.l + hb.w / 2, hy = hb.t + hb.h / 2;
  await s.swipe([hx, hy], [hx, hy - 20]); // too short: nothing happens
  const hS = (await box(s.p, H)).h, pinS = await pinPos(s.p, 'Tower');
  ok(hS === h0 && await s.p.getAttribute(H, 'data-expanded') === 'false' && Math.hypot(pinS.x - pin0.x, pinS.y - pin0.y) <= 2, 'a drag shorter than the threshold changes nothing, and does not pan the map');
  await s.swipe([hx, hy], [hx, hy - 90]);
  const h1 = (await box(s.p, H)).h;
  ok(await s.p.getAttribute(H, 'data-expanded') === 'true' && h1 > h0, `dragging the handle up expands the sheet (${h0} to ${h1} px)`);
  ok(await off(s.p) <= 45, `... and the pin is kept in the middle of the smaller free area (${Math.round(await off(s.p))} px off)`);
  const prefs = await s.p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).windowExpanded);
  ok(prefs === true, 'the size is remembered like the popup\'s expanded state');
  const hb2 = await box(s.p, '.mh-handle'), hy2 = hb2.t + hb2.h / 2;
  await s.swipe([hx, hy2], [hx, hy2 + 90]);
  ok(await s.p.getAttribute(H, 'data-expanded') === 'false' && (await box(s.p, H)).h === h0, 'dragging it down collapses the sheet');
  const hb3 = await box(s.p, '.mh-handle');
  await s.swipe([hx, hb3.t + hb3.h / 2], [hx, hb3.t + hb3.h / 2 + 100]);
  ok(!(await shown(s.p)), 'dragging down from the compact sheet closes it');
  // from the top bar of the content
  await click(s.p, 'Tower');
  const bar = await box(s.p, `${H} .pop-bar`);
  ok(!!bar, 'the content has its top bar');
  await s.swipe([bar.l + 60, bar.t + bar.h / 2], [bar.l + 60, bar.t + bar.h / 2 - 90]);
  ok(await s.p.getAttribute(H, 'data-expanded') === 'true', 'dragging the top bar up expands the sheet too');
  // keyboard alternative
  await s.p.focus('.mh-handle'); await s.p.keyboard.press('ArrowDown'); await s.p.waitForTimeout(300);
  ok(await s.p.getAttribute(H, 'data-expanded') === 'false', 'the handle is a button: ArrowDown collapses');
  await s.p.keyboard.press('ArrowUp'); await s.p.waitForTimeout(300);
  ok(await s.p.getAttribute(H, 'data-expanded') === 'true', '... ArrowUp expands');
  await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(300);
  ok(await s.p.getAttribute(H, 'data-expanded') === 'false', '... Enter toggles');
  // the existing horizontal swipe still dismisses, as it did for the popup
  const body = await box(s.p, `${H} .pop-head`);
  await s.swipe([body.l + 40, body.t + 20], [body.l + 300, body.t + 20]);
  ok(!(await shown(s.p)), 'a horizontal swipe on the content still closes the window');
  await s.ctx.close();
}
{
  const s = await session({ width: 760, height: 800, touch: true });
  await click(s.p, 'Tower');
  ok(await s.p.getAttribute(H, 'data-mode') === 'side' && await s.p.locator('.mh-handle').isHidden(), 'unfolded: a side panel, and no sheet handle');
  const body = await box(s.p, `${H} .pop-head`);
  await s.swipe([body.l + 40, body.t + 20], [body.l + 300, body.t + 20]);
  ok(!(await shown(s.p)), 'a swipe to the right closes the side panel');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 5. the on-screen keyboard (visualViewport) and motion
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower');
  const kb = await s.p.evaluate(async () => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { get: () => 400, configurable: true });
    vv.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    const r = document.getElementById('marker-host').getBoundingClientRect();
    const out = { bottom: r.bottom, h: r.height, top: r.top };
    delete vv.height; vv.dispatchEvent(new Event('resize'));
    await new Promise((r2) => setTimeout(r2, 300));
    const r2 = document.getElementById('marker-host').getBoundingClientRect();
    out.after = r2.bottom; return out;
  });
  ok(Math.abs(kb.bottom - 400) <= 1 && kb.h <= 400 - 16 && kb.top >= 0, `with a keyboard (visual viewport 400 of 740): the sheet sits above it and fits (bottom ${Math.round(kb.bottom)}, height ${Math.round(kb.h)})`);
  ok(Math.abs(kb.after - 740) <= 1, 'when the keyboard goes away the sheet returns to the bottom of the screen');
  await s.ctx.close();
}
{
  const a = await session({ width: 1200, height: 800, motion: true });
  await click(a.p, 'Tower');
  const an = await a.p.evaluate(() => getComputedStyle(document.getElementById('marker-host')).animationName);
  await a.ctx.close();
  const r = await session({ width: 1200, height: 800, motion: false });
  await click(r.p, 'Tower');
  const rn = await r.p.evaluate(() => getComputedStyle(document.getElementById('marker-host')).animationName);
  await r.ctx.close();
  ok(an === 'mh-in' && rn === 'none', `motion allowed: the host fades in (${an}); reduced motion: no animation (${rn})`);
}

// ---------------------------------------------------------------- 6. lifecycle
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  ok(await s.p.locator(`${H} h3`).textContent() === 'Tower', 'precondition: the host shows Tower');
  // marker replacement
  const q = await pinPos(s.p, 'Bridge');
  await s.p.mouse.click(q.x, q.y); await s.p.waitForTimeout(1000);
  ok(await s.p.locator('#marker-host').count() === 1 && await s.p.locator(`${H} h3`).textContent() === 'Bridge', 'tapping another marker replaces the content: still one host, now Bridge');
  // a map click closes it (as it closed the popup)
  await s.p.mouse.click(80, 700); await s.p.waitForTimeout(500);
  ok(!(await shown(s.p)), 'a click on the map closes the marker panel');
  // weather
  await click(s.p, 'Tower');
  const wx = s.p.locator(`${H} .wx-btn`);
  ok(await wx.count() === 1, 'the content has its weather button');
  await wx.click(); await s.p.waitForTimeout(600);
  ok(!(await shown(s.p)), 'the weather action closes the marker panel');
  // delete
  await s.p.keyboard.press('Escape');
  await click(s.p, 'Bridge');
  await s.p.locator(`${H} .pop-more`).click(); await s.p.waitForTimeout(100); // Delete is in the More menu since S6
  await s.p.locator(`${H} button.danger`).first().click(); await s.p.waitForTimeout(200); await s.p.locator(`${H} button.danger`).first().click(); await s.p.waitForTimeout(800); // the second press confirms
  ok(!(await shown(s.p)) && await s.p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.every((i) => i.name !== 'Bridge')), 'deleting the open marker closes the panel and removes it');
  // the point-check popup is untouched
  await s.p.mouse.click(150, 400, { button: 'right' }); await s.p.waitForTimeout(2200);
  ok(await s.p.locator('.leaflet-popup .pop.check').count() === 1, 'a point check still opens its own popup');
  await s.ctx.close();
}
{
  // keyboard: focus a pin, Enter opens, Escape closes and the focus goes back to that pin
  const s = await session({ width: 1200, height: 800 });
  await s.p.evaluate(() => [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === 'Tower').focus());
  await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(1000);
  ok(await shown(s.p) && await s.p.evaluate(() => document.activeElement?.tagName === 'H3'), 'Enter on a focused pin opens the panel with focus on the heading');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(!(await shown(s.p)) && await s.p.evaluate(() => document.activeElement?.classList.contains('poi-pin') && document.activeElement.getAttribute('title') === 'Tower'), 'Escape closes it and focus returns to the same pin');
  await s.ctx.close();
}

ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
await b.close();
