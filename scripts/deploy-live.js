// `npm run deploy:live`: the standard production deployment. It applies the version-controlled production configuration (scripts/deploy-config.js: the four approved feature
// flags), reads the public project values from the environment, validates all of it, and only then runs `npm run deploy` (regions restore, build, strip, check-dist, preflight, publish).
// Nothing has to be typed in front of the command. Any conflicting override, unapproved VITE_ variable or missing public value stops it before anything is built. Values are never printed.
//   npm run deploy:live      validate, then build and publish
//   npm run deploy:check     validate and make a throwaway build in a temp folder; checks the result; publishes nothing
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveDeployEnv, readEnvFiles, checkDist, PUBLIC_FILES, VITE_PRODUCTION_FILES, PRODUCTION_FLAGS } from './deploy-config.js';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const fail = (lines) => { console.error('Not deploying:'); for (const l of lines) console.error('  - ' + l); process.exit(1); };

const unknown = args.filter((a) => a !== '--check');
if (unknown.length) fail([`unknown argument ${unknown.join(' ')} (the only option is --check).`]);
const check = args.includes('--check');

const files = readEnvFiles(root, [...new Set([...PUBLIC_FILES, ...VITE_PRODUCTION_FILES])]);
const { env, errors, notes } = resolveDeployEnv({ processEnv: process.env, files });
if (process.env.DEPLOY_OLD_UI !== undefined) errors.push('DEPLOY_OLD_UI is no longer supported: the production build always has the approved flags. To go back to an older UI, redeploy an older commit.');
if (errors.length) fail(errors);

console.log('Production configuration (scripts/deploy-config.js):');
for (const [n, v] of Object.entries(PRODUCTION_FLAGS)) console.log(`  ${n}=${v}`);
for (const n of notes) console.log('  ' + n);
console.log(`  CACHE_DIR: ${env.CACHE_DIR ? 'set' : 'not set (default cache)'}`);

if (check) {
  // A throwaway build with exactly this environment, into a temp folder (no public/ copy, so quick), then the same bundle checks the real deployment runs before it publishes.
  Object.assign(process.env, env);
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uav-deploy-check-'));
  let problems;
  try {
    await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true, copyPublicDir: false } });
    problems = checkDist(out, env);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  if (problems.length) fail(problems);
  console.log('Check passed: the configuration is valid and a production build from it contains the approved features. Nothing was published.');
  process.exit(0);
}

const r = spawnSync('npm run deploy', { env, stdio: 'inherit', shell: true, cwd: root });
process.exit(r.status ?? 1);
