// The mascot is decoration: it loads, has no alt text and no focus stop, never grows the greeting or covers a control, and the empty-state pictures go away when data arrives.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
const RETURNING = { v: 1, showOnStart: true, welcomed: true, seen: LATEST_SEEN };
async function open({ vp, touch = false, dash = RETURNING, theme = 'light', data = false, zoom = 1 } = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(([d, th, withData]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    if (d) localStorage.setItem('uavzones.v1.dash', JSON.stringify(d)); else localStorage.removeItem('uavzones.v1.dash');
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', theme: th }));
    if (withData) {
      localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: [{ id: 'p1', type: 'hotel', name: 'Saved hotel', lat: 30.6, lon: 114.3, created: '2026-11-01T00:00:00.000Z' }] }));
      localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: [{ id: 't1', name: 'Spring', startDate: '2027-04-01', endDate: '2027-04-03', description: '', color: '#e91e63', created: '2026-11-01T00:00:00.000Z' }] }));
    }
  }, [dash, theme, data]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation/.test(m.text()) && errs.push(m.text()));
  const bad = []; p.on('response', (r) => { if (/mascot|icons\/|manifest/.test(r.url()) && r.status() >= 400) bad.push(r.url()); }); p.__bad = bad;
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  if (zoom !== 1) await p.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
  return { ctx, p };
}
const info = (p, sel) => p.$$eval(sel, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, loaded: e.naturalWidth > 0, alt: e.getAttribute('alt'), hidden: e.getAttribute('aria-hidden'), tab: e.tabIndex, shown: r.width > 0 && getComputedStyle(e).display !== 'none' }; }));
const noOverflow = (p, sel) => p.$eval(sel, (e) => e.scrollWidth <= e.clientWidth + 1);
const reachable = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && el.contains(t); }, sel);
const openDash = async (p) => { if (await p.locator('#dash').isHidden()) await p.locator('#dash-peek:visible, #dash-tab:visible').first().tap(); await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(300); };
const tab = (p, name) => p.evaluate((n) => { const d = document.querySelector(`#dock button[data-tab=${n}]`); if (!document.getElementById('panel').hidden) document.getElementById(`tab-${n}`).click(); else d.click(); }, name);
const decor = (i, what) => ok(i.length === 1 && i[0].loaded && i[0].alt === '' && i[0].hidden === 'true' && i[0].tab === -1, what + ': one picture, loaded, alt empty, aria-hidden, no focus stop');

// ---- the quick setup, first visit
for (const [name, vp, touch] of [['desktop', { width: 1300, height: 850 }, false], ['phone 360x640', { width: 360, height: 640 }, true], ['narrow 320x568', { width: 320, height: 568 }, true]]) for (const theme of ['light', 'dark']) {
  const { ctx, p } = await open({ vp, touch, dash: null, theme });
  await p.waitForSelector('#splash[open]');
  const i = await info(p, '#splash .mascot'); decor(i, `splash, ${name}, ${theme}`);
  ok(i[0].w === (vp.width <= 520 ? 96 : 120) || vp.height <= 520, `splash picture is ${Math.round(i[0].w)} px`);
  const h2 = await p.$eval('#splash-title', (e) => e.getBoundingClientRect().height);
  ok(h2 < 110, 'the heading did not get squeezed into a tall column (' + Math.round(h2) + ' px)');
  ok(await noOverflow(p, '#splash'), 'splash has no sideways scroll');
  for (const s of ['#splash-trip', '#splash-flight', '#splash-skip']) { await p.locator(s).scrollIntoViewIfNeeded(); ok(await reachable(p, s), s + ' is reachable'); }
  ok(p.__bad.length === 0, 'no image request failed ' + p.__bad.join(','));
  await ctx.close();
}
{ const { ctx, p } = await open({ vp: { width: 180, height: 320 }, touch: true, dash: null }); // 200% zoom of a 360 x 640 phone
  await p.waitForSelector('#splash[open]');
  ok(await noOverflow(p, '#splash'), 'splash at 200% zoom has no sideways scroll'); await p.locator('#splash-skip').scrollIntoViewIfNeeded(); ok(await reachable(p, '#splash-skip'), 'Skip is reachable at 200% zoom'); await ctx.close(); }

// ---- the dashboard greeting and Help
for (const [name, vp, touch, size] of [['desktop', { width: 1300, height: 850 }, false, 112], ['phone 390', { width: 390, height: 844 }, true, 92], ['phone 412', { width: 412, height: 915 }, true, 92], ['tablet 768', { width: 768, height: 1024 }, true, 112]]) for (const theme of ['light', 'dark']) {
  const { ctx, p } = await open({ vp, touch, theme });
  await openDash(p);
  const i = await info(p, '#dash .dash-welcome .mascot'); decor(i, `greeting, ${name}, ${theme}`);
  ok(Math.round(i[0].w) === size, `greeting picture is ${size} px (${Math.round(i[0].w)})`);
  const wh = await p.$eval('.dash-welcome', (e) => e.getBoundingClientRect().height);
  ok(wh <= 112, `the greeting row stays compact (${Math.round(wh)} px)`);
  const geo = await p.evaluate(() => { const m = document.querySelector('#dash .dash-welcome .mascot').getBoundingClientRect(); const h = document.querySelector('#dash .dash-hello').getBoundingClientRect(); const s = document.querySelector('#dash .dash-hello-sub').getBoundingClientRect(); return { left: m.right <= h.left + 1, gap: Math.abs((m.top + m.bottom) / 2 - (h.top + s.bottom) / 2) }; });
  ok(geo.left && geo.gap <= 12, `the greeting picture is left of the text and centred on it (centre offset ${Math.round(geo.gap)} px)`);
  ok((await p.$eval('.dash-hello', (e) => parseFloat(getComputedStyle(e).fontSize))) >= 22, 'the greeting text keeps its size');
  ok(await noOverflow(p, '#dash-body'), 'dashboard body has no sideways scroll');
  for (const s of ['#dash-close', '#dash-collapse']) if (await p.locator(s).count()) ok(await reachable(p, s), s + ' is not covered');
  await p.locator('#dash-help').click();
  await p.waitForSelector('#dash-help-title');
  const hp = await info(p, '#dash .dash-help-head .mascot'); decor(hp, `Help header, ${name}, ${theme}`);
  ok(Math.round(hp[0].w) === (vp.width <= 520 ? 84 : 96), 'Help picture is ' + Math.round(hp[0].w) + ' px'); ok(await reachable(p, '#dash-back'), 'Back stays reachable');
  ok((await info(p, '#dash .mascot')).length === 1, 'one mascot on the Help screen');
  await ctx.close();
}
{ const { ctx, p } = await open({ vp: { width: 320, height: 568 }, touch: true }); await openDash(p);
  ok((await info(p, '#dash .dash-welcome .mascot'))[0].shown === false, 'at 320 px the greeting picture steps aside'); await ctx.close(); }
{ const { ctx, p } = await open({ vp: { width: 390, height: 844 }, touch: true, data: true }); await openDash(p);
  ok((await info(p, '#dash .mascot')).length === 1, "only the greeting shows a mascot on the dashboard (no What's New or card art)"); await ctx.close(); }

// ---- empty states appear with no data and are gone with data
for (const [name, vp, touch] of [['desktop', { width: 1300, height: 850 }, false], ['phone 390', { width: 390, height: 844 }, true]]) for (const theme of ['light', 'dark']) {
  let { ctx, p } = await open({ vp, touch, theme });
  await tab(p, 'trips'); await p.waitForTimeout(400);
  let e = await info(p, '#trips-empty .mascot'); decor(e, `empty Trips, ${name}, ${theme}`);
  ok((await p.locator('#trips-empty').isVisible()) && /No trips yet/.test(await p.textContent('#trips-empty')), 'the empty Trips sentence is intact');
  ok(await reachable(p, '#trip-new'), 'New trip stays reachable');
  await tab(p, 'poi'); await p.waitForTimeout(400);
  e = await info(p, '#poi-empty .mascot'); decor(e, `empty Saved Places, ${name}, ${theme}`);
  ok((await p.locator('#poi-empty').isVisible()) && /No markers yet/.test(await p.textContent('#poi-empty')), 'the empty Saved Places sentence is intact');
  ok(e[0].h >= 110 && e[0].h <= 135, 'the empty-state picture is 110 to 135 px (' + Math.round(e[0].h) + ')');
  await ctx.close();
  ({ ctx, p } = await open({ vp, touch, theme, data: true }));
  await tab(p, 'trips'); await p.waitForTimeout(400);
  ok(!(await p.locator('#trips-empty .mascot').isVisible()), `with a trip, the Trips picture is gone (${name}, ${theme})`);
  await tab(p, 'poi'); await p.waitForTimeout(400);
  ok(!(await p.locator('#poi-empty .mascot').isVisible()), `with a marker, the Saved Places picture is gone (${name}, ${theme})`);
  await ctx.close();
}
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
