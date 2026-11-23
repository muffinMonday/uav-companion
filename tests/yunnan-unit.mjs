// Yunnan (cn-yunnan): image-derived, positive-only suitable-flight data. Checks the source file, the built archive (every polygon present,
// gaps unknown), the provenance in the manifest and the warning in the point-check wording. Reads public/data; no browser needed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { zonesInArchive } = await import(url('src/zones.js'));
globalThis.document ??= { baseURI: 'http://localhost/' }; // config.js reads it at import
const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', cacheDir: path.join(ROOT, 'planning/.selected-runtime-vite-cache') });
const { zoneSummary } = await vite.ssrLoadModule('/src/pointcheck.js'); // import.meta.env needs Vite

const NOTICE = 'Yunnan data was extracted from a published image of the official provincial suitable-flight map rather than original GIS data. Boundaries are approximate and may contain extraction or positional inaccuracies. Check the current official map before flying.';
const dir = path.join(ROOT, 'data/regions/cn/yunnan');
const raw = fs.readFileSync(path.join(dir, 'zones.geojson'));
const gj = JSON.parse(raw);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/cn/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'cn-yunnan');

// Source file
ok(crypto.createHash('sha256').update(raw).digest('hex') === meta.source.contentSha256, 'zones.geojson matches the recorded SHA-256');
ok(gj.type === 'FeatureCollection' && gj.features.length === 14 && meta.source.extraction.vectorPolygons === 14, 'fourteen source polygons, as the extraction metadata records');
const polys = gj.features.map((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)).flat();
const rings = polys.flat();
ok(rings.every((r) => r.length >= 4 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]), 'every ring is closed');
ok(rings.flat().every(([x, y]) => x >= 97.5 && x <= 106.3 && y >= 21.1 && y <= 29.3), 'every coordinate is longitude/latitude inside the Yunnan extent');

// Archive
ok(!!region && region.cells === 14, 'the manifest registers cn-yunnan with 14 polygons');
const bytes = fs.readFileSync(path.join(ROOT, 'public/data', region.file));
const arc = new PMTiles({ getKey: () => region.file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const inPoly = (p, x, y) => inRing(p[0], x, y) && !p.slice(1).some((h) => inRing(h, x, y));
const inside = (x, y) => polys.some((p) => inPoly(p, x, y));
const segDist = ([ax, ay], [bx, by], x, y) => { const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0; return Math.hypot(ax + u * dx - x, ay + u * dy - y); };
const witness = (p) => { // a point well inside the polygon: the grid point of its bounding box that lies inside and farthest from its edges
  const xs = p[0].map((c) => c[0]), ys = p[0].map((c) => c[1]);
  let best = null, bestD = -1;
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * i / 40, y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * j / 40;
    if (!inPoly(p, x, y)) continue;
    const d = Math.min(...p.flatMap((r) => r.slice(1).map((q, k) => segDist(r[k], q, x, y))));
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best;
};
let lost = 0;
for (const [i, p] of polys.entries()) { const w = witness(p); if (!w || !(await zonesInArchive(arc, 14, w[1], w[0])).length) { lost++; console.log('  lost polygon ' + i); } }
ok(lost === 0, 'every one of the 14 source polygons is present in the archive at z14 (no silent geometry loss)');
let gap = null;
for (let x = 98; x < 106 && !gap; x += 0.37) for (let y = 21.5; y < 29 && !gap; y += 0.41) if (!inside(x, y) && !inside(x + .05, y) && !inside(x - .05, y) && !inside(x, y + .05) && !inside(x, y - .05)) gap = [x, y];
ok(!!gap && (await zonesInArchive(arc, 14, gap[1], gap[0])).length === 0, 'a point in Yunnan outside every polygon has no zone (unknown, not restricted)');
const big = polys.reduce((a, b) => (a[0].length > b[0].length ? a : b));
const hole = big.slice(1).map((h) => { const w = witness([h]); return w; }).find(Boolean);
ok(!hole || (await zonesInArchive(arc, 14, hole[1], hole[0])).length === 0, 'a point inside a hole of the large polygon has no zone');

// Provenance and classification
ok(region.semantics === 'allow' && region.coverageMode === 'positive-only' && region.sourceConfidence.mode === 'selected-source', 'positive-only allow semantics through the selected-source path');
ok(region.sourceConfidence.type === 'image-derived-approximate' && region.sourceConfidence.alignment === 'approximate-linear-extent', 'provenance says image-derived and approximate');
ok(region.sourceConfidence.notice === NOTICE, 'the manifest carries the owner-specified Yunnan warning');
const x = region.source.extraction;
ok(x && x.originalGis === false && x.approximate === true && x.correctedFlyablePixels === 291336 && x.metadataSha256 && x.caveats.length === 4, 'the original extraction metadata is preserved');
ok(!/government|official GIS/i.test(region.source.authority.replace('official provincial', '')) || /not original GIS/.test(region.source.authority), 'the source authority does not claim original GIS data');
ok(!region.boundary && region.maxHeightM === null, 'no coverage boundary: outside the polygons nothing is claimed');

// Wording
const inside1 = zoneSummary({ status: 'inside', region, zones: [{}] });
ok(inside1.cls === 'ok' && inside1.detail.includes(NOTICE) && /unverified/.test(inside1.detail), 'a Yunnan point-check result shows the warning and keeps the unverified wording');
const other = { ...region, id: 'cn-other', name: 'Other', sourceConfidence: { ...region.sourceConfidence, notice: undefined } };
ok(!zoneSummary({ status: 'inside', region: other, zones: [{}] }).detail.includes('extracted from a published image'), 'a region without a notice shows none');
await vite.close();
