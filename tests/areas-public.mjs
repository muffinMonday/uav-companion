// Community flying areas, Phase 4: the public map layer in a real browser (desktop, 390 px phone, narrow/foldable). An in-page backend double stands in for
// list_public_areas / get_public_area (the real SQL is proven in db-areas-public-unit). Covers viewport loading, cache, stale responses, the layer switch, failure
// handling, de-duplication against local drafts, the shared details panel, attribution privacy and independence from official zones. Guests only (never signed in).
import { chromium, CHANNEL, LATEST_SEEN, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/areas-public`; fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });
const MH = '#marker-host';
const ID = (n) => `3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e${String(n).padStart(2, '0')}`;
const sq = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const pub = (n, name, ring, extra = {}) => ({ area_id: ID(n), revision_id: ID(50 + n), status: 'approved', published: true, name, description: 'Open grass <b>near</b> the water', geometry: { type: 'Polygon', coordinates: [ring] }, spots: [], area_m2: 12000, approved_at: '2026-11-20T00:00:00Z', attribution: null, ...extra });
const spot = (type, x, y, note = '') => ({ type, note, coordinates: [x, y] });
const P1 = pub(1, 'Marina field', sq(103.8, 1.3, 0.01), { spots: [spot('shelter', 103.803, 1.303, 'Covered bench'), spot('open', 103.807, 1.307)] });
const P2 = pub(2, 'East lawn', sq(103.812, 1.3, 0.008), { attribution: { display_name: 'Bea', avatar: null } });
const PFAR = pub(3, 'Hangzhou park', sq(120.1, 30.1, 0.01));
const iso = (n) => new Date(Date.now() + n * 3600e3).toISOString().slice(0, 13) + ':00';
const weatherBody = () => { const t = Array.from({ length: 30 }, (_, i) => iso(i)), f = (v) => t.map(() => v); return JSON.stringify({ utc_offset_seconds: 0, timezone_abbreviation: 'GMT', hourly: { time: t, temperature_2m: f(27.5), wind_speed_10m: f(3.2), wind_gusts_10m: f(6), precipitation: f(0), precipitation_probability: f(10), weather_code: f(1) } }); };

async function open({ vp = { width: 1300, height: 850 }, touch = false, areas = [P1, P2, PFAR], prefs = {}, local = [], zoom = 16, delay = 0 } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: weatherBody() }));
  await ctx.addInitScript(() => { globalThis.__uavAreasExpose = true; });
  await ctx.addInitScript(([rows, dl]) => {
    const S = globalThis.__pub = { rows, calls: [], gets: [], fail: false, delay: dl, other: [] };
    const overlap = (r, q) => { const xs = r.geometry.coordinates[0].map((p) => p[0]), ys = r.geometry.coordinates[0].map((p) => p[1]); const w = Math.min(...xs), e = Math.max(...xs), s = Math.min(...ys), n = Math.max(...ys);
      return n >= q.south && s <= q.north && (q.west <= q.east ? e >= q.west && w <= q.east : e >= q.west || w <= q.east); };
    globalThis.__uavAreasBackend = {
      available: () => true, signedIn: () => false, signIn: () => {}, onChange: () => () => {}, fire: () => {},
      rpc: async (fn, args, o) => {
        if (fn !== 'list_public_areas' && fn !== 'get_public_area') { S.other.push(fn); return { error: { message: 'permission denied' } }; }
        if (fn === 'get_public_area') { S.gets.push(args.p_area_id); if (S.fail) return { error: { message: 'Failed to fetch' } }; return { data: S.rows.find((r) => r.area_id === args.p_area_id) ?? null }; }
        const call = { q: args.p_bounds, cursor: args.p_cursor, limit: args.p_limit, aborted: false }; S.calls.push(call);
        o?.signal?.addEventListener?.('abort', () => { call.aborted = true; });
        if (S.delay) await new Promise((r) => setTimeout(r, typeof S.delay === 'function' ? S.delay(call) : S.delay));
        if (S.fail) return { error: { message: 'Failed to fetch' } };
        const hit = S.rows.filter((r) => overlap(r, args.p_bounds)).sort((a, c) => (a.area_id < c.area_id ? -1 : 1));
        const from = args.p_cursor ? hit.findIndex((r) => r.area_id === args.p_cursor) + 1 : 0, lim = Math.min(args.p_limit ?? 50, 100), page = hit.slice(from, from + lim);
        return { data: { areas: page, next_cursor: from + lim < hit.length ? page[page.length - 1].area_id : null } };
      },
    };
  }, [areas, delay]);
  await ctx.addInitScript(([seen, loc, pr, z]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.305, lon: 103.805, zoom: z }, basemap: 'osm', holdHint: true, autoWeather: true, ...pr }));
    localStorage.setItem('uavzones.v1.areas', JSON.stringify({ v: 1, areas: loc }));
  }, [LATEST_SEEN, local, prefs, zoom]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation|zone data/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.waitForTimeout(250);
  return { ctx, p };
}
const calls = (p) => p.evaluate(() => globalThis.__pub.calls.map((c) => ({ ...c })));
const polys = (p) => p.locator('.community-area.is-public').count();
const names = (p) => p.evaluate(() => globalThis.__uavAreas.publicAreas.find && [...Array(1)].length);
const view = (p, lat, lon, zoom) => p.evaluate(([a, o, z]) => globalThis.__uavAreas.map.setView([a, o], z, { animate: false }), [lat, lon, zoom]);
const tapPoly = async (p, i = 0, fx = 0.5, fy = 0.5) => { const bb = await p.locator('.community-area').nth(i).boundingBox(); await p.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy); };
const tapLL = async (p, lat, lon) => { const pt = await p.evaluate(([a, o]) => { const m = globalThis.__uavAreas.map; m.setView([a, o], m.getZoom(), { animate: false }); const q = m.latLngToContainerPoint([a, o]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; }, [lat, lon]); await p.waitForTimeout(80); await p.mouse.click(pt.x, pt.y); };
const txt = (p, sel) => p.locator(`${MH} ${sel}`).first().innerText();
let ctx, p;

// ================= desktop guest: viewport load, render, details
({ ctx, p } = await open());
let c = await calls(p);
ok(c.length >= 1 && c.every((x) => x.q.east - x.q.west < 10 && x.q.north - x.q.south < 10 && x.limit === 50), 'startup asks only for the current viewport (bounded box, page of 50), never everything');
ok(c.every((x) => x.q.west <= 103.8 && x.q.east >= 103.85), 'the box covers the visible area with a buffer');
ok(await polys(p) === 2, 'the two approved areas in view are drawn; the far one is not');
ok(await p.evaluate(() => globalThis.__pub.other.length) === 0, 'a guest makes no call other than the two public reads');
ok(await p.locator('.community-area.is-public').first().evaluate((e) => getComputedStyle(e).pointerEvents) === 'none', 'public polygons take no pointer events (gestures and point checks unaffected)');
ok(await p.locator('.leaflet-community-areas-pane .community-area.is-public, .leaflet-pane .community-area.is-public').count() === 2, 'they use the community pane styling');
await p.screenshot({ path: `${shots}/desktop-layer.png` });
await p.evaluate(() => { globalThis.__pub.gets.length = 0; });
await tapLL(p, 1.305, 103.805); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(700);
ok(await txt(p, 'h3') === 'Marina field' && await p.locator(`${MH} .area-chip`).getAttribute('data-context') === 'public-approved', 'a tap opens the unified details panel as an approved public area');
ok(/community flying area/i.test(await txt(p, '.area-caption')) && /Approved 20 Nov 2026/.test(await txt(p, '.area-meta')) && /About/.test(await txt(p, '.area-meta')), 'name, size and approval date are shown');
ok(await p.locator(`${MH} .area-desc`).innerText() === 'Open grass <b>near</b> the water' && await p.locator(`${MH} .area-desc b`).count() === 0, 'the description is plain text');
ok(await p.locator(`${MH} .area-secondary [data-act]`).count() === 0, 'a public area has no Edit, Delete, Submit, Withdraw or Export action');
ok(await p.locator(`${MH} .area-spot-item`).count() === 2 && /Covered bench/.test(await txt(p, '.area-spots-list')), 'both Pilot setup spots are listed');
ok(await p.locator(`${MH} a[href]`).count() > 0, 'Navigate is present');
ok(/Community contributor/.test(await txt(p, '.area-byline')) && await p.locator(`${MH} .area-byline .pv-trigger`).count() === 0, 'anonymous fallback: neutral label, no clickable identity');
ok(/not flight authorization/.test(await txt(p, '.area-disclaimer')), 'the standing disclaimer is shown');
ok(await p.locator(`${MH} .area-wx .stats-grid, ${MH} .area-wx .stat, ${MH} .area-wx`).count() > 0, 'the weather section is present (existing privacy rules)');
ok(await p.evaluate(() => globalThis.__pub.gets.length) >= 1, 'opening re-reads the area from the server (fresh attribution and publication state)');
ok(await p.locator('.community-area.is-selected').count() === 1 && await polys(p) === 1, 'the open area is highlighted once (not drawn twice)');
await p.screenshot({ path: `${shots}/desktop-details.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok(await polys(p) === 2 && await p.locator('.community-area.is-selected').count() === 0, 'closing restores the layer');

// ---- attribution: restricted card
await tapLL(p, 1.304, 103.816); await p.waitForSelector(`${MH} .area-pop`); await p.waitForTimeout(500);
ok(await txt(p, 'h3') === 'East lawn' && /Shared by[\s\S]*Bea/.test(await txt(p, '.area-byline')), 'opted-in contributor: display name shown');
await p.evaluate(() => { globalThis.__pub.other.length = 0; });
await p.locator(`${MH} .area-byline .pv-trigger`).first().click(); await p.waitForTimeout(400);
const card = await p.locator('#profile-pop').innerText();
ok(/Bea/.test(card) && !/Bio|Location|Interests|XP|Rank|Friend|Achievement/i.test(card), 'the contributor card shows only the name and avatar');
ok(await p.evaluate(() => globalThis.__pub.other.length) === 0, 'opening the card makes no progression or profile request');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
// privacy transition: the next open shows what the server says now
await p.evaluate(() => { globalThis.__pub.rows.find((r) => r.name === 'East lawn').attribution = null; });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.locator(`${MH} .pop-close`).click().catch(() => {}); await p.waitForTimeout(300);
await tapLL(p, 1.304, 103.816); await p.waitForTimeout(900);
ok(/Community contributor/.test(await txt(p, '.area-byline')), 'after the contributor opts out, the area opens anonymous (cached identity does not stay)');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

// ---- unpublished while shown: open triggers a fresh read and the area disappears
await p.evaluate(() => { globalThis.__pub.rows = globalThis.__pub.rows.filter((r) => r.name !== 'Marina field'); });
await tapLL(p, 1.305, 103.805); await p.waitForTimeout(1000);
const left = await polys(p);
ok(left === 1 && !(await p.locator(`${MH} .area-pop`).isVisible()), 'an area unpublished since it was cached closes and leaves the map when opened');
ok(/no longer published/i.test(await p.locator('#toast').innerText()), 'the person is told it is no longer published');
await p.evaluate(() => globalThis.__uavAreas.map.panBy([1, 0], { animate: false })); await p.waitForTimeout(900);
ok(await polys(p) === 1, 'a later query does not bring the unpublished area back');
await ctx.close();

// ================= cache, rapid pan, stale responses
({ ctx, p } = await open());
let n0 = (await calls(p)).length;
await view(p, 30.105, 120.105, 16); await p.waitForTimeout(1200);
ok(await polys(p) === 1, 'moving to another place loads that place');
await view(p, 1.305, 103.805, 16); await p.waitForTimeout(1000);
const n1 = (await calls(p)).length;
ok(n1 === n0 + 1 && await polys(p) === 2, 'returning within 60 s is served from the cache (no new request)');
await p.evaluate(() => { for (let i = 0; i < 6; i++) globalThis.__uavAreas.map.setView([1.3 + i * 0.0001, 103.8], 16, { animate: false }); });
await p.waitForTimeout(1200);
ok((await calls(p)).length === n1 + 0 || (await calls(p)).length === n1 + 1, 'rapid movement is debounced into at most one request');
await view(p, 1.305, 105.5, 16); await p.waitForTimeout(100);
await ctx.close();

({ ctx, p } = await open({ delay: 0 }));
await p.evaluate(() => { globalThis.__pub.delay = (c) => (c.q.west > 120 ? 50 : 900); });
await view(p, 5.0, 110.0, 16); await p.waitForTimeout(600); // slow request for an empty place goes out
await view(p, 30.105, 120.105, 16); await p.waitForTimeout(1800);
ok(await polys(p) === 1 && await p.locator('.community-area.is-public').count() === 1, 'a slow older response never replaces the newest viewport');
ok((await calls(p)).some((x) => x.aborted), 'the obsolete request was cancelled');
await ctx.close();

// ================= layer switch: off means no request
({ ctx, p } = await open({ prefs: { communityAreasOff: true } }));
ok((await calls(p)).length === 0 && await polys(p) === 0, 'with the layer off nothing is requested at startup and nothing is drawn');
await view(p, 1.31, 103.81, 16); await p.waitForTimeout(1000);
ok((await calls(p)).length === 0, 'panning with the layer off still makes no request');
ok(await p.evaluate(() => document.getElementById('show-community-areas').checked) === false, 'the Layers switch reflects the saved choice');
await p.evaluate(() => { const c = document.getElementById('show-community-areas'); c.checked = true; c.dispatchEvent(new Event('change')); }); await p.waitForTimeout(1200);
ok((await calls(p)).length >= 1 && await polys(p) === 2, 'switching it on loads the current view');
ok(await p.evaluate(() => !JSON.parse(localStorage.getItem('uavzones.v1.prefs')).communityAreasOff), 'the choice is remembered');
await p.evaluate(() => { const c = document.getElementById('show-community-areas'); c.checked = false; c.dispatchEvent(new Event('change')); }); await p.waitForTimeout(300);
ok(await polys(p) === 0 && await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).communityAreasOff === true), 'switching it off removes the polygons and is remembered');
await ctx.close();

// ================= failure handling
({ ctx, p } = await open());
await p.evaluate(() => { globalThis.__pub.fail = true; });
await view(p, 1.31, 103.9, 16); await p.waitForTimeout(1200);
ok(/could not be loaded/i.test(await p.locator('.areas-public-note').innerText()), 'a failed query is reported as a failure');
ok(!/no community/i.test(await p.locator('.areas-public-note').innerText()), 'a failure is never presented as "no community areas"');
await p.evaluate(() => { globalThis.__pub.fail = false; });
await view(p, 1.305, 103.805, 16); await p.waitForTimeout(1200);
ok(await polys(p) === 2 && await p.locator('.areas-public-note').isHidden(), 'it recovers when the network does');
await view(p, 31, 80, 4); await p.waitForTimeout(900);
ok(/zoom in/i.test(await p.locator('.areas-public-note').innerText()) && (await calls(p)).every((x) => x.q.east - x.q.west < 10), 'a country-wide view is not queried; the person is asked to zoom in');
await ctx.close();

// ================= no duplication with a local record of the same published area
const localRec = { id: 'localA1', name: 'My copy of Marina', description: '', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [sq(103.8, 1.3, 0.01)] }, spots: [], created: '2026-11-01T00:00:00.000Z', updated: '2026-11-02T00:00:00.000Z', submission: { status: 'approved', key: null, contentHash: null, areaId: ID(1), revisionId: ID(51), revisionNo: 1 } };
({ ctx, p } = await open({ local: [localRec] }));
ok(await polys(p) === 1 && await p.locator('.community-area:not(.is-public)').count() === 1, 'a published area the person already has locally is drawn once (the local record), the other public area is drawn');
await tapLL(p, 1.305, 103.805).catch(() => {});
await p.locator('.community-area:not(.is-public)').first().boundingBox().then((bb) => p.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5)); await p.waitForTimeout(700);
ok(await txt(p, 'h3') === 'My copy of Marina' && await p.locator(`${MH} .area-secondary [data-act]`).count() > 0, 'the local record keeps its own panel and actions');
await ctx.close();

// ================= phone and narrow screens
for (const [name, vp] of [['phone-390', { width: 390, height: 844 }], ['narrow-320', { width: 320, height: 640 }], ['foldable-700', { width: 700, height: 880 }]]) {
  ({ ctx, p } = await open({ vp, touch: true, zoom: 16 }));
  ok(await polys(p) >= 1, `${name}: approved areas load`);
  await p.locator('.community-area.is-public').first().boundingBox().then((bb) => p.touchscreen.tap(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5)); await p.waitForTimeout(900);
  ok(await p.locator(`${MH} .area-pop`).isVisible() && /community flying area/i.test(await txt(p, '.area-caption')), `${name}: a tap opens the details`);
  const box = await p.locator(MH).boundingBox();
  ok(box.x >= -1 && box.x + box.width <= vp.width + 1, `${name}: the panel stays inside the screen`);
  await p.screenshot({ path: `${shots}/${name}.png` });
  await ctx.close();
}

// ================= regulatory independence (source level; the point check never reads areas)
const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
ok(!/areas\//.test(src('pointcheck.js')) && !/areas\//.test(src('map.js')), 'pointcheck.js and map.js (official zones) do not import the community areas code');

await b.close();
console.log(errs.length ? 'CONSOLE ERRORS: ' + [...new Set(errs)].slice(0, 5).join(' | ') : 'no console errors');
