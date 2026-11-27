// The map layers: only the OpenStreetMap family (OpenStreetMap, Humanitarian, CyclOSM, OpenTopoMap), each loaded from its own host and remembered across a reload.
// Tile requests are answered with a tiny image, so the suite needs no network and counts exactly which hosts the page asks.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });

const HOSTS = { osm: /\/\/tile\.openstreetmap\.org\//, hot: /\/\/[abc]\.tile\.openstreetmap\.fr\/hot\//, cyclosm: /\/\/[abc]\.tile-cyclosm\.openstreetmap\.fr\/cyclosm\//, topo: /\/\/[abc]\.tile\.opentopomap\.org\// };
const OTHER = /^https?:\/\/[^/]*(arcgisonline|cartocdn|esri)[^/]*\//i; // by host name only (the app's own files must not match)

async function open(prefs, options = {}) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, colorScheme: 'light', ...options });
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
  await p.selectOption('#base', key);
  await p.waitForFunction(pattern => { const layers = document.querySelectorAll('.leaflet-tile-pane > .base-tiles'); const image = layers[0]?.querySelector('img.leaflet-tile'); return layers.length === 1 && image && new RegExp(pattern).test(image.src); }, host.source);
  const shown = await p.$$eval('img.leaflet-tile', (im) => im.map((i) => i.src)); // tiles on the map now (the browser may have kept earlier ones, so no new request is needed)
  ok(shown.length > 0 && shown.every((u) => host.test(u)), key + ': every tile on the map comes from the right host (' + (shown[0] ?? 'none').replace(/\/\d+\/\d+\/\d+.*/, '/…') + ')');
  ok(await p.locator('.leaflet-tile-pane > .base-tiles').count() === 1, key + ': only one basemap layer remains after loading');
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

// Native dark map lifecycle, using the real Leaflet/theme/rotation/PMTiles modules.
// Requests are intercepted: these regressions consume no provider quota.
for (const width of [390, 800, 1300]) {
  ({ ctx, p } = await open({ basemap: 'osm', theme: 'system' }, { viewport: { width, height: 850 }, hasTouch: width <= 800, isMobile: width <= 800 }));
  let failDark = false, delayDark = false, darkRequests = 0;
  const held = [];
  await ctx.route('https://basemaps.cartocdn.com/**', async r => {
    darkRequests++;
    if (delayDark) { held.push(r); return; }
    await r.fulfill({ status: failDark ? 429 : 200, contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: failDark ? 'quota exceeded' : PNG });
  });
  await p.evaluate(async () => {
    const { createMap, createZones, baseTiles } = await import('/src/map.js');
    const { createRotation } = await import('/src/maprotate.js');
    const theme = await import('/src/theme.js');
    document.getElementById('map').id = 'original-map';
    const div = document.createElement('div'); div.id = 'map';
    div.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.append(div);
    const h = createMap({ basemap: 'osm', view: { lat: 1.35, lon: 103.82, zoom: 12 } });
    const rotation = createRotation(h.map); rotation.set(37);
    const marker = L.marker([1.35, 103.82]).addTo(h.map);
    const route = L.polyline([[1.34, 103.81], [1.36, 103.83]], { color: '#2aa6b8' }).addTo(h.map);
    const regions = (await (await fetch('/data/sg/manifest.json')).json()).regions;
    const zones = createZones(h.map, regions); zones.sync();
    const layers = () => Object.values(h.map._layers).filter(l => l.options?.className === 'base-tiles');
    const state = () => JSON.stringify({ center: h.map.getCenter(), zoom: h.map.getZoom(), bearing: rotation.bearing(),
      marker: marker.getLatLng(), route: route.getLatLngs(), controls: h.map.getContainer().querySelectorAll('.leaflet-control').length });
    window.__native = { ...h, theme, baseTiles, layers, marker, route, state,
      overlay: Object.values(h.map._layers).find(l => l.options?.attribution?.startsWith('Zones:')) };
  });
  await p.waitForFunction(() => __native.layers().length === 1 && !__native.layers()[0].isLoading());
  await p.waitForFunction(() => !!__native.overlay?._container?.querySelector('canvas'));
  const before = await p.evaluate(() => __native.state());
  ok(await p.evaluate(() => { const [url, opts] = __native.baseTiles('osm', 'dark'); return url.startsWith('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=') && opts.maxZoom === 19 && opts.maxNativeZoom === 19 && __native.map.getMaxZoom() === 19; }), `${width}: documented dark URL/zoom support preserves the app zoom limit`);
  for (const key of ['osm', 'hot', 'cyclosm', 'topo']) {
    let lightLayer;
    for (const mode of ['light', 'dark']) {
      await p.evaluate(([key, mode]) => {
        __native.switchBase(key); __native.theme.setTheme(mode);
        if (key === 'osm' && mode === 'dark') {
          const dark = __native.layers().find(l => l._url.includes('cartocdn'));
          dark.once('load', () => { __native.fadeBacked = __native.layers().some(l => l !== dark && l.options.opacity === 1); });
        }
      }, [key, mode]);
      const host = key === 'osm' && mode === 'dark' ? 'basemaps.cartocdn.com' : { osm: 'tile.openstreetmap.org', hot: 'tile.openstreetmap.fr', cyclosm: 'tile-cyclosm.openstreetmap.fr', topo: 'tile.opentopomap.org' }[key];
      await p.waitForFunction(host => __native.layers().length === 1 && __native.layers()[0]._url.includes(host) && !__native.layers()[0].isLoading(), host);
      ok(await p.evaluate(() => getComputedStyle(__native.layers()[0]._container).filter === 'none'), `${width}: ${key}/${mode} uses original cartography without a filter`);
      const layerId = await p.evaluate(() => __native.layers()[0]._leaflet_id);
      if (mode === 'light') lightLayer = layerId;
      else if (key !== 'osm') ok(layerId === lightLayer, `${width}: ${key} theme change reuses the existing tiles`);
      if (key === 'osm' && mode === 'dark') ok(await p.evaluate(() => __native.map.attributionControl.getContainer().textContent.includes('© CARTO | © OpenStreetMap contributors')), `${width}: required dark attribution is visible`);
      if (key === 'osm' && mode === 'dark') ok(await p.evaluate(() => __native.fadeBacked), `${width}: loaded dark tiles retain backing through Leaflet's tile fade`);
      if (key === 'osm' && mode === 'dark') ok(await p.evaluate(() => { const r = __native.map.attributionControl.getContainer().getBoundingClientRect(); const nav = document.getElementById('shell-nav'); return r.left >= 0 && r.right <= innerWidth && r.bottom <= (nav?.dataset.placement === 'bottom' ? nav.getBoundingClientRect().top : innerHeight); }), `${width}: full attribution clears the bottom navigation`);
    }
  }
  await p.evaluate(() => { __native.switchBase('osm'); __native.theme.setTheme('system'); });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForFunction(() => __native.layers().length === 1 && __native.layers()[0]._url.includes('cartocdn'));
  ok(true, `${width}: System follows the device to native dark tiles`);
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForFunction(() => __native.layers().length === 1 && __native.layers()[0]._url.includes('tile.openstreetmap.org'));
  delayDark = true;
  await p.evaluate(() => __native.theme.setTheme('dark'));
  await p.waitForFunction(() => __native.layers().length === 2);
  ok(await p.evaluate(() => __native.layers().some(l => l._url.includes('tile.openstreetmap.org') && l.options.opacity === 1)), `${width}: old map stays visible while dark tiles load`);
  await p.evaluate(() => { for (let i = 0; i < 8; i++) __native.theme.setTheme(i % 2 ? 'light' : 'dark'); });
  delayDark = false;
  for (const r of held.splice(0)) await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: PNG }).catch(() => {});
  await p.waitForFunction(() => __native.layers().length === 1 && __native.layers()[0]._url.includes('tile.openstreetmap.org'));
  ok(true, `${width}: rapid switches cancel stale tile layers`);
  // An already displayed dark map must also fall back if a later pan fails.
  await p.evaluate(() => __native.theme.setTheme('dark'));
  await p.waitForFunction(() => __native.layers().length === 1 && __native.layers()[0]._url.includes('cartocdn') && !__native.layers()[0].isLoading());
  failDark = true;
  await p.evaluate(() => { const layer = __native.layers()[0]; layer.setUrl(layer._url + '?failure-test=1'); });
  await p.waitForFunction(() => __native.layers().length === 1 && __native.layers()[0]._url.includes('tile.openstreetmap.org') && !__native.layers()[0].isLoading());
  ok(await p.evaluate(() => { const credit = __native.map.attributionControl.getContainer().textContent; return credit.includes('OpenStreetMap') && !credit.includes('CARTO'); }), `${width}: fallback removes the dark provider credit`);
  ok(await p.evaluate(() => { const c = __native.layers()[0]._container; return c.classList.contains('base-tiles-inverted') && getComputedStyle(c).filter.includes('invert'); }), `${width}: after the dark source fails, dark mode shows the standard tiles inverted (not a bright map)`);
  const requestsAtFailure = darkRequests;
  await p.evaluate(() => { __native.theme.setTheme('light'); __native.theme.setTheme('dark'); });
  await p.waitForTimeout(200);
  ok(darkRequests === requestsAtFailure && await saved(p) === 'osm', `${width}: quota failure falls back once, retaining the basemap preference`);
  await p.evaluate(() => __native.theme.setTheme('light')); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const c = __native.layers()[0]._container; return !c.classList.contains('base-tiles-inverted') && getComputedStyle(c).filter === 'none'; }), `${width}: back in light mode the inversion is removed`);
  await p.evaluate(() => __native.theme.setTheme('dark')); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __native.layers()[0]._container.classList.contains('base-tiles-inverted')), `${width}: and returns when dark mode comes back (same fallback tiles, no new request)`);
  ok(before === await p.evaluate(() => __native.state()), `${width}: center, zoom, rotation, marker, route and controls survive every switch/fallback`);
  ok(await p.evaluate(() => __native.map.hasLayer(__native.overlay) && __native.map.hasLayer(__native.marker) && __native.map.hasLayer(__native.route) && __native.overlay._container.isConnected && getComputedStyle(__native.overlay._container).filter === 'none'), `${width}: airspace canvas, markers and route stay attached and unfiltered`);
  // Unload releases the subscription and pending tile requests.
  await p.evaluate(() => { __native.map.remove(); __native.theme.setTheme('light'); __native.theme.setTheme('dark'); });
  ok(await p.evaluate(() => __native.layers().length === 0), `${width}: map removal leaves no basemap layer or theme listener`);
  if (width === 390) {
    // A hung initial dark load is bounded even when no tileerror arrives.
    delayDark = true; failDark = false;
    await p.clock.install();
    await p.evaluate(async () => { const { createMap } = await import('/src/map.js'); window.__timeoutMap = createMap({ basemap: 'osm' }).map; });
    await p.clock.fastForward(12001);
    await p.waitForFunction(() => Object.values(__timeoutMap._layers).some(l => l._url?.includes('tile.openstreetmap.org')));
    ok(await p.evaluate(() => Object.values(__timeoutMap._layers).filter(l => l.options?.className === 'base-tiles').length === 1), 'initial dark timeout removes the stalled layer and shows ordinary OSM');
    delayDark = false;
    for (const r of held.splice(0)) await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: PNG }).catch(() => {});
    await p.evaluate(() => __timeoutMap.remove());
    await p.clock.resume();
  }
  await ctx.close();
}

// ---------- the scale bar and the single credit control, on the real app
for (const [width, height, touch] of [[1300, 850, false], [800, 700, true], [390, 700, true], [320, 568, true]]) {
  for (const units of ['metric', 'imperial']) {
    ({ ctx, p } = await open({ basemap: 'osm', theme: 'light', ...(units === 'imperial' ? { units } : {}) }, { viewport: { width, height }, hasTouch: touch, isMobile: touch }));
    const tag = width + 'px ' + units;
    ok(await p.locator('.map-base-attribution').count() === 0 && await p.locator('.leaflet-bottom.leaflet-right .leaflet-control-attribution').count() === 0, tag + ': no persistent bottom-right credit');
    ok(await p.locator('.leaflet-control-scale').count() === 1, tag + ': exactly one scale control');
    const text = await p.textContent('.leaflet-control-scale-line');
    const unit = text.replace(/[^a-z]/gi, '');
    ok(units === 'imperial' ? unit === 'mi' || unit === 'ft' : unit === 'km' || unit === 'm', tag + ': scale follows the units: ' + text);
    const geo = await p.evaluate(() => {
      const r = (e) => { if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const s = document.querySelector('.leaflet-control-scale-line'), nav = document.getElementById('shell-nav');
      const others = ['#dash', '#dash-peek', '#dash-tab', '.sidepanel', '.search'].map((q) => [q, r(document.querySelector(q))]).filter(([, v]) => v);
      return { s: r(s), vis: !!s && getComputedStyle(s).visibility !== 'hidden' && getComputedStyle(s).display !== 'none', navTop: nav && nav.dataset.placement === 'bottom' ? nav.getBoundingClientRect().top : null, nav: r(nav), h: innerHeight, w: innerWidth, others };
    });
    ok(geo.vis && geo.s && geo.s.l >= 0 && geo.s.r <= geo.w && geo.s.t >= 0 && geo.s.b <= geo.h, tag + ': scale is visible in the viewport');
    ok(geo.navTop === null ? true : geo.s.b <= geo.navTop + 0.5, tag + ': scale stays above the bottom navigation (' + Math.round(geo.s.b) + ' vs ' + (geo.navTop === null ? 'no bottom bar' : Math.round(geo.navTop)) + ')');
    ok(!geo.nav || geo.navTop !== null || geo.s.l >= geo.nav.r - 0.5 || geo.s.r <= geo.nav.l + 0.5, tag + ': scale clears a side navigation rail');
    const hit = geo.others.filter(([, v]) => v.l < geo.s.r && v.r > geo.s.l && v.t < geo.s.b && v.b > geo.s.t).map(([q]) => q);
    ok(hit.length === 0, tag + ': scale overlaps no dashboard, panel or search box' + (hit.length ? ' (' + hit.join(', ') + ')' : ''));
    await ctx.close();
  }
}

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
