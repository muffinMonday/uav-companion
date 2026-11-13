// Colour theme in the browser: System follows the device live, Light / Dark override it, the choice survives a reload and is set before first paint.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme);
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}'));
async function open(ctx) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  return p;
}

// ---- first visit on a light device: System, light
let ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'light' });
let p = await open(ctx);
ok((await theme(p)) === 'light' && (await p.isChecked('#theme-radios input[value=system]')), 'first visit: System is selected and resolves to light');
ok((await stored(p)).theme === undefined, 'first visit stores nothing');
const lightBg = await bg(p);
// ---- System follows the device while the page is open
await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(300);
ok((await theme(p)) === 'dark' && (await bg(p)) !== lightBg, 'System follows the device to dark without a reload');
await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
ok((await theme(p)) === 'light', 'and back to light');
// ---- Dark override ignores the device
await p.check('#theme-radios input[value=dark]'); await p.waitForTimeout(200);
ok((await theme(p)) === 'dark' && (await stored(p)).theme === 'dark' && (await stored(p)).themeAt > 0, 'Dark: applied, saved with a time');
ok((await p.evaluate(() => document.documentElement.style.colorScheme)) === 'dark' && (await p.evaluate(() => document.querySelector('meta[name=theme-color]').content)) === '#18222c', 'Dark sets color-scheme and the browser-bar colour');
await p.emulateMedia({ colorScheme: 'dark' }); await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
ok((await theme(p)) === 'dark', 'Dark stays dark when the device changes');
// ---- reload keeps it; set before first paint
await p.reload({ waitUntil: 'domcontentloaded' });
ok((await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'after a reload: dark already set at DOMContentLoaded');
await p.waitForTimeout(1000);
ok(await p.isChecked('#theme-radios input[value=dark]'), 'the Dark radio is selected after a reload');
// ---- Light override on a dark device
await ctx.close();
ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'dark' });
p = await open(ctx);
ok((await theme(p)) === 'dark', 'dark device, System: dark');
await p.check('#theme-radios input[value=light]'); await p.waitForTimeout(200);
ok((await theme(p)) === 'light' && (await bg(p)) === lightBg, 'Light on a dark device: light');
await p.check('#theme-radios input[value=system]'); await p.waitForTimeout(200);
ok((await theme(p)) === 'dark' && (await stored(p)).theme === 'system', 'System again: back to the device (dark), saved as a choice');
// ---- a change in another tab is followed
const p2 = await ctx.newPage(); await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(500);
await p2.check('#theme-radios input[value=light]'); await p.waitForTimeout(500);
ok((await theme(p)) === 'light', 'a choice made in another tab is followed');
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
