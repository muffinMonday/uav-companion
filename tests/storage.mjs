// Storage housekeeping: cache entries of markers that are gone are dropped at start-up, and the dashboard shows how much browser storage is used.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const mk = (id, name, lat) => ({ id, type: 'photo', name, note: '', lat, lon: 114.3, created: '2026-11-01T00:00:00.000Z' });
const items = [mk('live1', 'Tower', 30.5), mk('live2', 'Lake', 30.6)];
const wx = { v: 1, lastBulk: null, items: Object.fromEntries(['live1', 'gone1', 'gone2'].map((id) => [id, { t: Date.now(), temp: 20, wind: 3, gust: 5, n: 'Clear', start: '10:00' }])) };
const el = { v: 1, items: Object.fromEntries(['live2', 'gone1'].map((id) => [id, { m: 120, lat: 30.5, lon: 114.3 }])) };

const b = await chromium.launch({ channel: CHANNEL });
async function open({ pad = 0 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(([po, w, e, pd]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po }));
    localStorage.setItem('uavzones.v1.wxcache', JSON.stringify(w));
    localStorage.setItem('uavzones.v1.elevcache', JSON.stringify(e));
    if (pd) localStorage.setItem('uavzones.v1.pad', 'x'.repeat(pd));
  }, [items, wx, el, pad]);
  const p = await ctx.newPage();
  p.on('pageerror', (e2) => errs.push('pageerror ' + e2.message));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  return { ctx, p };
}
const keys = (p, k) => p.evaluate((x) => Object.keys(JSON.parse(localStorage.getItem(x)).items).sort().join(), k);
const openDash = async (p) => { if (await p.locator('#dash').isHidden()) await p.locator('#dash-tab:visible, #dash-peek:visible').first().click(); await p.waitForSelector('#dash:not([hidden])'); };

let { ctx, p } = await open();
ok(await keys(p, 'uavzones.v1.wxcache') === 'live1', 'weather entries of markers that no longer exist are dropped at start-up: ' + await keys(p, 'uavzones.v1.wxcache'));
ok(await keys(p, 'uavzones.v1.elevcache') === 'live2', 'and so are elevation entries; those of live markers stay');
await openDash(p);
const line = p.locator('#dash .storage-use');
ok(await line.count() === 1 && /^Using \d+ KB of about 5 MB/.test(await line.textContent()), 'the Your data card shows the storage use: ' + await line.textContent());
ok(!/nearly full/.test(await line.textContent()) && !(await line.getAttribute('role')), 'with plenty of room there is no warning');
await ctx.close();

({ ctx, p } = await open({ pad: 4_300_000 }));
await openDash(p);
const warn = p.locator('#dash .storage-use.warn');
ok(await warn.count() === 1 && /nearly full/.test(await warn.textContent()) && await warn.getAttribute('role') === 'alert', 'past 80% it warns and says what to do: ' + (await warn.textContent()).slice(0, 90));
ok(/4\.\d MB/.test(await warn.textContent()), 'and shows the size in MB');
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
