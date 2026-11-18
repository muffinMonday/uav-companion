// PMTiles viewport lifecycle (src/map.js createZones + src/pmtiles-source.js registry), in a real browser against the app on :5173:
// a region's layer and in-memory archive exist only while it meets the view; the Cache API copy stays and serves the return
// visit without the network; a short grace period absorbs border panning; point checks hold their archive.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
const net = {}; // archive downloads per region id
p.on('response', (r) => { if (r.url().includes('.pmtiles')) { const id = r.url().split('/').pop().split('.')[0]; net[id] = (net[id] ?? 0) + 1; } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

await p.evaluate(async () => {
  const { createZones } = await import('/src/map.js');
  const src = await import('/src/pmtiles-source.js');
  const { regionUrl } = await import('/src/config.js');
  const pc = await import('/src/pointcheck.js');
  const all = (await Promise.all(['cn', 'sg'].map((c) => fetch('/data/' + c + '/manifest.json').then((r) => r.json())))).flatMap((m) => m.regions);
  for (const r of all) { r.file = location.origin + '/data/' + r.file; if (r.boundary) r.boundary = location.origin + '/data/' + r.boundary; }
  const div = document.createElement('div');
  div.id = 'zl'; div.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;z-index:99999';
  document.body.append(div);
  const map = window.L.map(div, { zoomControl: false, zoomAnimation: false, fadeAnimation: false }).setView([23, 113], 8);
  src.evictPolicy.graceMs = 500;
  const regions = ['cn-guangdong', 'cn-jilin', 'cn-ningxia', 'cn-hubei', 'cn-hunan'].map((id) => all.find((r) => r.id === id));
  const zones = createZones(map, regions);
  const urlOf = (id) => { const r = regions.find((x) => x.id === id); return regionUrl(r, r.file); };
  window.__zl = {
    map, zones, all, pc,
    attached: () => { let n = 0; map.eachLayer((l) => { if (l.options?.attribution?.startsWith('Zones:')) n++; }); return n; },
    resident: (id) => src.archiveResident(urlOf(id)),
    cached: async (id) => !!(await (await caches.open('uavzones-pmtiles-v1')).match(urlOf(id))),
    go: async (lat, lon, z) => { map.setView([lat, lon], z, { animate: false }); await new Promise((r) => setTimeout(r, 50)); },
  };
});
const E = (fn) => p.evaluate(fn);
const wait = (ms) => p.waitForTimeout(ms);

// 1. a region meeting the view is attached and its archive is available
await E(() => __zl.go(23, 113, 8)); await wait(1500);
ok(await E(() => __zl.attached()) === 1 && await E(() => __zl.resident('cn-guangdong')), 'Guangdong in view: layer attached, archive resident');
ok(await E(() => __zl.cached('cn-guangdong')), 'Guangdong archive stored in the Cache API');
const gdDownloads = net['cn-guangdong'];
ok(gdDownloads === 1, 'Guangdong downloaded once (' + gdDownloads + ')');

// 2. leaving completely detaches the layer at once; the archive leaves memory after the grace period; the Cache API copy stays
await E(() => __zl.go(43.5, 126, 8)); await wait(100);
ok(await E(() => __zl.attached()) === 1, 'Guangdong left: its layer is detached immediately (only Jilin attached)');
await wait(1200);
ok(await E(() => __zl.resident('cn-jilin')), 'Jilin archive resident');
ok(!(await E(() => __zl.resident('cn-guangdong'))), 'Guangdong archive evicted from memory after the grace period');
ok(await E(() => __zl.cached('cn-guangdong')), 'Guangdong: Cache API copy remains after the memory eviction');

// 3. returning restores from the Cache API with no download
await E(() => __zl.go(23, 113, 8)); await wait(1500);
ok(await E(() => __zl.attached()) === 1 && await E(() => __zl.resident('cn-guangdong')), 'back in Guangdong: layer re-attached, archive resident again');
ok(net['cn-guangdong'] === gdDownloads, 'Guangdong return: no network download (' + net['cn-guangdong'] + ' total)');
ok(!(await E(() => __zl.resident('cn-jilin'))), 'Jilin released while away');

// 4. rapid leave and re-enter keeps the archive
await E(() => __zl.go(43.5, 126, 8)); await wait(150);
await E(() => __zl.go(23, 113, 8)); await wait(1200);
ok(await E(() => __zl.resident('cn-guangdong')) && await E(() => __zl.attached()) === 1, 'rapid leave and re-enter: archive kept, layer attached');
ok(net['cn-guangdong'] === gdDownloads, 'no download after the rapid round trip');

// 5. overlapping Hubei + Hunan both stay; leaving one releases only it
await E(() => __zl.go(30, 111.5, 8)); await wait(2000);
ok(await E(() => __zl.attached()) === 2 && await E(() => __zl.resident('cn-hubei')) && await E(() => __zl.resident('cn-hunan')), 'overlap: Hubei and Hunan both attached and resident');
await E(() => __zl.go(32.8, 112, 8)); await wait(1200);
ok(await E(() => __zl.attached()) === 1 && await E(() => __zl.resident('cn-hubei')) && !(await E(() => __zl.resident('cn-hunan'))), 'Hunan leaves while Hubei stays: only Hunan released');

// 6. zones off: nothing attaches while panning; zones on: only the regions meeting the view
await E(() => __zl.zones.setVisible(false));
ok(await E(() => __zl.attached()) === 0, 'zones disabled: all layers detached');
await E(() => __zl.go(43.5, 126, 8)); await wait(300);
ok(await E(() => __zl.attached()) === 0, 'zones disabled: panning attaches nothing');
await E(() => __zl.zones.setVisible(true)); await wait(1200);
ok(await E(() => __zl.attached()) === 1 && await E(() => __zl.resident('cn-jilin')), 'zones re-enabled: only the region in view (Jilin) attached');
ok(!(await E(() => __zl.resident('cn-hubei'))), 'Hubei archive released after zones were hidden and the view moved away');

// 7. point check off-screen: acquires the archive, holds it during the check, releasable afterwards
const res = await p.evaluate(async () => {
  __zl.pc.initPointCheck(__zl.all);
  const before = __zl.resident('cn-ningxia');
  const r = await __zl.pc.checkPoint(38.48, 106.27); // Yinchuan; the map shows Jilin
  return { before, status: r.status, region: r.region?.id, after: __zl.resident('cn-ningxia') };
});
ok(res.before === false && res.after === true, 'off-screen point check: Ningxia not rendered, archive acquired and still held right after (' + res.status + ' ' + res.region + ')');
await wait(1000);
ok(!(await E(() => __zl.resident('cn-ningxia'))), 'after the grace period Ningxia is released again');
const twice = await p.evaluate(async () => (await __zl.pc.checkPoint(38.48, 106.27)).status);
ok(twice === res.status, 'repeating the check after eviction gives the same verdict (' + twice + ')');
ok(await E(() => __zl.cached('cn-ningxia')), 'Ningxia Cache API copy remains');

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
