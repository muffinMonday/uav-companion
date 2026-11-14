// The window tidy-up: icon tools in the bar at the top of the marker window (a menu on phones), the two-step Delete,
// one Open and one Navigate button, the short disclaimer and the weather privacy sentence as a tooltip.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: '2026-11-01T00:00:01.000Z', ...extra });
const items = [mk('yc', 'Yellow Crane Tower', 30.5928, 114.3055, { date: '2026-11-12', order: 2 }), mk('hm', 'Flat', 30.4, 114.1, { type: 'residence' })];
const b = await chromium.launch({ channel: CHANNEL });
const open = async (vp, mobile, name) => {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((po) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); } }, items);
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  await p.click(`#poi-list .poi-item:has-text("${name}")`);
  await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1000);
  return { ctx, p };
};
const tools = (p) => p.$$eval('.poi-pop .pop-tools .btn.tool:not(.pop-eye)', (b) => b.map((x) => x.title));

// desktop
let { ctx, p } = await open({ width: 1200, height: 800 }, false, 'Yellow Crane');
ok((await tools(p)).join() === 'Edit,Add visit,Make Side Quest,Delete', 'desktop: Edit, Add visit, Make Side Quest and Delete are icons in the bar at the top: ' + (await tools(p)).join());
ok((await p.locator('.poi-pop .acts').count()) === 0, 'there is no row of action buttons at the bottom any more');
ok((await p.locator('.poi-pop .coords-row a.maplink').allTextContents()).join() === 'Open in Amap,Navigate in Amap', 'one Open and one Navigate icon, named after the app, on the coordinates line');
ok(((await p.locator('.poi-pop .coords-row a.maplink').first().getAttribute('title')) || '').includes('shares this location'), 'the tooltip says the location is shared');
ok(await p.locator('.poi-pop .coords-row a.maplink').evaluateAll((l) => l.length === 2 && l.every((e) => { const c = getComputedStyle(e), t = e.querySelector('.map-action-label'); return e.classList.contains('map-action') && c.borderTopStyle === 'solid' && parseFloat(c.borderTopWidth) >= 1 && !!e.querySelector('svg') && t.getBoundingClientRect().width > 30 && e.getBoundingClientRect().height >= 28; })), 'both are outlined icon + visible text controls (the same style as the session cards), still external links');
ok((await p.locator('.poi-pop .maplinks-note').count()) === 0, 'the long sentence under the old buttons is gone');
ok((await p.textContent('.poi-pop .disclaimer')) === 'Planning aid, not flight advice.', 'the disclaimer is one short line');
const kids = await p.evaluate(() => [...document.querySelector('.poi-pop').children].map((c) => c.className.split(' ')[0]));
ok(kids.indexOf('zone') < kids.indexOf('stats-wrap') && kids.indexOf('stats-wrap') < kids.indexOf('wx-opt') && kids.indexOf('wx-opt') < kids.indexOf('dist-wrap') && kids.indexOf('dist-wrap') < kids.indexOf('disclaimer'), 'the window runs: verdict, conditions, the weather button, distances, disclaimer: ' + kids.join(' > '));
ok((await p.locator('.poi-pop .dist-wrap').evaluate((e) => e.getBoundingClientRect().height)) < 50, 'the distances take one compact row');
ok(/Open-Meteo/.test(await p.getAttribute('.poi-pop .wx-btn', 'title')) && (await p.locator('.poi-pop .wx-opt small').evaluate((e) => e.getBoundingClientRect().width)) <= 1, 'the weather privacy sentence is a tooltip, not a line of text');
await p.click('.poi-pop .btn.danger'); await p.waitForTimeout(200);
ok((await p.textContent('.poi-pop .btn.danger')) === 'Confirm delete' && (await p.evaluate(() => !!document.querySelector('.poi-pop h3'))), 'the first press on Delete only asks to confirm');
await p.waitForTimeout(4300);
ok((await p.textContent('.poi-pop .btn.danger')) === 'Delete', 'and goes back after four seconds');
await p.click('.poi-pop .btn.danger'); await p.click('.poi-pop .btn.danger'); await p.waitForTimeout(600);
ok((await p.locator('.poi-pop').count()) === 0 && !(await p.textContent('#poi-list')).includes('Yellow Crane'), 'the second press deletes it');
await ctx.close();

// the Home marker: no Add visit, and its buttons ask first
({ ctx, p } = await open({ width: 1200, height: 800 }, false, 'Flat'));
ok((await tools(p)).join() === 'Edit,Delete', 'the Home marker has Edit and Delete only: ' + (await tools(p)).join());
await ctx.close();

// phone
({ ctx, p } = await open({ width: 390, height: 780 }, true, 'Yellow Crane'));
ok((await tools(p)).join() === 'Edit,More', 'phone: Edit and a ⋯ button: ' + (await tools(p)).join());
ok(!(await p.locator('.poi-pop .pop-menu').isVisible()), 'the menu is closed at first');
await p.tap('.poi-pop .pop-tools .btn.tool:last-child'); await p.waitForTimeout(250);
ok(await p.locator('.poi-pop .pop-menu').isVisible() && (await p.locator('.poi-pop .pop-menu .btn.tool').allTextContents()).join() === 'Add visit,Make Side Quest,Delete', 'tapping ⋯ shows Add visit, Make Side Quest and Delete with their names');
await p.tap('.poi-pop .pop-menu .btn.danger'); await p.waitForTimeout(200);
ok((await p.textContent('.poi-pop .pop-menu .btn.danger')) === 'Confirm delete', 'Delete in the menu also asks to confirm');
await ctx.close();
await b.close();
