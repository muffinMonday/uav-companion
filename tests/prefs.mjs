import { CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const openSearch = (p) => p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); }); // the search box starts folded into a magnifying glass
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|opentopomap|openstreetmap|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  p.__tiles = [];
  p.on('request', (r) => { const u = r.url(); if (/World_Street_Map|World_Imagery|opentopomap|tile\.openstreetmap/.test(u)) p.__tiles.push(u); });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  return p;
};
const view = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
const centre = async (p) => { await p.evaluate(() => 0); return p.evaluate(() => { const s = document.querySelector('.leaflet-control-scale-line').textContent; return s; }); };

const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
let p = await open(ctx);

// ---- country: choice stays in the menu
ok((await p.inputValue('#country')) === '', 'first visit: no country chosen');
await p.selectOption('#country', 'sg'); await p.waitForTimeout(1500);
ok((await p.inputValue('#country')) === 'sg', 'country choice stays shown in the dropdown after choosing');
const sgScale = await centre(p);

// ---- basemap
await p.selectOption('#base', 'sat'); await p.waitForTimeout(1200);
// pan/zoom somewhere specific
await openSearch(p); await p.fill('#q', '武汉'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
await p.click('.leaflet-control-zoom-in'); await p.waitForTimeout(1000);
await p.mouse.move(300, 400); await p.mouse.down(); await p.mouse.move(250, 330, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(1200);
const want = await p.evaluate(() => { const m = document.querySelector('#map'); return null; });
await p.waitForTimeout(600);
let saved = await view(p);
ok(saved.basemap === 'sat' && saved.country === 'sg' && saved.view && Number.isInteger(saved.view.zoom), 'stored: ' + JSON.stringify(saved));

// ---- next session (same storage): reload
const before = saved.view;
p.__tiles.length = 0; // only tiles requested after the reload count
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
ok((await p.inputValue('#country')) === 'sg', 'reload: country dropdown still shows Singapore');
ok((await p.inputValue('#base')) === 'sat', 'reload: basemap dropdown shows Satellite');
ok(p.__tiles.some((u) => /World_Imagery/.test(u)) && !p.__tiles.some((u) => /World_Street_Map/.test(u)), 'reload: satellite tiles are loaded, not the street map');
const after = (await view(p)).view;
ok(after && after.zoom === before.zoom && Math.abs(after.lat - before.lat) < 1e-4 && Math.abs(after.lon - before.lon) < 1e-4, `reload: same position and zoom (${before.lat},${before.lon} z${before.zoom})`);
ok(Math.abs(before.lon - 104) > 5, 'the restored position is where the user left the map (Wuhan area), not the country view');

// ---- Centre button re-centres on the chosen country
await p.click('#country-go'); await p.waitForTimeout(1800);
await p.waitForTimeout(600);
const c1 = (await view(p)).view;
ok(Math.abs(c1.lon - 103.85) < 0.6 && Math.abs(c1.lat - 1.3) < 0.4, `Centre button returns to Singapore (${c1.lat}, ${c1.lon})`);
ok((await p.inputValue('#country')) === 'sg', 'dropdown still shows Singapore after Centre');

// ---- clearing the choice
await p.selectOption('#country', ''); await p.waitForTimeout(300);
ok(!('country' in (await view(p))), 'choosing the prompt clears the remembered country');
await p.click('#country-go'); ok(/Choose a country first/.test(await p.textContent('#toast')), 'Centre with nothing chosen says so');

// ---- China, then the zoom of a fresh context is independent
await p.selectOption('#country', 'cn'); await p.waitForTimeout(1500);
ok((await view(p)).country === 'cn', 'switching country updates the remembered choice');

// ---- damaged / hostile stored values
for (const [label, value] of [
  ['garbage text', 'not json {{{'],
  ['wrong types', JSON.stringify({ basemap: 7, country: {}, view: 'x' })],
  ['out of range', JSON.stringify({ basemap: 'nope', country: '../../etc', view: { lat: 999, lon: 999, zoom: 99 } })],
  ['NaN-ish', JSON.stringify({ view: { lat: null, lon: 'a', zoom: -3 } })],
  ['unknown country', JSON.stringify({ country: 'zz', view: { lat: 30, lon: 114, zoom: 8 } })],
]) {
  const c = await b.newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript((v) => localStorage.setItem('uavzones.v1.prefs', v), value);
  const q = await open(c);
  const okLoad = (await q.textContent('#regions-note')).includes('Coverage');
  ok(okLoad && (await q.inputValue('#base')) === 'osm' && (await q.inputValue('#country')) === '', `damaged prefs (${label}): app loads with defaults`);
  if (label === 'unknown country') { const v = (await view(q)).view; ok(v && v.zoom === 8, 'unknown country ignored, valid saved view still used'); }
  await c.close();
}

// ---- storage blocked
const c4 = await b.newContext({ viewport: { width: 1200, height: 800 } });
await c4.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
const q4 = await open(c4);
await q4.selectOption('#country', 'sg'); await q4.selectOption('#base', 'topo'); await q4.waitForTimeout(800);
ok((await q4.inputValue('#country')) === 'sg', 'storage blocked: controls still work');

console.log('errors:', errs.length ? errs : 'none');
await b.close();
