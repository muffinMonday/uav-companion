// Marker-window theme regression, on the PRODUCTION build. In the built page Leaflet's stylesheet is linked after styles.css, so its
// single-class popup rules (white background, #333 text) used to beat ours and leave a light window in dark mode; the dev server
// orders the sheets the other way and hides it. So this suite builds the app and serves it with `vite preview` (own port, own output
// folder). Computed-style assertions plus one screenshot; it does not need the app on :5173.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { CHANNEL, chromium, OUT, ROOT } from './lib.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');
const DIST = path.join(OUT, 'popup-theme-dist');
const PORT = 5197;
const errs = [];

const built = spawnSync(process.execPath, [VITE, 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
ok(built.status === 0, 'production build for the suite');
if (built.status !== 0) { console.log(built.stderr || built.stdout); process.exit(1); }
const server = spawn(process.execPath, [VITE, 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview did not start')), 30000); server.stdout.on('data', (d) => { if (/Local:|127\.0\.0\.1/.test(String(d))) { clearTimeout(t); res(); } }); });
const b = await chromium.launch({ channel: CHANNEL });

// colour helpers, run in the page: any computed colour -> [r, g, b, a] (0..255, a 0..1) through a canvas
const SEED = { v: 1, items: [{ id: 'm0', type: 'hotel', name: 'Seed A', note: 'hello', lat: 30.59, lon: 114.30, created: '2026-11-01T00:00:00.000Z' }] };
async function open({ theme, scheme = 'light', width = 1200, height = 800 }) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addInitScript(([seed, th]) => { if (!sessionStorage.__s) { sessionStorage.__s = 1; localStorage.setItem('uavzones.v1.pois', JSON.stringify(seed)); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ ...(th ? { theme: th } : {}), view: { lat: 30.59, lon: 114.30, zoom: 14 } })); } }, [SEED, theme]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.click('.poi-pin'); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    window.__rgba = (css) => { const c = document.createElement('canvas').getContext('2d'); c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    window.__lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    window.__over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
    window.__ratio = (x, y) => { const [l1, l2] = [__lum(x), __lum(y)].sort((m, n) => n - m); return (l1 + 0.05) / (l2 + 0.05); };
    window.__st = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { bg: __rgba(c.backgroundColor), fg: __rgba(c.color), bgRaw: c.backgroundColor }; };
  });
  return { ctx, p };
}
const wrap = (p) => p.evaluate(() => __st('.leaflet-popup-content-wrapper'));
const tip = (p) => p.evaluate(() => __st('.leaflet-popup-tip'));
const same = (a, b2) => a.every((v, i) => Math.abs(v - b2[i]) < 1.01);
// a shell is "dark" when it is dark with the map showing through, as seen over a mid-grey map (worst case)
const shellLum = (p) => p.evaluate(() => { const s = __st('.leaflet-popup-content-wrapper'); return { solid: __lum(__over(s.bg, [255, 255, 255])), over: __lum(__over(s.bg, [128, 128, 128])) }; });

// ---- 1. Light: unchanged and readable
{
  const { ctx, p } = await open({ theme: 'light' });
  const w = await wrap(p), t = await tip(p);
  ok(w.bg[0] > 240 && w.bg[1] > 240 && w.bg[2] > 240, 'light: the window is light (' + w.bgRaw + ')');
  ok(await p.evaluate(() => __ratio(__st('.leaflet-popup-content-wrapper').fg, __over(__st('.leaflet-popup-content-wrapper').bg, [255, 255, 255]))) >= 7, 'light: window text contrast is at least 7:1');
  ok(same(w.bg, t.bg), 'light: the tip matches the window');
  await ctx.close();
}

// ---- 2. Dark (explicit): shell, text, tip, cards, close button, footer
const darkFg = [232, 238, 244];
{
  const { ctx, p } = await open({ theme: 'dark' });
  const w = await wrap(p), t = await tip(p);
  ok(w.bg[0] < 60 && w.bg[1] < 60 && w.bg[2] < 70 && w.bg[3] > 0.7, 'dark: the window is the dark surface (' + w.bgRaw + ')');
  ok(same(w.fg.slice(0, 3), darkFg), 'dark: window text is the dark-theme foreground (' + w.fg.slice(0, 3) + ')');
  ok(same(w.bg, t.bg), 'dark: the tip matches the window');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.leaflet-popup-content-wrapper')).backdropFilter.includes('blur')), 'dark: the frosted-glass blur is kept');
  const card = await p.evaluate(() => { const s = __st('.pop .status'); const w2 = __st('.leaflet-popup-content-wrapper'); const base = __over(w2.bg, [24, 34, 44]); return { ratio: __ratio(s.fg, __over(s.bg, base)), lum: __lum(__over(s.bg, base)) }; });
  ok(card.ratio >= 4.5 && card.lum < 0.2, 'dark: the status card stays readable (' + card.ratio.toFixed(1) + ':1)');
  const noteOk = await p.evaluate(() => { const n = document.querySelector('.pop .note'); if (!n) return true; const s = __st('.pop .note'); return __ratio(s.fg, __over(s.bg, __over(__st('.leaflet-popup-content-wrapper').bg, [24, 34, 44]))) >= 4.5; });
  ok(noteOk, 'dark: the note card is readable');
  const close = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.leaflet-popup-close-button')); const w2 = __st('.leaflet-popup-content-wrapper'); return { ratio: __ratio(__rgba(c.color), __over(w2.bg, [24, 34, 44])), size: c.width }; });
  ok(close.ratio >= 3 && close.size === '28px', 'dark: the close control uses the theme colour at 3:1 or better and the intended size (' + close.ratio.toFixed(1) + ':1, ' + close.size + ')');
  const btn = await p.evaluate(() => { const bt = document.querySelector('.pop .btn, .pop button'); if (!bt) return null; const c = getComputedStyle(bt); return __ratio(__rgba(c.color), __over(__rgba(c.backgroundColor), __over(__st('.leaflet-popup-content-wrapper').bg, [24, 34, 44]))); });
  ok(btn === null || btn >= 3, 'dark: popup buttons keep their contrast' + (btn ? ' (' + btn.toFixed(1) + ':1)' : ''));
  // sequence footer (Previous / Next): built by the app only inside a trip day; check the stylesheet's rule on a stand-in
  const seq = await p.evaluate(() => { const pop = document.querySelector('.pop'); const f = document.createElement('div'); f.className = 'pop-seq'; const bt = document.createElement('button'); bt.className = 'pop-seq-btn'; bt.textContent = 'Next'; f.append(bt); pop.append(f); const s = __st('.pop-seq'); const c = getComputedStyle(bt); const r = __ratio(__rgba(c.color), __over(s.bg, __over(__st('.leaflet-popup-content-wrapper').bg, [24, 34, 44]))); f.remove(); return { lum: __lum(__over(s.bg, [24, 34, 44])), r }; });
  ok(seq.lum < 0.1 && seq.r >= 3, 'dark: the Previous / Next footer is dark and its buttons readable (' + seq.r.toFixed(1) + ':1)');

  // ---- opacity at both ends of the slider: the shell stays dark
  for (const v of [0.5, 1]) {
    await p.evaluate((v2) => { const s = document.getElementById('pop-op'); s.value = String(v2); s.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const l = await shellLum(p), tp = await tip(p), ww = await wrap(p);
    ok(ww.bg[0] < 60 && ww.bg[2] < 70 && l.over < 0.12 && Math.abs(ww.bg[3] - v) < 0.02 && same(tp.bg, ww.bg), `dark: opacity ${v}: the window and tip stay dark (alpha ${ww.bg[3].toFixed(2)})`);
  }
  await p.evaluate(() => { const s = document.getElementById('pop-op'); s.value = '0.8'; s.dispatchEvent(new Event('input', { bubbles: true })); });

  // ---- expanded window
  const isExp = () => p.evaluate(() => document.querySelector('.leaflet-popup')?.classList.contains('is-expanded'));
  if (!(await isExp())) { await p.click('.pop-toggle'); await p.waitForTimeout(500); }
  const ex = await p.evaluate(() => ({ cls: document.querySelector('.leaflet-popup')?.classList.contains('is-expanded'), s: __st('.leaflet-popup-content-wrapper') }));
  ok(ex.cls && ex.s.bg[0] < 60 && same(ex.s.fg.slice(0, 3), darkFg), 'dark: the expanded window keeps the dark surface and text');
  await p.screenshot({ path: path.join(OUT, 'popup-dark-expanded.png') });
  if (await isExp()) { await p.click('.pop-toggle').catch(() => {}); await p.waitForTimeout(300); }
  ok(!(await isExp()), 'dark: the window collapses again');
  { const c = await wrap(p); ok(c.bg[0] < 60, 'dark: the collapsed window is dark'); }
  await p.screenshot({ path: path.join(OUT, 'popup-dark.png') });
  await ctx.close();
}

// ---- 3. Light -> Dark with the window open
{
  const { ctx, p } = await open({ theme: 'light' });
  await p.check('#theme-radios input[value=dark]'); await p.waitForTimeout(500);
  const w = await wrap(p), t = await tip(p);
  ok(await p.evaluate(() => !!document.querySelector('.leaflet-popup')) && w.bg[0] < 60 && same(w.fg.slice(0, 3), darkFg) && same(w.bg, t.bg), 'Light to Dark with the window open: it turns dark (window, text, tip)');
  await p.check('#theme-radios input[value=light]'); await p.waitForTimeout(500);
  ok((await wrap(p)).bg[0] > 240, 'and back to Light with the window open');
  await ctx.close();
}

// ---- 4. System theme resolves like an explicit one
{
  const d = await open({ theme: null, scheme: 'dark' });
  const w = await wrap(d.p);
  ok(w.bg[0] < 60 && same(w.fg.slice(0, 3), darkFg), 'System on a dark device: dark window, same colours as explicit Dark');
  await d.p.emulateMedia({ colorScheme: 'light' }); await d.p.waitForTimeout(500);
  ok((await wrap(d.p)).bg[0] > 240, 'System follows the device back to light while the window is open');
  await d.ctx.close();
}

// ---- 5. phone layout, dark
{
  const { ctx, p } = await open({ theme: 'dark', width: 390, height: 780 });
  const w = await wrap(p), t = await tip(p);
  ok(w.bg[0] < 60 && same(w.bg, t.bg), 'phone width (390): dark window and tip');
  await p.screenshot({ path: path.join(OUT, 'popup-dark-phone.png') });
  await ctx.close();
}

// ---- 6. zone colours are not touched by the popup change
{
  const { ctx, p } = await open({ theme: 'dark' });
  const z = await p.evaluate(() => { const c = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return [c('--zone'), c('--zone-restrict')]; });
  ok(z[0] !== '' && z[1] !== '', 'zone colour tokens are still defined (' + z.join(', ') + ')');
  await ctx.close();
}

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
server.kill();
fs.rmSync(DIST, { recursive: true, force: true });
