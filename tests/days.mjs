// The day follows from the date; trips need dates; the start-up fix of old day numbers; the AI import turning days into dates.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const trips = (extra = {}) => ({ v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14', ...extra }] });
const stored = (p) => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => [i.id, i])));
const toastText = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });

const b = await chromium.launch({ channel: CHANNEL });
async function session({ items, tripsData = trips(), viewport = { width: 1200, height: 800 }, tab = 'poi' } = {}) {
  const ctx = await b.newContext({ viewport });
  await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); } }, [items, tripsData]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await p.evaluate((t) => { if (document.getElementById('panel').hidden) document.querySelector(`#dock button[data-tab=${t}]`).click(); else document.getElementById(`tab-${t}`).click(); }, tab);
  await p.waitForTimeout(300);
  return { ctx, p };
}
const open = async (p, name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 }); await p.waitForTimeout(700); };
const edit = async (p) => { await p.evaluate(() => document.querySelector('.leaflet-popup-content').scrollTo(0, 9999)); await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(250); };

// ================= worked out from the date: pins, rows, window, form
const items = [
  mk('a', 'Alpha', 1, { date: '2026-11-13', order: 3 }),
  mk('h', 'Hotel', 2, { type: 'hotel', date: '2026-11-12', endDate: '2026-11-14', order: 1 }),
  mk('o', 'Outside', 3, { date: '2026-11-20' }),
  mk('l', 'Loose', 4, { tripId: undefined, date: '2026-11-13' }),
];
let { ctx, p } = await session({ items });
const seqs = await p.$$eval('.poi-pin', (e) => Object.fromEntries(e.map((x) => [x.getAttribute('title'), x.querySelector('.seq')?.textContent ?? ''])));
ok(seqs.Alpha === 'D2·3' && seqs.Hotel === 'D1·1' && seqs.Outside === '' && seqs.Loose === '', 'pins: Alpha is D2·3 and the hotel D1·1, worked out from the dates; a date outside the trip and a marker in no trip have none: ' + JSON.stringify(seqs));
const rows = await p.$$eval('#poi-list .poi-item', (r) => Object.fromEntries(r.map((x) => [x.querySelector('b').textContent.replace(/\s*(Unverified|Outside trip dates)/, ''), x.querySelector('small').textContent])));
ok(/Day 2 · Stop 3/.test(rows.Alpha) && /Day 1–3 · Stop 1/.test(rows.Hotel) && !/Day/.test(rows.Outside) && !/Day/.test(rows.Loose), 'rows: "Day 2 · Stop 3" and "Day 1–3" for the three-night hotel; none outside the trip: ' + JSON.stringify(rows));
await open(p, 'Alpha');
ok(/day 2 · stop 3/i.test(await p.locator('.poi-pop .pop-type').innerText()), 'the window says "Day 2 · Stop 3"');
await edit(p);
ok((await p.locator('.poi-pop form input[type=number]').count()) === 1 && !(await p.locator('.poi-pop form label:text-is("Day")').count()), 'the form has no Day box: only Stop');
const line = () => p.locator('.poi-pop .day-line').innerText();
ok(/Day 2 of the trip \(worked out from the date\)/.test(await line()), 'it says which day the date is: "' + await line() + '"');
await p.fill('.poi-pop .date-field input >> nth=0', '2026-11-14');
ok(/Day 3 of the trip/.test(await line()), 'changing the date updates it at once (14 Nov: Day 3)');
await p.fill('.poi-pop .date-field input >> nth=0', '2026-11-20');
ok(/outside the trip, so it has no day/.test(await line()), 'a date outside the trip says so');
await p.fill('.poi-pop .date-field input >> nth=0', '');
ok(/Pick a date/.test(await line()), 'no date: it asks for one');
await p.selectOption('.poi-pop form select >> nth=1', '');
ok(await line() === '', 'no trip: the line is empty');
await p.selectOption('.poi-pop form select >> nth=1', 't1');
await p.fill('.poi-pop .date-field input >> nth=0', '2026-11-14');
await p.click('.poi-pop form button[type=submit]'); await p.waitForTimeout(500);
let s = await stored(p);
ok(s.a.date === '2026-11-14' && !('day' in s.a), 'saved with the new date and no stored day');
ok((await p.locator('.poi-pin[title="Alpha"] .seq').textContent()) === 'D3·3', 'the pin shows D3·3 at once');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await ctx.close();

// ---- editing the trip's dates moves every day
({ ctx, p } = await session({ items, tab: 'trips' }));
await p.locator('#trips-list .trip-card', { hasText: 'Wuhan' }).getByRole('button', { name: 'Edit' }).click();
await p.fill('#trip-start', '2026-11-11'); await p.fill('#trip-end', '2026-11-14');
await p.click('#trip-save'); await p.waitForTimeout(500);
const seqs2 = await p.$$eval('.poi-pin', (e) => Object.fromEntries(e.map((x) => [x.getAttribute('title'), x.querySelector('.seq')?.textContent ?? ''])));
ok(seqs2.Alpha === 'D3·3' && seqs2.Hotel === 'D2·1', 'starting the trip a day earlier moves every day number by one with no editing of the markers: ' + JSON.stringify(seqs2));
await ctx.close();

// ================= trips need dates
({ ctx, p } = await session({ items: [], tab: 'trips', tripsData: { v: 1, trips: [{ id: 'old', name: 'Old trip', color: '#3949ab', description: '', created: '2026-11-01T00:00:00.000Z' }] } }));
ok(/No dates yet/.test(await p.locator('#trips-list .trip-card').innerText()), 'a trip saved without dates is flagged on its card: "No dates yet. Add them…"');
await p.click('#trip-new');
await p.fill('#trip-name', 'Singapore');
await p.click('#trip-save');
ok(/start date/i.test(await p.textContent('#trip-error')) && (await p.locator('#trips-list .trip-card').count()) === 1, 'saving without a start date is refused');
await p.fill('#trip-start', '2026-12-05');
await p.click('#trip-save');
ok(/end date/i.test(await p.textContent('#trip-error')) && (await p.locator('#trips-list .trip-card').count()) === 1, 'and without an end date');
await p.fill('#trip-end', '2026-12-03'); await p.click('#trip-save');
ok(/before/i.test(await p.textContent('#trip-error')), 'an end before the start is refused');
await p.fill('#trip-end', '2026-12-05'); await p.click('#trip-save'); await p.waitForTimeout(400);
ok((await p.locator('#trips-list .trip-card').count()) === 2, 'a one-day trip (start = end) is accepted');
await p.locator('#trips-list .trip-card', { hasText: 'Old trip' }).getByRole('button', { name: 'Edit' }).click();
await p.click('#trip-save');
ok(/start date/i.test(await p.textContent('#trip-error')), 'editing an old trip without dates asks for them too');
await ctx.close();

// ================= the start-up fix
const old = [
  mk('ok', 'Right', 1, { date: '2026-11-13', day: 2, order: 1 }),
  mk('bad', 'Wrong', 2, { date: '2026-11-13', day: 3, order: 2 }),
  mk('conv', 'Daily', 3, { day: 3, order: 1 }),
  mk('free', 'Free', 4, { tripId: undefined, day: 2 }),
];
({ ctx, p } = await session({ items: old }));
s = await stored(p);
ok(!('day' in s.ok) && !('day' in s.bad) && s.bad.date === '2026-11-13', 'at start-up dated markers lose their stored day (the date stays)');
ok(s.conv.date === '2026-11-14' && !('day' in s.conv), 'a day-only marker in a trip with dates became a date (day 3 of a trip starting 12 Nov is 14 Nov)');
ok(s.free.day === 2 && !s.free.date, 'a day-only marker in no trip keeps its day');
const t0 = await toastText(p);
ok(/Day numbers now follow the dates: 1 corrected, 1 turned into dates/.test(t0), 'a message says what was fixed: "' + t0 + '"');
ok((await p.locator('.poi-pin[title="Wrong"] .seq').textContent()) === 'D2·2', 'the misaligned marker now shows the day its date really is (D2)');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
ok(!/Day numbers now follow/.test(await toastText(p)), 'after a reload nothing is fixed again, so there is no message');
await ctx.close();

// ================= AI import: day -> date, and trips without dates
const feat = (name, props, lon, lat) => ({ type: 'Feature', properties: { name, ...props }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const paste = async (p, obj) => {
  await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]')?.click() || document.getElementById('tab-trips').click()).catch(() => {});
  await p.click('#tab-trips').catch(() => {});
  await p.fill('#ai-text', JSON.stringify(obj)); await p.click('#ai-preview-btn'); await p.waitForTimeout(400);
};
({ ctx, p } = await session({ items: [], tripsData: { v: 1, trips: [] }, tab: 'trips' }));
await paste(p, { type: 'FeatureCollection', trip: { name: 'Weekend', startDate: '2026-11-12', endDate: '2026-11-14' }, features: [feat('First', { day: 1, order: 1 }, 114.3, 30.6), feat('Third', { day: 3 }, 114.31, 30.61), feat('Dated', { date: '2026-11-13', day: 5 }, 114.32, 30.62)] });
ok((await p.locator('.ai-trip-dates').count()) === 0, 'a reply whose trip has dates asks for nothing');
await p.click('#ai-add'); await p.waitForTimeout(800);
s = await stored(p);
const byName = Object.fromEntries(Object.values(s).map((x) => [x.name, x]));
ok(byName.First.date === '2026-11-12' && byName.Third.date === '2026-11-14' && byName.Dated.date === '2026-11-13', 'days became dates: day 1 is 12 Nov, day 3 is 14 Nov, and a place with a date keeps it');
ok(Object.values(s).every((x) => !('day' in x)), 'and no day is stored (the reply\'s day 5 beside a date is ignored)');
await ctx.close();

({ ctx, p } = await session({ items: [], tripsData: { v: 1, trips: [] }, tab: 'trips' }));
await paste(p, { type: 'FeatureCollection', trip: { name: 'Undated trip' }, features: [feat('One', { day: 1 }, 114.3, 30.6), feat('Two', { day: 2 }, 114.31, 30.61)] });
ok((await p.locator('.ai-trip-dates').count()) === 1 && /came without dates/.test(await p.locator('.ai-trip-dates').innerText()), 'a reply whose trip has no dates asks for them in the preview');
await p.click('#ai-add'); await p.waitForTimeout(600);
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois') || '{"items":[]}').items.length)) === 0 && /start and an end date/.test(await toastText(p)), 'adding is refused until the dates are given: "' + (await toastText(p)) + '"');
const dts = p.locator('.ai-trip-dates input[type=date]');
await dts.nth(0).fill('2026-12-01'); await dts.nth(1).fill('2026-12-03');
await p.click('#ai-add'); await p.waitForTimeout(800);
s = await stored(p);
const tr = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.trips')).trips);
ok(tr.length === 1 && tr[0].startDate === '2026-12-01' && tr[0].endDate === '2026-12-03', 'the trip was created with the dates typed in');
const nm = Object.fromEntries(Object.values(s).map((x) => [x.name, x]));
ok(nm.One.date === '2026-12-01' && nm.Two.date === '2026-12-02' && nm.One.tripId === tr[0].id, 'and its days became dates from them (day 1 is 1 Dec, day 2 is 2 Dec)');
await ctx.close();

({ ctx, p } = await session({ items: [], tripsData: { v: 1, trips: [] }, tab: 'trips' }));
await paste(p, { type: 'FeatureCollection', trip: { name: 'Undated trip' }, features: [feat('One', { day: 1 }, 114.3, 30.6)] });
await p.selectOption('#ai-trip', 'none');
ok((await p.locator('.ai-trip-dates').count()) === 0, 'choosing "No trip" asks for no dates');
await p.click('#ai-add'); await p.waitForTimeout(800);
s = await stored(p);
ok(Object.values(s).length === 1 && Object.values(s)[0].day === 1 && !Object.values(s)[0].date && !Object.values(s)[0].tripId, 'a day-only place with no trip keeps its day (it has no dates to work it out from)');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
