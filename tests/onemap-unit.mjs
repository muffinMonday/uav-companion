// OneMap theme parsing, and reading zones back out of PMTiles (overlaps, holes, outside). No browser needed.
import { ROOT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const { partsToPolygons, parseTheme } = await load('scripts/lib/onemap.js');
const { buildTiles } = await load('scripts/lib/tiles.js');
const { writePMTiles } = await load('scripts/lib/pmtiles-writer.js');
const { zonesInArchive } = await load('src/zones.js');

// ---------- parsing
const sq = (x, y, s) => `${y},${x}|${y},${x + s}|${y + s},${x + s}|${y + s},${x}`;
const one = partsToPolygons(sq(103, 1, 0.1));
ok(one.length === 1 && one[0].length === 1, 'one ring is one polygon without holes');
ok(one[0][0].length === 5 && one[0][0][0][0] === 103 && one[0][0][0][1] === 1, 'ring is closed and in [lon, lat] order');
const hole = partsToPolygons(`${sq(103, 1, 0.3)};${sq(103.1, 1.1, 0.1)}`);
ok(hole.length === 1 && hole[0].length === 2, 'a ring inside another is a hole');
const two = partsToPolygons(`${sq(103, 1, 0.1)};${sq(104, 1, 0.1)}`);
ok(two.length === 2, 'separate rings are separate polygons');
const t = parseTheme({ SrchResults: [{ Theme_Name: 'X', Owner: 'CAAS', DateTime: '2026-01-02' }, { NAME: 'A', DESCRIPTION: 'd', Type: 'Polygon', LatLng: sq(103, 1, 0.1) }] });
ok(t.meta.name === 'X' && t.meta.owner === 'CAAS' && t.features.length === 1 && t.features[0].name === 'A' && t.features[0].polygons.length === 1, 'theme meta and features are read');
let threw = false; try { parseTheme({}); } catch { threw = true; }
ok(threw, 'a response without SrchResults is rejected');

// ---------- reading zones back out of tiles
const poly = (ring, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: ring } });
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const features = [
  poly([box(103.80, 1.30, 103.90, 1.40), box(103.84, 1.34, 103.86, 1.36)], { c: 'a', n: 'Big with hole' }),
  poly([box(103.82, 1.32, 103.88, 1.38)], { c: 'b', n: 'Overlap' }),
];
const bounds = [103.79, 1.29, 103.91, 1.41];
const tiles = buildTiles(features, bounds);
const bytes = writePMTiles({ tiles, bounds, minZoom: 3, maxZoom: 14, metadata: {} });
const buf = new Uint8Array(bytes);
const arc = new PMTiles({ getKey: () => 'mem', getBytes: async (offset, length) => ({ data: buf.slice(offset, offset + length).buffer }) });
const at = async (lat, lon) => (await zonesInArchive(arc, 14, lat, lon)).map((z) => z.c).sort().join('');
ok(await at(1.31, 103.81) === 'a', 'inside one zone: that zone');
ok(await at(1.325, 103.825) === 'ab', 'inside two overlapping zones: both come back');
ok(await at(1.35, 103.85) === 'b', 'inside the hole of one zone: only the other');
ok(await at(1.35, 103.95) === '', 'outside every zone: none');
const props = (await zonesInArchive(arc, 14, 1.31, 103.81))[0];
ok(props.n === 'Big with hole', 'properties travel with the zone');

// ---------- strip-local
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
fs.mkdirSync(path.join(dist, 'data-local'));
fs.writeFileSync(path.join(dist, 'data-local', 'x.json'), '{}');
fs.mkdirSync(path.join(dist, 'data'));
fs.writeFileSync(path.join(dist, 'data', 'manifest.json'), '{"regions":[]}');
const run = (d) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/strip-local.js'), d], { encoding: 'utf8' });
ok(run(dist).status === 0 && !fs.existsSync(path.join(dist, 'data-local')), 'strip-local removes data-local and passes a clean tree');
fs.writeFileSync(path.join(dist, 'data', 'manifest.json'), '{"regions":[{"local": true}]}');
ok(run(dist).status === 1, 'strip-local refuses a tree whose manifest lists a local region');
fs.rmSync(dist, { recursive: true, force: true });
