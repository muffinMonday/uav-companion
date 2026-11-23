// Fetches the physical features that ENR 5.1 area descriptions refer to (coastline, Malaysia/Thailand border) from OpenStreetMap through the Overpass API
// and writes a trimmed, simplified extract to data/regions/my/my-enr51/approx-sources/osm-extract.json.
// OpenStreetMap supplies ONLY the shape of those physical features. CAAM remains the source of identity, class, anchor coordinates, boundary semantics and limits.
// Usage: node scripts/airspace/my-enr51-osm.mjs [--raw-dir <dir of previously saved Overpass responses named <key>.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'my', 'my-enr51', 'approx-sources');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const RAW = arg('--raw-dir', null);
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// key: [bbox s,w,n,e, Overpass way filter, what it is used for]
const QUERIES = {
  coast_melaka: [[1.8, 102.1, 2.4, 102.9], 'way["natural"="coastline"]', 'WMR239A, WMR239B, WMR240B'],
  coast_johor: [[1.1, 102.3, 1.9, 103.9], 'way["natural"="coastline"]', 'WMR240A, WMR240B, WMP228'],
  coast_lumut: [[3.3, 99.8, 4.6, 100.9], 'way["natural"="coastline"]', 'WMR416A, WMR416B, WMR416C, WMR419'],
  coast_sabah: [[5.8, 115.9, 6.7, 116.9], 'way["natural"="coastline"]', 'WBR524'],
  border_th: [[5.4, 100.0, 6.9, 102.1], 'way["boundary"="administrative"]["admin_level"="2"]', 'WMR407, WMD419'],
};

async function overpass(key) {
  const [bb, filt] = QUERIES[key];
  if (RAW && fs.existsSync(path.join(RAW, key + '.json'))) return JSON.parse(fs.readFileSync(path.join(RAW, key + '.json'), 'utf8'));
  const body = new URLSearchParams({ data: `[out:json][timeout:80];${filt}(${bb.join(',')});out geom;` });
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const res = await fetch(ep, { method: 'POST', body, headers: { 'User-Agent': 'region-data-build/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(100000) });
        const text = await res.text();
        if (res.ok && text.startsWith('{')) return JSON.parse(text);
      } catch { /* try the next endpoint */ }
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw new Error('Overpass unavailable for ' + key);
}

/** Douglas-Peucker in local metres. */
function simplify(pts, tolM) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180), m = 111320;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bi = -1;
    const ax = pts[a][0] * k * m, ay = pts[a][1] * m, bx = pts[b][0] * k * m, by = pts[b][1] * m, dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k * m - ax, py = pts[i][1] * m - ay, t = l ? Math.max(0, Math.min(1, (px * dx + py * dy) / l)) : 0, d = Math.hypot(px - t * dx, py - t * dy);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tolM) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Joins ways that share end vertices into the longest possible polylines. */
function merge(ways) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const lines = ways.map((w) => w.slice());
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const a = lines[i], b = lines[j];
      if (key(a.at(-1)) === key(b[0])) { lines[i] = a.concat(b.slice(1)); lines.splice(j, 1); changed = true; break outer; }
      if (key(a.at(-1)) === key(b.at(-1))) { lines[i] = a.concat(b.slice(0, -1).reverse()); lines.splice(j, 1); changed = true; break outer; }
    }
  }
  return lines;
}

const out = { source: 'OpenStreetMap contributors (Overpass API)', licence: 'ODbL 1.0, https://www.openstreetmap.org/copyright', note: 'Shape of physical features only (coastline, Malaysia/Thailand border); simplified to 3 m. CAAM ENR 5.1 remains the source of every airspace attribute.', extractedAt: new Date().toISOString(), features: {} };
for (const key of Object.keys(QUERIES)) {
  const json = await overpass(key);
  const ways = json.elements.filter((e) => e.type === 'way' && e.geometry).map((e) => e.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]));
  let lines = merge(ways).map((l) => simplify(l, 3).map((p) => p));
  // The Thailand border query also returns other international boundaries; keep only polylines that come within the bbox.
  const [s, w, n, e] = QUERIES[key][0];
  const M = 0.05, inb = ([x, y]) => x >= w - M && x <= e + M && y >= s - M && y <= n + M, pieces = []; // keep the parts inside the bbox (plus a margin), split where a polyline leaves it
  for (const l of lines) { let cur = []; for (const p of l) { if (inb(p)) cur.push(p); else { if (cur.length > 1) pieces.push(cur); cur = []; } } if (cur.length > 1) pieces.push(cur); }
  lines = pieces;
  out.features[key] = { bbox: QUERIES[key][0], usedFor: QUERIES[key][2], osmWays: ways.length, lines };
  console.log(key, 'ways', ways.length, 'polylines', lines.length, 'vertices', lines.reduce((a, l) => a + l.length, 0));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'osm-extract.json'), JSON.stringify(out) + '\n');
