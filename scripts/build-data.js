// data/regions/<country>/<region>/source.json  ->  public/data/<country>/<id>.<hash>.pmtiles + manifests
// public/data is generated, gitignored and published by `npm run deploy`.
// A region with "publish": false is built into public/data-local instead, which the deploy strips out: it works on this machine only.
//
// Usage: node --max-old-space-size=8192 scripts/build-data.js [regionId ...]   (no ids = rebuild everything)
//
// Output (for both trees; the local tree has no places):
//   <tree>/index.json                       countries
//   <tree>/<country>/manifest.json          regions of one country
//   <tree>/<country>/<id>.<hash>.pmtiles    zone tiles (hash in the name so updates are never served stale)
//   <tree>/<country>/<id>.boundary.<hash>.json   coverage polygon (optional)
//   <tree>/<country>/<id>.points.<hash>.json     point features, e.g. flying areas (optional)
//   public/data/places/<country>.json       offline search index
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readRegion } from './lib/readers.js';
import { buildTiles, MIN_Z, MAX_Z } from './lib/tiles.js';
import { writePMTiles } from './lib/pmtiles-writer.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGIONS = path.join(ROOT, 'data/regions');
const PLACES = path.join(ROOT, 'data/places');
const OUT_PUBLIC = path.join(ROOT, 'public/data');
const OUT_LOCAL = path.join(ROOT, 'public/data-local');
const SEMANTICS = new Set(['allow', 'restrict']);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v, pretty) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 2 : 0)); };
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

function validate(meta, dir) {
  const need = ['id', 'country', 'name', 'format', 'crs', 'semantics', 'source', 'license'];
  for (const k of need) if (meta[k] === undefined) throw new Error(`${dir}/source.json: missing "${k}"`);
  if (meta.layers === undefined && meta.file === undefined) throw new Error(`${dir}/source.json: needs "file" or "layers"`);
  if (!SEMANTICS.has(meta.semantics)) throw new Error(`${meta.id}: semantics must be one of ${[...SEMANTICS].join('|')}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.id) || !meta.id.startsWith(`${meta.country}-`)) throw new Error(`${meta.id}: id must be lowercase and start with "${meta.country}-"`);
  if (!meta.source.authority || !meta.source.effective) throw new Error(`${meta.id}: source.authority and source.effective are required`);
}

async function buildRegion(countryId, dirName, OUT) {
  const dir = path.join(REGIONS, countryId, dirName);
  const meta = readJson(path.join(dir, 'source.json'));
  validate(meta, dir);
  const id = meta.id;
  console.log(`[${id}] reading ${meta.file ?? `${meta.layers.length} layers`}...`);
  const { features, bounds, classes, points, effective } = await readRegion(dir, meta);
  console.log(`[${id}] ${features.length} polygons, bounds ${bounds.map((v) => v.toFixed(4)).join(', ')}`);
  const source = { ...meta.source, effective: meta.source.effective === 'auto' ? effective : meta.source.effective };
  const tiles = buildTiles(features, bounds, (m) => console.log(`[${id}]   ${m}`));
  const buf = writePMTiles({
    tiles, bounds, minZoom: MIN_Z, maxZoom: MAX_Z,
    metadata: { name: meta.name, attribution: `${source.authority}, effective ${source.effective}`, vector_layers: [{ id: 'zones', fields: classes ? { c: 'String', n: 'String', d: 'String' } : {} }] },
  });
  const file = `${countryId}/${id}.${hash(buf)}.pmtiles`;
  fs.mkdirSync(path.join(OUT, countryId), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(`[${id}] wrote ${file} (${(buf.length / 1e6).toFixed(1)} MB, ${tiles.length} tiles)`);

  let boundary = null;
  let coverageBounds = bounds;
  if (meta.boundary) {
    // Coverage polygon, always WGS84. Used only to tell "outside the zones" from "no data here".
    const text = fs.readFileSync(path.join(dir, meta.boundary));
    boundary = `${countryId}/${id}.boundary.${hash(text)}.json`;
    fs.writeFileSync(path.join(OUT, boundary), text);
    // The point check pre-filters on coverageBounds, so it must span the whole boundary, not just the zones.
    const g = JSON.parse(text);
    const walk = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(walk));
    const pts = walk((g.type === 'Feature' ? g.geometry : g).coordinates);
    coverageBounds = [
      Math.min(bounds[0], ...pts.map((p) => p[0])), Math.min(bounds[1], ...pts.map((p) => p[1])),
      Math.max(bounds[2], ...pts.map((p) => p[0])), Math.max(bounds[3], ...pts.map((p) => p[1])),
    ];
  }
  let pointsFile = null;
  if (points?.length) {
    const text = JSON.stringify(points);
    pointsFile = `${countryId}/${id}.points.${hash(text)}.json`;
    fs.writeFileSync(path.join(OUT, pointsFile), text);
  }
  return {
    id, country: countryId, name: meta.name, nameZh: meta.nameZh, file, boundary, bounds, coverageBounds,
    cells: features.length, minZoom: MIN_Z, maxZoom: MAX_Z,
    semantics: meta.semantics, maxHeightM: meta.maxHeightM ?? null,
    source, license: meta.license, crs: meta.crs, crsVerified: !!meta.crsVerified,
    ...(classes && { classes }), ...(pointsFile && { points: pointsFile }),
    ...(meta.officialMap && { officialMap: meta.officialMap }), ...(meta.coverageMarginM && { coverageMarginM: meta.coverageMarginM }),
    ...(meta.publish ? {} : { local: true }),
  };
}

function buildPlaces(countryId) {
  const file = path.join(PLACES, `${countryId}.txt`);
  if (!fs.existsSync(file)) return null;
  const KINDS = new Set(['city', 'county', 'landmark']);
  const places = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [zh, en, lat, lon, kind] = line.split('|').map((s) => s.trim());
    if (!zh || !en || !Number.isFinite(+lat) || !Number.isFinite(+lon) || !KINDS.has(kind)) {
      throw new Error(`${countryId}.txt line ${i + 1}: expected "local name|English name|lat|lon|city|county|landmark", got "${line}"`);
    }
    places.push([zh, en, +lat, +lon, kind]);
  });
  const text = JSON.stringify(places);
  const rel = `places/${countryId}.${hash(text)}.json`;
  fs.mkdirSync(path.join(OUT_PUBLIC, 'places'), { recursive: true });
  fs.writeFileSync(path.join(OUT_PUBLIC, rel), text);
  console.log(`[${countryId}] places: ${places.length}`);
  return rel;
}

const wanted = new Set(process.argv.slice(2));

/** Builds one tree: the public one (regions that publish) or the local one (regions with "publish": false). */
async function buildTree(OUT, local) {
  const index = { generated: new Date().toISOString(), countries: [] };
  for (const countryId of dirs(REGIONS)) {
    const cMetaPath = path.join(REGIONS, countryId, 'country.json');
    if (!fs.existsSync(cMetaPath)) { if (!local) console.log(`[${countryId}] no country.json, skipped`); continue; }
    const cMeta = readJson(cMetaPath);
    const manifestPath = path.join(OUT, countryId, 'manifest.json');
    const prev = fs.existsSync(manifestPath) ? readJson(manifestPath).regions : [];
    const byId = new Map(prev.map((r) => [r.id, r]));
    const present = new Set();

    for (const dirName of dirs(path.join(REGIONS, countryId))) {
      const sp = path.join(REGIONS, countryId, dirName, 'source.json');
      if (!fs.existsSync(sp)) continue;
      const meta = readJson(sp);
      if (!!meta.publish === local) { if (!local) { byId.delete(meta.id); console.log(`[${meta.id}] publish=false: built into public/data-local only (never deployed)`); } continue; }
      present.add(meta.id);
      const have = byId.get(meta.id);
      if ((wanted.size && !wanted.has(meta.id)) && have && fs.existsSync(path.join(OUT, have.file))) continue; // keep as built
      byId.set(meta.id, await buildRegion(countryId, dirName, OUT));
    }
    for (const id of byId.keys()) if (!present.has(id)) byId.delete(id); // region folder was removed

    const regions = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (local && !regions.length) continue; // nothing local for this country
    const entry = { id: countryId, name: cMeta.name, nameZh: cMeta.nameZh, view: cMeta.view ?? null, regions: regions.length, manifest: null, places: local ? null : buildPlaces(countryId) };
    if (regions.length) {
      writeJson(manifestPath, { country: { id: countryId, name: cMeta.name, nameZh: cMeta.nameZh }, generated: index.generated, regions }, true);
      entry.manifest = `${countryId}/manifest.json`;
      // drop files no manifest entry refers to (older hashes, removed regions)
      const keep = new Set(regions.flatMap((r) => [r.file, r.boundary, r.points].filter(Boolean)).map((f) => path.basename(f)));
      for (const f of fs.readdirSync(path.join(OUT, countryId))) if (f !== 'manifest.json' && !keep.has(f)) fs.unlinkSync(path.join(OUT, countryId, f));
    } else {
      console.log(`[${countryId}] no regions yet, listed without data`); // still appears in the country menu if it has a view
    }
    index.countries.push(entry);
  }

  if (!local) {
    // remove places files that no longer belong to any country entry
    if (fs.existsSync(path.join(OUT, 'places'))) {
      const keep = new Set(index.countries.map((c) => c.places && path.basename(c.places)).filter(Boolean));
      for (const f of fs.readdirSync(path.join(OUT, 'places'))) if (!keep.has(f)) fs.unlinkSync(path.join(OUT, 'places', f));
    }
  }
  // remove country folders that are gone
  for (const d of dirs(OUT)) if (d !== 'places' && !index.countries.some((c) => c.id === d)) fs.rmSync(path.join(OUT, d), { recursive: true });

  if (local && !index.countries.length) { fs.rmSync(OUT, { recursive: true, force: true }); return index; } // no local regions: no local tree
  writeJson(path.join(OUT, 'index.json'), index, true);
  return index;
}

const pub = await buildTree(OUT_PUBLIC, false);
const loc = await buildTree(OUT_LOCAL, true);
console.log(`index: ${pub.countries.length} country(ies) public${loc.countries.length ? `, ${loc.countries.length} local-only (public/data-local, never deployed)` : ''}`);
