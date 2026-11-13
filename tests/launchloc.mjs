// Locate on launch: the browser is asked for the position when the app opens; when it allows, the map opens centred on the visitor; otherwise (denied,
// switched off in Privacy, no geolocation) it opens where it was left.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HERE = { latitude: 1.3521, longitude: 103.8198, accuracy: 20 }; // Singapore
const SAVED = { lat: 30.6, lon: 114.3, zoom: 11 };                   // Wuhan: where the visitor left off

async function open({ geo = true, prefs = {}, noApi = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: geo ? ['geolocation'] : [], geolocation: HERE });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([pr, none]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', ...pr }));
    window.__geoCalls = 0;
    if (none) { try { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); } catch { /* ignore */ } }
    else { const g = navigator.geolocation, orig = g.getCurrentPosition.bind(g); g.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a); }; window.__watchCalls = 0; const ow = g.watchPosition.bind(g); g.watchPosition = (...a) => { window.__watchCalls++; return ow(...a); }; }
  }, [prefs, noApi]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}
const center = (p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'); return s.view || null; });
const near = (v, lat, lon) => v && Math.abs(v.lat - lat) < 0.01 && Math.abs(v.lon - lon) < 0.01;
const saved = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event('pagehide'))); return center(p); };

let { ctx, p } = await open();
let v = await saved(p);
ok(near(v, HERE.latitude, HERE.longitude) && v.zoom >= 15, 'permission granted: the map opens centred on the visitor at street level ' + JSON.stringify(v));
const calls = await p.evaluate(() => window.__geoCalls), dots = await p.locator('.you-dot').count();
const watches = await p.evaluate(() => window.__watchCalls);
ok(dots === 1 && calls === 1 && watches === 0, 'one fix only: the blip is drawn on it, but nothing is tracked (dots ' + dots + ', calls ' + calls + ', watches ' + watches + ')');
ok(await p.locator('.leaflet-interactive').count() >= 1, 'with its accuracy ring');
await p.click('.locate-btn'); await p.waitForTimeout(1200);
ok(await p.evaluate(() => window.__watchCalls) === 1 && await p.locator('.you-dot').count() === 1 && await p.locator('.locate-btn.following').count() === 0, 'the first press of the locate button starts tracking and keeps the one blip');
await p.click('.locate-btn'); await p.waitForTimeout(600);
ok(await p.locator('.locate-btn.following').count() === 1, 'the second press follows');
await ctx.close();

({ ctx, p } = await open({ geo: false }));
v = await saved(p);
ok(near(v, SAVED.lat, SAVED.lon) && v.zoom === SAVED.zoom, 'permission denied: the map resumes where it was left ' + JSON.stringify(v));
ok(!(await p.locator('.toast:visible').count()), 'and nothing is said about it');
await ctx.close();

({ ctx, p } = await open({ prefs: { locateOnLaunch: false } }));
v = await saved(p);
ok(near(v, SAVED.lat, SAVED.lon) && await p.evaluate(() => window.__geoCalls) === 0, 'switched off in Privacy: no request and the saved view');
await ctx.close();

({ ctx, p } = await open({ noApi: true }));
v = await saved(p);
ok(near(v, SAVED.lat, SAVED.lon), 'a browser without geolocation: the saved view');
await ctx.close();

// the switch in the Privacy panel
({ ctx, p } = await open({ geo: false }));
await p.evaluate(() => document.getElementById('privacy-btn').click()); await p.waitForSelector('#pv-locate');
ok(await p.isChecked('#pv-locate'), 'the Privacy panel has the launch switch, on by default');
await p.uncheck('#pv-locate');
ok(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).locateOnLaunch) === false, 'turning it off is remembered');
await p.check('#pv-locate');
ok(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).locateOnLaunch) === undefined, 'turning it back on returns to the default');
await ctx.close();

// first visit (no saved view): the fix wins over fitting all regions
{
  const ctx2 = await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ['geolocation'], geolocation: HERE });
  await ctx2.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(1500);
  const w = await saved(p2);
  ok(near(w, HERE.latitude, HERE.longitude), 'a first visit also opens on the visitor, not on all regions ' + JSON.stringify(w));
  await ctx2.close();
}

// the zone data arrives long after the fix: the live launch flag still keeps the map on the visitor (zones.fit must not run) and the legend appears afterwards
{
  const ctx3 = await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ['geolocation'], geolocation: HERE });
  await ctx3.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx3.route(/\/data\/index\.json/, async (r) => { await new Promise((x) => setTimeout(x, 2500)); r.continue(); });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await p3.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }); await p3.waitForTimeout(1500);
  ok(await p3.locator('#legend > *').count() === 0, 'slow zone data: the legend is not drawn before the data arrives');
  await p3.waitForTimeout(3500);
  const w3 = await saved(p3);
  ok(near(w3, HERE.latitude, HERE.longitude), 'slow zone data: the map stays on the visitor when the zones finally load ' + JSON.stringify(w3));
  ok(await p3.locator('#legend > *').count() > 0 && /Coverage/.test(await p3.textContent('#regions-note')), 'slow zone data: the legend and coverage note appear once it has loaded');
  await ctx3.close();
}

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
