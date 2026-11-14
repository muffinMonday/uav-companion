import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
import fs from 'node:fs';
import { dashClick } from './lib.mjs';
const openSearch = (p) => p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); }); // the search box starts folded into a magnifying glass
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, geolocation: { latitude: 30.5928, longitude: 114.3055 }, permissions: ['geolocation'], acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror ' + e.message));
p.on('console', m => m.type() === 'error' && errs.push('console ' + m.text()));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);

// ---- panel & tabs
ok(await p.isVisible('#panel') && !(await p.isVisible('#dock')), 'desktop: panel open, dock hidden');
ok((await p.textContent('#tab-config')) === 'Map Configs' && (await p.textContent('#tab-poi')) === 'Points of Interest', 'tab labels');
await p.screenshot({ path: SP + '/ui-config.png' });
await p.click('#tab-poi'); ok(await p.isVisible('#pane-poi') && !(await p.isVisible('#pane-config')), 'POI tab shows its pane');
await p.focus('#tab-poi'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); ok(await p.isVisible('#pane-config'), 'arrow keys switch tabs');
await p.click('#panel-close'); ok(!(await p.isVisible('#panel')) && await p.isVisible('#dock'), 'close hides panel, shows dock');
ok((await p.$$eval('#dock button[data-tab]', bs => bs.map(x => x.textContent.trim()))).join('|') === 'Map Configs|Trips|Points of Interest|Friends' && (await p.locator('#dock-expand').count()) === 1, 'the rail has the < button and one icon per tab (named for screen readers; Friends is there because this build has accounts)');
await p.click('#dock [data-tab=poi]'); ok(await p.isVisible('#pane-poi'), 'dock POI button opens the panel on the POI tab');
await p.screenshot({ path: SP + '/ui-poi-empty.png' });

// ---- go to Wuhan so we have a real view
await openSearch(p); await p.fill('#q', '武汉'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
await p.keyboard.press('Escape');

// ---- place a Hotel by tapping the map
await p.click('#poi-types [data-type=hotel]');
await p.click('#poi-place');
ok(await p.isVisible('#banner') && /Accommodation/.test(await p.textContent('#banner-text')), 'place mode banner names the type');
await p.mouse.click(500, 420);
await p.waitForSelector('.poi-pop form', { timeout: 5000 });
ok(true, 'popup opens in the edit form after placing');
await p.fill('.poi-pop input[type=text]', 'Test Hotel'); await p.fill('.poi-pop textarea', 'Room 12, ask for the early checkout');
await p.click('.poi-pop button[type=submit]');
await p.waitForSelector('.poi-pop h3');
ok((await p.textContent('.poi-pop h3')) === 'Test Hotel', 'name saved and shown');
await p.waitForFunction(() => /Suitable-flight|Outside|No data/.test(document.querySelector('.poi-pop .zone')?.textContent || ''), null, { timeout: 8000 });
ok(true, 'popup shows a live zone check: ' + (await p.textContent('.poi-pop .zone')).slice(0, 60));
ok((await p.locator('.poi-pop .wx-btn').count()) === 1, 'popup has the weather button');
await p.screenshot({ path: SP + '/ui-marker-popup.png' });
await p.keyboard.press('Escape');

// ---- Home point at map centre, Hazard at my location
await p.click('#poi-types [data-type=home]'); await p.click('#poi-center'); await p.waitForSelector('.poi-pop form'); await p.click('.poi-pop button[type=submit]');
await p.waitForSelector('.poi-pop h3'); ok((await p.textContent('.poi-pop h3')) === 'Home point', 'centre placement gets the type name by default');
await p.keyboard.press('Escape');
await p.click('#poi-types [data-type=hazard]'); await p.click('#poi-here'); await p.waitForSelector('.poi-pop form', { timeout: 10000 });
await p.click('.poi-pop .btn:has-text("Cancel")');
await p.keyboard.press('Escape');
ok((await p.locator('.poi-pin').count()) === 3, '3 pins on the map');
ok((await p.textContent('#poi-count')) === '(3)', 'count shows (3)');
ok((await p.locator('#poi-list .poi-item').count()) === 3, 'list has 3 items');
await p.screenshot({ path: SP + '/ui-poi-list.png' });

// ---- filter chips
await p.click('#poi-filter .chip:has-text("Accommodation")'); ok((await p.locator('#poi-list .poi-item').count()) === 1, 'filter chip narrows the list');
await p.click('#poi-filter .chip:has-text("All")');

// ---- list click recentres + opens popup
await p.mouse.move(400, 400); await p.mouse.down(); await p.mouse.move(100, 100, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
await p.click('#poi-list .poi-item:has-text("Test Hotel")');
await p.waitForFunction(() => document.querySelector('.poi-pop h3')?.textContent === 'Test Hotel', null, { timeout: 5000 }).catch(() => {});
const hTxt = await p.textContent('.poi-pop h3');
ok(hTxt === 'Test Hotel', 'list click opens that marker popup (found: ' + JSON.stringify(hTxt) + ', popups: ' + (await p.locator('.leaflet-popup').count()) + ')');
await p.waitForTimeout(800);
const pins = await p.evaluate(() => [...document.querySelectorAll('.poi-pin')].map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height) }; }));
const vis = pins.filter((q) => q.x > 0 && q.x < 820 && q.y > 0 && q.y < 800);
ok(vis.length >= 1, 'recentred: marker is in the visible map area, clear of the docked panel: ' + JSON.stringify(vis));
await p.screenshot({ path: SP + '/ui-after-recentre.png' });
await p.keyboard.press('Escape');

// ---- persistence
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')));
ok(stored.items.length === 3 && stored.items.some((i) => i.name === 'Test Hotel' && i.note.startsWith('Room 12')), 'stored in localStorage with name and note');
ok(Object.keys(stored.items[0]).sort().join() === 'created,id,lat,lon,name,note,type', 'stored fields are only id,type,name,note,lat,lon,created');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.click('#tab-poi');
ok((await p.locator('#poi-list .poi-item').count()) === 3, 'markers survive a reload');

// ---- export
const [dl] = await Promise.all([p.waitForEvent('download'), dashClick(p, '#poi-export')]);
const path = SP + '/poi1-export.geojson'; await dl.saveAs(path);
const gj = JSON.parse(fs.readFileSync(path, 'utf8'));
ok(gj.type === 'FeatureCollection' && gj.features.length === 3 && gj.features[0].geometry.type === 'Point', 'export is a GeoJSON FeatureCollection of 3 Points: ' + dl.suggestedFilename());
ok(/Last backup/.test(await p.textContent('#poi-note')), 'backup note updated');

// ---- import into a clean state
await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.click('#tab-poi');
ok((await p.locator('#poi-list .poi-item').count()) === 0, 'cleared: list empty');
await p.setInputFiles('#poi-file', path); await p.waitForTimeout(600);
ok((await p.locator('#poi-list .poi-item').count()) === 3 && (await p.locator('.poi-pin').count()) === 3, 'import restores 3 markers (list and map)');
console.log('     toast:', await p.textContent('#toast'));
await p.setInputFiles('#poi-file', path); await p.waitForTimeout(500);
ok((await p.locator('#poi-list .poi-item').count()) === 3, 're-import adds no duplicates: ' + (await p.textContent('#toast')));
fs.writeFileSync(SP + '/poi1-bad.txt', 'not json'); await p.setInputFiles('#poi-file', SP + '/poi1-bad.txt'); await p.waitForTimeout(400);
ok(/not valid JSON/.test(await p.textContent('#toast')), 'bad file gives a readable error');
fs.writeFileSync(SP + '/poi1-evil.geojson', JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: '<img src=x onerror=window.__pwn=1>', type: 'nope' }, geometry: { type: 'Point', coordinates: [114.3, 30.6] } },
  { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [999, 30] } },
  { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }] }));
await p.setInputFiles('#poi-file', SP + '/poi1-evil.geojson'); await p.waitForTimeout(500);
console.log('     toast:', await p.textContent('#toast'));
await p.click('#poi-list .poi-item:has-text("<img")'); await p.waitForSelector('.poi-pop h3', { timeout: 5000 });
ok((await p.evaluate(() => window.__pwn === undefined)) && (await p.textContent('.poi-pop h3')).startsWith('<img'), 'markup in an imported name is shown as text, not executed');
await p.keyboard.press('Escape');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
