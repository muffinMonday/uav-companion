// Maps changed files to the unit suites they can affect, runs them through tests/run.mjs, prints a short report.
//   node .claude/skills/test-impact/impact.mjs              changed files from git, run the chosen unit suites
//   node .claude/skills/test-impact/impact.mjs --dry        plan only, run nothing
//   node .claude/skills/test-impact/impact.mjs a.js b.js    use these files instead of git
//   node .claude/skills/test-impact/impact.mjs --browser    also run the whole browser set (needs the app on :5173)
// Rule: when impact is uncertain, run every unit suite. A suite is never dropped on a guess.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (f) => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const argv = process.argv.slice(2);
const dry = argv.includes('--dry'), withBrowser = argv.includes('--browser');
const given = argv.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\\/g, '/').replace(/^\.\//, ''));

// Suite inventory: the arrays in tests/run.mjs are the single source of truth.
const runSrc = read('tests/run.mjs');
const list = (name) => [...(new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(runSrc)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const UNIT = list('UNIT'), BROWSER = list('BROWSER');
if (!UNIT.length) { console.log('test-impact: cannot read UNIT from tests/run.mjs -> run: npm run test:unit'); process.exit(3); }

// Changed files.
function changed() {
  if (given.length) return { files: given, source: 'arguments' };
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const parts = r.stdout.split('\0').filter(Boolean), files = [];
  for (let i = 0; i < parts.length; i++) {
    const st = parts[i].slice(0, 2); files.push(parts[i].slice(3));
    if (/[RC]/.test(st)) i++; // rename or copy: the old path follows, skip it
  }
  return { files: [...new Set(files)], source: 'git status' };
}

// Dependency closure of a file through relative imports.
const importsOf = (f) => {
  const out = [], dir = path.posix.dirname(f);
  for (const m of read(f).matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) out.push(path.posix.normalize(path.posix.join(dir, m[1])));
  return out;
};
const closure = (start) => {
  const seen = new Set(), stack = [...start];
  while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); if (/\.m?js$/.test(f)) stack.push(...importsOf(f)); }
  return seen;
};
// What a suite depends on: files named in its text (and in the tests/lib*.mjs helpers it imports), then their imports.
function depsOf(suite) {
  const seen = new Set(), start = [`tests/${suite}.mjs`], mentioned = [];
  const walk = (f) => {
    if (seen.has(f)) return; seen.add(f);
    const t = read(f);
    for (const m of t.matchAll(/(?:src|public|scripts|supabase)\/[\w./-]+\.\w+/g)) mentioned.push(m[0]);
    if (/migrations/.test(t)) mentioned.push('supabase/migrations/');
    for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.\/[^'"]+)['"]/g)) { const g = path.posix.join('tests', m[1]); if (existsSync(path.join(ROOT, g))) { start.push(g); walk(g); } }
  };
  walk(start[0]);
  return new Set([...closure([...start, ...mentioned.filter((x) => !x.endsWith('/'))]), ...mentioned.filter((x) => x.endsWith('/'))]);
}

const HIGH = /^(src\/(poi|trips|prefs|sync\/core|sharedtrip\/core)\.js|tests\/(lib|run)\.mjs|package(-lock)?\.json|vite\.config\.js)$/;
const DOC = (f) => (/\.md$/i.test(f) && !f.startsWith('public/ai/')) || /^(docs|Project_context|planning|tests\/out|\.claude)\//.test(f) || f === 'LICENSE' || f === '.gitignore';
const BROWSER_ONLY = (f) => /\.(css|html)$/.test(f) || (f.startsWith('public/') && !f.startsWith('public/ai/') && !f.startsWith('public/data'));

const c = changed();
if (!c) {
  console.log('test-impact: git unavailable -> FULL unit (npm run test:unit)');
  if (dry) process.exit(0);
  process.exit(spawnSync(process.execPath, ['tests/run.mjs', '--unit'], { cwd: ROOT, stdio: 'inherit' }).status ?? 1);
}
const files = c.files;
if (!files.length) { console.log(`test-impact: no changed files (${c.source}) -> nothing to run`); process.exit(0); }

const deps = Object.fromEntries(UNIT.map((s) => [s, depsOf(s)]));
const picked = new Map(); // suite -> the changed file that selected it
let full = null, browserNeeded = false;
const docs = [], browserOnly = [];
const hit = (f, s) => deps[s].has(f) || [...deps[s]].some((d) => d.endsWith('/') && f.startsWith(d));
for (const f of files) {
  if (/^(src\/|index\.html$|public\/ai\/)/.test(f)) browserNeeded = true;
  if (DOC(f)) { docs.push(f); continue; }
  if (HIGH.test(f)) { full = full || `shared/high-risk file ${f}`; continue; }
  const m = UNIT.filter((s) => hit(f, s));
  if (m.length) { for (const s of m) if (!picked.has(s)) picked.set(s, f); continue; }
  if (/^tests\/.+\.mjs$/.test(f)) { browserOnly.push(f); continue; } // a browser suite itself
  if (BROWSER_ONLY(f)) { browserOnly.push(f); browserNeeded = true; continue; }
  full = full || `no unit suite maps ${f}`;
}

const stems = files.filter((f) => f.startsWith('src/')).flatMap((f) => path.posix.basename(f, '.js').split('-')).filter((t) => t.length > 2 && t !== 'main');
const hints = BROWSER.filter((b) => stems.some((t) => b.includes(t) || t.includes(b)));

console.log(`test-impact: ${files.length} changed (${c.source})${docs.length ? `, ${docs.length} doc/non-code ignored` : ''}`);
let chosen;
if (full) { chosen = UNIT; console.log(`unit: FULL (${UNIT.length} suites) because ${full}`); }
else if (picked.size) { chosen = [...picked.keys()]; console.log(`unit: ${chosen.length}/${UNIT.length} suites`); for (const [s, f] of picked) console.log(`  ${s} <- ${f}`); }
else { chosen = []; console.log('unit: none needed' + (browserOnly.length ? ` (browser-only: ${browserOnly.join(', ')})` : ' (docs/non-code only)')); }
if (browserNeeded) console.log(`browser: not mapped reliably; AGENTS.md requires the full "npm test" (app on :5173) before commit.${hints.length ? ' Hints, not a selection: ' + hints.join(' ') : ''}`);
if (dry) { console.log('(dry run: nothing executed)'); process.exit(0); }

let status = 0;
if (chosen.length) {
  // run.mjs filters by substring, so a name can pull in extra suites (trip-unit also matches sharedtrip-unit): never fewer.
  const args = chosen.length === UNIT.length ? ['--unit'] : chosen;
  const r = spawnSync(process.execPath, ['tests/run.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).split('\n').filter(Boolean);
  const bad = r.status !== 0 || lines.some((l) => /^FAIL/.test(l));
  console.log((bad ? lines : lines.filter((l) => !/^ok /.test(l) && !/running up to/.test(l))).join('\n'));
  if (!bad) console.log(`ok: ${lines.filter((l) => /^ok /.test(l)).length} suites passed`);
  status = bad ? (r.status || 1) : 0;
}
if (withBrowser && browserNeeded) { const r = spawnSync(process.execPath, ['tests/run.mjs', ...BROWSER], { cwd: ROOT, stdio: 'inherit' }); status = status || (r.status ?? 1); }
else if (browserNeeded) console.log('verdict: unit part done; browser suites still to run (--browser or npm test).');
process.exit(status);
