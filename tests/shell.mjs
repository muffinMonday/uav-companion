// The search box that folds into a magnifying glass, and the side panel that rolls up to its header.
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

// ================= panel
({ ctx, p } = await open({ width: 1300, height: 850 }, false));
const full = await box(p, '#panel');
const foot = await box(p, '#panel-roll');
ok(foot.b > full.b - 40 && foot.b <= full.b, 'the ^ button is at the bottom of the panel: ' + Math.round(foot.b) + ' of ' + Math.round(full.b));
await p.click('#panel-roll'); await p.waitForTimeout(250);
let rolled = await box(p, '#panel');
ok(await p.$eval('#panel', (e) => e.classList.contains('rolled')) && rolled.h < 130 && rolled.y === full.y && await p.isVisible('#tab-trips') && !(await p.isVisible('.sp-body')), 'it rolls up into its header strip, tabs still showing (' + Math.round(rolled.h) + ' px high)');
ok((await p.getAttribute('#panel-roll', 'aria-label')) === 'Roll the panel down' && (await p.getAttribute('#panel-roll', 'aria-expanded')) === 'false', 'the button now says it rolls down');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok(await p.$eval('#panel', (e) => e.classList.contains('rolled')), 'a rolled panel stays rolled after a reload');
await p.click('#tab-trips'); await p.waitForTimeout(250);
ok(!(await p.$eval('#panel', (e) => e.classList.contains('rolled'))) && await p.isVisible('.sp-body'), 'choosing a tab rolls it back down');
await p.click('#panel-roll'); await p.waitForTimeout(200); await p.click('#panel-roll'); await p.waitForTimeout(250);
ok((await box(p, '#panel')).h > 400, 'the button rolls it down again');
await p.click('#panel-roll'); await p.click('#panel-close'); await p.waitForTimeout(250);
await p.click('#dock button[data-tab=poi]'); await p.waitForTimeout(250);
ok(!(await p.$eval('#panel', (e) => e.classList.contains('rolled'))) && await p.isVisible('.sp-body'), 'hiding the panel and opening it from the dock gives it back unrolled');
await ctx.close();

// phone
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await p.tap('#dock button[data-tab=poi]'); await p.waitForTimeout(300);
const sheet = await box(p, '#panel');
await p.tap('#panel-roll'); await p.waitForTimeout(250);
rolled = await box(p, '#panel');
ok(rolled.h < 130 && Math.abs(rolled.b - sheet.b) < 2, 'on a phone the sheet rolls down to its header strip at the bottom edge (' + Math.round(rolled.h) + ' px)');
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
