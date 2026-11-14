import fs from 'node:fs';
import path from 'node:path';
import { partition, stringify, sha256, normalize, compareResponses, validBox } from './core.js';
import { intersectsBox } from './geometry.js';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}
export function makePlan(config, configDir, { archivedPlan = null } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(config.id ?? '')) throw new Error('Missing or invalid region id');
  if (!validBox(config.bbox)) throw new Error('Missing or invalid bbox');
  const boundary = config.boundaryFile ? read(path.resolve(configDir, config.boundaryFile)) : null;
  const geometry = boundary?.type === 'Feature' ? boundary.geometry : boundary;
  const tiles = partition(config.bbox, { ...config.partition, boundary: geometry });
  if (!tiles.length) throw new Error('Boundary does not intersect query area');
  let requests;
  if (config.localFiles) {
    if (!Array.isArray(config.localFiles) || !config.localFiles.length || config.localFiles.length > 64) throw new Error('Expected 1 to 64 local files');
    requests = config.localFiles.map((source, i) => {
      const file = path.resolve(configDir, source.file);
      if (source.bbox && !validBox(source.bbox)) throw new Error('Invalid local response bbox');
      const previous = archivedPlan?.requests?.find(x => x.key === `local-${i}` && x.file === file);
      const inputSha256 = fs.existsSync(file) ? sha256(fs.readFileSync(file)) : previous?.inputSha256;
      if (!/^[a-f0-9]{64}$/.test(inputSha256 ?? '')) throw new Error(`Local source unavailable and no archived identity: ${file}`);
      return { key: `local-${i}`, file, bbox: source.bbox ?? null, inputSha256 };
    });
  } else {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || [...endpoint.searchParams.keys()].some(k => /token|key|secret|password/i.test(k))) throw new Error('Use a public HTTPS endpoint without credentials');
    requests = tiles.map(t => {
      const url = new URL(endpoint);
      for (const [i, name] of ['west', 'south', 'east', 'north'].entries()) url.searchParams.set(name, String(t.bbox[i]));
      return { key: t.key, bbox: t.bbox, core: t.core, url: url.href };
    });
  }
  // Local paths are part of the checkpoint identity; output geometry hashes are path independent.
  const fingerprint = sha256(stringify({ config, boundary, requests }));
  return { schemaVersion: 1, region: config.id, fingerprint, boundarySha256: boundary ? sha256(stringify(boundary)) : null, requests };
}
function permission(config, count) {
  const p = config.access;
  if (p?.status !== 'permitted' || !p.evidence || !p.checkedOn || !Number.isInteger(p.maxRequests) || count > p.maxRequests || p.maxRequests > 64) throw new Error('Live acquisition blocked: documented access permission and an explicit request budget (<=64) are required; use localFiles instead');
  if (config.responsePolicy?.pagination !== 'none' || config.responsePolicy?.wholeFeatures !== true || !config.responsePolicy?.evidence) throw new Error('Live acquisition blocked: unverified pagination/whole-feature contract; use local response files');
}
async function limitedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('response-size-limit'); }
  const buffers = [];
  let length = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('response-size-limit');
    buffers.push(Buffer.from(chunk));
  }
  return Buffer.concat(buffers);
}
export async function acquire(config, configDir, outDir, { dryRun = false, validationOnly = false, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => new Date().toISOString() } = {}) {
  const oldPlanFile = path.join(outDir, 'plan.json');
  const plan = makePlan(config, configDir, { archivedPlan: validationOnly && fs.existsSync(oldPlanFile) ? read(oldPlanFile) : null });
  if (dryRun) return { plan, networkRequests: 0 };
  if (!config.localFiles && !validationOnly) permission(config, plan.requests.length);
  const intervalMs = config.transport?.intervalMs ?? 3000, attempts = config.transport?.attempts ?? 3;
  const maxBytes = config.transport?.maxBytes ?? 25_000_000, timeoutMs = config.transport?.timeoutMs ?? 30_000;
  if (!Number.isFinite(intervalMs) || intervalMs < 2500 || !Number.isInteger(attempts) || attempts < 1 || attempts > 4 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000_000 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid transport limits');
  const stateFile = path.join(outDir, 'checkpoint.json');
  if (validationOnly && !fs.existsSync(stateFile)) throw new Error('Validation-only needs an existing acquisition checkpoint');
  fs.mkdirSync(outDir, { recursive: true });
  const lock = path.join(outDir, 'acquisition.lock');
  const fd = fs.openSync(lock, 'wx');
  fs.writeFileSync(fd, `${process.pid}\n`);
  try {
    const state = fs.existsSync(stateFile) ? read(stateFile) : { schemaVersion: 1, fingerprint: plan.fingerprint, networkRequests: 0, responses: {} };
    if (state.fingerprint !== plan.fingerprint) throw new Error('Checkpoint does not match configuration/input checksums; use a new output directory');
    if (state.nextAllowedAt && Date.parse(state.nextAllowedAt) > Date.parse(now()) && !validationOnly) throw new Error(`Server backoff active until ${state.nextAllowedAt}`);
    const log = event => fs.appendFileSync(path.join(outDir, 'acquisition.jsonl'), JSON.stringify({ at: now(), ...event }) + '\n');
    const archive = path.join(outDir, 'responses');
    const collections = [], entries = [], failed = [];
    writeJson(path.join(outDir, 'plan.json'), plan);
    for (const request of plan.requests) {
      let entry = state.responses[request.key], raw;
      if (entry) {
        // Filenames are derived from our plan, never trusted from a checkpoint.
        const file = path.join(archive, `${request.key}.json`);
        raw = fs.readFileSync(file);
        if (sha256(raw) !== entry.sha256) throw new Error(`Archive checksum mismatch: ${request.key}`);
        log({ event: 'cache-hit', key: request.key, sha256: entry.sha256 });
      } else {
        if (validationOnly) { failed.push({ key: request.key, reason: 'missing-response' }); continue; }
        if (request.file) raw = fs.readFileSync(request.file);
        else {
          for (let attempt = 1; attempt <= attempts; attempt++) {
            if ((state.networkRequests ?? 0) >= config.access.maxRequests) throw new Error('Total HTTP request budget exhausted (including retries and previous attempts); review before starting a new acquisition');
            await sleep(intervalMs); // includes the first request and every retry/resume
            const started = now();
            let response;
            try {
              state.networkRequests = (state.networkRequests ?? 0) + 1;
              writeJson(stateFile, state);
              response = await fetchImpl(request.url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/geo+json, application/json', 'User-Agent': 'uav-companion-data-review/1.0' } });
            } catch (e) {
              log({ event: 'network-error', key: request.key, attempt, message: e.message });
              if (attempt === attempts) throw e;
              await sleep(Math.min(60_000, 3000 * 2 ** (attempt - 1))); continue;
            }
            const retryAfter = response.headers.get('retry-after');
            log({ event: 'http-response', key: request.key, attempt, status: response.status, started, retryAfter });
            if ([401, 403, 429].includes(response.status) || (response.status >= 300 && response.status < 400)) {
              const seconds = retryAfter === null ? NaN : Number(retryAfter);
              state.nextAllowedAt = new Date(Math.max(Date.parse(now()) + 60_000, Number.isFinite(seconds) ? Date.parse(now()) + seconds * 1000 : Date.parse(retryAfter) || 0)).toISOString();
              writeJson(stateFile, state); await response.body?.cancel();
              throw new Error(`Acquisition stopped on access/rate-limit/redirect response HTTP ${response.status}; review provider conditions before resuming`);
            }
            if (!response.ok) {
              await response.body?.cancel();
              if (response.status < 500 || attempt === attempts) throw new Error(`HTTP ${response.status}`);
              const seconds = retryAfter === null ? NaN : Number(retryAfter);
              const retryMs = Math.max(3000 * 2 ** (attempt - 1), Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.parse(now()) || 0);
              if (retryMs > 60_000) { state.nextAllowedAt = new Date(Date.parse(now()) + retryMs).toISOString(); writeJson(stateFile, state); throw new Error('Long server backoff recorded; resume later'); }
              await sleep(retryMs); continue;
            }
            const contentType = response.headers.get('content-type') ?? '';
            raw = await limitedBody(response, maxBytes);
            entry = { acquiredAt: now(), status: response.status, contentType, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
            break;
          }
        }
        if (raw.length > maxBytes) throw new Error('response-size-limit');
        fs.mkdirSync(archive, { recursive: true });
        fs.writeFileSync(path.join(archive, `${request.key}.json`), raw);
        entry = { ...entry, sha256: sha256(raw), bytes: raw.length, acquiredAt: entry?.acquiredAt ?? now(), bbox: request.bbox, ...(request.url ? { url: request.url } : { inputSha256: request.inputSha256 }) };
        state.responses[request.key] = entry;
        writeJson(stateFile, state); // archive even invalid JSON; validation failure is never silently retried
        log({ event: 'archived', key: request.key, ...entry });
      }
      try {
        const collection = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
        collections.push(collection); entries.push({ request, entry });
      } catch { failed.push({ key: request.key, reason: 'invalid-json' }); }
    }
    const result = normalize(collections, config.validation);
    const cap = config.responsePolicy?.featureLimit;
    if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('Invalid response feature limit');
    const atLimit = collections.map((c, i) => cap && c?.features?.length >= cap ? entries[i].request.key : null).filter(Boolean);
    const consistency = [];
    for (let i = 0; i < collections.length; i++) for (let j = 0; j < i; j++) {
      const a = entries[i].request.bbox, b = entries[j].request.bbox;
      if (a && b && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) consistency.push({ a: entries[i].request.key, b: entries[j].request.key, ...compareResponses(collections[i], a, collections[j], b, config.validation) });
    }
    const outOfBounds = result.geojson.features.filter(f => !intersectsBox(f.geometry, config.bbox)).map(f => f.id ?? sha256(stringify(f.geometry)));
    const report = { schemaVersion: 1, region: config.id, fingerprint: plan.fingerprint, outputSha256: result.sha256, queryBounds: plan.requests.map(x => x.bbox).filter(Boolean), technical: result.report, acquisition: { expected: plan.requests.length, archived: entries.length, networkRequests: state.networkRequests ?? 0, acquiredDates: [...new Set(entries.map(x => x.entry.acquiredAt.slice(0, 10)))].sort(), failed, atFeatureLimit: atLimit, outOfBounds, allPlannedResponsesPresent: !failed.length && entries.length === plan.requests.length, consistency, provincialCompleteness: 'unverified', boundary: plan.boundarySha256 ? 'query-filter-only' : 'approximate-bbox-only', clippingBehavior: config.responsePolicy?.wholeFeatures === true ? 'declared-whole-features' : 'unknown' }, quality: config.quality ?? 'unverified-reference', provenance: config.provenance ?? {}, regulatoryValidity: 'unverified', integrationReady: false, blockers: [] };
    report.blockers = [
      ...(!result.report.valid ? ['technical-validation-failed'] : []),
      ...(failed.length ? ['missing-or-invalid-responses'] : []), ...(atLimit.length ? ['possible-response-truncation'] : []), ...(outOfBounds.length ? ['unexpected-geography'] : []),
      ...(consistency.some(x => x.status !== 'consistent-sample') ? ['overlap-reproducibility-unproven'] : []),
      'semantics-not-reviewed', 'crs-alignment-not-verified', 'provincial-completeness-not-established', 'effective-date-not-verified', 'redistribution-not-cleared',
    ];
    writeJson(path.join(outDir, 'normalized.geojson'), result.geojson);
    writeJson(path.join(outDir, 'report.json'), report);
    log({ event: 'validation-finished', valid: result.report.valid, outputSha256: result.sha256, blockers: report.blockers });
    return { plan, report, geojson: result.geojson };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
