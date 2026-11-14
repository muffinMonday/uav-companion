// The dashboard along the bottom of the map: its three states, how it starts, its cards, and how it shares the screen with the side panel.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TODAY = iso(0);
const trips = [
  { id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z', checklist: [{ text: 'Batteries', done: true }, { text: 'Permit', done: false }] },
  { id: 't3', name: 'Under way', startDate: iso(-1), endDate: iso(1), description: '', color: '#00897b', created: '2026-01-03T00:00:00.000Z' },
];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('a', 'Airport', 30.78, 114.21, { tripId: 't1', date: iso(5), order: 1 }),
  mk('tw', 'Today stop', 30.6, 114.31, { tripId: 't3', date: iso(0), order: 1 }),
  mk('tw2', 'Second stop', 30.61, 114.32, { tripId: 't3', date: iso(0), order: 2 }),
];
const RETURNING = { showOnStart: true, welcomed: true, seen: LATEST_SEEN };

const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile, { dash = RETURNING, data = true, backup = null, hash = '' } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([d, withData, po, tr, bk]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    if (d) localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d }));
    else localStorage.removeItem('uavzones.v1.dash');
    if (withData) { localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); }
    if (bk) localStorage.setItem('uavzones.v1.lastBackup', bk);
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
  }, [dash, data, items, trips, backup]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}
const stateOf = (p) => p.evaluate(() => (!document.getElementById('dash').hidden ? 'expanded' : !document.getElementById('dash-peek').hidden ? 'peek' : !document.getElementById('dash-tab').hidden ? 'hidden' : 'none'));
const lift = (p) => p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dash-lift')) || 0);
const dashSaved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.dash') || '{}'));
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; });

// ================= a returning visitor on a desktop
let { ctx, p } = await open({ width: 1300, height: 850 }, false, { backup: new Date(Date.now() - 45 * 86400000).toISOString() });
ok(await stateOf(p) === 'expanded', 'a returning visitor on a desktop starts with the dashboard open');
const txt = await p.$eval('#dash-body', (e) => e.innerText.replace(/\n+/g, ' | '));
ok(/Under way/.test(txt) && /Day 2 of 3/.test(txt), 'the trip card shows the trip under way first, with its day: ' + txt.slice(0, 90));
ok(/Today/.test(txt) && /Today stop/.test(txt) && /Second stop/.test(txt), 'a trip under way lists today\'s stops');
ok(/1 of 2/.test(txt), 'with ‹ 1 of 2 › to move through the coming trips');
ok(/Back up your markers/.test(txt) && /45 days ago/.test(txt), 'a backup 45 days old gets a reminder');
ok(/Fly in/.test(txt) && (await p.locator('#dash-body .btn', { hasText: 'Singapore' }).count()) === 1, 'there is a button for each covered region');
ok((await p.locator('.dash-guide').count()) === 0 && !/What’s new/.test(txt), 'Help is not showing and there is no What\'s new for a visitor who has seen it');
await p.locator('#dash-body .dash-stop', { hasText: 'Today stop' }).click(); await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
ok((await p.textContent('.poi-pop h3')) === 'Today stop', 'tapping a stop opens it on the map');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button').click()); await p.waitForTimeout(300);
await p.locator('#dash-body .btn', { hasText: 'Open trip' }).click(); await p.waitForTimeout(400);
ok(await p.isVisible('#trip-detail') && /Under way/.test(await p.textContent('#trip-detail .trip-detail-title')), 'Open trip opens that trip\'s detail screen in the Trips tab');
await p.click('#trip-detail >> text=‹ Trips');
await p.locator('#dash-body .dash-trip-nav .btn').nth(1).click(); await p.waitForTimeout(200);
ok(/Hubei spring/.test(await p.textContent('#dash-body .dash-trip-head')) && /2 of 2/.test(await p.textContent('#dash-body .dash-trip-nav')) && !/Today stop/.test(await p.textContent('#dash-body .dash-trip')) && await p.locator('#dash-body .dash-trip-nav .btn').nth(1).isDisabled(), '› shows the next trip (its own countdown, no Today list) and stops at the last');
ok(/1 of 2 checked/.test(await p.textContent('#dash-body .dash-trip')), 'the card shows that trip\'s checklist progress');
await p.locator('#dash-body .btn', { hasText: 'Open trip' }).click(); await p.waitForTimeout(400);
ok(/Hubei spring/.test(await p.textContent('#trip-detail .trip-detail-title')), 'Open trip then opens the trip that is showing');
await p.click('#trip-detail >> text=‹ Trips');
await p.locator('#dash-body .dash-trip-nav .btn').nth(0).click(); await p.waitForTimeout(200);
ok(/Under way/.test(await p.textContent('#dash-body .dash-trip-head')) && await p.locator('#dash-body .dash-trip-nav .btn').nth(0).isDisabled(), '‹ goes back to the first trip');
const dr = await rect(p, '#dash'), pr = await rect(p, '#panel');
ok(dr.r <= pr.x + 1, 'beside the open side panel the dashboard stops short of it');
await p.locator('#dash-body .btn', { hasText: 'Singapore' }).click(); await p.waitForTimeout(1300);
const view = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).view);
ok(Math.abs(view.lat - 1.35) < 0.5 && Math.abs(view.lon - 103.8) < 0.5, 'the Singapore button centres the map there: ' + JSON.stringify(view));
await p.click('#tab-config'); await p.click('#help-open'); await p.waitForTimeout(300);
ok((await p.locator('#dash-body .dash-help-view').count()) === 1 && (await p.locator('#dash-body .dash-tasks').count()) === 0 && (await p.getAttribute('#dash-help', 'aria-pressed')) === 'true', 'Help (Map Configs) opens the dashboard straight into the Help subview');

// the three states
const scaleY = () => p.$eval('.leaflet-control-scale', (e) => Math.round(e.getBoundingClientRect().y));
const expandedScale = await scaleY();
const dashBottom = (await rect(p, '#dash')).b;
ok(dashBottom <= expandedScale + 1, 'the open dashboard stands above the scale bar: its bottom ' + Math.round(dashBottom) + ', the scale at ' + expandedScale);
await p.click('#dash-collapse'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'peek' && /Under way · Day 2 of 3/.test(await p.textContent('#dash-peek')) && await scaleY() === expandedScale, 'V drops it to a one-line strip with the countdown, and the scale bar has not moved');
ok((await rect(p, '#dash-peek')).b === dashBottom, 'the strip stands on the same line as the open dashboard');
const peek = await rect(p, '#dash-peek');
ok(peek.h < 50 && peek.w < 600, 'the strip is slim (' + Math.round(peek.h) + ' px high)');
await p.click('#dash-peek'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'expanded', 'the strip opens it again');
await p.click('#dash-close'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'hidden' && await p.isVisible('#dash-tab') && (await rect(p, '#dash-tab')).h < 40, 'close hides it behind a small ^ tab');
await p.click('#dash-tab'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'expanded', 'the tab brings it back');
await p.locator('#dash-snooze').focus(); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'peek', 'Escape inside it collapses it to the strip');
await p.click('#dash-peek');
await p.click('#dash-snooze'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'peek' && (await dashSaved(p)).hideUntil === TODAY, '"Do not show for today" drops it to the strip and remembers the day');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
ok(await stateOf(p) === 'peek', 'after a reload the same day it starts as the strip');
await ctx.close();

// ================= the start switch, what's new, a first visit, a share link
({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: { ...RETURNING, showOnStart: false } }));
ok(await stateOf(p) === 'hidden', 'with the start switch off it starts behind the ^ tab');
await p.click('#help-open'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'expanded' && !(await p.$eval('#dash-start', (e) => e.checked)), 'the Help card switch shows its state');
await p.evaluate(() => { const s = document.getElementById('dash-start'); s.checked = true; s.dispatchEvent(new Event('change')); });
ok((await dashSaved(p)).showOnStart === true, 'turning it on is remembered');
await ctx.close();

({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: { showOnStart: true, welcomed: true, seen: null, hideUntil: TODAY } }));
ok(await stateOf(p) === 'expanded' && /What’s new/.test(await p.textContent('#dash-body')), 'a What\'s new entry the visitor has not seen opens it, even after "not for today"');
ok(/Ranks and achievements/.test(await p.textContent('#dash-body')) && /Side Quests/.test(await p.textContent('#dash-body')) && /Quick setup/.test(await p.textContent('#dash-body')), 'the newest entries are announced to a visitor who has not seen them (at most three are shown)');
await p.click('#dash-collapse'); await p.waitForTimeout(250);
ok((await dashSaved(p)).seen === LATEST_SEEN, 'putting it away marks the entry as seen');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
ok(await stateOf(p) === 'peek' && !/What’s new/.test(await p.textContent('#dash-body')), 'the next start follows "not for today" again, and the entry is gone');
await ctx.close();

({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: null, data: false }));
ok(await stateOf(p) === 'peek' && await p.$eval('#splash', (d) => d.open), 'a first visit starts with the quick setup over the strip');
await p.click('#splash-skip'); await p.waitForTimeout(300);
ok(await stateOf(p) === 'expanded' && (await p.locator('#dash-body .dash-guide').count()) === 0 && (await p.locator('#task-check, #task-trip, #task-save').count()) === 3 && (await p.locator('#dash-body .dash-tasks .btn').count()) <= 4, 'skipping it opens the dashboard with the task shortcuts (Sessions only with an account build) and no guide');
await p.locator('#task-trip').click(); await p.waitForTimeout(400);
ok(await p.isVisible('#trip-form-card'), 'Plan a trip starts a new trip');
await ctx.close();

({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: { showOnStart: true, welcomed: true, seen: null }, hash: '#import=zz' }));
ok(await stateOf(p) === 'peek', 'a share link has the visitor\'s attention: the dashboard starts as the strip');
await ctx.close();

// ================= a phone: the dashboard and the side panel take turns
({ ctx, p } = await open({ width: 390, height: 780 }, true));
ok(await stateOf(p) === 'peek', 'on a phone a returning visitor starts with the strip');
await p.tap('#dash-peek'); await p.waitForTimeout(300);
ok(await stateOf(p) === 'expanded' && (await rect(p, '#dash')).r <= 390, 'it opens full width');
await p.tap('#dock button[data-tab=poi]'); await p.waitForTimeout(350);
ok(await stateOf(p) === 'peek' && !(await p.evaluate(() => document.getElementById('panel').hidden)), 'opening the panel tucks the dashboard to the strip');
await p.tap('#dash-peek'); await p.waitForTimeout(350);
ok(await stateOf(p) === 'expanded' && await p.evaluate(() => document.getElementById('panel').hidden), 'opening the dashboard closes the panel');
await ctx.close();
// ================= the welcome line and the route card
({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: { ...RETURNING, showOnStart: false } }));
await p.evaluate(() => document.getElementById('tab-poi').click()); await p.waitForTimeout(200);
await p.click('#poi-select'); await p.waitForTimeout(200);
await p.click('#poi-list .poi-item:has-text("Today stop")'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'hidden', 'one ticked place is not a route: the dashboard stays where it was');
await p.click('#poi-list .poi-item:has-text("Second stop")'); await p.waitForTimeout(450);
ok(await stateOf(p) === 'expanded' && await p.isVisible('#route-box') && /Route · 2 stops/.test(await p.textContent('#route-box')), 'the second stop opens the dashboard with a Route card');
ok((await p.$$eval('#route-stops .route-name', (e) => e.map((x) => x.textContent))).join() === 'Today stop,Second stop', 'its stops are in the order they were ticked');
await p.click('#route-reverse'); await p.waitForTimeout(250);
ok((await p.$$eval('#route-stops .route-name', (e) => e.map((x) => x.textContent))).join() === 'Second stop,Today stop' && /Open in Amap/.test(await p.textContent('#route-links')), 'Reverse turns it round, and the link for the route is there');
ok(/Welcome back!/.test(await p.textContent('#dash .dash-hello')) && /Under way is under way: day 2 of 3/.test(await p.textContent('#dash .dash-hello-sub')) && /not flight advice/.test(await p.textContent('#dash .dash-foot')), 'the welcome line says what is next and carries the reminder: ' + (await p.textContent('#dash .dash-welcome')).slice(0, 80));
await p.click('#sel-done'); await p.waitForTimeout(450);
ok(await stateOf(p) === 'hidden' && !(await p.isVisible('#route-box')), 'finishing selecting puts the dashboard back as it was, and the card is gone from view');
await ctx.close();

({ ctx, p } = await open({ width: 390, height: 780 }, true, { dash: { ...RETURNING, showOnStart: false } }));
await p.tap('#dock button[data-tab=poi]'); await p.waitForTimeout(300);
await p.tap('#poi-select'); await p.tap('#banner-review'); await p.waitForTimeout(350);
await p.tap('#poi-list .poi-item:has-text("Today stop")'); await p.waitForTimeout(200);
await p.tap('#poi-list .poi-item:has-text("Second stop")'); await p.waitForTimeout(450);
ok(await stateOf(p) === 'peek' && /Route · 2 stops/.test(await p.textContent('#dash-peek')), 'on a phone the strip says "Route · 2 stops" and the dashboard stays out of the way');
await p.tap('#dash-peek'); await p.waitForTimeout(400);
ok(await p.isVisible('#route-box') && await p.evaluate(() => document.getElementById('panel').hidden), 'tapping it shows the route card (and the panel steps aside)');
await ctx.close();

({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: null, data: false }));
await p.click('#splash-skip'); await p.waitForTimeout(300);
ok(/Welcome!/.test(await p.textContent('#dash .dash-hello')) && /plan your trip/.test(await p.textContent('#dash .dash-hello-sub')), 'a first visit gets the welcome message');
ok((await p.$eval('#dash .dash-hello', (e) => parseFloat(getComputedStyle(e).fontSize))) >= 24, 'the greeting is large');
await ctx.close();
// ================= more on the dashboard: quick actions, layers, your data, the map key, the checklist, today with check-in, the forecast
({ ctx, p } = await open({ width: 1300, height: 850 }, false));
ok((await p.locator('#task-check, #task-trip, #task-save').count()) === 3 && (await p.locator('#dash-body > .dash-tasks').count()) === 1, 'the task row is always on the default dashboard (Sessions needs an account build)');
ok(!(await p.locator('#dash .dash-guide, #dash .dash-key, #dash .dash-layers, #dash .dash-actions').count()), 'the guide, Map key, Layers and Quick actions cards are no longer on the default dashboard');
ok(!(await p.locator('#panel h2:has-text("About this map")').count()) && !(await p.locator('#panel h2:has-text("Backup")').count()), 'the cards they came from are gone from the side panel');
ok((await p.locator('#dash .dash-data > summary').count()) === 1 && !(await p.locator('#dash .dash-data').evaluate((e) => e.open)), 'Your data (export, import, share) is a folded row at the end');
// the checklist, to tick here
await p.locator('#dash-body .dash-trip-nav .btn').nth(1).click(); await p.waitForTimeout(200);
ok((await p.locator('#dash .dash-check li').count()) === 2, 'the next trip shows its checklist');
await p.locator('#dash .dash-check li', { hasText: 'Permit' }).locator('input').check(); await p.waitForTimeout(250);
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.trips')).trips.find((x) => x.id === 't1').checklist[1].done)) === true && /2 of 2 checked/.test(await p.textContent('#dash .dash-trip')), 'ticking an item here saves it in the trip');
// your data
await p.click('#dash .dash-data > summary');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dash .dash-data #poi-export')]);
await p.waitForTimeout(300);
ok(/\.geojson$/.test(dl.suggestedFilename()) && /Last backup/.test(await p.textContent('#dash .dash-data #poi-note')), 'Export in Your data downloads the file, and the row shows the date of the last backup');
await p.click('#dash .dash-data > summary');
// Save a place opens the POI explorer with Add a marker unfolded; the placing buttons are in it
const count0 = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.length);
await p.click('#task-save'); await p.waitForTimeout(500);
ok(await p.isVisible('#pane-poi') && await p.$eval('#poi-add', (e) => e.open), 'Save a place opens the Points of Interest explorer with Add a marker unfolded');
await p.click('#poi-center'); await p.waitForTimeout(500);
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.length)) === count0 + 1, 'At map centre in the explorer adds a marker');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);
await p.click('#poi-select'); await p.waitForTimeout(300);
ok(/Tap pins/.test(await p.textContent('#banner-text')), 'Select markers is still in the explorer');
await ctx.close();

async function openX({ prefs = {}, geo = null, weather = false } = {}) {
  const c = await b.newContext({ viewport: { width: 1300, height: 850 }, ...(geo ? { permissions: ['geolocation'], geolocation: geo } : {}) });
  await c.addInitScript(([po, tr, pf, rd]) => {
    const g = navigator.geolocation;
    if (g) { const w = g.watchPosition.bind(g), cl = g.clearWatch.bind(g); window.__watches = new Set(); g.watchPosition = (a, e, o) => { const id = w(a, e, o); window.__watches.add(id); return id; }; g.clearWatch = (id) => { window.__watches.delete(id); return cl(id); }; }
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...rd })); localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', ...pf }));
  }, [items, trips, prefs, RETURNING]);
  if (weather) await c.route('**/api.open-meteo.com/**', (route) => {
    const url = route.request().url();
    if (!url.includes('daily=')) return route.fulfill({ status: 500, body: '' });
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    const times = Array.from({ length: 16 }, (_, k) => iso(k));
    const one = () => ({ utc_offset_seconds: 28800, timezone_abbreviation: 'CST', daily: { time: times, weather_code: times.map(() => 0), temperature_2m_max: times.map(() => 22.4), temperature_2m_min: times.map(() => 14.1), precipitation_probability_max: times.map(() => 10), wind_speed_10m_max: times.map(() => 4.2) } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(n === 1 ? one() : Array.from({ length: n }, one)) });
  });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await pg.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500);
  return { c, pg };
}

// check my spot: the zone verdict for where I am
{
  const { c, pg } = await openX({ geo: { latitude: 30.5928, longitude: 114.3055, accuracy: 20 } });
  await pg.click('#dash-help'); await pg.evaluate(() => { document.querySelector('#dash-body details[data-topic=map]').open = true; });
  await pg.locator('#dash-body .btn', { hasText: 'Check where I am' }).click();
  await pg.waitForSelector('.leaflet-popup', { timeout: 15000 }); await pg.waitForTimeout(800);
  ok(/zone/i.test(await pg.textContent('.leaflet-popup')) && /Your location/.test(await pg.textContent('.leaflet-popup')), 'Check where I am (Help, Map basics) opens the zone verdict for where I am: ' + (await pg.textContent('.leaflet-popup')).replace(/\s+/g, ' ').slice(0, 70));
  await c.close();
}

// today, with check-in buttons, and the position read only while they show
{
  const { c, pg } = await openX({ geo: { latitude: 30.60, longitude: 114.31, accuracy: 20 }, prefs: { checkIn: true } });
  ok(/Today stop/.test(await pg.textContent('#dash .dash-today')) && (await pg.locator('#dash .dash-today .checkin-btn').count()) === 2, 'a trip under way lists today\'s stops, each with a Check in button');
  ok((await pg.evaluate(() => window.__watches.size)) === 1, 'the position is being watched while they are on show');
  await pg.waitForFunction(() => { const r = [...document.querySelectorAll('#dash .dash-stop-row')].find((x) => x.textContent.includes('Today stop')); const bt = r?.querySelector('.checkin-btn'); return bt && !bt.disabled; }, null, { timeout: 15000 });
  ok(await pg.locator('#dash .dash-stop-row', { hasText: 'Second stop' }).locator('.checkin-btn').isDisabled(), 'the button of the stop I am at opens; the other one stays shut');
  await pg.locator('#dash .dash-stop-row', { hasText: 'Today stop' }).locator('.checkin-btn').click(); await pg.waitForTimeout(500);
  ok(!!(await pg.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((x) => x.id === 'tw').checkin)) && /✓/.test(await pg.locator('#dash .dash-stop-row', { hasText: 'Today stop' }).textContent()), 'pressing it records the check-in, and the row shows it');
  await pg.click('#dash-collapse'); await pg.waitForTimeout(500);
  ok((await pg.evaluate(() => window.__watches.size)) === 0, 'with the dashboard folded (and the panel on Map Configs) the position is no longer read');
  await c.close();
}

// the first day's forecast on the next trip
{
  const { c, pg } = await openX({ prefs: { autoWeather: true }, weather: true });
  await pg.locator('#dash-body .dash-trip-nav .btn').nth(1).click();
  await pg.waitForFunction(() => /First day:/.test(document.querySelector('#dash .dash-trip')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const txt = await pg.textContent('#dash .dash-trip');
  ok(/First day: .*22°\/14°/.test(txt), 'with automatic weather on, the next trip shows the forecast for its first day: ' + (txt.match(/First day:[^·]*/) || [''])[0].trim());
  await c.close();
}
// ================= the crosshair at the map centre, and a tight grid of cards
({ ctx, p } = await open({ width: 1300, height: 850 }, false));
const cross = () => p.$eval('.crosshair', (e) => { const r = e.getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return { x: r.x + r.width / 2 - (m.x + m.width / 2), y: r.y + r.height / 2 - (m.y + m.height / 2), hidden: getComputedStyle(e).display === 'none', label: e.querySelector('.cross-label').textContent }; });
let cr = await cross();
ok(!cr.hidden && Math.abs(cr.x) <= 1 && Math.abs(cr.y) <= 1, 'a crosshair marks the centre of the map by default');
ok(/^\d+\.\d{5}, \d+\.\d{5}$/.test(cr.label), 'with the coordinates of the centre under it: ' + cr.label);
const placedBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.length);
await p.click('#task-save'); await p.click('#poi-center'); await p.waitForTimeout(500);
const placed = await p.evaluate(() => { const it = JSON.parse(localStorage.getItem('uavzones.v1.pois')).items; return it.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)))[0]; });
const [la, lo] = cr.label.split(', ').map(Number);
ok(Math.abs(placed.lat - la) < 2e-5 && Math.abs(placed.lon - lo) < 2e-5 && (await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.length)) === placedBefore + 1, 'Place at map centre puts the marker exactly where the cross is');
ok((await cross()).hidden, 'the crosshair steps aside while a window is open');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);
ok(!(await cross()).hidden, 'and returns when it closes');
ok((await p.$eval('.crosshair', (e) => getComputedStyle(e).pointerEvents)) === 'none', 'it never takes a click');
await p.click('#dash-help'); await p.evaluate(() => { document.querySelector('#dash-body details[data-topic=map]').open = true; });
ok(/Hide crosshair/.test(await p.textContent('#help-crosshair')), 'Help (Map basics) offers to hide it');
await p.click('#help-crosshair'); await p.waitForTimeout(250);
ok((await cross()).hidden && await p.locator('.cross-btn.off').count() === 1 && /Show crosshair/.test(await p.textContent('#help-crosshair')) && (await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')).crosshair)) === false, 'hiding it from Help also updates the map button and is remembered');
await p.evaluate(() => document.querySelector('.cross-btn').click()); await p.waitForTimeout(250);
ok(!(await cross()).hidden && /Hide crosshair/.test(await p.textContent('#help-crosshair')), 'the map control brings it back, and Help follows');
await p.click('#dash-back'); await p.waitForTimeout(200);
// the Help subview: same drawer, own heading and Back, topics, nothing lost on the way back
await p.locator('#dash .dash-trip-nav .btn').nth(1).click(); await p.waitForTimeout(200);
const heads = await p.$$eval('.dash-tools button', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.id));
ok(heads[0] === 'dash-help' && heads.slice(-2).join() === 'dash-collapse,dash-close', 'the ? button is the first of the header buttons: ' + heads.join(', '));
const h0 = await rect(p, '#dash');
await p.click('#dash-help'); await p.waitForTimeout(250);
const h1 = await rect(p, '#dash');
ok(await p.getAttribute('#dash-help', 'aria-pressed') === 'true' && (await p.locator('#dash-body .dash-help-view').count()) === 1 && (await p.locator('#dash-body .dash-tasks, #dash-body .dash-trip').count()) === 0 && /Help/.test(await p.textContent('#dash-help-title')), 'Help replaces the default view inside the same drawer');
ok(Math.abs(h0.y + h0.h - (h1.y + h1.h)) < 2, 'the drawer stays on the same bottom line');
ok((await p.$$eval('#dash-body details.dash-topic > summary', (e) => e.map((x) => x.textContent))).length === 6, 'six collapsible topics');
ok(await p.evaluate(() => document.activeElement?.id) === 'dash-help-title', 'focus moves to the Help heading');
await p.click('#dash-back'); await p.waitForTimeout(250);
ok(await p.getAttribute('#dash-help', 'aria-pressed') === 'false' && (await p.locator('#dash-body .dash-help-view').count()) === 0 && /2 of 2/.test(await p.textContent('#dash-body .dash-trip-nav')), 'Back returns to the dashboard with the same trip showing');
ok(await p.evaluate(() => document.activeElement?.id) === 'dash-help', 'and focus returns to the ? button');
await p.click('#dash-help'); await p.waitForTimeout(150); await p.click('#dash-help'); await p.waitForTimeout(150);
ok(await p.getAttribute('#dash-help', 'aria-pressed') === 'false', 'the ? button also toggles it back');
await p.click('#dash-help'); await p.evaluate(() => { document.querySelector('#dash-body details[data-topic=map]').open = true; }); await p.click('#dash-body details[data-topic=map] .dash-subtopic > summary');
ok((await p.locator('#dash #legend > div').count()) >= 2 && (await p.locator('#dash .key-line').count()) === 4, 'Help: the colours and the four line samples show on request');
await p.evaluate(() => { document.querySelector('#dash-body details[data-topic=data]').open = true; });
ok(/Coverage/.test(await p.textContent('#dash #regions-note')) && /not flight advice/i.test(await p.textContent('#dash-body details[data-topic=data]')) && /never permission/.test(await p.textContent('#dash-body details[data-topic=data]')), 'Help: the coverage note and the safety wording are there, with "never permission"');
await p.click('#dash-back'); await p.waitForTimeout(150);
ok((await p.locator('#dash .dash-lines > summary').count()) === 1, 'the trip card has a contextual explanation of the lines on the map');
await ctx.close();
({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: RETURNING }));
await p.evaluate(() => localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'), crosshair: false })));
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
ok((await p.$eval('.crosshair', (e) => getComputedStyle(e).display)) === 'none' && await p.locator('.cross-btn.off').count() === 1, 'with the setting saved as off, the next visit starts without the crosshair');
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
