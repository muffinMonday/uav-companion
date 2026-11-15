// Fail-closed production data check. Never trusts git-ignored local data: it compares the tree to be published with the data published on gh-pages.
//   node scripts/preflight-data.js --restore [dir]   copy published regions this tree lacks (public/data by default); run before the build
//   node scripts/preflight-data.js [dir]             validate a tree (dist/data by default) and compare it with production; exit 1 blocks the deploy
// Options: --production <dir>  published data folder instead of the gh-pages branch;  --no-baseline  first publish only: skip the comparison.
// An existing region may disappear only if data/removed-regions.json lists it with reason, approvedBy and date (see docs/DEVELOPMENT.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectTree, compareToProduction, restoreMissing, readRemovals } from './lib/prod-data.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const restore = flag('--restore');
const skip = new Set([val('--production')]);
const target = path.resolve(ROOT, args.find((a) => !a.startsWith('--') && !skip.has(a)) ?? (restore ? 'public/data' : 'dist/data'));
const fail = (lines) => { console.error('Not deploying: production data preflight failed.\n  ' + lines.join('\n  ')); process.exit(1); };

function productionDir() {
  const given = val('--production');
  if (given) return path.resolve(given);
  const git = (a, o = {}) => spawnSync('git', a, { cwd: ROOT, ...o });
  const f = git(['fetch', '--quiet', 'origin', 'gh-pages'], { encoding: 'utf8' });
  if (f.status !== 0) fail([`cannot fetch origin/gh-pages (${(f.stderr || '').trim()}); use --production <dir> or, for a first publish, --no-baseline`]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uav-prod-'));
  const a = git(['archive', '--format=tar', 'FETCH_HEAD', 'data'], { maxBuffer: 1 << 30 });
  if (a.status !== 0) fail(['gh-pages has no data/ folder; use --no-baseline for a first publish']);
  const x = spawnSync('tar', ['-x', '-C', tmp], { input: a.stdout });
  if (x.status !== 0) fail(['cannot unpack the published data']);
  return path.join(tmp, 'data');
}

const removals = readRemovals(path.join(ROOT, 'data/removed-regions.json'));
if (flag('--no-baseline')) {
  const t = inspectTree(target); if (t.errors.length) fail(t.errors);
  console.log(`preflight: ${t.regions.size} regions valid (no production comparison)`); process.exit(0);
}
const prodDir = productionDir();
if (restore) {
  const restored = restoreMissing(target, prodDir, removals);
  console.log(restored.length ? `restored from production: ${restored.join(', ')}` : 'production restore: nothing missing');
  process.exit(0);
}
const cand = inspectTree(target), prod = inspectTree(prodDir);
if (prod.errors.length) fail(['the published data is itself inconsistent, repair it first:', ...prod.errors]);
const errors = [...cand.errors, ...compareToProduction(cand, prod, removals)];
if (errors.length) fail(errors);
console.log(`preflight ok: ${cand.regions.size} regions (production ${prod.regions.size}); ${[...prod.regions.keys()].filter((i) => !cand.regions.has(i)).length} removed by approval, ${[...cand.regions.keys()].filter((i) => !prod.regions.has(i)).length} added`);
