import { OUT as SP, CHANNEL } from './lib.mjs';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: CHANNEL, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 800 },
  geolocation: { latitude: 30.5928, longitude: 114.3055 }, // Wuhan
  permissions: ['geolocation'],
});
const page = await ctx.newPage();
const errors = [], reqs = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', (r) => { if (r.url().includes('.pmtiles')) reqs.push(r.headers()['range'] || 'full'); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
console.log('regions note:', await page.textContent('#regions-note'));
console.log('pmtiles requests so far:', reqs.length, reqs.slice(0, 3));
await page.screenshot({ path: `${SP}/1-initial.png` });

// scale bar present
console.log('scale bar:', await page.locator('.leaflet-control-scale-line').first().textContent());

// zoom to Wuhan and click map for point check
await page.fill('#q', '武汉');
await page.waitForSelector('#results li[role=option]');
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SP}/2-wuhan.png` });
await page.mouse.move(600, 450); await page.mouse.down(); await page.waitForTimeout(2300); await page.mouse.up(); // a point check needs a press and hold (2 s)
await page.waitForSelector('.leaflet-popup .check', { timeout: 8000 });
console.log('click check:', (await page.locator('.leaflet-popup .check').first().innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${SP}/3-click.png` });

// outside Hubei (Beijing) and outside all regions
await page.evaluate(() => document.querySelector('#map')); // noop
await page.keyboard.press('Escape');

// location button
await page.click('.locate-btn');
await page.waitForSelector('.you-dot', { timeout: 8000 });
await page.waitForSelector('.leaflet-popup .check');
console.log('location popup:', (await page.locator('.leaflet-popup .check').first().innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${SP}/4-location.png` });

// pan away then re-centre
await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(100, 100, { steps: 5 }); await page.mouse.up();
const c1 = await page.evaluate(() => document.querySelector('.you-dot').getBoundingClientRect().x);
await page.click('.locate-btn');
await page.waitForTimeout(800);
const c2 = await page.evaluate(() => document.querySelector('.you-dot').getBoundingClientRect().x);
console.log('pin x before/after re-centre:', Math.round(c1), Math.round(c2), '(map width 1200, centre ~600)');

// opacity + toggle
await page.fill('#op', '0.9');
await page.uncheck('#show');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SP}/5-hidden.png` });
await page.check('#show');

// mobile layout
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SP}/6-mobile.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
