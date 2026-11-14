// Real browser tests of the application point checker, metadata wording and initial fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { buildTiles } from '../scripts/lib/tiles.js';
import { writePMTiles } from '../scripts/lib/pmtiles-writer.js';

test('selected snapshots never classify gaps, missing tiles or unknown footprint as controlled', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const dir = fs.mkdtempSync(path.join(root, 'planning/selected-runtime-'));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/airspace/zones.geojson')));
  const bounds = [103, 1, 103.16, 1.1];
  fs.writeFileSync(path.join(dir, 'zones.pmtiles'), writePMTiles({ tiles: buildTiles(source.features, bounds), bounds, minZoom: 3, maxZoom: 14, metadata: { vector_layers: [{ id: 'zones', fields: {} }] } }));
  const filled = structuredClone(source);
  for (const f of filled.features) f.geometry.coordinates = f.geometry.type === 'Polygon' ? f.geometry.coordinates.slice(0, 1) : f.geometry.coordinates.map(p => p.slice(0, 1));
  fs.writeFileSync(path.join(dir, 'filled.pmtiles'), writePMTiles({ tiles: buildTiles(filled.features, bounds), bounds, minZoom: 3, maxZoom: 14, metadata: { vector_layers: [{ id: 'zones', fields: {} }] } }));
  fs.writeFileSync(path.join(dir, 'blank.html'), '<!doctype html><div id="legend"></div><div id="regions-note"></div>');
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, 'planning/.selected-runtime-vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, watch: null } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(origin + '/' + path.relative(root, dir).replaceAll('\\', '/') + '/blank.html');
    const result = await page.evaluate(async ({ file, bounds }) => {
      const { initPointCheck, checkPoint, zoneSummary } = await import('/src/pointcheck.js');
      const { zoneExplanation } = await import('/src/legends.js');
      const { renderRegionInfo } = await import('/src/app/region-ui.js');
      const { createZones } = await import('/src/map.js');
      const selected = { id: 'cn-selected', country: 'cn', name: 'Selected example', semantics: 'allow', file, bounds, coverageBounds: [102, 0, 105, 3], maxZoom: 14, coverageMode: 'positive-only', sourceConfidence: { mode: 'selected-source' }, source: { authority: 'Third-party mirror', effective: null, snapshotAt: '2026-09-22T00:00:00Z' } };
      initPointCheck([selected]);
      const inside = await checkPoint(1.01, 103.01);
      const hole = await checkPoint(1.05, 103.05);
      const gap = await checkPoint(1.01, 103.105);
      const outside = await checkPoint(.5, 104);
      const hubei = { ...selected, id: 'cn-hubei', name: 'Hubei', coverageBounds: bounds, coverageMode: undefined, sourceConfidence: undefined, maxHeightM: 120, source: { authority: 'Existing authority', effective: '2026-05-14' } };
      initPointCheck([{ ...selected, id: 'cn-overlap', file: file.replace('zones.pmtiles', 'filled.pmtiles') }, hubei]);
      const legacy = await checkPoint(1.05, 103.05);
      const legacyPositive = await checkPoint(1.01, 103.01);
      initPointCheck([{ ...selected, id: 'missing', file: file.replace('zones.pmtiles', 'missing.pmtiles') }]);
      const unavailable = await checkPoint(1.01, 103.01);
      let fitted;
      createZones({ on() {}, fitBounds(b) { fitted = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; } }, [selected, { ...hubei, bounds: [108, 29, 116, 34] }]).fit();
      renderRegionInfo({ index: { countries: [{ id: 'cn', regions: 2 }] }, regions: [hubei, selected] });
      return { inside: zoneSummary(inside), explanation: zoneExplanation(inside).textContent, hole: hole.status, gap: gap.status, outside: outside.status, legacy: { status: legacy.status, region: legacy.region.id, summary: zoneSummary(legacy) }, unavailable: unavailable.status, fitted, legend: document.getElementById('legend').textContent, note: document.getElementById('regions-note').textContent, legacyInside: zoneSummary(legacyPositive), legacyPositiveRegion: legacyPositive.region.id };
    }, { file: origin + '/' + path.relative(root, path.join(dir, 'zones.pmtiles')).replaceAll('\\', '/'), bounds });
    assert.match(result.inside.title, /selected source/);
    assert.match(result.inside.detail, /effective date unknown/);
    assert.match(result.inside.detail, /unverified/);
    assert(!result.explanation.includes('Official source: Third-party'));
    for (const key of ['hole', 'gap', 'outside', 'unavailable']) assert.equal(result[key], 'nodata', key);
    assert.equal(result.legacy.status, 'outside');
    assert.equal(result.legacy.region, 'cn-hubei');
    assert.equal(result.legacyPositiveRegion, 'cn-hubei');
    assert.match(result.legacy.summary.title, /controlled airspace/);
    assert.equal(result.legacyInside.title, 'Suitable-flight zone, below 120 m true height');
    assert.deepEqual(result.fitted, [108, 29, 116, 34]);
    assert.match(result.legend, /Hubei: Teal/);
    assert.match(result.legend, /Selected example: Teal: suitable-flight polygons/);
    assert.match(result.note, /mapped polygons only/);
    assert(!result.note.includes('effective null'));
  } finally {
    await browser?.close(); await server.close();
    assert(dir.startsWith(path.join(root, 'planning/selected-runtime-')));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
