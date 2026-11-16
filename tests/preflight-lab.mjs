// Motor diagnostics Phase 2 browser suite: the non-shipping lab page and its read-only readiness view, on synthetic data.
// It starts its own Vite dev servers (one with the build-time flag on, one with it off), so it does not need the app on :5173.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { CHANNEL, chromium, OUT, ROOT } from './lib.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');

function startVite(port, flag) {
  const env = { ...process.env };
  delete env.VITE_PREFLIGHT_DIAGNOSTICS;
  if (flag) env.VITE_PREFLIGHT_DIAGNOSTICS = '1';
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    const on = (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } };
    child.stdout.on('data', on); child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}

const on = await startVite(5188, true);
const off = await startVite(5189, false);
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [], hosts = new Set();
try {
  // ---- flag ON
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ } });
  await p.goto('http://127.0.0.1:5188/tools/preflight-spike/', { waitUntil: 'networkidle' });
  ok((await p.locator('[data-disabled]').count()) === 0 && (await p.locator('#btn-connect').count()) === 1, 'flag on: the lab shows its controls');
  ok((await p.locator('.pf-ready[data-state="DISCONNECTED"]').count()) === 1, 'before a connection the readiness view is DISCONNECTED');
  await p.click('#btn-mock');
  await p.waitForSelector('.pf-ready[data-state="READINESS_INCOMPLETE"]', { timeout: 10000 });
  ok(true, 'a synthetic aircraft reads and the view is INCOMPLETE (switch, battery and Blackbox mode are not confirmed yet)');
  const rows = await p.locator('.pf-gate').count();
  ok(rows === 15, `15 gate rows are shown (${rows})`);
  ok((await p.locator('.pf-gate .pf-badge').allTextContents()).every((t) => ['Passed', 'Check', 'Blocked', 'Not confirmed'].includes(t)), 'every row carries a text status, not only a colour');
  ok((await p.locator('.pf-gate .pf-icon').allTextContents()).every((t) => t.length === 1), 'every row also carries an icon glyph');
  ok((await p.locator('.pf-gate[data-gate="firmware"] .pf-hw').count()) === 1, 'the candidate firmware row is labelled hardware-unverified');
  ok(/not a statement that an aircraft is fit to fly/.test(await p.locator('.pf-note').innerText()), 'the read-only note says this is not a fitness statement');

  await p.check('[data-attest="armSwitchOff"]');
  await p.check('[data-attest="batteryDisconnected"]');
  await p.selectOption('select[data-attest="blackboxMode"]', 'MOTOR_TEST');
  await p.waitForSelector('.pf-ready[data-state="READINESS_CONDITIONAL"]');
  ok(/Conditional/.test(await p.locator('.pf-overall').innerText()), 'with the three confirmations the view is CONDITIONAL, not "ready"');
  const body = await p.evaluate(() => document.body.innerText);
  ok(!/safe to fly|airworth|certified|guarantee/i.test(body.replace(/not a statement that an aircraft is fit to fly/i, '')), 'no safe-to-fly, airworthiness, certification or guarantee wording on the page');
  ok((await p.locator('[data-gate="bb-mode"] .pf-badge').innerText()) === 'Check', 'an attested Blackbox mode is "Check", never "Passed"');
  await p.selectOption('select[data-attest="blackboxMode"]', 'NORMAL');
  await p.waitForSelector('.pf-ready[data-state="READINESS_BLOCKED"]');
  ok(true, 'the NORMAL mode blocks the view (READINESS_BLOCKED)');
  const opts = await p.locator('select[data-attest="blackboxMode"] option').allTextContents();
  ok(JSON.stringify(opts) === JSON.stringify(['not confirmed', 'NORMAL', 'MOTOR_TEST', 'ALWAYS']), 'the mode choices are exactly NORMAL, MOTOR_TEST, ALWAYS (no ALWAYS_ON)');
  await p.selectOption('select[data-attest="blackboxMode"]', 'ALWAYS');
  await p.waitForSelector('.pf-ready[data-state="READINESS_CONDITIONAL"]');

  // manual ESC family and export
  await p.selectOption('select[data-manual="escFirmwareFamily"]', 'Bluejay');
  await p.fill('input[data-manual="aircraftLabel"]', 'Test quad'); await p.locator('input[data-manual="aircraftLabel"]').blur();
  const dl = async (sel) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return fs.readFileSync(f, 'utf8'); };
  const j = JSON.parse(await dl('button[data-export="json"]'));
  ok(j.esc.firmwareFamily === 'Bluejay' && j.esc.source === 'manual entry', 'the export carries the manual ESC firmware family');
  ok(j.identity.uidHex === null && j.identity.uidOmitted === true, 'the board UID is left out of the export by default');
  ok(/identifies this flight controller/.test(await p.locator('.pf-uid').innerText()), 'the UID warning is shown beside its checkbox');
  await p.check('input[data-export="includeUid"]');
  const j2 = JSON.parse(await dl('button[data-export="json"]'));
  ok(j2.identity.uidHex === '111111112222222233333333' && /identifies/.test(j2.identity.uidWarning), 'the UID is included only after the opt-in, with its warning in the file');
  ok(!/111111112222222233333333/.test(await p.evaluate(() => document.body.innerText)), 'the UID is never printed on the page');
  const md = await dl('button[data-export="md"]');
  ok(/ESC firmware family \(manual\) \| Bluejay/.test(md) && /## Unresolved/.test(md), 'the Markdown export lists the manual ESC family and unresolved items');

  // spike panel (read-only)
  await p.click('#btn-ports');
  await p.waitForFunction(() => /getPorts/.test(document.getElementById('spike-out').textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/getPorts/.test(await p.locator('#spike-out').innerText()), 'the spike panel lists granted ports (read-only)');
  await p.click('#btn-latency');
  ok(/latency-skipped|latency/.test(await p.locator('#spike-out').innerText()), 'the latency test runs read-only against the synthetic transport');
  const lat = await p.locator('#spike-out').innerText();
  ok(/"type": "latency"/.test(lat), 'the latency test records p50/p99 over 50 synthetic reads');

  // narrow viewport: no horizontal scroll, 44 px targets
  await p.setViewportSize({ width: 360, height: 740 });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'at 360 px width there is no horizontal page scroll');
  const small = await p.evaluate(() => [...document.querySelectorAll('button, select, input[type=text]')].filter((e) => e.getBoundingClientRect().height < 44).length);
  ok(small === 0, `all buttons and fields are at least 44 px tall (${small} smaller)`);

  // network: nothing left the machine
  ok([...hosts].every((h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)), `only the local server was contacted (${[...hosts].join(', ')})`);
  ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));

  // ---- flag OFF: same page, build flag off
  const p2 = await (await b.newContext()).newPage();
  const e2 = [];
  p2.on('pageerror', (e) => e2.push(e.message));
  await p2.goto('http://127.0.0.1:5189/tools/preflight-spike/', { waitUntil: 'networkidle' });
  ok((await p2.locator('[data-disabled]').count()) === 1 && (await p2.locator('#btn-connect, #btn-mock').count()) === 0, 'flag off: the lab shows only the disabled notice and has no connect or mock control');
  ok((await p2.locator('.pf-ready').count()) === 0, 'flag off: no readiness view is drawn');
  // the shipped app (flag off) has no entry point
  const p3 = await (await b.newContext()).newPage();
  await p3.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' }); await p3.waitForTimeout(1200);
  ok(!/preflight|motor diagnostics|check aircraft/i.test(await p3.content()), 'the shipped app page has no diagnostics entry or reference');
  ok(e2.length === 0, 'flag off: no page errors');
  // and the flag is not a stored preference: setting storage or the URL does not turn it on
  const p4 = await (await b.newContext()).newPage();
  await p4.addInitScript(() => { try { localStorage.setItem('VITE_PREFLIGHT_DIAGNOSTICS', '1'); localStorage.setItem('uavzones.v1.preflight', '1'); } catch { /* ignore */ } });
  await p4.goto('http://127.0.0.1:5189/tools/preflight-spike/?preflight=1&VITE_PREFLIGHT_DIAGNOSTICS=1', { waitUntil: 'networkidle' });
  ok((await p4.locator('[data-disabled]').count()) === 1, 'flag off: storage keys and URL parameters cannot switch the feature on');
} finally {
  await b.close(); on.kill(); off.kill();
}
