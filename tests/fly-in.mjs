// Fly in (dashboard): a fresh visit opens on Singapore and downloads only its archive; choosing a China region downloads that
// region's archive and the ones its view touches; a search that pans into another region downloads that one; after a reload,
// a region already in the Cache API is read from there. Counts archives and bytes per step. Needs the app on :5173.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const info = (m) => console.log('INFO  ' + m);
const errs = [];
const CHINA = ['cn-chongqing', 'cn-guangdong', 'cn-hubei', 'cn-hunan', 'cn-jilin', 'cn-ningxia', 'cn-sichuan'];
const RETURNING = { showOnStart: true, welcomed: true, seen: LATEST_SEEN };
/** Chooses a region the way a person does: a China button opens its menu, then the region; Singapore has no menu. */
async function choose(p, id) {
  const country = id.startsWith('sg-') ? 'sg' : 'cn';
  await p.click(`.dash-fly .country-btn[data-country="${country}"]`);
  if (country === 'cn') await p.click(`.dash-fly .country-menu [data-region="${id}"]`);
}
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';

const b = await chromium.launch({ channel: CHANNEL });
/** A context whose dashboard starts open (a returning visitor) and with no saved map view (a first map load). */
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 } });
  await ctx.addInitScript((d) => { if (sessionStorage.__fly) return; sessionStorage.__fly = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d })); }, RETURNING);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  // Every archive the page downloads over the network (a Cache API read or a memory read makes no response).
  const log = [];
  p.on('response', async (r) => {
    if (!r.url().includes('.pmtiles')) return;
    const id = r.url().split('/').pop().split('.')[0];
    const body = await r.body().catch(() => null);
    log.push({ id, status: r.status(), bytes: body ? body.length : 0 });
  });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  return { ctx, p, log };
}
const ids = (log) => [...new Set(log.map((e) => e.id))].sort();
const bytes = (log) => log.reduce((s, e) => s + e.bytes, 0);

// ================= 1. a fresh visit opens on Singapore and downloads only its archive
let { ctx, p, log } = await open();
const sgOnly = JSON.stringify(ids(log)) === JSON.stringify(['sg-nofly']);
ok(sgOnly, 'fresh visit: archives downloaded = ' + JSON.stringify(ids(log)) + ' (' + log.length + ' response(s), ' + mb(bytes(log)) + ')');
info(`fresh Singapore view: ${ids(log).length} archive(s) downloaded, ${mb(bytes(log))} transferred`);
const flyBtns = await p.$$eval('.dash-fly .country-btn', (bs) => bs.map((b) => b.textContent));
ok(JSON.stringify(flyBtns) === JSON.stringify(['China', 'Singapore']), 'Fly in shows one button per country: ' + flyBtns.join(', '));
ok(await p.locator('.dash-fly .country-menu').isHidden(), 'the China menu is closed until its button is pressed');

// ================= 2. choosing a China region focuses it and downloads its archive (and only the ones its view touches)
const before2 = log.length;
await choose(p, 'cn-hubei'); await p.waitForTimeout(3000);
ok(await p.locator('.dash-fly .country-menu').isHidden(), 'choosing Hubei closes the China menu');
const hubeiStep = log.slice(before2);
const hubeiIds = ids(hubeiStep);
ok(hubeiIds.includes('cn-hubei'), 'choosing Hubei downloads the Hubei archive');
const chinaLoaded = hubeiIds.filter((i) => CHINA.includes(i));
ok(chinaLoaded.length < CHINA.length && !hubeiIds.includes('sg-nofly'), 'choosing Hubei does not download every China archive: ' + JSON.stringify(hubeiIds));
const view2 = await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view);
ok(view2 && Math.abs(view2.lat - 30.6) < 2 && Math.abs(view2.lon - 112.5) < 3, 'the map is focused on Hubei: ' + JSON.stringify(view2));
info(`switch to Hubei: ${hubeiIds.length} archive(s) downloaded (${hubeiIds.join(', ')}), ${mb(bytes(hubeiStep))} transferred`);

// ================= 3. panning into another region downloads that archive only when the view reaches it
const before3 = log.length;
await p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); });
await p.waitForTimeout(200); await p.fill('#q', '23.1300, 113.2600'); await p.waitForTimeout(250); await p.keyboard.press('Enter');
await p.waitForTimeout(3000);
const panIds = ids(log.slice(before3));
ok(JSON.stringify(panIds) === JSON.stringify(['cn-guangdong']), 'panning into Guangzhou downloads only the Guangdong archive: ' + JSON.stringify(panIds));
info(`pan into Guangdong: ${panIds.join(', ') || 'none'} downloaded, ${mb(bytes(log.slice(before3)))}`);

// ================= 4. a revisit reuses the persistent copy: after a reload, Hubei comes from the Cache API
await p.waitForTimeout(1500); // the background save of Hubei (and the last-use record) finishes
const cached = await p.evaluate(async () => (await caches.open('uavzones-pmtiles-v1')).keys().then((ks) => ks.map((k) => k.url.split('/').pop().split('.')[0])));
ok(cached.includes('cn-hubei') && cached.includes('sg-nofly'), 'the Cache API holds the archives already downloaded: ' + JSON.stringify(cached.sort()));
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
const before4 = log.length;
await choose(p, 'cn-hubei'); await p.waitForTimeout(3000);
const again = ids(log.slice(before4));
ok(!again.includes('cn-hubei'), 'after a reload, choosing Hubei again does not download its archive: network = ' + JSON.stringify(again));
ok((await p.locator('.leaflet-container').count()) === 1 && (await p.locator('.leaflet-overlay-pane').count()) === 1, 'the map is on the page and its layers are there while archives load');

await ctx.close();
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
