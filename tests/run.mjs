// Runs the test suites and prints one line each. Exit code 1 if anything failed.
//   node tests/run.mjs            everything (browser suites need the app on http://localhost:5173, see docs)
//   node tests/run.mjs --unit     only the suites that need no browser
//   node tests/run.mjs trips ai   only suites whose file name contains one of these words
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const UNIT = ['ai-unit', 'trip-unit', 'trips-unit'];
const BROWSER = ['poi1', 'poi2', 'edit', 'prefs', 'opacity', 'mw', 'priv', 'ai', 'trip', 'trips', 'smoke'];
const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const words = args.filter((a) => !a.startsWith('--'));

let names = onlyUnit ? UNIT : [...UNIT, ...BROWSER];
if (words.length) names = names.filter((n) => words.some((w) => n.includes(w)));

const up = async () => { try { return (await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; } };
const needsApp = names.some((n) => BROWSER.includes(n));
if (needsApp && !(await up())) {
  console.error('The browser suites need the app running on http://localhost:5173.\nIn another terminal: npm run dev   (or: npm run build && npx vite preview --port 5173 --strictPort)\nOr run only the unit suites: npm run test:unit');
  process.exit(2);
}

let failed = 0;
for (const n of names) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(import.meta.dirname, `${n}.mjs`)], { encoding: 'utf8', timeout: 900000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const pass = (out.match(/^PASS/gm) || []).length, fail = (out.match(/^FAIL/gm) || []).length;
  const consoleErrors = /^errors: (?!none)/m.test(out);
  const crashed = r.status !== 0 || /Error:|TimeoutError/.test(out.split('\n').filter((l) => !/^(PASS|FAIL)/.test(l)).join('\n')) && r.status !== 0;
  const bad = fail > 0 || crashed || consoleErrors;
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${n.padEnd(10)} ${String(pass).padStart(3)} pass, ${fail} fail${consoleErrors ? ', console errors' : ''}${crashed ? ', crashed' : ''}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (bad) console.log(out.split('\n').filter((l) => /^FAIL|^errors|Error/.test(l)).slice(0, 8).map((l) => `      ${l.slice(0, 200)}`).join('\n'));
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
