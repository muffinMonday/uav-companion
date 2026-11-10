import { CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  return p;
};
// opacity applied to the zone layer: the layer container whose opacity is not 1 (the basemap layer stays at 1)
const zoneOpacity = (p) => p.evaluate(() => [...document.querySelectorAll('.leaflet-tile-pane .leaflet-layer')].map((e) => parseFloat(getComputedStyle(e).opacity)).filter((o) => o < 0.999));
const prefs = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
const setSlider = (p, v) => p.evaluate((val) => { const s = document.getElementById('op'); s.value = val; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }, v);

const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
let p = await open(ctx);
ok((await p.inputValue('#op')) === '0.45', 'first visit: slider at the default 0.45');
ok((await zoneOpacity(p)).every((o) => Math.abs(o - 0.45) < 0.01) && (await zoneOpacity(p)).length >= 1, 'first visit: zones drawn at 0.45: ' + JSON.stringify(await zoneOpacity(p)));
ok(!('opacity' in (await prefs(p))), 'nothing saved until the user changes it');

await setSlider(p, '0.8'); await p.waitForTimeout(300);
ok((await zoneOpacity(p)).every((o) => Math.abs(o - 0.8) < 0.01), 'moving the slider changes the zones at once: ' + JSON.stringify(await zoneOpacity(p)));
ok((await prefs(p)).opacity === 0.8, 'releasing the slider saves it: ' + JSON.stringify(await prefs(p)));

// "input" events alone (dragging) must not hit storage on every step
await p.evaluate(() => { window.__writes = 0; const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'uavzones.v1.prefs') window.__writes++; return orig.call(this, k, v); }; });
await p.evaluate(() => { const s = document.getElementById('op'); for (const v of ['0.5', '0.55', '0.6', '0.65', '0.7']) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); } });
ok((await p.evaluate(() => window.__writes)) === 0, 'dragging (input events) does not write to storage; only the release does');

await setSlider(p, '0.8');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
ok((await p.inputValue('#op')) === '0.8', 'next session: the slider shows 0.8');
ok((await zoneOpacity(p)).every((o) => Math.abs(o - 0.8) < 0.01) && (await zoneOpacity(p)).length >= 1, 'next session: the zones are drawn at 0.8 from the start: ' + JSON.stringify(await zoneOpacity(p)));

// the other remembered settings are untouched by saving opacity
await p.selectOption('#base', 'sat'); await p.selectOption('#country', 'sg'); await p.waitForTimeout(800); await setSlider(p, '0.3'); await p.waitForTimeout(500);
const pr = await prefs(p);
ok(pr.opacity === 0.3 && pr.basemap === 'sat' && pr.country === 'sg' && pr.view, 'saving opacity keeps basemap, country and position: ' + JSON.stringify(pr).slice(0, 120));

// invalid stored values fall back to the default
for (const [label, v] of [['too high', 5], ['too low', -1], ['zero', 0], ['text', 'x'], ['null', null], ['NaN-like', '0.5abc']]) {
  const c = await b.newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript((val) => localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ opacity: val })), v);
  const q = await open(c);
  ok((await q.inputValue('#op')) === '0.45', `invalid stored opacity (${label}): falls back to 0.45`);
  await c.close();
}
// edge values are accepted
for (const v of [0.1, 0.9]) {
  const c = await b.newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript((val) => localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ opacity: val })), v);
  const q = await open(c);
  ok(parseFloat(await q.inputValue('#op')) === v, `edge value ${v} is accepted`);
  await c.close();
}
// storage blocked
const c4 = await b.newContext({ viewport: { width: 1200, height: 800 } });
await c4.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
const q4 = await open(c4); await setSlider(q4, '0.7'); await q4.waitForTimeout(300);
ok((await zoneOpacity(q4)).every((o) => Math.abs(o - 0.7) < 0.01), 'storage blocked: the slider still works for this session');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
