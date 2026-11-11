// The dashboard along the bottom of the map: its three states, how it starts, its cards, and how it shares the screen with the side panel.
import { chromium, CHANNEL } from './lib.mjs';
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
const RETURNING = { showOnStart: true, welcomed: true, seen: '2026-11-11' };

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
ok(!(await p.$eval('.dash-guide', (d) => d.open)) && !/What’s new/.test(txt), 'the guide is folded and there is no What\'s new for a visitor who has seen it');
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
ok(await p.$eval('.dash-guide', (d) => d.open), 'How it works (Map Configs) opens the dashboard with the guide unfolded');

// the three states
const expandedLift = await lift(p);
ok(expandedLift > 100 && await p.$eval('.leaflet-bottom', (e, v) => parseFloat(getComputedStyle(e).bottom) >= v - 1, expandedLift), 'the map\'s own controls sit above the open dashboard (lifted ' + Math.round(expandedLift) + ' px)');
await p.click('#dash-collapse'); await p.waitForTimeout(250);
ok(await stateOf(p) === 'peek' && /Under way · Day 2 of 3/.test(await p.textContent('#dash-peek')) && await lift(p) === 0, 'V drops it to a one-line strip with the countdown, and the controls come back down');
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
ok(await stateOf(p) === 'expanded' && /What’s new/.test(await p.textContent('#dash-body')) && /Singapore no-fly zones/.test(await p.textContent('#dash-body')), 'a What\'s new entry the visitor has not seen opens it, even after "not for today"');
await p.click('#dash-collapse'); await p.waitForTimeout(250);
ok((await dashSaved(p)).seen === '2026-11-11', 'putting it away marks the entry as seen');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
ok(await stateOf(p) === 'peek' && !/What’s new/.test(await p.textContent('#dash-body')), 'the next start follows "not for today" again, and the entry is gone');
await ctx.close();

({ ctx, p } = await open({ width: 1300, height: 850 }, false, { dash: null, data: false }));
ok(await stateOf(p) === 'expanded' && await p.$eval('.dash-guide', (d) => d.open) && /Create your first trip/.test(await p.textContent('#dash-body')), 'a first visit opens it with the guide and a first-trip button');
await p.locator('#dash-body .btn', { hasText: 'Create your first trip' }).click(); await p.waitForTimeout(400);
ok(await p.isVisible('#trip-form-card'), 'which starts a new trip');
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
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
