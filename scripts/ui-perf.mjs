// UI performance snapshot for before/after comparisons: static counts from src/styles.css plus browser timings under a 4x CPU slowdown.
//   node scripts/ui-perf.mjs --label p1            (the app must be running on http://localhost:5173)
// Static: bytes, gzip bytes, number of box-shadow / filter / backdrop-filter / animation declarations.
// Dynamic (Chrome DevTools Performance metrics, median of 3 runs, phone viewport, CPU x4): style recalculation and layout time and counts, script time, and the
// frame gaps while a scripted scenario runs (open the panel on each tab, open a marker window, drag the map). Timings are only comparable on one machine and one browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium, CHANNEL, LATEST_SEEN } from '../tests/lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'perf');
const OUT_ROOT = arg('out', path.join(os.homedir(), 'UAV_UI_Screenshots'));
const RUNS = parseInt(arg('runs', '3'), 10);
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const count = (re) => (css.match(re) || []).length;
const stat = { bytes: Buffer.byteLength(css), gzip: zlib.gzipSync(css).length, boxShadow: count(/box-shadow:/g), filter: count(/(?<![-a-z])filter:/g), backdropFilter: count(/backdrop-filter:/g), animation: count(/animation:/g), transition: count(/transition:/g), lines: css.split(/\r?\n/).length };

const iso = (off) => { const d = new Date('2026-11-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
const POIS = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, type: ['photo', 'hotel', 'takeoff', 'train'][i % 4], name: 'Place ' + (i + 1), note: 'Note ' + i, lat: 30.55 + (i % 4) * 0.01, lon: 114.3 + Math.floor(i / 4) * 0.012, tripId: 't1', date: iso(5 + (i % 3)), order: i + 1, created: `2026-11-01T00:00:${String(i).padStart(2, '0')}.000Z` }));
const TRIPS = [{ id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: 'Four days around Wuhan.', color: '#e91e63', created: '2026-11-01T00:00:00.000Z' }];
const tab = (p, t) => p.evaluate((name) => { const d = document.querySelector(`#dock button[data-tab=${name}]`); if (!document.getElementById('panel').hidden) document.getElementById(`tab-${name}`).click(); else d.click(); }, t);

const browser = await chromium.launch({ channel: CHANNEL });
const runs = [];
for (let r = 0; r < RUNS; r++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark', reducedMotion: 'no-preference' });
  await ctx.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (x) => x.abort());
  const p = await ctx.newPage();
  await p.addInitScript(([pois, trips, seen]) => { if (sessionStorage.__s) return; sessionStorage.__s = '1'; localStorage.clear(); const set = (k, x) => localStorage.setItem('uavzones.v1.' + k, JSON.stringify(x)); set('dash', { v: 1, showOnStart: false, welcomed: true, seen }); set('prefs', { view: { lat: 30.6, lon: 114.3, zoom: 12 }, basemap: 'osm', holdHint: true, theme: 'dark', themeAt: 1 }); set('pois', { v: 1, items: pois }); set('trips', { v: 1, trips }); }, [POIS, TRIPS, LATEST_SEEN]);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = (t) => { window.__gaps.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  for (const t of ['config', 'trips', 'poi', 'config', 'poi']) { await tab(p, t); await p.waitForTimeout(450); }
  await p.locator('#poi-list .poi-item').first().click().catch(() => {}); await p.waitForTimeout(700);
  for (let i = 0; i < 6; i++) { await p.mouse.move(200, 400); await p.mouse.down(); await p.mouse.move(120 + i * 8, 330, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(150); }
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const gaps = await p.evaluate(() => window.__gaps.slice(5));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const d = (k) => +(((m1[k] ?? 0) - (m0[k] ?? 0))).toFixed(4);
  gaps.sort((a, b) => a - b);
  runs.push({ recalcStyleMs: d('RecalcStyleDuration') * 1000, layoutMs: d('LayoutDuration') * 1000, scriptMs: d('ScriptDuration') * 1000, taskMs: d('TaskDuration') * 1000, recalcCount: d('RecalcStyleCount'), layoutCount: d('LayoutCount'), frames: gaps.length, gapMedianMs: gaps[Math.floor(gaps.length / 2)] ?? 0, gapP95Ms: gaps[Math.floor(gaps.length * 0.95)] ?? 0, gapOver50: gaps.filter((g) => g > 50).length });
  await ctx.close();
}
await browser.close();
const med = (k) => { const v = runs.map((r) => r[k]).sort((a, b) => a - b); return +v[Math.floor(v.length / 2)].toFixed(2); };
const dyn = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, med(k)]));
const out = { label: LABEL, taken: new Date().toISOString(), browser: browser.version(), cpuThrottle: 4, runs: RUNS, static: stat, dynamic: dyn, raw: runs };
fs.writeFileSync(path.join(OUT_ROOT, `perf_${LABEL}.json`), JSON.stringify(out, null, 1));
console.log('static ', JSON.stringify(stat));
console.log('dynamic', JSON.stringify(dyn));
