// node --test tests/airspace-integration.test.mjs (GEOS + installed Edge/Chrome required)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspect, integrate, normalizeWinding, approvalEvidence } from '../scripts/airspace/integrate.mjs';
import { sha256, stringify } from '../scripts/china-airspace/core.js';
import { readRegion } from '../scripts/lib/readers.js';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.join(root, 'tests/fixtures/airspace');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2));
fs.mkdirSync(path.join(root, 'planning'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(root, 'planning/integration-tests-'));
test.after(() => {
  assert.ok(tmp.startsWith(path.join(root, 'planning/integration-tests-')));
  fs.rmSync(tmp, { recursive: true, force: true });
});
let serial = 0;
function setup() {
  const dir = path.join(tmp, `case-${serial++}`);
  fs.cpSync(fixture, dir, { recursive: true });
  return { dir, config: path.join(dir, 'config.json') };
}
function change(config, mutate) { const c = read(config); mutate(c); write(config, c); }
function geometry(config, mutate) {
  const c = read(config), p = path.join(path.dirname(config), c.input), gj = read(p);
  mutate(gj); write(p, gj);
  change(config, c => { c.expected = { features: gj.features.length, contentSha256: sha256(stringify(gj)) }; });
}
async function approve(config) {
  change(config, c => { c.synthetic = false; });
  const ctx = await inspect(config);
  const p = path.join(path.dirname(config), 'approval.json'), approval = read(p);
  approval.subjectSha256 = ctx.subjectSha256;
  write(p, approval);
}
const snapshot = () => ['data/regions/cn/hubei/source.json', 'data/regions/cn/hubei/boundary.geojson', 'src/map.js', 'scripts/strip-local.js'].map(p => sha256(fs.readFileSync(path.join(root, p))));

test('dry run validates complete synthetic geometry without writing or changing Hubei/UI', async () => {
  const before = snapshot();
  const output = path.join(tmp, 'dry-run');
  const result = await integrate('build', [path.join(fixture, 'config.json')], { dryRun: true, out: output });
  assert.equal(result[0].features, 2);
  const approval = read(path.join(fixture, 'approval.json'));
  assert.equal(result[0].subjectSha256, approval.subjectSha256);
  for (const gate of Object.values(approval.gates)) assert.equal(sha256(fs.readFileSync(path.join(fixture, gate.evidence))), gate.sha256);
  assert.equal(result[0].active, false);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(snapshot(), before);
  const meta = read(path.join(root, 'data/regions/cn/hubei/source.json'));
  assert.equal(meta.publish, true); assert.equal(meta.crsVerified, false);
});

test('subsets, same-count modifications and truncation are rejected', async () => {
  for (const mutate of [gj => gj.features.pop(), gj => { gj.features[0].properties.changed = true; }]) {
    const { config, dir } = setup(); mutateFile(dir, mutate);
    await assert.rejects(inspect(config), /hash\/count mismatch/);
  }
  for (const flags of [{ truncated: true }, { hasMore: true }, { numberMatched: 3 }, { nextPage: 'token' }]) {
    const { config } = setup(); geometry(config, gj => Object.assign(gj, flags));
    await assert.rejects(inspect(config), /pagination-or-truncation/);
  }
  function mutateFile(dir, mutate) { const p = path.join(dir, 'zones.geojson'), gj = read(p); mutate(gj); write(p, gj); }
});

test('invalid geometry, duplicate overlap, CRS conflict and unsupported records fail closed', async () => {
  for (const mutate of [
    gj => { gj.coordinateSystem = 'GCJ-02'; },
    gj => { gj.features[0].geometry = null; },
    gj => { gj.features[0].geometry = { type: 'Point', coordinates: [103, 1] }; },
    gj => { gj.features[0].geometry.coordinates[0][0] = [103, 88]; },
    gj => { gj.features[0].geometry.coordinates[0].pop(); },
    gj => { gj.features.push(structuredClone(gj.features[0])); },
    gj => { gj.features[0].geometry.coordinates = [[[103,1],[103.1,1.1],[103,1.1],[103.1,1],[103,1]]]; },
  ]) {
    const { config } = setup(); geometry(config, mutate);
    await assert.rejects(inspect(config));
  }
});

test('normalization preserves MultiPolygon type, properties, holes and exact point contacts; policy still blocks build', async () => {
  const { config, dir } = setup();
  geometry(config, gj => { gj.features = [{ type: 'Feature', id: 'contact', properties: { unchanged: true }, geometry: {
    type: 'MultiPolygon', coordinates: [[[[103,1],[103.04,1],[103.04,1.04],[103,1.04],[103,1]],
      [[103,1.02],[103.01,1.03],[103.01,1.01],[103,1.02]]]],
  } }]; });
  const ctx = await inspect(config);
  assert.equal(ctx.audit.valid, true);
  assert.equal(ctx.policy.valid, false);
  assert.equal(ctx.normalized.features[0].geometry.type, 'MultiPolygon');
  assert.deepEqual(ctx.normalized.features[0].properties, { unchanged: true });
  assert.equal(ctx.normalized.features[0].geometry.coordinates[0].length, 2);
  assert.ok(ctx.normalized.features[0].geometry.coordinates[0][1].some(p => p[0] === 103 && p[1] === 1.02));
  await integrate('stage', [config], { out: path.join(dir, 'staged') });
  await assert.rejects(integrate('build', [config], { out: path.join(dir, 'blocked') }), /contact policy/);
  assert.equal(fs.existsSync(path.join(dir, 'blocked')), false);
  assert.deepEqual(normalizeWinding(ctx.normalized), ctx.normalized);
});

test('hole/hole point contact keeps every hole and coordinate', async () => {
  const { config } = setup();
  geometry(config, gj => { gj.features = [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
    [[103,1],[103.06,1],[103.06,1.06],[103,1.06],[103,1]],
    [[103.01,1.01],[103.03,1.01],[103.03,1.03],[103.01,1.03],[103.01,1.01]],
    [[103.03,1.03],[103.05,1.03],[103.05,1.05],[103.03,1.05],[103.03,1.03]],
  ] } }]; });
  const ctx = await inspect(config);
  assert.equal(ctx.audit.valid, true);
  assert.equal(ctx.normalized.features[0].geometry.coordinates.length, 3);
  assert.equal(ctx.policy.valid, false);
});

test('synthetic and unapproved data never promote; all evidence gates bind exact content', async () => {
  const { config, dir } = setup();
  await assert.rejects(integrate('promote', [config], { dryRun: true }), /Synthetic/);
  change(config, c => { c.synthetic = false; delete c.approval; });
  await assert.rejects(integrate('promote', [config], { dryRun: true }), /approval evidence/);
  change(config, c => { c.approval = 'approval.json'; });
  await approve(config);
  const ctx = await inspect(config);
  assert.ok(approvalEvidence(ctx));
  const ap = path.join(dir, 'approval.json'), original = read(ap);
  for (const gate of Object.keys(original.gates)) {
    const altered = structuredClone(original); delete altered.gates[gate]; write(ap, altered);
    assert.throws(() => approvalEvidence(ctx), new RegExp(gate));
  }
  write(ap, { ...original, validUntil: '2020-01-01' });
  assert.throws(() => approvalEvidence(ctx), /expired/);
  write(ap, original);
  fs.appendFileSync(path.join(dir, 'evidence.txt'), 'tampered');
  assert.throws(() => approvalEvidence(ctx), /hash mismatch/);
});

test('metadata, boundary, source bytes and point checks invalidate prior approval', async () => {
  for (const mutate of [
    (config) => change(config, c => { c.region.semantics = 'restrict'; }),
    (_, dir) => fs.appendFileSync(path.join(dir, 'boundary.geojson'), '\n'),
    (_, dir) => fs.appendFileSync(path.join(dir, 'zones.geojson'), '\n'),
    (config) => change(config, c => { c.pointChecks[0].lon += 0.001; }),
  ]) {
    const { config, dir } = setup(); await approve(config); mutate(config, dir);
    await assert.rejects(integrate('promote', [config], { dryRun: true }), /subject mismatch/);
  }
});

test('approved batch builds offline candidates; tests actual PMTiles holes/multipart and renderer', async () => {
  const a = setup(), b = setup();
  change(b.config, c => { c.region.id = 'xx-second'; });
  await approve(a.config); await approve(b.config);
  const before = snapshot(), out = path.join(tmp, 'approved-batch');
  const result = await integrate('promote', [a.config, b.config], { out });
  assert.equal(result.length, 2);
  assert.equal(read(path.join(out, 'COMPLETE.json')).length, 2);
  for (const r of result) {
    assert.equal(r.active, false); assert.equal(r.smoke.points, 6);
    assert.equal(r.smoke.rendering.painted, true);
    const dir = path.join(out, r.id);
    assert.equal(read(path.join(dir, 'data/regions/xx', r.id.slice(3), 'source.json')).publish, true);
    assert.ok(fs.existsSync(path.join(dir, 'render.png')));
    for (const [file, hash] of Object.entries(read(path.join(dir, 'checksums.json')))) assert.equal(sha256(fs.readFileSync(path.join(dir, file))), hash);
  }
  assert.deepEqual(snapshot(), before);
  assert.equal(fs.existsSync(path.join(root, 'data/regions/xx')), false);
  await assert.rejects(integrate('promote', [a.config], { out }), /NEW directory/);
});

test('a late point smoke failure cleans the entire batch and never activates a region', async () => {
  const a = setup(), b = setup(); change(b.config, c => { c.region.id = 'xx-failure'; c.pointChecks[0].inside = false; });
  const out = path.join(tmp, 'failed-batch');
  await assert.rejects(integrate('build', [a.config, b.config], { out }), /Point smoke failed/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(root, 'public/data/xx')), false);
});

test('approved batches reject an unapproved member before writing and restrict output paths', async () => {
  const a = setup(), b = setup(); await approve(a.config); change(b.config, c => { c.region.id = 'xx-unapproved'; });
  const out = path.join(tmp, 'unapproved-batch');
  await assert.rejects(integrate('build', [a.config, b.config], { out, requireApproved: true }), /Synthetic/);
  assert.equal(fs.existsSync(out), false);
  await assert.rejects(integrate('stage', [a.config, a.config], { out }), /Duplicate region/);
  await assert.rejects(integrate('stage', [a.config], { out: path.join(root, 'public/data/unsafe') }), /NEW directory/);
  const run = spawnSync(process.execPath, ['scripts/airspace/integrate.mjs', 'build', a.config, '--unknown'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 1); assert.match(run.stderr, /Unknown option/);
});

test('Guangdong and Chongqing require their original full-reference identity report', async () => {
  for (const id of ['cn-guangdong', 'cn-chongqing']) {
    const { config } = setup();
    change(config, c => { c.region.id = id; c.region.country = 'cn'; });
    await assert.rejects(inspect(config), /original pilot-report/);
    change(config, c => { c.referenceReport = 'fake-report.json'; });
    write(path.join(path.dirname(config), 'fake-report.json'), { uniqueGeometries: 777, completeReference: { emitted: true, features: 777, contentSha256: '0'.repeat(64) } });
    await assert.rejects(inspect(config), /Complete reference identity\/count mismatch/);
  }
});

test('topology work budget is bounded, configurable and fails closed', async () => {
  const { config } = setup();
  assert.equal((await inspect(config)).policy.topologyBudget, 2_000_000);
  change(config, c => { c.topologyBudget = 1; });
  await assert.rejects(inspect(config), /topology-budget-exhausted/);
  change(config, c => { c.topologyBudget = 3_000_000; });
  assert.equal((await inspect(config)).policy.valid, true);
  for (const value of [0, -1, 1.5, '3000000', 100_000_001]) {
    change(config, c => { c.topologyBudget = value; });
    await assert.rejects(inspect(config), /topologyBudget must/);
  }
  change(config, c => { c.topologyBudget = 3_000_000; });
  geometry(config, gj => { gj.features[0].geometry.coordinates[0].pop(); });
  await assert.rejects(inspect(config), /Validation failed/);
});

test('shapefile includes attributes, all records and sidecars; conflicting CRS rejected', async () => {
  const { config, dir } = setup();
  // Minimal ESRI polygon SHP/SHX/DBF made locally, with one rectangle and no DBF fields.
  const shp = Buffer.alloc(236), shx = Buffer.alloc(108);
  for (const [buffer, length] of [[shp, 118], [shx, 54]]) {
    buffer.writeInt32BE(9994, 0); buffer.writeInt32BE(length, 24);
    buffer.writeInt32LE(1000, 28); buffer.writeInt32LE(5, 32);
    [103, 1, 103.1, 1.1].forEach((n, i) => buffer.writeDoubleLE(n, 36 + 8 * i));
  }
  shp.writeInt32BE(1, 100); shp.writeInt32BE(64, 104); shp.writeInt32LE(5, 108);
  [103, 1, 103.1, 1.1].forEach((n, i) => shp.writeDoubleLE(n, 112 + i * 8));
  shp.writeInt32LE(1, 144); shp.writeInt32LE(5, 148); shp.writeInt32LE(0, 152);
  [[103,1],[103,1.1],[103.1,1.1],[103.1,1],[103,1]].forEach((p, i) => { shp.writeDoubleLE(p[0], 156 + i * 16); shp.writeDoubleLE(p[1], 164 + i * 16); });
  shx.writeInt32BE(50, 100); shx.writeInt32BE(64, 104);
  const dbf = Buffer.alloc(35); dbf[0] = 3; dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(33, 8); dbf.writeUInt16LE(1, 10); dbf[32] = 13; dbf[33] = 32; dbf[34] = 26;
  fs.writeFileSync(path.join(dir, 'grid.shp'), shp); fs.writeFileSync(path.join(dir, 'grid.shx'), shx); fs.writeFileSync(path.join(dir, 'grid.dbf'), dbf);
  fs.writeFileSync(path.join(dir, 'grid.prj'), 'GEOGCS["GCS_WGS_1984"]');
  const shapefile = await import('shapefile');
  const gj = await shapefile.read(path.join(dir, 'grid.shp'));
  change(config, c => { c.input = 'grid.shp'; c.region.format = 'shapefile'; c.expected = { features: 1, contentSha256: sha256(stringify(gj)) }; });
  const ctx = await inspect(config);
  assert.equal(ctx.subject.features, 1); assert.equal(Object.keys(ctx.subject.inputFiles).length, 4);
  const source = { ...ctx.meta, file: 'grid.shp' };
  assert.equal((await readRegion(dir, source)).features.length, 1);
  const dd = 'GEOGCS["WGS84(DD)", DATUM["WGS84", SPHEROID["WGS84",6378137,298.257223563]], PRIMEM["Greenwich",0], UNIT["degree",0.017453292519943295]]';
  fs.writeFileSync(path.join(dir, 'grid.prj'), dd);
  const direct = await inspect(config);
  assert.deepEqual(direct.collection, gj);
  for (const invalid of [dd.replace('6378137', '6370000'), dd.replace('"Greenwich",0', '"Greenwich",1'), dd.replace('DATUM["WGS84"', 'DATUM["NAD83"'), dd.replace('"degree"', '"radian"'), 'GEOGCS["Unknown",REMARK["WGS 84"]]', 'WGS84(DD)', 'PROJCS["UTM",' + dd + ']']) {
    fs.writeFileSync(path.join(dir, 'grid.prj'), invalid);
    await assert.rejects(inspect(config), /geographic WGS84/);
  }
  fs.writeFileSync(path.join(dir, 'grid.prj'), 'PROJCS["WGS 84 / UTM"]');
  await assert.rejects(inspect(config), /geographic WGS84/);
});
