// Coincident markers (browser): a stack is fanned out by a click, every pin stays its own record and opens its own window, the fan closes on the usual actions,
// hidden trips do not leak into it, turning the map keeps the hit targets on the pins, edit mode and Side Quests are not disturbed.
import { chromium, CHANNEL, MW } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const trips = [
  { id: 't1', name: 'Hubei', description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' },
  { id: 't2', name: 'Sichuan', description: '', color: '#3949ab', created: '2026-01-02T00:00:00.000Z' },
  { id: 't3', name: 'Quiet', description: '', color: '#00897b', created: '2026-01-03T00:00:00.000Z' },
];
const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });
const items = [
  mk('m1', 'Alpha', 30.600, 114.310, { tripId: 't1' }),
  mk('m2', 'Beta', 30.600, 114.310, { tripId: 't2' }),
  mk('m3', 'Gamma', 30.600, 114.310, { tripId: 't1', type: 'viewpoint' }),
  mk('m4', 'Solo', 30.606, 114.318, { tripId: 't1' }),
  mk('m5', 'Quiet pin', 30.600, 114.310, { tripId: 't3' }),
];
const b = await chromium.launch({ channel: CHANNEL });
async function open({ list = items, prefs = {}, vp = { width: 1300, height: 900 } } = {}) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(([po, tr, pf]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.60, lon: 114.31, zoom: 15 }, basemap: 'osm', ...pf }));
  }, [list, trips, prefs]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.click('#panel-close').catch(() => {}); await p.waitForTimeout(250);
  return { ctx, p };
}
const pins = (p) => p.$$eval('.leaflet-marker-icon.poi-pin', (e) => e.map((x) => { const r = x.getBoundingClientRect(); return { title: x.getAttribute('title'), cx: r.left + r.width / 2, cy: r.top + r.height / 2, spidered: x.classList.contains('spidered') }; }));
const spidered = async (p) => (await pins(p)).filter((x) => x.spidered);
const clickPin = (p, title) => p.locator(`.leaflet-marker-icon[title="${title}"]`).first().evaluate((e) => e.click());
const popupTitle = (p) => p.locator(`${MW} h3`).first().textContent().catch(() => null);
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => [i.id, i.lat, i.lon].join()).sort());
const baseline = items.map((i) => [i.id, i.lat, i.lon].join()).sort();
const apart = (rs) => rs.every((a, i) => rs.every((c, j) => j <= i || Math.hypot(a.cx - c.cx, a.cy - c.cy) >= 28));

// ================= a stack of four pins (three trips)
let { ctx, p } = await open();
ok((await pins(p)).filter((x) => x.title === 'Solo').length === 1, 'the pins are drawn');
await clickPin(p, 'Alpha'); await p.waitForTimeout(300);
let fan = await spidered(p);
ok(fan.length === 4 && await p.locator(`${MW}:not([hidden])`).count() === 0, 'a click on a stack of four fans all four out and opens no window (' + fan.length + ')');
ok(apart(fan), 'the fanned pins are clear of each other');
ok(await p.locator('path.spider-stem').count() === 4 && await p.locator('path.spider-hub').count() === 1, 'a stem joins each pin to the stack');
ok(!fan.some((x) => x.title === 'Solo') && (await pins(p)).find((x) => x.title === 'Solo').spidered === false, 'a pin that is not in the stack stays where it is');
ok(JSON.stringify(await stored(p)) === JSON.stringify(baseline), 'no marker record changed: coordinates are as stored');
const dots = await p.$$eval('.leaflet-marker-icon.spidered .trip-dot', (e) => e.map((x) => x.style.background));
ok(new Set(dots).size === 3, 'each fanned pin keeps its trip colour (three trips, three colours)');
// choosing one opens its own window and closes the fan
await clickPin(p, 'Beta'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Beta' && (await spidered(p)).length === 0, 'a click on a fanned pin opens that marker\'s own window and closes the fan');
ok(JSON.stringify(await stored(p)) === JSON.stringify(baseline), 'still no record changed');
ok(await p.locator('path.spider-stem').count() === 0, 'the stems are gone');
await p.evaluate(() => (document.querySelector('#marker-host:not([hidden]) .pop-close') || document.querySelector('.leaflet-popup-close-button')).click()); await p.waitForTimeout(200);
// every marker can be reached
const reached = [];
for (const name of ['Alpha', 'Beta', 'Gamma', 'Quiet pin']) {
  await clickPin(p, 'Alpha'); await p.waitForTimeout(250);
  const rs = await pins(p); const target = rs.find((x) => x.title === name && x.spidered);
  await p.mouse.click(target.cx, target.cy - 6); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
  reached.push(await popupTitle(p));
  await p.evaluate(() => (document.querySelector('#marker-host:not([hidden]) .pop-close') || document.querySelector('.leaflet-popup-close-button')).click()); await p.waitForTimeout(200);
}
ok(reached.join() === 'Alpha,Beta,Gamma,Quiet pin', 'a real mouse click on each fanned pin opens that very marker: ' + reached.join(', '));
// closes on background, Escape, zoom and pan
await clickPin(p, 'Alpha'); await p.waitForTimeout(250);
await p.mouse.click(120, 140); await p.waitForTimeout(300);
ok((await spidered(p)).length === 0, 'a click on the map background closes the fan');
await clickPin(p, 'Alpha'); await p.waitForTimeout(250);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok((await spidered(p)).length === 0, 'Escape closes it');
await clickPin(p, 'Alpha'); await p.waitForTimeout(250);
await p.mouse.move(700, 450); await p.mouse.wheel(0, -200); await p.waitForTimeout(900);
ok((await spidered(p)).length === 0, 'zooming closes it');
await p.evaluate(() => document.querySelector('.leaflet-container')._rot?.set(0, 'reset'));
// ================= keyboard
({}); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.click('#panel-close').catch(() => {}); await p.waitForTimeout(200);
await p.locator('.leaflet-marker-icon[title="Alpha"]').first().focus();
await p.keyboard.press('Enter'); await p.waitForTimeout(300);
ok((await spidered(p)).length === 4 && await p.evaluate(() => document.activeElement?.classList.contains('spidered')), 'Enter on a stacked pin fans it out and moves focus to a fanned pin');
ok((await p.textContent('[role=status].sr-only')).includes('4 markers at this spot'), 'a screen-reader announcement says how many markers there are and how to choose');
await p.keyboard.press('Tab'); await p.waitForTimeout(100);
const focused = await p.evaluate(() => document.activeElement?.getAttribute('title'));
await p.keyboard.press('Enter'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(focused && await popupTitle(p) === focused, 'Tab moves between fanned pins and Enter opens the focused marker (' + focused + ')');
await p.evaluate(() => (document.querySelector('#marker-host:not([hidden]) .pop-close') || document.querySelector('.leaflet-popup-close-button')).click()); await p.waitForTimeout(200);
await p.locator('.leaflet-marker-icon[title="Alpha"]').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok((await spidered(p)).length === 0 && await p.evaluate(() => !!document.activeElement?.classList.contains('poi-pin')), 'Escape closes the fan and keeps focus on a pin');
await ctx.close();

// ================= map rotation: hit targets follow the pins
({ ctx, p } = await open());
await p.evaluate(() => document.querySelector('.leaflet-container')._rot.set(55, 'compass')); await p.waitForTimeout(700);
await clickPin(p, 'Alpha'); await p.waitForTimeout(300);
fan = await spidered(p);
ok(fan.length === 4 && apart(fan), 'turned by 55 degrees: the fan still opens, pins apart on screen');
const rotReached = [];
for (const name of ['Gamma', 'Beta']) {
  const rs = await pins(p); const t = rs.find((x) => x.title === name && x.spidered);
  const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.leaflet-marker-icon')?.getAttribute('title'), [t.cx, t.cy - 6]);
  rotReached.push(hit);
}
ok(rotReached.join() === 'Gamma,Beta', 'the pin under the pointer at each fanned pin\'s centre is that pin: ' + rotReached.join(', '));
await p.mouse.click((await pins(p)).find((x) => x.title === 'Gamma' && x.spidered).cx, (await pins(p)).find((x) => x.title === 'Gamma' && x.spidered).cy - 6);
await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Gamma', 'and a click there opens it');
await ctx.close();

// ================= a hidden trip does not leak into the fan
({ ctx, p } = await open({ prefs: { tripHidden: ['t3'] } }));
await clickPin(p, 'Alpha'); await p.waitForTimeout(300);
fan = await spidered(p);
ok(fan.length === 3 && !fan.some((x) => x.title === 'Quiet pin') && (await pins(p)).filter((x) => x.title === 'Quiet pin').length === 0, 'with one trip hidden, its pin is neither drawn nor in the fan (' + fan.map((x) => x.title).join(', ') + ')');
await ctx.close();
// one visible pin left at the spot: nothing to fan
({ ctx, p } = await open({ prefs: { tripHidden: ['t2', 't3'] }, list: items.filter((i) => i.id !== 'm3') }));
await clickPin(p, 'Alpha'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Alpha' && (await spidered(p)).length === 0, 'a lone visible pin opens its window straight away (hidden pins are not counted as a stack)');
await ctx.close();

// ================= visits of one place within one trip are not a "stack of trips": the top pin and the visit chips stay as they were
({ ctx, p } = await open({ list: [mk('v1', 'First visit', 30.600, 114.310, { tripId: 't1', date: '2026-11-12' }), mk('v2', 'Second visit', 30.600, 114.310, { tripId: 't1', date: '2026-11-14' })] }));
await clickPin(p, 'Second visit'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Second visit' && (await spidered(p)).length === 0, 'two visits of one place in the same trip: the click opens that marker window as before, no fan');
await ctx.close();
({ ctx, p } = await open({ list: [mk('v1', 'First visit', 30.600, 114.310), mk('v2', 'Second visit', 30.600, 114.310)] }));
await clickPin(p, 'Second visit'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Second visit' && (await spidered(p)).length === 0, 'markers with no trip at one place: no fan either');
await ctx.close();
({ ctx, p } = await open({ list: [mk('v1', 'In trip', 30.600, 114.310, { tripId: 't1' }), mk('v2', 'No trip', 30.600, 114.310)] }));
await clickPin(p, 'In trip'); await p.waitForTimeout(300);
ok((await spidered(p)).length === 2, 'a marker in a trip and one with no trip at one place are different trips: they fan');
await ctx.close();

// ================= a lone pin behaves as before
({ ctx, p } = await open());
await clickPin(p, 'Solo'); await p.waitForSelector(`${MW} h3`, { timeout: 8000 });
ok(await popupTitle(p) === 'Solo' && (await spidered(p)).length === 0, 'a pin that is alone opens its window as before');
await ctx.close();

// ================= details off: a click on a fanned pin selects it (name tag), as before
({ ctx, p } = await open({ prefs: { markerDetails: false } }));
await clickPin(p, 'Alpha'); await p.waitForTimeout(300);
const t = (await pins(p)).find((x) => x.title === 'Gamma' && x.spidered);
await p.mouse.click(t.cx, t.cy - 6); await p.waitForTimeout(500);
ok(/Gamma/.test(await p.textContent('.name-tag')) && (await spidered(p)).length === 0 && await p.locator(`${MW}:not([hidden])`).count() === 0, 'with details off a click on a fanned pin selects it with a name tag and closes the fan');
await ctx.close();


await b.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
