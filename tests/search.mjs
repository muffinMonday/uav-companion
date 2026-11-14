// The search box: coordinates and pasted map links, and a blue pin plus the point-check window for the picked result.
import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
const openSearch = (p) => p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); }); // the search box starts folded into a magnifying glass
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const online = [];
  for (const host of ['**/photon.komoot.io/**', '**/nominatim.openstreetmap.org/**']) await ctx.route(host, (route) => { online.push(route.request().url()); return route.fulfill({ status: 500, body: '' }); });
  for (const host of ['**/uri.amap.com/**', '**/www.google.com/maps/**']) await ctx.route(host, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
  await p.waitForTimeout(300);
  return { ctx, p, online };
}
const type = async (p, text) => { await openSearch(p); await p.fill('#q', ''); await openSearch(p); await p.fill('#q', text); await p.waitForTimeout(200); };
const rows = (p) => p.$$eval('#results li[role=option]', (l) => l.map((x) => ({ main: x.querySelector('span').textContent, sub: x.querySelector('small').textContent })));
const msgText = (p) => p.evaluate(() => document.querySelector('#results li.msg')?.textContent || '');
const pin = (p) => p.evaluate(() => { const e = document.querySelector('img.leaflet-marker-icon'); if (!e) return null; const r = e.getBoundingClientRect(); const m = document.getElementById('map').getBoundingClientRect(); return { n: document.querySelectorAll('img.leaflet-marker-icon').length, x: r.x + r.width / 2, bottom: r.bottom, top: r.top, mx: m.x + m.width / 2, my: m.y + m.height / 2 }; });
const win = (p) => p.evaluate(() => { const w = document.querySelector('.leaflet-popup-content-wrapper'); if (!w) return null; const r = w.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, text: w.innerText, amap: !!w.querySelector('a.maplink[href*="amap.com/navigation"]'), nav: !!w.querySelector('a.maplink[href*="amap.com/navigation"]') && w.querySelectorAll('a.maplink').length === 1, google: !!w.querySelector('a.maplink[href*="google.com"]'), add: [...w.querySelectorAll('button')].some((x) => x.textContent === 'Add as marker'), remove: [...w.querySelectorAll('button')].some((x) => x.textContent === 'Remove pin'), href: w.querySelector('a.maplink[href*="amap.com/navigation"], a.maplink[href*="google.com/maps"]')?.getAttribute('href') || '' }; });
const waitWin = async (p) => { await p.waitForSelector('.leaflet-popup .maplinks', { timeout: 8000 }); await p.waitForTimeout(900); };

// ================= coordinates in China
let { ctx, p, online } = await session();
ok(/coordinates/i.test(await p.getAttribute('#q', 'placeholder')), 'the search box says it takes coordinates');
await type(p, '30.5928, 114.3055');
let r = await rows(p);
ok(r.length === 2 && r[0].main === '30.59280, 114.30550' && /GPS/.test(r[0].sub) && /Amap/.test(r[1].sub), 'coordinates in China give two rows: GPS as typed, and converted from Amap: ' + JSON.stringify(r.map((x) => x.main)));
ok((await p.locator('#results li.online').count()) === 0, 'there is no "search online" row for coordinates');
await p.keyboard.press('Enter'); await waitWin(p);
let pn = await pin(p), w = await win(p);
ok(pn && pn.n === 1 && Math.abs(pn.x - pn.mx) < 14 && Math.abs(pn.bottom - pn.my) < 14, 'Enter drops a blue pin on the point and centres it: pin at (' + Math.round(pn && pn.x) + ',' + Math.round(pn && pn.bottom) + '), map centre (' + Math.round(pn && pn.mx) + ',' + Math.round(pn && pn.my) + ')');
ok(w && w.bottom <= pn.top + 2 && w.top >= 0, 'the window sits above the pin and fully on screen');
ok(w && /Suitable-flight zone|Outside the suitable-flight zone|No suitable-flight|zone/i.test(w.text), 'it is the point-check window: it gives the zone verdict');
ok(w.amap && w.nav && !w.google && w.add && w.remove, 'with the one Navigate action in Amap, and the Add as marker and Remove pin tools');
ok(!/30\.59280, 114\.30550|Latitude/.test('') && /navigation\?to=114\.3\d+,30\.5\d+/.test(w.href), 'its Navigate link points at the typed coordinates: ' + w.href);
ok(online.length === 0, 'nothing was sent to an online search');

// the second reading
await type(p, '30.5928, 114.3055');
await p.locator('#results li[role=option]').nth(1).dispatchEvent('mousedown'); await waitWin(p);
w = await win(p); pn = await pin(p);
const m = (w.href.match(/navigation\?to=([\d.]+),([\d.]+)/) || []).map(Number); [m[1], m[2]] = [m[2], m[1]];
// the Navigate link is in Amap's own coordinates (GCJ-02): for the Amap reading the pin sits at the converted WGS point, so the link's coordinates come back to what was typed
ok(pn.n === 1 && m && Math.abs(+m[1] - 30.5928) < 0.0005 && Math.abs(+m[2] - 114.3055) < 0.0005, 'choosing the Amap reading keeps one pin, at the converted point (its Amap link returns the typed numbers): ' + (m && `${m[1]}, ${m[2]}`));
await ctx.close();

// ================= coordinates outside China, links, errors
({ ctx, p, online } = await session());
await type(p, '1.2894, 103.8500');
r = await rows(p);
ok(r.length === 1 && /GPS/.test(r[0].sub), 'outside China there is one row');
await p.keyboard.press('Enter'); await waitWin(p);
w = await win(p);
ok(w && w.google && !w.amap && w.add, 'outside China the window offers Google Maps only, and Add as marker');
await type(p, '95.5, 100');
ok(/Latitude must be between −90 and 90/.test(await msgText(p)) && (await rows(p)).length === 0, 'an impossible latitude is explained in the list: ' + (await msgText(p)));
const before = await pin(p);
await p.keyboard.press('Enter'); await p.waitForTimeout(400);
ok((await pin(p)).n === before.n && online.length === 0, 'Enter does nothing then, and sends nothing online');
await type(p, '30.5, 114.3, 7');
ok((await p.locator('#results li.online').count()) === 1, 'something that is not coordinates still offers the online name search');
await type(p, 'https://maps.app.goo.gl/AbCdEf123');
ok(/short link/.test(await msgText(p)), 'a short link is explained');
await type(p, 'https://www.google.com/maps/@1.2894,103.8500,15z');
r = await rows(p);
ok(r.length === 1 && r[0].main === '1.28940, 103.85000' && /link/.test(r[0].sub), 'a pasted Google Maps link is read: ' + JSON.stringify(r));
await p.keyboard.press('Enter'); await waitWin(p);
ok((await pin(p)).n === 1, 'and picked like any result (the old pin was replaced)');
await ctx.close();

// ================= a place name
({ ctx, p, online } = await session());
await type(p, '宜昌');
r = await rows(p);
ok(r.length >= 1 && (await p.locator('#results li.online').count()) === 1, 'a place name lists offline matches and the online option');
await p.keyboard.press('Enter'); await waitWin(p);
pn = await pin(p); w = await win(p);
ok(pn && pn.n === 1 && Math.abs(pn.x - pn.mx) < 14 && w && /zone/i.test(w.text) && w.amap && w.nav && w.add, 'a name search also gets the pin and the same window, with the buttons');
ok(/宜昌|Yichang/i.test(w.text), 'titled with the place name');
await p.mouse.click(120, 700); await p.waitForTimeout(500);
ok((await p.locator('.leaflet-popup').count()) === 0 && (await pin(p)).n === 1, 'a click on blank map closes the window but leaves the pin');
const pp = await pin(p);
await p.mouse.click(pp.x, pp.top + 20); await waitWin(p);
ok((await win(p)) !== null, 'clicking the pin opens the window again');

// add as marker
const addBtn = p.locator('.leaflet-popup-content-wrapper button:has-text("Add as marker")');
await addBtn.scrollIntoViewIfNeeded();
await addBtn.click(); await p.waitForSelector('.poi-pop form', { timeout: 8000 }); await p.waitForTimeout(500);
const items = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois') || '{"items":[]}').items);
ok(items.length === 1 && /宜昌|Yichang/i.test(items[0].name), 'Add as marker saves it, named after the place: ' + (items[0] && items[0].name));
ok((await pin(p)) === null && (await p.locator('.poi-pop form').count()) === 1, 'the blue pin is gone and the new marker\'s form is open');
await p.click('.poi-pop form button:has-text("Cancel")'); await p.waitForTimeout(400);

// remove pin
await type(p, '30.5928, 114.3055'); await p.keyboard.press('Enter'); await waitWin(p);
const rm = p.locator('.leaflet-popup-content-wrapper button:has-text("Remove pin")');
await rm.scrollIntoViewEnabled?.();
await rm.scrollIntoViewIfNeeded(); await rm.click(); await p.waitForTimeout(500);
ok((await pin(p)) === null && (await p.locator('.leaflet-popup').count()) === 0, 'Remove pin takes the pin and the window away');

// a press and hold window has Add as marker but no pin to remove
await p.mouse.move(300, 600); await p.mouse.down(); await p.waitForTimeout(1300); await p.mouse.up(); await p.waitForTimeout(500);
await p.mouse.move(300, 600); await p.mouse.down(); await p.waitForTimeout(2300); await p.mouse.up(); await waitWin(p);
w = await win(p);
ok(w.add && !w.remove, 'a window from a press and hold also has Add as marker, and no Remove pin');
await ctx.close();

// ================= phone
({ ctx, p } = await session({ viewport: { width: 360, height: 740 }, mobile: true }));
ok(/coordinates/i.test(await p.getAttribute('#q', 'placeholder')), 'phone: the placeholder mentions coordinates');
await p.tap('#search-toggle'); await type(p, '30.5928, 114.3055');
const fit = await p.evaluate(() => { const l = document.getElementById('results').getBoundingClientRect(); return { r: l.right, w: innerWidth, l: l.left }; });
ok(fit.r <= fit.w + 1 && fit.l >= 0, 'phone: the result list fits the screen');
await p.keyboard.press('Enter'); await waitWin(p);
pn = await pin(p); w = await win(p);
ok(w && w.top >= 0 && w.bottom <= pn.top + 2 && Math.abs(pn.x - pn.mx) < 16, 'phone: the pin is centred and the window above it is fully on screen');
await p.screenshot({ path: `${SP}/search-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
