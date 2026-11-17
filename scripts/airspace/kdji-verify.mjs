// Verifies built KDji express regions against their source: manifest count, every feature interior present in the z14 tiles,
// and tile-vs-source agreement on random points (covers holes, gaps and outside). Usage: node scripts/airspace/kdji-verify.mjs <province...>
import fs from 'node:fs';
import path from 'node:path';
import { pointSmoke } from './smoke.mjs';
import { inGeometry } from '../china-airspace/geometry.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'public/data');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'cn/manifest.json'), 'utf8'));
let bad = 0;
for (const p of process.argv.slice(2)) {
  const region = manifest.regions.find((r) => r.id === 'cn-' + p);
  const out = path.join(ROOT, 'planning/express-nationwide', p);
  try {
    if (!region) throw new Error('not in manifest');
    const zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions/cn', p, 'zones.geojson'), 'utf8'));
    const geos = JSON.parse(fs.readFileSync(path.join(out, 'geos.json'), 'utf8'));
    if (region.cells !== zones.features.length) throw new Error(`manifest cells ${region.cells} != source ${zones.features.length}`);
    if (geos.interiorWitnesses.length !== zones.features.length) throw new Error('witness count mismatch');
    const file = path.join(DATA, region.file);
    const presence = await pointSmoke(file, zones, geos.interiorWitnesses);
    const [w, s, e, n] = region.bounds, checks = [];
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const lon = w + rnd() * (e - w), lat = s + rnd() * (n - s);
      checks.push({ lon, lat, inside: zones.features.some((f) => inGeometry([lon, lat], f.geometry) >= 0) });
    }
    // add points near each polygon's first vertex (boundary-adjacent outside/inside mix) for up to 200 features
    const random = await pointSmoke(file, zones, checks);
    console.log(JSON.stringify({ province: p, features: zones.features.length, interiorsPresent: presence.points, randomPoints: random.points, insideRandom: checks.filter((c) => c.inside).length, tiles: presence.tiles, ok: true }));
  } catch (err) { bad++; console.log(JSON.stringify({ province: p, ok: false, error: String(err.message).slice(0, 300) })); }
}
process.exit(bad ? 1 : 0);
