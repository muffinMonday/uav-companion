// Malaysia (my-enr51): CAAM ENR 5.1 prohibited / restricted / danger areas. Checks the extractor rules, the converted layers, the exception report,
// the built archive (every converted area present with its class, gaps unknown) and the P/R/D wording. Reads public/data (run `node scripts/build-data.js my-enr51` first).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { zonesInArchive } = await import(url('src/zones.js'));
const { geometryOf, inverse } = await import(url('scripts/airspace/my-enr51.mjs'));
globalThis.document ??= { baseURI: 'http://localhost/' };
const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', cacheDir: path.join(os.tmpdir(), 'my-enr51-vite') });
const { zoneSummary } = await vite.ssrLoadModule('/src/pointcheck.js');
const { AIRSPACE_DISCLAIMER } = await vite.ssrLoadModule('/src/legends.js');

// Extractor rules
const circle = geometryOf('Area within 1.6 KM radius of 025459N 1014755E');
const ctr = circle.center;
ok(circle.kind === 'circle' && circle.ring.every((p) => Math.abs(inverse(ctr[0], ctr[1], p[0], p[1]).s - 1600) < 1), 'a circle is geodesic: every vertex is 1600 m from the centre (within 1 m)');
ok(Math.abs(ctr[1] - (2 + 54 / 60 + 59 / 3600)) < 1e-5 && Math.abs(ctr[0] - (101 + 47 / 60 + 55 / 3600)) < 1e-5, 'DDMMSSN DDDMMSSE is read as longitude/latitude (GeoJSON order)');
ok(Math.abs(geometryOf('Circle of 3000FT ( 915 M ) radius centred on 045320N 1145003E .').radiusM - 914.4) < 1e-6, 'feet radius converts to 914.4 m');
const box = geometryOf('BTN LAT 013000N, 020000N, and LONG 1042000E, 1043500E.');
ok(box.kind === 'box' && Math.abs(box.ring[0][0] - 104.333333) < 1e-6 && box.ring[2][1] === 2, 'a LAT/LONG box becomes a rectangle');
ok(!!geometryOf('Area within 2 NM centred on 012845N 1034433E with the southern border coinciding with the coastline of South Johor.').reason, 'a circle clipped by a coastline is not converted');
ok(!!geometryOf('A straight line to 053308N 1020235E then along 40 NM arc from VKB VOR to 052956N 1022349E then to 051048N 1023100E').reason, 'an arc centred on a navaid without coordinates is not converted');
const arc = geometryOf('Commencing from 023719.63N 1022641.96E, clockwise along an arc of a circle 10NM radius centered on 022833.00N 1023146.00E to 021900.61N 1023438.10E, then along a straight line to 022419.10N 1022841.24E, then a straight line to 023719.63N 1022641.96E');
ok(arc.kind === 'arc-polygon' && arc.ring.length > 60, 'an arc with stated centre, radius and direction is reconstructed');
ok(!!geometryOf('From 020000N 1025839E an arc of a circle radius 20 NM centred on 020230N 1031824E to 021830N 1032954E then straight lines').reason, 'an arc without a direction is not converted');

// Converted layers and exception report
const dir = path.join(ROOT, 'data/regions/my/my-enr51');
const layers = Object.fromEntries(['prohibited', 'restricted', 'danger'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'layers', k + '.geojson'), 'utf8')).features]));
const report = JSON.parse(fs.readFileSync(path.join(dir, 'exceptions.json'), 'utf8'));
const all = Object.entries(layers).flatMap(([k, list]) => list.map((f) => ({ k, f })));
const ids = all.map((x) => x.f.properties.id);
ok(new Set(ids).size === ids.length, 'every area ID is unique');
ok(all.every(({ k, f }) => ({ prohibited: 'P', restricted: 'R', danger: 'D' })[k] === f.properties.class && f.properties.id[2] === f.properties.class), 'the P/R/D class matches the layer and the identifier letter');
ok(layers.prohibited.length === 5 && layers.restricted.length === 25 && layers.danger.length === 31, '5 prohibited, 25 restricted, 31 danger areas converted');
ok(report.applicable === 108 && report.converted === 61 && report.unresolved === 47 && report.converted + report.unresolved === report.applicable, 'applicable = converted + unresolved (108 = 61 + 47)');
ok(report.exceptions.every((e) => !ids.includes(e.id) && e.reason) && new Set(report.exceptions.map((e) => e.id)).size === 47, 'no area is both converted and unresolved; each unresolved area has a reason');
ok(all.every(({ f }) => f.properties.vertical && f.properties.upper && f.properties.lower && f.properties.description.includes('Upper')), 'every area keeps its published vertical limits');
const rings = all.map(({ f }) => f.geometry.coordinates[0]);
ok(rings.every((r) => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]), 'every ring is closed');
ok(rings.flat().every(([x, y]) => x > 95 && x < 120 && y > 0 && y < 10), 'every coordinate is longitude/latitude inside the Malaysian window');
ok(rings.every((r) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) > 0), 'outer rings are counter-clockwise with non-zero area');

// Archive
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/my/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'my-enr51');
ok(!!region && region.cells === 61 && region.semantics === 'restrict' && region.classes.map((c) => c.id).join() === 'prohibited,restricted,danger', 'the manifest registers my-enr51 with 61 areas and the three classes');
ok(region.classes.map((c) => c.verdict).join() === 'prohibited,restricted,danger' && region.source.effective === '2026-11-03', 'classes carry their P/R/D verdict; the edition date is recorded');
const bytes = fs.readFileSync(path.join(ROOT, 'public/data', region.file));
const arch = new PMTiles({ getKey: () => region.file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const segD = ([ax, ay], [bx, by], x, y) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; return Math.hypot(ax + u * dx - x, ay + u * dy - y); };
const witness = (r) => { // the grid point inside the ring that is farthest from its edges
  const xs = r.map((c) => c[0]), ys = r.map((c) => c[1]); let best = null, bd = -1;
  for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
    const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * i / 30, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * j / 30;
    if (!inRing(r, x, y)) continue;
    const d = Math.min(...r.slice(1).map((q, k) => segD(r[k], q, x, y)));
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
};
let lost = 0, wrong = 0;
for (const { k, f } of all) {
  const w = witness(f.geometry.coordinates[0]);
  const zs = w ? await zonesInArchive(arch, region.maxZoom, w[1], w[0]) : [];
  if (!zs.length) { lost++; console.log('  lost ' + f.properties.id); } else if (!zs.some((z) => z.c === k)) { wrong++; console.log('  wrong class ' + f.properties.id); }
}
ok(lost === 0 && wrong === 0, 'every one of the 61 converted areas is present in the archive at its max zoom with its own class');
ok((await zonesInArchive(arch, region.maxZoom, 3.139, 101.687)).length === 0, 'central Kuala Lumpur, outside every converted polygon, has no zone (unknown, not permitted)');
ok(!region.boundary && region.partialCoverage === true, 'no coverage boundary and marked partial: outside the polygons nothing is claimed');

// Wording
const z = (c, n) => ({ status: 'inside', region, zones: [{ c, n }] });
const p = zoneSummary(z('prohibited', 'WMP220 PUSPATI')), r = zoneSummary(z('restricted', 'WMR101A')), d = zoneSummary(z('danger', 'WMD224'));
ok(p.cls === 'no' && /^Prohibited area/.test(p.title) && /not permitted/.test(p.detail), 'P is worded as prohibited');
ok(r.cls === 'no' && /^Restricted area/.test(r.title) && /conditions/.test(r.detail) && !/not permitted/.test(r.detail), 'R is worded as restricted with conditions, not as a ban');
ok(d.cls === 'unk' && /^Danger area/.test(d.title) && /Caution/.test(d.detail) && !/no-fly|not allowed/i.test(d.title + d.detail), 'D is worded as caution, not as prohibited');
const none = zoneSummary({ status: 'outside', region, zones: [] });
ok(none.cls === 'unk' && /does not mean flying is allowed/.test(none.detail), 'outside every polygon: unknown, never permission');
const sg = { ...region, id: 'sg-x', classes: region.classes.map(({ verdict, ...c }) => c) };
ok(/^No-fly zone/.test(zoneSummary({ status: 'inside', region: sg, zones: [{ c: 'danger' }] }).title), 'a region whose classes have no verdict (Singapore) keeps its no-fly wording');
ok(/Temporary restricted areas, NOTAMs, temporary activations and short-notice changes are not tracked/.test(AIRSPACE_DISCLAIMER) && /Always consult current official aviation publications/.test(AIRSPACE_DISCLAIMER), 'the airspace disclaimer states what is not tracked');
await vite.close();
