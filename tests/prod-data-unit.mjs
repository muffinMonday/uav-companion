// Production data preflight (scripts/lib/prod-data.js, scripts/preflight-data.js): stale checkouts, removals, hashes, restore. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';
import { inspectTree, compareToProduction, restoreMissing, readRemovals } from '../scripts/lib/prod-data.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
const sha8 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

// Writes a tree: spec = { cn: ['cn-a', 'cn-b'], sg: ['sg-x'] }
function tree(name, spec, { stamp = '2026-09-22' } = {}) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, { recursive: true });
  const countries = [];
  for (const [cid, ids] of Object.entries(spec)) {
    fs.mkdirSync(path.join(dir, cid), { recursive: true });
    const regions = ids.map((id) => {
      const body = 'tiles-' + id; const file = `${cid}/${id}.${sha8(body)}.pmtiles`;
      fs.writeFileSync(path.join(dir, file), body);
      return { id, country: cid, name: id, file, boundary: null, cells: 1, source: { snapshotAt: stamp } };
    });
    fs.writeFileSync(path.join(dir, cid, 'manifest.json'), JSON.stringify({ country: { id: cid }, regions }));
    countries.push({ id: cid, regions: regions.length, manifest: `${cid}/manifest.json`, places: null });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ countries }));
  return dir;
}
const six = ['cn-chongqing', 'cn-guangdong', 'cn-hubei', 'cn-hunan', 'cn-jilin', 'cn-ningxia'];
const prodDir = tree('prod', { cn: six, sg: ['sg-nofly'] });
const prod = inspectTree(prodDir);
ok(prod.errors.length === 0 && prod.regions.size === 7, 'a complete tree validates (7 regions, all hashes match)');

// Stale checkout: only Hubei. The deploy would drop five regions.
const staleDir = tree('stale', { cn: ['cn-hubei'], sg: ['sg-nofly'] });
const stale = inspectTree(staleDir);
const errs = compareToProduction(stale, prod);
ok(errs.length === 5 && six.filter((i) => i !== 'cn-hubei').every((i) => errs.some((e) => e.startsWith(i))), 'stale checkout: all five missing regions are reported');
ok(compareToProduction(prod, prod).length === 0, 'identical tree passes');

// Intentional removal needs a complete reviewed entry
const rem = path.join(tmp, 'removed.json');
fs.writeFileSync(rem, JSON.stringify({ removed: six.filter((i) => i !== 'cn-hubei').map((id) => ({ id, reason: 'withdrawn', approvedBy: 'owner', date: '2026-11-15' })) }));
ok(compareToProduction(stale, prod, readRemovals(rem)).length === 0, 'listed removals are allowed');
fs.writeFileSync(rem, JSON.stringify({ removed: [{ id: 'cn-jilin', reason: 'x' }] }));
ok(readRemovals(rem).size === 0, 'a removal without approvedBy/date is ignored');
ok(compareToProduction(stale, prod, new Map([['cn-gone', { id: 'cn-gone' }]])).some((e) => e.startsWith('cn-gone')), 'a removal entry for a region that is not published is flagged');

// Additions are never blocked
const grown = tree('grown', { cn: [...six, 'cn-sichuan'], sg: ['sg-nofly'] });
ok(compareToProduction(inspectTree(grown), prod).length === 0, 'a new region is accepted');

// A scoped live replacement must be present; the approval cannot waive other loss.
const cityProd = inspectTree(tree('city-prod', { cn: [...six, 'cn-chengdu'], sg: ['sg-nofly'] }));
const replacementApproval = new Map([['cn-chengdu', { replacementId: 'cn-sichuan' }]]);
ok(compareToProduction(inspectTree(grown), cityProd, replacementApproval).length === 0, 'approved Chengdu to Sichuan replacement passes');
ok(compareToProduction(prod, cityProd, replacementApproval).some(e => /replacement cn-sichuan is missing/.test(e)), 'removing Chengdu without its Sichuan replacement fails');
const unrelatedLoss = inspectTree(grown); unrelatedLoss.regions.delete('cn-jilin');
ok(compareToProduction(unrelatedLoss, cityProd, replacementApproval).some(e => e.startsWith('cn-jilin:')), 'replacement approval does not allow unrelated Jilin loss');

// Hash and reference integrity
const bad = tree('bad', { cn: six, sg: ['sg-nofly'] });
fs.writeFileSync(path.join(bad, prod.regions.get('cn-jilin').region.file), 'tampered');
fs.unlinkSync(path.join(bad, prod.regions.get('cn-hunan').region.file));
const be = inspectTree(bad).errors;
ok(be.some((e) => /cn-jilin.*does not match/.test(e)) && be.some((e) => /cn-hunan.*missing/.test(e)), 'tampered and missing tile files are reported');
const cnt = tree('cnt', { cn: six });
const ix = JSON.parse(fs.readFileSync(path.join(cnt, 'index.json'))); ix.countries[0].regions = 1; fs.writeFileSync(path.join(cnt, 'index.json'), JSON.stringify(ix));
ok(inspectTree(cnt).errors.some((e) => /index says 1 regions, manifest has 6/.test(e)), 'index/manifest count mismatch is reported');
ok(inspectTree(path.join(tmp, 'nothing')).errors.length === 1, 'a missing tree is an error');

// A rebuilt region from an older source snapshot is a stale build
const newer = inspectTree(tree('newer', { cn: ['cn-hubei'] }));
const olderI = inspectTree(tree('old', { cn: ['cn-hubei'] }, { stamp: '2026-01-01' }));
olderI.regions.get('cn-hubei').region.file = 'cn/other.pmtiles';
ok(compareToProduction(olderI, newer).some((e) => /older than the published/.test(e)), 'same region with an older source snapshot is reported as stale');

// Restore from a stale checkout: valid afterwards, Hubei and Singapore untouched
const hubeiFile = path.join(staleDir, stale.regions.get('cn-hubei').region.file);
const hubeiBefore = fs.readFileSync(hubeiFile, 'utf8');
const restored = restoreMissing(staleDir, prodDir);
const after = inspectTree(staleDir);
ok(restored.length === 5 && after.errors.length === 0 && after.regions.size === 7 && compareToProduction(after, prod).length === 0, 'restore brings back the five regions; tree valid; no loss against production');
ok(JSON.parse(fs.readFileSync(path.join(staleDir, 'index.json'))).countries.find((c) => c.id === 'cn').regions === 6, 'index count updated');
ok(fs.readFileSync(hubeiFile, 'utf8') === hubeiBefore && after.regions.has('sg-nofly'), 'existing Hubei and Singapore left as they were');
const s2 = tree('stale2', { cn: ['cn-hubei', 'cn-new'] });
const r2 = restoreMissing(s2, prodDir, new Map([['cn-jilin', { id: 'cn-jilin' }]]));
const a2 = inspectTree(s2);
ok(!r2.includes('cn-jilin') && a2.regions.has('cn-new') && a2.regions.has('cn-ningxia') && a2.errors.length === 0, 'restore skips approved removals and keeps new local regions');
ok(restoreMissing(staleDir, prodDir).length === 0, 'restore is idempotent');

// CLI: a stale candidate is blocked, a restored one passes
// Isolate fixture removals from the repository's reviewed production approvals.
const cliRoot = path.join(tmp, 'cli-root');
fs.mkdirSync(path.join(cliRoot, 'scripts/lib'), { recursive: true });
fs.mkdirSync(path.join(cliRoot, 'data'));
fs.writeFileSync(path.join(cliRoot, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(cliRoot, 'data/removed-regions.json'), '{"removed":[]}');
for (const file of ['scripts/preflight-data.js', 'scripts/lib/prod-data.js']) fs.copyFileSync(path.join(ROOT, file), path.join(cliRoot, file));
const cli = (a) => spawnSync(process.execPath, [path.join(cliRoot, 'scripts/preflight-data.js'), ...a], { encoding: 'utf8' });
const s3 = tree('stale3', { cn: ['cn-hubei'], sg: ['sg-nofly'] });
const blocked = cli([s3, '--production', prodDir]);
ok(blocked.status === 1 && /Not deploying/.test(blocked.stderr) && /cn-jilin/.test(blocked.stderr), 'CLI blocks a stale candidate (exit 1)');
cli(['--restore', s3, '--production', prodDir]);
ok(cli([s3, '--production', prodDir]).status === 0, 'CLI passes after --restore');
ok(cli([path.join(tmp, 'nothing'), '--production', prodDir]).status === 1, 'CLI fails closed on a missing candidate');
ok(cli([s3, '--production', path.join(tmp, 'nothing')]).status === 1, 'CLI fails closed when production data cannot be read');

// The six China registrations in git: Hubei official, the other five KDji third-party snapshots
const reg = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions/cn', r, 'source.json'), 'utf8'));
const kd = ['jilin', 'hunan', 'ningxia', 'guangdong', 'chongqing'];
ok(/Hubei Development and Reform Commission/.test(reg('hubei').source?.authority ?? reg('hubei').authority ?? JSON.stringify(reg('hubei'))), 'Hubei is registered with its official source');
ok(kd.every((r) => /KDji third-party UOM reference mirror/.test(JSON.stringify(reg(r))) && !/Development and Reform/.test(JSON.stringify(reg(r)))), 'Jilin, Hunan, Ningxia, Guangdong and Chongqing are registered as KDji reference snapshots');

// Wiring: deploy restores first and checks right before publishing
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.deploy;
ok(/preflight-data\.js --restore.*vite build.*strip-local\.js.*preflight-data\.js.*gh-pages/.test(dep), 'npm run deploy restores, builds, strips, preflights, then publishes');
fs.rmSync(tmp, { recursive: true, force: true });
