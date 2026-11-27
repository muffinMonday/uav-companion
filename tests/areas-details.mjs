// Community flying areas: the shared details panel, map selection and the setup-spot popup, in a real browser (desktop, 390 px phone, foldable). Private areas in every
// submission state, mocked public fixtures (approved only, anonymous or authorized attribution), weather privacy and caching, selection rules (interior, concave, overlap,
// drawing, spots), and Escape/focus. Screenshots go to tests/out/areas-details/.
import { chromium, CHANNEL, LATEST_SEEN, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/areas-details`; fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const KEY = 'uavzones.v1.areas';
const b = await chromium.launch({ channel: CHANNEL });
const MH = '#marker-host';
const UUID = (n) => `3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e${String(n).padStart(2, '0')}`;
const sq = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const rec = (id, name, ring, extra = {}) => ({ id, name, description: '', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [ring] }, spots: [], created: '2026-11-01T00:00:00.000Z', updated: '2026-11-02T00:00:00.000Z', ...extra });
const spot = (id, type, x, y, note = '') => ({ id, type, note, coordinates: [x, y] });
const A = rec('areaA1', 'Marina field', sq(103.8, 1.3, 0.01), { description: 'Open grass <img src=x onerror="window.__xss=1"> near the water', spots: [spot('spotA1', 'shelter', 103.803, 1.303, 'Covered <b>bench</b>'), spot('spotA2', 'open', 103.807, 1.307)] });
const C = rec('areaC1', 'C shaped park', [[103.8, 1.3], [103.81, 1.3], [103.81, 1.304], [103.804, 1.304], [103.804, 1.306], [103.81, 1.306], [103.81, 1.31], [103.8, 1.31], [103.8, 1.3]]);
const BIG = rec('areaB1', 'Big lawn', sq(103.8, 1.3, 0.01)), SMALL = rec('areaS1', 'Small corner', sq(103.8, 1.3, 0.003));
const iso = (n) => new Date(Date.now() + n * 3600e3).toISOString().slice(0, 13) + ':00';
const weatherBody = () => { const t = Array.from({ length: 30 }, (_, i) => iso(i)), f = (v) => t.map(() => v); return JSON.stringify({ utc_offset_seconds: 0, timezone_abbreviation: 'GMT', hourly: { time: t, temperature_2m: f(27.5), wind_speed_10m: f(3.2), wind_gusts_10m: f(7.4), precipitation_probability: f(40), precipitation: f(0.3), snowfall: f(0), snow_depth: f(0) } }); };

async function open({ vp = { width: 1300, height: 850 }, touch = false, areas = [A], prefs = {}, backend = false, weather = 'ok', zoom = 16 } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const wx = [];
  await ctx.route('**/api.open-meteo.com/**', (r) => { wx.push(r.request().url()); return weather === 'ok' ? r.fulfill({ status: 200, contentType: 'application/json', body: weatherBody() }) : r.abort(); });
  await ctx.addInitScript(() => { globalThis.__uavAreasExpose = true; });
  if (backend) await ctx.addInitScript(() => { globalThis.__uavAreasBackend = { available: () => true, signedIn: () => false, signIn: () => {}, onChange: () => () => {}, fire: () => {}, rpc: async () => ({ error: { message: 'x' } }) }; });
  await ctx.addInitScript(([seen, a, pr, z]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.305, lon: 103.805, zoom: z }, basemap: 'osm', holdHint: true, autoWeather: true, ...pr }));
    localStorage.setItem('uavzones.v1.areas', JSON.stringify({ v: 1, areas: a }));
  }, [LATEST_SEEN, areas, prefs, zoom]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation|zone data/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.waitForTimeout(250);
  return { ctx, p, wx };
}
/** Clicks at a fraction of the first community polygon's box (the shapes are drawn as SVG paths: the box of the path). */
async function tapShape(p, fx, fy, i = 0) {
  const bb = await p.locator('.community-area').nth(i).boundingBox();
  await p.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy);
}
const shown = (p) => p.locator(`${MH} .area-pop`).isVisible();
const txt = (p, sel) => p.locator(`${MH} ${sel}`).first().innerText();
let ctx, p, wx;

// ================= desktop: private area, never submitted
({ ctx, p, wx } = await open());
await p.evaluate(() => { window.__opened = []; });
await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(600);
ok(await txt(p, 'h3') === 'Marina field', 'a tap inside the polygon (not on its edge) opens the details panel');
ok(await p.locator('.community-area.is-selected').count() === 1, 'the selected polygon is highlighted');
ok(await p.locator(MH).getAttribute('data-mode') === 'side', 'desktop: the panel is the adaptive side dock');
ok(await p.locator(`${MH} .area-chip`).getAttribute('data-context') === 'private' && /Private draft/i.test(await txt(p, '.area-chip')) && /My flying area/i.test(await txt(p, '.area-caption')), 'header: My flying area, Private draft');
ok(/About 1[.,]\d+\s?(km²|m²)|1\.2\d km²|1,\d{3},\d{3} m²/.test(await txt(p, '.area-meta')) && /Last edited 2 Nov 2026/.test(await txt(p, '.area-meta')), 'header: approximate size and the last-edited date (not an observation date)');
ok(!/observed/i.test(await txt(p, '.area-meta')), 'no "observed" date is invented for a private draft');
ok(await p.locator(`${MH} .area-desc`).innerText() === 'Open grass <img src=x onerror="window.__xss=1"> near the water' && await p.locator(`${MH} .area-pop img`).count() === 0 && await p.evaluate(() => window.__xss) === undefined, 'the description is plain text: markup is shown, never interpreted');
ok(/Created by you/.test(await txt(p, '.area-byline')) && /not flight authorization/.test(await txt(p, '.area-disclaimer')), 'ownership line and the community disclaimer are visible');
const acts = await p.locator(`${MH} .area-secondary [data-act]`).evaluateAll((l) => l.map((e) => e.dataset.act));
ok(acts.join() === 'submit,edit,export,delete', `private, never submitted: Submit, Edit, Export, Delete (${acts})`);
ok(await p.locator(`${MH} .area-spot-item`).count() === 2 && /Pavilion/.test(await p.locator(`${MH} .area-spot-item`).first().innerText()) && /Covered <b>bench<\/b>/.test(await p.locator(`${MH} .area-spot-item`).first().innerText()), 'both setup spots are listed with type and note (plain text)');
// navigate goes to the area centre, in the map app from the settings
const href = await p.locator(`${MH} .area-pop a[href]`).first().getAttribute('href');
const ll = /(-?\d+\.\d+)[,%2C]+(-?\d+\.\d+)/.exec(decodeURIComponent(href));
ok(ll && Math.abs(+ll[1] - 1.305) < 0.0006 && Math.abs(+ll[2] - 103.805) < 0.0006, `Navigate goes to the centre of the area (${ll?.slice(1, 3)})`);
// recentring: the area's centre is at the middle of the free area (left of the dock)
const geo = await p.evaluate(() => { const r = document.querySelector('#marker-host').getBoundingClientRect(), pa = document.querySelector('.community-area.is-selected').getBoundingClientRect(); return { cx: pa.x + pa.width / 2, cy: pa.y + pa.height / 2, free: r.left / 2, mid: innerHeight / 2 }; });
ok(Math.abs(geo.cx - geo.free) < 40 && Math.abs(geo.cy - geo.mid) < 60, `the map is centred on the area in the free space (dx ${Math.round(geo.cx - geo.free)}, dy ${Math.round(geo.cy - geo.mid)})`);
await p.screenshot({ path: `${shots}/desktop-private.png` });
// weather: default automatic weather on -> one request, rounded coordinates, nothing but coordinates
await p.waitForSelector(`${MH} .area-wx .stat`); await p.waitForTimeout(300);
ok(wx.length === 1 && /latitude=1\.31&longitude=103\.81/.test(wx[0]) && !/Marina|grass|bench|areaA1/.test(wx[0]), `weather: one Open-Meteo request, coordinates rounded to about 1 km, no name or description (${wx[0]?.slice(0, 90)})`);
ok(/27\.5 °C/.test(await txt(p, '.area-wx')) && /7\.4 m\/s/.test(await txt(p, '.area-wx')) && await p.locator(`${MH} .rain`).count() === 1, 'weather: temperature, wind, gust and rain outlook are shown');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(!(await p.locator(MH).isVisible()) && await p.locator('.community-area.is-selected').count() === 0, 'Escape closes the panel and clears the highlight');
await tapShape(p, 0.4, 0.6); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(500);
ok(wx.length === 1, 'opening the same area again reuses the cached forecast (no second request)');
// spot clicks do not open the parent; the popup is a card with Navigate and View flying area
await p.click(`${MH} .pop-close`); await p.waitForTimeout(300);
await p.locator('.area-spot').first().click(); await p.waitForSelector('.area-popup');
ok(!(await p.locator(MH).isVisible()), 'tapping a setup spot opens its popup, not the parent area');
const pop = p.locator('.area-popup');
ok(/Pavilion \/ shelter/.test(await pop.innerText()) && /Covered <b>bench<\/b>/.test(await pop.innerText()) && /Marina field/.test(await pop.innerText()) && await pop.locator('a[href]').count() === 1 && await pop.locator('[data-act="view-area"]').count() === 1, 'the spot popup shows type, note, parent, Navigate and View flying area');
await p.screenshot({ path: `${shots}/desktop-spot-popup.png` });
await pop.locator('[data-act="view-area"]').click(); await p.waitForSelector(`${MH} .area-pop`);
ok(await txt(p, 'h3') === 'Marina field', 'View flying area opens the parent details');
// a spot chosen in the panel zooms to it and opens its popup
await p.locator(`${MH} .area-spot-item`).nth(1).click(); await p.waitForTimeout(700);
ok(await p.locator('.area-popup').count() === 1 && await p.locator('.area-popup').isVisible(), `choosing a spot in the panel shows it on the map with its popup (${await p.locator('.area-popup').count()} popups, ${await p.locator('.area-spot').count()} spots)`);
// drawing: no selection
await p.keyboard.press('Escape');
await ctx.close();

// ================= zoomed out: the panel lists every spot, the map shows none; edit keeps spots
({ ctx, p, wx } = await open({ zoom: 14 }));
ok(await p.locator('.leaflet-marker-pane .area-spot').count() === 0, 'zoomed out (about 2.7 km scale): no setup spot markers');
await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(500);
ok(await p.locator('.leaflet-marker-pane .area-spot').count() === 0 && await p.locator(`${MH} .area-spot-item`).count() === 2, 'selecting at that zoom does not bring the markers back; the panel lists both spots');
await p.locator(`${MH} [data-act="edit"]`).click(); await p.waitForTimeout(500);
ok(!(await p.locator(MH).isVisible()) && await p.locator('.leaflet-marker-pane .area-spot').count() === 2, 'Edit closes the panel and the editor shows and can move the spots whatever the scale');
await tapShape(p, 0.5, 0.5).catch(() => {}); await p.waitForTimeout(300);
ok(!(await p.locator(MH).isVisible()), 'while editing, a tap inside the area does not open the details panel');
await ctx.close();

// ================= selection rules: concave, overlapping, drawing
({ ctx, p } = await open({ areas: [C] }));
const cb = await p.locator('.community-area').first().boundingBox();
await p.mouse.click(cb.x + cb.width * 0.7, cb.y + cb.height * 0.5); await p.waitForTimeout(500);
ok(!(await shown(p)), 'concave area: a tap in the notch (outside the shape) selects nothing');
await p.mouse.click(cb.x + cb.width * 0.15, cb.y + cb.height * 0.5); await p.waitForSelector(`${MH} .area-pop`);
const href2 = await p.locator(`${MH} .area-pop a[href]`).first().getAttribute('href');
const c2 = /(-?\d+\.\d+)[,%2C]+(-?\d+\.\d+)/.exec(decodeURIComponent(href2));
ok(c2 && +c2[2] < 103.8045 && +c2[2] > 103.8 || (c2 && (+c2[1] > 1.304 && +c2[1] < 1.306 ? false : true)), `concave area: the navigate target is inside the shape, not in the notch (${c2?.slice(1, 3)})`);
await ctx.close();
({ ctx, p } = await open({ areas: [BIG, SMALL] }));
const bb = await p.locator('.community-area').first().boundingBox();
await p.mouse.click(bb.x + bb.width * 0.15, bb.y + bb.height * 0.85); await p.waitForSelector(`${MH} .area-pop`);
ok(await txt(p, 'h3') === 'Small corner', 'overlapping areas: a tap in the overlap opens the smaller area');
await p.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height * 0.3); await p.waitForTimeout(600);
ok(await txt(p, 'h3') === 'Big lawn' && await p.locator('.community-area.is-selected').count() === 1, 'a tap outside the small one opens the large one, replacing the panel and moving the highlight');
await p.mouse.click(5, 400); await p.waitForTimeout(400);
ok(!(await shown(p)), 'a tap on blank map closes the panel');
// drawing blocks selection
await p.evaluate(() => document.querySelector('[data-tool="areas"]').click()); await p.waitForSelector('#areas-panel:not([hidden])');
await p.click('#areas-panel [data-act="draw-polygon"]'); await p.waitForTimeout(300);
await p.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height * 0.3); await p.waitForTimeout(400);
ok(!(await shown(p)), 'drawing: a tap inside an existing area does not open details');
await ctx.close();

// ================= lifecycle states (guest, no account) and the actions each allows
const sub = (status, extra = {}) => ({ status, key: 'k'.repeat(20), contentHash: '0'.repeat(8), areaId: UUID(1), revisionId: UUID(2), revisionNo: 1, submittedAt: '2026-11-10T10:00:00.000Z', ...extra });
const states = [['pending', sub('pending'), 'pending', 'edit,withdraw,export', /Pending review/], ['rejected', sub('rejected', { reason: 'Too close to a school' }), 'rejected', 'submit,edit,export,delete', /Too close to a school/],
  ['withdrawn', sub('withdrawn'), 'withdrawn', 'submit,edit,export,delete', /Withdrawn/], ['approved', sub('approved'), 'public-approved', 'submit,export,edit,delete', /Approved community area/]]; // the fixture's hash differs from the draft, so it counts as changed since approval: a revision can be submitted
for (const [name, s, context, expected, text] of states) {
  ({ ctx, p } = await open({ areas: [rec('area' + name, 'State ' + name, sq(103.8, 1.3, 0.01), { submission: s })], backend: true }));
  await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`);
  const got = await p.locator(`${MH} .area-secondary [data-act]`).evaluateAll((l) => l.map((e) => e.dataset.act));
  ok(await p.locator(`${MH} .area-chip`).getAttribute('data-context') === context && text.test(await txt(p, '.area-pop')) && got.join() === expected, `${name}: context ${context}, status text and actions (${got})`);
  if (name === 'pending') {
    await p.locator(`${MH} [data-act="edit"]`).click();
    ok(/submitted version stays exactly as it is/.test(await txt(p, '.area-confirm')), 'pending: editing the draft asks first and says the submitted version is untouched');
    await p.locator(`${MH} [data-act="cancel"]`).click();
    const before = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.areas')).areas[0].submission));
    await p.locator(`${MH} [data-act="edit"]`).click(); await p.locator(`${MH} [data-act="confirm-edit"]`).click(); await p.waitForTimeout(400);
    ok(!(await shown(p)) && await p.locator('.area-bar:not([hidden])').count() === 1 && before === await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.areas')).areas[0].submission)), 'pending: confirmed Edit opens the editor; the submission reference is unchanged');
  }
  if (name === 'approved') {
    await p.screenshot({ path: `${shots}/desktop-approved-private.png` });
    ok(/Submit changes for review/.test(await p.locator(`${MH} [data-act="submit"]`).textContent()) && /not submitted/.test(await txt(p, '.area-status, .area-pop')), 'approved with an edited draft: "Submit changes for review", and the status says the published version is unchanged');
    await p.locator(`${MH} [data-act="delete"]`).click();
    ok(/published community area stays public/.test(await txt(p, '.area-confirm')), 'approved: deleting the local copy asks first and says the public area stays');
    await p.locator(`${MH} [data-act="cancel"]`).click();
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.areas')).areas.length) === 1, 'approved: cancelling keeps the local copy');
  }
  await ctx.close();
}

// ================= public fixtures (mocked approved records; no discovery exists yet)
const pub = (o = {}) => ({ area_id: UUID(7), status: 'approved', published: true, name: 'Harbour park', description: 'Wide <u>lawn</u>', geometry: { type: 'Polygon', coordinates: [sq(103.8, 1.3, 0.01)] }, spots: [spot('ps1', 'seating', 103.803, 1.303, 'Picnic tables')], approved_at: '2026-11-20T10:00:00Z', last_observed_on: '2026-11-18', attribution: null, ...o });
({ ctx, p } = await open({ areas: [] }));
ok(await p.evaluate((r) => __uavAreas.details.openPublic(r), pub()), 'an approved, published fixture opens');
await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(500);
ok(await p.locator(`${MH} .area-chip`).getAttribute('data-context') === 'public-approved' && /Approved community area/i.test(await txt(p, '.area-chip')) && await p.locator(`${MH} .area-secondary`).count() === 0, 'public: Approved community area, no Edit/Delete/Submit/Withdraw');
ok(/Community contributor/i.test(await txt(p, '.area-byline')) && /Last observed 18 Nov 2026/.test(await txt(p, '.area-meta')) && /Approved 20 Nov 2026/.test(await txt(p, '.area-meta')), 'public: neutral contributor label; the approval and observation dates are separate');
ok(await p.locator(`${MH} .area-pop a[href]`).count() === 1 && await p.locator(`${MH} .area-spot-item`).count() === 1 && /Wide <u>lawn<\/u>/.test(await txt(p, '.area-desc')), 'public: the same Navigate, spots and plain-text description as a private area');
ok(await p.locator('.community-area.is-selected').count() === 1, 'public: the fixture polygon is highlighted by the same layer');
await p.screenshot({ path: `${shots}/desktop-public-anonymous.png` });
for (const bad of [pub({ status: 'pending' }), pub({ status: 'rejected' }), pub({ published: false }), pub({ status: 'withdrawn' })]) {
  await p.evaluate(() => __uavAreas.details.close());
  ok(!(await p.evaluate((r) => __uavAreas.details.openPublic(r), bad)) && !(await shown(p)), `public: a ${bad.status}${bad.published === false ? ' (unpublished)' : ''} record is refused`);
}
ok(await p.evaluate((r) => __uavAreas.details.openPublic(r), pub({ attribution: { display_name: 'Mei Lin', avatar: 'fox', bio: 'private bio', location: 'Wuhan', friend_code: 'ZZZ', xp: 120, online: true, share_profile: true } })), 'an authorized contributor fixture opens');
await p.waitForSelector(`${MH} .area-byline .pv-trigger`);
ok(/Mei Lin/.test(await txt(p, '.area-byline')) && !/Community contributor/i.test(await txt(p, '.area-byline')), 'authorized attribution: the display name is shown');
await p.locator(`${MH} .area-byline .pv-trigger`).click(); await p.waitForSelector('.pv');
const pvText = await p.locator('.pv').first().innerText();
ok(/Mei Lin/.test(pvText) && !/private bio|Wuhan|ZZZ|120|online/i.test(pvText) && await p.locator('.pv .avatar').count() === 1, 'the profile popover shows only the name and avatar: no bio, location, friend code, XP or online status');
await ctx.close();

// ================= weather privacy: automatic weather off -> explicit action only; failure state
({ ctx, p, wx } = await open({ prefs: { autoWeather: false } }));
await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(600);
ok(wx.length === 0 && await p.locator(`${MH} .wx-btn`).count() === 1, 'automatic weather off: no request, the existing "Show weather here" action is offered');
await p.locator(`${MH} .wx-btn`).click(); await p.waitForTimeout(900);
ok(wx.length === 1 && !(await shown(p)), 'pressing it fetches once through the existing weather popup (the panel gives way, as for a marker)');
await ctx.close();
({ ctx, p, wx } = await open({ weather: 'fail' }));
await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(1200);
ok(/Weather unavailable right now/.test(await txt(p, '.area-wx')) && await p.locator(`${MH} [data-act="weather-retry"]`).count() === 1, 'a failed forecast shows the existing unavailable message and a retry');
await ctx.close();
({ ctx, p, wx } = await open({ prefs: { weatherPrecision: 'precise' } }));
await tapShape(p, 0.5, 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(900);
ok(wx.length === 1 && /latitude=1\.3050&longitude=103\.8050/.test(wx[0]), `precise precision setting is respected (${wx[0]?.slice(0, 80)})`);
await ctx.close();

// ================= phone (390 px): bottom sheet; foldable: side dock
({ ctx, p } = await open({ vp: { width: 390, height: 780 }, touch: true }));
const bb2 = await p.locator('.community-area').first().boundingBox();
await p.touchscreen.tap(bb2.x + bb2.width * 0.5, bb2.y + bb2.height * 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(600);
ok(await p.locator(MH).getAttribute('data-mode') === 'bottom' && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: a bottom sheet, no horizontal scroll');
const sh = await p.evaluate(() => { const r = document.querySelector('#marker-host').getBoundingClientRect(), pa = document.querySelector('.community-area.is-selected').getBoundingClientRect(); return { top: r.top, cy: pa.y + pa.height / 2 }; });
ok(sh.cy < sh.top, `phone: the area is centred above the sheet (area middle ${Math.round(sh.cy)}, sheet top ${Math.round(sh.top)})`);
await p.screenshot({ path: `${shots}/phone-private.png` });
await p.locator(`${MH} .pop-close`).tap(); await p.waitForTimeout(300);
await p.locator('.area-spot').first().tap(); await p.waitForSelector('.area-popup');
await p.waitForTimeout(600);
const pr = await p.locator('.area-popup').boundingBox();
ok(pr.x >= 0 && pr.x + pr.width <= 390 && pr.height < 380, `phone: the spot card fits the screen (x ${Math.round(pr.x)}, ${Math.round(pr.width)}x${Math.round(pr.height)})`);
await p.screenshot({ path: `${shots}/phone-spot-popup.png` });
await ctx.close();
({ ctx, p } = await open({ vp: { width: 840, height: 800 }, touch: true }));
const bb3 = await p.locator('.community-area').first().boundingBox();
await p.touchscreen.tap(bb3.x + bb3.width * 0.5, bb3.y + bb3.height * 0.5); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(500);
ok(['side', 'bottom'].includes(await p.locator(MH).getAttribute('data-mode')) && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `foldable 840 px: ${await p.locator(MH).getAttribute('data-mode')} mode, no horizontal scroll`);
await ctx.close();

await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
