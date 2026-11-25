// Malaysia (my-enr51): CAAM ENR 5.1 prohibited / restricted / danger areas. Checks the extractor rules, the converted layers, the exception report,
// the built archive (every converted area present with its class, gaps unknown) and the P/R/D wording. Reads public/data (run `node scripts/build-data.js my-enr51` first).
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
const { geometryOf, inverse, administration, subtractPolygon, boundaryRing } = await import(url('scripts/airspace/my-enr51.mjs'));
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
const navArc = 'From 053308N 1020235E then along 40 NM arc from VKB VOR to 052956N 1022349E then to 051048N 1023100E then along 60 NM arc VKB VOR to 051254N 1015900E then to 053308N 1020235E';
ok(!!geometryOf(navArc, {}).reason, 'an arc centred on a navaid is not converted when the navaid coordinates are unknown');
const navRef = geometryOf(navArc);
const vkb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions/my/my-enr51/references.json'), 'utf8')).points.VKB;
ok(navRef.kind === 'arc-polygon' && navRef.ring.some((p) => Math.abs(inverse(vkb[0], vkb[1], p[0], p[1]).s - 40 * 1852) < 400), 'a navaid-centred arc is resolved from the published navaid coordinates (VKB, ENR 4.1) and lies on its radius');
const sector = geometryOf('A straight line from 055152N 1181921E to 055017N 1182916E then an arc radius 25NM centered at VSN VOR(055413.62N 1180429.55E) to 053255N 1181747E then a straight line to 054127N 1181228E, then an arc radius 15NM centered at VSN VOR (055413.62N 1180429.55E) to 055152N 1181921E');
ok(sector.kind === 'arc-polygon' && /shorter arc/.test(sector.note), 'an arc with no stated direction takes the shorter arc and records that in the feature');
ok(!!geometryOf('From 020000N 1025839E an arc of a circle radius 10 NM centred on 020230N 1031824E to 021830N 1032954E then 022000N 1030000E then 020000N 1025839E').reason, 'an arc whose endpoints are not on the stated radius is not converted');
ok(geometryOf('Straight line fm 030459N 1004139E, 024405N 1012847E, 022206N 1012834E to start.').kind === 'polygon', 'a three-point path that says "to start" is a triangle');
ok(!!geometryOf('045211.00N 1000622.00E , 042938.61N 0994510.12E to 041553.85N 1001716.29E').reason, 'three points with no closing statement stay unresolved');
ok(geometryOf('Straight line fm 034705N 1011331E to 033437N 1012825E to 032159N 1013613E to 032459N 1012619E to 032429N 1012007E to 034706N 1011336E to start.').note?.includes('closes at the first vertex'), 'a self-intersecting ring whose last vertex restates the start is closed at the first vertex');
ok(!geometryOf('Straight line fm 030635N 1014643E to 030959N 1015055E to 030959N 1020555E to 025559N 1020455E to 025659N 1015041E to 030417N 1014619E to 030636N 1014648E.').note, 'a valid ring with a near-duplicate last vertex is left as published');
const refsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions/my/my-enr51/references.json'), 'utf8'));
const tmaText = 'From 054846N 0994912E thence along the Butterworth TMA boundary to 050515N 0995100E then 050000N 0990000E then 054846N 0990000E';
const tma = geometryOf(tmaText);
const bt = refsDoc.points && refsDoc.boundaries['BUTTERWORTH TMA'], vbt = [100 + 23 / 60 + 42 / 3600, 5 + 28 / 60 + 36 / 3600];
ok(tma.kind === 'polygon' && tma.ring.length > 40 && tma.ring.slice(1, -3).every((p) => Math.abs(inverse(vbt[0], vbt[1], p[0], p[1]).s - 40 * 1852) < 1200), 'a boundary named in ENR 5.1 (Butterworth TMA) is replaced by the arc published in ENR 2.1, the shorter way between the two points');
ok(!!bt && !!geometryOf(tmaText, {}).ring, 'the boundary rule needs no navaid references');
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const cut = subtractPolygon(sq(0, 0, 4, 4), sq(3, 1, 6, 3).slice(0, -1));
const cutArea = cut.reduce((a, p, i) => (i ? a + (cut[i - 1][0] * p[1] - p[0] * cut[i - 1][1]) : a), 0) / 2;
ok(cut && Math.abs(Math.abs(cutArea) - 14) < 1e-9, 'subtracting a rectangle that overlaps one side removes exactly the overlap (16 - 2 = 14)');
ok(boundaryRing(refsDoc.boundaries['KERTEH CTR']).length > 100, 'the Kerteh CTR boundary builds from its published arcs and lines');
const arc = geometryOf('Commencing from 023719.63N 1022641.96E, clockwise along an arc of a circle 10NM radius centered on 022833.00N 1023146.00E to 021900.61N 1023438.10E, then along a straight line to 022419.10N 1022841.24E, then a straight line to 023719.63N 1022641.96E');
ok(arc.kind === 'arc-polygon' && arc.ring.length > 60, 'an arc with stated centre, radius and direction is reconstructed');

// Converted layers and exception report
const dir = path.join(ROOT, 'data/regions/my/my-enr51');
const layers = Object.fromEntries(['prohibited', 'restricted', 'danger'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'layers', k + '.geojson'), 'utf8')).features]));
const report = JSON.parse(fs.readFileSync(path.join(dir, 'exceptions.json'), 'utf8'));
const all = Object.entries(layers).flatMap(([k, list]) => list.map((f) => ({ k, f })));
const ids = all.map((x) => x.f.properties.id);
ok(new Set(ids).size === ids.length, 'every area ID is unique');
ok(all.every(({ k, f }) => ({ prohibited: 'P', restricted: 'R', danger: 'D' })[k] === f.properties.class && f.properties.id[2] === f.properties.class), 'the P/R/D class matches the layer and the identifier letter');
ok(layers.prohibited.length === 3 && layers.restricted.length === 44 && layers.danger.length === 17, '3 prohibited, 44 restricted, 17 danger Malaysian areas converted');
ok(report.parsed === 108 && report.excludedSingapore === 8 && report.excludedBrunei === 14 && report.applicable === 86 && report.parsed === report.applicable + report.excludedSingapore + report.excludedBrunei, 'parsed 108 = 86 Malaysian + 8 Singapore + 14 Brunei');
ok(report.converted === 64 && report.unresolved === 22 && report.converted + report.unresolved === report.applicable, 'Malaysian applicable = converted + unresolved (86 = 64 + 22)');
ok(report.exceptions.every((e) => ['external-reference', 'ambiguous'].includes(e.category)) && report.exceptions.filter((e) => e.category === 'ambiguous').map((e) => e.id).sort().join() === 'WBR523,WMD421,WMR225,WMR226', 'every unresolved area is classed external-reference (18) or ambiguous (4: WMR225, WMR226, WBR523, WMD421)');
ok(report.exceptions.every((e) => !ids.includes(e.id) && e.reason) && new Set(report.exceptions.map((e) => e.id)).size === 22, 'no area is both converted and unresolved; each unresolved area has a reason');

// Country scope: Singapore- and Brunei-administered areas stay in the report, not in the Malaysia layers
const exclIds = report.excluded.map((e) => e.id);
ok(report.excluded.length === 22 && report.excluded.every((e) => e.evidence && ['Singapore', 'Brunei'].includes(e.administeredBy)), '22 excluded areas, each with its administering state and the evidence');
ok(exclIds.every((id) => !ids.includes(id) && !report.exceptions.some((e) => e.id === id)), 'no excluded area is in a Malaysia layer or in the Malaysian unresolved list');
ok(report.excluded.filter((e) => e.administeredBy === 'Singapore').every((e) => /^WS/.test(e.id)) && report.excluded.filter((e) => e.administeredBy === 'Brunei').every((e) => /^WB/.test(e.id)), 'Singapore exclusions are WS-series, Brunei exclusions WB-series');
ok(administration({ id: 'WBD507', text: 'x', restriction: '', remarks: 'Controlling Authority: DCA Brunei.', name: '' }).state === 'BN' && administration({ id: 'WBR601', text: 'KUCHING', restriction: '', remarks: 'Controlling Authority: KUCHING RADAR', name: 'KUCHING' }).state === 'MY', 'an explicit Brunei controlling authority excludes; a WB-prefixed Malaysian area (Kuching) is kept');
ok(['WBR508', 'WBR518', 'WBD505', 'WBR501'].every((id) => !exclIds.includes(id)) && ['WSD11', 'WSR2', 'WBP504', 'WBD507', 'WBR560/520'].every((id) => exclIds.includes(id)), 'Sabah/Sarawak WB areas are Malaysian; Singapore and Brunei examples are excluded');

// Regression: the 61 first-pass geometries must not change (a new parser rule that moves one fails here)
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/my-enr51-baseline-geometry.json'), 'utf8')).geometry;
const hashOf = (g) => crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex').slice(0, 16);
const nowHash = Object.fromEntries(all.map(({ f }) => [f.properties.id, hashOf(f.geometry)]));
const changed = Object.keys(baseline).filter((id) => nowHash[id] && nowHash[id] !== baseline[id]);
const gone = Object.keys(baseline).filter((id) => !nowHash[id] && !exclIds.includes(id));
ok(Object.keys(baseline).length === 61 && changed.length === 0 && gone.length === 0, 'all 42 baseline Malaysian geometries are byte-identical and none was dropped (' + changed.concat(gone).join(',') + ')');
const recovered = ['WMR105', 'WMR106', 'WMR108', 'WMR225A', 'WMR225B', 'WMR302A', 'WMR418', 'WBR508', 'WBR509', 'WBR510', 'WBR511', 'WBR518', 'WBR601', 'WBR603', 'WBR604', 'WMR102B', 'WMR103B', 'WMR107', 'WBR519', 'WBR520', 'WMD412A', 'WMD420'];
ok(recovered.every((id) => nowHash[id] && !baseline[id]), 'the 22 newly recovered areas are present');
ok(all.every(({ f }) => f.properties.vertical && f.properties.upper && f.properties.lower && f.properties.description.includes('Upper')), 'every area keeps its published vertical limits');
const rings = all.map(({ f }) => f.geometry.coordinates[0]);
ok(rings.every((r) => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]), 'every ring is closed');
ok(rings.flat().every(([x, y]) => x > 95 && x < 120 && y > 0 && y < 10), 'every coordinate is longitude/latitude inside the Malaysian window');
ok(rings.every((r) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) > 0), 'outer rings are counter-clockwise with non-zero area');

// Archive
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/my/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'my-enr51');
ok(!!region && region.cells === 142 && region.semantics === 'restrict' && region.classes.map((c) => c.id).join() === 'aerodrome-traffic-zone,approx-prohibited,approx-restricted,approx-danger,prohibited,restricted,danger', 'the manifest registers my-enr51 with 64 verified + 12 approximate areas + 66 aerodrome traffic zones and its seven classes (traffic zones are drawn first, under P/R/D)');
ok(region.classes.map((c) => c.verdict).join() === 'authorisation-required,prohibited,restricted,danger,prohibited,restricted,danger' && region.source.effective === '2026-11-03', 'classes carry their P/R/D verdict; the edition date is recorded');
ok(region.classes.filter((c) => c.approximate).map((c) => c.id).join() === 'approx-prohibited,approx-restricted,approx-danger' && region.classes.filter((c) => !c.approximate).every((c) => !('approximate' in c)), 'only the three approx-* classes are flagged approximate; verified classes are not');
ok(region.classes.filter((c) => c.approximate).every((c) => c.severity > Math.max(...region.classes.filter((v) => !v.approximate && v.verdict !== 'authorisation-required').map((v) => v.severity))), 'approximate classes sort after every verified class (verified geometry takes precedence)');
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
ok(lost === 0 && wrong === 0, 'every one of the 64 converted areas is present in the archive at its max zoom with its own class');
ok((await zonesInArchive(arch, region.maxZoom, 3.139, 101.687)).length === 0, 'central Kuala Lumpur, outside every converted polygon, has no zone (unknown, not permitted)');
ok((await zonesInArchive(arch, region.maxZoom, 4.8889, 114.8342)).length === 0, 'the Brunei-administered Jerudong area (WBP504) is absent from the Malaysia archive');
ok((await zonesInArchive(arch, region.maxZoom, 1.38, 103.67)).length === 0, 'the Singapore-administered Pasir Laba area (WSD11) is absent from the Malaysia archive');
ok(!region.boundary && region.partialCoverage === true, 'no coverage boundary and marked partial: outside the polygons nothing is claimed');

// Approximate layer: separate from the verified geometry, with provenance
const approxFiles = ['prohibited', 'restricted', 'danger'].map((k) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'layers', 'approx-' + k + '.geojson'), 'utf8')).features]);
const approx = approxFiles.flatMap(([k, list]) => list.map((f) => ({ k, f })));
const prov = JSON.parse(fs.readFileSync(path.join(dir, 'approx-provenance.json'), 'utf8'));
const APPROX_IDS = ['WBR524', 'WMD419', 'WMP228', 'WMR239A', 'WMR239B', 'WMR240A', 'WMR240B', 'WMR407', 'WMR416A', 'WMR416B', 'WMR416C', 'WMR419'];
ok(approx.map((x) => x.f.properties.id).sort().join() === APPROX_IDS.join(), '12 approximate areas: ' + APPROX_IDS.join(' '));
ok(approx.every(({ k, f }) => f.properties.approximate === true && f.properties.geometryKind === 'approximate' && ({ prohibited: 'P', restricted: 'R', danger: 'D' })[k] === f.properties.class), 'approximate features are flagged approximate and keep their P/R/D class');
ok(approx.every(({ f }) => !ids.includes(f.properties.id)) && all.every(({ f }) => !f.properties.approximate), 'verified and approximate geometry are in separate layers: no area is in both and no verified feature is flagged approximate');
ok(report.converted === 64 && report.approximation.approximateCount === 12 && report.approximation.approximate.length === 12 && report.approximation.unresolvedAfterApproximation.length === 10 && report.unresolved - 12 === 10, 'counts: 64 verified, 12 approximate, 10 unresolved');
ok(prov.features.length === 12 && prov.features.every((p) => p.approximate === true && p.confidence === 'approximate' && p.id && p.class && p.caamEdition?.effective === '2026-11-03' && p.anchors?.length >= 1 && p.referencedFeatureTypes?.length && p.secondaryDataset?.name && p.secondaryDataset?.licence && p.method && p.bufferM >= 250 && /Not an official CAAM polygon/.test(p.limitations)), 'every approximate feature carries provenance: id, class, edition, anchors, referenced feature type, secondary dataset, method, flag, limitations');
const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
ok(prov.features.every((p) => { const ringOf = approx.find((x) => x.f.properties.id === p.id).f.geometry.coordinates[0]; return p.anchors.filter((a) => a.inPolygon).every((a) => ringOf.some((q) => near(q, a.lonlat))); }), 'every CAAM anchor point is preserved exactly in its approximate polygon');
const kmArea = (r) => { const k = Math.cos((r[0][1] * Math.PI) / 180) * 111.32; return Math.abs(r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * k * p[1] * 110.57 - p[0] * k * r[i - 1][1] * 110.57) : s), 0) / 2); };
const crosses = (r) => { const n = r.length - 1, o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (o(r[i], r[i + 1], r[j]) !== o(r[i], r[i + 1], r[j + 1]) && o(r[j], r[j + 1], r[i]) !== o(r[j], r[j + 1], r[i + 1])) return true; } return false; };
ok(approx.every(({ f }) => { const r = f.geometry.coordinates[0]; return r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] && r.flat().every((v) => typeof v === 'number') && r.every(([x, y]) => x > 95 && x < 120 && y > 0 && y < 10) && !crosses(r) && kmArea(r) > 1 && kmArea(r) < 20000; }), 'approximate rings are closed, WGS84 lon/lat, simple (no self-intersection) and neither tiny nor enormous');
ok(prov.features.every((p) => p.straightLineAreaRatio === null || (p.straightLineAreaRatio >= 0.5 && p.straightLineAreaRatio <= 5)), 'no approximate polygon departs wildly from the straight-line polygon through its CAAM anchors');
const ambiguous = ['WMR225', 'WMR226', 'WBR523', 'WMD421'];
ok(ambiguous.every((id) => !ids.includes(id) && !approx.some((x) => x.f.properties.id === id) && report.exceptions.some((e) => e.id === id && e.category === 'ambiguous')), 'the four ambiguous areas (WMR225, WMR226, WBR523, WMD421) stay unresolved: in no layer');
ok(approx.every(({ f }) => !exclIds.includes(f.properties.id) && !/^WS/.test(f.properties.id)), 'Singapore and Brunei areas are not in the approximate layer');
ok(['WMR302A', 'WMR302B', 'WBR519', 'WBR520', 'WBR606'].every((id) => ids.includes(id)) && ['WMR239B', 'WMR419', 'WBR524'].every((id) => approx.some((x) => x.f.properties.id === id)), 'Malaysian-administered offshore areas stay included (verified and approximate)');
let approxLost = 0;
for (const { k, f } of approx) { const w = witness(f.geometry.coordinates[0]), zs = w ? await zonesInArchive(arch, region.maxZoom, w[1], w[0]) : []; if (!zs.some((x) => x.c === 'approx-' + k)) { approxLost++; console.log('  lost approx ' + f.properties.id); } }
ok(approxLost === 0, 'every approximate area is in the archive under its approx-* class');
// the ENR 5.1 arcs whose direction is not published: only areas verified against the official CAAM chart are emitted
const inferred = all.filter(({ f }) => /arc direction not published/.test(f.properties.geometryNote ?? ''));
ok(inferred.length === 13 && inferred.every(({ f }) => /CAAM AIP ENR 6 chart/.test(f.properties.arcVerifiedAgainst ?? '')), '13 inferred-direction arcs, each recorded as verified against an official CAAM chart');
const { ARC_VERIFIED } = await import(url('scripts/airspace/my-enr51.mjs'));
ok(Object.keys(ARC_VERIFIED).length === 13 && report.exceptions.every((e) => !/not verified against an official CAAM chart/.test(e.reason)), 'all inferred arcs verified; none dropped for lack of verification');

// Styling: verified stays solid; approximate is hatched with an uncertainty outline, in both themes, and never green
const { zonePaintSpec, swatchBackground } = await import(url('src/zone-style.js'));
const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
const lightLine = css.match(/:root\{[^}]*--zone-approx-line:(#[0-9a-f]{6})/i)?.[1], darkLine = css.match(/:root\[data-theme="dark"\]\{--zone-approx-line:(#[0-9a-f]{6})/i)?.[1];
const hue = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; return ((mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360; };
const notGreen = (h) => hue(h) < 80 || hue(h) > 175;
const approxClass = region.classes.find((c) => c.id === 'approx-restricted'), verifiedClass = region.classes.find((c) => c.id === 'restricted');
ok(zonePaintSpec(verifiedClass).kind === 'solid' && zonePaintSpec(verifiedClass).fill === verifiedClass.color, 'a verified class is still a flat fill in its colour');
ok(zonePaintSpec(approxClass, lightLine).kind === 'hatch' && zonePaintSpec(approxClass, lightLine).stripe === approxClass.color && zonePaintSpec(approxClass, darkLine).outline === darkLine, 'an approximate class is stripes in its P/R/D colour with an outline');
ok(!!lightLine && !!darkLine && lightLine !== darkLine && notGreen(lightLine) && notGreen(darkLine), 'the uncertainty outline is defined for light and dark themes (different values) and neither is green');
ok(region.classes.every((c) => notGreen(c.color)), 'no Malaysia class colour is green');
ok(/repeating-linear-gradient/.test(swatchBackground(approxClass)) && swatchBackground(verifiedClass) === verifiedClass.color, 'the key swatch is striped for approximate classes and flat for verified ones');

// Point-check wording for approximate boundaries
const za = (c, n) => ({ status: 'inside', region, zones: [{ c, n }] });
const ar = zoneSummary(za('approx-restricted', 'WMR239A')), ap = zoneSummary(za('approx-prohibited', 'WMR419')), ad = zoneSummary(za('approx-danger', 'WMD419'));
ok(ar.cls === 'no' && /^Potential restricted airspace — approximate boundary/.test(ar.title) && /conservatively reconstructed from CAAM ENR 5\.1/.test(ar.detail) && /Treat this location as potentially restricted and verify with current CAAM information before flying/.test(ar.detail), 'a point in an approximate R boundary says: potential restricted airspace, approximate boundary, with the reconstruction warning');
ok(/^Potential prohibited airspace — approximate boundary/.test(ap.title) && /potentially prohibited/.test(ap.detail) && ad.cls === 'unk' && /^Potential danger airspace — approximate boundary/.test(ad.title) && /potentially a danger area/.test(ad.detail), 'the warning is adapted for P and D');
ok(![ar, ap, ad].some((s) => /^(Prohibited|Restricted|Danger) area/.test(s.title) || /per Civil Aviation/.test(s.detail)), 'an approximate boundary is never reported as an exact CAAM verdict');
const both = zoneSummary({ status: 'inside', region, zones: [{ c: 'approx-prohibited', n: 'WMR419' }, { c: 'restricted', n: 'WMR101A' }] });
ok(/^Restricted area: WMR101A/.test(both.title) && /Also inside: Prohibited area \(P\), approximate boundary/.test(both.detail), 'where verified and approximate zones overlap, the verified zone decides, and the approximate one is listed');
const flat = zoneSummary({ status: 'inside', region: { ...region, classes: region.classes.map(({ approximate, ...c }) => c) }, zones: [{ c: 'approx-restricted', n: 'X' }] });
ok(!/approximate boundary/.test(flat.title), 'only classes flagged approximate get the approximate wording');

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
