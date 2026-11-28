// Country buttons (src/app/country-menu.js): Singapore focuses at once; China opens a menu of its regions. Checks keyboard
// use (Enter, Arrow keys, Escape, focus return), a press outside, one menu open at a time, and that the buttons fit a narrow
// screen in both the dashboard's Fly in card and Map Config's Go to card. Needs the app on :5173.
import { chromium, CHANNEL, LATEST_SEEN, CHINA_REGION_LABELS as CHINA_REGIONS } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const RETURNING = { showOnStart: true, welcomed: true, seen: LATEST_SEEN };

const b = await chromium.launch({ channel: CHANNEL });
async function open(width, height, mobile = false) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((d) => { if (sessionStorage.__cb) return; sessionStorage.__cb = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d })); }, RETURNING);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  return { ctx, p };
}
const focusedAttr = (p, name) => p.evaluate((n) => document.activeElement?.getAttribute(n), name);
const focusedText = (p) => p.evaluate(() => document.activeElement?.textContent);
const view = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view);
const DASH_CHINA = '.dash-fly .country-btn[data-country="cn"]';
const DASH_SG = '.dash-fly .country-btn[data-country="sg"]';
const DASH_MENU = '.dash-fly .country-menu';

// ---- desktop: the dashboard's Fly in card
{
  const { ctx, p } = await open(1300, 850);
  const btns = await p.$$eval('.dash-fly .country-btn', (bs) => bs.map((x) => x.textContent));
  ok(JSON.stringify(btns) === JSON.stringify(['China', 'Malaysia', 'Singapore', 'Vietnam']), 'Fly in: one button per country, in order: ' + btns.join(', '));
  ok(await p.getAttribute(DASH_CHINA, 'aria-expanded') === 'false' && await p.getAttribute(DASH_SG, 'aria-expanded') === null, 'China shows aria-expanded=false; Singapore is a plain button');
  ok(await p.locator(DASH_SG).evaluate((x) => !x.hasAttribute('aria-controls')), 'Singapore has no menu to control');

  // Singapore: no menu, the map focuses on Singapore
  await p.click(DASH_SG); await p.waitForTimeout(1300);
  const sg = await view(p);
  ok(await p.locator(DASH_MENU).isHidden() && Math.abs(sg.lat - 1.35) < 0.5, 'Singapore focuses the map at once and opens no menu');

  // China by keyboard: Enter opens its menu and moves focus into it; Arrow keys move; Escape closes and returns focus
  await p.focus(DASH_CHINA);
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const menuItems = await p.$$eval(`${DASH_MENU} .btn`, (xs) => xs.map((x) => x.textContent));
  ok(JSON.stringify(menuItems) === JSON.stringify(CHINA_REGIONS), 'Enter on China opens its menu of its ' + CHINA_REGIONS.length + ' regions: ' + menuItems.join(', '));
  ok(await p.getAttribute(DASH_CHINA, 'aria-expanded') === 'true' && await p.isVisible(DASH_MENU), 'the menu is open and China says so');
  ok(await focusedText(p) === CHINA_REGIONS[0], 'focus moves into the menu (first region)');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  ok(await focusedText(p) === CHINA_REGIONS[2], 'ArrowDown moves to the next region (the third after two presses)');
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
  ok(await focusedText(p) === CHINA_REGIONS.at(-1), 'ArrowUp from the third region three times wraps past the first region to the last');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await p.locator(DASH_MENU).isHidden() && await focusedAttr(p, 'data-country') === 'cn', 'Escape closes the menu and returns focus to China');

  // Choosing a region by keyboard focuses the map on it, closes the menu, and returns focus to China
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.focus(`${DASH_MENU} [data-region="cn-hubei"]`);
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const hub = await view(p);
  ok(await p.locator(DASH_MENU).isHidden() && Math.abs(hub.lat - 30.6) < 2 && Math.abs(hub.lon - 112.5) < 3, 'Enter on Hubei focuses the map on Hubei and closes the menu');
  ok(await focusedAttr(p, 'data-country') === 'cn', 'focus returns to the China button after a region is chosen');

  // One menu at a time; a press outside the picker closes it
  await p.click(DASH_CHINA); await p.waitForTimeout(150);
  await p.click(DASH_SG); await p.waitForTimeout(300);
  ok(await p.locator(DASH_MENU).isHidden(), 'pressing Singapore while China is open closes the China menu');
  await p.click(DASH_CHINA); await p.waitForTimeout(150);
  ok(await p.isVisible(DASH_MENU), 'China reopens');
  await p.click('.dash-fly h3'); await p.waitForTimeout(150);
  ok(await p.locator(DASH_MENU).isHidden() && await p.getAttribute(DASH_CHINA, 'aria-expanded') === 'false', 'a press outside the buttons closes the China menu');
  await p.click(DASH_CHINA); await p.waitForTimeout(150);
  await p.click(DASH_CHINA); await p.waitForTimeout(150);
  ok(await p.locator(DASH_MENU).isHidden(), 'pressing the open China button again closes its menu');
  await ctx.close();
}

// ---- narrow screen (a phone): the Fly in card and Map Config's Go to card fit, and the China menu stays inside the screen
for (const width of [320, 360]) {
  const { ctx, p } = await open(width, 740, true);
  if (await p.locator('#dash').isHidden()) await p.locator('#dash-peek:visible, #dash-tab:visible').first().tap();
  await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(250);
  const overflowsPage = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflowsPage, `${width} px: the page has no horizontal overflow`);
  await p.locator(DASH_CHINA).scrollIntoViewIfNeeded(); await p.click(DASH_CHINA); await p.waitForTimeout(200);
  const inside = await p.evaluate(() => [...document.querySelectorAll('.dash-fly .country-picker button')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5; }));
  ok(inside, `${width} px: every Fly in button and menu item is inside the screen`);
  await p.click(DASH_CHINA); await p.waitForTimeout(150);
  // On a phone the side panel is hidden until opened: Help's "Open Map Configs" opens it on the Map Config tab
  await p.click('#dash-help'); await p.waitForTimeout(300);
  await p.locator('#dash-body details', { has: p.locator('button', { hasText: 'Open Map Configs' }) }).locator('summary').click(); await p.waitForTimeout(200);
  await p.locator('#dash-body .btn', { hasText: 'Open Map Configs' }).click(); await p.waitForTimeout(600);
  ok(await p.isVisible('#pane-config .country-btn[data-country="cn"]'), `${width} px: Map Config's Go to card is shown`);
  await p.click('#pane-config .country-btn[data-country="cn"]'); await p.waitForTimeout(200);
  const cfgInside = await p.evaluate(() => [...document.querySelectorAll('#pane-config .country-picker button')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5; }));
  ok(cfgInside, `${width} px: Map Config's Go to buttons and China menu are inside the screen`);
  await ctx.close();
}

console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
