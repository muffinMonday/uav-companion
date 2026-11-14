// Offline integration only. No live collection, production registration or deployment.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as shapefile from 'shapefile';
import { buildRegion } from '../build-data.js';
import { readRegion } from '../lib/readers.js';
import { validateCollection, sha256, stringify } from '../china-airspace/core.js';
import { canonicalRing, polygons } from '../china-airspace/geometry.js';
import { assertCompleteReference } from '../china-airspace/artifact-contract.js';
import { previewHTML } from '../china-airspace/preview.js';
import { pointSmoke, renderSmoke } from './smoke.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
const need = (condition, message) => { if (!condition) throw new Error(message); };
const digest = p => sha256(fs.readFileSync(p));
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;
const gates = ['semantics', 'crsAlignment', 'completeness', 'effectiveDates', 'redistribution', 'production'];

export function normalizeWinding(collection) {
  // Keep feature/component/hole order and geometry type. Roles come from array membership.
  return { ...collection, features: collection.features.map(f => ({ ...f, geometry: { ...f.geometry,
    coordinates: f.geometry.type === 'Polygon'
      ? f.geometry.coordinates.map((r, i) => canonicalRing(r, i > 0))
      : f.geometry.coordinates.map(p => p.map((r, i) => canonicalRing(r, i > 0))),
  } })) };
}

function structural(collection, crs, topologyBudget = 2_000_000) {
  const result = validateCollection(collection, { crs, topologyBudget });
  need(!result.errorCount || result.errorCount <= result.errors.length, 'Validation findings truncated; explicit investigation required');
  // Do not weaken the existing contact policy. Complete contact geometries can be staged
  // and independently audited, but remain blocked from building/promotion by this policy.
  const contact = /:(hole-outside-or-touching-shell|overlapping-or-nested-holes|self-intersection)$/;
  const fatal = result.errors.filter(e => !contact.test(e));
  need(!fatal.length, `Validation failed: ${fatal.join(', ')}`);
  for (const f of collection.features) {
    need(['Polygon', 'MultiPolygon'].includes(f.geometry?.type), 'Non-polygon/null geometry');
    for (const p of polygons(f.geometry)) for (const r of p) {
      need(r.length >= 4 && r.every(v => v.length === 2 && v.every(Number.isFinite) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 85), 'Invalid coordinates');
      need(stringify(r[0]) === stringify(r.at(-1)), 'Unclosed ring');
    }
  }
  return { valid: result.valid, errors: result.errors, errorCount: result.errorCount ?? result.errors.length, topologyBudget };
}

function geos(before, after) {
  const run = spawnSync(process.env.AIRSPACE_PYTHON || 'python', [path.join(import.meta.dirname, 'geos.py')], {
    input: JSON.stringify({ before, after }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  need(run.status === 0, `GEOS audit failed (set AIRSPACE_PYTHON; use existing requirements-geos.txt): ${run.error?.message || run.stderr}`);
  const result = JSON.parse(run.stdout);
  need(result.valid === true, 'GEOS audit did not pass');
  return result;
}

export async function inspect(configFile) {
  const config = json(configFile), base = path.dirname(path.resolve(configFile));
  const meta = config.region;
  need(meta && /^[a-z]{2}$/.test(meta.country) && new RegExp(`^${meta.country}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(meta.id), 'Invalid country/region id');
  need(['geojson', 'shapefile'].includes(meta.format) && ['wgs84', 'gcj02'].includes(meta.crs), 'Unsupported format/CRS');
  need(['allow', 'restrict'].includes(meta.semantics) && typeof meta.name === 'string' && meta.name.trim(), 'Missing name/semantics');
  need(meta.source?.authority && date(meta.source.effective) && typeof meta.license === 'string' && meta.license.trim(), 'Missing authority/effective date/license');
  need(meta.layers === undefined && meta.file === undefined && meta.boundary === undefined && meta.publish === undefined, 'Use input/boundary; publish is controlled by the workflow');
  need(typeof config.input === 'string' && typeof config.boundary === 'string', 'input and boundary required');
  const input = path.resolve(base, config.input), boundaryFile = path.resolve(base, config.boundary);
  const inputFiles = { [path.basename(input)]: digest(input) };
  let collection;
  if (meta.format === 'geojson') collection = json(input);
  else {
    need(input.toLowerCase().endsWith('.shp'), 'Expected .shp input');
    for (const extension of ['.shx', '.dbf', '.prj']) {
      const file = input.slice(0, -4) + extension;
      inputFiles[path.basename(file)] = digest(file);
    }
    const prj = fs.readFileSync(input.slice(0, -4) + '.prj', 'utf8');
    const name = /^\s*GEOGCS\s*\[\s*"([^"]+)"/i.exec(prj)?.[1];
    const known = /^(?:GCS_WGS_1984|WGS[ _]84)$/i.test(name ?? '');
    const dd = name === 'WGS84(DD)' && /DATUM\s*\[\s*"WGS84"/i.test(prj)
      && /SPHEROID\s*\[\s*"WGS84"\s*,\s*6378137(?:\.0)?\s*,\s*298\.257223563\s*\]/i.test(prj)
      && /PRIMEM\s*\[\s*"Greenwich"\s*,\s*0(?:\.0)?\s*\]/i.test(prj)
      && /UNIT\s*\[\s*"degree"\s*,\s*0\.017453292519943(?:295)?\s*\]/i.test(prj);
    const datum = /DATUM\s*\[\s*"([^"]+)"/i.exec(prj)?.[1];
    need(meta.crs === 'wgs84' && (known || dd) && (!datum || /^(?:WGS84|WGS_1984|D_WGS_1984)$/i.test(datum)) && !/PROJCS|PROJCRS/i.test(prj), 'Shapefile requires geographic WGS84 .prj; reproject explicitly outside this workflow');
    // Unlike the legacy reader, retain attributes and reject null/non-polygon records.
    collection = await shapefile.read(input);
  }
  need(collection?.type === 'FeatureCollection' && Array.isArray(collection.features) && collection.features.length, 'Expected non-empty FeatureCollection');
  const contentSha256 = sha256(stringify(collection));
  need(config.expected?.features === collection.features.length && config.expected?.contentSha256 === contentSha256, 'Complete dataset hash/count mismatch; subsets are forbidden');
  const ids = collection.features.filter(f => f?.id !== undefined).map(f => stringify(f.id));
  need(new Set(ids).size === ids.length, 'Duplicate feature IDs; resolve against the complete-source inventory');
  if (['cn-guangdong', 'cn-chongqing'].includes(meta.id)) {
    need(config.referenceReport, 'Pilot requires original pilot-report.json identity evidence');
    assertCompleteReference(collection, json(path.resolve(base, config.referenceReport)));
  }
  const topologyBudget = config.topologyBudget ?? 2_000_000;
  need(Number.isSafeInteger(topologyBudget) && topologyBudget > 0 && topologyBudget <= 100_000_000, 'topologyBudget must be an integer from 1 to 100000000');
  const policy = structural(collection, meta.crs, topologyBudget);
  const normalized = normalizeWinding(collection);
  const audit = geos(collection, normalized);
  const boundary = json(boundaryFile);
  const geometry = boundary.type === 'Feature' ? boundary.geometry : boundary;
  const boundaryCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
  need(structural(boundaryCollection, 'wgs84').valid, 'Boundary fails conservative policy');
  geos(boundaryCollection, normalizeWinding(boundaryCollection));
  // Also check boundary CRS declarations, never infer them from numeric ranges.
  need(!boundary.crs || ['EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326'].includes(boundary.crs?.properties?.name), 'Boundary must be WGS84');
  need(!boundary.coordinateSystem || ['WGS84', 'EPSG:4326'].includes(boundary.coordinateSystem), 'Boundary must be WGS84');
  const checks = config.pointChecks;
  need(Array.isArray(checks) && checks.length >= 2 && checks.some(c => c.inside === true) && checks.some(c => c.inside === false) && checks.every(c => Number.isFinite(c.lon) && Math.abs(c.lon) <= 180 && Number.isFinite(c.lat) && Math.abs(c.lat) <= 85 && typeof c.inside === 'boolean'), 'Require inside/outside pointChecks in WGS84, away from edges');
  const subject = { region: meta, synthetic: config.synthetic === true, inputFiles, contentSha256, features: collection.features.length, boundarySha256: digest(boundaryFile), pointChecks: checks };
  return { config, base, meta, input, boundaryFile, collection, normalized, policy, audit, subject, subjectSha256: sha256(stringify(subject)) };
}

export function approvalEvidence(ctx, now = new Date()) {
  need(ctx.config.synthetic !== true, 'Synthetic fixtures cannot be promoted');
  need(ctx.policy.valid, 'Unresolved conservative geometry/contact policy findings');
  need(ctx.meta.crsVerified === true, 'crsVerified must be explicitly true for promotion');
  need(ctx.config.approval, 'Explicit approval evidence required');
  const approval = json(path.resolve(ctx.base, ctx.config.approval));
  need(approval.subjectSha256 === ctx.subjectSha256, 'Approval subject mismatch (dataset/config/boundary/checks changed)');
  const today = now.toISOString().slice(0, 10);
  need(date(approval.validUntil) && approval.validUntil >= today && ctx.meta.source.effective <= today, 'Approval expired or dataset not yet effective');
  const evidence = {};
  for (const gate of gates) {
    const item = approval.gates?.[gate];
    need(item?.status === 'approved' && typeof item.reviewer === 'string' && item.reviewer.trim() && date(item.reviewedAt) && item.reviewedAt <= today && item.reviewedAt <= approval.validUntil && typeof item.evidence === 'string' && /^[a-f0-9]{64}$/.test(item.sha256), `Missing approval gate: ${gate}`);
    const file = path.resolve(ctx.base, item.evidence);
    need(digest(file) === item.sha256 && fs.statSync(file).size > 0, `Evidence hash mismatch: ${gate}`);
    evidence[gate] = { ...item, evidence: `evidence/${gate}${path.extname(file)}`, file };
  }
  return { approval, evidence };
}

// Only write under ignored planning/. No public/data, production sources or UI paths.
function safeOutput(out) {
  const target = path.resolve(out), allowed = path.join(ROOT, 'planning');
  need(target.startsWith(allowed + path.sep) && !fs.existsSync(target), 'Output must be a NEW directory under planning/');
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  need(fs.realpathSync(ancestor) === fs.realpathSync(ROOT) || fs.realpathSync(ancestor).startsWith(fs.realpathSync(ROOT) + path.sep), 'Output escapes repository via symlink');
  need(!fs.lstatSync(ancestor).isSymbolicLink() && fs.realpathSync(ancestor) === ancestor, 'Output symlink/junction forbidden');
  return target;
}

async function emit(ctx, operation, dir) {
  const { meta, normalized, subjectSha256, subject, policy, audit } = ctx;
  const publish = operation === 'promote';
  const approved = publish ? approvalEvidence(ctx) : null;
  if (operation !== 'stage') need(policy.valid, 'Unresolved conservative geometry/contact policy findings; stage only');
  const regionDir = path.join(dir, 'data/regions', meta.country, meta.id.slice(3));
  const source = { ...meta, format: 'geojson', file: 'zones.geojson', boundary: 'boundary.geojson', publish };
  write(path.join(regionDir, 'source.json'), source);
  write(path.join(regionDir, 'zones.geojson'), normalized);
  fs.copyFileSync(ctx.boundaryFile, path.join(regionDir, 'boundary.geojson'));
  // Preserve exact source bytes and shapefile sidecars separately from the derivative.
  for (const file of Object.keys(subject.inputFiles)) {
    const original = path.join(path.dirname(ctx.input), file);
    const dest = path.join(dir, 'original', file);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(original, dest);
  }
  let manifest = null, smoke = null;
  if (operation !== 'stage') {
    manifest = await buildRegion(meta.country, meta.id.slice(3), path.join(dir, 'tiles'), path.join(dir, 'data/regions'));
    need(manifest.cells === subject.features, 'Reader omitted source features');
    const { features } = await readRegion(regionDir, source);
    smoke = await pointSmoke(path.join(dir, 'tiles', manifest.file), { type: 'FeatureCollection', features }, ctx.config.pointChecks);
    write(path.join(dir, 'tiles', meta.country, 'manifest.json'), { regions: [manifest] });
    smoke.rendering = await renderSmoke(dir, manifest);
  }
  if (approved) {
    const { approval, evidence } = approved;
    for (const item of Object.values(evidence)) fs.copyFileSync(item.file, (() => { const p = path.join(dir, item.evidence); fs.mkdirSync(path.dirname(p), { recursive: true }); return p; })());
    write(path.join(dir, 'approval.json'), { ...approval, gates: Object.fromEntries(Object.entries(evidence).map(([k, { file, ...v }]) => [k, v])) });
  }
  // Catch source/evidence changes during a long build, before marking any candidate complete.
  for (const [file, hash] of Object.entries(subject.inputFiles)) need(digest(path.join(path.dirname(ctx.input), file)) === hash, 'Input changed during build');
  need(digest(ctx.boundaryFile) === subject.boundarySha256, 'Boundary changed during build');
  if (publish) approvalEvidence(ctx);
  write(path.join(dir, 'report.json'), { operation, active: false, subject, subjectSha256, normalizedSha256: sha256(stringify(normalized)),
    tools: { node: process.version, normalizerSha256: digest(import.meta.filename), geosAuditSha256: digest(path.join(import.meta.dirname, 'geos.py')) }, policy, audit, smoke, manifest,
    note: publish ? 'APPROVED REGISTRATION CANDIDATE ONLY. Review and publish through the existing deployment workflow.' : 'LOCAL ONLY. Never copy into production registration or public/data.' });
  if (manifest) write(path.join(dir, 'preview.html'), previewHTML({ type: 'FeatureCollection', features: (await readRegion(regionDir, source)).features }, { region: meta.id, integrationReady: false, status: 'Local integration smoke preview' }, manifest.bounds));
  // Hash every emitted file so an operator can check a reviewed candidate before copying.
  const hashes = {};
  const walk = p => { for (const item of fs.readdirSync(p, { withFileTypes: true })) { const file = path.join(p, item.name); if (item.isDirectory()) walk(file); else hashes[path.relative(dir, file).split(path.sep).join('/')] = digest(file); } };
  walk(dir); write(path.join(dir, 'checksums.json'), hashes);
  return { id: meta.id, operation, subjectSha256, policy, smoke, active: false };
}

export async function integrate(operation, files, { out, dryRun = false, requireApproved = false } = {}) {
  need(['stage', 'build', 'promote'].includes(operation), 'Use stage, build or promote');
  need(files.length, 'Supply at least one config');
  const contexts = [];
  for (const file of files) contexts.push(await inspect(file));
  need(new Set(contexts.map(c => c.meta.id)).size === contexts.length, 'Duplicate region in batch');
  for (const ctx of contexts) {
    if (operation !== 'stage') need(ctx.policy.valid, 'Unresolved conservative geometry/contact policy findings; stage only');
    if (operation === 'promote' || requireApproved) approvalEvidence(ctx);
  }
  const preview = contexts.map(c => ({ id: c.meta.id, operation, subjectSha256: c.subjectSha256, features: c.subject.features, policy: c.policy, active: false }));
  if (dryRun) return preview;
  need(out, '--out planning/<new-directory> is required');
  const target = safeOutput(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  try {
    const results = [];
    for (const ctx of contexts) results.push(await emit(ctx, operation, contexts.length === 1 ? target : path.join(target, ctx.meta.id)));
    // Only this final marker makes an offline candidate complete. No app index is written.
    write(path.join(target, 'COMPLETE.json'), results);
    return results;
  } catch (e) { fs.rmSync(target, { recursive: true, force: true }); throw e; }
}

export async function main(args) {
  const operation = args.shift(), files = [];
  let out, dryRun = false, requireApproved = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--out') { out = args.shift(); need(out && !out.startsWith('--'), '--out needs a path'); }
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--approved') requireApproved = true;
    else { need(!arg.startsWith('-'), `Unknown option ${arg}`); files.push(arg); }
  }
  return integrate(operation, files, { out, dryRun, requireApproved });
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
