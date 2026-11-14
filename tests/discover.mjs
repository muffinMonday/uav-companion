// UX discoverability, phases 2 to 4: the optional orientation inside Quick Setup (skippable at every step, no permission asked, returning users go straight to the tasks),
// the once-per-feature hints (once, dismiss, replay, one at a time, blocked storage, not while busy) and the task shortcuts and Tips list in the dashboard Help card.
// Screenshots go to tests/out/discover/.
import { chromium, CHANNEL, LATEST_SEEN, OUT } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const shots = `${OUT}/discover`; fs.mkdirSync(shots, { recursive: true });
const RETURNING = { showOnStart: false, welcomed: true, seen: LATEST_SEEN };
const HELPKEY = 'uavzones.v1.help';

/** dash: the stored dashboard state (null = a first visit). helpBlocked: the help key cannot be read or written. */
async function open({ vp = { width: 1300, height: 850 }, touch = false, dash = RETURNING, dark = false, helpBlocked = false } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', permissions: [], });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(([d, blocked, key]) => {
    window.__asked = [];
    for (const m of ['getCurrentPosition', 'watchPosition']) { const o = navigator.geolocation?.[m]; if (o) navigator.geolocation[m] = function (...a) { window.__asked.push('geo:' + m); return o.apply(this, a); }; }
    if (window.Notification) { const o = Notification.requestPermission; Notification.requestPermission = function (...a) { window.__asked.push('notification'); return o.apply(this, a); }; }
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    if (d) localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d })); else localStorage.removeItem('uavzones.v1.dash');
    localStorage.removeItem(key); // hints unseen (the shared harness marks them all seen)
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.59, lon: 114.30, zoom: 13 }, basemap: 'osm', holdHint: true }));
    if (blocked) {
      const gi = Storage.prototype.getItem, si = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === key) throw new Error('blocked'); return gi.apply(this, arguments); };
      Storage.prototype.setItem = function (k, v) { if (k === key) throw new Error('blocked'); return si.apply(this, arguments); };
    }
  }, [dash, helpBlocked, HELPKEY]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const splashOpen = (p) => p.$eval('#splash', (d) => d.open).catch(() => false);
const heading = (p) => p.$eval('#splash-title', (e) => e.textContent).catch(() => null);
const vis = (p, sel) => p.locator(sel).first().isVisible();
const hints = (p) => p.evaluate(() => [...document.querySelectorAll('.help-hint')].filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => e.dataset.hint));
const seenList = (p) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.seen ?? null; } catch { return 'bad'; } }, HELPKEY);
const tab = (p, t) => p.click('#tab-' + t);
const selected = (p) => p.evaluate(() => document.querySelector('#panel [role=tab][aria-selected=true]')?.dataset.tab);
const asked = (p) => p.evaluate(() => window.__asked.join());
let ctx, p;
if (process.env.DBG) { const t = await open({ dash: null }); console.log(await t.p.evaluate(() => [localStorage.getItem('uavzones.v1.dash'), document.getElementById('splash')?.open, document.body.dataset.dash, sessionStorage.__seeded])); console.log(errs); process.exit(0); }

// ================= phase 2: a first visit
({ ctx, p } = await open({ dash: null }));
ok(await splashOpen(p), 'a first visit shows Quick Setup');
ok(await vis(p, '#splash-trip') && await vis(p, '#splash-flight') && await vis(p, '#splash-skip'), 'Plan a trip, Plan a flight and Skip are all still there');
ok(await vis(p, '#splash-learn'), 'Learn the map is offered as an extra, optional link');
if (await vis(p, '#splash-guest')) { ok(true, 'the guest choice is still there'); }
await p.screenshot({ path: `${shots}/splash-choose.png` });
await p.click('#splash-learn');
ok(/permission/i.test(await p.$eval('.splash-orient-text', (e) => e.textContent)) && /1 of 3/.test(await p.$eval('#splash .hint', (e) => e.textContent)), 'step 1 says a zone colour is not permission to fly, and shows the step count');
ok(await vis(p, '#orient-skip') && await vis(p, '#orient-next'), 'Skip is on the first step');
await p.screenshot({ path: `${shots}/orient-1.png` });
await p.click('#orient-next');
ok(/Check a location/.test(await heading(p)) && /hold/i.test(await p.$eval('.splash-orient-text', (e) => e.textContent)), 'step 2 explains the point check and how it differs from saving');
ok(await vis(p, '#orient-skip'), 'Skip is on step 2');
await p.click('#orient-back'); ok(/Official/.test(await heading(p)), 'Back returns to step 1');
await p.click('#orient-next'); await p.click('#orient-next');
ok(/tools/i.test(await heading(p)) && await vis(p, '#orient-labels') && await vis(p, '#orient-skip'), 'step 3 introduces the tools, with a Show labels action and Skip');
await p.screenshot({ path: `${shots}/orient-3.png` });
await p.click('#orient-skip');
ok(await splashOpen(p) && /Where do you want to start/.test(await heading(p)), 'Skip returns to the task choice, Quick Setup still open');
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.dash') || 'null')?.welcomed)) !== true, 'skipping the orientation does not mark the setup as finished');
await p.click('#splash-learn'); await p.click('#orient-next'); await p.click('#orient-skip');
ok(/Where do you want/.test(await heading(p)), 'Skip at step 2 also returns to the task choice');
await p.click('#splash-learn'); await p.click('#orient-next'); await p.click('#orient-next'); await p.click('#orient-next'); // Done
ok(/Where do you want/.test(await heading(p)), 'Done returns to the task choice');
await p.click('#splash-trip'); await p.click('#splash-ai');
ok(await vis(p, '#splash-dest'), 'after the orientation the Plan a trip form still opens');
ok(await asked(p) === '', 'nothing was asked of the browser: no location, no notifications (' + (await asked(p)) + ')');
await ctx.close();

// ---- the labels action
({ ctx, p } = await open({ dash: null }));
await p.click('#splash-learn'); await p.click('#orient-next'); await p.click('#orient-next'); await p.click('#orient-labels'); await p.waitForTimeout(300);
ok(!(await splashOpen(p)) && await p.locator('#map-tool-labels').isVisible(), 'Show the labels on the map closes Quick Setup and expands the labels');
ok((await p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.dash') || 'null')?.welcomed)) === true, 'and the setup counts as done');
ok((await seenList(p) || []).includes('map-tools'), 'the map-tools hint is not shown later: the visitor found the tag button');
ok(await asked(p) === '', 'still nothing asked of the browser');
await ctx.close();

// ---- Escape on the orientation is Skip, as on every Quick Setup screen
({ ctx, p } = await open({ dash: null }));
await p.click('#splash-learn'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(!(await splashOpen(p)), 'Escape closes Quick Setup from the orientation (the existing Skip)');
await ctx.close();

// ---- a returning user reopens Quick Setup: straight to the tasks
({ ctx, p } = await open());
await p.evaluate(() => document.getElementById('setup-open').click()); await p.waitForTimeout(300);
ok(await splashOpen(p) && /Where do you want to start/.test(await heading(p)), 'a returning user who reopens Quick Setup lands on the task choice, not the orientation');
ok(await vis(p, '#splash-flight') && await vis(p, '#splash-learn'), 'the orientation stays one optional click away');
await ctx.close();

// ================= phase 3: contextual hints
({ ctx, p } = await open());
ok((await hints(p)).length === 0, 'no hint on a plain page load');
await tab(p, 'trips'); await p.waitForTimeout(150);
ok((await hints(p)).join() === 'trips' && await p.locator('#pane-trips .help-hint').count() === 1, 'opening Trips shows its hint, inside the pane');
const hb = await p.$eval('.help-hint', (e) => { const r = e.getBoundingClientRect(), s = e.closest('#panel').getBoundingClientRect(); return r.left >= s.left && r.right <= s.right; });
ok(hb, 'the hint stays inside the panel');
ok(await p.$eval('.help-hint', (e) => e.getAttribute('role') === 'status') && await p.locator('.help-hint button').count() === 1, 'it is a status message with one Got it button');
ok((await seenList(p)) === null, 'a hint that has only just appeared is not yet used up');
await p.waitForTimeout(1700);
ok(JSON.stringify(await seenList(p)) === '["trips"]', 'after it has stayed up it is marked seen, and only its id is stored');
await p.screenshot({ path: `${shots}/hint-trips-desk.png` });
await p.click('.help-hint .help-ok'); await p.waitForTimeout(100);
ok((await hints(p)).length === 0, 'Got it dismisses it');
await tab(p, 'poi'); await p.waitForTimeout(150);
ok((await hints(p)).join() === 'poi', 'another feature has its own hint');
await p.waitForTimeout(1700);
await tab(p, 'trips'); await p.waitForTimeout(150);
ok(!(await hints(p)).includes('trips'), 'the dismissed hint does not come back by itself');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
await tab(p, 'trips'); await tab(p, 'poi'); await p.waitForTimeout(150);
ok((await hints(p)).length === 0, 'after a reload the seen hints stay seen');

// ---- replay
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
const storedBefore = JSON.stringify(await seenList(p));
await p.click('#dash-tips summary');
ok(await p.locator('#dash-tips [data-replay]').count() >= 5, 'the Help card lists the hints that can be replayed');
await p.click('#dash-tips [data-replay=trips]'); await p.waitForTimeout(200);
ok((await hints(p)).join() === 'trips' && (await selected(p)) === 'trips', 'replay opens Trips and shows its hint again');
ok(JSON.stringify(await seenList(p)) === storedBefore, 'replay leaves the seen list unchanged');
await p.click('.help-hint .help-ok');
ok(JSON.stringify(await seenList(p)) === storedBefore, 'dismissing a replay changes nothing either');
await ctx.close();

// ---- one at a time, rapid switching
({ ctx, p } = await open());
await p.evaluate(() => { for (const t of ['poi', 'config', 'trips', 'poi', 'config', 'trips']) document.getElementById('tab-' + t).click(); });
await p.waitForTimeout(250);
const total = await p.locator('.help-hint').count();
ok(total === 1 && (await hints(p)).join() === 'trips', 'rapid tab switching leaves one hint, the one for the tab showing (' + total + ')');
ok((await seenList(p)) === null, 'and none of the flicked-past hints was used up');
await p.evaluate(() => document.getElementById('tab-poi').click()); await p.waitForTimeout(150);
ok(!(await hints(p)).includes('trips') && await p.locator('.help-hint[data-hint=trips]').count() === 0, 'leaving the tab removes its hint');
await ctx.close();

// ---- not while busy: placing a marker
({ ctx, p } = await open());
await p.evaluate(() => document.getElementById('map').classList.add('is-placing'));
await tab(p, 'trips'); await p.waitForTimeout(150);
ok((await hints(p)).length === 0 && !(await seenList(p) || []).includes('trips'), 'no hint while a marker is being placed, and it is not used up');
await p.evaluate(() => document.getElementById('map').classList.remove('is-placing'));
await tab(p, 'poi'); await tab(p, 'trips'); await p.waitForTimeout(150);
ok((await hints(p)).join() === 'trips', 'it shows at the next opening instead');
await ctx.close();

// ---- the map's hints
({ ctx, p } = await open());
const m = await p.$eval('#map', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y }; });
await p.mouse.click(m.x + 700, m.y + 400, { button: 'right' }); await p.waitForTimeout(1300);
ok((await hints(p)).join() === 'point-check', 'the first spot check shows the point-check hint');
ok(/not saved/.test(await p.$eval('.help-hint', (e) => e.textContent)) && /Add as marker/.test(await p.$eval('.help-hint', (e) => e.textContent)), 'it says a check is not saved and how to keep the place');
await p.screenshot({ path: `${shots}/hint-point-check.png` });
await p.focus('.help-hint .help-ok'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
ok((await hints(p)).length === 0, 'Escape on the hint dismisses it');
await p.keyboard.press('Escape');
await p.mouse.click(m.x + 500, m.y + 300, { button: 'right' }); await p.waitForTimeout(1300);
ok((await hints(p)).length === 0, 'the second check shows no hint');
await p.click('.leaflet-top.leaflet-left a[data-tool="crosshair"]'); await p.waitForTimeout(150);
ok((await hints(p)).join() === 'map-tools' && /tag button/.test(await p.$eval('.help-hint', (e) => e.textContent)), 'the first press of a map button shows the map-tools hint');
const cx = '.leaflet-top.leaflet-left a[data-tool="crosshair"]';
const pr1 = await p.getAttribute(cx, 'aria-pressed'); await p.click(cx); await p.waitForTimeout(100);
ok(pr1 === 'false' && (await p.getAttribute(cx, 'aria-pressed')) === 'true', 'and the button still did its job (' + pr1 + ' then on again)');
await p.screenshot({ path: `${shots}/hint-map-tools.png` });
await ctx.close();

// ---- blocked storage: still once per page, no errors
({ ctx, p } = await open({ helpBlocked: true }));
await tab(p, 'trips'); await p.waitForTimeout(150);
ok((await hints(p)).join() === 'trips', 'storage blocked: the hint still shows');
await p.click('.help-hint .help-ok'); await tab(p, 'poi'); await tab(p, 'trips'); await p.waitForTimeout(150);
ok(!(await hints(p)).includes('trips'), 'and is not repeated within the page (memory fallback)');
await ctx.close();

// ---- corrupt storage
{
  const c2 = await b.newContext({ viewport: { width: 1300, height: 850 } });
  await c2.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await c2.addInitScript(([key, d]) => { if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d })); localStorage.setItem(key, '{not json'); }, [HELPKEY, RETURNING]);
  const q = await c2.newPage(); q.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await q.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await q.waitForTimeout(700);
  await tab(q, 'trips'); await q.waitForTimeout(150);
  ok((await hints(q)).join() === 'trips', 'corrupt stored value: treated as nothing seen, no error');
  await c2.close();
}

// ================= phase 4: the Help card
({ ctx, p } = await open());
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
ok(await p.locator('.dash-tasks button').count() >= 4, 'the Help card has task shortcuts');
ok((await p.$$eval('.dash-tasks button', (bs) => bs.map((x) => x.textContent))).slice(0, 3).join('|') === 'Check a flying location|Save a place|Plan a trip', 'in the order check, save, plan');
await p.screenshot({ path: `${shots}/help-card-desk.png` });
await p.click('#task-save'); await p.waitForTimeout(250);
ok(await selected(p) === 'poi' && await p.locator('#panel').isVisible(), 'Save a place opens Points of Interest');
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
await p.click('#task-trip'); await p.waitForTimeout(250);
ok(await selected(p) === 'trips', 'Plan a trip opens Trips');
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
await p.click('#task-customize'); await p.waitForTimeout(250);
ok(await selected(p) === 'config', 'Customize the map opens Map Configs');
await p.evaluate(() => document.getElementById('help-open').click()); await p.waitForSelector('.dash-guide');
await p.click('#task-check'); await p.waitForTimeout(300);
ok(/hold/i.test(await p.evaluate(() => document.getElementById('toast').textContent)) && await p.evaluate(() => document.body.dataset.dash) === 'peek', 'Check a flying location folds the dashboard and says how (press and hold)');
const hasSessions = await p.locator('#task-sessions').count();
if (hasSessions) { await p.evaluate(() => document.getElementById('help-open').click()); await p.click('#task-sessions'); await p.waitForTimeout(300); ok(await p.$eval('#ses-hub', (d) => d.open), 'Find flight sessions opens the sessions hub'); }
else ok(true, 'no accounts in this build: the sessions shortcut is not offered (not tested)');
await ctx.close();

// ---- phone: the hint, the Help card and the orientation fit
({ ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true, dash: null }));
await p.click('#splash-learn'); await p.screenshot({ path: `${shots}/phone-orient-1.png` });
const fit = await p.$eval('#splash', (d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
ok(fit, 'phone: the orientation dialog fits the screen');
const btn = await p.$eval('#orient-skip', (e) => e.getBoundingClientRect().height);
ok(btn >= 30, 'phone: the Skip button is a usable size (' + Math.round(btn) + ' px)');
await p.click('#orient-skip'); await p.click('#splash-skip'); await p.waitForTimeout(400);
await ctx.close();
({ ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true }));
await p.click('#dock-expand'); await p.waitForTimeout(300); await tab(p, 'trips'); await p.waitForTimeout(300);
ok((await hints(p)).join() === 'trips', 'phone: the Trips hint shows in the bottom sheet');
const inside = await p.$eval('.help-hint', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
ok(inside, 'phone: the hint fits the screen width');
await p.screenshot({ path: `${shots}/hint-trips-phone.png` });
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
