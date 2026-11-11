// Source readers. Each returns an async iterable of GeoJSON geometries (Polygon / MultiPolygon, any CRS).
// Add a reader here for each new source format, then reference it from source.json ("format").
import fs from 'node:fs';
import path from 'node:path';
import * as shapefile from 'shapefile';
import { CONVERT } from './crs.js';
import { parseTheme } from './onemap.js';

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

/**
 * A region made of several classed layers (format "onemap-themes"): each layer is a OneMap theme file, and becomes one class of zones.
 * Polygon features carry their class (c), name (n) and, when a layer's rule text differs between its zones, the text (d).
 * Point layers (flying areas) are returned as points, not tiles. Returns { features, bounds, classes, points, effective }.
 */
function readLayers(dir, meta) {
  const features = [], points = [], classes = [];
  let minX = 180, minY = 90, maxX = -180, maxY = -90, effective = '';
  for (const layer of meta.layers) {
    const { meta: m, features: items } = parseTheme(JSON.parse(fs.readFileSync(path.join(dir, layer.file), 'utf8')));
    if (m.updated > effective) effective = m.updated;
    const texts = new Set(items.map((x) => x.description));
    const perZoneText = !layer.points && texts.size > 1; // e.g. restricted areas, each with its own height limit
    classes.push({
      id: layer.id, label: layer.label, color: layer.color, severity: layer.severity ?? 9, points: !!layer.points, summary: layer.summary ?? '',
      owner: m.owner, updated: m.updated, published: m.published, count: items.length,
      ...(!perZoneText && texts.size === 1 && { description: [...texts][0] }),
    });
    for (const x of items) {
      if (layer.points) { if (x.point) points.push({ class: layer.id, name: x.name, lat: x.point[1], lon: x.point[0], note: x.description, link: x.link || '' }); continue; }
      if (!x.polygons) continue;
      for (const poly of x.polygons) for (const [px, py] of poly[0]) {
        if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      const props = { c: layer.id, n: x.name.slice(0, 80), ...(perZoneText && { d: x.description }) };
      features.push({ type: 'Feature', properties: props, geometry: x.polygons.length === 1 ? { type: 'Polygon', coordinates: x.polygons[0] } : { type: 'MultiPolygon', coordinates: x.polygons } });
    }
  }
  if (!features.length) throw new Error(`${meta.id}: no polygons found in its layers`);
  return { features, bounds: [minX, minY, maxX, maxY], classes, points, effective };
}

/** Reads a region's zone polygons, converts to WGS84, and returns features plus bounds [minX,minY,maxX,maxY] (and classes, points for layered regions). */
export async function readRegion(dir, meta) {
  if (meta.layers) return readLayers(dir, meta);
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
