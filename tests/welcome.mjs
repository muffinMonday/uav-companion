// The welcome screen: shown every visit, "Don't show again", reopening from Map Configs, and the countdown to the next trip.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from 'playwright-core'; // the real browser: this suite needs the welcome screen switched ON
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const trip = (id, name, extra) => ({ id, name, description: '', color: '#e91e63', created: '2026-11-01T00:00:00.000Z', ...extra });
const TRIPS = { v: 1, trips: [
  trip('t1', 'Singapore', { country: 'SG', startDate: '2026-11-22', endDate: '2026-11-24' }),
  trip('t2', 'Wuhan', { country: 'CN', startDate: '2026-11-09', endDate: '2026-11-11' }),
  trip('t3', 'Old trip', { startDate: '2026-10-01', endDate: '2026-10-05' }),
  trip('t4', 'Undated', {}),
  trip('t5', 'Weekend', { startDate: '2026-11-11' }),
] };
const POIS = { v: 1, items: [{ id: 'a', type: 'photo', name: 'Bridge', note: '', lat: 30.5928, lon: 114.3055, created: '2026-11-01T00:00:00.000Z', tripId: 't2' }] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ welcome, trips, pois, viewport = { width: 1200, height: 800 }, mobile = false, hash = '' } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile, timezoneId: 'Asia/Singapore' });
  await ctx.addInitScript(([w, t, po]) => {
    if (sessionStorage.__seeded) return;
    sessionStorage.__seeded = '1';
    if (w) localStorage.setItem('uavzones.v1.welcome', JSON.stringify(w));
    if (t) localStorage.setItem('uavzones.v1.trips', JSON.stringify(t));
    if (po) localStorage.setItem('uavzones.v1.pois', JSON.stringify(po));
  }, [welcome, trips, pois]);
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-11-10T10:00:00+08:00')); // "today" is 10 Nov 2026 in Singapore
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  return { ctx, p };
}
const isOpen = (p) => p.evaluate(() => document.getElementById('welcome').open);
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.welcome') || 'null'));
const reload = async (p) => { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900); };

// ---- first visit, no trips
let { ctx, p } = await session();
ok(await isOpen(p), 'the welcome screen opens on a first visit');
ok(/Welcome to UAV Companion/.test(await p.textContent('#welcome-title')) && (await p.locator('#welcome .w-steps li').count()) === 4, 'it has a title and four steps');
ok(/press and hold/i.test(await p.textContent('#welcome .w-steps li >> nth=0')) && /not flight advice/i.test(await p.textContent('#welcome .w-note')), 'step one explains press-and-hold; the note says it is not flight advice');
ok(!(await p.isVisible('#welcome-trip')), 'no trips: no countdown card');
ok((await p.isVisible('#welcome-dont')) && !(await p.isVisible('#welcome-again')), '"Don\'t show again" is offered');
ok((await p.evaluate(() => document.activeElement?.id)) === 'welcome-go', 'focus starts on Get started');
ok((await p.locator('.leaflet-tile-loaded').count()) > 0, 'the map has loaded behind it');
await p.click('#welcome-go'); await p.waitForTimeout(300);
ok(!(await isOpen(p)) && (await stored(p)) === null, 'Get started closes it and remembers nothing');
await reload(p);
ok(await isOpen(p), 'it shows again on the next visit');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(!(await isOpen(p)), 'Escape closes it');
await reload(p);
await p.mouse.click(5, 5); await p.waitForTimeout(300);
ok(!(await isOpen(p)), 'a click on the dimmed backdrop closes it');

// ---- Don't show again, and reopening
await reload(p);
await p.click('#welcome-dont'); await p.waitForTimeout(300);
ok(!(await isOpen(p)) && (await stored(p)).show === false, '"Don\'t show again" closes it and saves the choice');
await reload(p);
ok(!(await isOpen(p)), 'after that it stays away on later visits');
if (await p.evaluate(() => document.getElementById('panel').hidden)) await p.evaluate(() => document.querySelector('#dock button[data-tab=config]').click());
await p.click('#tab-config'); await p.waitForTimeout(200);
await p.click('#help-open'); await p.waitForTimeout(300);
ok(await isOpen(p) && !(await p.isVisible('#welcome-dont')) && (await p.isVisible('#welcome-again')), 'How it works in Map Configs reopens it, offering to show it on start again');
await p.click('#welcome-again'); await p.waitForTimeout(200);
ok((await stored(p)).show === true && (await p.isVisible('#welcome-dont')) && !(await p.isVisible('#welcome-again')), 'that turns it back on and swaps the buttons');
await p.click('#welcome-go'); await p.waitForTimeout(200);
await reload(p);
ok(await isOpen(p), 'and it shows on the next visit again');
await ctx.close();

// ---- the countdown
({ ctx, p } = await session({ trips: TRIPS, pois: POIS }));
ok(await p.isVisible('#welcome-trip'), 'with trips, the countdown card is shown');
ok((await p.textContent('#welcome-trip .w-count')) === 'Day 2 of 3' && /Wuhan/.test(await p.textContent('#welcome-trip')), 'the trip under way comes first: Wuhan, day 2 of 3');
ok(/China/.test(await p.textContent('#welcome-trip .w-trip-sub')) && /3 days/.test(await p.textContent('#welcome-trip .w-trip-sub')), 'the card gives its country, dates and length');
ok(/\+2 more trips/.test(await p.textContent('#welcome-trip')), 'the other two upcoming trips are counted (the past and undated ones are not): "+2 more trips"');
await p.click('#welcome-trip button:has-text("more trip")'); await p.waitForTimeout(500);
ok(!(await isOpen(p)) && await p.isVisible('#pane-trips'), '"+2 more trips" closes it and opens the Trips tab');
await reload(p);
await p.click('#welcome-trip button:has-text("Open trip")'); await p.waitForTimeout(1500);
ok(!(await isOpen(p)), '"Open trip" closes the screen');
ok((await p.locator('.poi-pin[title="Bridge"]').count()) === 1 && await p.evaluate(() => { const r = document.querySelector('.poi-pin[title="Bridge"]').getBoundingClientRect(); return r.x > 0 && r.x < innerWidth && r.y > 0 && r.y < innerHeight; }), 'and the map shows the trip\'s marker');
await ctx.close();

({ ctx, p } = await session({ trips: { v: 1, trips: TRIPS.trips.filter((t) => ['t1', 't5'].includes(t.id)) } }));
ok((await p.textContent('#welcome-trip .w-count')) === 'Tomorrow' && /Weekend/.test(await p.textContent('#welcome-trip')) && /\+1 more trip\b/.test(await p.textContent('#welcome-trip')), 'with nothing under way the soonest trip leads: Weekend, "Tomorrow", "+1 more trip"');
await ctx.close();
({ ctx, p } = await session({ trips: { v: 1, trips: [TRIPS.trips[0]] } }));
ok((await p.textContent('#welcome-trip .w-count')) === '12 days to go' && !/more trip/.test(await p.textContent('#welcome-trip')), 'a single upcoming trip: "12 days to go", no "more trips" button');
await ctx.close();
({ ctx, p } = await session({ trips: { v: 1, trips: [TRIPS.trips[2], TRIPS.trips[3]] } }));
ok(await isOpen(p) && !(await p.isVisible('#welcome-trip')), 'only past or undated trips: the guide shows, with no countdown');
await ctx.close();

// ---- opt-out also hides the countdown; a share link skips it
({ ctx, p } = await session({ welcome: { v: 1, show: false }, trips: TRIPS }));
ok(!(await isOpen(p)), 'when switched off, the countdown does not appear either');
await ctx.close();
({ ctx, p } = await session({ hash: '#import=z.abc' }));
ok(!(await isOpen(p)), 'opening a share link skips the welcome screen');
await ctx.close();

// ---- phone
({ ctx, p } = await session({ trips: TRIPS, pois: POIS, viewport: { width: 360, height: 640 }, mobile: true }));
const fit = await p.evaluate(() => { const r = document.getElementById('welcome').getBoundingClientRect(); const c = document.querySelector('.w-card'); return { l: r.left, r: r.right, t: r.top, bt: r.bottom, w: innerWidth, h: innerHeight, scrolls: c.scrollHeight > c.clientHeight + 1 }; });
ok(fit.l >= 0 && fit.r <= fit.w && fit.t >= 0 && fit.bt <= fit.h, 'at 360 x 640 the screen fits inside the viewport');
await p.screenshot({ path: `${SP}/welcome-phone.png` });
await p.evaluate(() => { const c = document.querySelector('.w-card'); c.scrollTo(0, c.scrollHeight); }); await p.waitForTimeout(200);
ok(await p.isVisible('#welcome-go') && (!fit.scrolls || (await p.evaluate(() => { const b = document.getElementById('welcome-go').getBoundingClientRect(); return b.bottom <= innerHeight; }))), 'its buttons can be reached by scrolling when it is taller than the screen');
await p.tap('#welcome-go'); await p.waitForTimeout(300);
ok(!(await isOpen(p)), 'Get started works by touch');
await ctx.close();
({ ctx, p } = await session({ trips: TRIPS, pois: POIS }));
await p.screenshot({ path: `${SP}/welcome-desktop.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
