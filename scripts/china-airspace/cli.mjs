import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquire, makePlan, writeJson } from './acquire.js';
import { normalize, compareResponses } from './core.js';
import { previewHTML } from './preview.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
// Resolve symlinks/junctions too: a staging command must never write through into production.
export function stagingDirectory(value) {
  const wanted = path.resolve(value);
  let parent = wanted, tail = [];
  while (!fs.existsSync(parent)) { tail.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) break; parent = next; }
  const resolved = path.resolve(fs.realpathSync(parent), ...tail);
  const allowed = path.join(fs.realpathSync(ROOT), 'planning', 'china-airspace');
  const rel = path.relative(allowed, resolved);
  if (rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) return resolved;
  throw new Error('Output must be under planning/china-airspace (ignored, outside production data)');
}
const HELP = `China airspace staging tools (Node 24; no production registration)
  node scripts/china-airspace/cli.mjs acquire CONFIG [--dry-run|--validation-only] [--out DIRECTORY]
  node scripts/china-airspace/cli.mjs validate FILE --crs wgs84|gcj02 [--id-property NAME] [--out DIRECTORY]
  node scripts/china-airspace/cli.mjs compare FILE_A FILE_B --bbox-a W,S,E,N --bbox-b W,S,E,N --crs wgs84|gcj02
  node scripts/china-airspace/cli.mjs pilot CONFIG [--out DIRECTORY]
All output directories must be under planning/china-airspace. Pilot produces a blocked report/preview when no archived fixture is available. No command promotes or publishes data.`;
export async function main(args) {
  const positional = [], flags = {};
  const boolean = new Set(['dry-run', 'validation-only', 'help']);
  const values = new Set(['out', 'crs', 'id-property', 'bbox-a', 'bbox-b']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) positional.push(a);
    else {
      const k = a.slice(2);
      if (k in flags || (!boolean.has(k) && !values.has(k))) throw new Error(`Unknown/duplicate flag ${a}`);
      flags[k] = boolean.has(k) ? true : args[++i];
      if (flags[k] === undefined || (typeof flags[k] === 'string' && flags[k].startsWith('--'))) throw new Error(`Missing value for ${a}`);
    }
  }
  if (flags.help || !positional.length) { console.log(HELP); return; }
  const [command, file, second] = positional;
  if (!file || positional.length !== (command === 'compare' ? 3 : 2)) throw new Error(HELP);
  if (flags['dry-run'] && flags['validation-only']) throw new Error('Choose dry-run or validation-only');
  if (command !== 'acquire' && (flags['dry-run'] || flags['validation-only'])) throw new Error('dry-run and validation-only are supported by acquire only');
  const out = stagingDirectory(flags.out ?? path.join(ROOT, 'planning/china-airspace', command === 'validate' ? 'validation' : path.basename(file, '.json')));
  const options = { crs: flags.crs ?? 'unknown', idProperty: flags['id-property'] };
  if (command === 'acquire' || command === 'pilot') {
    const configPath = path.resolve(file), config = read(configPath), dir = path.dirname(configPath);
    if (command === 'pilot') {
      const reportPath = path.join(out, 'report.json');
      if (config.localFiles || fs.existsSync(path.join(out, 'checkpoint.json'))) {
        const result = await acquire(config, dir, out, { validationOnly: fs.existsSync(path.join(out, 'checkpoint.json')) });
        fs.writeFileSync(path.join(out, 'preview.html'), previewHTML(result.geojson, result.report, config.bbox));
        if (!result.report.technical.valid || result.report.acquisition.failed.length || result.report.acquisition.atFeatureLimit.length || result.report.acquisition.outOfBounds.length || result.report.acquisition.consistency.some(x => x.status !== 'consistent-sample')) process.exitCode = 2;
        console.log(JSON.stringify(result.report, null, 2)); return;
      }
      const plan = makePlan(config, dir);
      const report = { schemaVersion: 1, region: config.id, checkedOn: config.checkedOn, status: 'blocked-no-source-fixture', quality: config.quality, provenance: config.provenance, queryBounds: plan.requests.map(x => x.bbox), technical: { valid: null, geometry: 'not-tested', crsAlignment: 'unverified' }, overlapReproduction: 'not-tested', provincialCompleteness: 'unverified', regulatoryValidity: 'unverified', integrationReady: false, blockers: ['No previously obtained GeoJSON located in repository or Downloads', 'Live API permission/limits are unverified; automated acquisition disabled', 'Semantics, CRS alignment, geometry and provincial completeness require source evidence', 'Redistribution and effective date not established'] };
      writeJson(reportPath, report); fs.writeFileSync(path.join(out, 'preview.html'), previewHTML({ type: 'FeatureCollection', features: [] }, report, config.bbox));
      console.log(JSON.stringify(report, null, 2)); return;
    }
    const result = await acquire(config, dir, out, { dryRun: flags['dry-run'], validationOnly: flags['validation-only'] });
    if (result.report) fs.writeFileSync(path.join(out, 'preview.html'), previewHTML(result.geojson, result.report, config.bbox));
    console.log(JSON.stringify(result.report ?? result, null, 2));
    if (result.report && (!result.report.technical.valid || result.report.acquisition.failed.length || result.report.acquisition.atFeatureLimit.length || result.report.acquisition.outOfBounds.length || result.report.acquisition.consistency.some(x => x.status !== 'consistent-sample'))) process.exitCode = 2;
  } else if (command === 'validate') {
    const result = normalize([read(file)], options);
    writeJson(path.join(out, 'normalized.geojson'), result.geojson); writeJson(path.join(out, 'report.json'), { ...result.report, outputSha256: result.sha256 });
    console.log(JSON.stringify({ ...result.report, outputSha256: result.sha256 }, null, 2));
    if (!result.report.valid) process.exitCode = 2;
  } else if (command === 'compare') {
    const box = k => flags[k]?.split(',').map(Number);
    const result = compareResponses(read(file), box('bbox-a'), read(second), box('bbox-b'), options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'consistent-sample') process.exitCode = 2;
  } else throw new Error(HELP);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
