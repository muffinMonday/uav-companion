// The side panel's expand button on a phone: the sheet goes from its usual height to 90% of the screen, the choice is remembered, and the buttons
// stay reachable. On a computer there is no such button.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(() => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
const reachable = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && el.contains(t); }, sel);
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').panelTall === true);
const openSheet = async (p) => { await p.tap('#dock button[data-tab=poi]'); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(350); };
const H = (p) => p.evaluate(() => document.documentElement.clientHeight);

// ---------- not on a computer
let { ctx, p } = await open({ width: 1300, height: 850 }, false);
ok(!(await p.isVisible('#panel-expand')), 'on a computer there is no expand button on the panel (it is already full height)');
await ctx.close();

// ---------- phone
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await openSheet(p);
const vh = await H(p);
const normal = await box(p, '#panel');
const grab = await box(p, '#panel-expand');
ok(await p.isVisible('#panel-expand') && grab.y >= normal.y && grab.y < normal.y + 30 && Math.abs(grab.x + grab.w / 2 - (normal.x + normal.w / 2)) < 3, 'the expand button is centred on a handle at the sheet\'s top edge');
ok(Math.abs(normal.h - Math.min(vh * 0.62, 560)) < 8 && (await p.getAttribute('#panel-expand', 'aria-pressed')) === 'false', 'the usual height is about 62% of the screen (' + Math.round(normal.h) + ' of ' + vh + ' px)');
for (const s of ['#panel-expand', '#panel-close', '#privacy-btn']) ok(await reachable(p, s), s + ' is not covered (usual height)');

await p.tap('#panel-expand'); await p.waitForTimeout(350);
const tall = await box(p, '#panel');
ok(Math.abs(tall.h - (vh * 0.9 - 8)) < 8 && Math.abs(tall.y - vh * 0.1) < 8, 'expanded, the sheet reaches up to 10% from the top: top at ' + Math.round(tall.y) + ' of ' + vh + ' px');
ok((await p.getAttribute('#panel-expand', 'aria-pressed')) === 'true' && /Shrink/.test(await p.getAttribute('#panel-expand', 'aria-label')), 'the button now says it shrinks the sheet back');
for (const s of ['#panel-expand', '#panel-close', '#privacy-btn']) ok(await reachable(p, s), s + ' is not covered (expanded)');
await p.evaluate(() => { const bn = document.getElementById('banner'); bn.hidden = false; document.getElementById('banner-text').textContent = 'A banner that should stay behind the sheet'; });
await p.waitForTimeout(150);
for (const s of ['#panel-expand', '#panel-close']) ok(await reachable(p, s), s + ' is not covered, even with a banner showing');
await p.evaluate(() => { document.getElementById('banner').hidden = true; });
const head0 = await box(p, '.sp-head');
await p.evaluate(() => { const bd = document.querySelector('.sp-body'); bd.scrollTop = bd.scrollHeight; });
await p.waitForTimeout(150);
ok(Math.abs(head0.y - (await box(p, '.sp-head')).y) < 1 && await reachable(p, '#panel-close'), 'the header stays at the top of the sheet while its content scrolls');
ok(await saved(p), 'expanding saves the choice in the settings');

// remembered: collapse and reopen, switch tabs, reload
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.tap('#dock button[data-tab=trips]'); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(350);
ok(Math.abs((await box(p, '#panel')).h - tall.h) < 6, 'collapsing the panel to the rail and opening it again keeps it expanded');
await p.tap('#tab-poi'); await p.waitForTimeout(250);
ok(Math.abs((await box(p, '#panel')).h - tall.h) < 6, 'and so does switching tabs');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
await openSheet(p);
ok(Math.abs((await box(p, '#panel')).h - tall.h) < 6 && await reachable(p, '#panel-expand') && await reachable(p, '#panel-close'), 'after a reload it is still expanded, with its buttons reachable');

// the dashboard and the sheet each keep the size they were left at (an expanded dashboard covers the rail, so it is put away first)
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.tap('#dash-peek:visible, #dash-tab:visible'); await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(300);
await p.tap('#dash-expand'); await p.waitForTimeout(300);
const dashTall = await box(p, '#dash');
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
await p.tap('#dock button[data-tab=poi]'); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(400);
ok(Math.abs((await box(p, '#panel')).h - tall.h) < 6, 'with the dashboard put away, the sheet opens at the size it was left (expanded)');
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.tap('#dash-peek:visible, #dash-tab:visible'); await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(300);
ok(Math.abs((await box(p, '#dash')).h - dashTall.h) < 6 && await reachable(p, '#dash-close'), 'and the dashboard comes back at the size it was left (expanded), with its buttons reachable');
await p.tap('#dash-expand'); await p.waitForTimeout(300); // back to regular for what follows

// shrinking clears it
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
await p.tap('#dock button[data-tab=poi]'); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(350);
await p.tap('#panel-expand'); await p.waitForTimeout(350);
ok(!(await saved(p)) && Math.abs((await box(p, '#panel')).h - normal.h) < 6, 'shrinking it back clears the saved choice and restores the usual height');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
await openSheet(p);
ok(Math.abs((await box(p, '#panel')).h - normal.h) < 6, 'and after a reload it is at its usual height');
await ctx.close();

// ---------- a short phone
({ ctx, p } = await open({ width: 360, height: 520 }, true));
await openSheet(p);
await p.tap('#panel-expand'); await p.waitForTimeout(350);
const small = await box(p, '#panel'), vh2 = await H(p);
ok(small.y >= 0 && small.b <= vh2 && await reachable(p, '#panel-close') && await reachable(p, '#panel-expand'), 'on a short screen the expanded sheet fits and its buttons are reachable (top ' + Math.round(small.y) + ', bottom ' + Math.round(small.b) + ' of ' + vh2 + ' px)');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
