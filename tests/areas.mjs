// Community flying areas, Phase 1 (src/areas/): in a real browser. Desktop mouse and phone touch: polygon and rectangle drawing, point dragging, undo, finish,
// cancel and discard, validation feedback, details dialog, local persistence across reloads, edit / duplicate / export / import / delete, Pilot setup spots (inside
// only, shown from zoom 13), and the regressions: no hold-to-check or Inspect while drawing, panning and pinching never add points, the point check, saved markers
// and the More tools menu are unchanged, and nothing leaves the browser. Screenshots go to tests/out/areas/.
import { chromium, CHANNEL, LATEST_SEEN, OUT, moreTool } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/areas`; fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const KEY = 'uavzones.v1.areas';
const POIS = { v: 1, items: [{ id: 'poi1', type: 'photo', name: 'Marina', note: '', lat: 1.2879, lon: 103.8586, created: '2026-11-01T00:00:00.000Z' }] };
const b = await chromium.launch({ channel: CHANNEL });
const requests = [];

async function open({ vp = { width: 1300, height: 850 }, touch = false, dark = false, storage = {}, once = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([seen, st, pois]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.82, zoom: 16 }, basemap: 'osm', holdHint: true }));
    localStorage.setItem('uavzones.v1.pois', JSON.stringify(pois));
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
  }, [LATEST_SEEN, storage, POIS]);
  const p = await ctx.newPage();
  p.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.waitForTimeout(250);
  return { ctx, p };
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
const mapBox = (p) => p.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const bar = '#area-bar', panel = '#areas-panel';
const act = (p, name, root = bar) => p.locator(`${root} [data-act="${name}"]`);
const barText = (p) => p.$eval(`${bar} .area-bar-status`, (e) => e.textContent);
const handles = (p) => p.locator('.area-vtx:not(.mid)').count();
const spotsOnMap = (p) => p.locator('.leaflet-marker-pane .area-spot').count();
const openPanel = async (p) => { if (await p.locator(panel).isHidden()) await moreTool(p, 'areas'); await p.waitForSelector(`${panel}:not([hidden])`); };
const clickMap = async (p, dx, dy) => { const m = await mapBox(p); await p.mouse.click(m.x + m.w / 2 + dx, m.y + m.h / 2 + dy); await p.waitForTimeout(80); };
const SQ = [[-120, -80], [120, -80], [120, 100], [-120, 100]]; // a ~230 x 180 px quadrilateral around the map centre
async function drawPolygon(p, pts = SQ, { finish = true } = {}) {
  await openPanel(p); await act(p, 'draw-polygon', panel).click(); await p.waitForSelector(`${bar}:not([hidden])`);
  for (const [dx, dy] of pts) await clickMap(p, dx, dy);
  if (finish) await act(p, 'finish').click();
}
async function saveWith(p, name, description = '') {
  await act(p, 'details').click(); await p.waitForSelector('dialog.area-dialog[open]');
  await p.fill('#area-name', name); await p.fill('#area-desc', description);
  await p.click('dialog.area-dialog [data-act="save"]'); await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
}
const holdAt = async (p, dx, dy, ms = 2400) => { const m = await mapBox(p); await p.mouse.move(m.x + m.w / 2 + dx, m.y + m.h / 2 + dy); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); await p.waitForTimeout(500); };
let ctx, p;

// ================= desktop: drawing a polygon
({ ctx, p } = await open());
{
  const rows = await p.$$eval('.leaflet-top.leaflet-left a[data-tool]', (as) => as.map((a) => a.dataset.tool));
  ok(rows.includes('areas'), 'the areas tool is a map control (folded into More tools)');
  await p.click('.more-btn');
  ok(await p.locator('#more-tools-menu .more-row[data-tool="areas"]').count() === 1 && /My flying areas/.test(await p.locator('#more-tools-menu .more-row[data-tool="areas"]').innerText()), 'More tools has a My flying areas row');
  await p.click('.more-btn');
  await openPanel(p);
  ok(/stay in this browser/.test(await p.locator(`${panel} .areas-intro`).innerText()) && /not flight authorization/.test(await p.locator(`${panel} .areas-intro`).innerText()), 'the panel says drafts stay in this browser and are not flight authorization');
  ok(await p.locator(`${panel} .areas-empty`).count() === 1, 'no areas yet');
  await act(p, 'draw-polygon', panel).click();
  ok(await p.locator(bar).isVisible() && await p.locator(panel).isHidden() && await p.$eval('#map', (e) => e.classList.contains('is-drawing')), 'drawing opens the bar, closes the panel and marks the map');
  ok(/Tap the map to add points/.test(await barText(p)), 'the bar says how to draw');
  await clickMap(p, ...SQ[0]); await clickMap(p, ...SQ[1]);
  ok(await handles(p) === 2 && await act(p, 'finish').isDisabled(), 'two taps: two points, Finish not yet possible');
  await clickMap(p, ...SQ[2]);
  ok(await handles(p) === 3 && await act(p, 'finish').isEnabled() && /3 points, \d/.test(await barText(p)), 'three taps: Finish is on and the area is shown');
  await act(p, 'undo').click();
  ok(await handles(p) === 2, 'Undo removes the last point');
  await clickMap(p, ...SQ[2]);
  await act(p, 'centre').click();
  ok(await handles(p) === 4, 'Add point at map centre adds a point without a precise tap');
  await act(p, 'undo').click();
  // a tap on an existing point is not a new point
  await clickMap(p, ...SQ[2]);
  ok(await handles(p) === 3, 'a tap on an existing handle adds nothing');
  await clickMap(p, ...SQ[3]);
  await p.screenshot({ path: `${shots}/desktop-drawing.png` });
  // hold and right-click do not start a point check while drawing; holding does not add points; plain panning does not add points
  await holdAt(p, 40, 20);
  ok(await p.locator('.leaflet-popup').count() === 0 && await handles(p) === 4, 'press-and-hold while drawing: no point check, no new point');
  { const m = await mapBox(p); await p.mouse.click(m.x + m.w / 2 + 300, m.y + m.h / 2 + 300, { button: 'right' }); await p.waitForTimeout(400); }
  ok(await p.locator('.leaflet-popup').count() === 0 && await handles(p) === 4, 'right-click while drawing: no point check');
  { const m = await mapBox(p); await p.mouse.move(m.x + 200, m.y + 200); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(m.x + 200 + i * 8, m.y + 200 + i * 5); await p.mouse.up(); await p.waitForTimeout(300); }
  ok(await handles(p) === 4, 'dragging the map to pan adds no point');
  ok(await p.locator('.hold-ring').count() === 0 && await p.locator('.toast:visible').count() === 0, 'no hold ring and no "press and hold" hint appear while drawing');
  await act(p, 'finish').click();
  ok(await p.locator('.area-vtx.mid').count() === 4 && await act(p, 'details').isVisible() && await act(p, 'finish').count() === 0, 'Finish: midpoint handles and Details appear');
  // vertex editing: select + delete, drag, insert
  await p.locator('.area-vtx:not(.mid)').nth(0).click();
  ok(await act(p, 'delete').isEnabled(), 'selecting a point enables Delete point');
  await act(p, 'delete').click();
  ok(await handles(p) === 3, 'Delete point removes it');
  await act(p, 'undo').click();
  ok(await handles(p) === 4, 'Undo restores a deleted point');
  const h0 = await p.locator('.area-vtx:not(.mid)').nth(2).boundingBox();
  await p.mouse.move(h0.x + 15, h0.y + 15); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(h0.x + 15 + i * 6, h0.y + 15 - i * 3); await p.mouse.up(); await p.waitForTimeout(200);
  const h1 = await p.locator('.area-vtx:not(.mid)').nth(2).boundingBox();
  ok(Math.abs(h1.x - h0.x - 48) < 6 && Math.abs(h1.y - h0.y + 24) < 6 && await handles(p) === 4, 'dragging a point moves it');
  await act(p, 'undo').click();
  const mid = await p.locator('.area-vtx.mid').nth(0).boundingBox();
  await p.mouse.click(mid.x + mid.width / 2, mid.y + mid.height / 2); await p.waitForTimeout(150);
  ok(await handles(p) === 5, 'tapping a midpoint handle adds a point');
  await act(p, 'undo').click();
  ok(await handles(p) === 4, 'and Undo takes it away');
  // cancel: dirty drawing asks first
  await act(p, 'cancel').click();
  ok(await p.locator(bar).isVisible() && /Discard this drawing/.test(await barText(p)) && await act(p, 'discard').isVisible(), 'Cancel on unsaved work asks before discarding');
  await act(p, 'keep').click();
  ok(await handles(p) === 4, 'Keep editing returns to the drawing');
  await p.keyboard.press('Escape');
  ok(/Discard this drawing/.test(await barText(p)), 'Escape asks too');
  await p.keyboard.press('Escape');
  ok(!/Discard this drawing/.test(await barText(p)), 'a second Escape goes back to drawing');
  await act(p, 'cancel').click(); await act(p, 'discard').click();
  ok(await p.locator(bar).isHidden() && await p.locator(panel).isVisible() && await p.locator('.area-vtx').count() === 0 && !(await p.$eval('#map', (e) => e.classList.contains('is-drawing'))), 'Discard ends the session, clears the map and returns to the panel');
  ok((await stored(p)) === null, 'nothing was saved by a cancelled drawing');
}
await ctx.close();

// ================= desktop: validation, save, persistence, edit, duplicate, export, delete
({ ctx, p } = await open());
{
  await drawPolygon(p, [[-120, -80], [120, 100], [120, -80], [-120, 100]], { finish: false });
  ok(/crosses|touches/.test(await barText(p)) && await act(p, 'finish').isDisabled(), 'a bow-tie shows why it cannot be finished');
  await p.screenshot({ path: `${shots}/desktop-invalid.png` });
  await act(p, 'undo').click(); await act(p, 'undo').click(); await act(p, 'undo').click(); await clickMap(p, 120, -80); await clickMap(p, 120, 100); await clickMap(p, -120, 100);
  await act(p, 'finish').click();
  await act(p, 'details').click(); await p.waitForSelector('dialog.area-dialog[open]');
  await p.click('dialog.area-dialog [data-act="save"]');
  ok(await p.locator('dialog.area-dialog[open]').count() === 1 && /name is required/i.test(await p.locator('.area-errors').innerText()), 'saving without a name is refused with a message, the dialog stays');
  ok(await p.getAttribute('#area-name', 'maxlength') === '80' && await p.getAttribute('#area-desc', 'maxlength') === '500', 'name 80 / description 500 limits on the fields');
  await p.fill('#area-name', 'Marina lawn'); await p.fill('#area-desc', 'Open grass <b>by</b> the water');
  ok(/11 \/ 80/.test(await p.locator('#area-name-count').innerText()), 'the name counter counts characters');
  await p.screenshot({ path: `${shots}/desktop-dialog.png` });
  await p.click('dialog.area-dialog [data-act="back"]');
  await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
  ok(await p.locator(bar).isVisible() && await p.locator('.area-vtx').count() > 0, 'Back to the map closes the dialog and keeps the drawing');
  await act(p, 'details').click(); await p.waitForSelector('dialog.area-dialog[open]');
  ok(await p.inputValue('#area-name') === 'Marina lawn', 'the typed name is kept when the dialog is reopened');
  await p.click('dialog.area-dialog [data-act="save"]'); await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
  const s1 = await stored(p);
  ok(s1?.v === 1 && s1.areas.length === 1 && s1.areas[0].name === 'Marina lawn' && s1.areas[0].description === 'Open grass <b>by</b> the water' && s1.areas[0].geometry.type === 'Polygon' && s1.areas[0].geometry.coordinates[0].length === 5, 'saved to uavzones.v1.areas as a closed GeoJSON polygon');
  ok(await p.locator(bar).isHidden() && await p.locator(panel).isVisible() && await p.locator(`${panel} .area-item`).count() === 1, 'after saving the panel lists the area');
  ok(await p.locator(`${panel} .area-item-name`).innerText() === 'Marina lawn' && await p.locator(`${panel} .area-item-desc b`).count() === 0, 'the description is shown as text, never as HTML');
  ok(await p.locator('.leaflet-overlay-pane path.community-area, .leaflet-community-areas-pane path.community-area').count() >= 1, 'the area is drawn on the map in its own style');
  await p.screenshot({ path: `${shots}/desktop-saved.png` });
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')))) === JSON.stringify(POIS), 'saved markers (uavzones.v1.pois) were not touched');
  // persistence
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
  await openPanel(p);
  ok(await p.locator(`${panel} .area-item`).count() === 1 && await p.locator('.community-area').count() >= 1, 'after a reload the area is still listed and drawn');
  // point check still works over the community area, and ignores it
  await p.click('#panel-close').catch(() => {});
  await p.click(`${panel} [data-act="close"]`);
  await holdAt(p, 0, 0);
  ok(await p.locator('.leaflet-popup').count() === 1, 'press-and-hold inside a community area still runs the normal point check');
  const txt = await p.locator('.leaflet-popup').innerText();
  ok(!/community|recommend|Marina lawn/i.test(txt), 'the point-check result never mentions or depends on the community area');
  await p.keyboard.press('Escape');
  // edit: move a point, save keeps id and name
  await openPanel(p);
  const id0 = s1.areas[0].id, before = JSON.stringify(s1.areas[0].geometry);
  await act(p, 'edit', panel).first().click();
  ok(await p.locator(bar).isVisible() && /Editing/.test(await p.locator('.area-bar-title').innerText()) && await handles(p) === 4 && await p.locator('.community-area:not(.is-draft)').count() === 0, 'Edit reopens the area in the editor (the plain copy is hidden)');
  const e0 = await p.locator('.area-vtx:not(.mid)').nth(1).boundingBox();
  await p.mouse.move(e0.x + 15, e0.y + 15); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(e0.x + 15 + i * 5, e0.y + 15); await p.mouse.up(); await p.waitForTimeout(200);
  await act(p, 'cancel').click();
  ok(/Discard/.test(await barText(p)), 'cancelling an edit asks first');
  await act(p, 'discard').click();
  ok(JSON.stringify((await stored(p)).areas[0].geometry) === before, 'a discarded edit leaves the stored area exactly as it was');
  await act(p, 'edit', panel).first().click();
  const e1 = await p.locator('.area-vtx:not(.mid)').nth(1).boundingBox();
  await p.mouse.move(e1.x + 15, e1.y + 15); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(e1.x + 15 + i * 5, e1.y + 15); await p.mouse.up(); await p.waitForTimeout(200);
  await act(p, 'details').click(); await p.waitForSelector('dialog.area-dialog[open]');
  ok(await p.inputValue('#area-name') === 'Marina lawn', 'the editor form starts with the saved name');
  await p.fill('#area-name', 'Marina lawn 2'); await p.click('dialog.area-dialog [data-act="save"]'); await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
  const s2 = await stored(p);
  ok(s2.areas.length === 1 && s2.areas[0].id === id0 && s2.areas[0].name === 'Marina lawn 2' && JSON.stringify(s2.areas[0].geometry) !== before, 'a saved edit updates the same area (id kept, shape and name changed)');
  // duplicate, export, delete
  await act(p, 'duplicate', panel).first().click();
  ok((await stored(p)).areas.length === 2 && /Copy of Marina lawn 2/.test(await p.locator(`${panel} .area-item-name`).nth(1).innerText()), 'Duplicate adds a copy');
  { const [dl] = await Promise.all([p.waitForEvent('download'), act(p, 'export', panel).first().click()]); const t = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(t.type === 'FeatureCollection' && t.features[0].geometry.type === 'Polygon' && t.features[0].properties.name === 'Marina lawn 2' && /\.geojson$/.test(dl.suggestedFilename()), 'Export downloads valid GeoJSON for one area'); }
  { const [dl] = await Promise.all([p.waitForEvent('download'), act(p, 'export-all', panel).click()]); const t = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(t.features.length === 2 && dl.suggestedFilename() === 'uav-flying-areas.geojson', 'Export all downloads every area');
    fs.writeFileSync(`${shots}/export.geojson`, JSON.stringify(t)); }
  await act(p, 'delete', panel).nth(1).click();
  ok(await act(p, 'confirm-delete', panel).count() === 1 && (await stored(p)).areas.length === 2, 'Delete asks to confirm, nothing deleted yet');
  await act(p, 'keep', panel).click();
  ok((await stored(p)).areas.length === 2, 'Keep leaves the area');
  await act(p, 'delete', panel).nth(1).click(); await act(p, 'confirm-delete', panel).click();
  ok((await stored(p)).areas.length === 1, 'confirmed delete removes it');
  // import: valid, bad, mixed
  await p.setInputFiles('#areas-file', `${shots}/export.geojson`); await p.waitForTimeout(400);
  ok((await stored(p)).areas.length === 3 && /2 areas imported/.test(await p.locator('#toast').innerText()), 'importing the exported file adds both areas as new ones');
  fs.writeFileSync(`${shots}/bad.json`, '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Big"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}},{"type":"Feature","properties":{"name":"Pt"},"geometry":{"type":"Point","coordinates":[1,1]}}]}');
  await p.setInputFiles('#areas-file', `${shots}/bad.json`); await p.waitForTimeout(400);
  ok((await stored(p)).areas.length === 3 && /0 areas imported\. 2 skipped/.test(await p.locator('#toast').innerText()), 'an oversized polygon and a Point are skipped with a message');
  fs.writeFileSync(`${shots}/junk.json`, 'not json at all');
  await p.setInputFiles('#areas-file', `${shots}/junk.json`); await p.waitForTimeout(400);
  ok(/Nothing imported/.test(await p.locator('#toast').innerText()) && (await stored(p)).areas.length === 3, 'a file that is not JSON is refused');
}
await ctx.close();

// ================= rectangle and Pilot setup spots
({ ctx, p } = await open());
{
  await openPanel(p); await act(p, 'draw-rect', panel).click();
  ok(/one corner/.test(await barText(p)), 'rectangle: asks for one corner');
  await clickMap(p, -150, -90);
  ok(/opposite corner/.test(await barText(p)) && await act(p, 'finish').count() === 0, 'rectangle: asks for the opposite corner, no Finish button');
  await clickMap(p, 150, 90);
  ok(await handles(p) === 4 && await p.locator('.area-vtx.mid').count() === 0 && await act(p, 'details').isVisible(), 'two corners complete a rectangle with four corner handles and no midpoint handles');
  const c = await p.locator('.area-vtx:not(.mid)').nth(2).boundingBox(); // NE
  await p.mouse.move(c.x + 15, c.y + 15); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(c.x + 15 + i * 8, c.y + 15 - i * 5); await p.mouse.up(); await p.waitForTimeout(200);
  ok(await handles(p) === 4, 'dragging a rectangle corner keeps four corners');
  const sw = await p.locator('.area-vtx:not(.mid)').nth(0).boundingBox(), se = await p.locator('.area-vtx:not(.mid)').nth(1).boundingBox(), nw = await p.locator('.area-vtx:not(.mid)').nth(3).boundingBox();
  ok(Math.abs(sw.y - se.y) < 2 && Math.abs(sw.x - nw.x) < 2, 'and it stays a rectangle');
  // setup spots
  await act(p, 'mode-spots').click();
  ok(await p.locator('.area-vtx').count() === 0 && await act(p, 'mode-spots').getAttribute('aria-pressed') === 'true', 'Setup spots mode hides the outline handles');
  await p.selectOption('.area-spot-type', 'shelter');
  await clickMap(p, 0, 0);
  ok(await p.locator('.area-spot-shelter').count() === 1, 'tapping inside adds a spot of the chosen type');
  await clickMap(p, 600, 0);
  ok(await p.locator('.area-spot').count() === 1 && /inside the area/.test(await barText(p)), 'tapping outside the area is refused with a message');
  const sp = await p.locator('.area-spot-shelter').boundingBox();
  await p.mouse.move(sp.x + 14, sp.y + 14); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(sp.x + 14 + i * 3, sp.y + 14 + i * 2); await p.mouse.up(); await p.waitForTimeout(200);
  const sp2 = await p.locator('.area-spot-shelter').boundingBox();
  ok(Math.abs(sp2.x - sp.x - 18) < 5 && Math.abs(sp2.y - sp.y - 12) < 5, 'a spot can be dragged inside the area');
  await p.mouse.move(sp2.x + 14, sp2.y + 14); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(sp2.x + 14 + i * 60, sp2.y + 14); await p.mouse.up(); await p.waitForTimeout(200);
  const sp3 = await p.locator('.area-spot-shelter').boundingBox();
  ok(Math.abs(sp3.x - sp2.x) < 3 && /inside the area/.test(await barText(p)), 'dragging a spot outside puts it back with a message');
  await p.selectOption('.area-spot-type', 'seating'); await clickMap(p, 50, 30);
  await act(p, 'spot-centre').click();
  ok(await p.locator('.area-spot').count() === 3, 'Add at map centre also adds a spot');
  await act(p, 'details').click(); await p.waitForSelector('dialog.area-dialog[open]');
  ok(await p.locator('.area-spot-row').count() === 3 && /3 of 10/.test(await p.locator('.area-sub').innerText()), 'the dialog lists the spots, 3 of 10');
  const first = p.locator('.area-spot-row').first();
  ok(await first.locator('input').getAttribute('maxlength') === '120', 'the spot note is limited to 120');
  await first.locator('input').fill('Covered pavilion with tables');
  await first.locator('select').selectOption('other');
  await p.locator('.area-spot-row').nth(2).getByRole('button', { name: /Remove spot 3/ }).click();
  ok(await p.locator('.area-spot-row').count() === 2, 'a spot can be removed in the dialog');
  await p.fill('#area-name', 'Pavilion rectangle'); await p.screenshot({ path: `${shots}/desktop-spots-dialog.png` });
  await p.click('dialog.area-dialog [data-act="save"]'); await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
  const a = (await stored(p)).areas[0];
  ok(a.drawKind === 'rectangle' && a.spots.length === 2 && a.spots[0].type === 'other' && a.spots[0].note === 'Covered pavilion with tables' && a.spots.every((s) => s.coordinates.length === 2), 'saved: rectangle kind and two spots with type and note');
  ok(await spotsOnMap(p) === 2, 'the spots are shown on the map at zoom 16');
  await p.locator('.area-spot').first().click(); await p.waitForSelector('.area-popup');
  ok(/Pilot setup spot in “Pavilion rectangle”/.test(await p.locator('.area-popup').innerText()) && /not flight authorization/.test(await p.locator('.area-popup').innerText()), 'a spot popup names its area and carries the disclaimer');
  // zoom threshold: reload (nothing selected), zoom out below 13
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  ok(await spotsOnMap(p) === 2, 'after a reload the spots show at zoom 16');
  const z0 = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).view.zoom); // the save fitted the map to the area, so read where it is
  ok(z0 >= 13, `the map is at zoom ${z0}`);
  for (let i = 0; i < z0 - 13; i++) { await p.click('.leaflet-control-zoom-out'); await p.waitForTimeout(350); }
  ok(await spotsOnMap(p) === 2, 'at zoom 13 the spots are still shown');
  await p.click('.leaflet-control-zoom-out'); await p.waitForFunction(() => document.querySelectorAll('.leaflet-marker-pane .area-spot').length === 0, null, { timeout: 4000 }).catch(() => {});
  ok(await spotsOnMap(p) === 0 && await p.locator('.community-area').count() >= 1, 'below zoom 13 the spots hide, the outline stays');
  await p.click('.leaflet-control-zoom-in'); await p.waitForTimeout(300);
  await openPanel(p); await act(p, 'show', panel).first().click(); await p.waitForTimeout(700);
  ok(await spotsOnMap(p) === 2, 'Show selects the area: its spots are shown whatever the zoom');
  // area switch off
  await openPanel(p); await p.uncheck('#areas-show-cb');
  ok(await p.locator('.community-area').count() === 0 && await spotsOnMap(p) === 0, 'Show my areas on the map off hides outlines and spots');
}
await ctx.close();

// ================= dark theme look
({ ctx, p } = await open({ dark: true }));
{
  await drawPolygon(p); await saveWith(p, 'Dark area');
  const col = await p.$eval('.community-area:not(.is-draft)', (e) => getComputedStyle(e).stroke);
  ok(/rgb\(182, 156, 255\)/.test(col), 'dark theme: the outline uses the lighter purple token');
  await p.screenshot({ path: `${shots}/dark-saved.png` });
}
await ctx.close();

// ================= corrupted and blocked storage in the browser
({ ctx, p } = await open({ storage: { [KEY]: '{broken' } }));
{
  await openPanel(p);
  ok(await p.locator(`${panel} .areas-warn`).count() === 1 && await p.locator(`${panel} .area-item`).count() === 0, 'corrupted storage: a notice and an empty list, no crash');
  ok(await p.evaluate(() => localStorage.getItem('uavzones.v1.areas.bak')) === '{broken', 'the unreadable data is kept in the backup key');
  await drawPolygon(p); await saveWith(p, 'After corruption');
  ok((await stored(p)).areas.length === 1, 'new areas save normally afterwards');
}
await ctx.close();
{
  const c2 = await b.newContext({ viewport: { width: 1300, height: 850 }, reducedMotion: 'reduce' });
  await c2.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await c2.addInitScript((seen) => { sessionStorage.__seeded || (localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen })), localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.82, zoom: 16 }, basemap: 'osm', holdHint: true })), sessionStorage.__seeded = '1');
    const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'uavzones.v1.areas') throw new DOMException('full', 'QuotaExceededError'); return real.call(this, k, v); }; }, LATEST_SEEN);
  const q = await c2.newPage(); q.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await q.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await q.waitForTimeout(700);
  if (await q.locator('#panel').isVisible()) await q.click('#panel-close');
  await drawPolygon(q); await saveWith(q, 'Memory only');
  ok(await q.locator(`${panel} .area-item`).count() === 1 && /export/i.test(await q.locator(`${panel} .areas-warn`).innerText()), 'storage that refuses writes: the area still works with an export warning');
  await c2.close();
}

// ================= phone, touch
({ ctx, p } = await open({ vp: { width: 390, height: 780 }, touch: true }));
{
  await p.click('.more-btn'); await p.click('#more-tools-menu .more-row[data-tool="areas"]'); await p.waitForSelector(`${panel}:not([hidden])`);
  const pr = await p.$eval(panel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, sheet: e.classList.contains('sheet') }; });
  ok(pr.sheet && pr.l >= 0 && pr.r <= 390 && pr.b <= 780, 'phone: the panel is a bottom sheet inside the screen');
  ok(await p.locator('#more-tools-menu').isHidden(), 'phone: More tools steps aside');
  await p.screenshot({ path: `${shots}/phone-panel.png` });
  await act(p, 'draw-polygon', panel).tap();
  await p.waitForSelector(`${bar}:not([hidden])`);
  const br = await p.$eval(bar, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  ok(br.l >= 0 && br.r <= 390, 'phone: the bar fits the width');
  const m = await mapBox(p);
  const T = (dx, dy) => p.touchscreen.tap(m.x + m.w / 2 + dx, m.y + m.h / 2 + dy);
  await T(-110, 40); await T(110, 40); await T(110, 200);
  await p.waitForTimeout(150);
  ok(await handles(p) === 3, 'phone: taps add points');
  // a touch hold does not start a point check; panning and pinching add nothing
  { const cdp = await ctx.newCDPSession(p); const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await send('touchStart', [{ x: m.x + 60, y: m.y + 330, id: 1 }]); await p.waitForTimeout(2400); await send('touchEnd', []); await p.waitForTimeout(400);
    ok(await p.locator('.leaflet-popup').count() === 0 && await handles(p) === 3, 'phone: a long touch while drawing starts no point check and adds no point');
    await send('touchStart', [{ x: m.x + 100, y: m.y + 400, id: 1 }]); for (let i = 1; i <= 8; i++) { await send('touchMove', [{ x: m.x + 100 + i * 10, y: m.y + 400 - i * 6, id: 1 }]); await p.waitForTimeout(16); } await send('touchEnd', []); await p.waitForTimeout(300);
    ok(await handles(p) === 3, 'phone: panning with a finger adds no point');
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2 + 100;
    const two = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await send('touchStart', two(40)); for (let i = 1; i <= 8; i++) { await send('touchMove', two(40 + i * 8)); await p.waitForTimeout(16); } await send('touchEnd', []); await p.waitForTimeout(500);
    ok(await handles(p) === 3, 'phone: pinch-zooming adds no point');
    const pts = (a) => [0, 180].map((o, i) => ({ x: cx + 80 * Math.cos(((a + o) * Math.PI) / 180), y: cy + 80 * Math.sin(((a + o) * Math.PI) / 180), id: i + 1 }));
    await send('touchStart', pts(0)); for (let i = 1; i <= 10; i++) { await send('touchMove', pts(i * 6)); await p.waitForTimeout(16); } await send('touchEnd', []); await p.waitForTimeout(400);
    ok(await handles(p) === 3 && await p.locator('.leaflet-popup').count() === 0, 'phone: a two-finger twist (rotation) adds no point and starts no check');
    const turned = await p.$eval('#map', (e) => e.classList.contains('rotated'));
    ok(turned, 'phone: the map can still be turned while drawing');
    // drawing while the map is turned: a tap lands where it is tapped (4th point near the tapped place)
    await p.tap('.leaflet-control-zoom-in').catch(() => {});
  }
  await p.screenshot({ path: `${shots}/phone-drawing.png` });
  await act(p, 'finish').tap();
  ok(await p.locator('.area-vtx.mid').count() === 3, 'phone: Finish works by touch');
  await act(p, 'details').tap(); await p.waitForSelector('dialog.area-dialog[open]');
  const dr = await p.$eval('dialog.area-dialog', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  ok(dr.l >= 0 && dr.r <= 390 && dr.t >= 0 && dr.b <= 780, 'phone: the details dialog fits the screen');
  ok(await p.evaluate(() => !document.activeElement || !document.activeElement.matches('input,textarea')), 'phone: opening the dialog does not raise the keyboard by itself');
  await p.screenshot({ path: `${shots}/phone-dialog.png` });
  await p.fill('#area-name', 'Phone area');
  await p.locator('dialog.area-dialog [data-act="save"]').tap(); await p.waitForSelector('dialog.area-dialog', { state: 'detached' });
  ok((await stored(p)).areas.length === 1 && (await stored(p)).areas[0].name === 'Phone area', 'phone: saved');
  ok(await p.locator(panel).isVisible(), 'phone: the list returns after saving');
  // hold check works again after the session
  await act(p, 'close', panel).tap();
  await p.screenshot({ path: `${shots}/phone-saved.png` });
}
await ctx.close();

// ================= nothing leaves the browser
{
  const bad = requests.filter((r) => /\.supabase\.(co|in)|\/rest\/v1\/|\/rpc\/|\/functions\/v1\//i.test(r.url) || r.method !== 'GET'); // (local source files named supabase.js are not requests to Supabase)
  for (const r of bad.slice(0, 5)) console.log('   suspicious: ' + r.method + ' ' + r.url.slice(0, 120));
  ok(bad.length === 0, `no request to Supabase and no non-GET request left the page during authoring (${requests.length} requests, ${bad.length} suspicious)`);
}

await b.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
