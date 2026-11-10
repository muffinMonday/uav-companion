// Source readers. Each returns an async iterable of GeoJSON geometries (Polygon / MultiPolygon, any CRS).
// Add a reader here for each new source format, then reference it from source.json ("format").
import fs from 'node:fs';
import path from 'node:path';
import * as shapefile from 'shapefile';
import { CONVERT } from './crs.js';

async function* shapefileGeoms(file) {
  const src = await shapefile.open(file);
  for (;;) {
    const r = await src.read();
    if (r.done) return;
    if (r.value.geometry) yield r.value.geometry;
  }
}

async function* geojsonGeoms(file) {
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj }];
  for (const f of feats) if (f.geometry) yield f.geometry;
}

const READERS = { shapefile: shapefileGeoms, geojson: geojsonGeoms };

/** Reads a region's zone polygons, converts to WGS84, and returns features plus bounds [minX,minY,maxX,maxY]. */
export async function readRegion(dir, meta) {
  const reader = READERS[meta.format];
  if (!reader) throw new Error(`${meta.id}: unsupported format "${meta.format}" (use ${Object.keys(READERS).join('|')})`);
  if (!(meta.crs in CONVERT)) throw new Error(`${meta.id}: unsupported crs "${meta.crs}" (use ${Object.keys(CONVERT).join('|')})`);
  const conv = CONVERT[meta.crs];

  const features = [];
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for await (const g of reader(path.join(dir, meta.file))) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!polys) continue;
    const out = polys.map((p) => p.map((ring) => ring.map(([x, y]) => (conv ? conv(x, y) : [x, y]))));
    for (const p of out) for (const [x, y] of p[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Attributes are dropped on purpose: for now a region's geometry is the data (every cell means the same thing).
    features.push({
      type: 'Feature', properties: {},
      geometry: out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out },
    });
  }
  if (!features.length) throw new Error(`${meta.id}: no polygons found in ${meta.file}`);
  return { features, bounds: [minX, minY, maxX, maxY] };
}
