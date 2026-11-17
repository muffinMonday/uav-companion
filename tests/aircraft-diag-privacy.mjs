// Aircraft diagnostic data in the Privacy panel (real browser, app on :5173): the card appears only while data is stored,
// shows its approximate size, and its delete button removes both keys and leaves the generic Diagnostics card alone.
import { CHANNEL, chromium } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const URL0 = 'http://localhost:5173/';
const rec = { id: 'r1', schemaVersion: 1, analysisSchemaVersion: 1, savedAt: '2026-11-17T03:00:00.000Z', date: '2026-11-17', result: { category: 'test-incomplete', headline: 'Test incomplete', summary: 's', reasons: [], notes: [] }, motors: [] };
const SEED = { records: JSON.stringify({ v: 1, records: [rec] }), samples: JSON.stringify({ v: 1, sets: { r1: { format: 'x' } } }) };

const b = await chromium.launch({ channel: CHANNEL });
const errs = [];
async function open(seed) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } });
  if (seed) await ctx.addInitScript((s) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.aircraftdiag.v1', s.records); localStorage.setItem('uavzones.aircraftdiag.samples.v1', s.samples); } }, SEED);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.click('#privacy-btn');
  return { ctx, p };
}
{
  const { ctx, p } = await open(false);
  ok((await p.locator('#aircraft-diag-card').count()) === 1 && await p.locator('#aircraft-diag-card').isHidden(), 'with nothing stored the Aircraft diagnostic data card is hidden');
  ok((await p.locator('#diag-card').count()) === 1, 'the generic Diagnostics card is separate and still present');
  await ctx.close();
}
{
  const { ctx, p } = await open(true);
  ok(await p.locator('#aircraft-diag-card').isVisible(), 'with a saved result the card is shown');
  const t = await p.locator('#aircraft-diag-stats').innerText();
  ok(/1 saved result, about [\d.]+ (B|KB)/.test(t) && /of live samples/.test(t), 'it shows the approximate size and whether live samples are kept: ' + t);
  ok(/never sent anywhere/.test(await p.locator('#aircraft-diag-card .hint').first().innerText()), 'it says the data stays on this device');
  await p.click('#aircraft-diag-delete');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => localStorage.getItem('uavzones.aircraftdiag.v1') === null && localStorage.getItem('uavzones.aircraftdiag.samples.v1') === null), 'Delete removes the records and the kept live samples');
  ok(await p.locator('#aircraft-diag-card').isHidden(), 'the card hides once nothing is stored');
  await ctx.close();
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
