// Checks a built region's .pmtiles against its source shapefile.
// Usage: node scripts/verify-data.js <regionId> [samples]      e.g. cn-hubei
// For random points, compares "inside a cell?" answered from the tiles with a brute-force answer from the shapefile.
// Only for rectangular-cell shapefile sources: the brute-force side uses each cell's bounding box.
import fs from 'node:fs';
import path from 'node:path';
import * as shapefile from 'shapefile';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';

const ROOT = path.resolve(import.meta.dirname, '..');
const id = process.argv[2] || 'cn-hubei';
const N = +(process.argv[3] || 20000);
const [country, ...rest] = id.split('-');
const dir = path.join(ROOT, 'data/regions', country, rest.join('-'));
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
if (meta.format !== 'shapefile') { console.error(`${id}: verify-data only supports shapefile sources`); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', country, 'manifest.json'), 'utf8'));
const file = path.join(ROOT, 'public/data', manifest.regions.find((r) => r.id === id).file);

class FileSource {
  constructor(p) { this.fd = fs.openSync(p, 'r'); }
  getKey() { return 'file'; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}
const pm = new PMTiles(new FileSource(file));
const header = await pm.getHeader();
console.log(`header: z${header.minZoom}-${header.maxZoom}, ${header.numAddressedTiles} tiles, tileType ${header.tileType}`);

// --- source cells (axis-aligned rectangles are assumed and checked) ---
const src = await shapefile.open(path.join(dir, meta.file));
const cells = [];
let nonRect = 0;
for (;;) {
  const r = await src.read();
  if (r.done) break;
  const ring = r.value.geometry.coordinates[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (ring.length !== 5 || !ring.every(([x, y]) => (x === x0 || x === x1) && (y === y0 || y === y1))) nonRect++;
  cells.push([x0, y0, x1, y1]);
}
console.log(`source: ${cells.length} cells, ${nonRect} not axis-aligned rectangles`);
const B = 0.01, bucket = new Map();
const key = (i, j) => i * 100000 + j;
cells.forEach((c, n) => {
  for (let i = Math.floor(c[0] / B); i <= Math.floor(c[2] / B); i++)
    for (let j = Math.floor(c[1] / B); j <= Math.floor(c[3] / B); j++) {
      const k = key(i, j); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(n);
    }
});
const brute = (lon, lat) => (bucket.get(key(Math.floor(lon / B), Math.floor(lat / B))) || []).some((n) => {
  const c = cells[n]; return lon >= c[0] && lon <= c[2] && lat >= c[1] && lat <= c[3];
});

// --- point query against the tiles at a given zoom ---
function pip(rings, px, py) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
async function viaTiles(lon, lat, z) {
  const n = 2 ** z, fx = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180), fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const t = await pm.getZxy(z, x, y);
  if (!t) return false;
  const layer = new VectorTile(new Pbf(await gunzip(t.data))).layers.zones;
  if (!layer) return false;
  const px = (fx - x) * layer.extent, py = (fy - y) * layer.extent;
  for (let i = 0; i < layer.length; i++) if (pip(layer.feature(i).loadGeometry(), px, py)) return true;
  return false;
}
import zlib from 'node:zlib';
const gunzip = async (ab) => { const b = Buffer.from(ab); return b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b; };

const bb = [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1])), Math.max(...cells.map((c) => c[2])), Math.max(...cells.map((c) => c[3]))];
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (const z of [14, 10]) {
  let inside = 0, bad = 0, tests = 0;
  const examples = [];
  for (let i = 0; i < N; i++) {
    // half the samples at cell centres (should be inside), half uniform over the bbox
    let lon, lat;
    if (i % 2) { const c = cells[Math.floor(rnd() * cells.length)]; lon = (c[0] + c[2]) / 2; lat = (c[1] + c[3]) / 2; }
    else { lon = bb[0] + rnd() * (bb[2] - bb[0]); lat = bb[1] + rnd() * (bb[3] - bb[1]); }
    const want = brute(lon, lat), got = await viaTiles(lon, lat, z);
    tests++; if (want) inside++;
    if (want !== got) { bad++; if (examples.length < 5) examples.push({ lon, lat, want, got }); }
  }
  console.log(`z${z}: ${tests} points (${inside} inside), mismatches: ${bad}`, examples.length ? examples : '');
}
