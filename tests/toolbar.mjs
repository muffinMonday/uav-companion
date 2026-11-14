// The expandable map-tool labels: collapsed by default, every original button unchanged, labels that follow each button's state and hidden buttons, no taps stolen,
// reload collapses, keyboard, steps aside while placing, and the layout at phone, unfolded, tablet and desktop sizes. Screenshots go to tests/out/toolbar/.
import { chromium, CHANNEL, LATEST_SEEN, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOME = { latitude: 30.59, longitude: 114.30, accuracy: 15 };
const shots = `${OUT}/toolbar`; fs.mkdirSync(shots, { recursive: true });

async function open({ vp = { width: 1300, height: 850 }, touch = false, dark = false, reduced = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: reduced ? 'reduce' : 'no-preference', permissions: ['geolocation'], geolocation: HOME });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript((seen) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.59, lon: 114.30, zoom: 13 }, basemap: 'osm' }));
  }, LATEST_SEEN);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  // the side panel is not part of this: fold it away so the map is free
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.waitForTimeout(300);
  return { ctx, p };
}
const names = (p) => p.$$eval('.leaflet-top.leaflet-left a[data-tool]', (as) => as.map((a) => ({ tool: a.dataset.tool, aria: a.getAttribute('aria-label'), shown: a.getClientRects().length > 0 && !a.closest('[hidden]') })));
const rows = (p) => p.$$eval('#map-tool-labels .tool-label-row', (rs) => rs.map((r) => { const b = r.getBoundingClientRect(); return { tool: r.dataset.tool, text: r.textContent, x: b.x, y: b.y, w: b.width, h: b.height, right: b.right }; }));
const rect = (p, sel) => p.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; });
const labelOf = async (p, tool) => (await rows(p)).find((r) => r.tool === tool)?.text;
const settle = (p) => p.waitForTimeout(120);
const T = '.leaflet-top.leaflet-left a[data-tool="labels"]';
let ctx, p;

// ================= collapsed by default
({ ctx, p } = await open());
const before = await names(p);
ok(await p.locator(T).count() === 1, 'the toggle button exists');
ok(await p.locator('#map-tool-labels').isHidden(), 'collapsed by default: no labels on the map');
ok((await p.getAttribute(T, 'aria-expanded')) === 'false' && (await p.getAttribute(T, 'aria-controls')) === 'map-tool-labels', 'aria-expanded=false and aria-controls name the label layer');
ok(/map tool labels/i.test(await p.getAttribute(T, 'aria-label')), 'the toggle has an accessible name');
const order = before.map((x) => x.tool).join();
ok(order.startsWith('locate,details,side-quests,trips,crosshair') && order.endsWith('labels'), 'the original buttons keep their order and the toggle comes last: ' + order);
ok(before.at(-1).tool === 'labels', 'the toggle is the last button in the column');
ok(before.filter((x) => x.tool !== 'labels').every((x) => x.aria), 'every original button keeps its accessible name while collapsed');

// ================= expanded
const ariaBefore = Object.fromEntries(before.map((x) => [x.tool, x.aria]));
await p.click(T); await settle(p);
ok(await p.locator('#map-tool-labels').isVisible(), 'pressing the toggle shows the labels');
ok((await p.getAttribute(T, 'aria-expanded')) === 'true', 'aria-expanded becomes true');
let r = await rows(p);
const visibleTools = (await names(p)).filter((x) => x.shown).map((x) => x.tool);
ok(r.map((x) => x.tool).join() === visibleTools.join(), 'one label per visible button, in the same order: ' + r.map((x) => x.tool).join());
ok(!r.some((x) => x.tool === 'compass') && !visibleTools.includes('compass'), 'the compass is hidden when the map is north-up, so it has no label');
const after = await names(p);
ok(after.every((x) => x.aria === ariaBefore[x.tool]), 'accessible names of the buttons are unchanged by expanding');
const btnRects = await p.$$eval('.leaflet-top.leaflet-left a[data-tool]', (as) => as.filter((a) => a.getClientRects().length).map((a) => { const b = a.getBoundingClientRect(); return { y: b.y, h: b.height, right: b.right }; }));
ok(r.every((x, i) => Math.abs(x.y - btnRects[i].y) <= 1.5 && Math.abs(x.h - btnRects[i].h) <= 1.5 && x.x >= btnRects[i].right), 'each label sits level with its button and clear of it');
const t0 = r.find((x) => x.tool === 'locate');
ok(await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !e.closest('#map-tool-labels'); }, [t0.x + t0.w / 2, t0.y + t0.h / 2]), 'a label never takes a tap (pointer-events none)');
ok(r.find((x) => x.tool === 'labels')?.text === 'Hide labels', 'the toggle row reads Hide labels');
await p.screenshot({ path: `${shots}/desk-expanded.png` });

// ---- labels follow the state; the buttons act as before
const cross = '.leaflet-top.leaflet-left a[data-tool="crosshair"]';
ok(await labelOf(p, 'crosshair') === 'Hide crosshair' && (await p.getAttribute(cross, 'aria-pressed')) === 'true', 'crosshair starts on: label says Hide crosshair');
await p.click(cross); await settle(p);
ok(await labelOf(p, 'crosshair') === 'Show crosshair' && (await p.getAttribute(cross, 'aria-pressed')) === 'false' && await p.locator('.crosshair').isHidden(), 'pressing it hides the crosshair and the label follows');
await p.click(cross); await settle(p);
ok(await labelOf(p, 'crosshair') === 'Hide crosshair' && await p.locator('.crosshair').isVisible(), 'and back');
const det = '.leaflet-top.leaflet-left a[data-tool="details"]';
const d0 = await labelOf(p, 'details'); await p.click(det); await settle(p);
const d1 = await labelOf(p, 'details');
ok(d0 !== d1 && /marker details/.test(d0) && /marker details/.test(d1), 'marker details: label flips with the button (' + d0 + ' -> ' + d1 + ')');
await p.click(det); await settle(p);
const sq = '.leaflet-top.leaflet-left a[data-tool="side-quests"]', tr = '.leaflet-top.leaflet-left a[data-tool="trips"]';
const s0 = await labelOf(p, 'side-quests'); await p.click(sq); await settle(p);
ok(s0 !== await labelOf(p, 'side-quests'), 'Side Quests label flips (' + s0 + ' -> ' + await labelOf(p, 'side-quests') + ')'); await p.click(sq);
const t1 = await labelOf(p, 'trips'); await p.click(tr); await settle(p);
ok(t1 !== await labelOf(p, 'trips'), 'trip markers label flips (' + t1 + ' -> ' + await labelOf(p, 'trips') + ')'); await p.click(tr);
ok(await labelOf(p, 'locate') === 'My location', 'locate: My location');
await p.click('.locate-btn'); await p.waitForTimeout(900);
ok(['Follow me', 'Stop following'].includes(await labelOf(p, 'locate')), 'locate after a fix: ' + await labelOf(p, 'locate'));
ok(await p.evaluate(() => /Follow|Stop/.test(document.querySelector('.locate-btn').getAttribute('aria-label'))), 'the real button changed with it');

// ---- a button that appears or hides later
await p.evaluate(() => { document.querySelector('.compass-bar').hidden = false; }); await settle(p);
ok(await labelOf(p, 'compass') === 'Reset to north', 'the compass gets its label when it appears');
await p.evaluate(() => { document.querySelector('.compass-bar').hidden = true; }); await settle(p);
ok(await labelOf(p, 'compass') === undefined, 'and loses it when it hides (no phantom row)');

// ---- the map still works under the labels
const m = await rect(p, '#map');
await p.mouse.move(m.x + 600, m.y + 400); await p.mouse.down(); await p.mouse.move(m.x + 700, m.y + 460, { steps: 5 }); await p.mouse.up();
ok(await p.evaluate(() => Math.abs(document.querySelector('.crosshair .cross-label').textContent.split(',')[1] - 114.30) > 0.0005), 'dragging the map pans it while labels are open');
await p.mouse.click(m.x + 600, m.y + 400, { button: 'right' }); await p.waitForTimeout(1200);
ok(await p.locator('.leaflet-popup').count() > 0, 'a right-click still checks a spot while labels are open');
await p.keyboard.press('Escape');
ok(await p.locator('#map-tool-labels').isVisible(), 'labels are not closed by map actions');

// ---- keyboard
await p.focus(T);
await p.keyboard.press('Escape'); await settle(p);
ok(await p.locator('#map-tool-labels').isHidden() && (await p.getAttribute(T, 'aria-expanded')) === 'false', 'Escape on the focused toggle collapses the labels');
ok(await p.evaluate(() => document.activeElement?.dataset.tool) === 'labels', 'focus stays on the toggle');
await p.keyboard.press('Enter'); await settle(p);
ok(await p.locator('#map-tool-labels').isVisible(), 'Enter on the toggle expands');
ok(await p.$eval(T, (a) => a.getAttribute('role') === 'button' && a.tabIndex >= 0), 'the toggle is a focusable button');

// ---- steps aside while a marker is placed, keeps its state
await p.evaluate(() => document.getElementById('map').classList.add('is-placing')); await settle(p);
ok(await p.locator('#map-tool-labels').isHidden(), 'hidden while placing a marker');
await p.evaluate(() => document.getElementById('map').classList.remove('is-placing')); await settle(p);
ok(await p.locator('#map-tool-labels').isVisible(), 'and back afterwards: the state was kept');

// ---- reload collapses, nothing stored
const keysBefore = await p.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join());
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
ok(await p.locator('#map-tool-labels').isHidden() && (await p.getAttribute(T, 'aria-expanded')) === 'false', 'a reload starts collapsed');
ok(await p.evaluate(() => !Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => /label|toolbar|expand/i.test(k))), 'the expanded state is not stored anywhere');
await ctx.close();

// ================= layouts: phone, large phone, unfolded, tablet, desktop, short landscape, dark
const VPS = [['phone', 390, 844, true, false], ['phone2', 412, 915, true, false], ['unfolded', 700, 850, true, false], ['unfolded-land', 850, 700, true, false], ['tablet', 768, 1024, true, false], ['desktop', 1440, 900, false, false], ['short-land', 844, 390, true, false], ['phone-dark', 390, 844, true, true], ['desktop-dark', 1440, 900, false, true]];
for (const [name, w, h, touch, dark] of VPS) {
  ({ ctx, p } = await open({ vp: { width: w, height: h }, touch, dark }));
  await p.click(T); await settle(p);
  r = await rows(p);
  const rm = await rect(p, '#map');
  ok(r.length >= 6 && r.every((x) => x.x >= 0 && x.right <= rm.right - 4 && x.y >= 0 && x.y + x.h <= rm.bottom + 1), name + ': ' + r.length + ' labels, all inside the map');
  const overlap = await p.evaluate(() => { const rs = [...document.querySelectorAll('#map-tool-labels .tool-label-row')].map((e) => e.getBoundingClientRect()); return rs.some((a, i) => rs.some((c, j) => i !== j && a.x < c.right && c.x < a.right && a.y < c.bottom - 0.5 && c.y < a.bottom - 0.5)); });
  ok(!overlap, name + ': labels do not overlap each other');
  const bx = await p.$$eval('.leaflet-top.leaflet-left a[data-tool]', (as) => as.filter((a) => a.getClientRects().length).map((a) => { const b = a.getBoundingClientRect(); return [b.width, b.height]; }));
  ok(touch ? bx.every(([bw, bh]) => bw >= 36 && bh >= 36) : bx.every(([bw]) => bw >= 30), name + ': buttons keep their size (' + bx[0] + ')');
  const txt = await p.$eval('#map-tool-labels .tool-label-row', (e) => { const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), fg: c.color, bg: c.backgroundColor }; });
  ok(txt.fs >= 12, name + ': label text is at least 12px (' + txt.fs + ')');
  await p.screenshot({ path: `${shots}/${name}-expanded.png` });
  await ctx.close();
}

// ================= 200% text zoom: labels stay inside the map
({ ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true }));
await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
await p.click(T); await settle(p);
r = await rows(p); const rm2 = await rect(p, '#map');
ok(r.length >= 6 && r.every((x) => x.right <= rm2.right), 'large root text: labels stay inside the map');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
