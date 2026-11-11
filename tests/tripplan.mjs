// The Trips tab: countdown and warnings on the cards, the Past trips section, the detail screen (days, distances, notes, checklist).
import { chromium, CHANNEL, OUT } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const trips = [
  { id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' },
  { id: 't2', name: 'Old trip', startDate: iso(-20), endDate: iso(-18), description: '', color: '#3949ab', created: '2026-01-02T00:00:00.000Z' },
  { id: 't3', name: 'Under way', startDate: iso(-1), endDate: iso(1), description: '', color: '#00897b', created: '2026-01-03T00:00:00.000Z' },
];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('a', 'Airport', 30.78, 114.21, { tripId: 't1', date: iso(5), order: 1 }),
  mk('b', 'Tower', 30.59, 114.30, { tripId: 't1', date: iso(5), order: 2 }),
  mk('h', 'Hotel A', 30.58, 114.30, { tripId: 't1', type: 'hotel', date: iso(5), endDate: iso(6) }),
  mk('c', 'Lake', 30.55, 114.37, { tripId: 't1', date: iso(6), order: 1 }),
  mk('u', 'Somewhere', 30.5, 114.3, { tripId: 't1' }),
  mk('o', 'Old place', 30.6, 114.3, { tripId: 't2', date: iso(-20), order: 1 }),
];
const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' })); } }, [items, trips]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=trips]').click(); else document.getElementById('tab-trips').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const card = (p, name) => p.locator('#trips-list .trip-card', { hasText: name });

let { ctx, p } = await open({ width: 1300, height: 900 }, false);
const sub = async (name) => (await card(p, name).innerText()).replace(/\n+/g, ' | ');
ok(/5 days to go/.test(await sub('Hubei spring')), 'an upcoming trip shows its countdown: ' + await sub('Hubei spring'));
ok(/Day 2 of 3/.test(await sub('Under way')), 'a trip under way shows the day: ' + (await sub('Under way')).slice(0, 60));
ok(/⚠ 1 without a date · no hotel for the night of Days 2, 3/.test(await sub('Hubei spring')), 'the card has a one-line warning summary');
ok(!/⚠/.test(await sub('Under way')), 'a trip with nothing wrong has none');
ok((await p.locator('#trips-list .trip-card').count()) === 2 && (await p.locator('#trips-past-list .trip-card').count()) === 1, 'the finished trip is in Past trips, not in the main list');
ok(!(await p.locator('#trips-past').evaluate((d) => d.open)) && /Past trips \(1\)/.test(await p.textContent('#trips-past-title')), 'the Past trips section is collapsed and counts its trips');
await p.click('#trips-past-title'); await p.waitForTimeout(150);
ok(await p.locator('#trips-past-list .trip-card', { hasText: 'Old trip' }).isVisible(), 'opening it shows the finished trip');

// detail
await card(p, 'Hubei spring').locator('.trip-card-head').click(); await p.waitForTimeout(300);
ok(await p.isVisible('#trip-detail') && !(await p.isVisible('#trips-list')) && !(await p.isVisible('#ai-card')), 'tapping a card opens its detail screen in place of the list');
const days = await p.$$eval('#trip-detail .plan-day', (s) => s.map((x) => x.innerText.replace(/\n+/g, ' | ')));
ok(days.length === 5 && /Day 1/.test(days[0]) && /Airport/.test(days[0]) && /Tower/.test(days[0]) && /Hotel A/.test(days[0]) && /km between stops/.test(days[0]), 'the days are listed with their stops and the distance between them: ' + days[0]);
ok(/Day 2/.test(days[1]) && /Lake/.test(days[1]) && /Nothing planned/.test(days[2]), 'a later day has its stop, an empty day says so');
ok(/No date \(1\)/.test(days[4]) && /Somewhere/.test(days[4]), 'markers with no date are listed apart');
ok(/Warnings \(3\)/.test(await p.textContent('#trip-detail .trip-warnings summary')) && (await p.locator('#trip-detail .trip-warnings').evaluate((d) => d.open)), 'the warnings are listed (open when there are some)');
await p.locator('#trip-detail .plan-stop', { hasText: 'Tower' }).click(); await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
ok((await p.textContent('.poi-pop h3')) === 'Tower', 'tapping a stop opens that marker on the map');
await p.keyboard.press('Escape');

// notes and checklist
await p.fill('#trip-detail .trip-notes textarea', 'Bring ND filters'); await p.locator('#trip-detail .trip-notes textarea').blur(); await p.waitForTimeout(300);
await p.fill('#trip-detail .check-add input', 'Batteries charged'); await p.press('#trip-detail .check-add input', 'Enter'); await p.waitForTimeout(200);
await p.fill('#trip-detail .check-add input', 'Permit printed'); await p.click('#trip-detail .check-add .btn'); await p.waitForTimeout(200);
ok((await p.locator('#trip-detail .check-list li').count()) === 2 && /Checklist \(0 of 2\)/.test(await p.textContent('#trip-detail .trip-checklist h3')), 'checklist items can be added (Enter or Add)');
await p.locator('#trip-detail .check-list li').first().locator('input').check(); await p.waitForTimeout(200);
ok(/Checklist \(1 of 2\)/.test(await p.textContent('#trip-detail .trip-checklist h3')) && (await p.locator('#trip-detail .check-list li span.done').count()) === 1, 'ticking one counts it and strikes it through');
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.trips')).trips.find((t) => t.id === 't1'));
ok(stored.notes === 'Bring ND filters' && stored.checklist.length === 2 && stored.checklist[0].done === true, 'notes and checklist are saved');
await p.locator('#trip-detail .check-list li').nth(1).locator('.icon-btn').click(); await p.waitForTimeout(200);
ok((await p.locator('#trip-detail .check-list li').count()) === 1, 'an item can be removed');
await p.screenshot({ path: `${OUT}/tripplan-desk.png` });

// back to the list: the card shows the checklist progress
await p.click('#trip-detail >> text=‹ Trips'); await p.waitForTimeout(300);
ok(await p.isVisible('#trips-list') && !(await p.isVisible('#trip-detail')) && /1 of 1 checked/.test(await sub('Hubei spring')), 'Back returns to the list; the card shows how much of the checklist is done');
// Edit from the detail keeps notes
await card(p, 'Hubei spring').getByRole('button', { name: 'Edit' }).click(); await p.fill('#trip-name', 'Hubei autumn'); await p.click('#trip-save'); await p.waitForTimeout(300);
const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.trips')).trips.find((t) => t.id === 't1'));
ok(kept.name === 'Hubei autumn' && kept.notes === 'Bring ND filters', 'editing the trip keeps its notes');
await ctx.close();

// phone
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await card(p, 'Under way').locator('.trip-card-head').tap(); await p.waitForTimeout(300);
const overflow = await p.evaluate(() => { const d = document.getElementById('trip-detail'); return document.documentElement.scrollWidth > window.innerWidth || d.scrollWidth > d.clientWidth + 1; });
ok(await p.isVisible('#trip-detail') && !overflow, 'on a phone the detail screen fits with no sideways scrolling');
await p.screenshot({ path: `${OUT}/tripplan-phone.png` });
await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
