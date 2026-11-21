// Review 01 S4: the adaptive marker host behind the development switch. Switch off keeps the Leaflet popup; switch on shows the same content in a non-modal
// bottom sheet (little room) or side panel (room beside it): layouts, no scrim, focus, Escape, dialogs, resizing, and precedence with the Sessions explorer.
// Emulated only (Playwright viewports); no real foldable or phone. Needs the app on :5173 (a development server: the switch does not exist in a production build).
import { chromium, CHANNEL, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/marker-host`; fs.mkdirSync(SHOTS, { recursive: true });
const item = (id, name, lat, lon, extra) => ({ id, type: 'photo', name, note: 'A note.', lat, lon, created: '2026-11-01T00:00:00.000Z', ...extra });
const items = [item('a', 'Tower', 30.5, 114.3, { tripId: 't1', date: '2026-11-12', day: 1, order: 1 }), item('b', 'Bridge', 30.6, 114.4, { tripId: 't1', date: '2026-11-12', day: 1, order: 2 })];
const trips = [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }];
const b = await chromium.launch({ channel: CHANNEL });

async function session({ width, height = 800, host = true, panelOpen = false, target = items[0], touch = false }) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume();
  await ctx.addInitScript(([po, tr, v]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: v, basemap: 'osm' }));
  }, [items, trips, { lat: target.lat, lon: target.lon, zoom: 14 }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + (host ? '?markerhost=1' : ''), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const open = await p.evaluate(() => !document.getElementById('panel').hidden);
  if (open !== panelOpen) await p.click(open ? '#panel-close' : '#dock button >> nth=0');
  await p.waitForTimeout(300);
  s_ = { ctx, p }; return s_;
}
let s_;
const pinClick = async (p, name) => {
  const pin = await p.evaluate((n) => { const r = [...document.querySelectorAll('.poi-pin')].find((e) => e.getAttribute('title') === n && e.getBoundingClientRect().width > 0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name);
  await p.mouse.click(pin.x, pin.y); await p.waitForTimeout(1200);
};
const H = '#marker-host';
const box = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const mapBox = (p) => box(p, '#map');
const shown = (p) => p.evaluate(() => { const e = document.getElementById('marker-host'); return !!e && !e.hidden; });

// ---- 1. switch off: the popup, as before
{
  const { ctx, p } = await session({ width: 1200, host: false });
  await pinClick(p, 'Tower');
  ok(await p.locator('.leaflet-popup .poi-pop h3').count() === 1 && !(await shown(p)), 'switch off: the content is in the Leaflet popup and no marker host is shown');
  ok(await p.locator('#marker-host').count() === 0, 'switch off: the host element is never created');
  await ctx.close();
}

// ---- 2. folded phone: full-width bottom sheet
{
  const { ctx, p } = await session({ width: 360, height: 740, touch: true });
  await pinClick(p, 'Tower');
  ok(await shown(p) && await p.locator('.leaflet-popup').count() === 0, 'switch on: the host shows and there is no popup');
  ok(await p.getAttribute(H, 'data-mode') === 'bottom', 'folded phone (360): bottom sheet');
  const hb = await box(p, H), mb = await mapBox(p);
  ok(hb && Math.abs(hb.l) < 1 && Math.abs(hb.r - 360) < 1 && Math.abs(hb.b - 740) < 1, 'edge to edge at the bottom of the screen: ' + JSON.stringify(hb));
  ok(hb.h <= Math.floor(mb.h * 0.6) + 1 && hb.h >= 180, `compact sheet: ${hb.h}px, within the 60% limit of the ${mb.h}px map`);
  const noScrim = await p.evaluate(() => { const e = document.elementFromPoint(180, 40); return !!e && !e.closest('#marker-host') && !!e.closest('#map'); });
  ok(noScrim, 'no scrim: the map is reachable above the sheet');
  ok(await p.locator(`${H} h3`).count() === 1 && await p.locator(`${H} h3`).textContent() === 'Tower', 'the name appears once, as the heading');
  ok(await p.evaluate(() => document.activeElement?.tagName === 'H3' && document.getElementById('marker-host').getAttribute('aria-labelledby') === document.activeElement.id), 'focus is on the heading and names the region');
  ok(await p.evaluate(() => { const o = document.documentElement; return o.scrollWidth <= o.clientWidth + 1; }), 'no horizontal scroll');
  const attr = await p.evaluate(() => { const a = document.querySelector('.leaflet-bottom.leaflet-right'); return a ? parseFloat(getComputedStyle(a).marginBottom) : -1; });
  ok(attr >= hb.h, `the attribution and scale are lifted above the sheet (margin ${attr}px)`);
  // expand with the handle: taller, still within 60%, content still scrolls
  const before = hb.h;
  await p.click('.mh-handle'); await p.waitForTimeout(300);
  const hb2 = await box(p, H);
  ok(hb2.h > before && hb2.h <= Math.floor(mb.h * 0.6) + 1, `the handle expands the sheet: ${before} to ${hb2.h}px, never above 60% of the map`);
  ok(await p.getAttribute(H, 'data-expanded') === 'true', 'state is exposed as data-expanded');
  const hit = await p.evaluate(() => { const r = document.querySelector('.mh-handle').getBoundingClientRect(); return r.height; });
  ok(hit >= 44, `the handle is a 44 px touch target (${hit})`);
  const closeBox = await box(p, `${H} .pop-close`);
  ok(closeBox && closeBox.w >= 44 && closeBox.h >= 44, 'the close button is 44 px on touch');
  // viewport resize: the sheet follows
  await p.setViewportSize({ width: 360, height: 500 }); await p.waitForTimeout(400);
  const hb3 = await box(p, H), mb3 = await mapBox(p);
  ok(hb3 && Math.abs(hb3.b - 500) < 1 && hb3.h <= Math.floor(mb3.h * 0.6) + 1, `a smaller screen re-lays the sheet out (${hb3?.h}px of a ${mb3.h}px map)`);
  await p.screenshot({ path: `${SHOTS}/folded-360.png` });
  // Escape closes, focus goes back
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(!(await shown(p)), 'Escape closes the host');
  ok(await p.evaluate(() => document.body.dataset.mh === undefined), 'the map controls are released');
  await ctx.close();
}

// ---- 3. unfolded foldable and 640 (the room rule)
for (const [w, mode] of [[760, 'side'], [660, 'side'], [640, 'bottom']]) {
  const { ctx, p } = await session({ width: w, height: 800 });
  await pinClick(p, 'Tower');
  const m = await p.getAttribute(H, 'data-mode'), hb = await box(p, H);
  ok(m === mode, `${w} px wide: ${mode} (room rule), got ${m}`);
  if (mode === 'side') {
    const share = hb.w / w;
    ok(hb.w >= 340 && hb.w <= 480 && share >= 0.4 && share <= 0.6, `${w}: panel ${Math.round(hb.w)}px (${Math.round(share * 100)}% of the width, 340 to 480)`);
    ok(w - hb.w >= 320 - 1, `${w}: the map keeps at least 320 px beside the panel (${Math.round(w - hb.w)})`);
    ok(hb.t >= 0 && hb.b <= 800, `${w}: the panel stays inside the screen`);
  }
  if (w === 760) await p.screenshot({ path: `${SHOTS}/unfolded-760.png` });
  await ctx.close();
}

// ---- 4. desktop: capped panel; side panel handling
{
  const { ctx, p } = await session({ width: 1440, height: 900 });
  await pinClick(p, 'Tower');
  const hb = await box(p, H);
  ok(await p.getAttribute(H, 'data-mode') === 'side' && hb.w >= 420 && hb.w <= 480, `desktop 1440: side panel capped at 480 (${Math.round(hb.w)}px)`);
  const off = await p.evaluate(() => { const a = document.querySelector('.leaflet-bottom.leaflet-right'); return parseFloat(getComputedStyle(a).marginRight); });
  ok(off >= hb.w, `the attribution is moved left of the panel (margin ${off}px, panel ${Math.round(hb.w)}px)`);
  await p.screenshot({ path: `${SHOTS}/desktop-1440.png` });
  // a modal dialog takes Escape
  await p.evaluate(() => { const d = document.createElement('dialog'); d.id = 'probe'; d.textContent = 'probe'; document.body.append(d); d.showModal(); });
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(await shown(p) && await p.locator('#probe[open]').count() === 0, 'a modal dialog takes Escape first: the dialog closed, the host stayed');
  await p.evaluate(() => document.getElementById('probe')?.remove());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(!(await shown(p)), 'the next Escape closes the host');
  // close button
  await pinClick(p, 'Tower');
  await p.click(`${H} .pop-close`); await p.waitForTimeout(250);
  ok(!(await shown(p)), 'the close button closes the host');
  // switching to another marker reuses the host
  await pinClick(p, 'Tower'); await p.keyboard.press('Escape');
  await ctx.close();
}

// ---- 5. side panel open: it stays beside the marker panel while there is room, steps aside only when there is not
{
  const { ctx, p } = await session({ width: 1440, height: 900, panelOpen: true });
  ok(await p.evaluate(() => !document.getElementById('panel').hidden), 'precondition: the side panel is open');
  await pinClick(p, 'Tower');
  const hb = await box(p, H), pb = await box(p, '#panel');
  ok(pb && hb.r <= pb.l + 1, `wide screen: the side panel stays and the marker panel sits left of it (panel ${Math.round(pb?.l)}, host right edge ${Math.round(hb.r)})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  await p.setViewportSize({ width: 900, height: 800 }); await p.waitForTimeout(500);
  await pinClick(p, 'Tower');
  const hidden = await p.evaluate(() => document.getElementById('panel').hidden);
  ok(hidden, 'under the map minimum (900 px with both): the side panel steps aside');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !document.getElementById('panel').hidden), 'closing the marker panel brings the side panel back');
  await ctx.close();
}

// ---- 6. precedence with the Sessions explorer (the real explorer and host on a throwaway map in the page)
{
  const { ctx, p } = await session({ width: 1200, height: 800 });
  const res = await p.evaluate(async () => {
    const out = {};
    const L = (await import('/node_modules/.vite/deps/leaflet.js')).default;
    const { createExplorer } = await import('/src/sessions-map-explorer.js');
    const { createMarkerHost } = await import('/src/marker-host.js');
    const mapEl = document.createElement('div'); mapEl.style.cssText = 'position:fixed;inset:0;z-index:1'; document.body.append(mapEl);
    const map = L.map(mapEl).setView([30.5, 114.3], 12);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, title: 'Session ' + i, startsAt: '2026-11-20T01:00:00Z', endsAt: '2026-11-20T03:00:00Z', lat: 30.5 + i * 0.001, lng: 114.3, place: 'Park', capacity: 10, going: 1, host: 'x' }));
    const ex = createExplorer({ map, panel: { isOpen: () => false }, getItems: () => many, onDetails() {}, onExpand() {}, onClose() {} });
    const host = createMarkerHost({ map, panel: { isOpen: () => false }, build: () => { const d = document.createElement('div'); d.className = 'pop'; const h = document.createElement('h3'); h.textContent = 'Probe'; d.append(h); return d; }, getExpanded: () => false });
    ex.open({});
    await new Promise((r) => setTimeout(r, 400));
    const body = ex.el.querySelector('.ses-x-body'), list = ex.el.querySelector('.ses-x-list');
    ex.el.querySelector('.ses-xcard[data-id="s5"] .ses-xsel').click();
    await new Promise((r) => setTimeout(r, 500));
    body.scrollTop = 120; const scrolled = body.scrollTop;
    out.beforeSel = ex.selected(); out.scrolled = scrolled; out.cards = list.children.length;
    host.open('x');
    await new Promise((r) => setTimeout(r, 300));
    out.exHiddenWhileHost = ex.el.hidden; out.hostShown = !host.el.hidden; out.exStillOpen = ex.isOpen();
    out.oneAtATime = out.exHiddenWhileHost && out.hostShown;
    host.close(); await new Promise((r) => setTimeout(r, 300));
    out.backShown = !ex.el.hidden; out.afterSel = ex.selected(); out.afterScroll = body.scrollTop; out.cardsAfter = list.children.length;
    out.selectedCard = ex.el.querySelector('.ses-xcard[data-selected=true]')?.dataset.id ?? null;
    // opening the explorer again while the host is open closes the host
    host.open('y'); await new Promise((r) => setTimeout(r, 200));
    ex.open({}); await new Promise((r) => setTimeout(r, 200));
    out.hostClosedByExplorer = host.el.hidden && !host.isOpen();
    out.exVisibleAgain = !ex.el.hidden;
    // Escape while parked does not close the explorer
    host.open('z'); await new Promise((r) => setTimeout(r, 200));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    out.escClosedHostOnly = !host.isOpen() && ex.isOpen();
    return out;
  });
  ok(res.beforeSel === 's5' && res.scrolled > 0, `precondition: a card is selected (${res.beforeSel}) and the list is scrolled (${res.scrolled})`);
  ok(res.oneAtATime && res.exStillOpen, 'opening the marker panel parks the explorer: one contextual overlay visible, the explorer still open');
  ok(res.backShown && res.afterSel === 's5' && res.selectedCard === 's5', 'closing the marker panel brings the explorer back with the same selected session');
  ok(res.cardsAfter === res.cards && res.afterScroll === res.scrolled, `... and the same list and scroll position (${res.afterScroll} of ${res.scrolled})`);
  ok(res.hostClosedByExplorer && res.exVisibleAgain, 'opening the explorer closes an open marker panel');
  ok(res.escClosedHostOnly, 'Escape closes the marker panel and leaves the explorer open');
  await ctx.close();
}

// ---- 7. a point check (right-click) opens a popup: the marker panel gives way, as the marker popup did; the check itself is unchanged
{
  const { ctx, p } = await session({ width: 1200, height: 800 });
  await pinClick(p, 'Tower');
  ok(await shown(p), 'precondition: the marker panel is open');
  await p.mouse.click(150, 400, { button: 'right' }); await p.waitForTimeout(2500);
  ok(!(await shown(p)) && await p.locator('.leaflet-popup .pop.check').count() === 1, 'a point check closes the marker panel and shows its own popup');
  await ctx.close();
}

ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
await b.close();
