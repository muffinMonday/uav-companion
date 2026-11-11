// The dashboard's expand toggle on a phone: normal height <-> 90% of the screen, with expand, collapse and close always reachable.
import { chromium, CHANNEL, LATEST_SEEN } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });
async function open(vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((seen) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: true, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
  }, LATEST_SEEN);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  return { ctx, p };
}
const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
/** Is the element the topmost thing at its own centre (nothing sits over it)? */
const reachable = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && el.contains(t); }, sel);
const openDash = async (p) => { if (await p.locator('#dash').isHidden()) await p.locator('#dash-peek:visible, #dash-tab:visible').first().tap(); await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(250); };
const H = (p) => p.evaluate(() => document.documentElement.clientHeight);

// ---------- not on a computer
let { ctx, p } = await open({ width: 1300, height: 850 }, false);
await openDash(p).catch(() => {});
ok(!(await p.isVisible('#dash-expand')), 'on a computer there is no expand button (the dashboard already has room)');
await ctx.close();

// ---------- phone
({ ctx, p } = await open({ width: 390, height: 780 }, true));
await openDash(p);
const vh = await H(p);
const normal = await box(p, '#dash');
const bx = { e: await box(p, '#dash-expand'), c: await box(p, '#dash-collapse'), x: await box(p, '#dash-close') };
ok(await p.isVisible('#dash-expand') && bx.e.r <= bx.c.x + 1 && bx.c.r <= bx.x.x + 1 && Math.abs(bx.e.y - bx.x.y) < 2, 'the expand button sits in the header beside collapse and close, on the same row');
ok(bx.x.r <= normal.r && bx.x.r > normal.r - 24, 'with close in the top right corner');
ok(normal.h <= vh * 0.55 && (await p.getAttribute('#dash-expand', 'aria-pressed')) === 'false' && (await p.getAttribute('#dash-expand', 'aria-label')) === 'Expand the dashboard', 'usual height is no more than about half the screen (' + Math.round(normal.h) + ' of ' + vh + ' px)');
for (const s of ['#dash-expand', '#dash-collapse', '#dash-close']) ok(await reachable(p, s), s + ' is not covered (usual height)');

await p.tap('#dash-expand'); await p.waitForTimeout(350);
const tall = await box(p, '#dash');
ok(Math.abs(tall.h - (vh * 0.9 - 40)) < 8 && Math.abs(tall.y - vh * 0.1) < 8, 'expanded, it fills up to 90% of the screen: top at ' + Math.round(tall.y) + ' of ' + vh + ' px, ' + Math.round(tall.h) + ' px high');
ok((await p.getAttribute('#dash-expand', 'aria-pressed')) === 'true' && /Shrink/.test(await p.getAttribute('#dash-expand', 'aria-label')), 'the button now says it shrinks it back');
for (const s of ['#dash-expand', '#dash-collapse', '#dash-close']) ok(await reachable(p, s), s + ' is not covered (expanded)');

// something that sits above other things on the map (the banner) must not cover the header
await p.evaluate(() => { const bn = document.getElementById('banner'); bn.hidden = false; document.getElementById('banner-text').textContent = 'A banner that should stay behind the dashboard header'; });
await p.waitForTimeout(150);
for (const s of ['#dash-expand', '#dash-collapse', '#dash-close']) ok(await reachable(p, s), s + ' is not covered, even with a banner showing');
await p.evaluate(() => { document.getElementById('banner').hidden = true; });

// the header stays put while the cards scroll
const head0 = await box(p, '.dash-head');
await p.evaluate(() => { const bd = document.getElementById('dash-body'); bd.style.paddingBottom = '1200px'; bd.scrollTop = bd.scrollHeight; });
await p.waitForTimeout(150);
const head1 = await box(p, '.dash-head');
ok(Math.abs(head0.y - head1.y) < 1 && await reachable(p, '#dash-close'), 'when the cards scroll the header stays at the top of the dashboard with its buttons');
await p.evaluate(() => { document.getElementById('dash-body').style.paddingBottom = ''; });

await p.tap('#dash-expand'); await p.waitForTimeout(350);
ok(Math.abs((await box(p, '#dash')).h - normal.h) < 6, 'pressing it again shrinks the dashboard back to its usual height');

// collapse and close both reset it
await p.tap('#dash-expand'); await p.waitForTimeout(300);
await p.tap('#dash-collapse'); await p.waitForSelector('#dash-peek:not([hidden])');
await openDash(p);
ok(Math.abs((await box(p, '#dash')).h - normal.h) < 6, 'collapsing to the strip and opening again gives the usual height');
await p.tap('#dash-expand'); await p.waitForTimeout(300);
await p.tap('#dash-close'); await p.waitForSelector('#dash-tab:not([hidden])');
await openDash(p);
ok(Math.abs((await box(p, '#dash')).h - normal.h) < 6 && (await p.getAttribute('#dash-expand', 'aria-pressed')) === 'false', 'closing it and opening again gives the usual height too');
await ctx.close();

// ---------- a short phone: the top edge stays on the screen
({ ctx, p } = await open({ width: 360, height: 520 }, true));
await openDash(p);
await p.tap('#dash-expand'); await p.waitForTimeout(350);
const small = await box(p, '#dash'), vh2 = await H(p);
ok(small.y >= 0 && small.b <= vh2 && await reachable(p, '#dash-close') && await reachable(p, '#dash-expand'), 'on a short screen it still fits and the buttons are reachable (top ' + Math.round(small.y) + ', bottom ' + Math.round(small.b) + ' of ' + vh2 + ' px)');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
