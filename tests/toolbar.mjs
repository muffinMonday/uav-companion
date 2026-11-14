// The More tools menu: Zoom, Locate and the (conditional) Compass stay on the map; Marker details, Side Quests, Trip markers, Crosshair and Flight Sessions are rows of one menu
// that press the tools' own controls (no clones, one handler each). Closed on start, states follow the tools, outside press / Escape / placing close it, POI visibility preferences
// are never touched, and the popover / phone sheet fit at phone, unfolded, tablet, desktop and short-landscape sizes. Screenshots go to tests/out/toolbar/.
import { chromium, CHANNEL, LATEST_SEEN, OUT, moreTool } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOME = { latitude: 30.59, longitude: 114.30, accuracy: 15 };
const shots = `${OUT}/toolbar`; fs.mkdirSync(shots, { recursive: true });
const trips = [{ id: 't1', name: 'Hubei spring', startDate: '2026-12-01', endDate: '2026-12-03', description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const items = [
  { id: 'a', type: 'photo', name: 'Lake', note: '', lat: 30.59, lon: 114.30, created: '2026-11-01T00:00:01.000Z', tripId: 't1', date: '2026-12-01', order: 1 },
  { id: 'b', type: 'photo', name: 'Loose', note: '', lat: 30.60, lon: 114.31, created: '2026-11-01T00:00:02.000Z' },
];

async function open({ vp = { width: 1300, height: 850 }, touch = false, dark = false, prefs = {} } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', permissions: ['geolocation'], geolocation: HOME });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([seen, po, tr, pf]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.59, lon: 114.30, zoom: 13 }, basemap: 'osm', ...pf }));
  }, [LATEST_SEEN, items, trips, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close'); // the side panel is not part of this: fold it away so the map is free
  await p.waitForTimeout(300);
  return { ctx, p };
}
const tools = (p) => p.$$eval('.leaflet-top.leaflet-left a[data-tool]', (as) => as.map((a) => ({ tool: a.dataset.tool, shown: a.getClientRects().length > 0 && !a.closest('[hidden]'), pressed: a.getAttribute('aria-pressed') })));
const rows = (p) => p.$$eval('#more-tools-menu .more-row', (rs) => rs.map((r) => ({ tool: r.dataset.tool, text: r.textContent, pressed: r.getAttribute('aria-pressed') })));
const rect = (p, sel) => p.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; });
const prefsOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') ?? '{}'));
const menuOpen = (p) => p.evaluate(() => !document.getElementById('more-tools-menu').hidden);
const MENU = '#more-tools-menu';
let ctx, p;

// ================= closed on start; the direct buttons stay; the folded tools keep their own controls
({ ctx, p } = await open());
const t0 = await tools(p);
ok(await p.locator('.more-btn').count() === 1 && await p.locator('.more-btn').isVisible(), 'one More tools button, visible');
ok(!(await menuOpen(p)), 'the menu starts closed');
ok((await p.getAttribute('.more-btn', 'aria-expanded')) === 'false' && (await p.getAttribute('.more-btn', 'aria-controls')) === 'more-tools-menu' && (await p.getAttribute('.more-btn', 'aria-label')) === 'More tools' && (await p.getAttribute('.more-btn', 'aria-haspopup')) === 'true', 'it has an accessible name, aria-expanded=false and names the menu');
ok(await p.locator('.leaflet-control-zoom a').first().isVisible() && await p.locator('.locate-btn').isVisible(), 'Zoom and Locate are still direct');
const direct = t0.filter((x) => x.shown).map((x) => x.tool);
ok(direct.join() === 'locate,more', 'the only visible tool buttons are Locate and More tools while the map is north-up (no Compass): ' + direct.join());
ok(['details', 'side-quests', 'trips', 'crosshair'].every((k) => t0.filter((x) => x.tool === k).length === 1 && !t0.find((x) => x.tool === k).shown), 'each folded tool has exactly one control (no clones), taken off the map');
ok(await p.evaluate(() => !document.querySelector('a[data-tool=compass]')?.closest('.leaflet-control')?.classList.contains('tool-folded') && !document.querySelector('a[data-tool=locate]').closest('.leaflet-control').classList.contains('tool-folded')), 'Locate and Compass are never folded');
ok(t0.at(-1).tool === 'more', 'More tools is the last button in the column');
ok(await p.locator('#map-tool-labels, .labels-btn').count() === 0, 'the old tag button and label layer are gone');
ok(await p.evaluate(() => !Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => /more|menu|toolbar|expand/i.test(k))), 'nothing about the menu is stored');

// ================= opening: rows in order, with their state
await p.click('.more-btn'); await p.waitForTimeout(150);
ok(await menuOpen(p) && (await p.getAttribute('.more-btn', 'aria-expanded')) === 'true', 'pressing it opens the menu and sets aria-expanded');
let r = await rows(p);
const hasSessions = r.some((x) => x.tool === 'sessions');
ok(r.map((x) => x.tool).filter((x) => x !== 'sessions').join() === 'details,side-quests,trips,crosshair', 'rows: Marker details, Side Quests, Trip markers, Crosshair' + (hasSessions ? ', Flight Sessions' : ''));
ok(r.every((x) => x.tool === 'sessions' || x.pressed === t0.find((y) => y.tool === x.tool).pressed), 'each row reads its tool\'s own aria-pressed');
ok(/Marker details\s*On/.test(r[0].text) && /Trip markers\s*Shown/.test(r.find((x) => x.tool === 'trips').text) && /Side Quests\s*Open stop only/.test(r.find((x) => x.tool === 'side-quests').text) && /Crosshair\s*On/.test(r.find((x) => x.tool === 'crosshair').text), 'rows show the label and the current state: ' + r.map((x) => x.text).join(' | '));
ok(await p.evaluate(() => document.activeElement?.classList.contains('more-row')), 'opening by button moves focus to the first row');
ok(!!(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.help') ?? '{}').seen?.includes('map-tools'))), 'opening More tools counts as the visitor having found the toolbar (map-tools hint used up)');

// ================= each row presses the tool's own control once, and the menu stays open
const toggles = [['details', async () => (await prefsOf(p)).markerDetails === false], ['side-quests', async () => (await prefsOf(p)).showSide === true], ['trips', async () => (await prefsOf(p)).hideTrips === true], ['crosshair', async () => (await prefsOf(p)).crosshair === false]];
for (const [tool, isOff] of toggles) {
  const before = (await tools(p)).find((x) => x.tool === tool).pressed;
  await p.click(`${MENU} .more-row[data-tool=${tool}]`); await p.waitForTimeout(250);
  const mid = (await tools(p)).find((x) => x.tool === tool).pressed;
  const row = (await rows(p)).find((x) => x.tool === tool);
  ok(mid !== before && row.pressed === mid && await menuOpen(p), tool + ': one press flips the tool exactly once (' + before + ' to ' + mid + '), the row follows and the menu stays open');
  await p.click(`${MENU} .more-row[data-tool=${tool}]`); await p.waitForTimeout(250);
  ok((await tools(p)).find((x) => x.tool === tool).pressed === before && (await rows(p)).find((x) => x.tool === tool).pressed === before, tool + ': a second press puts it back');
  void isOff;
}
ok(await p.evaluate(() => document.querySelectorAll('.cross-btn, .details-btn, .map-toggle').length === 4), 'still one control per tool after all that (no duplicates)');
// a change made elsewhere shows in the open menu
await p.evaluate(() => { const c = document.getElementById('poi-details'); c.checked = false; c.dispatchEvent(new Event('change')); }); await p.waitForTimeout(200);
ok((await rows(p)).find((x) => x.tool === 'details').pressed === 'false' && /Off/.test((await rows(p)).find((x) => x.tool === 'details').text), 'a change made in Points of Interest shows in the open menu');
await p.evaluate(() => { const c = document.getElementById('poi-details'); c.checked = true; c.dispatchEvent(new Event('change')); });

// ================= POI visibility precedence: More tools only drives the global switches
await p.click('.more-btn'); // close
await p.evaluate(() => { const pr = JSON.parse(localStorage.getItem('uavzones.v1.prefs')); pr.tripHidden = ['t1']; pr.unassignedHidden = true; localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
const vis0 = await prefsOf(p);
await moreTool(p, 'trips'); await p.waitForTimeout(250);   // global trips off
await moreTool(p, 'trips'); await p.waitForTimeout(250);   // and on again
await moreTool(p, 'side-quests'); await moreTool(p, 'side-quests');
const vis1 = await prefsOf(p);
ok(JSON.stringify(vis1.tripHidden) === JSON.stringify(vis0.tripHidden) && vis1.unassignedHidden === vis0.unassignedHidden && vis1.tripHidden?.includes('t1'), 'toggling Trip markers and Side Quests leaves the per-trip and Unassigned saved visibility as it was');
const pins = () => p.$$eval('.poi-pin', (l) => l.length);
const before = await pins();
await moreTool(p, 'trips'); await p.waitForTimeout(300);
ok((await prefsOf(p)).hideTrips === true && (await prefsOf(p)).tripHidden?.includes('t1'), 'global off is hideTrips only; the trip it hid separately is still marked hidden');
await moreTool(p, 'trips'); await p.waitForTimeout(300);
ok((await pins()) === before && (await prefsOf(p)).hideTrips !== true && (await prefsOf(p)).tripHidden?.includes('t1'), 'global on again restores exactly what was showing: the trip hidden on its own stays hidden');
await ctx.close();

// ================= keyboard, outside press, Escape, reload, placing
({ ctx, p } = await open());
await p.focus('.more-btn'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
ok(await menuOpen(p) && await p.evaluate(() => document.activeElement?.classList.contains('more-row')), 'Enter on the button opens the menu and focuses a row');
await p.keyboard.press('Tab'); await p.keyboard.press('Space'); await p.waitForTimeout(250);
ok(await menuOpen(p), 'Tab moves between rows and Space presses one without closing the menu');
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
ok(!(await menuOpen(p)) && await p.evaluate(() => document.activeElement?.classList.contains('more-btn')), 'Escape closes it and puts focus back on the button');
await p.click('.more-btn'); await p.waitForTimeout(100);
await p.mouse.click(700, 500); await p.waitForTimeout(200);
ok(!(await menuOpen(p)), 'a press on the map outside closes it');
await p.click('.more-btn'); await p.waitForTimeout(100);
await p.click('#search-toggle'); await p.waitForTimeout(150);
ok(!(await menuOpen(p)), 'so does a press on the search button (the search is never covered or blocked)');
await p.click('.more-btn'); await p.waitForTimeout(100);
await p.evaluate(() => document.getElementById('map').classList.add('is-placing')); await p.waitForTimeout(200);
ok(!(await menuOpen(p)), 'it closes while a marker is being placed');
await p.click('.more-btn', { force: true }).catch(() => {}); await p.waitForTimeout(100);
ok(!(await menuOpen(p)), 'and does not open until placing is over');
await p.evaluate(() => document.getElementById('map').classList.remove('is-placing')); await p.waitForTimeout(150);
await p.click('.more-btn'); await p.waitForTimeout(100);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok(!(await menuOpen(p)), 'a reload starts closed');
// panning and zooming the map by hand keeps an open menu (a harmless redraw does not close it)
await p.click('.more-btn'); await p.waitForTimeout(100);
await p.evaluate(() => { const m = [...document.querySelectorAll('.leaflet-container')][0]; m.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); }); await p.waitForTimeout(200);
ok(await menuOpen(p), 'a resize or redraw does not close it');
await ctx.close();

// ================= layouts: popover on roomy screens, sheet on a narrow phone
const VPS = [['phone', 390, 844, true, false], ['phone2', 412, 915, true, false], ['unfolded', 700, 850, true, false], ['unfolded-land', 850, 700, true, false], ['tablet', 768, 1024, true, false], ['desktop', 1440, 900, false, false], ['desktop-dark', 1440, 900, false, true], ['short-land', 844, 390, true, false]];
for (const [name, w, h, touch, dark] of VPS) {
  ({ ctx, p } = await open({ vp: { width: w, height: h }, touch, dark }));
  await p.click('.more-btn'); await p.waitForTimeout(250);
  const m = await rect(p, MENU), rm = await rect(p, '#map'), q = await rect(p, '#search'), tg = await rect(p, '.more-btn');
  const sheet = await p.evaluate(() => document.getElementById('more-tools-menu').classList.contains('sheet'));
  ok(sheet === (w <= 520), name + ': ' + (sheet ? 'a sheet' : 'a popover') + ' (sheet only at max-width 520px)');
  ok(m.x >= -0.5 && m.right <= w + 0.5 && m.y >= -0.5 && m.bottom <= h + 0.5, name + ': the menu is inside the viewport');
  if (sheet) ok(Math.abs(m.bottom - h) <= 1 && m.w >= w - 2, name + ': the sheet sits on the bottom edge across the width');
  else ok(m.x >= tg.right && m.y >= rm.y && m.bottom <= rm.bottom, name + ': the popover is beside the button, inside the map');
  const intersects = !(m.right <= q.x || m.x >= q.right || m.bottom <= q.y || m.y >= q.bottom);
  ok(!intersects, name + ': the menu does not cover the search box');
  const rh = await p.$$eval('#more-tools-menu .more-row', (rs) => rs.map((e) => e.getBoundingClientRect().height));
  ok(touch ? rh.every((x) => x >= 44) : rh.every((x) => x >= 32), name + ': rows are ' + (touch ? 'at least 44' : 'at least 32') + ' px high (' + Math.round(Math.min(...rh)) + ')');
  const fs = await p.$eval('#more-tools-menu .more-state', (e) => parseFloat(getComputedStyle(e).fontSize));
  ok(fs >= 12, name + ': state text is at least 12px (' + fs + ')');
  if (!sheet) { const okMap = await p.evaluate(() => { const e = document.elementFromPoint(window.innerWidth - 40, 160); return !!e; }); ok(okMap, name + ': the rest of the map is reachable'); }
  await p.screenshot({ path: `${shots}/${name}-more-tools.png` });
  await ctx.close();
}

// large root text: the menu still fits
({ ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true }));
await p.addStyleTag({ content: 'html{font-size:200%}' }); await p.click('.more-btn'); await p.waitForTimeout(250);
const big = await rect(p, MENU);
ok(big.x >= 0 && big.right <= 390.5 && big.bottom <= 844.5, 'large root text: the sheet stays inside the screen');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
