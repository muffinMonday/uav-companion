// Express KDji province acquisition: serial, cached, bounded windows -> deduplicated original-feature union -> GEOS check -> region source files.
//   node scripts/airspace/kdji-express.mjs <provinceId> <west,south,east,north> [--grid N] [--dry-run]
// Never clips, simplifies or repairs geometry. Stops on any redirect/4xx/5xx/rate-limit response. One full-envelope request plus an NxN overlapping grid.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeWinding } from './integrate.mjs';
import { sha256, stringify } from '../china-airspace/core.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const [province, envArg] = args;
const gridArg = args.includes('--grid') ? Number(args[args.indexOf('--grid') + 1]) : 0;
const dry = args.includes('--dry-run');
if (!province || !envArg) throw new Error('usage: kdji-express.mjs <province> <w,s,e,n> [--grid N]');
const env = envArg.split(',').map(Number);
const SPACING_MS = 3000, TIMEOUT_MS = 60000, MAX_BYTES = 25_000_000;
const out = path.join(ROOT, 'planning/express-nationwide', province);
fs.mkdirSync(path.join(out, 'responses'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 1e5) / 1e5;

// plan: key "all" then grid cells expanded by 5% of the cell size, clamped to the envelope
const [W, S, E, N] = env;
const grid = gridArg || Math.max(3, Math.ceil(Math.max(E - W, N - S) / 3.2));
const cw = (E - W) / grid, ch = (N - S) / grid;
const requests = [{ key: 'all', bbox: env }];
for (let r = 0; r < grid; r++) for (let c = 0; c < grid; c++) {
  requests.push({ key: `${r}-${c}`, bbox: [round(Math.max(W, W + c * cw - cw * .05)), round(Math.max(S, S + r * ch - ch * .05)), round(Math.min(E, W + (c + 1) * cw + cw * .05)), round(Math.min(N, S + (r + 1) * ch + ch * .05))] });
}
for (const q of requests) q.url = `https://kdji.cn/nfz-api.php?action=uom&province=${province}&west=${q.bbox[0]}&south=${q.bbox[1]}&east=${q.bbox[2]}&north=${q.bbox[3]}`;
fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ province, envelope: env, grid, requests }, null, 2));
if (dry) { console.log(requests.length + ' requests planned'); process.exit(0); }

const log = (o) => fs.appendFileSync(path.join(out, 'acquisition.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const meta = {};
for (const q of requests) {
  const file = path.join(out, 'responses', q.key + '.json'), mfile = file + '.meta';
  if (fs.existsSync(file) && fs.existsSync(mfile)) { meta[q.key] = JSON.parse(fs.readFileSync(mfile, 'utf8')); continue; }
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(q.url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'uav-companion-airspace-acquisition/1.0 (owner-authorized)' } });
      break;
    } catch (e) {
      log({ key: q.key, attempt, error: String(e) });
      if (attempt >= 3) throw new Error(`network failure ${province}/${q.key}: ${e}`);
      await sleep(SPACING_MS * 2 ** attempt);
    }
  }
  if (res.status === 422 && q.key === 'all') {
    const body = await res.text();
    if (!/tooWide/.test(body)) throw new Error('unexpected 422 body');
    const m = { status: 422, tooWide: true, bytes: body.length, sha256: sha256(Buffer.from(body)), retrievedAt: new Date().toISOString(), bbox: q.bbox, url: q.url };
    fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [], provinceId: province, tooWide: true })); fs.writeFileSync(mfile, JSON.stringify({ ...m, sha256: sha256(fs.readFileSync(file)) }));
    meta[q.key] = JSON.parse(fs.readFileSync(mfile, 'utf8')); log({ key: q.key, status: 422, tooWide: true }); await sleep(SPACING_MS); continue;
  }
  if (res.status !== 200) { log({ key: q.key, status: res.status }); throw new Error(`HTTP ${res.status} for ${province}/${q.key}; stopping`); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`response over ${MAX_BYTES} bytes for ${province}/${q.key}`);
  const m = { status: 200, bytes: buf.length, sha256: sha256(buf), contentType: res.headers.get('content-type'), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), retrievedAt: new Date().toISOString(), bbox: q.bbox, url: q.url };
  fs.writeFileSync(file, buf); fs.writeFileSync(mfile, JSON.stringify(m));
  meta[q.key] = m; log({ key: q.key, status: 200, bytes: buf.length });
  await sleep(SPACING_MS);
}

// parse, validate envelope contract
const captures = requests.map((q) => {
  const bytes = fs.readFileSync(path.join(out, 'responses', q.key + '.json'));
  if (sha256(bytes) !== meta[q.key].sha256) throw new Error('checksum mismatch ' + q.key);
  const c = JSON.parse(bytes);
  if (c.type !== 'FeatureCollection' || !Array.isArray(c.features)) throw new Error('not a FeatureCollection: ' + q.key);
  if (c.provinceId !== province) throw new Error(`provinceId ${c.provinceId} != ${province}`);
  if (c.coordinateSystem && c.coordinateSystem !== 'WGS84') throw new Error('CRS ' + c.coordinateSystem);
  for (const k of ['truncated', 'hasMore', 'next', 'nextPage']) if (c[k]) throw new Error(`pagination marker ${k} in ${q.key}`);
  return { key: q.key, c };
});
const real = captures.filter((x) => !x.c.tooWide);
const first = real[0].c;
const snapshots = new Set(real.map((x) => x.c.snapshotFetchedAt));
const byId = new Map(), perCapture = {}, conflicts = [], missingIds = [];
let occurrences = 0;
for (const { key, c } of captures) {
  perCapture[key] = new Set();
  for (const f of c.features) {
    occurrences++;
    const id = f.properties?.id;
    if (!id) { missingIds.push(key); continue; }
    perCapture[key].add(id);
    const s = stringify(f);
    if (byId.has(id)) { if (byId.get(id).s !== s) conflicts.push(id); } else byId.set(id, { f, s });
  }
}
const unionIds = new Set(byId.keys());
const gridUnion = new Set(); for (const { key } of captures) if (key !== 'all') for (const id of perCapture[key]) gridUnion.add(id);
const allRefused = !!meta.all.tooWide;
const allOnly = [...perCapture.all].filter((id) => !gridUnion.has(id)), gridOnly = allRefused ? [] : [...gridUnion].filter((id) => !perCapture.all.has(id));
const report = { province, provinceName: first.province, publishDate: first.publishDate, snapshots: [...snapshots], envelope: env, grid, requests: requests.length, occurrences, uniquePolygons: unionIds.size,
  conflicts, missingIds: missingIds.length, fullEnvelopeRefusedTooWide: allRefused, fullEnvelopeCount: perCapture.all.size, gridUnionCount: gridUnion.size, fullVsGridOnlyFull: allOnly, fullVsGridOnlyGrid: gridOnly,
  captures: requests.map((q) => ({ key: q.key, bbox: q.bbox, features: perCapture[q.key].size, ...meta[q.key] })) };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
if (conflicts.length || missingIds.length || snapshots.size !== 1) throw new Error(`blocking acquisition findings: ${JSON.stringify({ conflicts: conflicts.length, missing: missingIds.length, snapshots: snapshots.size })}`);
if (allOnly.length || gridOnly.length) throw new Error(`full-envelope and grid unions differ (${allOnly.length}/${gridOnly.length}): refine the plan`);
if (!unionIds.size) { console.log(JSON.stringify({ province, status: 'no-features', occurrences })); process.exit(0); }

// union in a stable order
const source = { type: 'FeatureCollection', coordinateSystem: 'WGS84', features: [...byId.values()].map((x) => x.f) };
const py = process.env.AIRSPACE_PYTHON || 'python';
const audit = spawnSync(py, [path.join(ROOT, 'scripts/airspace/geos.py')], { input: JSON.stringify({ before: source, after: normalizeWinding(source), includeInteriorWitnesses: true }), encoding: 'utf8', maxBuffer: 1 << 30 });
if (audit.status !== 0) throw new Error('GEOS audit failed: ' + (audit.stderr || audit.error));
const geos = JSON.parse(audit.stdout);
const summary = { valid: geos.valid, ...Object.fromEntries(Object.entries(geos).filter(([, v]) => typeof v !== 'object' || v === null).slice(0, 12)) };
report.geos = { valid: geos.valid, summary, issues: geos.valid ? [] : (geos.issues ?? geos.errors ?? geos) };
fs.writeFileSync(path.join(out, 'geos.json'), JSON.stringify(geos));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
if (!geos.valid) { console.log(JSON.stringify({ province, status: 'geos-invalid' })); process.exit(2); }

const zones = JSON.stringify(source, null, 2) + '\n';
const regionDir = path.join(ROOT, 'data/regions/cn', province);
fs.mkdirSync(regionDir, { recursive: true });
fs.writeFileSync(path.join(regionDir, 'zones.geojson'), zones);
const pub = /(\d{4})\D+(\d{1,2})/.exec(first.publishDate ?? '');
const src = {
  id: 'cn-' + province, country: 'cn', name: process.env.REGION_NAME, nameZh: first.province, format: 'geojson', crs: 'wgs84', crsVerified: false, semantics: 'allow', maxHeightM: null,
  coverageMode: 'positive-only',
  sourceConfidence: { mode: 'selected-source', type: 'third-party-uom-snapshot', alignment: 'declared-only', completeness: 'unverified', currency: 'unverified', temporaryRestrictions: 'not-included', flightPermission: 'unverified', rightsBasis: 'owner-attested-project-authorization' },
  source: { authority: 'KDji third-party UOM reference mirror', url: 'https://kdji.cn/support/nfz-map.html', effective: null, publishedMonth: pub ? `${pub[1]}-${pub[2].padStart(2, '0')}` : null, snapshotAt: [...snapshots][0], contentSha256: sha256(stringify(source)), acquiredOn: new Date().toISOString().slice(0, 10) },
  license: 'LicenseRef-OwnerAttested-KDji-Project', officialMap: { label: 'Verify with UOM', url: 'https://uom.caac.gov.cn/' }, file: 'zones.geojson', publish: true,
};
if (!src.name) throw new Error('set REGION_NAME');
fs.writeFileSync(path.join(regionDir, 'source.json'), JSON.stringify(src, null, 2) + '\n');
console.log(JSON.stringify({ province, status: 'ready', requests: requests.length, occurrences, uniquePolygons: unionIds.size, geosValid: true }));
