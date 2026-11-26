// Vietnam (vn-enr51): AIM/VATM ENR 5.1 prohibited / restricted / danger areas. Checks the extractor rules, the converted layers, the exception report,
// the source hash, the built archive (every converted area present with its class, gaps unknown) and the P/R/D wording.
// Reads public/data (run `node scripts/build-data.js vn-enr51` first).
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { zonesInArchive } = await import(url('src/zones.js'));
const { geometryOf, parseRows, validate } = await import(url('scripts/airspace/vn-enr51.mjs'));
const { inverse, ccw } = await import(url('scripts/airspace/my-enr51.mjs'));
globalThis.document ??= { baseURI: 'http://localhost/' };
const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', cacheDir: path.join(os.tmpdir(), 'vn-enr51-vite') });
const { zoneSummary } = await vite.ssrLoadModule('/src/pointcheck.js');

// Extractor rules
const circle = geometryOf('A circle, 15 KM radius, centred at 152420N 1084223E');
ok(circle.kind === 'circle' && circle.radiusM === 15000 && circle.ring.every((p) => Math.abs(inverse(circle.center[0], circle.center[1], p[0], p[1]).s - 15000) < 1), 'a circle is geodesic: every vertex is 15000 m from the centre (within 1 m)');
ok(Math.abs(circle.center[1] - (15 + 24 / 60 + 20 / 3600)) < 1e-5 && Math.abs(circle.center[0] - (108 + 42 / 60 + 23 / 3600)) < 1e-5, 'DDMMSSN DDDMMSSE is read as longitude/latitude (GeoJSON order)');
ok(geometryOf('A circle, 7.5 KM radius, centred at 205139N 1061732E').radiusM === 7500, 'a decimal radius (VVR33, 7.5 KM) is read exactly');
const poly = geometryOf('210622N 1054810E - 210121N 1055220E - 210025N 1055124E - 205856N 1054642E - 210130N 1054318E - 210622N 1054810E');
ok(poly.kind === 'polygon' && poly.ring.length === 6, 'an explicit DMS polygon keeps its vertices (VVP1)');
ok(!!geometryOf('210622N 1054810E - 210121N 1055220E - 210025N 1055124E - 205856N 1054642E').reason, 'a polygon that does not close in the source is not converted');
ok(!!geometryOf('Eastern: The parallel 15 KM West of centre-line of airway W1 (Segment AC -BU); Southern: The parallel 5 KM South of RWY 27L/09R of Bien Hoa aerodrome; Northern: A part of circle 75 KM radius centred at ARP of Tan Son Nhat aerodrome').reason, 'a referenced-boundary definition (VVR19) is never converted');
ok(!!geometryOf('A circle, 15 KM radius, centred at the coast').reason, 'a circle with no centre coordinate is not converted');
const fakeRing = (pts) => ccw(geometryOf(pts).ring);
const mistyped = '210620N 1052529E - 210749N 1052721E - 210544N 1052955E - 200333N 1052801E - 210620N 1052529E';
ok(validate({ kind: 'polygon' }, fakeRing(mistyped)).some((f) => /implausible/.test(f)), 'a vertex a degree away from its neighbours (VVD43 as published) fails the plausibility check');
ok(validate({ kind: 'polygon' }, fakeRing('210622N 1054810E - 210121N 1055220E - 210025N 1055124E - 205856N 1054642E - 210130N 1054318E - 210622N 1054810E')).length === 0, 'a valid polygon passes validation');
ok(validate({ kind: 'polygon' }, fakeRing('210000N 1050000E - 210000N 1050100E - 205900N 1050000E - 205900N 1050100E - 210000N 1050000E')).some((f) => /self-intersect/.test(f)), 'a bow-tie ring fails validation');

// Source and report
const dir = path.join(ROOT, 'data/regions/vn/vn-enr51');
const raw = fs.readFileSync(path.join(dir, 'source/VV-ENR-5.1-en-GB.html'));
const report = JSON.parse(fs.readFileSync(path.join(dir, 'exceptions.json'), 'utf8'));
ok(crypto.createHash('sha256').update(raw).digest('hex') === report.source.htmlSha256 && /^[0-9a-f]{64}$/.test(report.source.htmlSha256), 'the committed official page matches the recorded SHA-256');
ok(report.source.edition === '2026-10-01-AIRAC' && /^https:\/\/aim\.vatm\.vn\/.*2026-10-01-AIRAC.*VV-ENR-5\.1-en-GB\.html$/.test(report.source.url), 'edition and URL are the official 2026-10-01-AIRAC ENR 5.1');
const { rows } = parseRows(raw.toString('utf8'));
ok(rows.length === 74 && rows.filter((r) => r.designation === 'P').length === 4 && rows.filter((r) => r.designation === 'R').length === 21 && rows.filter((r) => r.designation === 'D').length === 49, 're-parsing the page gives 74 areas: 4 P, 21 R, 49 D');
ok(rows.every((r) => r.id.startsWith('VV') && r.id[2] === r.designation), 'every identifier carries its section letter');

// Converted layers
const layers = Object.fromEntries(['prohibited', 'restricted', 'danger'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'layers', k + '.geojson'), 'utf8')).features]));
const all = Object.entries(layers).flatMap(([k, list]) => list.map((f) => ({ k, f })));
const ids = all.map((x) => x.f.properties.id);
ok(new Set(ids).size === ids.length, 'every area ID is unique');
ok(all.every(({ k, f }) => ({ prohibited: 'P', restricted: 'R', danger: 'D' })[k] === f.properties.class && f.properties.id[2] === f.properties.class), 'the P/R/D class matches the layer and the identifier letter');
ok(layers.prohibited.length === 4 && layers.restricted.length === 20 && layers.danger.length === 47, '4 prohibited, 20 restricted, 47 danger areas converted');
ok(report.parsed === 74 && report.applicable === 74 && report.converted === 71 && report.unresolved === 3 && report.converted + report.unresolved === report.applicable, 'parsed 74 = converted 71 + unresolved 3');
ok(report.exceptions.map((e) => e.id).sort().join() === 'VVD43,VVD45,VVR19' && report.exceptions.every((e) => e.reason && !ids.includes(e.id)), 'unresolved: VVD43, VVD45 (mistyped vertex in the source, not corrected) and VVR19 (referenced boundaries); none is also converted');
ok(report.exceptions.find((e) => e.id === 'VVR19').category === 'external-reference' && report.exceptions.filter((e) => e.category === 'source-inconsistent').length === 2, 'VVR19 is external-reference; VVD43 and VVD45 are source-inconsistent');
ok(report.approximated === 3 && report.exceptions.every((e) => e.approximated), 'all three strict-extractor exceptions are covered by the approximate layers (71 exact + 3 approximate = 74)');
const byId = Object.fromEntries(all.map(({ f }) => [f.properties.id, f.properties]));
ok(byId.VVP1.upper === 'UNL' && byId.VVP1.lower === 'GND' && byId.VVP2.upper === '1500 M' && byId.VVR10.upper === '20000 M' && byId.VVR10.lower === '200 M AGL' && /Air force area 14/.test(byId.VVR10.remarks), 'upper/lower limits and remarks are preserved as published');
ok(byId.VVR37.upper === 'To be specified' && /notified by NOTAM/.test(byId.VVR37.remarks) && byId.VVD20.upper === 'Unspecified', 'unspecified upper limits are kept verbatim, never invented');
ok(byId.VVP4.name === 'VVP4 HO CHI MINH CITY' && byId.VVR33.name === 'VVR33 TU LOC' && byId.VVD52.name === 'VVD52', 'named and unnamed areas keep their published name');
ok(all.every(({ f }) => f.properties.vertical && f.properties.upper && f.properties.lower && f.properties.description.includes('Upper')), 'every area keeps its vertical limits');
ok(all.filter(({ f }) => f.properties.geometryKind === 'circle').length === 32 && all.filter(({ f }) => f.properties.geometryKind === 'polygon').length === 39, '32 circles and 39 coordinate polygons');
const rings = all.map(({ f }) => f.geometry.coordinates[0]);
ok(rings.every((r) => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]), 'every ring is closed');
ok(rings.flat().every(([x, y]) => x > 100 && x < 118 && y > 6 && y < 24), 'every coordinate is longitude/latitude inside the Vietnamese window');
ok(rings.every((r) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) > 0), 'outer rings are counter-clockwise with non-zero area');
ok(all.every(({ f }) => validate({ kind: 'polygon' }, f.geometry.coordinates[0]).length === 0 || f.properties.geometryKind === 'circle'), 'every emitted ring passes the validator (closure, winding, topology, bounds, plausibility)');

// Archive
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/vn/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'vn-enr51');
ok(!!region && region.cells === 118 && region.semantics === 'restrict' && region.classes.filter((c) => !c.id.startsWith('aerodrome-')).map((c) => c.id).join() === 'prohibited,restricted,danger,approx-restricted,approx-danger' && region.classes.filter((c) => !c.id.startsWith('aerodrome-')).map((c) => c.verdict).join() === 'prohibited,restricted,danger,restricted,danger', 'the manifest registers vn-enr51 with the 74 ENR 5.1 areas (three exact P/R/D classes plus approximate R and D) and the 44 airport zones (tested in vn-ad-unit)');
ok(region.source.edition === '2026-10-01-AIRAC' && region.source.effective === '2026-10-01' && region.partialCoverage === true && !region.boundary && region.classes.filter((c) => c.approximate).map((c) => c.id).join() === 'approx-restricted,approx-danger' && region.classes.filter((c) => c.approximate).every((c) => c.severity > 3), 'edition recorded; partial coverage; no boundary; only the two approximate classes are flagged (severity above every exact class)');
const bytes = fs.readFileSync(path.join(ROOT, 'public/data', region.file));
const arch = new PMTiles({ getKey: () => region.file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const segD = ([ax, ay], [bx, by], x, y) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; return Math.hypot(ax + u * dx - x, ay + u * dy - y); };
const witness = (r) => {
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
const apx = Object.fromEntries(['restricted', 'danger'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'layers', `approx-${k}.geojson`), 'utf8')).features]));
const apxAll = Object.entries(apx).flatMap(([k, list]) => list.map((f) => ({ k: 'approx-' + k, f })));
for (const { k, f } of [...all, ...apxAll]) {
  const w = witness(f.geometry.coordinates[0]);
  const zs = w ? await zonesInArchive(arch, region.maxZoom, w[1], w[0]) : [];
  if (!zs.length) { lost++; console.log('  lost ' + f.properties.id); } else if (!zs.some((z) => z.c === k)) { wrong++; console.log('  wrong class ' + f.properties.id); }
}
ok(lost === 0 && wrong === 0, 'every one of the 74 areas (71 exact + 3 approximate) is present in the archive at its max zoom with its own class');
const at = async (lat, lon) => (await zonesInArchive(arch, region.maxZoom, lat, lon)).map((z) => z.c).join();
ok((await at(21.0305, 105.8)).split(',').includes('prohibited'), 'inside VVP1 (Ha Noi city): prohibited');
ok((await at(15.4056, 108.7064)).split(',').includes('restricted'), 'inside VVR11 (15 km circle): restricted');
ok((await at(10.775, 106.683)).split(',').includes('prohibited'), 'inside VVP4 (Ho Chi Minh City): prohibited');
ok(await at(20.5, 105.0) === '', 'Ninh Binh, outside every converted polygon, has no zone (unknown, not permitted)');
ok(await at(21.3, 108.0) === '' && await at(10.0, 100.5) === '', 'a Vietnamese sea point and a point outside Vietnam read no zone');
// The three approximated areas
const prov = JSON.parse(fs.readFileSync(path.join(dir, 'approx-provenance.json'), 'utf8')).areas, pv = Object.fromEntries(prov.map((a) => [a.id, a]));
const apxIds = apxAll.map(({ f }) => f.properties.id).sort().join();
ok(apxIds === 'VVD43,VVD45,VVR19' && !apxIds.split(',').some((i) => ids.includes(i)), 'VVR19, VVD43, VVD45 are the approximate features and none is also an exact feature');
ok(apx.restricted.length === 1 && apx.restricted[0].properties.class === 'R' && apx.danger.length === 2 && apx.danger.every((x) => x.properties.class === 'D'), 'VVR19 is in the approximate R layer, VVD43 and VVD45 in the approximate D layer');
ok(pv.VVR19.geometryConfidence === 'approximate' && pv.VVD43.geometryConfidence === 'derived' && pv.VVD45.geometryConfidence === 'approximate' && prov.every((a) => a.method && a.reasonApproximate && a.source && a.edition === '2026-10-01-AIRAC'), 'provenance records confidence, method, source/edition and the reason for each');
ok(pv.VVD43.evidence.published === '200333N 1052801E' && pv.VVD43.evidence.interpreted === '210333N 1052801E' && pv.VVD45.evidence.published === '210159N 1062002E' && pv.VVD45.evidence.interpreted === '210159N 1052002E', 'the published and the interpreted malformed vertices are both kept as evidence');
ok(pv.VVR19.chartMaxVertexDeviationM < 2000 && pv.VVR19.uncertaintyM === 2000, 'VVR19 matches the official chart outline within 2 km');
ok(apxAll.every(({ f }) => f.properties.approximate === true && f.properties.upper && f.properties.vertical && f.properties.remarks && /approximated from official AIP chart/.test(f.properties.note)), 'approximate features keep their altitude/activation metadata and the chart-approximation wording');
const vv19 = apx.restricted[0].geometry.coordinates[0];
ok(Math.max(...vv19.map((p) => inverse(106.6608, 10.8206, p[0], p[1]).s)) < 75100 && vv19.filter((p) => Math.abs(inverse(106.6608, 10.8206, p[0], p[1]).s - 75000) < 50).length > 50, 'VVR19 northern edge is the 75 km arc about the Tan Son Nhat ARP');
const vd43 = apx.danger.find((x) => x.properties.id === 'VVD43').geometry.coordinates[0], vd45 = apx.danger.find((x) => x.properties.id === 'VVD45').geometry.coordinates[0];
ok(vd43.every((p) => p[1] > 21 && p[1] < 21.2) && vd45.every((p) => p[0] > 105.3 && p[0] < 105.6), 'VVD43 and VVD45 no longer have a vertex a degree from the rest');
ok(await at(11.1, 106.8) === 'approx-restricted', 'inside VVR19 (Bien Hoa): approximate restricted');
ok(await at(10.7, 106.8) === '' && await at(11.7, 106.8) === '' && await at(11.1, 107.5) === '' && await at(11.1, 105.9) === '', 'outside VVR19 (south, beyond the 75 km arc, east of W1, west of R468): no zone');
ok(await at(21.095, 105.46) === 'approx-danger' && await at(21.095, 105.7) === '' && await at(20.5, 105.46) === '', 'VVD43: inside reads approximate danger; points east and 0.6 degrees south read no zone');
ok(await at(21.015, 105.47) === 'approx-danger' && await at(21.015, 106.2) === '' && await at(21.2, 105.47) === '', 'VVD45: inside reads approximate danger; the published far vertex area (106.3E) and points north read no zone');

// Point-check wording
const z = (c, n) => ({ status: 'inside', region, zones: [{ c, n }] });
const p = zoneSummary(z('prohibited', 'VVP1 HA NOI CITY')), r = zoneSummary(z('restricted', 'VVR11')), d = zoneSummary(z('danger', 'VVD23'));
ok(p.cls === 'no' && /^Prohibited area: VVP1/.test(p.title) && /not permitted/.test(p.detail) && /Vietnam Air Traffic Management/.test(p.detail), 'P is worded as prohibited, citing the Vietnam source');
ok(r.cls === 'no' && /^Restricted area/.test(r.title) && /conditions/.test(r.detail) && !/not permitted/.test(r.detail), 'R is worded as restricted with conditions, not as a ban');
ok(d.cls === 'unk' && /^Danger area/.test(d.title) && /Caution/.test(d.detail) && !/no-fly|not allowed/i.test(d.title + d.detail), 'D is worded as caution, not as a ban');
const ax = zoneSummary({ status: 'inside', region, zones: [{ c: 'approx-restricted', n: 'VVR19 BIEN HOA' }] });
ok(ax.cls === 'no' && /^Potential restricted airspace — approximate boundary: VVR19/.test(ax.title) && /Boundary approximated from official AIP chart/.test(ax.detail) && /AIP Viet Nam/.test(ax.detail) && !/CAAM/.test(ax.detail), 'a point in VVR19 says: potential restricted airspace, approximate boundary, approximated from the official AIP chart');
const none = zoneSummary({ status: 'outside', region, zones: [] });
ok(none.cls === 'unk' && /does not mean flying is allowed/.test(none.detail), 'outside every polygon: unknown, never permission');
await vite.close();
