// Fly in choices (src/app/region-labels.js): every region archive in the published data has a display label, no label is stale,
// and the labels are the names the dashboard lists. Reads public/data only; no browser needed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
const { REGION_LABELS, regionLabel } = await import(pathToFileURL(path.join(ROOT, 'src/app/region-labels.js')).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// The expectation: adding or removing a region archive changes this list on purpose, in the same change (ARCHITECTURE.md, "Fly In regions").
const EXPECTED = ['Chongqing', 'Guangdong', 'Hubei', 'Hunan', 'Jilin', 'Ningxia', 'Sichuan', 'Singapore', 'Yunnan'];

const data = path.join(ROOT, 'public/data');
const index = JSON.parse(fs.readFileSync(path.join(data, 'index.json'), 'utf8'));
const regions = index.countries.filter((c) => c.manifest)
  .flatMap((c) => JSON.parse(fs.readFileSync(path.join(data, c.manifest), 'utf8')).regions);
const ids = regions.map((r) => r.id);

const missing = ids.filter((id) => !(id in REGION_LABELS));
ok(missing.length === 0, 'every region archive in the data has a Fly in label' + (missing.length ? ': missing ' + missing.join(', ') : ''));
const stale = Object.keys(REGION_LABELS).filter((id) => !ids.includes(id));
ok(stale.length === 0, 'no Fly in label is left for a region that is no longer in the data' + (stale.length ? ': ' + stale.join(', ') : ''));
const labels = regions.map(regionLabel).sort((a, b) => a.localeCompare(b));
ok(JSON.stringify(labels) === JSON.stringify(EXPECTED), 'the Fly in choices are exactly: ' + labels.join(', '));
ok(!labels.includes('China'), 'there is no country-wide "China" Fly in choice');
ok(regions.every((r) => Array.isArray(r.bounds) && r.bounds.length === 4), 'every region has bounds to fly to');
