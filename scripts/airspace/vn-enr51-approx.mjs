// Vietnam ENR 5.1: the three areas the strict extractor (vn-enr51.mjs) cannot convert: VVR19, VVD43, VVD45.
// Output: data/regions/vn/vn-enr51/layers/approx-{restricted,danger}.geojson and approx-provenance.json. Never mixed into the verified layers.
// Usage: node scripts/airspace/vn-enr51-approx.mjs   (run after vn-enr51.mjs)
//
// VVR19 (derived from the AIP text, southern line read off the official chart):
//   Western  = parallel 15 km north of airway R468 (TSH-SAPEN, ENR 3.1, same edition; R468 continues to PNH on the same bearing).
//   Eastern  = parallel 15 km west of the centre-line of W1 segment AC-BU. "BU" is read as BMT (Buon Ma Thuot DVOR/DME): W1 runs BMT-ENRIN-AC on one bearing (028 deg)
//              and the chart's eastern edge is parallel to it, 15 km west of the An Loc NDB (AC).
//   Northern = arc of the 75 km circle about the Tan Son Nhat ARP (AD 2 VVTS).
//   Southern = parallel 5 km south of RWY 27L/09R at Bien Hoa. The Bien Hoa runway coordinates are not published in the Vietnam eAIP, so the latitude is read from the
//              official chart (ENR 5.1-13, graphics/9132; vector PDF georeferenced on six converted circle centres, residual <= 0.6 pt = 0.5 km).
// VVD43 / VVD45: published polygons with one malformed vertex each (see PUBLISHED below); the interpreted vertex is stored next to the published one in provenance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { direct, inverse, coords, ring, ccw, signedArea, selfIntersects } from './my-enr51.mjs';
import { parseRows, EDITION } from './vn-enr51.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'vn', 'vn-enr51');
const html = fs.readFileSync(path.join(OUT, 'source', 'VV-ENR-5.1-en-GB.html'), 'utf8');
const rows = Object.fromEntries(parseRows(html).rows.map((r) => [r.id, r]));
const P = (s) => coords(s)[0].p;

// ---- VVR19 ----
const TSN = P('104914N 1063939E'); // Tan Son Nhat ARP, AD 2 VVTS
const TSH = P('104906N 1063902E'), SAPEN = P('110112N 1061100E'); // R468, ENR 3.1
const AC = P('105621N 1071118E'), BMT = P('123959N 1080723E'); // W1, ENR 3.1 (An Loc NDB, Buon Ma Thuot DVOR/DME)
const LAT_SOUTH = 10.9296; // chart-derived: 5 km south of the Bien Hoa runway (runway coordinates not in the eAIP)
const R_KM = 75000, OFF = 15000;
const enu = (p) => { const i = inverse(TSN[0], TSN[1], p[0], p[1]), a = (i.az ?? i.a ?? i.azimuth) * Math.PI / 180; return [i.s * Math.sin(a), i.s * Math.cos(a)]; };
const geo = ([x, y]) => direct(TSN[0], TSN[1], (Math.atan2(x, y) * 180) / Math.PI, Math.hypot(x, y));
const unit = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]], n = Math.hypot(...d); return [d[0] / n, d[1] / n]; };
const circleHit = (o, u, pick) => { // |o + t u| = R
  const b = o[0] * u[0] + o[1] * u[1], c = o[0] ** 2 + o[1] ** 2 - R_KM ** 2, d = Math.sqrt(b * b - c);
  return [-b - d, -b + d].map((t) => [o[0] + t * u[0], o[1] + t * u[1]]).sort(pick)[0];
};
const [tsh, sapen, ac, bmt] = [TSH, SAPEN, AC, BMT].map(enu);
const uW = unit(tsh, sapen); // WNW
const nW0 = [uW[1], -uW[0]], nW = nW0[1] > 0 ? nW0 : [-nW0[0], -nW0[1]]; // normal on the north side
const oW = [tsh[0] + OFF * nW[0], tsh[1] + OFF * nW[1]];
const uE = unit(ac, bmt); // NNE
const nE = [-uE[1], uE[0]], nEw = nE[0] < 0 ? nE : [-nE[0], -nE[1]]; // normal on the west side
const oE = [ac[0] + OFF * nEw[0], ac[1] + OFF * nEw[1]];
const yS = enu([TSN[0], LAT_SOUTH])[1];
const atY = (o, u, y) => { const t = (y - o[1]) / u[1]; return [o[0] + t * u[0], y]; };
const wArc = circleHit(oW, uW, (a, b) => a[0] - b[0]); // westernmost intersection of the west line with the circle
const eArc = circleHit(oE, uE, (a, b) => b[1] - a[1]); // northernmost intersection of the east line with the circle
const wS = atY(oW, uW, yS), eS = atY(oE, uE, yS);
const brg = (p) => ((Math.atan2(p[0], p[1]) * 180) / Math.PI + 360) % 360;
let b0 = brg(wArc), b1 = brg(eArc); if (b1 < b0) b1 += 360;
const arc = []; for (let b = b0; b < b1; b += 1) arc.push(direct(TSN[0], TSN[1], b % 360, R_KM));
const vvr19 = [geo(wS), geo(wArc), ...arc.slice(1), geo(eArc), geo(eS)];
vvr19[0] = [vvr19[0][0], LAT_SOUTH]; vvr19.at(-1)[1] = LAT_SOUTH;
vvr19.push(vvr19[0]);
// official chart outline (vector PDF graphics/9132, six-circle affine fit, simplified): used only to measure the deviation
const CHART = [[107.0313, 10.9296], [106.721, 10.9296], [106.2385, 11.1449], [106.0931, 11.1949], [106.1995, 11.319], [106.3214, 11.4076], [106.4757, 11.472], [106.6284, 11.497], [106.7925, 11.4857], [106.9363, 11.4414], [107.0736, 11.3625], [107.1987, 11.2417]];
const dense = vvr19.slice(1).flatMap((b, i) => { const a = vvr19[i]; return Array.from({ length: 41 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40]); });
const vtxDev = Math.max(...CHART.map((c) => Math.min(...dense.map((v) => inverse(c[0], c[1], v[0], v[1]).s)))); // chart outline vertex to our boundary

// ---- VVD43 / VVD45 ----
const PUBLISHED = {
  VVD43: { vertex: 4, published: '200333N 1052801E', interpreted: '210333N 1052801E', why: 'latitude 20 deg 03 min is 1 degree south of the other three vertices (21 deg 05-07 min N); 210333N gives a convex quadrilateral of ~5 km, as the other rifle-range areas' },
  VVD45: { vertex: 1, published: '210159N 1062002E', interpreted: '210159N 1052002E', why: 'longitude 106 deg 20 min is 1 degree east of the other three vertices (105 deg 27-31 min E); 105 deg 20 min E gives a convex quadrilateral' },
};
function fixedRing(id) {
  const cs = coords(rows[id].text).map((c) => c.p), k = PUBLISHED[id], fixed = P(k.interpreted);
  const pts = cs.map((p, i) => (i === k.vertex - 1 || (k.vertex === 1 && i === cs.length - 1) ? fixed : p));
  return ring(pts);
}

const feat = (id, r, extra) => {
  const w = rows[id];
  return {
    type: 'Feature',
    properties: { id, name: `${id}${w.name ? ' ' + w.name : ''}`, class: w.designation, upper: w.upper, lower: w.lower, vertical: w.vertical, restriction: '', remarks: w.remarks,
      description: `Upper ${w.upper}, lower ${w.lower || 'n/a'}. ${w.remarks}`.slice(0, 500), geometryKind: 'approximate', approximate: true, ...extra },
    geometry: { type: 'Polygon', coordinates: [ccw(r)] },
  };
};
const checks = (r) => { const o = ccw(r), f = []; if (selfIntersects(o)) f.push('self-intersecting'); if (signedArea(o) <= 0) f.push('bad area'); return f; };
const areaKm2 = (r) => { const c = r[0]; let s = 0; for (let i = 0; i < r.length - 1; i++) { const a = enuAt(c, r[i]), b = enuAt(c, r[i + 1]); s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2e6; };
const enuAt = (c, p) => { const i = inverse(c[0], c[1], p[0], p[1]), a = ((i.az ?? i.a ?? i.azimuth) * Math.PI) / 180; return [i.s * Math.sin(a), i.s * Math.cos(a)]; };

const SRC = `AIP Viet Nam ENR 5.1, ${EDITION}`;
const prov = {
  VVR19: { id: 'VVR19', class: 'R', geometryConfidence: 'approximate', edition: EDITION, source: SRC,
    method: 'Geometry reconstructed from the AIP definition: 75 km arc about the Tan Son Nhat ARP (AD 2 VVTS), line 15 km north of R468 (TSH-SAPEN, ENR 3.1), line 15 km west of W1 segment AC-BU (BU read as BMT; W1 BMT-ENRIN-AC, ENR 3.1). The southern line (5 km south of Bien Hoa RWY 27L/09R) is read from the official chart ENR 5.1-13 because the runway coordinates are not published.',
    reasonApproximate: 'ENR 5.1 defines the boundary by reference to airways and a runway, not by coordinates; point BU is not listed in ENR 3.1 and the Bien Hoa runway coordinates are not in the eAIP.',
    anchors: { TSN_ARP: '104914N 1063939E', TSH: '104906N 1063902E', SAPEN: '110112N 1061100E', AC: '105621N 1071118E', BMT_as_BU: '123959N 1080723E', southLatitude: LAT_SOUTH },
    uncertaintyM: 2000, chartMaxVertexDeviationM: Math.round(vtxDev), chart: 'ENR 5.1-13 (graphics/9132)' },
  VVD43: { id: 'VVD43', class: 'D', geometryConfidence: 'derived', edition: EDITION, source: SRC, method: 'Published coordinate polygon with one vertex interpreted.',
    reasonApproximate: 'Published vertex 4 is malformed (a full degree from its neighbours); the text is identical in the 2025-01-23 to 2026-10-01 editions and chart ENR 5.1-11 reproduces it, so neither is independent evidence.',
    evidence: PUBLISHED.VVD43, uncertaintyM: 0 },
  VVD45: { id: 'VVD45', class: 'D', geometryConfidence: 'approximate', edition: EDITION, source: SRC, method: 'Published coordinate polygon with one vertex interpreted.',
    reasonApproximate: 'Published vertex 1 is malformed (a full degree of longitude from its neighbours); the longitude of the intended vertex cannot be confirmed, so 105 deg 20 min E is the single-digit correction. Same editions and chart as VVD43.',
    evidence: PUBLISHED.VVD45, uncertaintyM: 10000 },
};
const rings = { VVR19: vvr19, VVD43: fixedRing('VVD43'), VVD45: fixedRing('VVD45') };
for (const [id, r] of Object.entries(rings)) {
  const f = checks(r); if (f.length) throw new Error(`${id}: ${f.join(', ')}`);
  prov[id].areaKm2 = +areaKm2(r).toFixed(1); prov[id].vertices = r.length - 1;
}
const mk = (id) => feat(id, rings[id], { geometryConfidence: prov[id].geometryConfidence, reconstruction: prov[id].method, uncertaintyM: prov[id].uncertaintyM, note: 'Boundary approximated from official AIP chart' });
const layer = (ids) => JSON.stringify({ type: 'FeatureCollection', features: ids.map(mk) }) + '\n';
fs.writeFileSync(path.join(OUT, 'layers', 'approx-restricted.geojson'), layer(['VVR19']));
fs.writeFileSync(path.join(OUT, 'layers', 'approx-danger.geojson'), layer(['VVD43', 'VVD45']));
fs.writeFileSync(path.join(OUT, 'approx-provenance.json'), JSON.stringify({ note: 'Conservatively reconstructed ENR 5.1 areas; not exact AIP polygons.', areas: Object.values(prov) }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(prov).map(([k, v]) => [k, { conf: v.geometryConfidence, km2: v.areaKm2, n: v.vertices, chartDevM: v.chartMaxVertexDeviationM }]))));
