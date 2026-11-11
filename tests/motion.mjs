// Motion: the dashboard, strip and tab centre in the free map area; the basic animations run for visitors who have not asked for less motion
// and are absent when they have. (The rest of the suite runs with reduced motion, see lib.mjs.)
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
async function open(reduced) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: true, welcomed: true, seen: '2026-11-11' })); localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [['a', 'Alpha', 30.59, 114.3, 1], ['b', 'Bravo', 30.60, 114.31, 2], ['c', 'Charlie', 30.61, 114.32, 3]].map(([id, name, lat, lon, order]) => ({ id, type: 'photo', name, note: '', lat, lon, created: '2026-11-01T00:00:0' + order + '.000Z', date: '2026-11-20', order })) })); localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' })); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  return { ctx, p };
}
const anim = (p, sel) => p.$eval(sel, (e) => getComputedStyle(e).animationName);
const centre = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.x + r.width / 2; });
const width = (p, sel) => p.$eval(sel, (e) => e.getBoundingClientRect().width);

// ================= centring (the same with or without motion)
for (const reduced of [true, false]) {
  const { ctx, p } = await open(reduced);
  const tag = reduced ? ' (reduced motion)' : '';
  await p.waitForTimeout(450);
  const free = (1300 - 372) / 2;
  const d1 = await centre(p, '#dash');
  ok(Math.abs(d1 - free) < 4, 'with the side panel open the dashboard is centred in the map beside it: ' + Math.round(d1) + ' vs ' + Math.round(free) + tag);
  await p.click('#dash-collapse'); await p.waitForTimeout(400);
  const pk = await centre(p, '#dash-peek');
  ok(Math.abs(pk - d1) < 4, 'and the strip sits at the same centre: ' + Math.round(pk) + tag);
  await p.click('#dash-peek'); await p.waitForTimeout(400);
  await p.click('#panel-close');
  await p.waitForTimeout(reduced ? 60 : 300); // the panel slides out first (200 ms), then the dashboard glides to the middle
  const mid = await centre(p, '#dash');
  await p.waitForTimeout(500);
  const d2 = await centre(p, '#dash');
  ok(Math.abs(d2 - 650) < 4, 'with the panel hidden they centre on the screen: ' + Math.round(d2) + tag);
  if (reduced) ok(Math.abs(mid - 650) < 4, 'with reduced motion it is there at once');
  else ok(mid > free + 6 && mid < 650 - 6, 'otherwise it glides there: ' + Math.round(mid) + ' on the way from ' + Math.round(free) + ' to 650');
  await p.click('#dash-close'); await p.waitForTimeout(400);
  ok(Math.abs((await centre(p, '#dash-tab')) - 650) < 4, 'the ^ tab is centred too' + tag);
  await ctx.close();
}

// ================= the animations, with motion and without
for (const reduced of [false, true]) {
  const { ctx, p } = await open(reduced);
  const tag = reduced ? ' (reduced motion)' : '';
  const want = (name) => (reduced ? 'none' : name);
  ok(await anim(p, '#dash') === (reduced ? 'none' : 'dash-up'), 'the dashboard slides up' + (reduced ? ' only with motion on: none here' : ''));
  await p.click('#dash-collapse'); await p.waitForTimeout(100);
  ok(await anim(p, '#dash-peek') === want('pop-in'), 'the strip pops in' + tag);
  await p.click('#dash-peek');
  await p.click('#tab-trips'); await p.waitForTimeout(60);
  ok(await anim(p, '#pane-trips') === want('fade-in'), 'a tab\'s contents fade in' + tag);
  await p.click('#tab-poi'); await p.waitForTimeout(300);
  await p.click('#poi-center'); await p.waitForSelector('.poi-pin.drop', { timeout: 8000 });
  ok(await p.$eval('.poi-pin.drop svg', (e) => getComputedStyle(e).animationName) === want('pin-drop'), 'a new pin drops onto the map' + tag);
  await p.keyboard.press('Escape');
  // the search box grows
  await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
  await p.click('#panel-close'); await p.waitForTimeout(300);
  await p.click('#search-toggle'); await p.waitForTimeout(70);
  const early = await width(p, '#q');
  await p.waitForTimeout(450);
  const full = await width(p, '#q');
  ok(full > 250 && (reduced ? early > 250 : early < full - 20), 'the search box ' + (reduced ? 'opens at once' : 'grows open (' + Math.round(early) + ' then ' + Math.round(full) + ' px)') + tag);
  await p.click('#search-toggle'); await p.waitForTimeout(500);
  ok(await width(p, '#q') === 0, 'and folds back to nothing' + tag);
  await ctx.close();
}
// ================= part 2: leaving, rolling, rows
for (const reduced of [false, true]) {
  const { ctx, p } = await open(reduced);
  const tag = reduced ? ' (reduced motion)' : '';
  await p.click('#tab-poi'); await p.waitForTimeout(300);
  // rows: a new one eases in, a moved one glides
  await p.click('#poi-center'); await p.waitForSelector('.poi-pop form', { timeout: 8000 }); await p.waitForTimeout(30);
  const entering = await p.evaluate(() => [...document.querySelectorAll('#poi-list li.enter')].length);
  ok(reduced ? entering === 0 : entering >= 1, 'a new row ' + (reduced ? 'just appears' : 'eases in') + tag);
  await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
  await p.focus('#poi-list .poi-item:has-text("Alpha")');
  await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(40);
  const gliding = await p.evaluate(() => [...document.querySelectorAll('#poi-list li')].filter((li) => li.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => k.translate))).length);
  ok(reduced ? gliding === 0 : gliding >= 1, 'a row moved by the keyboard ' + (reduced ? 'is simply in its new place' : 'glides to it') + tag);
  // the dashboard slides down when it collapses
  await p.click('#dash-collapse'); await p.waitForTimeout(60);
  const d = await p.evaluate(() => ({ hidden: document.getElementById('dash').hidden, closing: document.getElementById('dash').classList.contains('closing'), peek: !document.getElementById('dash-peek').hidden }));
  ok(reduced ? d.hidden && d.peek : !d.hidden && d.closing && !d.peek, 'the dashboard ' + (reduced ? 'is gone at once' : 'is still sliding down a moment after V') + tag);
  await p.waitForTimeout(450);
  ok(await p.evaluate(() => document.getElementById('dash').hidden && !document.getElementById('dash-peek').hidden), 'and then the strip appears' + tag);
  // the panel rolls
  const full = await p.$eval('#panel', (e) => e.getBoundingClientRect().height);
  await p.click('#panel-roll'); await p.waitForTimeout(90);
  const mid = await p.$eval('#panel', (e) => e.getBoundingClientRect().height);
  await p.waitForTimeout(450);
  const rolled = await p.$eval('#panel', (e) => e.getBoundingClientRect().height);
  ok(rolled < 130 && (reduced ? Math.abs(mid - rolled) < 2 : mid > rolled + 10 && mid < full - 10), 'the panel ' + (reduced ? 'rolls up at once' : 'rolls up smoothly (' + Math.round(full) + ', then ' + Math.round(mid) + ', then ' + Math.round(rolled) + ' px)') + tag);
  await p.click('#panel-roll'); await p.waitForTimeout(500);
  ok(Math.abs((await p.$eval('#panel', (e) => e.getBoundingClientRect().height)) - full) < 4, 'and rolls back to its full height' + tag);
  // the panel slides out when closed
  await p.click('#panel-close'); await p.waitForTimeout(60);
  const c = await p.evaluate(() => ({ hidden: document.getElementById('panel').hidden, closing: document.getElementById('panel').classList.contains('closing') }));
  ok(reduced ? c.hidden : !c.hidden && c.closing, 'the panel ' + (reduced ? 'is gone at once' : 'is still sliding out a moment after the cross') + tag);
  await p.waitForTimeout(450);
  ok(await p.evaluate(() => document.getElementById('panel').hidden && !document.getElementById('dock').hidden), 'and then the dock comes back' + tag);
  await ctx.close();
}
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
