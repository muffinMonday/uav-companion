// The highlight behind the selected side-panel tab is one element that glides to the chosen tab (it is seen between the two tabs mid-way),
// lands exactly on it, and does not move when motion is reduced.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const b = await chromium.launch({ channel: CHANNEL });

async function open(reducedMotion) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, reducedMotion });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForSelector('#panel:not([hidden]) .tab-pill');
  return { ctx, p };
}
// the pill's box and the selected tab's box
const boxes = (p) => p.evaluate(() => {
  const pill = document.querySelector('.tabs .tab-pill').getBoundingClientRect();
  const t = document.querySelector('.tabs button[aria-selected=true]').getBoundingClientRect();
  return { pl: pill.left, pw: pill.width, tl: t.left, tw: t.width };
});
const near = (a, b2) => Math.abs(a - b2) < 1.5;

let { ctx, p } = await open('no-preference');
await p.waitForTimeout(500);
let s = await boxes(p);
ok(s.pw > 0 && near(s.pl, s.tl) && near(s.pw, s.tw), 'the pill sits on the selected tab at start');
ok(await p.locator('.tabs .tab-pill').count() === 1, 'there is a single pill');

// sample the pill's left edge every frame while switching from the first tab to the last one
await p.evaluate(() => {
  window.__lefts = [];
  const pill = document.querySelector('.tabs .tab-pill');
  const tick = () => { window.__lefts.push(pill.getBoundingClientRect().left); window.__raf = requestAnimationFrame(tick); };
  tick();
});
await p.locator('.tabs button[role=tab]').last().click();
await p.waitForTimeout(700);
const lefts = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__lefts; });
const first = lefts[0], last = lefts[lefts.length - 1];
const mid = lefts.filter((x) => x > first + 4 && x < last - 4);
ok(last > first + 20, 'the pill moved to the right tab');
ok(mid.length >= 3, `the pill was seen between the two tabs (${mid.length} frames), not jumping`);
s = await boxes(p);
ok(near(s.pl, s.tl) && near(s.pw, s.tw), 'and it lands exactly on the selected tab');

// and back, by keyboard
await p.locator('.tabs button[aria-selected=true]').focus();
await p.keyboard.press('Home').catch(() => {});
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
s = await boxes(p);
ok(near(s.pl, s.tl) && near(s.pw, s.tw), 'the pill follows a keyboard change of tab');

// closing and reopening the panel puts it back on the selected tab
await p.click('#panel-close'); await p.waitForSelector('#panel', { state: 'hidden' });
await p.click('#dock-expand'); await p.waitForSelector('#panel:not([hidden])'); await p.waitForTimeout(300);
s = await boxes(p);
ok(s.pw > 0 && near(s.pl, s.tl) && near(s.pw, s.tw), 'the pill is on the selected tab after the panel is closed and opened');
await ctx.close();

// reduced motion: no frames in between
({ ctx, p } = await open('reduce'));
await p.evaluate(() => {
  window.__lefts = [];
  const pill = document.querySelector('.tabs .tab-pill');
  const tick = () => { window.__lefts.push(pill.getBoundingClientRect().left); window.__raf = requestAnimationFrame(tick); };
  tick();
});
await p.locator('.tabs button[role=tab]').last().click();
await p.waitForTimeout(400);
const l2 = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__lefts; });
const f2 = l2[0], e2 = l2[l2.length - 1];
ok(l2.filter((x) => x > f2 + 4 && x < e2 - 4).length === 0 && e2 > f2 + 20, 'with reduced motion the pill changes place at once');
s = await boxes(p);
ok(near(s.pl, s.tl) && near(s.pw, s.tw), 'and still lands on the selected tab');
await ctx.close();

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
