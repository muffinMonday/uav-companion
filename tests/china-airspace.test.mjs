// Standalone to avoid modifying tests/run.mjs while the UX test registry is in use.
// node --test tests/china-airspace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalize, partition, validateCollection, stringify, compareResponses, sha256 } from '../scripts/china-airspace/core.js';
import { geometryErrors, bboxGeometry, intersectsBox, budget, segmentIntersection, edges } from '../scripts/china-airspace/geometry.js';
import { fixtureEvidence,compareEvidence,deduplicateEvidence,knownUniverseFiltering } from '../scripts/china-airspace/fixture-evidence.js';
import { acquire, makePlan } from '../scripts/china-airspace/acquire.js';
import { stagingDirectory } from '../scripts/china-airspace/cli.mjs';
import { previewHTML } from '../scripts/china-airspace/preview.js';
import { validateInventory, inventoryMarkdown } from '../scripts/china-airspace/inventory.mjs';
import { readRegion } from '../scripts/lib/readers.js';
import { CONVERT } from '../scripts/lib/crs.js';
import { buildTiles, MIN_Z, MAX_Z } from '../scripts/lib/tiles.js';
import { writePMTiles } from '../scripts/lib/pmtiles-writer.js';

const root = path.resolve(import.meta.dirname, '..');
const rect = (w = 110, s = 30, e = 110.01, n = 30.01, id = 'a', properties = {}) => ({ type: 'Feature', id, properties, geometry: bboxGeometry([w, s, e, n]) });
const fc = (...features) => ({ type: 'FeatureCollection', features });
const options = { crs: 'wgs84' };
const config = () => ({ id: 'cn-test', bbox: [109, 29, 111, 31], endpoint: 'https://example.com/public?province=test', partition: { columns: 2, rows: 1, overlap: 0.1 }, access: { status: 'permitted', evidence: 'Local test server contract', checkedOn: '2026-11-14', maxRequests: 6 }, responsePolicy: { pagination: 'none', wholeFeatures: true, evidence: 'test' }, validation: options });
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'china-airspace-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const write = (dir, name, v) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(v)); return f; };
const mock = (value = fc(rect()), status = 200, headers = {}) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/geo+json', ...headers } });
const transport = fetchImpl => ({ fetchImpl, sleep: async () => {} });

test('partition covers exact edges, has controlled overlap, clamps requests and rejects huge plans', () => {
  const p = partition([105.2, 28.1, 110.3, 32.3], { columns: 3, rows: 3, overlap: 0.05 });
  assert.equal(p.length, 9); assert.equal(p[0].core[0], 105.2); assert.equal(p.at(-1).core[2], 110.3); assert.equal(p.at(-1).core[3], 32.3);
  assert.equal(p[0].core[2], p[1].core[0]); assert(p[0].bbox[2] > p[1].bbox[0]);
  assert.throws(() => partition([0, 0, 1, 1], { rows: 100, columns: 100 }));
  assert.throws(() => partition([1, 0, 0, 1])); assert.throws(() => partition([0, 0, 1, 90]));
});
test('boundary geometry filters partitions without clipping source polygons', () => {
  const boundary = bboxGeometry([0.1, 0.1, 0.9, 0.9]);
  assert.equal(partition([0, 0, 4, 4], { columns: 4, rows: 4, boundary }).length, 1);
  assert(intersectsBox(bboxGeometry([0, 0, 2, 2]), [0.4, 0.4, 0.6, 0.6]));
});
test('stable ID and rotated/reversed geometry deduplicate deterministically', () => {
  const a = rect(), b = structuredClone(a); b.geometry.coordinates[0] = [[110.01, 30.01], [110.01, 30], [110, 30], [110, 30.01], [110.01, 30.01]];
  const x = normalize([fc(a), fc(b)], options), y = normalize([fc(b), fc(a)], options);
  assert(x.report.valid); assert.equal(x.report.duplicateCount, 1); assert.equal(x.geojson.features.length, 1); assert.equal(x.sha256, y.sha256);
});
test('stable ID conflict and property conflict fail closed', () => {
  assert.equal(normalize([fc(rect(), rect(110.02, 30, 110.03, 30.01))], options).report.conflicts[0].reason, 'stable-id-conflict');
  const a = rect(), b = rect(); b.properties = { classification: 'different' };
  assert.equal(normalize([fc(a, b)], options).report.valid, false);
});
test('missing IDs use geometry without collapsing different geometries', () => {
  const a = rect(), b = rect(110.02, 30, 110.03, 30.01); delete a.id; delete b.id;
  assert.equal(normalize([fc(a, a, b)], options).geojson.features.length, 2);
});
test('ID property is configurable, empty IDs and unsafe numeric IDs rejected', () => {
  const a = rect(); delete a.id; a.properties.code = 'cell';
  assert.equal(normalize([fc(a, a)], { ...options, idProperty: 'code' }).report.duplicateCount, 1);
  a.id = ''; assert(!validateCollection(fc(a), options).valid); a.id = 2 ** 54; assert(!validateCollection(fc(a), options).valid);
});
test('MultiPolygon part order and hole order deduplicate', () => {
  const p = bboxGeometry([110, 30, 111, 31]).coordinates;
  p.push(bboxGeometry([110.1, 30.1, 110.2, 30.2]).coordinates[0], bboxGeometry([110.3, 30.3, 110.4, 30.4]).coordinates[0]);
  const q = bboxGeometry([112, 30, 113, 31]).coordinates;
  const a = rect(); a.geometry = { type: 'MultiPolygon', coordinates: [p, q] };
  const b = structuredClone(a); b.geometry.coordinates.reverse(); b.geometry.coordinates[1] = [p[0], p[2], p[1]];
  assert.equal(normalize([fc(a, b)], options).report.duplicateCount, 1);
});
test('normalization writes counterclockwise shells and clockwise holes', () => {
  const a = rect(110,30,111,31); a.geometry.coordinates.push(bboxGeometry([110.1,30.1,110.2,30.2]).coordinates[0]);
  const rings = normalize([fc(a)], options).geojson.features[0].geometry.coordinates;
  const area = r => r.slice(0,-1).reduce((sum,p,i) => sum + p[0]*r[i+1][1] - r[i+1][0]*p[1],0);
  assert(area(rings[0])>0); assert(area(rings[1])<0);
});
test('malformed, empty, null geometry and non-polygon responses fail', () => {
  for (const value of [null, {}, fc(), { type: 'FeatureCollection', features: {} }, fc({ ...rect(), geometry: null }), fc({ ...rect(), geometry: { type: 'Point', coordinates: [110, 30] } }), fc({ ...rect(), properties: [] })]) assert(!validateCollection(value, options).valid);
});
test('unclosed rings, bowties, zero area, repeated edges and wrong coordinate order fail', () => {
  const rings = [ [[110,30],[111,30],[111,31],[110,31]], [[110,30],[111,31],[110,31],[111,30],[110,30]], [[110,30],[111,30],[112,30],[110,30]], [[110,30],[111,30],[110.5,30],[111,31],[110,30]], [[30,110],[31,110],[31,111],[30,110]] ];
  for (const ring of rings) assert(geometryErrors({ type: 'Polygon', coordinates: [ring] }).length);
});
test('holes inside pass, outside/touching/nested holes fail', () => {
  const shell = bboxGeometry([110,30,111,31]).coordinates[0], hole = bboxGeometry([110.1,30.1,110.2,30.2]).coordinates[0];
  assert.deepEqual(geometryErrors({ type: 'Polygon', coordinates: [shell, hole] }), []);
  for (const h of [bboxGeometry([109,29,109.5,29.5]).coordinates[0], bboxGeometry([110,30,110.2,30.2]).coordinates[0]]) assert(geometryErrors({ type: 'Polygon', coordinates: [shell, h] }).length);
  assert(geometryErrors({ type: 'Polygon', coordinates: [shell, hole, bboxGeometry([110.12,30.12,110.18,30.18]).coordinates[0]] }).includes('overlapping-or-nested-holes'));
});
test('overlapping parts fail and hole islands are accepted', () => {
  assert(geometryErrors({ type: 'MultiPolygon', coordinates: [bboxGeometry([0,0,2,2]).coordinates, bboxGeometry([1,1,3,3]).coordinates] }).includes('overlapping-multipolygon-parts'));
  const outside = [bboxGeometry([0,0,4,4]).coordinates[0], bboxGeometry([1,1,3,3]).coordinates[0]];
  assert.deepEqual(geometryErrors({ type: 'MultiPolygon', coordinates: [outside, bboxGeometry([1.5,1.5,2.5,2.5]).coordinates] }), []);
});
test('unknown and conflicting CRS cannot pass; range alone never verifies alignment', () => {
  assert(!validateCollection(fc(rect())).valid);
  assert(!validateCollection({ ...fc(rect()), crs: { properties: { name: 'EPSG:3857' } } }, options).valid);
  assert(validateCollection({ ...fc(rect()), crs: { properties: { name: 'EPSG:4326' } } }, options).valid);
  assert.equal(normalize([fc(rect())], options).report.crsAlignment, 'unverified');
});
test('pagination hints and known total mismatches fail', () => {
  for (const hint of [{ truncated: true }, { hasMore: true }, { next: '/next' }, { numberMatched: 5 }, { totalFeatures: 2 }, { links: [{ rel: 'next', href: '/next' }] }]) assert(!validateCollection({ ...fc(rect()), ...hint }, options).valid);
});
test('adjacent cells pass; overlapping cells and containment block', () => {
  assert(normalize([fc(rect(110,30,111,31,'a'), rect(111,30,112,31,'b'))], options).report.valid);
  assert.equal(normalize([fc(rect(110,30,112,32,'a'), rect(111,31,113,33,'b'))], options).report.overlaps.length, 1);
  assert.equal(normalize([fc(rect(110,30,112,32,'a'), rect(110.1,30.1,111,31,'b'))], options).report.overlaps.length, 1);
});
test('topology budget exhaustion is explicit and invalid', () => {
  const r = normalize([fc(rect())], { ...options, topologyBudget: 0 });
  assert(!r.report.valid); assert(r.report.errors.some(x => x.includes('budget-exhausted')));
});
test('long source rings are checked within a bounded spatial candidate budget', () => {
  const ring = Array.from({length:4000},(_,i)=>[110+Math.cos(i*2*Math.PI/4000),30+Math.sin(i*2*Math.PI/4000)]); ring.push(ring[0]);
  assert.deepEqual(geometryErrors({type:'Polygon',coordinates:[ring]},budget(200000)),[]);
});
test('explicit coordinateSystem declarations must agree with configured CRS', () => {
  assert.equal(validateCollection({...fc(rect()),coordinateSystem:'GCJ-02'},options).valid,false);
  assert.equal(validateCollection({...fc(rect()),coordinateSystem:'WGS84'},options).valid,true);
});
test('spatial self-intersection pruning matches exhaustive segment checks', () => {
  let seed=13; const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<50;sample++) {
    const ring=Array.from({length:12},()=>[110+random(),30+random()]);ring.push(ring[0]);const es=edges(ring);let brute=false;
    for(let i=0;i<es.length;i++)for(let j=i+2;j<es.length;j++)if(!(i===0&&j===es.length-1)&&segmentIntersection(...es[i],...es[j]))brute=true;
    assert.equal(geometryErrors({type:'Polygon',coordinates:[ring]}).includes('self-intersection'),brute);
  }
});
test('local fixture summaries use properties IDs and preserve exact source evidence', () => {
  const a=rect();delete a.id;a.properties.id='source-1';const collection={...fc(a),bounds:{west:109,south:29,east:111,north:31},coordinateSystem:'WGS84'};
  const before=stringify(collection),result=fixtureEvidence(collection);
  assert.equal(result.summary.uniqueIds,1);assert.equal(result.summary.positions,5);assert.deepEqual(result.summary.extent,[110,30,110.01,30.01]);assert.equal(result.summary.coordinateRangeValid,true);assert.equal(stringify(collection),before);
  assert.equal(result.summary.sourceWinding.clockwiseShells,0);const reversed=structuredClone(collection);reversed.features[0].geometry.coordinates[0].reverse();assert.equal(fixtureEvidence(reversed).summary.sourceWinding.clockwiseShells,1);
  assert.equal(fixtureEvidence(fc({...a,geometry:{type:'Polygon',coordinates:[]}})).summary.structuralIssues.length,1);
});
test('fixture deduplication is deterministic and exposes ID/geometry disagreement', () => {
  const a=fixtureEvidence(fc(rect())),b=fixtureEvidence(fc(rect(),rect(110.1,30,110.2,30.1,'b')));
  const x=deduplicateEvidence([a,b]),y=deduplicateEvidence([b,a]);assert.equal(x.duplicates,1);assert.equal(x.uniqueIds,2);assert.equal(stringify(x),stringify(y));
  assert.equal(compareEvidence(a,b).identicalSharedGeometry,1);
  assert.deepEqual(deduplicateEvidence([a,fixtureEvidence(fc(rect(111,30,112,31)))]).conflicts,['a']);
});
test('observed bbox filtering is distinct from polygon intersection and completeness', () => {
  const a=rect(110,30,114,34);a.geometry.coordinates.push(bboxGeometry([111,31,113,33]).coordinates[0]);
  const collection={...fc(a),bounds:{west:111.2,south:31.2,east:111.4,north:31.4}};const e=fixtureEvidence(collection),result=knownUniverseFiltering(e,e.items);
  assert.equal(e.summary.bboxIntersectionMatches,1);assert.deepEqual(e.summary.geometryNonIntersectionIds,['a']);assert(result.exactSampleMatch);assert(result.scope.includes('does not'));
});
test('overlap comparisons expose clipping/missing cells; same response never proves completeness', () => {
  const a = fc(rect()); const boxes = [[109,29,110.5,31], [109.5,29,111,31]];
  assert.equal(compareResponses(a, boxes[0], a, boxes[1], options).status, 'consistent-sample');
  assert.equal(compareResponses(a, boxes[0], fc(rect(110,30,110.005,30.01)), boxes[1], options).status, 'inconsistent');
  assert.equal(compareResponses(a, boxes[0], a, boxes[1], options).provesProvincialCompleteness, false);
  assert.equal(compareResponses(a, [0,0,1,1], a, [2,2,3,3], options).status, 'no-overlapping-query-area');
});
test('live dry run works without permission and writes nothing', async t => {
  const dir = temp(t), c = config(); c.access.status = 'unverified'; let called = false;
  const r = await acquire(c, dir, path.join(dir,'out'), { dryRun: true, fetchImpl: () => { called = true; } });
  assert.equal(r.networkRequests, 0); assert.equal(called, false); assert.equal(fs.existsSync(path.join(dir,'out')), false);
  await assert.rejects(acquire(c, dir, path.join(dir,'out')), /permission/);
});
test('undocumented clipping/pagination blocks before network', async t => {
  const dir = temp(t), c = config(); c.responsePolicy.pagination = 'unknown';
  await assert.rejects(acquire(c, dir, path.join(dir,'out')), /pagination/);
});
test('serial acquisition archives checksums and resumes without fetching', async t => {
  const dir = temp(t), c = config(), out = path.join(dir,'out'); let calls = 0;
  const result = await acquire(c, dir, out, transport(async () => { calls++; return mock(); }));
  assert.equal(calls, 2); assert.equal(result.report.technical.uniqueFeatures, 1); assert.equal(result.report.integrationReady, false);
  const again = await acquire(c, dir, out, transport(() => { throw new Error('must not fetch'); }));
  assert.equal(result.report.outputSha256, again.report.outputSha256);
  assert.equal(sha256(fs.readFileSync(path.join(out,'responses/0-0.json'))), JSON.parse(fs.readFileSync(path.join(out,'checkpoint.json'))).responses['0-0'].sha256);
});
test('HTTP 5xx backoff then succeeds; Retry-After respected', async t => {
  const dir = temp(t), c = config(); c.partition.columns = 1; let calls = 0; const waits = [];
  await acquire(c, dir, path.join(dir,'out'), { fetchImpl: async () => ++calls === 1 ? mock({}, 503, { 'retry-after': '5' }) : mock(), sleep: async ms => waits.push(ms) });
  assert.equal(calls, 2); assert(waits.includes(5000)); assert.equal(waits.filter(x => x === 3000).length, 2);
});
test('401/403/429 and redirects halt without retries and checkpoint backoff', async t => {
  const dir = temp(t);
  for (const status of [401,403,429,302]) {
    let calls = 0; const out = path.join(dir,String(status));
    await assert.rejects(acquire(config(), dir, out, transport(async () => { calls++; return mock({},status); })), /stopped/);
    assert.equal(calls, 1); assert(JSON.parse(fs.readFileSync(path.join(out,'checkpoint.json'))).nextAllowedAt);
  }
});
test('interrupted run resumes only missing requests', async t => {
  const dir = temp(t), c = config(), out = path.join(dir,'out'); c.transport = { attempts: 1 }; let calls = 0;
  await assert.rejects(acquire(c, dir, out, transport(async () => { if(++calls === 2) throw new Error('offline'); return mock(); })), /offline/);
  calls = 0; await acquire(c, dir, out, transport(async () => { calls++; return mock(); })); assert.equal(calls, 1);
});
test('HTTP budget includes retries and persists across restarts', async t => {
  const dir = temp(t), c = config(), out = path.join(dir,'out'); c.access.maxRequests = 2; let calls = 0;
  await assert.rejects(acquire(c, dir, out, transport(async () => { calls++; return mock({},503); })), /budget exhausted/);
  assert.equal(calls,2);
  await assert.rejects(acquire(c, dir, out, transport(async () => { calls++; return mock(); })), /budget exhausted/); assert.equal(calls,2);
});
test('invalid JSON archived, cache corruption and changed configuration rejected', async t => {
  const dir = temp(t), c = config(), out = path.join(dir,'out'); c.partition.columns = 1;
  const r = await acquire(c, dir, out, transport(async () => mock('<html>error</html>'))); assert.equal(r.report.acquisition.failed[0].reason, 'invalid-json');
  fs.appendFileSync(path.join(out,'responses/0-0.json'), ' ');
  await assert.rejects(acquire(c, dir, out, { validationOnly: true }), /checksum/);
  c.bbox[0] = 108; await assert.rejects(acquire(c, dir, out, { validationOnly: true }), /Checkpoint/);
});
test('validation-only reports incomplete checkpoints without network', async t => {
  const dir = temp(t), c = config(), out = path.join(dir,'out'); c.transport = { attempts: 1 }; let calls = 0;
  await assert.rejects(acquire(c, dir, out, transport(async () => { if(++calls === 2) throw new Error('offline'); return mock(); })));
  const r = await acquire(c, dir, out, { validationOnly: true, fetchImpl: () => { throw new Error('network forbidden'); } });
  assert.equal(r.report.acquisition.allPlannedResponsesPresent, false); assert(r.report.blockers.includes('missing-or-invalid-responses'));
});
test('empty responses, feature caps and unexpected geography block acquisition readiness', async t => {
  const dir = temp(t);
  for (const [key, data] of [['empty',fc()],['cap',fc(rect())],['geography',fc(rect(120,40,121,41))]]) {
    const c = config(); c.partition.columns = 1; if (key === 'cap') c.responsePolicy.featureLimit = 1;
    const r = await acquire(c, dir, path.join(dir,key), transport(async () => mock(data)));
    assert(r.report.blockers.includes(key === 'empty' ? 'technical-validation-failed' : key === 'cap' ? 'possible-response-truncation' : 'unexpected-geography'));
  }
});
test('local source inputs work offline; content changes invalidate checkpoint', async t => {
  const dir = temp(t), file = write(dir,'raw.geojson',fc(rect())), c = config(); c.localFiles = [{ file }]; delete c.access;
  const out = path.join(dir,'out'); const r = await acquire(c, dir, out, { fetchImpl: () => { throw new Error('forbidden'); } }); assert(r.report.technical.valid);
  write(dir,'raw.geojson',fc(rect(110.02,30,110.03,30.01)));
  await assert.rejects(acquire(c, dir, out, { validationOnly: true }), /Checkpoint/);
});
test('local archive can be revalidated after original input is removed', async t => {
  const dir = temp(t), file = write(dir,'raw.geojson',fc(rect())), c = config(); c.localFiles = [{ file }]; const out = path.join(dir,'out');
  const original = await acquire(c, dir, out); fs.unlinkSync(file);
  const replay = await acquire(c, dir, out, { validationOnly: true });
  assert.equal(replay.report.outputSha256,original.report.outputSha256); assert.equal(replay.report.acquisition.networkRequests,0);
});
test('oversized responses and invalid transport stop, locks prevent simultaneous writers', async t => {
  const dir = temp(t), c = config(); c.transport = { maxBytes: 10 };
  await assert.rejects(acquire(c, dir, path.join(dir,'a'), transport(async () => mock())), /size-limit/);
  c.transport = { intervalMs: 0 }; await assert.rejects(acquire(c, dir, path.join(dir,'b')), /transport/);
  c.transport = {}; const out = path.join(dir,'c'); fs.mkdirSync(out); fs.writeFileSync(path.join(out,'acquisition.lock'),'busy'); await assert.rejects(acquire(c, dir, out), /EEXIST/);
});
test('output guard prevents production writes; public endpoint cannot carry credentials', () => {
  assert.throws(() => stagingDirectory(path.join(root,'public/data')), /Output/);
  assert.throws(() => stagingDirectory(path.join(root,'data/regions/cn/test')), /Output/);
  assert(stagingDirectory(path.join(root,'planning/china-airspace/test')));
  const c = config(); c.endpoint = 'https://user:password@example.com/'; assert.throws(() => makePlan(c,root), /credentials/);
});
test('offline preview escapes untrusted text and forbids external requests', () => {
  const s = previewHTML(fc(rect()), { region: '</script><script>alert(1)</script>' }, [109,29,111,31]);
  assert(!s.includes('</script><script>alert')); assert(s.includes("connect-src 'none'")); assert(s.includes('textContent')); assert(s.includes('Blank areas mean unknown'));
});
test('CLI rejects bad flags and invalid datasets with nonzero status', t => {
  const dir = temp(t), f = write(dir,'bad.geojson',fc());
  const run = args => spawnSync(process.execPath, ['scripts/china-airspace/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run(['acquire','data/china-airspace/pilots/cn-guangdong.json','--dry-run']).status, 0);
  assert.equal(run(['validate',f,'--wat']).status, 1);
  assert.equal(run(['validate',f,'--dry-run']).status, 1);
  assert.equal(run(['validate',f,'--out',path.join(root,'planning/china-airspace/test-cli'),'--crs','wgs84']).status, 2);
});
test('inventory is complete, explicit, deterministic, and new regions stay blocked', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root,'data/china-airspace/inventory.json')));
  assert(validateInventory(inventory)); assert.equal(inventory.regions.length,31); assert.equal(inventory.regions.filter(r=>r.thirdPartyProvinceId).length,30);
  assert.equal(inventoryMarkdown(inventory),inventoryMarkdown(inventory));
  const bad = structuredClone(inventory); bad.regions[0].integrationReadiness='ready'; assert.throws(()=>validateInventory(bad));
  assert.equal(inventory.regions.find(x=>x.name==='Inner Mongolia').thirdPartyProvinceId,'neimenggu');
});
test('Hubei metadata and existing reader/PMTiles contract remain compatible', async t => {
  const meta = JSON.parse(fs.readFileSync(path.join(root,'data/regions/cn/hubei/source.json')));
  assert.equal(meta.format,'shapefile'); assert.equal(meta.semantics,'allow'); assert.equal(meta.crs,'wgs84'); assert.equal(meta.crsVerified,false); assert.equal(meta.source.effective,'2026-05-14'); assert.equal(meta.maxHeightM,120);
  const dir = temp(t), feature = rect(); write(dir,'input.geojson',fc(feature));
  const source = await readRegion(dir,{...meta,format:'geojson',file:'input.geojson'});
  const normalized = normalize([fc(feature)],options); write(dir,'normalized.geojson',normalized.geojson);
  const prepared = await readRegion(dir,{...meta,format:'geojson',file:'normalized.geojson'});
  assert.deepEqual(prepared.bounds,source.bounds); assert.deepEqual(prepared.features[0].properties,{});
  const build = data => writePMTiles({ tiles: buildTiles(data.features,data.bounds), bounds:data.bounds, minZoom:MIN_Z, maxZoom:MAX_Z, metadata:{name:'fixture',vector_layers:[{id:'zones',fields:{}}]} });
  const bytes = build(prepared); assert.equal(bytes.subarray(0,7).toString(),'PMTiles'); assert.deepEqual(bytes,build(prepared)); assert.equal(bytes[7],3);
  const converted = CONVERT.gcj02(114.3,30.6); assert(Math.abs(converted[0]-114.3)>0.001); assert.equal(CONVERT.wgs84,null);
});
