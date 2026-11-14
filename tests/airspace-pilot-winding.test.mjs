// Optional real-source regression: AIRSPACE_REFERENCE_ROOT=<local-pilots> node --test tests/airspace-pilot-winding.test.mjs
// Raw reference geometry is intentionally untracked; no derivative or tiles are emitted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeWinding } from '../scripts/airspace/integrate.mjs';
import { assertCompleteReference } from '../scripts/china-airspace/artifact-contract.js';
import { sha256 } from '../scripts/china-airspace/core.js';

for (const [id, count] of [['cn-guangdong', 101], ['cn-chongqing', 777]]) {
  test(`${id}: all complete-reference geometries, including flagged contacts, preserve topology and coordinates`, { skip: !process.env.AIRSPACE_REFERENCE_ROOT }, () => {
    const dir = path.join(process.env.AIRSPACE_REFERENCE_ROOT, id);
    const file = path.join(dir, 'deduplicated-reference.geojson'), bytes = fs.readFileSync(file);
    const before = JSON.parse(bytes), report = JSON.parse(fs.readFileSync(path.join(dir, 'pilot-report.json'), 'utf8'));
    assertCompleteReference(before, report);
    const after = normalizeWinding(before);
    assert.equal(after.features.length, count);
    const run = spawnSync(process.env.AIRSPACE_PYTHON || 'python', [path.resolve(import.meta.dirname, '../scripts/airspace/geos.py')], {
      input: JSON.stringify({ before, after }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    assert.equal(JSON.parse(run.stdout).features, count);
    assert.equal(sha256(fs.readFileSync(file)), sha256(bytes));
  });
}
