// Runs the test suites and prints one line each. Exit code 1 if anything failed.
//   node tests/run.mjs            everything (browser suites need the app on http://localhost:5173, see docs)
//   node tests/run.mjs --unit     only the suites that need no browser
//   node tests/run.mjs trips ai   only suites whose file name contains one of these words
//   node tests/run.mjs --tier fast|release   (fast also takes --files a.js,b.js instead of git) fast: change-impact (changed files from git; --since <ref> adds commits since ref; --dry prints the plan), release: all unit + representative browser (tests/tiers.mjs)
//   node tests/run.mjs --jobs 4   run up to 4 suites at once (default 4; --jobs 1 for one at a time, --jobs auto picks from the CPU count). Results print as each suite finishes.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RELEASE_BROWSER, CANARY_BROWSER, OWNERS } from './tiers.mjs';

const UNIT = ['areas-unit', 'areas-geo-unit', 'areas-store-unit', 'areas-editor-unit', 'areas-api-unit', 'db-areas-unit', 'db-areas-moderation-unit', 'db-areas-public-unit', 'db-areas-revisions-unit', 'db-areas-explore-unit', 'areas-explorer-unit', 'db-areas-recovery-unit', 'areas-recover-unit', 'db-areas-attributes-unit', 'areas-attributes-unit', 'db-areas-photos-unit', 'areas-photo-unit', 'areas-photo-fn-unit', 'areas-public-unit', 'areas-admin-unit', 'route-core-unit', 'spider-unit', 'route-overlap-unit', 'route-geometry-unit', 'route-router-unit', 'route-leg-unit', 'db-routes-unit', 'html-components-unit', 'region-loader-unit', 'region-labels-unit', 'yunnan-unit', 'my-enr51-unit', 'my-atz-unit', 'vn-enr51-unit', 'vn-ad-unit', 'country-groups-unit','prod-data-unit', 'contrast-unit', 'aiprompt-unit', 'ai-unit', 'trip-unit', 'trips-unit', 'rain-unit', 'places-unit', 'reorder-unit', 'maplinks-unit', 'coordparse-unit', 'onemap-unit', 'plan-unit', 'dashstate-unit', 'checkin-unit', 'share-unit', 'db-unit', 'sync-unit', 'sync-engine-unit', 'heading-unit', 'theme-unit', 'sync-settings-unit', 'db-friends-unit', 'db-trips-unit', 'db-presence-unit', 'db-live-unit', 'db-profile-unit', 'db-account-unit', 'db-progression-unit', 'db-progression-read-unit', 'db-sessions-unit', 'db-sessions-v2-unit', 'db-sessions-v2-series-unit', 'db-sessions-v2-moderation-unit', 'db-sessions-people-unit', 'db-session-arrival-unit', 'db-session-host-reward-unit', 'db-steam-unit', 'edgelog-unit', 'db-audit-unit', 'logscrub-unit', 'logstore-unit', 'steam-unit', 'steamui-unit', 'sessions-unit', 'sessions-preview-unit', 'free-area-unit', 'overlay-policy-unit', 'marker-host-unit', 'shell-tier-unit', 'shell-history-unit', 'marker-actions-unit', 'sessions-xp-unit','session-arrival-unit', 'sessions-recurrence-unit', 'progression-unit', 'delete-account-unit', 'live-engine-unit', 'autoshare-unit', 'privacy-defaults-unit', 'backoff-unit', 'sharedtrip-unit', 'sharedstore-unit', 'sharedtrip-engine-unit', 'side-unit', 'help-unit', 'poi-types-unit', 'poi-model-unit', 'visibility-unit', 'mascot-unit', 'google-signin-unit', 'pmtiles-source-unit', 'preflight-codec-unit', 'preflight-session-unit', 'preflight-inventory-unit', 'preflight-safety-unit', 'motor-msp-compare-unit', 'preflight-readiness-unit', 'bench-fourway-unit', 'bench-electronics-unit', 'bench-combined-unit', 'readiness-ui-unit', 'fourway-codec-unit', 'fourway-boundary-unit', 'fourway-static-unit', 'preflight-status-unit', 'bench-machine-unit', 'bench-boundary-unit', 'bench-controller-unit', 'bench-safety-unit', 'bench-findings-unit', 'bench-analysis-unit', 'bench-analysis-controller-unit'];
const BROWSER = ['areas', 'areas-admin', 'areas-admin-keyboard', 'areas-details', 'areas-public', 'areas-explorer', 'areas-recover', 'areas-attributes', 'areas-photo', 'map-attribution', 'vn-enr51', 'my-enr51', 'fourway-ui', 'combined-ui', 'fly-in', 'zones-lifecycle', 'popup-theme', 'country-buttons', 'html-dom', 'session-preview', 'session-arrival', 'toolbar', 'discover', 'diag', 'autoshare', 'progression', 'sessions', 'sessions-explorer', 'responsive', 'steam', 'splash', 'stops', 'days', 'search', 'maplinks', 'maplaunch', 'reorder', 'visits', 'window', 'dashboard', 'hold', 'rain', 'ui', 'bulk', 'poi1', 'poi2', 'edit', 'prefs', 'opacity', 'mw', 'priv', 'theme', 'ai', 'trip', 'trips', 'sg', 'tools', 'mapsel', 'tripplan', 'tripstouch', 'shell', 'checkin', 'motion', 'dayroute', 'routes', 'spider', 'snow', 'cloud', 'storage', 'dashtall', 'paneltall', 'friends', 'party', 'live', 'swipe', 'layers', 'maprotate', 'locatemode', 'side', 'sidelist', 'sidedrag', 'popswipe', 'gestures', 'marker-content', 'marker-host', 'marker-host-s5', 'marker-host-s6', 'marker-host-s7', 'marker-host-s8', 'marker-host-explorer', 'shell-nav', 'shell-nav-explore', 'shell-nav-profile', 'cardsel', 'tabpill', 'launchloc', 'smoke', 'picker', 'hierarchy', 'poisearch', 'visibility', 'helppoi', 'tripview', 'mascots', 'google-signin', 'preflight-lab', 'bench-lab', 'aircraft-diag-privacy', 'motor-diagnostics-ui'];
const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const ji = args.indexOf('--jobs');
const jobsArg = ji >= 0 ? args[ji + 1] : '4';
const JOBS = Math.max(1, jobsArg === 'auto' ? Math.min(6, Math.floor(os.cpus().length / 2)) : parseInt(jobsArg, 10) || 1);
const ti = args.indexOf('--tier'), si = args.indexOf('--since'), fi = args.indexOf('--files');
const tier = ti >= 0 ? args[ti + 1] : args.includes('--fast') ? 'fast' : args.includes('--release') ? 'release' : null;
const dry = args.includes('--dry');
const words = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1) && (ti < 0 || i !== ti + 1) && (si < 0 || i !== si + 1) && (fi < 0 || i !== fi + 1));

/** The fast tier: what the changed files can affect. Conservative: shared infrastructure -> release tier; a file nothing maps -> every unit suite; browser suites are never dropped on a guess. */
function fastPlan() {
  const git = (a) => spawnSync('git', a, { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  let files = fi >= 0 ? args[fi + 1].split(',').filter(Boolean) : null;
  if (si >= 0 && files === null) { const d = git(['diff', '--name-only', `${args[si + 1]}...HEAD`]); if (d.status !== 0) return { why: `git diff ${args[si + 1]} failed -> release tier`, names: releaseNames() }; files = d.stdout.split('\n').filter(Boolean); const st = git(['status', '--porcelain=v1', '-uall']); files.push(...st.stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''))); files = [...new Set(files)]; }
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', '.claude/skills/test-impact/impact.mjs'), '--json', ...(files ?? [])], { encoding: 'utf8' });
  let p; try { p = JSON.parse(r.stdout); } catch { return { why: 'impact map unavailable -> release tier', names: releaseNames() }; }
  if (!p.files.length) return { why: 'no changed files', names: [] };
  if (p.shared) return { why: `shared infrastructure (${p.shared}) -> release tier`, names: releaseNames() };
  const browser = new Set(p.browser);
  for (const f of p.files) for (const [prefix, suites] of OWNERS) if (f === prefix || f.startsWith(prefix)) suites.forEach((x) => browser.add(x));
  if (p.browserNeeded) CANARY_BROWSER.forEach((x) => browser.add(x));
  const unit = p.unitAll ? UNIT : p.unit;
  const names = [...UNIT.filter((x) => unit.includes(x)), ...BROWSER.filter((x) => browser.has(x))];
  return { why: `${p.files.length} changed file(s)${p.unitAll ? ', a file no unit suite maps -> every unit suite' : ''}${p.browserNeeded ? ', canary set added' : ''}`, names };
}
function releaseNames() { return [...UNIT, ...BROWSER.filter((x) => RELEASE_BROWSER.includes(x))]; }

let names = onlyUnit ? UNIT : [...UNIT, ...BROWSER];
if (tier === 'release') names = releaseNames();
else if (tier === 'fast') { const p = fastPlan(); names = p.names; console.log(`fast tier: ${p.why}; ${names.length} suite(s)`); }
else if (tier && tier !== 'full') { console.error(`unknown tier "${tier}" (fast, release, full)`); process.exit(2); }
if (dry) { console.log(names.join(' ') || '(nothing to run)'); process.exit(0); }
if (tier === 'fast' && !names.length) { console.log('nothing to run'); process.exit(0); }
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
// seconds measured in the 2026-11-28 baseline run (4 jobs); only the order matters
const WEIGHT = { 'fourway-ui': 176, trip: 136, 'bench-lab': 121, ai: 85, areas: 79, routes: 78, 'areas-public': 77, 'combined-ui': 75, 'marker-host-s6': 75, 'motor-diagnostics-ui': 73, 'shell-nav': 70, 'marker-content': 69, tripstouch: 68, 'marker-host-s5': 67, spider: 66, mw: 65, mascots: 63, 'marker-host-s8': 61, 'areas-details': 60, 'marker-host-s7': 59, priv: 57, locatemode: 57, ui: 56, gestures: 45 };
const queue = names.filter((n) => !SERIAL.has(n)).sort((a, b) => (WEIGHT[b] || 0) - (WEIGHT[a] || 0));
const t00 = Date.now();
if (JOBS > 1) console.log(`running up to ${JOBS} suites at once`);
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) report(await runSuite(queue.shift())); }));
for (const n of names.filter((x) => SERIAL.has(x))) report(await runSuite(n));
console.log(`\n${failed ? failed + ' suite(s) failed' : 'all suites passed'}  (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
process.exit(failed ? 1 : 0);
