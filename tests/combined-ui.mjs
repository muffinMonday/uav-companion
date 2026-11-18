// Browser suite: the combined motor confirmation card and the Aircraft electronics section, on the SYNTHETIC flight controller only
// (the engineering lab page and the user workspace, both against the simulated aircraft). Starts its own Vite dev server with the
// bench flag on. No real device, serial port or motor.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, ROOT } from './lib.mjs';

const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) process.exitCode = 1; };
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');
function startVite(port, env2) {
  const env = { ...process.env, ...env2 };
  for (const k of ['VITE_BENCH_PHASE3', 'VITE_PREFLIGHT_DIAGNOSTICS']) if (!(k in env2)) delete env[k];
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 60000);
    child.stdout.on('data', (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}

const vite = await startVite(5192, { VITE_BENCH_PHASE3: '1' });
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [];
const LAB = 'http://127.0.0.1:5192/tools/motor-bench-lab/';
const USER = 'http://127.0.0.1:5192/motor-diagnostics/';
const text = (p, sel) => p.locator(sel).innerText();
const waitState = (p, s, timeout = 25000) => p.waitForSelector(`#bt-state[data-state="${s}"]`, { timeout, state: 'attached' });
async function hold(p, sel, ms = 1200) {
  await p.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
}
async function toMotorReady(p) {
  await p.goto(LAB, { waitUntil: 'networkidle' });
  await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
  for (const k of ['armSwitchOff', 'throttleMin', 'batteryDisconnected']) await p.check(`[data-attest="${k}"]`);
  await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled); await p.click('#btn-proceed'); await waitState(p, 'SAFETY_CHECKLIST');
  for (const cb of await p.locator('[data-item]').all()) await cb.check();
  await p.waitForFunction(() => !document.querySelector('#hold-final').disabled); await hold(p, '#hold-final'); await waitState(p, 'READY_TO_CONNECT_POWER');
  await p.click('#btn-battery-connected'); await waitState(p, 'MOTOR_READY', 30000);
}
const POS = ['rear-right', 'front-right', 'rear-left', 'front-left'];
async function sweep(p, m) {
  await p.click(`#btn-motor-${m + 1}`); await p.click('#btn-confirm-target');
  await p.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 20000 });
  await hold(p, '#hold-start'); await waitState(p, 'VERIFYING_STOP', 30000);
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 }); await p.click('#btn-no-rotation');
  await p.click(`#btn-pos-${POS[m]}`); await waitState(p, 'MOTOR_READY');
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await toMotorReady(p);

  // ---- locked state, layout, order
  ok((await p.locator('#bt-combined-card').count()) === 1 && /Combined motor confirmation/.test(await text(p, '#bt-combined-card h3')), 'the fifth test card is named "Combined motor confirmation"');
  ok((await p.locator('#bt-combined-card').getAttribute('data-combined')) === 'locked' && /Available after all four individual motor checks complete without anomalies\./.test(await text(p, '#bt-combined-locked')), 'before eligibility the card says when it becomes available');
  ok(await p.locator('#hold-combined').isDisabled() && await p.locator('#hold-combined-timed').isDisabled(), 'the combined hold and its timed alternative are disabled while locked');
  const layout = () => p.evaluate(() => {
    const grid = document.querySelector('#bt-sec-ready .dg-picker'), card = document.getElementById('bt-combined-card');
    const g = grid.getBoundingClientRect(), c = card.getBoundingClientRect();
    return { cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length, directlyBelow: grid.nextElementSibling === card, below: c.top >= g.bottom - 1, gridW: g.width, cardW: c.width, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  for (const [w, h] of [[1200, 900], [420, 800], [360, 740]]) {
    await p.setViewportSize({ width: w, height: h });
    const l = await layout();
    ok(l.cols === 2 && l.directlyBelow && l.below && l.cardW >= l.gridW - 2 && l.overflow <= 1, `at ${w} px the 2x2 grid is kept and the combined card is a separate full-width card directly below it`);
  }
  await p.setViewportSize({ width: 1200, height: 900 });

  // ---- four individual sweeps, then the card becomes eligible
  for (let m = 0; m < 4; m++) { await sweep(p, m); if (m < 3) await p.waitForTimeout(5200); }
  await p.waitForTimeout(5300);
  await p.waitForFunction(() => document.getElementById('bt-combined-card') && document.getElementById('bt-combined-card').dataset.combined === 'eligible', null, { timeout: 15000 });
  ok(/All four motors will spin together/.test(await text(p, '#bt-combined-card')) && /external 1100/.test(await text(p, '#bt-combined-card')), 'the eligible card warns that all four motors will spin and names the cap');
  ok(/Hold to run all four motors/.test(await text(p, '#hold-combined')), 'the action reads "Hold to run all four motors"');
  ok(!(await p.locator('#hold-combined').isDisabled()), 'the hold control is enabled when every interlock holds');
  await p.setViewportSize({ width: 360, height: 740 });
  ok(await noOverflow(p) && await p.evaluate(() => ['#hold-combined', '#hold-combined-timed'].every((s) => document.querySelector(s).getBoundingClientRect().height >= 40)), 'the eligible card has no horizontal scroll and touch-sized controls at 360 px');
  await p.setViewportSize({ width: 1200, height: 900 });

  // a short press does nothing; a keyboard hold starts it
  await hold(p, '#hold-combined', 300);
  ok(await p.locator('#bt-state').getAttribute('data-state') === 'MOTOR_READY', 'a brief press does not start the combined run');
  await p.locator('#hold-combined').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await p.focus('#hold-combined'); await p.keyboard.down('Space'); await p.waitForTimeout(1300); await p.keyboard.up('Space');
  await waitState(p, 'RUNNING');
  ok(/All four motors running/.test(await text(p, '#bt-sec-run h2')) && (await p.locator('.dg-motor').filter({ hasText: 'Running' }).count()) === 4, 'the keyboard hold starts it; the running view shows all four motors');
  ok(await p.locator('#btn-stop-zero').isVisible(), 'Stop & zero stays visible during the combined run');
  await p.setViewportSize({ width: 360, height: 740 });
  ok(await noOverflow(p) && await p.locator('#btn-stop-zero').isVisible(), 'the running view has no horizontal scroll at 360 px');
  await p.setViewportSize({ width: 1200, height: 900 });
  await p.waitForFunction(() => Number(document.getElementById('rd-output').textContent) >= 1020);
  const outs = await p.evaluate(() => Number(document.getElementById('rd-output').textContent));
  ok(outs <= 1100, 'the commanded output never exceeds external 1100');
  await waitState(p, 'VERIFYING_STOP', 30000);
  ok(/Confirming all four motors stopped/.test(await text(p, '#bt-sec-verify h2')) && (await p.locator('[id^="btn-pos-"]').count()) === 0, 'the stop proof is required and no position question is asked');
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 }); await p.click('#btn-no-rotation');
  await p.waitForSelector('#btn-finish-combined'); await p.click('#btn-finish-combined'); await waitState(p, 'MOTOR_READY');
  ok((await p.locator('#bt-combined-card').getAttribute('data-combined')) === 'done', 'after the stop proof the card shows the result state');
  ok((await p.locator('#bt-sec-combined-result').count()) === 1 && /Median RPM|median RPM/.test(await text(p, '#bt-sec-combined-result')) && /Not reported by this ESC/.test(await text(p, '#bt-sec-combined-result')) && !/0 °C/.test(await text(p, '#bt-sec-combined-result')), 'the combined result shows median RPM per motor and "Not reported by this ESC" instead of 0 °C');
  ok(/not a battery assessment/.test(await text(p, '#bt-sec-combined-result')), 'voltage change is described as a bench-load observation, not battery health');

  // ---- Aircraft electronics section in the live result
  const el = '#bt-sec-electronics';
  ok(/Aircraft electronics/.test(await text(p, `${el} .dg-block-title`)) && /Betaflight\s+2025\.12\.5|2025\.12\.5/.test(await text(p, el)), 'the result has an Aircraft electronics section with the Betaflight version');
  const t = await text(p, el);
  ok(/Board \/ target/.test(t) && /Motor protocol/.test(t) && /DSHOT600/.test(t) && /Configured receiver protocol/.test(t), 'board, motor protocol and configured receiver protocol are on the default view');
  await p.locator(`${el} details[data-part="fc-details"] summary`).click();
  const tt = await text(p, el);
  ok(/Configured receiver protocol: CRSF/.test(tt) && /Compiled receiver support not reported by this firmware\./.test(tt) && /Receiver hardware: Not independently identified/.test(tt), 'configured protocol, compiled support and receiver hardware are three separate lines');
  ok(/MSP API version/.test(tt) && /Git revision/.test(tt) && /Bidirectional DShot/.test(tt) && /Motor count \/ poles/.test(tt), 'the expandable details hold API, build, git, DShot, motor count and poles');
  ok(!/ELRS|ExpressLRS|Crossfire|Tracer/i.test(tt), 'no receiver brand is inferred from CRSF');
  ok(/ESC/.test(await text(p, `${el} [data-part="escs"]`)), 'the ESC part of the section is present');
  const uid = '11111111';
  ok(!(await p.content()).includes(uid), 'the raw flight-controller UID is not in the page');

  // ---- save, read back from storage, download evidence
  await p.click('#btn-save-result'); await p.waitForFunction(() => /Saved/.test(document.getElementById('bt-save-status').textContent));
  const stored = await p.evaluate(() => localStorage.getItem('uavzones.aircraftdiag.v1'));
  ok(/aircraftElectronics/.test(stored) && /combinedConfirmation/.test(stored) && !stored.includes(uid), 'the saved record carries the electronics profile and the combined result, no UID');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-download-evidence')]);
  const body = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const ev = JSON.parse(body);
  const parts = { fc: !!(ev.aircraftElectronics && ev.aircraftElectronics.flightController.receiver.configuredProtocol === 'CRSF'), esc: !!(ev.aircraftElectronics && ev.aircraftElectronics.escs), combined: !!(ev.combinedConfirmation && ev.combinedConfirmation.status), noUid: !body.includes(uid), noKeys: !/"(serial|uid|serialNumber|uidHex)"s*:/i.test(body) };
  ok(Object.values(parts).every(Boolean), 'the JSON export has the FC profile, the ESC block and the combined result, and no UID or serial ' + JSON.stringify(parts));

  // ---- the workspace history: new record, old record, and all card states rendered from the real components
  const u = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  u.on('pageerror', (e) => errs.push('pageerror ' + e.message)); u.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await u.goto(USER, { waitUntil: 'networkidle' });
  await u.evaluate(async (stored2) => { localStorage.setItem('uavzones.aircraftdiag.v1', stored2); }, stored);
  await u.reload({ waitUntil: 'networkidle' });
  await u.waitForSelector('#bt-sec-history');
  await u.locator('#bt-sec-history details.dg-hist-item summary').first().click();
  await u.waitForSelector('#bt-sec-history .dg-electronics');
  ok(/2025\.12\.5/.test(await text(u, '#bt-sec-history .dg-electronics')) && (await u.locator('#bt-sec-history .dg-combined-result').count()) === 1, 'the saved-history view shows Aircraft electronics and the combined result');
  // an older record (no profile, no combined result)
  await u.evaluate(async () => {
    const d = await import('/src/aircraft-diag-data.js'), h = await import('/src/benchtest/history.js');
    const rec = h.buildHistoryRecord({ result: { category: 'test-incomplete', headline: 'Old', summary: 's', reasons: [], notes: [], motors: [0, 1, 2, 3].map((m) => ({ motor: m, position: 'p', status: 'not-run', hard: [], gaps: [], differences: [], metrics: null })), comparison: { classified: false, differences: [] }, range: { startCommand: 1020, capCommand: 1100, step: 5, stopCommand: 1000, note: '' } }, identity: { variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'OLD', boardId: 'OLD1', motorProtocol: 'DSHOT600' }, now: Date.now() - 86400000, id: 'rold1' });
    delete rec.aircraftElectronics; delete rec.combinedConfirmation;
    d.saveRecord(rec);
  });
  await u.reload({ waitUntil: 'networkidle' });
  await u.waitForSelector('#bt-sec-history');
  await u.locator('#bt-sec-history details.dg-hist-item[data-record-id="rold1"] summary').click();
  await u.waitForSelector('#bt-sec-history details[data-record-id="rold1"] .dg-electronics');
  const oldText = await text(u, '#bt-sec-history details[data-record-id="rold1"]');
  ok(/FC profile not recorded/.test(oldText) && /ESC identification not recorded/.test(oldText), 'an older record shows "FC profile not recorded" and "ESC identification not recorded"');
  ok((await u.locator('#bt-sec-history details[data-record-id="rold1"] .dg-combined-result').count()) === 0, 'an older record has no combined block');
  // every state of the combined result block, rendered by the real component
  const states = await u.evaluate(async () => {
    const m = await import('/src/benchtest/combined-ui.js'), c = await import('/src/benchtest/combined.js');
    const base = { schemaVersion: 1, targetCommand: 1060, capCommand: 1100, motors: [0, 1, 2, 3].map((i) => ({ motor: i, medianRpm: 2400, maxDshotInvalidPct: 0, maxTempC: i === 1 ? 61 : null })), rpmPeerDifferencePct: 0, dshotInvalidPctMax: 0, usableSamples: 40, missingSamples: 0, voltage: { before_V: 14.8, min_V: 14.3, drop_V: 0.5 }, stopProofComplete: true, note: 'n', reasons: [] };
    const mk = (x) => m.combinedResultBlock(c.sanitizeCombined({ ...base, ...x }), { live: false });
    const out = {};
    out.completed = mk({ status: 'completed', headline: 'Combined confirmation completed — no difference observed', summary: 'ok' }).textContent;
    out.anomaly = mk({ status: 'inspection-recommended', headline: 'Inspection recommended', summary: c.COMBINED_ANOMALY_TEXT, reasons: ['RPM differed'] }).textContent;
    out.incomplete = mk({ status: 'incomplete', headline: 'Combined confirmation incomplete', summary: 'x' }).textContent;
    out.skipped = m.combinedResultBlock('skipped', { live: false }).textContent;
    return out;
  });
  ok(/no difference observed/.test(states.completed) && /61 °C/.test(states.completed) && /Not reported by this ESC/.test(states.completed), 'completed state renders (a reported temperature is shown, a missing one is not 0)');
  ok(/All motors passed individually, but their behaviour differed when operated together\./.test(states.anomaly) && /Inspection recommended/.test(states.anomaly), 'anomaly state renders with the agreed wording');
  ok(/incomplete/i.test(states.incomplete) && /Skipped/.test(states.skipped), 'incomplete and skipped states render');
  ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await b.close(); vite.kill();
}
