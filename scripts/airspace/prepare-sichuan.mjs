// Reconstruct the complete original-source union from bounded, checksummed captures.
// Never use the conservative acquisition normalizer's diagnostic subset for release.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { normalizeWinding } from './integrate.mjs';
import { fixtureEvidence, deduplicateEvidence, compareEvidence, knownUniverseFiltering } from '../china-airspace/fixture-evidence.js';
import { sha256, stringify } from '../china-airspace/core.js';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const out = 'planning/china-airspace/sichuan-network';
const checkpoint = read(out + '/checkpoint.json'), plan = read(out + '/plan.json');
const diagnostic = read(out + '/report.json').technical;
assert.equal(diagnostic.errorCount, diagnostic.errors.length, 'Truncated diagnostic findings');
assert(diagnostic.errors.every(e => /(?:^|:)(hole-outside-or-touching-shell|overlapping-or-nested-holes|topology-budget-exhausted)$/.test(e)), 'Unresolved acquisition findings');
assert.equal(plan.requests.length, 16);
const captures = plan.requests.map(request => {
  const entry = checkpoint.responses[request.key];
  assert(entry, 'Missing response ' + request.key);
  const bytes = fs.readFileSync(`${out}/responses/${request.key}.json`);
  assert.equal(sha256(bytes), entry.sha256);
  const c = JSON.parse(bytes);
  assert.equal(entry.status, 200);
  assert.equal(c.coordinateSystem, 'WGS84');
  assert.equal(c.provinceId, 'sichuan');
  assert.equal(c.snapshotFetchedAt, '2026-09-22T05:49:15.173Z');
  for (const k of ['truncated', 'hasMore', 'next', 'nextPage']) assert(!c[k], k);
  assert(!c.links?.some(x => x.rel === 'next'));
  for (const k of ['totalFeatures', 'numberMatched']) if (c[k] !== undefined) assert.equal(c[k], c.features.length);
  assert(entry.bytes < 25_000_000);
  const e = fixtureEvidence(c);
  assert.equal(e.summary.missingIds, 0);
  assert.deepEqual(e.summary.structuralIssues, []);
  assert.deepEqual(e.summary.query, request.bbox);
  return e;
});
const union = deduplicateEvidence(captures);
assert.deepEqual(union.conflicts, []);
const originalById = new Map(), originalByGeometry = new Map();
for (const capture of captures) for (const item of capture.items) {
  const original = stringify(item.feature);
  if (originalById.has(item.id)) assert.equal(original, originalById.get(item.id), 'Nonidentical raw feature for ' + item.id);
  originalById.set(item.id, original);
  const geometry = stringify(item.feature.geometry);
  if (originalByGeometry.has(item.geometryHash)) assert.equal(geometry, originalByGeometry.get(item.geometryHash), 'Canonical identity hides coordinate/ring-order differences');
  originalByGeometry.set(item.geometryHash, geometry);
}
const filtering = captures.map(e => knownUniverseFiltering(e, union.items));
assert(filtering.every(x => x.exactSampleMatch), 'Inconsistent overlap/window filtering');
const comparisons = [];
for (let i = 0; i < captures.length; i++) for (let j = 0; j < i; j++) {
  const c = compareEvidence(captures[i], captures[j]);
  assert.deepEqual(c.geometryConflictIds, []);
  if (c.commonQuery) {
    assert.deepEqual(c.bboxSelectedOverlap.onlyA, []);
    assert.deepEqual(c.bboxSelectedOverlap.onlyB, []);
    comparisons.push({a: plan.requests[i].key, b: plan.requests[j].key, ...c});
  }
}
const oldHashes = ['ea31059ccb0e2f1a09e1023a177a22eb41d7d2c552eb0b17c73fe4623fc9b64b','f5d7d7cfc3da631206353e24492b10112cb84ed7c0ac1201c3f6a8f33a1d3c71'];
const old = deduplicateEvidence(['0-0','0-1'].map((key,i) => {
  const bytes = fs.readFileSync(`planning/sichuan/chengdu-capture-network/responses/${key}.json`);
  assert.equal(sha256(bytes), oldHashes[i]);
  return fixtureEvidence(JSON.parse(bytes));
}));
assert.equal(old.occurrences,59); assert.equal(old.items.length,57);
assert.equal(old.duplicates,2); assert.deepEqual(old.conflicts,[]);
for (const item of old.items) {
  const next = union.items.find(x => x.id === item.id);
  assert(next, 'Original Chengdu ID missing: ' + item.id);
  assert.equal(stringify(next.feature), stringify(item.feature), 'Original feature changed: ' + item.id);
}
const source = {type:'FeatureCollection',coordinateSystem:'WGS84',features:union.items.map(x=>x.feature)};
const audit = spawnSync(process.env.AIRSPACE_PYTHON || 'python', ['scripts/airspace/geos.py'], {
  input:JSON.stringify({before:source,after:normalizeWinding(source),includeInteriorWitnesses:true}),encoding:'utf8',maxBuffer:256*1024*1024,
});
assert.equal(audit.status,0,audit.stderr || String(audit.error));
const geos = JSON.parse(audit.stdout); assert.equal(geos.valid,true);
fs.writeFileSync('docs/china-airspace/evidence/sichuan-geos.json',JSON.stringify(geos,null,2)+'\n');
const bytes = JSON.stringify(source,null,2)+'\n';
fs.mkdirSync('data/regions/cn/sichuan',{recursive:true});
fs.writeFileSync('data/regions/cn/sichuan/zones.geojson',bytes);
const meta = read('planning/sichuan/chengdu-source/source.json');
Object.assign(meta,{id:'cn-sichuan',name:'Sichuan',nameZh:'四川'});
delete meta.maskToBoundary; delete meta.boundary;
meta.source = {...meta.source,contentSha256:sha256(stringify(source)),acquiredOn:'2026-11-15'};
fs.writeFileSync('data/regions/cn/sichuan/source.json',JSON.stringify(meta,null,2)+'\n');
const report = {checkedOn:'2026-11-15',networkAttempts:checkpoint.networkRequests,successfulRequests:captures.length,failedNetworkAttempts:checkpoint.networkRequests-captures.length,envelope:[97.2,25.9,108.7,34.5],partition:{columns:4,rows:4,overlap:0.05},sourceSnapshot:meta.source.snapshotAt,occurrences:union.occurrences,uniquePolygons:union.items.length,exactDuplicates:union.duplicates,conflicts:union.conflicts,missingIds:0,originalChengdu:{occurrences:59,uniquePolygons:57,unchangedFeatures:57,missing:[],conflicts:[]},contentSha256:meta.source.contentSha256,fileSha256:sha256(bytes),captures:plan.requests.map((r,i)=>({key:r.key,...checkpoint.responses[r.key],features:captures[i].items.length})),filtering,comparisons,completeness:'unverified; complete bounded-window union, not proof of the provider inventory',responseContract:'observed full-feature identity and consistent bbox selection; undocumented pagination/limits remain unverified'};
fs.writeFileSync('docs/china-airspace/evidence/sichuan-acquisition.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({requests:report.successfulRequests,attempts:report.networkAttempts,occurrences:report.occurrences,uniquePolygons:report.uniquePolygons,chengduUnchanged:57}));
