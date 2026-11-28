// Basemap request benchmark (a measuring tool, not a pass/fail suite; it is not part of `npm test`).
//   node tests/bench-basemap.mjs [--base http://localhost:5173] [--label name] [--out file.json] [--fail-carto]
// The app is opened in Chromium with the tile provider hosts MAPPED (host-resolver-rules) to a local HTTPS server that returns a deterministic PNG with provider-like cache headers
// (cache-control public, max-age, ETag, 304 on If-None-Match). No page.route is used: Playwright interception disables the HTTP cache, which would hide cache behaviour.
// Counts are requests that reached the MOCK. They show request-pattern changes; they are not provider quota (CARTO/OSM count on their side, with their own caching and CDN).
// Scenarios run in fresh contexts (cold cache), identical for every run: init, pan/zoom, rapid theme, basemap switching, panel interactions, warm reload.
// The CARTO path needs the dev server started with a dummy key: VITE_CARTO_API_KEY=dummy npx vite --port 5174 (no real key is used or needed). The keyless path is a server without it.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, CHANNEL } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:5173'), LABEL = arg('--label', 'run'), OUT_FILE = arg('--out', ''), FAIL_CARTO = process.argv.includes('--fail-carto');
const PORT = 8443;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOSTS = ['tile.openstreetmap.org', ...['a', 'b', 'c'].flatMap((s) => [`${s}.tile.openstreetmap.fr`, `${s}.tile-cyclosm.openstreetmap.fr`, `${s}.tile.opentopomap.org`]), 'basemaps.cartocdn.com'];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '1', '-subj', '/CN=mock'], { stdio: 'ignore' });
let log = [];
const server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
  const host = req.headers.host.replace(/:\d+$/, ''), etag = '"t-' + req.url.replace(/\W/g, '') + '"';
  const entry = { host, url: `${host}${req.url}`, status: 200, t: Date.now() };
  if (FAIL_CARTO && host === 'basemaps.cartocdn.com') { entry.status = 429; log.push(entry); res.writeHead(429, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }); res.end('quota'); return; }
  if (req.headers['if-none-match'] === etag) { entry.status = 304; log.push(entry); res.writeHead(304, { etag, 'cache-control': 'public, max-age=3600' }); res.end(); return; }
  log.push(entry);
  res.writeHead(200, { 'content-type': 'image/png', etag, 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' }); res.end(PNG);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ channel: CHANNEL, args: ["--no-proxy-server", `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`], ignoreHTTPSErrors: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async (quiet = 700, max = 8000) => { await sleep(350); const t0 = Date.now(); while (Date.now() - t0 < max) { const last = log.at(-1)?.t ?? 0; if (Date.now() - last > quiet) return; await sleep(100); } };
const summarize = (entries) => {
  const urls = new Map(); for (const e of entries) urls.set(e.url, (urls.get(e.url) ?? 0) + 1);
  const byHost = {}; for (const e of entries) { const h = e.host.replace(/^[abc]\./, ''); byHost[h] = (byHost[h] ?? 0) + 1; }
  return { total: entries.length, ok200: entries.filter((e) => e.status === 200).length, revalidated304: entries.filter((e) => e.status === 304).length, failed: entries.filter((e) => e.status >= 400).length, unique: urls.size, repeated: entries.length - urls.size, byHost };
};
async function open({ dsf = 1, theme = 'light', basemap = 'osm', zoom = 14, vp = { width: 1300, height: 850 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf, ignoreHTTPSErrors: true, hasTouch: mobile, isMobile: mobile });
  if (process.env.TILE_OPTS) await ctx.addInitScript((o) => { globalThis.__TILE_OPTS = JSON.parse(o); }, process.env.TILE_OPTS);
  await ctx.addInitScript(([th, bm, z]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: [], hints: true }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.35, lon: 103.82, zoom: z }, basemap: bm, theme: th, themeAt: 1, holdHint: true }));
  }, [theme, basemap, zoom]);
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.error('pageerror', e.message));
  return { ctx, p };
}
const load = async (p) => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.leaflet-tile-pane', { state: 'attached' }); await idle(); if (await p.locator('#panel').isVisible()) await p.click('#panel-close'); await idle(); };
const results = {};
const scenario = async (name, opts, fn, { measureLoad = false } = {}) => {
  log = []; const { ctx, p } = await open(opts);
  if (measureLoad) { await load(p); results[name] = summarize(log); } else { await load(p); log = []; await fn(p); await idle(900); results[name] = summarize(log); }
  if (measureLoad && fn) { log = []; await fn(p); await idle(900); results[name + ' (after)'] = summarize(log); }
  await ctx.close();
};
const drag = async (p, dx, dy) => { const b = await p.locator('#map').boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 8 }); await p.mouse.up(); await sleep(250); };
const zoom = async (p, dir) => { await p.click(dir > 0 ? '.leaflet-control-zoom-in' : '.leaflet-control-zoom-out'); await sleep(450); };
const setTheme = (p, v) => p.evaluate(async (t) => (await import('/src/theme.js')).setTheme(t), v);
const setBase = (p, v) => p.evaluate((k) => { const s = document.getElementById('base'); s.value = k; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);

await scenario('1 initial load (osm, light, dsf 1)', {}, null, { measureLoad: true });
await scenario('1b initial load (osm, dark, dsf 1)', { theme: 'dark' }, null, { measureLoad: true });
await scenario('1c initial load (osm, light, dsf 2)', { dsf: 2 }, null, { measureLoad: true });
await scenario('1d initial load (osm, dark, dsf 2)', { dsf: 2, theme: 'dark' }, null, { measureLoad: true });
await scenario('2 repeated pan/zoom (pan 4 ways and back, zoom in/out x3)', {}, async (p) => {
  for (let i = 0; i < 2; i++) { await drag(p, -400, 0); await drag(p, 400, 0); await drag(p, 0, -300); await drag(p, 0, 300); }
  for (let i = 0; i < 3; i++) { await zoom(p, 1); await zoom(p, -1); }
});
await scenario('2b wheel zoom (6 notches in, 6 out, fast, 40 ms apart)', {}, async (p) => {
  const b = await p.locator('#map').boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await sleep(40); } await idle(900);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 120); await sleep(40); }
});
await scenario('2c long fast drags into unseen areas (6 x 1100 px, 3 steps)', {}, async (p) => {
  const b = await p.locator('#map').boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  for (const [dx, dy] of [[-1100, 0], [0, -700], [1100, 0], [0, 700], [-1100, -600], [1100, 600]]) { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 3 }); await p.mouse.up(); await sleep(150); }
});
await scenario('2d realistic drags (4 x 600 px over ~1 s, 40 steps; each ends on mostly unseen tiles)', {}, async (p) => {
  const b = await p.locator('#map').boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  for (const [dx, dy] of [[-600, 0], [0, -450], [600, 0], [0, 450]]) { await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 40; i++) { await p.mouse.move(x + dx * i / 40, y + dy * i / 40); await sleep(25); } await p.mouse.up(); await sleep(300); }
});
await scenario('3 rapid theme changes (dark/light x4, 120 ms apart)', {}, async (p) => { for (let i = 0; i < 8; i++) { await setTheme(p, i % 2 ? 'light' : 'dark'); await sleep(120); } await setTheme(p, 'dark'); await idle(1200); await setTheme(p, 'light'); });
await scenario('4 basemap switching (hot, cyclosm, topo, osm, then rapid x4)', {}, async (p) => {
  for (const k of ['hot', 'cyclosm', 'topo', 'osm']) { await setBase(p, k); await idle(600); }
  for (const k of ['hot', 'osm', 'hot', 'osm']) { await setBase(p, k); await sleep(60); }
});
await scenario('4c rapid switching through UNSEEN layers (hot, cyclosm, topo, osm, 80 ms apart, final = topo)', {}, async (p) => { for (const k of ['hot', 'cyclosm', 'topo', 'osm', 'hot', 'cyclosm', 'topo']) { await setBase(p, k); await sleep(80); } });
await scenario('4b basemap switching, dark theme (osm<->hot x3)', { theme: 'dark' }, async (p) => { for (const k of ['hot', 'osm', 'hot', 'osm', 'hot', 'osm']) { await setBase(p, k); await idle(600); } });
await scenario('5b panel interactions on a phone (390x844 touch, open/close x6)', { vp: { width: 390, height: 844 }, mobile: true }, async (p) => {
  for (let i = 0; i < 6; i++) { await p.evaluate(() => { const d = document.querySelector('#dock button[data-tab=config]') ?? document.querySelector('[data-tab=config]'); if (document.getElementById('panel').hidden) d?.click(); else document.getElementById('panel-close').click(); }); await sleep(350); }
});
await scenario('5 panel interactions (open/close the config panel x6)', {}, async (p) => {
  for (let i = 0; i < 6; i++) { await p.evaluate(() => { const d = document.querySelector('#dock button[data-tab=config]'); if (document.getElementById('panel').hidden) d.click(); else document.getElementById('panel-close').click(); }); await sleep(350); }
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=config]').click(); }); await sleep(300);
});
// warm reload: same context, second load (the browser HTTP cache should serve the tiles)
{ log = []; const { ctx, p } = await open({}); await load(p); const cold = summarize(log); log = []; await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.leaflet-tile-pane', { state: 'attached' }); await idle(); results['6 reload (cold load)'] = cold; results['6 reload (warm, same profile)'] = summarize(log); await ctx.close(); }

await browser.close(); server.close();
const line = (k, r) => `${k.padEnd(66)} total ${String(r.total).padStart(4)}  200:${String(r.ok200).padStart(4)} 304:${String(r.revalidated304).padStart(3)} fail:${String(r.failed).padStart(3)} unique ${String(r.unique).padStart(4)} repeated ${String(r.repeated).padStart(3)}  ${JSON.stringify(r.byHost)}`;
console.log(`\n== ${LABEL} (${BASE}${FAIL_CARTO ? ', CARTO answers 429' : ''}) ==`);
for (const [k, r] of Object.entries(results)) console.log(line(k, r));
if (OUT_FILE) fs.writeFileSync(OUT_FILE, JSON.stringify({ label: LABEL, base: BASE, failCarto: FAIL_CARTO, results }, null, 1));
process.exit(0);
