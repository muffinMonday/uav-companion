// The local diagnostic log in a real browser: IndexedDB storage, global error handlers, rotation, debug flag, and that logging makes no network request.
import { CHANNEL, chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const URL0 = 'http://localhost:5173/';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijk';

const b = await chromium.launch({ channel: CHANNEL });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
const p = await ctx.newPage();
const pageErrors = [], requests = [];
p.on('pageerror', (e) => pageErrors.push(e.message));
await p.goto(URL0); await p.waitForLoadState('networkidle');
const pin = () => p.evaluate(() => { window.__logUrl = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/log\.js(\?|$)/.test(n)) || '/src/log.js'; return window.__logUrl; });
const exportLog = () => p.evaluate(async () => JSON.parse(await (await import(window.__logUrl)).diagnostics.exportJson()));
await pin();
await p.evaluate(async () => { const m = await import(window.__logUrl); await m.diagnostics.clear(); });

// ---- uncaught error and rejected promise
p.on('request', (r) => requests.push(r.method() + ' ' + r.url()));
const reqBefore = requests.length;
await p.evaluate((jwt) => {
  setTimeout(() => { throw new Error('boom lat=30.123456 ' + jwt); }, 0);
  Promise.reject(new TypeError('rejected thing at https://x.test/a?token=abc'));
}, JWT);
await p.waitForTimeout(400);
let ex = await exportLog();
const win = ex.entries.filter((e) => e.src === 'window');
ok(win.length === 2, 'the uncaught error and the rejected promise are both logged once: ' + win.map((e) => e.msg).join(' | '));
ok(win.some((e) => e.data.error_name === 'TypeError') && win.every((e) => e.level === 'error'), 'with their error type and level');
ok(!JSON.stringify(ex).match(/eyJ|30\.123456|token=abc/), 'secrets and coordinates in the message are scrubbed from the stored entries and the export');
ok(pageErrors.some((m) => /boom/.test(m)), 'the browser still reports the error itself (handlers do not swallow it): ' + pageErrors.length);
const idb = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('uavzones-log'); r.onsuccess = () => { const q = r.result.transaction('log').objectStore('log').getAll(); q.onsuccess = () => res(q.result.length); }; }));
ok(idb >= 2, 'the entries are in IndexedDB (' + idb + ')');
ok(!requests.slice(reqBefore).some((u) => /^POST /.test(u) || /boom|rejected|uavzones-log/.test(u)), 'logging made no network request');

// ---- the same error twice is one entry with a count
await p.evaluate(() => { for (let i = 0; i < 4; i++) setTimeout(() => { throw new Error('again and again'); }, 0); });
await p.waitForTimeout(300);
ex = await exportLog();
const rep = ex.entries.filter((e) => /again and again/.test(e.msg));
ok(rep.length === 1 && rep[0].count === 4, 'repeats are one entry with a count: ' + rep.map((e) => e.count));

// ---- a caught-and-logged error that is rethrown is not logged twice
await p.evaluate(async () => {
  const { log } = await import(window.__logUrl);
  const e = new Error('caught then rethrown'); log.error('app', 'handled', e);
  setTimeout(() => { throw e; }, 0);
});
await p.waitForTimeout(300);
ex = await exportLog();
ok(ex.entries.filter((e) => /caught then rethrown/.test(e.msg)).length === 1, 'an error logged by code and then rethrown is logged once: ' + ex.entries.filter((e) => /caught then rethrown/.test(e.msg)).map((e) => e.src + ':' + e.msg).join(' / '));

// ---- rotation by count and size
await p.evaluate(async () => {
  const { log, diagnostics } = await import(window.__logUrl);
  for (let i = 0; i < 700; i++) log.warn('bulk', 'entry number ' + i + ' ' + 'x'.repeat(150));
  await diagnostics.flush();
});
const st = await p.evaluate(async () => (await import(window.__logUrl)).diagnostics.stats());
ok(st.entries <= 500 && st.bytes <= 200 * 1024 && st.persistent === true, `rotation keeps within the limits: ${st.entries} entries, ${st.bytes} bytes`);

// ---- it survives a reload, and clearing works
await p.evaluate(async () => { const { log, diagnostics } = await import(window.__logUrl); await diagnostics.clear(); log.warn('keep', 'survives reload'); await diagnostics.flush(); });
await p.reload(); await p.waitForLoadState('networkidle'); await pin();
ex = await exportLog();
ok(ex.entries.some((e) => e.msg === 'survives reload'), 'entries persist across a reload');
await p.evaluate(async () => (await import(window.__logUrl)).diagnostics.clear());
ok((await exportLog()).entries.length === 0, 'clearing empties the log');

// ---- debug flag
const dbgKey = () => p.evaluate(() => localStorage.getItem('uavzones.v1.debug'));
await p.evaluate(async () => { const { log, diagnostics } = await import(window.__logUrl); log.debug('dbg', 'hidden at WARN'); await diagnostics.flush(); });
ok(!(await exportLog()).entries.some((e) => e.msg === 'hidden at WARN'), 'DEBUG is not recorded by default');
await p.goto(URL0 + '?debug=1'); await p.waitForLoadState('networkidle');
ok(await dbgKey() === '1', '?debug=1 stores the flag');
await p.goto(URL0); await p.waitForLoadState('networkidle'); await pin();
await p.evaluate(async () => { const { log, diagnostics } = await import(window.__logUrl); log.debug('dbg', 'visible in debug'); await diagnostics.flush(); });
ok(await dbgKey() === '1' && (await exportLog()).entries.some((e) => e.msg === 'visible in debug'), 'the flag persists and DEBUG is then recorded');
const prefs = await p.evaluate(() => localStorage.getItem('uavzones.v1.prefs') || '');
ok(!/debug/.test(prefs), 'the flag is not in the synced preferences');
await p.goto(URL0 + '?debug=0'); await p.waitForLoadState('networkidle');
ok(await dbgKey() === null, '?debug=0 removes it');

// ---- the Diagnostics card in the privacy settings: stats, download, clear
await p.goto(URL0); await p.waitForLoadState('networkidle'); await pin();
await p.evaluate(async () => { const { diagnostics } = await import(window.__logUrl); await diagnostics.clear(); });
await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])');
await p.waitForFunction(() => /Nothing has been logged/.test(document.querySelector('#diag-stats').textContent));
ok(await p.isDisabled('#diag-download') && await p.isDisabled('#diag-clear'), 'with an empty log the card says so and both buttons are disabled');
await p.click('#privacy-back'); await p.waitForSelector('#privacy', { state: 'hidden' });
await p.evaluate(async (jwt) => { const { log, diagnostics } = await import(window.__logUrl); log.warn('live', 'poll failed lat=30.123456 ' + jwt, { status: 503 }); log.error('sync', 'second problem', new TypeError('bad')); await diagnostics.flush(); }, JWT);
await p.click('#privacy-btn'); await p.waitForSelector('#privacy:not([hidden])'); // the card refreshes each time the panel opens
await p.waitForFunction(() => /2 entries/.test(document.querySelector('#diag-stats').textContent));
ok(!await p.isDisabled('#diag-download') && !await p.isDisabled('#diag-clear') && /2 entries, [\d.]+ (B|KB)/.test(await p.textContent('#diag-stats')), 'the card shows the number and size of the entries and enables the buttons');
const reqs = []; p.on('request', (r) => reqs.push(r.method() + ' ' + r.url()));
const [file] = await Promise.all([p.waitForEvent('download'), p.click('#diag-download')]);
ok(/^uav-companion-diagnostics-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), 'the download is a dated JSON file: ' + file.suggestedFilename());
const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
const doc = JSON.parse(text);
ok(doc.entries.length === 2 && doc.limits.maxEntries === 500 && !/eyJ|30\.123456/.test(text), 'the file holds the entries, the limits, and no secret or coordinate');
ok(!reqs.some((u) => /^POST /.test(u)), 'downloading made no network request');
await p.click('#diag-clear');
await p.waitForFunction(() => /Nothing has been logged/.test(document.querySelector('#diag-stats').textContent));
ok(await p.isDisabled('#diag-download') && /Diagnostics cleared/.test(await p.textContent('#toast')), 'clearing empties the log, says so, and disables the buttons');

await b.close();
