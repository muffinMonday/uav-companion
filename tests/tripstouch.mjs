// Trips tab, day card, on a touch screen: a tap on a stop's name or number opens its marker, the Side Quest chip and the check-in button stay independent,
// hold-and-drag reorders, a tap right after a drag still works, a vertical drag scrolls, a horizontal swipe turns the day. Real touch events (CDP), phone portrait and landscape.
// Regression: on touch screens the Side Quest chip's ::after tap-target grew to a 316 x 400 px overlay over the card (the chip was not positioned), so taps on other stops hit the chip.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const trips = [{ id: 't1', name: 'Hubei spring', startDate: iso(1), endDate: iso(3), description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${id.length}.000Z`, tripId: 't1', ...extra });
const items = [
  mk('a', 'Alpha', 1, { date: iso(1), order: 1 }), mk('b', 'Bravo', 2, { date: iso(1), order: 2 }), mk('c', 'Charlie', 3, { date: iso(1), order: 3 }),
  mk('s1', 'Snack', 1.2, { type: 'other', date: iso(1), isSub: true, parentId: 'a', order: 1 }), mk('s2', 'Gate', 1.4, { type: 'other', date: iso(1), isSub: true, parentId: 'a', order: 2 }),
  mk('d', 'Delta', 4, { date: iso(2), order: 1 }),
];
const NEAR_BRAVO = { latitude: 30.5401, longitude: 114.2401, accuracy: 20 };
const b = await chromium.launch({ channel: CHANNEL });

async function run(name, vp) {
  console.log('--- ' + name);
  const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, permissions: ['geolocation'], geolocation: NEAR_BRAVO });
  await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', checkIn: true })); } }, [items, trips]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const showTrips = async () => {
    if (await p.evaluate(() => document.getElementById('panel').hidden)) await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click());
    else await p.evaluate(() => document.getElementById('tab-trips').click());
    await p.waitForTimeout(400);
  };
  await showTrips();
  await p.locator('#trips-list .trip-card .trip-card-head').first().click(); await p.waitForTimeout(400);
  if (await p.isVisible('#panel-expand') && (await p.getAttribute('#panel-expand', 'aria-pressed')) !== 'true') { await p.click('#panel-expand'); await p.waitForTimeout(500); }

  const D = '#trip-detail ';
  const stop = (id) => `${D}.plan-stop[data-id="${id}"], ${D}[data-id="${id}"] > .plan-stop`;
  const reopen = async () => { if (await p.evaluate(() => document.getElementById('panel').hidden)) { await p.evaluate(() => document.querySelector('#dock button[data-tab=trips]').click()); await p.waitForTimeout(450); } };
  const popupText = () => p.evaluate(() => document.querySelector('.leaflet-popup')?.innerText ?? '');
  const closePopup = async () => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button, .pop-close')?.click()); await p.waitForTimeout(350); };
  const mains = () => p.$$eval(`${D}.flip-body .plan-stop`, (e) => e.filter((x) => !x.closest('.plan-side')).map((x) => x.querySelector('b').textContent).join(','));
  const rowIds = () => p.$$eval(`${D}.flip-body .plan-stop`, (e) => e.map((x) => x.querySelector('b').textContent).join(','));
  const stored = () => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => [i.id, i])));
  // where to touch: scroll the part into view, wait for it to settle, take its centre
  const at = async (sel, scroll = true) => {
    if (scroll) { await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel); await p.waitForTimeout(450); }
    return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom }; }, sel);
  };
  const tap = async (sel) => { await reopen(); const r = await at(sel); await p.touchscreen.tap(r.x, r.y); await p.waitForTimeout(500); };
  // the popup follows the map move, or a 700 ms timer when the map is already there: wait for it
  const opened = (nm) => p.waitForFunction((n) => new RegExp(n).test(document.querySelector('.leaflet-popup')?.innerText ?? ''), nm, { timeout: 3000 }).then(() => true, () => false);

  // a hit test of every visible part: what is at the centre of the name, the number and the row belongs to that row
  const hits = () => p.evaluate(async (sel) => {
    const out = [];
    for (const row of document.querySelectorAll(sel)) {
      row.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 350));
      const good = ['.plan-name', '.plan-n'].map((c) => { const e = row.querySelector(c); const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!h && row.contains(h); });
      out.push(good.every(Boolean) ? 'ok' : row.querySelector('b').textContent);
    }
    return out;
  }, `${D}.flip-body .plan-stop`);
    ok((await hits()).every((x) => x === 'ok') && (await hits()).length >= 3, 'hit test: the name and the number of every visible stop are reached by their own row, nothing sits over them: ' + JSON.stringify(await hits()));

  // 1, 2, 3: names and numbers, consecutively
  await tap(`${stop('b')} .plan-name`);
  ok(await opened('Bravo'), 'tapping a name opens that marker');
  await tap(`${stop('c')} .plan-n`);
  ok(await opened('Charlie') && !/Bravo/.test(await popupText()), 'tapping the numbered circle of the next stop opens that one, straight after');
  await tap(`${stop('b')} .plan-name`);
  ok(await opened('Bravo'), 'and back again');
  await tap(`${stop('c')} .plan-name`);
  ok(await opened('Charlie'), 'and again');

  // 4, 5, 6: Side Quests
  await tap(`${stop('a')} .plan-name`);
  ok(await opened('Alpha'), 'tapping a stop that has Side Quests opens its marker');
  await reopen();
  ok((await p.getAttribute(`${D}.side-chip`, 'aria-expanded')) === 'true' && (await rowIds()) === 'Alpha,Snack,Gate,Bravo,Charlie', 'and unfolds its Side Quests: ' + await rowIds());
  await tap(`${D}.side-chip`);
  ok((await p.getAttribute(`${D}.side-chip`, 'aria-expanded')) === 'false' && (await rowIds()) === 'Alpha,Bravo,Charlie', 'the chip folds them again');
  await closePopup();
  const before = await popupText();
  await tap(`${D}.side-chip`);
  ok((await p.getAttribute(`${D}.side-chip`, 'aria-expanded')) === 'true' && (await rowIds()) === 'Alpha,Snack,Gate,Bravo,Charlie' && !(await popupText()), 'the chip unfolds them without opening any marker (popup was ' + JSON.stringify(before) + ' before)');
  ok((await hits()).every((x) => x === 'ok'), 'hit test with the Side Quests unfolded: ' + JSON.stringify(await hits()));
  await tap(`${stop('s1')} .plan-name`);
  ok(await opened('Snack'), 'tapping a Side Quest opens it');
  await tap(`${stop('c')} .plan-n`);
  ok(await opened('Charlie'), 'a stop below the unfolded Side Quests opens too');
  await tap(`${D}.side-chip`);  // fold again for the rest
  await closePopup();

  // 7: check-in
  const cin = `${D}.plan-row[data-id="b"] .checkin-btn`;
  await reopen(); await p.waitForFunction((s) => { const e = document.querySelector(s); return e && !e.disabled; }, cin, { timeout: 15000 });
  await tap(cin);
  const rec = (await stored()).b.checkin;
  ok(!!rec && !(await popupText()), 'tapping the check-in button records the check-in and opens no marker: ' + JSON.stringify(rec));

  // 8, 9: hold and drag Charlie above Bravo, then tap at once
  await reopen();
  const rc = await at(stop('c')), rb = await at(stop('b'), false);
  await touch('touchStart', [{ x: rc.x, y: rc.y }]);
  await p.waitForTimeout(1300);
  ok((await p.locator('.drag-ghost').count()) === 1, 'a held stop lifts after one second');
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: rc.x, y: rc.y + ((rb.top + 3 - rc.y) * i) / 8 }]); await p.waitForTimeout(30); }
  await p.waitForTimeout(150);
  await touch('touchEnd', []);
  const t0 = Date.now();
  const rn = await p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, `${stop('b')} .plan-name`);
  ok(!(await popupText()), 'the drop itself opens no marker');
  await p.touchscreen.tap(rn.x, rn.y); const gap = Date.now() - t0;
  await p.waitForTimeout(500);
  ok(gap < 380 && await opened('Bravo'), 'a tap straight after the drop (' + gap + ' ms) is not swallowed');
  ok((await mains()) === 'Alpha,Charlie,Bravo', 'the drag reordered the day: ' + await mains());
  const o = await stored();
  ok(o.c.order === 2 && o.b.order === 3, 'and saved it: Charlie ' + o.c.order + ', Bravo ' + o.b.order);

  // 10: vertical scroll
  await reopen(); await closePopup();
  const rr = await at(stop('c'));
  const room = await p.evaluate(() => { const s = document.querySelector('.sp-body'); return { up: s.scrollTop, down: s.scrollHeight - s.clientHeight - s.scrollTop }; });
  const dir = room.down > 60 ? -1 : 1, startTop = await p.evaluate(() => document.querySelector('.sp-body').scrollTop);
  await touch('touchStart', [{ x: rr.x, y: rr.y }]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: rr.x, y: rr.y + dir * i * 12 }]); await p.waitForTimeout(25); }
  await touch('touchEnd', []); await p.waitForTimeout(500);
  const moved = Math.abs((await p.evaluate(() => document.querySelector('.sp-body').scrollTop)) - startTop);
  ok(moved > 20, 'a vertical drag over a stop scrolls the panel (' + Math.round(moved) + ' px)');
    ok(!(await popupText()) && (await p.locator('.drag-ghost').count()) === 0, 'and neither opens a marker nor lifts the row');

  // 11: horizontal swipe turns the day
  await reopen();
  const title = () => p.textContent(`${D}.flip-title`);
  ok(/Day 1/.test(await title()), 'on Day 1: ' + await title());
  const swipe = async (dx) => { const rs = await p.evaluate(() => { const r = document.querySelector('#trip-detail .flip-body').getBoundingClientRect(), v = document.querySelector('.sp-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: (Math.max(r.top, v.top) + Math.min(r.bottom, v.bottom)) / 2 }; }); await touch('touchStart', [{ x: rs.x, y: rs.y }]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: rs.x + (dx * i) / 6, y: rs.y }]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(450); };
  await at(`${D}.flip-body`); await swipe(-140);
  ok(/Day 2/.test(await title()) && !(await popupText()), 'a swipe left shows Day 2 and opens nothing: ' + await title());
  await swipe(140);
  ok(/Day 1/.test(await title()) && !(await popupText()), 'a swipe right goes back: ' + await title());

  // 12: keyboard
  await closePopup(); await reopen();
  await p.focus(stop('b')); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  ok(await opened('Bravo'), 'Enter on a focused stop opens it');
  await closePopup(); await reopen();
  await p.focus(stop('c')); await p.keyboard.press('Space'); await p.waitForTimeout(500);
  ok(await opened('Charlie'), 'Space on a focused stop opens it');
  await ctx.close();
}

await run('phone portrait', { width: 390, height: 844 });
await run('phone landscape', { width: 844, height: 390 });
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
