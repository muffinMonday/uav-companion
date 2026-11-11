// Open in Google Maps / Amap: the buttons in marker and check windows, and a route through the ticked places.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, lat, lon, extra = {}) => ({ id, type: 'photo', name, note: '', lat, lon, created: `2026-11-01T00:00:${String(id.length + id.charCodeAt(0) % 40).padStart(2, '0')}.000Z`, ...extra });
const base = [
  mk('yc', 'Yellow Crane Tower', 30.5928, 114.3055, { date: '2026-11-12', day: 1, order: 2 }),
  mk('el', 'East Lake', 30.55, 114.37, { date: '2026-11-13', day: 2, order: 1 }),
  mk('ap', 'Airport', 30.7838, 114.2098, { date: '2026-11-12', day: 1, order: 1 }),
  mk('sg', 'Marina Bay', 1.2894, 103.85),
  mk('hm', 'Flat', 30.4, 114.1, { type: 'residence' }),
];

const b = await chromium.launch({ channel: CHANNEL });
async function session({ items = base, viewport = { width: 1200, height: 800 }, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((po) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); } }, items);
  // the real map apps are never contacted
  for (const host of ['**/uri.amap.com/**', '**/www.google.com/maps/**']) await ctx.route(host, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>ok</html>' }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const openMarker = async (p, name) => {
  await p.click(`#poi-list .poi-item:has-text("${name}")`);
  await p.waitForFunction((n) => document.querySelector('.poi-pop h3')?.textContent === n, name, { timeout: 8000 });
  await p.waitForTimeout(900);
};
const hrefs = (p, scope) => p.$$eval(`${scope} a.maplink`, (a) => a.map((x) => ({ t: x.textContent, h: x.getAttribute('href'), target: x.target, rel: x.rel })));

// ================= one place
let { ctx, p } = await session();
await openMarker(p, 'Yellow Crane Tower');
let links = await hrefs(p, '.poi-pop .maplinks-row:first-child');
ok(links.map((l) => l.t).join() === 'Amap,Google Maps', 'a marker in China: Amap first, then Google Maps');
ok(links[0].h === 'https://uri.amap.com/marker?position=114.305500,30.592800&name=Yellow%20Crane%20Tower&coordinate=wgs84&src=uav-companion&callnative=1', 'the Amap link: ' + links[0].h);
ok(links[1].h === 'https://www.google.com/maps/search/?api=1&query=30.592800%2C114.305500', 'the Google link: ' + links[1].h);
ok(links.every((l) => l.target === '_blank' && /noopener/.test(l.rel)), 'links open in a new tab without handing over the page (noopener)');
const dir = await hrefs(p, '.poi-pop .maplinks-row:nth-child(2)');
ok(dir.length === 2 && /travelmode=driving/.test(dir[1].h) && !/origin=/.test(dir[1].h) && /uri\.amap\.com\/navigation\?to=/.test(dir[0].h) && !/from=/.test(dir[0].h), 'Directions here: no start in either link, so both use the device location');
await p.selectOption('.poi-pop .maplinks-mode', 'transit');
const dir2 = await hrefs(p, '.poi-pop .maplinks-row:nth-child(2)');
ok(/travelmode=transit/.test(dir2[1].h) && /mode=bus/.test(dir2[0].h), 'choosing Public transport changes both links (transit, bus)');
const amap = p.locator('.poi-pop .maplinks-row:first-child a:has-text("Amap")');
await amap.scrollIntoViewIfNeeded();
const [opened] = await Promise.all([ctx.waitForEvent('page'), amap.click()]);
ok(/^https:\/\/uri\.amap\.com\/marker\?position=114\.305500,30\.592800/.test(opened.url()), 'clicking it opens a new tab at that address');
await opened.close();
ok((await p.locator('.poi-pop h3').textContent()) === 'Yellow Crane Tower', 'and the window stays open here');
await p.keyboard.press('Escape');
await p.mouse.click(130, 700); await p.waitForTimeout(400);

await openMarker(p, 'Marina Bay');
links = await hrefs(p, '.poi-pop .maplinks-row:first-child');
ok(links.length === 1 && links[0].t === 'Google Maps', 'a marker outside China: Google Maps only');
ok((await hrefs(p, '.poi-pop .maplinks-row:nth-child(2)')).length === 1, 'Directions here: Google Maps only too');
await p.mouse.click(130, 700); await p.waitForTimeout(400);

// the Home marker asks first
await openMarker(p, 'Flat');
ok((await p.locator('.poi-pop .maplinks a.maplink').count()) === 0 && (await p.locator('.poi-pop .maplinks button.maplink').count()) === 4, 'the Home marker\'s buttons are buttons, not plain links: each asks first');
const homeBtn = p.locator('.poi-pop .maplinks-row:first-child button.maplink').first();
await homeBtn.scrollIntoViewIfNeeded();
let extra = 0; ctx.on('page', () => { extra++; });
await homeBtn.click(); await p.waitForTimeout(500);
ok(/Share Home location/.test(await homeBtn.textContent()) && extra === 0, 'the first tap changes the text to "Share Home location? Tap again" and opens nothing');
const [homeTab] = await Promise.all([ctx.waitForEvent('page'), homeBtn.click()]);
ok(/^https:\/\/uri\.amap\.com\/marker\?position=114\.100000,30\.400000/.test(homeTab.url()), 'the second tap opens it');
await homeTab.close();
await ctx.close();

// ================= the check window (Enter on the map)
({ ctx, p } = await session());
await p.click('#panel-close');
await p.evaluate(() => document.getElementById('map').focus());
await p.keyboard.press('Enter'); await p.waitForSelector('.leaflet-popup .maplinks'); await p.waitForTimeout(500);
links = await hrefs(p, '.leaflet-popup .maplinks-row:first-child');
ok(links.map((l) => l.t).join() === 'Amap,Google Maps' && /name=3\d\.\d{5}%20114\.\d{5}/.test(links[0].h), 'a point check in Hubei has the buttons too, Amap first, named by its coordinates: ' + (links[0] && links[0].h));
await ctx.close();

// ================= a route
({ ctx, p } = await session());
await p.click('#poi-select');
const tick = async (name) => { await p.click(`#poi-list .poi-item:has-text("${name}")`); await p.waitForTimeout(150); };
ok(!(await p.isVisible('#route-box')) && (await p.isVisible('#route-hint')), 'with nothing ticked there is a hint and no route');
await tick('Airport');
ok(!(await p.isVisible('#route-box')), 'one place is not a route');
await tick('Yellow Crane Tower'); await tick('East Lake');
ok(await p.isVisible('#route-box'), 'two or more ticked places make a route');
const names = () => p.$$eval('#route-stops .route-name', (e) => e.map((x) => x.textContent));
ok((await names()).join() === 'Airport,Yellow Crane Tower,East Lake', 'the stops are in the order they were ticked: ' + (await names()).join(' > '));
const nums = await p.$$eval('#poi-list li.selecting', (li) => li.map((x) => `${x.dataset.id}:${x.querySelector('.sel-num').textContent}`).filter((s) => !/:$/.test(s)).sort());
ok(nums.join() === 'ap:1,el:3,yc:2', 'the ticked rows are numbered 1, 2, 3: ' + nums.join(' '));
let rl = await hrefs(p, '#route-links');
ok(rl.length === 2 && rl[0].t === 'Open in Amap' && rl[1].t === 'Open in Google Maps', 'all stops in China: Amap first, then Google Maps, one link each');
ok(/from=[\d.]+,[\d.]+,Airport/.test(rl[0].h) && /via=[\d.]+,[\d.]+,Yellow%20Crane%20Tower/.test(rl[0].h) && /to=[\d.]+,[\d.]+,East%20Lake/.test(rl[0].h) && /mode=car/.test(rl[0].h), 'the Amap route has the first stop as from, the middle one as via, the last as to');
ok(/waypoints=30\.592800%2C114\.305500&?/.test(rl[1].h) && /origin=30\.783800%2C114\.209800/.test(rl[1].h) && /destination=30\.550000%2C114\.370000/.test(rl[1].h), 'the Google route has origin, waypoint and destination in the same order');
await p.click('#route-reverse');
ok((await names()).join() === 'East Lake,Yellow Crane Tower,Airport', 'Reverse turns the route round');
await p.locator('#route-stops li:nth-child(3) button[aria-label^="Move"]:first-of-type').click();
ok((await names()).join() === 'East Lake,Airport,Yellow Crane Tower', 'the up arrow moves a stop earlier');
ok(await p.isDisabled('#route-stops li:first-child button:first-of-type') && await p.isDisabled('#route-stops li:last-child button:nth-of-type(2)'), 'the first stop cannot go up and the last cannot go down');
await p.click('#route-sort');
ok((await names()).join() === 'Airport,Yellow Crane Tower,East Lake', 'Use itinerary order sorts by date, day and stop');
await p.selectOption('#route-mode', 'transit');
rl = await hrefs(p, '#route-links');
ok(rl.length === 3 && /part 1/.test(rl[0].t) && /part 2/.test(rl[1].t) && /travelmode=transit/.test(rl[2].h) && /each leg/.test(await p.textContent('#route-links')), 'by public transport Amap opens each leg separately (2 parts, with a note), Google Maps still one link');
await p.selectOption('#route-mode', 'drive');
await tick('Marina Bay');
rl = await hrefs(p, '#route-links');
ok(rl.length === 1 && rl[0].t === 'Open in Google Maps' && /every stop is in China/.test(await p.textContent('#route-links')), 'a stop outside China: only Google Maps, with a note saying why');
await p.locator('#route-stops li:last-child button[aria-label^="Remove"]').click(); await p.waitForTimeout(200);
ok((await names()).length === 3 && (await hrefs(p, '#route-links')).length === 2, 'the cross removes a stop and untick its row; Amap is back');
await p.click('#sel-none'); await p.waitForTimeout(200);
ok(!(await p.isVisible('#route-box')), 'None clears the route');

// the Home marker in a route
await tick('Airport'); await tick('Flat');
ok((await p.locator('#route-links a.maplink').count()) === 0 && (await p.locator('#route-links button.maplink').count()) === 2, 'a route that includes the Home marker asks before opening: buttons, not links');
await p.screenshot({ path: `${SP}/maplinks-route.png` });
await ctx.close();

// ---- many stops
const many = Array.from({ length: 12 }, (_, i) => mk('m' + String.fromCharCode(97 + i), `Stop ${i + 1}`, 30.5 + i * 0.01, 114.3 + i * 0.01, { date: '2026-11-12', day: 1, order: i + 1 }));
({ ctx, p } = await session({ items: many }));
await p.click('#poi-select'); await p.click('#sel-all'); await p.waitForTimeout(300);
rl = await hrefs(p, '#route-links');
const gParts = rl.filter((x) => /Google Maps, part/.test(x.t)), aParts = rl.filter((x) => /Amap, part/.test(x.t));
ok(gParts.length === 2 && aParts.length === 6, '12 stops: Google Maps in 2 parts (9 stops between at most), Amap in 6 (one stop between): ' + gParts.length + ' / ' + aParts.length);
ok(/9 stops/.test(await p.textContent('#route-links')) && /one stop/.test(await p.textContent('#route-links')), 'each app explains its limit');
await ctx.close();

// ================= phone
({ ctx, p } = await session({ viewport: { width: 360, height: 740 }, mobile: true }));
await p.tap('#poi-select');
for (const n of ['Airport', 'Yellow Crane Tower', 'East Lake']) { await p.tap(`#poi-list .poi-item:has-text("${n}")`); await p.waitForTimeout(150); }
const fit = await p.evaluate(() => { const box = document.getElementById('route-box').getBoundingClientRect(); const over = [...document.querySelectorAll('#route-box button, #route-box a, #route-box select')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; }).length; return { over, page: document.documentElement.scrollWidth > innerWidth + 1 }; });
ok(fit.over === 0 && !fit.page, 'at 360 px the route block fits with no sideways scrolling');
await p.screenshot({ path: `${SP}/maplinks-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
