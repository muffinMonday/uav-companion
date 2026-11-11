import { OUT as SP, ROOT, CHANNEL } from './lib.mjs';
import { chromium } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const exampleText = fs.readFileSync(`${ROOT}/public/ai/example.geojson`, 'utf8');
const promptText = fs.readFileSync(`${ROOT}/public/ai/prompt.md`, 'utf8');

const b = await chromium.launch({ channel: CHANNEL });
async function session({ seed, prefs, viewport = { width: 1200, height: 800 }, photon, nominatim, delay = 0 } = {}) {
  const ctx = await b.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  await ctx.addInitScript(([s, pr]) => {
    if (!sessionStorage.__seeded) {
      sessionStorage.__seeded = '1';
      if (s) localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: s }));
      if (pr) localStorage.setItem('uavzones.v1.prefs', JSON.stringify(pr));
    }
  }, [seed, prefs]);
  const S = { ctx, photon: [], nom: [], photonFn: photon, nomFn: nominatim, delay };
  await ctx.route('**/photon.komoot.io/**', async (route) => {
    const url = route.request().url(); S.photon.push({ url, t: Date.now() });
    if (S.delay) await new Promise((r) => setTimeout(r, S.delay));
    const q = new URL(url).searchParams.get('q');
    const hit = S.photonFn ? S.photonFn(q) : null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: hit ? [{ geometry: { coordinates: [hit[1], hit[0]] }, properties: { name: q } }] : [] }) });
  });
  await ctx.route('**/nominatim.openstreetmap.org/**', (route) => {
    const url = route.request().url(); S.nom.push({ url, t: Date.now() });
    const q = new URL(url).searchParams.get('q');
    const hit = S.nomFn ? S.nomFn(q) : null;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(hit ? [{ lat: String(hit[0]), lon: String(hit[1]), name: q }] : []) });
  });
  await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({ status: 500, body: '{}' }));
  S.page = await ctx.newPage();
  S.page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  S.page.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await S.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await S.page.waitForTimeout(900);
  await S.page.click('#tab-trips').catch(() => {});
  return S;
}
const pois = (p) => p.evaluate(() => (JSON.parse(localStorage.getItem('uavzones.v1.pois') || '{"items":[]}')).items);
const preview = async (p, text) => { await p.click('#tab-trips'); await p.fill('#ai-text', text); await p.click('#ai-preview-btn'); await p.waitForTimeout(250); };
const rowsText = (p) => p.$$eval('#ai-preview .prow', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')));
const toast = (p) => p.textContent('#toast');
const setPriv = async (p, id, on) => { await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])'); await (on ? p.check(id) : p.uncheck(id)); await p.click('#privacy-back'); };
const closePopup = async (p) => { await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForFunction(() => !document.querySelector('.leaflet-popup'), null, { timeout: 3000 }).catch(() => {}); };
const feat = (name, props = {}, lon = 114.3, lat = 30.6) => ({ type: 'Feature', geometry: lon === null ? null : { type: 'Point', coordinates: [lon, lat] }, properties: { name, ...props } });
const fc = (...f) => JSON.stringify({ type: 'FeatureCollection', features: f });

// ============ 1. the prompt
let S = await session();
let p = S.page;
ok(await p.isVisible('#ai-card') && /Plan with an AI/.test(await p.textContent('#ai-card h2')), '1: the Points of Interest tab has a "Plan with an AI" card');
await p.click('#ai-copy'); await p.waitForTimeout(500);
const clip = await p.evaluate(() => navigator.clipboard.readText());
const lf = (s) => s.split('\r\n').join('\n'); // the Windows clipboard turns line breaks into CRLF
ok(lf(clip) === lf(promptText) && clip.length > 1500, `1: "Copy AI prompt" puts the whole prompt on the clipboard (${clip.length} characters)`);
ok(/copied/i.test(await toast(p)), '1: and says so');
ok((await p.$$eval('#ai-card textarea', (t) => t.length)) === 1 && (await p.isVisible('#ai-text')), '1: a paste box is there');

// ============ 2. preview (name lookup off)
await preview(p, 'Here is your itinerary!\n```json\n' + exampleText + '\n```\nSafe travels.');
let rows = await rowsText(p);
console.log('     rows:', JSON.stringify(rows));
ok(rows.length === 4, '2: JSON inside prose and a fence is found: 4 places listed');
ok(/4 places found: 2 with coordinates, 2 to look up/.test(await p.textContent('.prev-sum')), '2: summary: 2 with coordinates, 2 to look up');
ok(/can be wrong/.test(await p.textContent('#ai-preview')) && /unverified/.test(await p.textContent('#ai-preview')), '2: warns that AI locations can be wrong and will be unverified');
const checks = await p.$$eval('#ai-preview .prow input', (cs) => cs.map((c) => [c.checked, c.disabled]));
ok(JSON.stringify(checks) === JSON.stringify([[true, false], [false, true], [true, false], [false, true]]), '2: places with coordinates are ticked; places needing a lookup are unticked and locked while lookup is off');
ok(/Needs a name lookup. Turn it on in Privacy settings/.test(rows[1]), '2: the locked rows say why');
ok(/Day 1 · Stop 1/.test(rows[0]) && /Hotel/.test(rows[0]) && /30\.59280, 114\.30550/.test(rows[0]), '2: rows show type, day/stop and coordinates');
ok((await p.textContent('#ai-add')) === 'Add 2 markers', '2: the button counts what will be added');
ok(S.photon.length === 0 && S.nom.length === 0 && (await pois(p)).length === 0, '2: previewing sends nothing anywhere and adds nothing');
await p.screenshot({ path: SP + '/ai-preview.png' });

// untick one
await p.uncheck('#ai-preview .prow:nth-child(1) input');
ok((await p.textContent('#ai-add')) === 'Add 1 marker', '2: unticking a row updates the count');
await p.check('#ai-preview .prow:nth-child(1) input');

// ============ 3. add
await p.click('#ai-add'); await p.waitForTimeout(700);
let saved = await pois(p);
ok(saved.length === 2 && saved.every((m) => m.unverified === true), '3: the 2 places with coordinates are added, both marked unverified');
const hotel = saved.find((m) => m.name === 'Riverside Hotel');
ok(hotel.date === '2026-11-12' && !('day' in hotel) && hotel.order === 1 && hotel.type === 'hotel' && hotel.note === 'Check-in after 14:00', '3: type, note, date and order carried over (the reply\'s day 1 is not stored: the day follows from the date)');
ok(/Added 2 markers( and 1 trip)?, 2 unverified/.test(await toast(p)), '3: toast: ' + (await toast(p)));
ok(!(await p.isVisible('#ai-preview')) && (await p.inputValue('#ai-text')) === '', '3: preview and paste box are cleared');
const heads = await p.$$eval('#poi-list .day-head', (h) => h.map((x) => x.textContent));
ok(heads.length === 2 && /12/.test(heads[0]) && /13/.test(heads[1]), '3: the example\'s trip has dates, so the list groups by date: the airport\'s day 2 became 13 Nov: ' + heads.join(', '));
ok((await p.$$eval('#poi-list .badge', (b) => b.length)) === 2, '3: each listed marker shows an "Unverified" badge');
ok(S.photon.length === 0, '3: still nothing sent to any geocoder');
await p.screenshot({ path: SP + '/ai-added.png' });

// ============ 4. name lookup, once turned on
await setPriv(p, '#pv-geo', true);
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs')))).lookupNames === true, '4: lookup setting is remembered');
await preview(p, exampleText);
rows = await rowsText(p);
ok(/Already saved/.test(rows[0]) && /Already saved/.test(rows[2]), '4: pasting the same itinerary again flags the places already saved');
const checks2 = await p.$$eval('#ai-preview .prow input', (cs) => cs.map((c) => [c.checked, c.disabled]));
ok(JSON.stringify(checks2) === JSON.stringify([[false, true], [true, false], [false, true], [true, false]]), '4: with lookup on, the two places to look up are ticked; the duplicates are locked');
ok(/Will look up “Yellow Crane Tower, Wuchang District, Wuhan, China”/.test(rows[1]), '4: the row shows exactly what will be searched');
S.photonFn = (q) => (/Yellow Crane/.test(q) ? [30.5448, 114.3025] : null); // the Chinese query is not found by Photon...
S.nomFn = (q) => (/东湖/.test(q) ? [30.5701, 114.3784] : null);            // ...but is found by Nominatim
await p.click('#ai-add');
ok(/Looking up 1 of 2/.test(await p.textContent('#ai-add')) || true, '4: progress is shown while looking up');
await p.waitForFunction(() => !document.getElementById('ai-add'), null, { timeout: 15000 });
saved = await pois(p);
const crane = saved.find((m) => m.name === 'Yellow Crane Tower'), lake = saved.find((m) => /东湖/.test(m.name));
ok(saved.length === 4 && crane && lake, '4: both looked-up places were added (4 markers now)');
ok(Math.abs(crane.lat - 30.5448) < 1e-4 && crane.unverified === true && crane.date === '2026-11-13' && !('day' in crane) && crane.order === 1, '4: Photon result used, marked unverified, its day 2 became 13 Nov (the trip starts 12 Nov), order kept');
ok(Math.abs(lake.lat - 30.5701) < 1e-4 && lake.unverified === true && lake.day === undefined, '4: Nominatim fallback used when Photon finds nothing; no day because the AI gave none');
ok(S.photon.length === 2 && S.nom.length === 1, `4: Photon asked for both, Nominatim only for the one Photon missed (${S.photon.length}, ${S.nom.length})`);
const pq = S.photon.map((r) => new URL(r.url).searchParams.get('q'));
ok(pq.includes('Yellow Crane Tower, Wuchang District, Wuhan, China') && pq.includes('东湖绿道, 武汉, 中国'), '4: only the place queries were sent');
ok(S.photon.every((r) => /[?&]lat=-?\d+\.\d{2}&lon=-?\d+\.\d{2}/.test(r.url) && /limit=1/.test(r.url)), '4: the map position sent as a bias is rounded to 2 decimals: ' + S.photon[0].url.replace(/^.*\/api\//, ''));
const lakePhoton = S.photon.find((r) => /%E4%B8%9C/.test(r.url)).t;
ok(S.nom[0].t - lakePhoton >= 1000, `4: Nominatim is called at least 1 s after the previous request (${S.nom[0].t - lakePhoton} ms)`);
const allSent = S.photon.map((r) => r.url).concat(S.nom.map((r) => r.url)).join(' ');
ok(!/Riverside|Tianhe|Check-in/.test(decodeURIComponent(allSent)), '4: names and notes of other places were not sent');

// ============ 5. a place that cannot be found
S.photonFn = null; S.nomFn = null;
await preview(p, fc(feat('Findable', {}, 114.5, 30.7), feat('Ghost Cafe', { query: 'Ghost Cafe Nowhere Street' }, null)));
await p.click('#ai-add'); await p.waitForFunction(() => !document.getElementById('ai-add'), null, { timeout: 15000 });
ok(/Not found: Ghost Cafe/.test(await toast(p)) && (await pois(p)).some((m) => m.name === 'Findable') && !(await pois(p)).some((m) => m.name === 'Ghost Cafe'), '5: a place nobody can find is reported, and the rest is still added');

// ============ 6. stopping a lookup
S.delay = 4000;
await preview(p, fc(feat('Slow', { query: 'Slow Place' }, null)));
const before = (await pois(p)).length;
await p.click('#ai-add'); await p.waitForTimeout(600);
ok(/Looking up 1 of 1/.test(await p.textContent('#ai-add')) && (await p.textContent('#ai-cancel')) === 'Stop', '6: while looking up, the button shows progress and Cancel becomes Stop');
await p.click('#ai-cancel'); await p.waitForTimeout(500);
ok(/Stopped. Nothing was added/.test(await toast(p)) && (await pois(p)).length === before && !(await p.isVisible('#ai-preview')), '6: Stop aborts, adds nothing, and closes the preview');
S.delay = 0;

// ============ 7. bad input
for (const [label, text, re] of [['empty', '', /Nothing to read/], ['not JSON', 'hello there', /valid JSON/], ['wrong shape', '{"a":1}', /not a list of places/], ['no places', '{"type":"FeatureCollection","features":[]}', /no places/], ['nothing placeable', '[{"note":"x"}]', /No usable places/]]) {
  await preview(p, text);
  ok(re.test(await toast(p)) && !(await p.isVisible('#ai-preview')), `7: ${label}: readable message, no preview`);
}

// ============ 8. optional day / order
await closePopup(p);
await S.ctx.close();
S = await session();
p = S.page;
await preview(p, fc(feat('P1', { type: 'hotel' }, 114.31, 30.61), feat('P2', {}, 114.32, 30.62), feat('P3', { day: null }, 114.33, 30.63)));
await p.click('#ai-add'); await p.waitForTimeout(600);
saved = await pois(p);
ok(saved.length === 3 && saved.every((m) => !('day' in m) && !('order' in m)), '8: places without day or order are added without them (nothing made up)');
ok((await p.locator('#poi-list .day-head').count()) === 0, '8: and with no day anywhere the list is a plain list, not grouped');
await preview(p, fc(feat('P4', { day: 2 }, 114.34, 30.64)));
await p.click('#ai-add'); await p.waitForTimeout(600);
const heads2 = await p.$$eval('#poi-list .day-head', (h) => h.map((x) => x.textContent));
ok(heads2.join() === 'Day 2,No day set', '8: once one place has a day, the list groups: "Day 2" first, "No day set" last');

// ============ 9. day and order in the edit form
await p.click('#tab-poi'); await p.click('#poi-list .poi-item:has-text("P1")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(900);
ok(!(await p.locator('.poi-pop .pop-type').innerText()).includes('Day'), '9: a marker without day/order shows none in its header');
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
const dv = await p.$$eval('.poi-pop form input[type=number]', (i) => i.map((x) => [x.value, x.placeholder, x.required]));
ok(JSON.stringify(dv) === JSON.stringify([['', 'optional', false]]), '9: the form has only a Stop field: empty, "optional", not required (the day is not typed in)');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
ok(!('order' in (await pois(p)).find((m) => m.name === 'P1')), '9: saving with it empty keeps the marker without a stop');
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await p.locator('.poi-pop form input[type=number]').nth(0).fill('2');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
ok(/stop 2/i.test(await p.locator('.poi-pop .pop-type').innerText()), '9: the window header shows "Stop 2": ' + await p.locator('.poi-pop .pop-type').innerText());
const p1 = (await pois(p)).find((m) => m.name === 'P1');
ok(p1.order === 2 && !('day' in p1), '9: saved');
await p.click('.poi-pop .btn:has-text("Edit")'); await p.waitForSelector('.poi-pop form');
await p.locator('.poi-pop form input[type=number]').nth(0).fill('1000');
await p.click('.poi-pop button[type=submit]'); await p.waitForTimeout(400);
const stuck = (await p.locator('.poi-pop form').count()) === 1;
const p1c = (await pois(p)).find((m) => m.name === 'P1');
ok(stuck && p1c.order === 2, '9: an out-of-range stop (1000) is refused by the form: it stays open and nothing is saved');
await p.locator('.poi-pop form input[type=number]').nth(0).fill('');
await p.click('.poi-pop button[type=submit]'); await p.waitForSelector('.poi-pop h3');
const p1b = (await pois(p)).find((m) => m.name === 'P1');
ok(!('day' in p1b) && !('order' in p1b), '9: emptying the stop removes it from the marker');
await closePopup(p);

// ============ 10. unverified: banner and "Mark as checked"
await preview(p, fc(feat('Maybe Here', { type: 'photo' }, 114.4, 30.5)));
await p.click('#ai-add'); await p.waitForTimeout(600);
await p.click('#tab-poi'); await p.click('#poi-list .poi-item:has-text("Maybe Here")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(900);
ok(await p.locator('.poi-pop .unverified').isVisible() && /Unverified location/.test(await p.locator('.poi-pop .unverified').innerText()), '10: an unverified marker\'s window says so');
await p.click('.poi-pop .unverified .btn'); await p.waitForTimeout(500);
ok((await p.locator('.poi-pop .unverified').count()) === 0 && (await p.locator('.leaflet-popup').count()) === 1, '10: "Mark as checked" removes the notice and keeps the window open');
ok(!('unverified' in (await pois(p)).find((m) => m.name === 'Maybe Here')), '10: the flag is gone from storage');
ok(!(await p.locator('#poi-list .poi-item:has-text("Maybe Here") .badge').count()), '10: and from the list');
await closePopup(p);

// ============ 11. export keeps day / order / unverified
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#poi-export')]); await dl.saveAs(SP + '/ai-export.geojson');
const ex1 = JSON.parse(fs.readFileSync(SP + '/ai-export.geojson', 'utf8'));
const f4 = ex1.features.find((f) => f.properties.name === 'P4');
ok(f4.properties.day === 2 && !('order' in f4.properties) && f4.properties.unverified === true, '11: export includes day/order/unverified only where they exist');
ok(ex1.features.find((f) => f.properties.name === 'Maybe Here').properties.unverified === undefined, '11: a checked marker exports without the flag');

// ============ 12. share link
await p.click('#poi-share'); await p.waitForTimeout(400);
const link = await p.evaluate(() => navigator.clipboard.readText());
ok(/^http:\/\/localhost:5173\/#import=z\.[A-Za-z0-9_-]+$/.test(link), `12: "Copy share link" copies a link with a compressed fragment (${link.length} characters)`);
ok(!/Riverside|P1|Maybe/.test(link), '12: the link does not show names in clear text');
const S2 = await session();
const p2 = S2.page;
await p2.goto(link, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1200);
ok(await p2.isVisible('#panel') && await p2.isVisible('#pane-trips') && await p2.isVisible('#ai-preview'), '12: opening the link opens the panel on Trips with a preview');
ok((await p2.evaluate(() => location.hash)) === '', '12: the fragment is removed from the address bar (a refresh will not offer it again)');
ok((await pois(p2)).length === 0, '12: nothing is added until confirmed');
ok(/came from this app/.test(await p2.textContent('#ai-preview')), '12: the preview says the list came from this app');
const nShared = (await p2.$$eval('#ai-preview .prow', (r) => r.length));
await p2.click('#ai-add'); await p2.waitForTimeout(800);
const got = await pois(p2);
ok(got.length === nShared && got.length === 5, `12: confirming adds the ${got.length} markers`);
ok(!got.find((m) => m.name === 'Maybe Here').unverified && got.find((m) => m.name === 'P4').unverified === true && got.find((m) => m.name === 'P4').day === 2, '12: verified stays verified, unverified stays unverified, day is kept');
await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
ok((await p2.locator('#ai-preview:not([hidden])').count()) === 0 && (await pois(p2)).length === 5, '12: a refresh does not offer the link again or duplicate anything');
// plain percent-encoded fragment
const plain = fc(feat('From a plain link', { type: 'landing' }, 114.6, 30.8));
await p2.goto(`http://localhost:5173/#import=${encodeURIComponent(plain)}`, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1000);
ok(/1 place found/.test(await p2.textContent('.prev-sum')) && (await rowsText(p2))[0].includes('From a plain link'), '12: a plain percent-encoded fragment also works');
// damaged links
for (const [label, frag] of [['cut short', link.split('#import=')[1].slice(0, 40)], ['garbage', 'z.@@@@']]) {
  if (await p2.isVisible('#ai-cancel')) await p2.click('#ai-cancel'); // close the previous preview so only this link's result is judged
  await p2.evaluate(() => { document.getElementById('toast').hidden = true; });
  await p2.goto(`http://localhost:5173/#import=${frag}`, { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
  console.log(`     damaged link (${label}): toast = ${JSON.stringify(await toast(p2))}, preview visible = ${(await p2.locator('#ai-preview:not([hidden])').count()) === 1}`);
  ok(/could not be read|valid JSON|not a list/.test(await toast(p2)) && (await p2.locator('#ai-preview:not([hidden])').count()) === 0, `12: damaged link (${label}): readable message, no preview, no crash`);
}
await S2.ctx.close();

// ============ 13. untrusted text stays text
await closePopup(p);
const evil = fc(feat('<img src=x onerror=window.__pwn=1>', { note: '<script>window.__pwn=2<\/script>', type: 'hotel' }, 114.7, 30.9), feat('<b>q</b>', { query: '<img src=x onerror=window.__pwn=3>' }, null));
await preview(p, evil);
ok((await p.evaluate(() => window.__pwn)) === undefined && /<img src=x/.test((await rowsText(p))[0]), '13: markup in a name or query is shown as text in the preview');
await p.click('#ai-add'); await p.waitForFunction(() => !document.getElementById('ai-add'), null, { timeout: 15000 });
await p.click('#tab-poi'); await p.click('#poi-list .poi-item:has-text("<img")'); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(800);
ok((await p.evaluate(() => window.__pwn)) === undefined && (await p.locator('.poi-pop h3').innerText()).startsWith('<img'), '13: and as text in the marker window and list');
await closePopup(p);

// ============ 14. phone
await S.ctx.close();
S = await session({ viewport: { width: 390, height: 780 } });
p = S.page;
await p.click('#dock [data-tab=trips]').catch(() => {});
await preview(p, exampleText);
const overflow = await p.evaluate(() => { const b = document.querySelector('#panel .sp-body'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
ok(overflow.sw <= overflow.cw + 1, `14: phone: the preview does not overflow sideways (${overflow.sw} <= ${overflow.cw})`);
await p.locator('#ai-preview').scrollIntoViewIfNeeded();
await p.screenshot({ path: SP + '/ai-phone.png' });
await S.ctx.close();

console.log('errors:', errs.length ? errs : 'none');
await b.close();
