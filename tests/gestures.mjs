// Unified touch gestures (Phase A and B): top-right cluster, search, More tools sheet, route summary and the phone panel's expand handle.
// Own Vite servers (flag on / off) so it does not need :5173. Touch is real touch events through the browser protocol (tests/swipe.mjs does the same).
// Emulated only (Playwright): no real phone, foldable or tablet is exercised.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, ROOT } from './lib.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');
const errs = [];
function startVite(port, flag) {
  const env = { ...process.env }; delete env.VITE_NEW_SHELL; if (flag) env.VITE_NEW_SHELL = '1';
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    child.stdout.on('data', (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.stderr.on('data', (d) => { if (/EADDRINUSE/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}
const on = await startVite(5204, true), off = await startVite(5205, false);
const b = await chromium.launch({ channel: CHANNEL, headless: true });

async function open(url, { vp = { width: 390, height: 780 }, reduced = true, touch = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' })); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]/.test(m.text()) && errs.push(m.text()));
  await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(p);
  const touchEv = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
  const swipe = async ([x0, y0], [x1, y1], { steps = 8, ms = 12, cancel = false } = {}) => {
    await touchEv('touchStart', x0, y0);
    for (let i = 1; i <= steps; i++) { await touchEv('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await p.waitForTimeout(ms); }
    await touchEv(cancel ? 'touchCancel' : 'touchEnd'); await p.waitForTimeout(reduced ? 150 : 450);
  };
  return { ctx, p, swipe };
}
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }; });
const attr = (p, sel, a) => p.getAttribute(sel, a);
const noOffset = (p, sel) => p.$eval(sel, (e) => e.style.transform === '' && e.style.translate === '' && e.style.opacity === '');
const collapsed = (p) => p.evaluate(() => document.getElementById('search').classList.contains('collapsed'));

try {
  // ================= top-right cluster (new shell, phone)
  for (const reduced of [true, false]) {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5204/', { reduced });
    const T = '#shell-topbar', tag = reduced ? '' : ' (animation on)';
    ok(await attr(p, T, 'data-collapsed') === 'false', 'cluster starts expanded' + tag);
    let r = await rect(p, T);
    await swipe([r.l + 10, r.cy], [r.l - 40, r.cy]);
    ok(await attr(p, T, 'data-collapsed') === 'false', 'a swipe left while expanded does nothing' + tag);
    r = await rect(p, T);
    await swipe([r.l + 20, r.cy], [r.l + 60, r.cy]);
    ok(await attr(p, T, 'data-collapsed') === 'true', 'a swipe right folds the cluster into the arrow icon' + tag);
    ok(await p.getAttribute('.shell-topbar-toggle', 'aria-expanded') === 'false' && await noOffset(p, T), 'the toggle state matches the button path and no offset is left behind' + tag);
    r = await rect(p, T);
    await swipe([r.cx, r.cy], [r.cx - 60, r.cy]);
    ok(await attr(p, T, 'data-collapsed') === 'false', 'a swipe left unfolds it again' + tag);
    r = await rect(p, T);
    await swipe([r.l + 40, r.cy], [r.l + 70, r.cy + 4], { cancel: true });
    ok(await attr(p, T, 'data-collapsed') === 'false' && await noOffset(p, T), 'a cancelled touch snaps back without folding' + tag);
    await swipe([r.l + 40, r.cy], [r.l + 44, r.cy + 90]);
    ok(await attr(p, T, 'data-collapsed') === 'false', 'a vertical swipe is left alone' + tag);
    await p.locator('.shell-topbar-toggle').tap(); await p.waitForTimeout(100);
    ok(await attr(p, T, 'data-collapsed') === 'true', 'the arrow button still folds' + tag);
    await p.locator('.shell-topbar-toggle').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    ok(await attr(p, T, 'data-collapsed') === 'false', 'and the keyboard still unfolds' + tag);
    await ctx.close();
  }

  // ================= search: full-screen in the new shell (down), compact box without it (left)
  {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5204/');
    await p.locator('#search-toggle').tap(); await p.waitForTimeout(300);
    ok(!(await collapsed(p)), 'new shell: search opens full-screen');
    const c = await rect(p, '#search-close');
    await swipe([c.cx - 4, c.cy], [c.cx - 4, c.cy + 160]);
    ok(await collapsed(p), 'new shell: swiping down from the header collapses it');
    await p.locator('#search-toggle').tap(); await p.waitForTimeout(300);
    const q = await rect(p, '#q');
    await swipe([q.cx, q.cy], [q.cx, q.cy + 160]);
    ok(!(await collapsed(p)), 'new shell: a swipe that starts in the input does not collapse it (text editing is untouched)');
    await p.fill('#q', '30.59, 114.30'); await p.waitForTimeout(250);
    const res = await rect(p, '#results');
    await swipe([res.cx, res.t + 10], [res.cx, res.t + 170]);
    ok(!(await collapsed(p)), 'new shell: a swipe in the results list does not collapse it');
    await p.focus('#q'); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(await collapsed(p), 'new shell: Escape still collapses it');
    await ctx.close();
  }
  {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5205/', { vp: { width: 800, height: 700 } });
    await p.locator('#search-toggle').tap(); await p.waitForTimeout(300);
    ok(!(await collapsed(p)), 'compact: search opens');
    const bx = await rect(p, '#search-toggle');
    await swipe([bx.cx, bx.cy], [bx.cx + 80, bx.cy]);
    ok(!(await collapsed(p)), 'compact: a swipe right does nothing');
    await swipe([bx.cx + 4, bx.cy], [bx.cx - 60, bx.cy]);
    ok(await collapsed(p), 'compact: a swipe left on the magnifier collapses it');
    await p.locator('#search-toggle').tap(); await p.waitForTimeout(250);
    const q = await rect(p, '#q');
    await swipe([q.cx + 20, q.cy], [q.cx - 100, q.cy]);
    ok(!(await collapsed(p)), 'compact: a swipe in the input is ignored');
    await ctx.close();
  }

  // ================= More tools: phone sheet dismisses downward; the desktop popover has no gesture
  for (const [url, label] of [['http://127.0.0.1:5205/', 'default shell'], ['http://127.0.0.1:5204/', 'new shell']]) {
    const { ctx, p, swipe } = await open(url);
    const openMenu = async () => { await p.locator('.more-btn').tap(); await p.waitForSelector('#more-tools-menu:not([hidden])'); await p.waitForTimeout(250); };
    await openMenu();
    ok(await p.evaluate(() => document.getElementById('more-tools-menu').classList.contains('sheet')), label + ': More tools is a bottom sheet on a phone');
    const h = await rect(p, '#more-tools-menu .more-head');
    await swipe([h.cx - 40, h.cy], [h.cx - 40, h.cy - 120]);
    ok(await p.locator('#more-tools-menu').isVisible(), label + ': a swipe up does nothing');
    await swipe([h.cx - 40, h.cy], [h.cx - 40, h.cy + 20]);
    ok(await p.locator('#more-tools-menu').isVisible() && await noOffset(p, '#more-tools-menu'), label + ': a short swipe snaps back');
    await swipe([h.cx - 40, h.cy], [h.cx - 40, h.cy + 150]);
    ok(await p.locator('#more-tools-menu').isHidden() && await attr(p, '.more-btn', 'aria-expanded') === 'false', label + ': a swipe down from the header dismisses it and resets the button state');
    await openMenu();
    const row = await rect(p, '#more-tools-menu .more-row');
    await swipe([row.cx, row.cy], [row.cx, row.cy + 150]);
    ok(await p.locator('#more-tools-menu').isHidden(), label + ': a swipe down on the list (at its top) dismisses it too');
    await openMenu();
    await p.locator('.more-close').tap(); await p.waitForTimeout(150);
    ok(await p.locator('#more-tools-menu').isHidden(), label + ': the x button still closes');
    await openMenu(); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(await p.locator('#more-tools-menu').isHidden(), label + ': Escape still closes');
    await ctx.close();
  }
  {
    const { ctx, p } = await open('http://127.0.0.1:5205/', { vp: { width: 1100, height: 700 }, touch: false });
    await p.locator('.more-btn').click(); await p.waitForSelector('#more-tools-menu:not([hidden])');
    ok(!(await p.evaluate(() => document.getElementById('more-tools-menu').classList.contains('sheet'))), 'desktop: More tools stays a popover');
    await ctx.close();
  }

  // ================= route summary (new shell module, driven with a stub poi)
  for (const reduced of [true, false]) {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5204/', { reduced });
    await p.evaluate(async () => {
      const { initRouteSummaryUI } = await import('/src/shell/route-summary.js');
      const summary = { legs: Array.from({ length: 12 }, (_, i) => ({ from: 'A' + i, to: 'B' + i, state: 'road', distanceM: 1000 + i, durationS: 600, pending: false })), totalM: 12000, allRoad: true, anyRoad: true, anyPending: false };
      window.__rs = initRouteSummaryUI({ poi: { routeSummary: () => summary, onRouteSummaryChange: () => () => {} } });
    });
    const R = '.route-summary:not([hidden])', tag = reduced ? '' : ' (animation on)';
    ok(await attr(p, R, 'data-open') === 'false', 'route summary starts compact' + tag);
    let s = await rect(p, R + ' .route-summary-status');
    await swipe([s.cx, s.cy], [s.cx, s.cy + 80]);
    ok(await attr(p, R, 'data-open') === 'false', 'a swipe down while compact does nothing' + tag);
    await swipe([s.cx, s.cy], [s.cx, s.cy - 70]);
    ok(await attr(p, R, 'data-open') === 'true' && await p.getAttribute(R + ' .route-summary-status', 'aria-expanded') === 'true', 'a swipe up on the chip expands it (aria-expanded in step)' + tag);
    s = await rect(p, R + ' .route-summary-status');
    await swipe([s.cx, s.cy], [s.cx, s.cy - 70]);
    ok(await attr(p, R, 'data-open') === 'true', 'a swipe up while expanded does nothing' + tag);
    await p.$eval(R + ' .route-summary-detail', (e) => { e.scrollTop = 60; });
    await p.waitForTimeout(100);
    const d = await rect(p, R + ' .route-summary-detail');
    const scrollable = await p.$eval(R + ' .route-summary-detail', (e) => e.scrollTop > 0);
    await swipe([d.cx, d.t + 40], [d.cx, d.t + 120]);
    ok(!scrollable || await attr(p, R, 'data-open') === 'true', 'a swipe down on a list that is scrolled does not fold it' + (scrollable ? '' : ' (not scrollable at this size)') + tag);
    await p.$eval(R + ' .route-summary-detail', (e) => { e.scrollTop = 0; }); await p.waitForTimeout(150);
    await swipe([d.cx, d.t + 20], [d.cx, d.t + 110]);
    ok(await attr(p, R, 'data-open') === 'false' && await noOffset(p, R + ' .route-summary-status'), 'a swipe down from the list at its top folds it' + tag);
    await p.locator(R + ' .route-summary-status').tap(); await p.waitForTimeout(100);
    ok(await attr(p, R, 'data-open') === 'true', 'tap still toggles' + tag);
    await p.locator(R + ' .route-summary-status').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    ok(await attr(p, R, 'data-open') === 'false', 'keyboard still toggles' + tag);
    await ctx.close();
  }

  // ================= main panel (phone): up from the handle expands the sheet; the existing down dismissal still works
  {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5205/');
    const sheet = async () => { await p.evaluate(() => document.querySelector('#dock button[data-tab=config]').click()); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(400); };
    const tall = () => p.evaluate(() => document.getElementById('panel').classList.contains('tall'));
    await sheet();
    let s = await rect(p, '#panel');
    ok(!(await tall()), 'panel: starts at its usual height');
    await swipe([s.cx, s.t + 14], [s.cx, s.t - 100]);
    ok(await tall() && await p.getAttribute('#panel-expand', 'aria-pressed') === 'true', 'panel: a swipe up on the handle expands the sheet (same state as the handle button)');
    s = await rect(p, '#panel');
    await swipe([s.cx, s.t + 14], [s.cx, s.t + 200]);
    ok(await p.locator('#panel').isHidden(), 'panel: the existing swipe down still dismisses it');
    await p.evaluate(() => { const prefs = JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'); delete prefs.panelTall; localStorage.setItem('uavzones.v1.prefs', JSON.stringify(prefs)); });
    await ctx.close();
  }
  {
    const { ctx, p, swipe } = await open('http://127.0.0.1:5205/');
    await p.evaluate(() => document.querySelector('#dock button[data-tab=config]').click()); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(400);
    const s = await rect(p, '#panel');
    await swipe([s.l + 20, s.t + 14], [s.l + 20, s.t + 4]); // off the handle button, which would take a short drag for a tap
    ok(!(await p.evaluate(() => document.getElementById('panel').classList.contains('tall'))) && await p.locator('#panel').isVisible(), 'panel: a short drag changes nothing');
    await ctx.close();
  }

  // ================= Phase B exclusions: disclosure headers keep tap-only behaviour and do not take over the scroll
  {
    const { ctx, p } = await open('http://127.0.0.1:5205/');
    await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]')?.click());
    await p.waitForTimeout(500);
    const blocked = await p.evaluate(() => new Promise((res) => {
      const t = document.querySelector('#poi-add > summary');
      if (!t) return res(null);
      let prevented = false; t.addEventListener('touchmove', (e) => { if (e.defaultPrevented) prevented = true; });
      const r = t.getBoundingClientRect();
      const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: t, clientX: r.left + 20, clientY: y })] });
      t.dispatchEvent(mk('touchstart', r.top + 5)); for (let i = 1; i <= 6; i++) t.dispatchEvent(mk('touchmove', r.top + 5 - i * 15)); t.dispatchEvent(mk('touchend', 0));
      setTimeout(() => res(prevented), 50);
    }));
    ok(blocked === false, 'Saved Places disclosure header: a vertical touch is left to the browser, so scrolling is unchanged (no gesture, tap-only)');
    await ctx.close();
  }
} finally {
  await b.close(); on.kill(); off.kill();
}
ok(errs.length === 0, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
