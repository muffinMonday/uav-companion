// Production airspace data checks: validate a data tree, compare it with what is published, restore regions a stale checkout lacks.
// A "data tree" is the folder holding index.json, <country>/manifest.json and the hashed region files (public/data, dist/data, or the published site's data/).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha8 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const refsOf = (r) => [r.file, r.boundary, r.points].filter(Boolean);

// Files carry the first 8 hex digits of their sha256 as `<name>.<hash>.<ext>`; the hash is checked against the bytes.
export function checkArtifact(dir, rel) {
  const p = path.join(dir, rel);
  if (!fs.existsSync(p)) return `${rel}: referenced but missing`;
  const m = /\.([0-9a-f]{8})\.(pmtiles|json)$/.exec(rel);
  if (!m) return `${rel}: file name carries no content hash`;
  const got = sha8(fs.readFileSync(p));
  return got === m[1] ? null : `${rel}: content hash ${got} does not match the name`;
}

// Reads a tree and reports everything wrong with it. Returns { errors, index, countries: Map(id -> manifest), regions: Map(id -> {region, country}) }.
export function inspectTree(dir) {
  const errors = [], countries = new Map(), regions = new Map();
  let index = null;
  try { index = readJson(path.join(dir, 'index.json')); } catch (e) { errors.push(`index.json: ${e.code === 'ENOENT' ? 'missing' : 'unreadable'}`); return { errors, index, countries, regions }; }
  for (const c of index.countries ?? []) {
    if (!c.manifest) { if (c.regions) errors.push(`${c.id}: index lists ${c.regions} regions but no manifest`); continue; }
    let m;
    try { m = readJson(path.join(dir, c.manifest)); } catch { errors.push(`${c.manifest}: missing or unreadable`); continue; }
    countries.set(c.id, m);
    if (m.country?.id !== c.id) errors.push(`${c.manifest}: country id ${m.country?.id} is not ${c.id}`);
    if ((m.regions ?? []).length !== c.regions) errors.push(`${c.id}: index says ${c.regions} regions, manifest has ${(m.regions ?? []).length}`);
    for (const r of m.regions ?? []) {
      if (regions.has(r.id)) errors.push(`${r.id}: listed twice`);
      regions.set(r.id, { region: r, country: c.id });
      if (!r.id.startsWith(c.id + '-')) errors.push(`${r.id}: not in country ${c.id}`);
      if (!r.file) errors.push(`${r.id}: no tile file`);
      for (const f of refsOf(r)) { const e = checkArtifact(dir, f); if (e) errors.push(`${r.id}: ${e}`); }
    }
  }
  return { errors, index, countries, regions };
}

// `removed-regions.json`: { "removed": [{ "id", "reason", "approvedBy", "date", "replacementId"? }] }.
// Only entries with every required field count; optional replacementId requires an atomic replacement. Reviewed in git.
export function readRemovals(file) {
  let list = [];
  try { list = readJson(file).removed ?? []; } catch { /* no file: nothing may be removed */ }
  return new Map(list.filter((x) => x?.id && x.reason && x.approvedBy && x.date).map((x) => [x.id, x]));
}

const stamp = (r) => r.source?.snapshotAt ?? r.source?.effective ?? null;

// Errors for anything the candidate would take away from, or roll back on, the published site.
export function compareToProduction(cand, prod, removals = new Map()) {
  const errors = [];
  for (const [id, approval] of removals) {
    if (!cand.regions.has(id) && approval.replacementId && !cand.regions.has(approval.replacementId)) errors.push(`${id}: approved replacement ${approval.replacementId} is missing from the candidate`);
  }
  for (const [id, { region: pr }] of prod.regions) {
    const c = cand.regions.get(id);
    if (!c) { if (!removals.has(id)) errors.push(`${id}: published but missing from the candidate (not listed in removed-regions.json)`); continue; }
    if (c.region.file !== pr.file) {
      const [a, b] = [stamp(c.region), stamp(pr)];
      if (a && b && a < b) errors.push(`${id}: candidate source ${a} is older than the published ${b} (stale build)`);
    }
  }
  for (const id of removals.keys()) if (!prod.regions.has(id)) errors.push(`${id}: listed as removed but not published (stale entry in removed-regions.json)`);
  return errors;
}

// Copies regions the published site has and this tree lacks (except approved removals), then fixes manifests and index. Returns the region ids restored.
export function restoreMissing(dir, prodDir, removals = new Map()) {
  const prod = inspectTree(prodDir);
  if (prod.errors.length) throw new Error('published data is itself invalid:\n  ' + prod.errors.join('\n  '));
  const cand = inspectTree(dir);
  const restored = [];
  const index = cand.index ?? { generated: prod.index.generated, countries: [] };
  for (const pc of prod.index.countries) {
    const have = cand.countries.get(pc.id);
    const pm = prod.countries.get(pc.id);
    if (!pm) { if (!index.countries.some((c) => c.id === pc.id)) index.countries.push({ ...pc }); continue; }
    const missing = pm.regions.filter((r) => !cand.regions.has(r.id) && !removals.has(r.id));
    if (!missing.length) continue;
    const manifest = have ?? { country: pm.country, generated: pm.generated, regions: [] };
    for (const r of missing) {
      for (const f of refsOf(r)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(prodDir, f), path.join(dir, f)); }
      manifest.regions.push(r); restored.push(r.id);
    }
    manifest.regions.sort((a, b) => a.id.localeCompare(b.id));
    fs.mkdirSync(path.join(dir, pc.id), { recursive: true });
    fs.writeFileSync(path.join(dir, pc.manifest), JSON.stringify(manifest, null, 2) + '\n');
    const entry = index.countries.find((c) => c.id === pc.id);
    if (entry) { entry.regions = manifest.regions.length; entry.manifest = pc.manifest; }
    else index.countries.push({ ...pc, regions: manifest.regions.length });
  }
  if (restored.length) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  return restored;
}
