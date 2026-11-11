// The map layers: only the OpenStreetMap family (OpenStreetMap, Humanitarian, CyclOSM, OpenTopoMap), each loaded from its own host and remembered across a reload.
// Tile requests are answered with a tiny image, so the suite needs no network and counts exactly which hosts the page asks.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });

const HOSTS = { osm: /\/\/tile\.openstreetmap\.org\//, hot: /\/\/[abc]\.tile\.openstreetmap\.fr\/hot\//, cyclosm: /\/\/[abc]\.tile-cyclosm\.openstreetmap\.fr\/cyclosm\//, topo: /\/\/[abc]\.tile\.opentopomap\.org\// };
const OTHER = /^https?:\/\/[^/]*(arcgisonline|cartocdn|esri)[^/]*\//i; // by host name only (the app's own files must not match)

async function open(prefs) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } });
  const tiles = [], other = [];
  // only the tile hosts are answered (the app's own files, including the dev server's .png?import modules, go through untouched)
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => { tiles.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.route(OTHER, (r) => { other.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.addInitScript((pf) => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; if (pf) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pf)); }, prefs ?? null);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p, tiles, other };
}
const opts = (p, sel) => p.$$eval(sel + ' option', (o) => o.map((x) => x.value).join());
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').basemap);
const credit = (p) => p.textContent('.leaflet-control-attribution');

// ---------- the list
let { ctx, p, tiles, other } = await open();
ok(await opts(p, '#base') === 'osm,hot,cyclosm,topo', 'the selector lists exactly OpenStreetMap, Humanitarian, CyclOSM and OpenTopoMap: ' + await opts(p, '#base'));
ok(await p.inputValue('#base') === 'osm' && tiles.some((u) => HOSTS.osm.test(u)), 'OpenStreetMap is the default, and its tiles are what loads');
ok(!/esri|satellite/i.test(await p.textContent('#base')) && !/Esri/.test(await credit(p)), 'no Esri entry or credit is left');
ok(/OpenStreetMap/.test(await credit(p)), 'the OpenStreetMap credit shows');

// ---------- each layer: its own host, its own credit, remembered
for (const [key, host, creditRe] of [['hot', HOSTS.hot, /Humanitarian OpenStreetMap Team/], ['cyclosm', HOSTS.cyclosm, /CyclOSM/], ['topo', HOSTS.topo, /OpenTopoMap/], ['osm', HOSTS.osm, /OpenStreetMap/]]) {
  tiles.length = 0;
  await p.selectOption('#base', key); await p.waitForTimeout(1200);
  const shown = await p.$$eval('img.leaflet-tile', (im) => im.map((i) => i.src)); // tiles on the map now (the browser may have kept earlier ones, so no new request is needed)
  ok(shown.length > 0 && shown.every((u) => host.test(u)), key + ': every tile on the map comes from the right host (' + (shown[0] ?? 'none').replace(/\/\d+\/\d+\/\d+.*/, '/…') + ')');
  ok(Object.entries(HOSTS).filter(([k]) => k !== key).every(([, re]) => !tiles.some((u) => re.test(u))), key + ': and no other layer\'s tiles are requested');
  ok(creditRe.test(await credit(p)) && (await saved(p)) === key, key + ': its credit shows and the choice is saved');
}

// ---------- remembered across a reload, in both selects
await p.selectOption('#base', 'hot'); await p.waitForTimeout(600);
tiles.length = 0;
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
ok(await p.inputValue('#base') === 'hot' && tiles.some((u) => HOSTS.hot.test(u)) && !tiles.some((u) => HOSTS.osm.test(u)), 'after a reload the Humanitarian layer is still chosen and loads');
// the dashboard's copy of the selector
if (await p.locator('#dash').isHidden()) await p.locator('#dash-tab:visible, #dash-peek:visible').first().click().catch(() => {});
await p.waitForSelector('#dash:not([hidden])', { timeout: 5000 }).catch(() => {});
const mirror = p.locator('#dash .dash-layers select');
if (await mirror.count()) {
  ok(await opts(p, '#dash .dash-layers select') === 'osm,hot,cyclosm,topo' && await mirror.inputValue() === 'hot', 'the dashboard\'s selector has the same four layers and shows the choice');
  await mirror.selectOption('cyclosm'); await p.waitForTimeout(800);
  ok(await p.inputValue('#base') === 'cyclosm' && (await saved(p)) === 'cyclosm', 'and choosing there changes the layer and is saved');
}
ok(other.length === 0, 'nothing was ever requested from Esri or Carto (' + other.length + ' requests)');
await ctx.close();

// ---------- a saved choice of a layer that no longer exists
for (const old of ['esri', 'sat', 'bogus']) {
  ({ ctx, p, tiles, other } = await open({ basemap: old }));
  ok(await p.inputValue('#base') === 'osm' && tiles.some((u) => HOSTS.osm.test(u)) && other.length === 0, 'a saved "' + old + '" falls back to OpenStreetMap, with no request to another provider');
  await ctx.close();
}

// ---------- the privacy note names the real hosts
({ ctx, p } = await open());
await p.click('#privacy-btn').catch(async () => { await p.evaluate(() => document.querySelector('#dock button')?.click()); await p.click('#privacy-btn'); });
await p.waitForSelector('#privacy:not([hidden])');
const note = await p.textContent('#privacy');
ok(/OpenStreetMap France/.test(note) && /OpenTopoMap/.test(note) && !/Esri/.test(note), 'the privacy note names OpenStreetMap, OpenStreetMap France and OpenTopoMap, and not Esri');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
