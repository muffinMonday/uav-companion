// Runs the test suites and prints one line each. Exit code 1 if anything failed.
//   node tests/run.mjs            everything (browser suites need the app on http://localhost:5173, see docs)
//   node tests/run.mjs --unit     only the suites that need no browser
//   node tests/run.mjs trips ai   only suites whose file name contains one of these words
//   node tests/run.mjs --jobs 4   run up to 4 suites at once (default 4; --jobs 1 for one at a time, --jobs auto picks from the CPU count). Results print as each suite finishes.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const UNIT = ['html-components-unit', 'region-loader-unit', 'contrast-unit', 'aiprompt-unit', 'ai-unit', 'trip-unit', 'trips-unit', 'rain-unit', 'places-unit', 'reorder-unit', 'maplinks-unit', 'coordparse-unit', 'onemap-unit', 'plan-unit', 'dashstate-unit', 'checkin-unit', 'share-unit', 'db-unit', 'sync-unit', 'sync-engine-unit', 'heading-unit', 'theme-unit', 'sync-settings-unit', 'db-friends-unit', 'db-trips-unit', 'db-presence-unit', 'db-live-unit', 'db-profile-unit', 'db-account-unit', 'db-progression-unit', 'db-progression-read-unit', 'db-sessions-unit', 'db-sessions-v2-unit', 'db-sessions-v2-series-unit', 'db-sessions-v2-moderation-unit', 'db-steam-unit', 'edgelog-unit', 'db-audit-unit', 'logscrub-unit', 'logstore-unit', 'steam-unit', 'steamui-unit', 'sessions-unit', 'sessions-recurrence-unit', 'progression-unit', 'delete-account-unit', 'live-engine-unit', 'autoshare-unit', 'backoff-unit', 'sharedtrip-unit', 'sharedstore-unit', 'sharedtrip-engine-unit', 'side-unit', 'help-unit', 'poi-types-unit', 'poi-model-unit'];
const BROWSER = ['html-dom', 'toolbar', 'discover', 'diag', 'autoshare', 'progression', 'sessions', 'sessions-explorer', 'responsive', 'steam', 'splash', 'stops', 'days', 'search', 'maplinks', 'reorder', 'visits', 'window', 'dashboard', 'hold', 'rain', 'ui', 'bulk', 'poi1', 'poi2', 'edit', 'prefs', 'opacity', 'mw', 'priv', 'theme', 'ai', 'trip', 'trips', 'sg', 'tools', 'mapsel', 'tripplan', 'tripstouch', 'shell', 'checkin', 'motion', 'dayroute', 'snow', 'cloud', 'storage', 'dashtall', 'paneltall', 'friends', 'party', 'live', 'swipe', 'layers', 'maprotate', 'locatemode', 'side', 'sidelist', 'sidedrag', 'popswipe', 'cardsel', 'tabpill', 'launchloc', 'smoke', 'picker', 'hierarchy'];
const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const ji = args.indexOf('--jobs');
const jobsArg = ji >= 0 ? args[ji + 1] : '4';
const JOBS = Math.max(1, jobsArg === 'auto' ? Math.min(6, Math.floor(os.cpus().length / 2)) : parseInt(jobsArg, 10) || 1);
const words = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));

let names = onlyUnit ? UNIT : [...UNIT, ...BROWSER];
if (words.length) names = names.filter((n) => words.some((w) => n.includes(w)));

const up = async () => { try { return (await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; } };
const needsApp = names.some((n) => BROWSER.includes(n));
if (needsApp && !(await up())) {
  console.error('The browser suites need the app running on http://localhost:5173.\nIn another terminal: npm run dev   (or: npm run build && npx vite preview --port 5173 --strictPort)\nOr run only the unit suites: npm run test:unit');
  process.exit(2);
}

let failed = 0;
const SERIAL = new Set([]); // suites that cannot run beside others, with the reason beside each (none so far)

function runSuite(n) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--max-old-space-size=4096', path.join(import.meta.dirname, `${n}.mjs`)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 900000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ n, out, status: timedOut ? 1 : status, t0 }); });
  });
}

function report({ n, out, status, t0 }) {
  const pass = (out.match(/^PASS/gm) || []).length, fail = (out.match(/^FAIL/gm) || []).length;
  const consoleErrors = /^errors: (?!none)/m.test(out);
  const crashed = status !== 0;
  const bad = fail > 0 || crashed || consoleErrors;
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${n.padEnd(10)} ${String(pass).padStart(3)} pass, ${fail} fail${consoleErrors ? ', console errors' : ''}${crashed ? ', crashed' : ''}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (bad) console.log(out.split('\n').filter((l) => /^FAIL|^errors|Error/.test(l)).slice(0, 8).map((l) => `      ${l.slice(0, 200)}`).join('\n'));
}

// A pool: the slowest suites start first, so the last ones to finish are short; serial suites run alone at the end.
const WEIGHT = { trip: 131, mw: 63, ai: 63, priv: 56, hold: 44, ui: 43 };
const queue = names.filter((n) => !SERIAL.has(n)).sort((a, b) => (WEIGHT[b] || 0) - (WEIGHT[a] || 0));
const t00 = Date.now();
if (JOBS > 1) console.log(`running up to ${JOBS} suites at once`);
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) report(await runSuite(queue.shift())); }));
for (const n of names.filter((x) => SERIAL.has(x))) report(await runSuite(n));
console.log(`\n${failed ? failed + ' suite(s) failed' : 'all suites passed'}  (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
process.exit(failed ? 1 : 0);
