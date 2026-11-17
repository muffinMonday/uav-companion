// Rewrites the REGION_LABELS map and the region-labels test expectation from the built public/data manifests (label = manifest name).
import fs from 'node:fs';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const idx = read('public/data/index.json');
const regions = idx.countries.filter((c) => c.manifest).flatMap((c) => read('public/data/' + c.manifest).regions).sort((a, b) => a.id.localeCompare(b.id));
const f = 'src/app/region-labels.js';
let s = fs.readFileSync(f, 'utf8');
s = s.replace(/export const REGION_LABELS = \{[\s\S]*?\n\};/, 'export const REGION_LABELS = {\n' + regions.map((r) => `  '${r.id}': '${r.name}',`).join('\n') + '\n};');
fs.writeFileSync(f, s);
const t = 'tests/region-labels-unit.mjs';
const names = regions.map((r) => r.name).sort((a, b) => a.localeCompare(b));
fs.writeFileSync(t, fs.readFileSync(t, 'utf8').replace(/const EXPECTED = \[.*\];/, 'const EXPECTED = [' + names.map((n) => `'${n}'`).join(', ') + '];'));
console.log(regions.length + ' labels');
