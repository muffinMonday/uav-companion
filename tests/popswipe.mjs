// Swipe to close the map popups: the marker window (poi-ui.js) and the point-check window (main.js). Left or right anywhere on them, up or down from the border.
// Touch is simulated with real touch events through the browser protocol, the same way tests/swipe.mjs does it.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('A', 'Alpha', 2, { date: '2026-11-12', order: 1 }),
  mk('B', 'Bravo', 3, { date: '2026-11-12', order: 2 }),
];
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

async function open(vp = { width: 390, height: 780 }, mobile = true, motion = 'reduce') {
  const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: mobile, reducedMotion: motion });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume(); // fixtures are dated around 12 to 14 Nov 2026: completed trips are off the map from 15 Nov
  await ctx.addInitScript(([po, tr, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po }));
    localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, seen, showOnStart: false, welcomed: true }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', currentTrip: 't1' }));
  }, [items, trips, LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|arcgisonline/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const swipe = async ([x0, y0], [x1, y1], steps = 8) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await p.waitForTimeout(12); }
    await touch('touchEnd'); await p.waitForTimeout(250);
  };
  return { ctx, p, swipe, touch };
}
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: r.right }; });
const view = (p) => p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view));
const openWindow = async (p, name) => {
  await p.evaluate(() => document.querySelector('#dock button[data-tab=poi]')?.click());
  await p.waitForSelector('#panel:not([hidden])', { timeout: 5000 }).catch(() => {});
  await p.click(`#poi-list .poi-item:has(b:text-is("${name}"))`);
  await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 });
  await p.waitForTimeout(400);
};
const winOpen = (p) => p.$('.poi-pop').then((x) => !!x);

// ================= the marker window
{
  const { ctx, p, swipe, touch } = await open();
  await openWindow(p, 'Alpha');
  // the whole pane goes with the finger (the bubble, the tip), and comes back when the swipe is too short to dismiss
  const at = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.x; });
  const bubble0 = await at('.leaflet-popup-content-wrapper');
  const tip0 = (await p.isVisible('.leaflet-popup-tip-container')) ? await at('.leaflet-popup-tip-container') : null;
  const hh = await box(p, '.poi-pop h3');
  await touch('touchStart', hh.cx, hh.cy);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', hh.cx - 10 * i, hh.cy + 1); await p.waitForTimeout(12); }
  const bubble1 = await at('.leaflet-popup-content-wrapper');
  const tip1 = tip0 === null ? null : await at('.leaflet-popup-tip-container');
  ok(Math.abs((bubble0 - bubble1) - 60) < 3 && (tip0 === null || Math.abs((tip0 - tip1) - 60) < 3), 'mid-swipe, the bubble and its tip both move with the finger (' + Math.round(bubble0 - bubble1) + ' px)');
  for (let i = 5; i >= 0; i--) { await touch('touchMove', hh.cx - 10 * i, hh.cy + 1); await p.waitForTimeout(12); }
  await touch('touchEnd'); await p.waitForTimeout(300);
  ok(await winOpen(p), 'a swipe too short to dismiss leaves the window open');
  ok(Math.abs((await at('.leaflet-popup-content-wrapper')) - bubble0) < 3, 'and the pane snaps back into place');
  const opacity = () => p.$eval('.leaflet-popup-content-wrapper', (e) => parseFloat(getComputedStyle(e).opacity));
  ok((await opacity()) > 0.99, 'and it is fully opaque again');

  // the body: the name line, under the top bar
  const body = await box(p, '.poi-pop h3');
  await swipe([body.cx, body.cy], [body.cx - 150, body.cy + 4]);
  ok(!(await winOpen(p)), 'the marker window: swiping left on its body closes it');
  await openWindow(p, 'Alpha');
  const b2 = await box(p, '.poi-pop h3');
  await swipe([b2.cx, b2.cy], [b2.cx + 150, b2.cy + 4]);
  ok(!(await winOpen(p)), 'swiping right on its body closes it too');

  await openWindow(p, 'Alpha');
  const v0 = await view(p);
  const b3 = await box(p, '.poi-pop h3');
  const bx = b3.x + 30; // the left of the name line: the title column is as wide as the Open / Navigate buttons now, and its centre is under the top bar's eye button, whose touch target reaches 8 px below it
  await swipe([bx, b3.cy], [bx, b3.cy + 150]);
  ok(await winOpen(p), 'a downward swipe on the body (not the border) leaves it open');
  ok((await view(p)) === v0, 'and the map underneath does not move');

  const top = await box(p, '.poi-pop .pop-type');
  await swipe([top.cx, top.cy], [top.cx, top.cy + 150]);
  ok(!(await winOpen(p)), 'swiping down from the top bar closes it');

  await openWindow(p, 'Alpha');
  const top2 = await box(p, '.poi-pop .pop-type');
  await swipe([top2.cx, top2.cy], [top2.cx, top2.cy - 150]);
  ok(!(await winOpen(p)), 'swiping up from the top bar closes it too');

  await openWindow(p, 'Alpha');
  const seq = await box(p, '.poi-pop .pop-seq');
  await swipe([seq.cx, seq.cy], [seq.cx, seq.cy - 150]);
  ok(!(await winOpen(p)), 'swiping up from the previous / next footer closes it');

  await openWindow(p, 'Alpha');
  const seq2 = await box(p, '.poi-pop .pop-seq');
  await swipe([seq2.cx, seq2.cy], [seq2.cx, seq2.cy + 150]);
  ok(!(await winOpen(p)), 'and swiping down from it closes it too');

  // the edit form: a swipe does not close it
  await openWindow(p, 'Alpha');
  await p.click('.poi-pop .pop-tools button[title="Edit"]'); await p.waitForSelector('.poi-pop form', { timeout: 5000 });
  const f = await box(p, '.poi-pop form');
  await swipe([f.cx, f.cy], [f.cx - 150, f.cy + 4]);
  ok(await winOpen(p) && await p.isVisible('.poi-pop form'), 'in edit mode, a swipe left does not close the window');
  await openWindow(p, 'Alpha'); // back in view mode, where the top bar (and its close button) is
  await p.evaluate(() => document.querySelector('.poi-pop .pop-close')?.click()); await p.waitForTimeout(300);
  ok(!(await winOpen(p)), 'the window still closes with its own close button (in the top border)');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

// ================= the fade on a dismissal. Motion is allowed here: with reduced motion the window is dismissed at once, with nothing to watch.
{
  const { ctx, p, touch } = await open(undefined, true, 'no-preference');
  await openWindow(p, 'Alpha');
  const hh = await box(p, '.poi-pop h3');
  const opacity = () => p.$eval('.leaflet-popup-content-wrapper', (e) => parseFloat(getComputedStyle(e).opacity));
  // it gets fainter as the finger moves; once let go it keeps sliding and fading, and is removed, never jumping back towards the middle
  await touch('touchStart', hh.cx, hh.cy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', hh.cx - 15 * i, hh.cy + 1); await p.waitForTimeout(12); }
  const opMid = await opacity();
  ok(opMid < 0.9 && opMid > 0.05, 'mid-swipe, the pane is partly faded (opacity ' + opMid.toFixed(2) + ')');
  await p.evaluate(() => {
    window.__run = [];
    const w = document.querySelector('.leaflet-popup-content-wrapper');
    const frame = () => {
      if (!w.isConnected) { window.__run.push('removed'); return; }
      const r = w.getBoundingClientRect();
      window.__run.push([r.x, parseFloat(getComputedStyle(w).opacity)]);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await touch('touchEnd'); await p.waitForTimeout(400);
  const run = await p.evaluate(() => window.__run);
  const seen = run.filter(Array.isArray);
  const xOk = seen.every((s, i) => i === 0 || s[0] <= seen[i - 1][0] + 0.5);
  const opOk = seen.every((s, i) => i === 0 || s[1] <= seen[i - 1][1] + 0.01);
  ok(seen.length > 0 && xOk, 'after release, the pane carries on in the swipe direction and never jumps back (' + seen.length + ' frames)');
  ok(seen.length > 0 && opOk, 'and it fades monotonically while it goes');
  ok(seen.length > 0 && seen[seen.length - 1][1] < 0.3 && run.includes('removed'), 'it is faded out and then removed');
  ok(!(await winOpen(p)), 'the window is closed after the fade');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

// ================= the point-check window (a computer layout: the search box is on screen)
// a check at one spot: the search opens if it has been folded away, then the coordinates go in
const searchAt = async (p) => { await p.evaluate(() => { if (document.getElementById("search").classList.contains("collapsed")) document.getElementById("search-toggle").click(); }); await p.waitForTimeout(200); await p.fill("#q", "30.5700, 114.3100"); await p.waitForTimeout(250); await p.keyboard.press("Enter"); };
{
  const { ctx, p, swipe } = await open({ width: 1200, height: 800 }, false);
  await searchAt(p);
  await p.waitForSelector('.leaflet-popup .pop-bar', { timeout: 8000 });
  await p.waitForTimeout(400);
  const pop = () => p.$('.leaflet-popup .check').then((x) => !!x);
  const bar = await box(p, '.leaflet-popup .pop-bar');
  await swipe([bar.cx - 40, bar.cy], [bar.cx - 40, bar.cy + 150]);
  ok(!(await pop()), 'point-check window: swiping down from the top bar closes it');

  await searchAt(p);
  await p.waitForSelector('.leaflet-popup .pop-bar', { timeout: 8000 }); await p.waitForTimeout(400);
  const sub = await box(p, '.leaflet-popup .pop-sub');
  await swipe([sub.cx, sub.cy], [sub.cx + 150, sub.cy + 4]);
  ok(!(await pop()), 'swiping left on its body closes it');

  await searchAt(p);
  await p.waitForSelector('.leaflet-popup .pop-bar', { timeout: 8000 }); await p.waitForTimeout(400);
  const last = await box(p, '.leaflet-popup .check > :last-child');
  // the Open / Navigate buttons make the window a little taller, so the bottom row can reach below the visible bubble: swipe from its visible part, left of the tip
  const wb = await p.$eval('.leaflet-popup-content-wrapper', (e) => e.getBoundingClientRect().bottom), lx = last.x + 30, ly = Math.min(last.cy, wb - 10);
  await swipe([lx, ly], [lx, ly - 150]);
  ok(!(await pop()), 'swiping up from the bottom row closes it');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await ctx.close();
}

await b.close();
process.exit(errs.length ? 1 : 0);
