// The search box that folds into a magnifying glass, and the side panel that collapses sideways to a rail.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile, prefs) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((pf) => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', ...pf })); }, prefs ?? {});
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  return { ctx, p };
}
const collapsed = (p) => p.$eval('#search', (e) => e.classList.contains('collapsed'));
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });

// ================= search
let { ctx, p } = await open({ width: 1300, height: 850 }, false);
await p.click('#panel-close'); await p.waitForTimeout(200);
ok(await collapsed(p) && !(await p.isVisible('#q')) && (await box(p, '#search-toggle')).w <= 44, 'the search starts as a magnifying glass only');
await p.click('#search-toggle'); await p.waitForTimeout(200);
ok(!(await collapsed(p)) && await p.isVisible('#q') && await p.evaluate(() => document.activeElement.id === 'q'), 'tapping it opens the box and puts the cursor in it');
await p.mouse.click(600, 600); await p.waitForTimeout(450);
ok(await collapsed(p), 'tapping elsewhere with nothing typed folds it away again');
await p.click('#search-toggle'); await p.fill('#q', 'abc'); await p.mouse.click(600, 600); await p.waitForTimeout(450);
ok(!(await collapsed(p)), 'with something typed it stays open');
await p.fill('#q', ''); await p.click('#search-toggle'); await p.waitForTimeout(300);
ok(await collapsed(p), 'the magnifying glass folds an empty box away');
await p.evaluate(() => document.getElementById('map').focus()); await p.keyboard.press('/'); await p.waitForTimeout(200);
ok(!(await collapsed(p)) && await p.evaluate(() => document.activeElement.id === 'q') && (await p.inputValue('#q')) === '', 'the / key opens it (and does not type the slash)');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(await collapsed(p), 'Escape folds an empty box away');
await p.click('#search-toggle'); await p.fill('#q', '30.5, 114.3'); await p.keyboard.press('Enter'); await p.waitForSelector('.leaflet-popup .map-icons', { timeout: 8000 }); await p.waitForTimeout(600);
ok(await collapsed(p), 'picking a result opens its window and folds the box away');
await ctx.close();

// ================= panel: collapses sideways to a rail
({ ctx, p } = await open({ width: 1300, height: 850 }, false));
const full = await box(p, '#panel');
const btn = await box(p, '#panel-close');
ok(btn.r <= full.r && btn.y < full.y + 60 && (await p.getAttribute('#panel-close', 'aria-label')) === 'Collapse the panel', 'the > button is in the panel\'s header and says it collapses the panel');
ok((await p.locator('#panel-roll').count()) === 0 && (await p.locator('.sp-foot').count()) === 0, 'there is no roll-up button any more');
ok(!(await p.isVisible('#dock')), 'with the panel open the rail is not shown');
/** Click each tab and check that its name is not cut off (the label fits its box). */
const namesFit = async (pg) => {
  const cut = [];
  for (const id of await pg.$$eval('#panel [role=tab]', (t) => t.map((x) => x.id))) {
    await pg.evaluate((i) => document.getElementById(i).click(), id); await pg.waitForTimeout(120);
    const fits = await pg.$eval('#' + id + ' .tab-label', (l) => l.scrollWidth <= l.clientWidth);
    if (!fits) cut.push(id);
  }
  await pg.evaluate(() => document.getElementById('tab-config').click());
  return cut;
};
const cutDesk = await namesFit(p);
ok(cutDesk.length === 0, 'on a computer every tab shows its whole name when selected' + (cutDesk.length ? ' (cut: ' + cutDesk.join(', ') + ')' : ''));
ok((await box(p, '#panel')).w === 380, 'the panel is 380 px wide');
await p.click('#tab-trips'); await p.waitForTimeout(150);
await p.click('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
const rail = await box(p, '#dock');
ok(await p.isVisible('#dock') && rail.r > 1300 - 20 && rail.w < 70, 'it slides away and leaves a slim rail on the right edge (' + Math.round(rail.w) + ' px wide)');
ok((await p.locator('#dock button').count()) === 5 && (await p.getAttribute('#dock-expand', 'aria-label')) === 'Expand the panel', 'the rail has the < button and one icon per tab');
ok(await p.evaluate(() => document.activeElement.id === 'dock-expand'), 'focus moves to the < button, so the keyboard user can bring the panel back');
ok(await p.evaluate(() => document.body.dataset.panel) === 'closed', 'the page knows the panel is collapsed');
await p.click('#dock-expand'); await p.waitForSelector('#panel', { state: 'visible' });
ok((await p.getAttribute('#tab-trips', 'aria-selected')) === 'true' && !(await p.isVisible('#dock')), '< brings the panel back on the tab it was on');
await p.click('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok(!(await p.isVisible('#panel')) && await p.isVisible('#dock'), 'a collapsed panel stays collapsed after a reload');
await p.click('#dock-expand'); await p.waitForSelector('#panel', { state: 'visible' });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok(await p.isVisible('#panel'), 'and an open panel stays open after a reload');
await p.click('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.click('#dock button[data-tab=poi]'); await p.waitForSelector('#panel', { state: 'visible' });
ok((await p.getAttribute('#tab-poi', 'aria-selected')) === 'true', 'an icon on the rail opens the panel on that tab');
await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])');
await p.click('#privacy-close'); await p.waitForSelector('#panel', { state: 'hidden' });
ok(await p.isVisible('#dock'), 'the privacy settings have the same > button, and it collapses the whole panel');
await ctx.close();

// a choice saved by the older roll-up version means collapsed
({ ctx, p } = await open({ width: 1300, height: 850 }, false, { panelRolled: true }));
ok(!(await p.isVisible('#panel')) && await p.isVisible('#dock'), 'a panel that an older version had rolled up starts collapsed');
await ctx.close();

// phone
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await p.tap('#dock button[data-tab=poi]'); await p.waitForSelector('#panel', { state: 'visible' });
const cutPhone = await namesFit(p);
ok(cutPhone.length === 0, 'on a 390 px phone every tab shows its whole name when selected' + (cutPhone.length ? ' (cut: ' + cutPhone.join(', ') + ')' : ''));
const sheet = await box(p, '#panel');
const pb = await box(p, '#panel-close');
ok(pb.r <= sheet.r && pb.y >= sheet.y && pb.y < sheet.y + 60, 'on a phone the > button is in the sheet\'s header and not covered: ' + JSON.stringify({ x: Math.round(pb.x), y: Math.round(pb.y) }));
ok(await p.evaluate(() => { const r = document.getElementById('panel-close').getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t && document.getElementById('panel-close').contains(t); }), 'nothing sits on top of it');
await p.tap('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
const prail = await box(p, '#dock');
ok(await p.isVisible('#dock') && prail.r > 390 - 20, 'the sheet slides off to the right and leaves the rail on the right edge');
await p.tap('#dock-expand'); await p.waitForSelector('#panel', { state: 'visible' });
ok(true, 'and < brings the sheet back');
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
