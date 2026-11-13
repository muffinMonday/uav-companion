// Automated UI measurements, the numbers DESIGN.md section 13 asks for: touch-target size, text-size floor, horizontal overflow, truncated text.
//   node scripts/ui-checks.mjs --label pre-p3                 (the app must be running on http://localhost:5173)
//   node scripts/ui-checks.mjs --label after-p5 --vp phone --theme dark
// Writes ~/UAV_UI_Screenshots/checks_<label>.json and prints a summary. It only drives the page and reads it; nothing in the app changes.
// Hit area = how far a tap still reaches the element, probed from its centre in four directions with elementFromPoint (so a ::after that enlarges the target counts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, CHANNEL, LATEST_SEEN } from '../tests/lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'checks');
const OUT_ROOT = arg('out', path.join(os.homedir(), 'UAV_UI_Screenshots'));
const VPS = { phone: { w: 390, h: 844, touch: true }, phones: { w: 360, h: 640, touch: true }, tabport: { w: 768, h: 1024, touch: true }, desk: { w: 1440, h: 900, touch: false } };
const VPN = (arg('vp', 'phone,phones,desk')).split(',');
const THEMES = (arg('theme', 'light,dark')).split(',');
const iso = (off) => { const d = new Date('2026-11-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
const POIS = [
  { id: 'p1', type: 'photo', name: 'East Lake Bridge', note: 'Golden hour', lat: 30.575, lon: 114.36, tripId: 't1', date: iso(5), order: 1, created: '2026-11-01T00:00:01.000Z' },
  { id: 'p2', type: 'hotel', name: 'Lakeside Hotel', note: '', lat: 30.59, lon: 114.335, tripId: 't1', date: iso(5), order: 2, created: '2026-11-01T00:00:02.000Z' },
  { id: 'p3', type: 'other', name: 'A place with a rather long name that has to wrap in narrow rows', note: '', lat: 30.63, lon: 114.33, created: '2026-11-01T00:00:03.000Z' },
];
const TRIPS = [{ id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: 'Four days around Wuhan.', color: '#e91e63', created: '2026-11-01T00:00:00.000Z', checklist: [{ text: 'Batteries', done: true }] }];

const measure = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const desc = (e) => { const c = [...e.classList].slice(0, 2).join('.'); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (c ? '.' + c : ''); };
  const hits = [];
  for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button]')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue; // screen-reader-only
    if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li, small, span, div')?.textContent.trim().length > e.textContent.trim().length + 8) continue; // a link inside a sentence is exempt
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, own = (t) => t && (t === e || e.contains(t));
    const reach = (dx, dy) => { let n = 0; for (let k = 1; k <= 30; k++) { const x = cx + dx * k, y = cy + dy * k; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) break; if (!own(document.elementFromPoint(x, y))) break; n = k; } return n; };
    const w = reach(-1, 0) + reach(1, 0), h = reach(0, -1) + reach(0, 1);
    if (Math.min(w, h) < 44) hits.push({ el: desc(e), w: Math.round(Math.max(w, 0)), h: Math.round(Math.max(h, 0)), box: [Math.round(r.width), Math.round(r.height)], text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) });
  }
  const sizes = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim(); if (!t) continue; const p = n.parentElement; if (!p || !vis(p) || p.closest('svg,script,style,.leaflet-tile-pane,.sr-only,.tool-label')) continue;
    const cs = getComputedStyle(p); const size = parseFloat(cs.fontSize); const upper = cs.textTransform === 'uppercase';
    const floor = upper ? 11 : 12;
    if (size < floor - 0.01) { const k = desc(p) + ' ' + size; const o = sizes.get(k) ?? { el: desc(p), size, upper, n: 0, sample: t.slice(0, 20) }; o.n++; sizes.set(k, o); }
  }
  const trunc = [];
  for (const e of document.querySelectorAll('*')) { if (!vis(e)) continue; const cs = getComputedStyle(e); if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) trunc.push({ el: desc(e), text: e.textContent.trim().slice(0, 30) }); }
  return { hits, small: [...sizes.values()], trunc, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, scrollW: document.documentElement.scrollWidth };
};

const SCREENS = [
  ['map', async () => {}],
  ['panel-config', async (p) => { await tab(p, 'config'); }],
  ['panel-trips', async (p) => { await tab(p, 'trips'); }],
  ['panel-poi', async (p) => { await tab(p, 'poi'); }],
  ['popup', async (p) => { await tab(p, 'poi'); await p.locator('#poi-list .poi-item', { hasText: 'East Lake Bridge' }).click(); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(600); }],
  ['dash', async (p) => { await p.waitForSelector('#dash:not([hidden])'); }, { dash: { showOnStart: true, welcomed: true, seen: '9999' } }],
  ['privacy', async (p) => { await tab(p, 'config'); await p.click('#privacy-btn'); await p.waitForTimeout(400); }],
];
const tab = (p, t) => p.evaluate((name) => { const d = document.querySelector(`#dock button[data-tab=${name}]`); if (!document.getElementById('panel').hidden) document.getElementById(`tab-${name}`).click(); else d.click(); }, t);

const browser = await chromium.launch({ channel: CHANNEL });
const result = { label: LABEL, taken: new Date().toISOString(), browser: browser.version(), runs: [] };
for (const vp of VPN) for (const theme of THEMES) {
  const v = VPS[vp]; const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.touch, isMobile: v.touch && v.w < 800, locale: 'en-GB', timezoneId: 'Asia/Singapore' });
  await ctx.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (r) => r.abort());
  for (const [id, run, open = {}] of SCREENS) {
    const p = await ctx.newPage();
    await p.addInitScript(([th, o]) => { if (sessionStorage.__s) return; sessionStorage.__s = '1'; localStorage.clear(); const set = (k, x) => localStorage.setItem('uavzones.v1.' + k, JSON.stringify(x)); set('dash', { v: 1, ...(o.dash ?? { showOnStart: false, welcomed: true, seen: o.seen }) }); set('prefs', { view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', holdHint: true, theme: th, themeAt: 1 }); set('pois', { v: 1, items: o.pois }); set('trips', { v: 1, trips: o.trips }); }, [theme, { ...open, pois: POIS, trips: TRIPS, seen: LATEST_SEEN }]);
    await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    let m; try { await run(p); await p.waitForTimeout(500); m = await p.evaluate(measure); } catch (e) { m = { error: String(e.message).split('\n')[0] }; }
    result.runs.push({ viewport: vp, theme, screen: id, ...m });
    await p.close();
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT_ROOT, `checks_${LABEL}.json`), JSON.stringify(result, null, 1));
const agg = {};
for (const r of result.runs) { const k = `${r.viewport}/${r.theme}`; const a = (agg[k] ??= { hits: new Set(), small: new Set(), trunc: new Set(), overflow: 0, errors: 0 }); if (r.error) { a.errors++; continue; } r.hits.forEach((h) => a.hits.add(h.el)); r.small.forEach((s) => a.small.add(s.el + '@' + s.size)); r.trunc.forEach((t) => a.trunc.add(t.el)); if (r.pageOverflow) a.overflow++; }
for (const [k, a] of Object.entries(agg)) console.log(`${k.padEnd(14)} hit areas under 44: ${a.hits.size} elements | text under floor: ${a.small.size} | truncated: ${a.trunc.size} | page overflow screens: ${a.overflow}${a.errors ? ' | errors: ' + a.errors : ''}`);
console.log('-> ' + path.join(OUT_ROOT, `checks_${LABEL}.json`));
