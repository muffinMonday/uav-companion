// Layout and look: tab contents, settings block, modern controls, search/dock on phones, marker window on phones, day and stop labels.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from 'playwright-core';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const mk = (id, type, name, n, extra = {}) => ({ id, type, name, note: '', lat: 30.59 + n * 0.003, lon: 114.30 + n * 0.003, created: `2026-11-0${n + 1}T00:00:00.000Z`, ...extra });
const dated = { v: 1, items: [
  mk('a', 'photo', 'Bridge', 1, { day: 2, order: 3, date: '2026-11-13' }), mk('b', 'hotel', 'Lake Hotel', 2, { order: 4 }),
  mk('c', 'photo', 'Plain spot', 3), mk('d', 'photo', 'Early', 4, { day: 1, date: '2026-11-12' }),
] };
const dayOnly = { v: 1, items: [mk('e', 'photo', 'Tower', 1, { day: 2, order: 3 }), mk('f', 'photo', 'Park', 2, { day: 2, order: 1 })] };

const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const watch = (p) => { p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text())); };
async function session(seed, viewport, mobile = false) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((s) => { if (!localStorage.getItem('uavzones.v1.pois')) localStorage.setItem('uavzones.v1.pois', JSON.stringify(s)); }, seed);
  const p = await ctx.newPage(); watch(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const open = (p, tab) => p.evaluate((t) => { const d = document.querySelector(`#dock button[data-tab=${t}]`); if (!document.getElementById('panel').hidden) document.getElementById(`tab-${t}`).click(); else d.click(); }, tab);
const vis = (p, sel) => p.locator(sel).isVisible();

// ================= tab contents (desktop)
let { ctx, p } = await session(dated, { width: 1200, height: 800 });
await open(p, 'config');
ok(!(await vis(p, 'h2:has-text("Weather and elevation")')) && !(await vis(p, 'h2:has-text("Backup")')) && !(await vis(p, '#ai-card')), 'Map Configs shows only its own cards');
await open(p, 'trips');
ok(!(await vis(p, 'h2:has-text("Weather and elevation")')) && !(await vis(p, 'h2:has-text("Backup")')) && (await vis(p, '#ai-card')) && (await vis(p, '#trips-empty')), 'Trips shows trips and Plan with an AI, and no weather or backup');
await open(p, 'poi');
ok((await vis(p, 'h2:has-text("Weather and elevation")')) && (await vis(p, 'h2:has-text("Backup")')) && !(await vis(p, '#ai-card')), 'Points of Interest shows weather and backup, and no AI card');
const struct = await p.evaluate(() => ({
  weatherInPoi: !!document.querySelector('#pane-poi .aux #mw-status'),
  backupInPoi: !!document.querySelector('#pane-poi .aux #poi-export'),
  aiInTrips: !!document.querySelector('#pane-trips #ai-card #ai-preview'),
  bodyChildren: [...document.querySelector('#panel > .sp-body').children].map((c) => c.id).join(','),
  border: getComputedStyle(document.querySelector('.aux')).borderTopStyle,
  label: getComputedStyle(document.querySelector('.aux'), '::before').content,
  scroll: getComputedStyle(document.querySelector('.sp-body')).scrollbarWidth,
}));
ok(struct.weatherInPoi && struct.backupInPoi && struct.aiInTrips && struct.bodyChildren === 'pane-config,pane-trips,pane-poi', 'the markup is balanced: the cards sit inside their own tab panes');
ok(struct.border === 'dashed' && /Settings and backup/.test(struct.label), 'the weather and backup block is set apart: dashed outline and a "Settings and backup" label');
ok(struct.scroll === 'thin', 'scroll bars are thin');

// ================= modern controls
await p.click('#poi-list .poi-item:has-text("Plain spot")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(500);
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(200);
ok((await p.locator('.poi-pop .num-field').count()) === 2 && (await p.locator('.poi-pop .num-field .ctl-btn').count()) === 4, 'Day and Stop get − and + buttons');
ok((await p.locator('.poi-pop .date-field').count()) === 2, 'both dates are wrapped in the modern date field');
const day = p.locator('.poi-pop .num-field input').first();
await p.locator('.poi-pop .num-field .inc').first().click();
ok((await day.inputValue()) === '1', '+ on an empty Day starts at its minimum (1)');
await p.locator('.poi-pop .num-field .inc').first().click();
ok((await day.inputValue()) === '2', '+ again makes it 2');
await p.locator('.poi-pop .num-field .dec').first().click();
await p.locator('.poi-pop .num-field .dec').first().click();
ok((await day.inputValue()) === '1', '− stops at the minimum');
await day.fill('7');
ok((await day.inputValue()) === '7', 'typing a number still works');
const startDate = p.locator('.poi-pop .date-field input').first();
const endDate = p.locator('.poi-pop .date-field input').nth(1);
ok((await endDate.isDisabled()) && !(await p.locator('.poi-pop .date-field').nth(1).locator('.clear').isVisible()), 'End date is disabled until a start date exists, and shows no clear button');
await startDate.fill('2026-11-20');
await p.hover('.poi-pop .date-field >> nth=0');
ok(await p.locator('.poi-pop .date-field').first().locator('.clear').isVisible(), 'a filled date shows a clear button');
await p.locator('.poi-pop .date-field').first().locator('.clear').click();
ok((await startDate.inputValue()) === '' && (await endDate.isDisabled()), 'clearing the start date empties it and disables the end date again');
await startDate.fill('2026-11-21');
await p.click('.poi-pop form button[type=submit]'); await p.waitForTimeout(400);
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((i) => i.id === 'c'));
ok(saved.day === 7 && saved.date === '2026-11-21', 'values set through the new controls are saved (Day 7, 21 Nov)');
ok((await p.locator('.poi-pin .seq').filter({ hasText: 'D7' }).count()) === 1, 'the pin of the edited marker shows its new day label straight away');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok((await p.locator('#dist-card .num-field').count()) === 1, 'the max range field is a modern number field too');
await p.locator('#dist-card .num-field .inc').click();
ok((await p.inputValue('#dist-max')) === '0.1', 'its + starts at the 0.1 minimum');
await p.fill('#dist-max', ''); await p.locator('#dist-max').blur(); await p.waitForTimeout(200);

// ================= day and stop labels
const seqs = await p.$$eval('.poi-pin .seq', (e) => e.map((x) => x.textContent).sort());
ok(seqs.join() === ['#4', 'D1', 'D2·3', 'D7'].sort().join(), 'pins show D2·3 (day and stop), #4 (stop only), D1 (day only), and nothing for a marker with neither: ' + seqs);
const rows = await p.$$eval('#poi-list .poi-item', (r) => Object.fromEntries(r.map((x) => [x.querySelector('b').textContent.replace(/\s*Unverified/, ''), x.querySelector('small').textContent])));
ok(/Day 2 · Stop 3/.test(rows.Bridge) && /Stop 4/.test(rows['Lake Hotel']) && /Day 1/.test(rows.Early) && !/Day|Stop/.test(rows.Plain === undefined ? '' : rows.Plain), 'list rows (grouped by date) say "Day 2 · Stop 3", "Stop 4", "Day 1": ' + JSON.stringify(rows));
await p.click('#poi-list .poi-item:has-text("Bridge")'); await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Bridge', null, { timeout: 8000 }); await p.waitForTimeout(400);
ok(/Day 2 · Stop 3/.test(await p.textContent('.poi-pop .pop-type')), 'the marker window shows "Day 2 · Stop 3" under the type');
await ctx.close();

({ ctx, p } = await session(dayOnly, { width: 1200, height: 800 }));
await open(p, 'poi');
const dayRows = await p.$$eval('#poi-list .poi-item', (r) => r.map((x) => x.querySelector('small').textContent));
ok((await p.locator('#poi-list .day-head').first().textContent()) === 'Day 2' && dayRows.every((t) => /^Stop \d/.test(t)), 'under a "Day 2" heading the rows only add the stop: ' + dayRows.join(' | '));
ok((await p.locator('#poi-list .poi-item').first().locator('b').textContent()) === 'Park', 'and they are ordered by stop');
await ctx.close();

// ================= search box and dock never overlap
const widths = [320, 360, 390, 430, 520, 600, 700, 760, 900, 1200];
const bad = [];
for (const w of widths) {
  const s = await session(dated, { width: w, height: 780 }, w <= 520);
  if (await s.p.evaluate(() => !document.getElementById('panel').hidden)) await s.p.click('#panel-close');
  await s.p.waitForTimeout(300);
  const r = await s.p.evaluate(() => { const a = document.querySelector('.search input').getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect(); const z = document.querySelector('.leaflet-control-zoom')?.getBoundingClientRect(); return { sr: a.right, sl: a.left, sw: a.width, dl: d.left, dr: d.right, zr: z ? z.right : 0, w: innerWidth }; });
  if (!(r.sr <= r.dl - 4 && r.dr <= r.w && r.sl >= r.zr && r.sw >= 110)) bad.push(`${w}px: ${JSON.stringify(r)}`);
  await s.ctx.close();
}
ok(bad.length === 0, 'search box and dock never overlap, and stay on screen, from 320 to 1200 px wide' + (bad.length ? ': ' + bad.join(' | ') : ''));

// ================= phone: panel height and marker window
({ ctx, p } = await session(dated, { width: 390, height: 780 }, true));
await open(p, 'poi'); await p.waitForTimeout(400);
const ph = await p.evaluate(() => ({ body: document.querySelector('#panel > .sp-body').clientHeight, panel: document.getElementById('panel').clientHeight }));
ok(ph.body > ph.panel * 0.6, 'on a phone the tab content has most of the panel height (' + ph.body + ' of ' + ph.panel + ' px)');
await p.click('#poi-list .poi-item:has-text("Bridge")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(1500);
const pop = await p.evaluate(() => { const r = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect(); const c = document.querySelector('.leaflet-popup-content'); const pin = document.querySelector('.poi-pin').getBoundingClientRect(); return { h: r.height, top: r.top, bottom: r.bottom, vh: innerHeight, scrolls: c.scrollHeight > c.clientHeight + 1, pinTop: pin.top, pinBottom: pin.bottom, panelHidden: document.getElementById('panel').hidden }; });
ok(pop.h <= pop.vh * 0.5 && pop.top >= 0, 'the marker window takes at most half the screen (' + Math.round(pop.h) + ' of ' + pop.vh + ' px) and is fully on screen');
ok(pop.scrolls || pop.h < pop.vh * 0.45, 'what does not fit scrolls inside the window');
ok(pop.pinBottom <= pop.vh && pop.pinTop >= 0, 'the pin itself stays on screen');
const before = await p.evaluate(() => { const r = document.querySelector('.poi-pin').getBoundingClientRect(); return { x: r.x, y: r.y }; });
const y0 = Math.min(pop.vh - 60, Math.round(pop.pinBottom + 30));
await p.mouse.move(40, y0); await p.mouse.down(); await p.mouse.move(40, y0 - 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
const after = await p.evaluate(() => { const r = document.querySelector('.poi-pin')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; });
ok(after && Math.abs(after.y - before.y) > 20, 'the map can be dragged with the window open (the pin moved ' + (after ? Math.round(before.y - after.y) : '?') + ' px)');
await p.screenshot({ path: `${SP}/ui-phone-popup.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
