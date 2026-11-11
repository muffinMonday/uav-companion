// The quick setup (splash): shown on a first visit and never to a returning one; Skip and Escape; the trip form and the itinerary link make a prompt that is
// copied; a pasted answer previews in the Trips tab; Plan a flight centres the map on the visitor (no popup), or offers the regions when there is no position.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOME = { latitude: 30.59, longitude: 114.30, accuracy: 15 };
const ANSWER = JSON.stringify({ type: 'FeatureCollection', trip: { name: 'Kyoto test', country: 'Japan', startDate: '2027-04-01', endDate: '2027-04-03' }, features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [135.7681, 35.0116] }, properties: { name: 'Kyoto Station Hotel', type: 'hotel', date: '2027-04-01' } }] });

async function open({ vp = { width: 1300, height: 850 }, touch = false, dash = null, data = false, geo = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, permissions: ['clipboard-read', 'clipboard-write', ...(geo ? ['geolocation'] : [])], geolocation: HOME });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([d, withData]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    if (d) localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d })); else localStorage.removeItem('uavzones.v1.dash');
    if (withData) localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [{ id: 'p1', type: 'hotel', name: 'Saved hotel', lat: 30.6, lon: 114.3, created: '2026-11-01T00:00:00.000Z' }] }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
  }, [dash, data]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const splashOpen = (p) => p.$eval('#splash', (d) => d.open).catch(() => false);
const dashState = (p) => p.evaluate(() => document.body.dataset.dash);
const stored = (p, k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), k);
const clip = (p) => p.evaluate(() => navigator.clipboard.readText());
const RETURNING = { showOnStart: false, welcomed: true, seen: LATEST_SEEN };
let ctx, p;

// ---- who sees it
({ ctx, p } = await open({ dash: RETURNING }));
ok(!(await splashOpen(p)), 'a returning visitor does not see the splash'); await ctx.close();
({ ctx, p } = await open({ dash: null, data: true }));
ok(!(await splashOpen(p)), 'nor a first-time visitor who already has markers'); await ctx.close();

({ ctx, p } = await open());
ok(await splashOpen(p), 'a clean first visit opens the splash');
ok(await dashState(p) === 'peek', 'the dashboard waits as its strip behind it');
ok(await p.locator('#splash-trip').count() === 1 && await p.locator('#splash-flight').count() === 1 && await p.locator('#splash-skip').count() === 1, 'two choices and Skip');
await p.click('#splash-skip'); await p.waitForTimeout(300);
ok(!(await splashOpen(p)) && await dashState(p) === 'expanded' && await p.locator('#dash-body .dash-guide').count() === 1, 'Skip opens the dashboard with How it works showing');
ok((await stored(p, 'uavzones.v1.dash')).welcomed === true, 'and counts as welcomed');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
ok(!(await splashOpen(p)), 'a reload does not show it again');
await ctx.close();

({ ctx, p } = await open());
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(!(await splashOpen(p)) && await dashState(p) === 'expanded' && (await stored(p, 'uavzones.v1.dash')).welcomed === true, 'Escape skips it the same way');
await ctx.close();

// ---- plan a trip: the form
({ ctx, p } = await open());
await p.click('#splash-trip'); await p.click('#splash-ai');
await p.click('#splash-copy-trip'); await p.waitForTimeout(200);
ok((await p.textContent('.splash-msg')).includes('where you are going') && await p.locator('#splash-answer').count() === 0, 'the destination is required');
await p.fill('#splash-dest', 'Kyoto, Japan'); await p.fill('#splash-when', '5 days in April 2027'); await p.fill('#splash-interests', 'temples and sunrise');
await p.click('#splash-copy-trip'); await p.waitForSelector('#splash-answer');
const prompt = await clip(p);
ok(prompt.includes('Destination: Kyoto, Japan') && prompt.includes('5 days in April 2027') && prompt.includes('temples and sunrise') && prompt.includes('FeatureCollection'), 'the form copies a prompt with the request and the format rules');
ok((await stored(p, 'uavzones.v1.prefs')).mode === 'trip' && await p.locator('#splash li').count() === 3, 'the mode is saved, and the three steps show');
await p.click('#splash-preview'); await p.waitForTimeout(150);
ok(await splashOpen(p), 'Preview and add with nothing pasted stays put');
await p.fill('#splash-answer', ANSWER); await p.click('#splash-preview'); await p.waitForSelector('#ai-preview:not([hidden])');
ok(!(await splashOpen(p)) && await p.isVisible('#pane-trips') && /1 place found/.test(await p.textContent('#ai-preview')), 'a pasted answer previews in the Trips tab');
ok(await dashState(p) === 'peek' && (await stored(p, 'uavzones.v1.dash')).welcomed === true, 'the dashboard stays as its strip');
await p.click('#ai-add'); await p.waitForTimeout(500);
ok((await stored(p, 'uavzones.v1.pois')).items.some((i) => i.name === 'Kyoto Station Hotel'), 'and adding puts the place in the list');
await ctx.close();

// ---- plan a trip: the link
({ ctx, p } = await open());
await p.click('#splash-trip'); await p.click('#splash-link');
for (const bad of ['javascript:alert(1)', 'example.com/plan', 'ftp://example.com/x']) {
  await p.fill('#splash-url', bad); await p.click('#splash-copy-link'); await p.waitForTimeout(100);
  ok((await p.textContent('.splash-msg')).length > 5 && await p.locator('#splash-answer').count() === 0, 'refused: ' + bad);
}
await p.fill('#splash-url', 'https://example.com/my-itinerary'); await p.fill('#splash-note', 'first three days only');
const reqs = []; p.on('request', (r) => { if (/example\.com/.test(r.url())) reqs.push(r.url()); });
await p.click('#splash-copy-link'); await p.waitForSelector('#splash-answer');
const lp = await clip(p);
ok(lp.includes('Link: https://example.com/my-itinerary') && lp.includes('first three days only') && lp.includes('cannot open links') && lp.includes('FeatureCollection'), 'a good link makes a conversion prompt');
ok(reqs.length === 0, 'the link itself was never fetched');
await p.click('#splash-later'); await p.waitForTimeout(300);
ok(!(await splashOpen(p)) && await p.isVisible('#ai-card'), '"I will do this later" leaves the AI card of the Trips tab in view');
await ctx.close();

// ---- plan a flight
({ ctx, p } = await open());
await p.click('#splash-flight'); await p.click('#splash-locate');
await p.waitForSelector('.you-wrap', { timeout: 10000 }); await p.waitForTimeout(800);
const off = await p.evaluate(() => { const m = document.querySelector('#map').getBoundingClientRect(), y = document.querySelector('.you-wrap').getBoundingClientRect(); return Math.hypot(m.x + m.width / 2 - (y.x + y.width / 2), m.y + m.height / 2 - (y.y + y.height / 2)); });
ok(!(await splashOpen(p)) && off < 40, 'Use my location centres the map on the visitor (' + Math.round(off) + ' px off)');
ok(await p.locator('.leaflet-popup').count() === 0, 'with no popup and no zone check');
ok((await stored(p, 'uavzones.v1.prefs')).mode === 'flight' && await dashState(p) === 'peek', 'the mode is saved and the dashboard is its strip');
await ctx.close();

({ ctx, p } = await open({ geo: false }));
await p.click('#splash-flight'); await p.click('#splash-locate');
await p.waitForSelector('#splash[open] #splash-close', { timeout: 10000 });
ok(/No location yet/.test(await p.textContent('#splash')) && await p.locator('#splash .btn', { hasText: 'Singapore' }).count() === 1, 'with no position it says so and offers the regions');
await p.click('#splash .btn:has-text("Singapore")'); await p.waitForTimeout(1200);
const ctr = await p.evaluate(() => { const t = document.querySelector('.leaflet-tile-pane'); return !!t; });
ok(!(await splashOpen(p)) && ctr && await dashState(p) === 'peek', 'a region button flies there and closes the dialog');
await ctx.close();

// ---- running it again
({ ctx, p } = await open({ dash: RETURNING }));
await p.click('#setup-open'); await p.waitForTimeout(300);
ok(await splashOpen(p), 'Quick setup in Map Configs opens it again');
await p.click('#splash-skip'); await p.waitForTimeout(300);
if (!(await p.locator('#dash-setup').count())) await p.click('#dash-help');
await p.click('#dash-setup'); await p.waitForTimeout(300);
ok(await splashOpen(p), 'and so does the button in the ? card');
await ctx.close();

// ---- a phone
({ ctx, p } = await open({ vp: { width: 360, height: 640 }, touch: true }));
const r = await p.$eval('#splash', (d) => { const x = d.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, vw: innerWidth, vh: innerHeight }; });
ok(r.l >= 0 && r.r <= r.vw && r.t >= 0 && r.b <= r.vh, 'on a 360 px phone the splash fits the screen');
await p.click('#splash-trip'); await p.click('#splash-ai'); await p.fill('#splash-dest', 'Osaka'); await p.click('#splash-copy-trip'); await p.waitForSelector('#splash-answer');
const r2 = await p.$eval('#splash', (d) => { const x = d.getBoundingClientRect(); return { r: x.right, b: x.bottom, vw: innerWidth, vh: innerHeight, sh: d.scrollHeight, ch: d.clientHeight }; });
ok(r2.r <= r2.vw && r2.b <= r2.vh, 'and so does the paste step (scrolls if it must: ' + r2.sh + ' in ' + r2.ch + ')');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
