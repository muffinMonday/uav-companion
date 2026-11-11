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
  mk('tw', 'Today stop', 30.6, 114.31, { tripId: 't3', date: iso(0), order: 1 }),
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
const flipText = (p) => p.$eval('#trip-detail .flip', (e) => e.innerText.replace(/\n+/g, ' | '));
const nextBtn = (p) => p.locator('#trip-detail .flip-btn').nth(1), prevBtn = (p) => p.locator('#trip-detail .flip-btn').nth(0);
/** From the first page of the flip card to the last, collecting what `collect` returns on each. */
const walk = async (p, collect) => {
  await p.locator('#trip-detail .flip-dot').first().click(); await p.waitForTimeout(80);
  const out = [];
  for (;;) { out.push(await collect()); if (await nextBtn(p).isDisabled()) break; await nextBtn(p).click(); await p.waitForTimeout(80); }
  return out;
};
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
ok(/Day 1 of 4/.test(await flipText(p)) && /Airport/.test(await flipText(p)) && /Tower/.test(await flipText(p)) && /Hotel A/.test(await flipText(p)) && /km between stops/.test(await flipText(p)), 'the trip opens on Day 1 as a card, with its stops and the distance between them: ' + (await flipText(p)).slice(0, 110));
ok(await prevBtn(p).isDisabled() && !(await nextBtn(p).isDisabled()) && (await p.locator('#trip-detail .flip-dot').count()) === 5, 'there is no day before Day 1; five dots for four days and the markers with no date');
await nextBtn(p).click(); await p.waitForTimeout(350);
ok(/Day 2 of 4/.test(await flipText(p)) && /Lake/.test(await flipText(p)) && !/Airport/.test(await flipText(p)), '› turns to the next day, which shows only its own stops');
await nextBtn(p).click(); await p.waitForTimeout(200);
ok(/Day 3 of 4/.test(await flipText(p)) && /Nothing planned/.test(await flipText(p)), 'an empty day says so');
await nextBtn(p).click(); await nextBtn(p).click(); await p.waitForTimeout(200);
ok(/No date \(1\)/.test(await flipText(p)) && /Somewhere/.test(await flipText(p)) && await nextBtn(p).isDisabled(), 'the last page holds the markers with no date, and › stops there');
await prevBtn(p).click(); await prevBtn(p).click(); await prevBtn(p).click(); await p.waitForTimeout(200);
ok(/Day 2 of 4/.test(await flipText(p)), '‹ goes back a day');
await p.locator('#trip-detail .flip-dot').first().click(); await p.waitForTimeout(200);
ok(/Day 1 of 4/.test(await flipText(p)), 'a dot jumps to its day');
await p.locator('#trip-detail .flip').focus(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
ok(/Day 2 of 4/.test(await flipText(p)), 'the right arrow key turns the page when the card has focus');
await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(200);
await p.evaluate(() => { const bd = document.querySelector('#trip-detail .flip-body'); const ev = (type, x) => bd.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: 200, bubbles: true })); ev('pointerdown', 300); ev('pointerup', 120); });
await p.waitForTimeout(250);
ok(/Day 2 of 4/.test(await flipText(p)), 'a swipe to the left turns to the next day');
await nextBtn(p).click(); await p.waitForTimeout(200); await prevBtn(p).click(); await prevBtn(p).click(); await p.waitForTimeout(200);
ok(/Warnings \(3\)/.test(await p.textContent('#trip-detail .trip-warnings summary')) && (await p.locator('#trip-detail .trip-warnings').evaluate((d) => d.open)), 'the warnings are listed (open when there are some)');
await p.locator('#trip-detail .plan-stop', { hasText: 'Tower' }).click(); await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
ok(/Navigate this day/.test(await flipText(p)) && (await p.locator('#trip-detail .flip-body .day-route a.maplink').count()) >= 1, 'a day with two or more stops offers to navigate through them');
ok((await p.textContent('.poi-pop h3')) === 'Tower', 'tapping a stop opens that marker on the map');
await p.keyboard.press('Escape');
await nextBtn(p).click(); await p.waitForTimeout(250);
await p.locator('#trip-detail .flip-body .btn', { hasText: 'Fit map to this day' }).click(); await p.waitForTimeout(400);
ok(!/Nothing to show/.test(await p.textContent('#toast')), 'Fit map to this day fits the map to its stops');

// notes and checklist
await p.fill('#trip-detail .trip-notes textarea', 'Bring ND filters'); await p.locator('#trip-detail .trip-notes textarea').blur(); await p.waitForTimeout(300);
await p.fill('#trip-detail .check-add input', 'Batteries charged'); await p.press('#trip-detail .check-add input', 'Enter'); await p.waitForTimeout(200);
await p.fill('#trip-detail .check-add input', 'Permit printed'); await p.click('#trip-detail .check-add .btn'); await p.waitForTimeout(200);
ok((await p.locator('#trip-detail .check-list li').count()) === 2 && /Checklist \(0 of 2\)/.test(await p.textContent('#trip-detail .trip-checklist h3')), 'checklist items can be added (Enter or Add)');
await p.locator('#trip-detail .check-list li').first().locator('input').check(); await p.waitForTimeout(200);
ok(/Checklist \(1 of 2\)/.test(await p.textContent('#trip-detail .trip-checklist h3')) && (await p.locator('#trip-detail .check-list li span.done').count()) === 1, 'ticking one counts it and strikes it through');
ok(/Day 2 of 4/.test(await flipText(p)), 'the card stays on its day when something else on the screen changes');
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
ok(/Day 2 of 3/.test(await flipText(p)) && /Today stop/.test(await flipText(p)), 'a trip under way opens on today: ' + (await flipText(p)).slice(0, 70));
await p.screenshot({ path: `${OUT}/tripplan-phone.png` });
await ctx.close();

// ================= forecast per day (opt-in) and the no-fly check of stops
{
  const asked = [];
  const wctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const sgStop = mk('pd', 'Padang', 1.302, 103.8291, { tripId: 't1', date: iso(7), order: 1 });
  await wctx.addInitScript(([po, tr]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', autoWeather: true }));
    localStorage.setItem('uavzones.windLimit', '10');
  }, [[...items, sgStop], trips]);
  await wctx.route('**/api.open-meteo.com/**', (route) => {
    const url = route.request().url();
    if (!url.includes('daily=')) return route.fulfill({ status: 500, body: '' });
    asked.push(url);
    const lat = new URL(url).searchParams.get('latitude').split(',');
    const times = Array.from({ length: 16 }, (_, k) => iso(k));
    const one = () => ({ utc_offset_seconds: 28800, timezone_abbreviation: 'CST', daily: { time: times, weather_code: times.map((_, k) => [0, 61, 3][k % 3]), temperature_2m_max: times.map(() => 22.4), temperature_2m_min: times.map(() => 14.1), precipitation_probability_max: times.map((_, k) => (k % 3 === 1 ? 70 : 10)), wind_speed_10m_max: times.map((_, k) => (k === 6 ? 12.4 : 4.2)) } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lat.length === 1 ? one() : lat.map(one)) });
  });
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await wp.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await wp.waitForTimeout(1000);
  await wp.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=trips]').click(); else document.getElementById('tab-trips').click(); });
  await wp.waitForTimeout(1500);
  ok(asked.length >= 1 && asked.every((u) => u.includes('forecast_days=16')), 'with automatic weather on, a trip asks for its daily forecast (' + asked.length + ' request)');
  ok((await wp.locator('#trips-list .trip-card', { hasText: 'Hubei spring' }).locator('.trip-wx-strip span').count()) >= 2, 'the card shows a strip of weather symbols, one for each day that has a place');
  await wp.locator('#trips-list .trip-card', { hasText: 'Hubei spring' }).locator('.trip-card-head').click(); await wp.waitForTimeout(400);
  const heads = (await walk(wp, () => wp.$$eval('#trip-detail .flip .plan-wx', (e) => e.map((x) => ({ t: x.textContent, over: x.classList.contains('over') }))))).flat();
  ok(heads.length >= 2 && /22°\/14°/.test(heads[0].t) && /rain \d+%/.test(heads[0].t) && /wind 4 m\/s/.test(heads[0].t), 'each day shows the high and low, rain chance and wind: ' + (heads[0] && heads[0].t));
  ok(heads.some((h) => h.over && /wind 12 m\/s/.test(h.t)), 'a day windier than the wind limit (10 m/s) is shown in red');
  ok(/Forecast per day from Open-Meteo/.test(await wp.textContent('#trip-detail')), 'the forecast is credited to Open-Meteo');

  // no-fly check
  await wp.click('#trip-detail >> text=Check stops against no-fly zones');
  await wp.waitForFunction(() => document.querySelectorAll('#trip-detail .plan-zone').length >= 1, null, { timeout: 15000 });
  const zones = (await walk(wp, () => wp.$$eval('#trip-detail .flip .plan-stop', (r) => r.map((x) => ({ n: x.querySelector('b').textContent, z: x.querySelector('.plan-zone')?.textContent || '', c: x.querySelector('.plan-zone')?.className || '' }))))).flat();
  ok(zones.every((z) => z.z), 'every stop got a verdict: ' + zones.map((z) => z.n + ' = ' + z.z.slice(0, 22)).join('; '));
  const pad = zones.find((z) => z.n === 'Padang');
  ok(pad && /No-fly zone/.test(pad.z) && /\bno\b/.test(pad.c), 'the stop in Singapore\'s restricted area is marked: ' + (pad && pad.z));
  ok(/Padang: No-fly zone/.test(await wp.textContent('#trip-detail .trip-warnings')), 'and it is added to the warnings');
  ok(/Check stops again/.test(await wp.textContent('#trip-detail')), 'the button now offers to check again');
  const before = asked.length;

  // switching weather off forgets the forecast
  await wp.click('#trip-detail >> text=‹ Trips'); await wp.waitForTimeout(300);
  await wp.click('#privacy-btn'); await wp.uncheck('#pv-auto'); await wp.waitForTimeout(600); await wp.click('#privacy-back');
  ok((await wp.locator('.trip-wx-strip').count()) === 0 && (await wp.evaluate(() => { const c = JSON.parse(localStorage.getItem('uavzones.v1.tripwx') || '{"trips":{}}'); return Object.keys(c.trips).length; })) === 0, 'turning automatic weather off removes the strip and the saved forecast');
  await wp.locator('#trips-list .trip-card', { hasText: 'Hubei spring' }).locator('.trip-card-head').click(); await wp.waitForTimeout(300);
  ok(/Turn on automatic weather in the privacy settings/.test(await wp.textContent('#trip-detail')) && asked.length === before, 'with it off, the screen says how to turn it on and nothing more is requested');
  await wctx.close();
}
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
