// Swipe to dismiss (phone sheet and dashboard down, computer panel to the right) and the rail that folds up into one circle.
// Touch is simulated with real touch events through the browser protocol, the same way tests/hold.mjs does it.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });

async function open({ vp, mobile = true, reduced = true, dash = { showOnStart: true, welcomed: true }, prefs = {} }) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([d, pf, seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, seen, ...d }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', ...pf }));
  }, [dash, prefs, LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  /** A swipe from (x0, y0) to (x1, y1) in `steps` moves, `ms` apart (a slow one when ms is large). */
  const swipe = async ([x0, y0], [x1, y1], { steps = 8, ms = 12 } = {}) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await p.waitForTimeout(ms); }
    await touch('touchEnd'); await p.waitForTimeout(reduced ? 150 : 450);
  };
  return { ctx, p, swipe };
}
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
const visible = (p, sel) => p.isVisible(sel);
const view = (p) => p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view));
const prefs = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
const openSheet = async (p, tab = 'config') => { await p.evaluate((t) => document.querySelector(`#dock button[data-tab=${t}]`).click(), tab); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(400); };
const dashOpen = async (p) => { if (await p.locator('#dash').isHidden()) await p.locator('#dash-peek:visible, #dash-tab:visible').first().tap(); await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(350); };
const dashState = (p) => p.evaluate(() => document.body.dataset.dash);

// ================= phone: the bottom sheet
let { ctx, p, swipe } = await open({ vp: { width: 390, height: 780 } });
await openSheet(p);
let sh = await box(p, '#panel');
const v0 = await view(p);
await swipe([sh.cx, sh.y + 12], [sh.cx, sh.y + 200]);
ok(!(await visible(p, '#panel')) && await visible(p, '#dock'), 'swiping down from the handle puts the sheet away and shows the rail');
ok(!('panelCollapsed' in (await prefs(p))), 'on a phone that is not remembered (the sheet always starts away)');
await openSheet(p); sh = await box(p, '#panel');
await swipe([sh.cx, sh.y + 55], [sh.cx, sh.y + 190]);
ok(!(await visible(p, '#panel')), 'swiping down from the header does the same');
await openSheet(p); sh = await box(p, '#panel');
const hd = await box(p, '#pane-config .card h2'); // the first card's title: plain text, with no field nearby for the browser's touch adjustment to pick instead (a fixed offset landed beside the country box once fields grew)
await swipe([hd.cx, hd.cy], [hd.cx, hd.cy + 140]);
ok(!(await visible(p, '#panel')), 'swiping down in the body, which is at its top, does the same');
ok(await view(p) === v0, 'and the map underneath does not move');

// a body that is scrolled is scrolled, not dismissed
await openSheet(p); sh = await box(p, '#panel');
const scrollable = await p.$eval('.sp-body', (e) => { e.scrollTop = 150; return e.scrollHeight > e.clientHeight + 150; });
if (scrollable) await p.waitForFunction(() => document.querySelector('.sp-body').scrollTop > 100);
await swipe([sh.cx, sh.y + 220], [sh.cx, sh.y + 360]);
ok(!scrollable || await visible(p, '#panel'), 'a swipe down in a body that is scrolled down does not dismiss it' + (scrollable ? '' : ' (not scrollable at this size)'));
await p.$eval('.sp-body', (e) => { e.scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('.sp-body').scrollTop === 0); await p.waitForTimeout(150); // the body scrolls smoothly: wait until it has arrived
await swipe([sh.cx, sh.y + 220], [sh.cx, sh.y + 120]);
ok(await visible(p, '#panel'), 'a swipe up does nothing');
await swipe([sh.cx, sh.y + 20], [sh.cx, sh.y + 45]);
ok(await visible(p, '#panel') && await p.$eval('#panel', (e) => e.style.transform === ''), 'a short swipe snaps back and leaves nothing behind');
await swipe([sh.cx, sh.y + 20], [sh.cx - 150, sh.y + 40]);
ok(await visible(p, '#panel'), 'a mostly sideways swipe to the left is left alone (to the right it now closes the sheet)');

// places where a swipe must not start (the body is put back at the top and left to settle first, so the control is where it was measured)
const settle = async () => { await p.$eval('.sp-body', (e) => { e.scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('.sp-body').scrollTop === 0); await p.waitForTimeout(300); };
await settle();
const sel = await p.locator('#country').count() ? '#country' : 'select';
const sbox = await box(p, sel).catch(() => null);
const onIt = (b2, tag) => p.evaluate(([x, y, t]) => document.elementFromPoint(x, y)?.matches(t), [b2.cx, b2.cy, tag]);
if (sbox) { ok(await onIt(sbox, 'select'), 'the swipe below starts on the drop-down'); await swipe([sbox.cx, sbox.cy], [sbox.cx, sbox.cy + 160]); ok(await visible(p, '#panel'), 'a swipe that starts on a drop-down does not dismiss'); }
await settle();
const slider = await p.locator('#panel input[type=range]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }).catch(() => null);
if (slider) { ok(await onIt(slider, 'input'), 'the swipe below starts on the slider'); await swipe([slider.x, slider.y], [slider.x, slider.y + 160]); ok(await visible(p, '#panel'), 'nor on a slider'); }
await settle();
await p.$eval('.sp-body', (e) => e.setAttribute('data-no-swipe', ''));
await swipe([sh.cx, sh.y + 230], [sh.cx, sh.y + 380]);
ok(await visible(p, '#panel'), 'nor on anything marked data-no-swipe');
await p.$eval('.sp-body', (e) => e.removeAttribute('data-no-swipe'));

// the expanded sheet
await p.tap('#panel-expand'); await p.waitForTimeout(350); sh = await box(p, '#panel');
await swipe([sh.cx, sh.y + 12], [sh.cx, sh.y + 220]);
ok(!(await visible(p, '#panel')) && (await prefs(p)).panelTall === true, 'an expanded sheet is dismissed the same way, and stays expanded for next time');

// to the right, on a phone as well
await openSheet(p); sh = await box(p, '#panel');
await swipe([sh.cx - 100, sh.y + 70], [sh.cx + 110, sh.y + 74]);
ok(!(await visible(p, '#panel')) && await visible(p, '#dock'), 'on a phone, swiping the sheet to the right closes it too');
await openSheet(p); sh = await box(p, '#panel');
await swipe([sh.cx + 100, sh.y + 70], [sh.cx - 60, sh.y + 74]);
ok(await visible(p, '#panel'), 'and a swipe to the left leaves it open');
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });

// ================= phone: the dashboard
await dashOpen(p);
let d = await box(p, '#dash-head, .dash-head');
await swipe([d.cx - 60, d.cy], [d.cx - 60, d.cy + 200]);
ok(await dashState(p) === 'hidden' && await visible(p, '#dash-tab'), 'swiping down from the dashboard\'s header puts it straight away to its tab');
await dashOpen(p);
await p.$eval('#dash-body', (e) => { e.scrollTop = 0; });
d = await box(p, '#dash-body');
await swipe([d.cx, d.y + 30], [d.cx, d.y + 200]);
ok(await dashState(p) === 'hidden', 'swiping down in its cards, at the top, does the same');
await dashOpen(p);
const dscroll = await p.$eval('#dash-body', (e) => { e.scrollTop = 120; return e.scrollHeight > e.clientHeight + 120; });
if (dscroll) await p.waitForFunction(() => document.querySelector('#dash-body').scrollTop > 80);
d = await box(p, '#dash-body');
await swipe([d.cx, d.y + 30], [d.cx, d.y + 200]);
ok(!dscroll || await dashState(p) === 'expanded', 'but not when the cards are scrolled down' + (dscroll ? '' : ' (not scrollable at this size)'));
if (await dashState(p) === 'hidden') await dashOpen(p); // a short dashboard is not scrollable, so that swipe started at the top and put it away
await p.$eval('#dash-body', (e) => { e.scrollTop = 0; }); await p.waitForFunction(() => document.querySelector('#dash-body').scrollTop === 0); await p.waitForTimeout(150);
await p.tap('#dash-expand'); await p.waitForTimeout(350);
d = await box(p, '.dash-head');
await swipe([d.cx - 60, d.cy], [d.cx - 60, d.cy + 200]);
ok(await dashState(p) === 'hidden' && (await prefs(p)).dashTall === true, 'an expanded (tall) dashboard goes to its tab too, and stays expanded for next time');
await dashOpen(p);
await p.tap('#dash-expand'); await p.waitForTimeout(300); // regular again
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
d = await box(p, '#dash-peek');
await swipe([d.cx, d.cy], [d.cx, d.cy + 120]);
ok(await dashState(p) === 'hidden', 'swiping the one-line strip down puts it away to the tab');

// swiping the collapsed dashboard up opens it: the chevron tab, and the summary strip
d = await box(p, '#dash-tab');
await swipe([d.cx, d.cy + 6], [d.cx, d.cy - 140]);
ok(await dashState(p) === 'expanded' && await visible(p, '#dash'), 'swiping the chevron tab up opens the dashboard');
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
d = await box(p, '#dash-peek');
await swipe([d.cx, d.cy + 6], [d.cx, d.cy - 140]);
ok(await dashState(p) === 'expanded', 'swiping the summary strip up opens it too');
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
d = await box(p, '#dash-peek');
await swipe([d.cx - 40, d.cy], [d.cx + 80, d.cy - 6]);
ok(await dashState(p) === 'peek', 'and neither does a sideways one');
await p.tap('#dash-peek'); await p.waitForTimeout(500);
ok(await dashState(p) === 'expanded', 'a tap on the strip still opens it');
await ctx.close();

// ================= with animation (not reduced motion)
({ ctx, p, swipe } = await open({ vp: { width: 390, height: 780 }, reduced: false }));
await openSheet(p); sh = await box(p, '#panel');
await swipe([sh.cx, sh.y + 12], [sh.cx, sh.y + 200]);
ok(!(await visible(p, '#panel')) && await visible(p, '#dock'), 'with animation on, the swipe still ends with the sheet away and the rail showing');
ok(await p.$eval('#panel', (e) => e.style.transform === '' && e.style.transition === ''), 'and the sheet is left clean for next time');
await openSheet(p);
ok(Math.abs((await box(p, '#panel')).y - sh.y) < 3, 'reopened, it is back where it was');
await ctx.close();

// ================= a computer or tablet with touch: the panel goes to the right
({ ctx, p, swipe } = await open({ vp: { width: 1300, height: 850 }, mobile: false }));
ok(await visible(p, '#panel'), 'the computer panel starts open');
sh = await box(p, '#panel');
await swipe([sh.x + 120, sh.y + 120], [sh.x + 60, sh.y + 120]);
ok(await visible(p, '#panel'), 'a swipe to the left does nothing');
await swipe([sh.cx, sh.y + 120], [sh.cx, sh.y + 320]);
ok(await visible(p, '#panel'), 'and a swipe down does nothing here');
await swipe([sh.x + 120, sh.y + 120], [sh.x + 330, sh.y + 122]);
ok(!(await visible(p, '#panel')) && await visible(p, '#dock'), 'a swipe toward the right edge collapses the panel to the rail');
ok((await prefs(p)).panelCollapsed === true, 'and that is remembered, as with the > button');
await p.tap('#dock-expand'); await p.waitForSelector('#panel:not([hidden])');
// the dashboard on a computer swipes down too
await dashOpen(p);
d = await box(p, '.dash-head');
await swipe([d.cx - 80, d.cy], [d.cx - 80, d.cy + 200]);
ok(await dashState(p) === 'hidden', 'the dashboard swipes down to its tab on a computer too');
await ctx.close();

// ================= the rail folds up into one circle
({ ctx, p, swipe } = await open({ vp: { width: 1300, height: 850 }, mobile: false, prefs: { panelCollapsed: true } }));
ok(await visible(p, '#dock') && await visible(p, '#dock-fold') && !(await visible(p, '#dock-circle')), 'the rail shows its icons and a fold button, and no circle');
const full = await box(p, '#dock');
await p.tap('#dock-fold'); await p.waitForTimeout(500);
let rail = await box(p, '#dock');
ok(await p.$eval('#dock', (e) => e.classList.contains('folded')) && await visible(p, '#dock-circle') && !(await visible(p, '#dock-expand')), 'the fold button folds the icons up into one circle');
ok(rail.h < 56 && rail.w < 56 && Math.abs(rail.y - full.y) < 2 && Math.abs(rail.r - full.r) < 2, 'which sits where the rail started (' + Math.round(rail.w) + ' x ' + Math.round(rail.h) + ' px)');
ok(await p.$eval('#dock-icons', (e) => e.inert) && await p.evaluate(() => document.activeElement.id === 'dock-circle'), 'the folded icons cannot be reached by keyboard, and focus moves to the circle');
ok((await prefs(p)).railFolded === true, 'the choice is saved');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok(await p.$eval('#dock', (e) => e.classList.contains('folded')) && await visible(p, '#dock-circle'), 'it is still folded after a reload');
await p.tap('#dock-circle'); await p.waitForTimeout(500);
ok(!(await p.$eval('#dock', (e) => e.classList.contains('folded'))) && await visible(p, '#dock-expand') && await p.evaluate(() => document.activeElement.id === 'dock-expand'), 'tapping the circle drops the icons back, and focus goes to the < button');
ok(!(await visible(p, '#panel')) && !('railFolded' in (await prefs(p))), 'that did not open the panel, and the saved choice is cleared');
// by swipe
rail = await box(p, '#dock');
await swipe([rail.cx, rail.y + 30], [rail.cx, rail.y - 5], { steps: 6 });
ok(await p.$eval('#dock', (e) => e.classList.contains('folded')), 'a swipe up on the rail folds it');
rail = await box(p, '#dock-circle');
await swipe([rail.cx, rail.cy - 4], [rail.cx, rail.cy + 60], { steps: 6 });
ok(!(await p.$eval('#dock', (e) => e.classList.contains('folded'))), 'a swipe down on the circle unfolds it');
// a swipe left on the unfolded rail pulls the panel out; on the folded circle it does nothing
rail = await box(p, '#dock');
await swipe([rail.cx + 6, rail.y + 70], [rail.cx - 130, rail.y + 74], { steps: 8 });
ok(await visible(p, '#panel') && !(await visible(p, '#dock')), 'a swipe left on the unfolded rail opens the panel');
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.tap('#dock-fold'); await p.waitForTimeout(500);
rail = await box(p, '#dock-circle');
await swipe([rail.cx + 4, rail.cy], [rail.cx - 130, rail.cy + 2], { steps: 8 });
ok(!(await visible(p, '#panel')) && await p.$eval('#dock', (e) => e.classList.contains('folded')), 'on the folded circle a swipe left does nothing');
await p.tap('#dock-circle'); await p.waitForTimeout(500); // the first synthetic tap after a drag that began on the circle is swallowed by Chrome; a second one lands
if (await p.$eval('#dock', (e) => e.classList.contains('folded'))) { await p.tap('#dock-circle'); await p.waitForTimeout(500); }
rail = await box(p, '#dock');
await swipe([rail.cx, rail.y + 70], [rail.cx - 20, rail.y + 72], { steps: 4 });
ok(!(await visible(p, '#panel')), 'and a short swipe left on the unfolded rail does nothing');
// an icon still opens its tab
await p.tap('#dock button[data-tab=trips]'); await p.waitForSelector('#panel:not([hidden])');
ok(await visible(p, '#panel') && !(await visible(p, '#dock')) && (await p.getAttribute('#tab-trips', 'aria-selected')) === 'true', 'an icon on the unfolded rail still opens its tab');
await ctx.close();

// ================= on a phone the circle fits next to the search box
({ ctx, p, swipe } = await open({ vp: { width: 360, height: 740 }, prefs: { railFolded: true } }));
const c = await box(p, '#dock-circle'), s = await box(p, '#search');
ok(await visible(p, '#dock-circle') && c.r <= 360 && (s.r <= c.x || s.y + s.h <= c.y || s.x + s.w <= c.x + 1), 'on a 360 px phone the circle does not sit on the search box');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
