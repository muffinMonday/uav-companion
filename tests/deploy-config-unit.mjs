// The production deployment configuration (scripts/deploy-config.js, scripts/deploy-live.js, scripts/check-dist.js): the flags are applied without being typed, conflicts and missing
// public values stop the deployment before anything is built, private secrets never reach the bundle, and the existing safeguards are still in the chain.
// Never publishes: it calls the pure functions, builds with the Vite API into temp folders (no public/ copy), and runs deploy-live.js only with --check or with an environment that aborts first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
import {
  PRODUCTION_FLAGS, PUBLIC_REQUIRED, FLAG_MARKERS, FLAG_PAGES, PROFILE_VAR, PROFILE_VALUE, parseEnvText, resolveDeployEnv, checkDist,
} from '../scripts/deploy-config.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-config-'));

// Fake values with recognisable text, so a leak into a message or a bundle is detectable. None is a real key.
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY_OK = 'sb_publishable_FAKEPUBLISHABLEKEY0123456789';
const CARTO_OK = 'FAKECARTOKEY0123456789';
const PUBLIC = { VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK, VITE_CARTO_API_KEY: CARTO_OK };
const fileOf = (vars) => Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
const resolve = (shell = {}, files = {}) => resolveDeployEnv({ processEnv: shell, files });
const text = (r) => r.errors.join('\n');

// ---------- 1. no manually supplied flags
{
  const r = resolve({ PATH: '/bin' }, { '.env.development.local': fileOf(PUBLIC) });
  ok(r.errors.length === 0, 'with no flags in the shell and the public values in .env.development.local, the configuration is valid');
  ok(Object.entries(PRODUCTION_FLAGS).every(([k, v]) => r.env[k] === v), 'the four approved flags are applied automatically');
  ok(JSON.stringify(PRODUCTION_FLAGS) === JSON.stringify({ VITE_NEW_SHELL: '1', VITE_PREFLIGHT_DIAGNOSTICS: '1', VITE_BENCH_PHASE3: '1', VITE_BENCH_FOURWAY: 'synthetic' }), 'the approved flags are exactly the four documented ones');
  ok(r.env[PROFILE_VAR] === PROFILE_VALUE && r.env.PATH === '/bin', 'the build is marked as made by deploy:live and the rest of the environment passes through');
  const same = resolve({ ...PRODUCTION_FLAGS }, { '.env.development.local': fileOf(PUBLIC) });
  ok(same.errors.length === 0, 'supplying the approved values by hand is accepted (the old command still works)');
}

// ---------- 2. conflicting or invalid overrides
{
  for (const [flag, approved] of Object.entries(PRODUCTION_FLAGS)) {
    for (const bad of ['0', '', 'LEAKME-9f3a77', approved === '1' ? 'true' : '1']) {
      const r = resolve({ [flag]: bad }, { '.env.development.local': fileOf(PUBLIC) });
      ok(r.errors.length >= 1 && text(r).includes(flag) && !text(r).includes('LEAKME'), `${flag}=${JSON.stringify(bad === 'LEAKME-9f3a77' ? '<text>' : bad)} aborts, names the flag and does not echo the supplied value`);
    }
  }
  const stray = resolve({ VITE_DATA_BASE_URL: 'https://elsewhere.example/data/', VITE_API_SECRET: 'LEAKME-1' }, { '.env.development.local': fileOf(PUBLIC) });
  ok(text(stray).includes('VITE_DATA_BASE_URL') && text(stray).includes('VITE_API_SECRET') && /looks like a secret/.test(text(stray)) && !text(stray).includes('LEAKME') && !text(stray).includes('elsewhere.example'), 'an unapproved VITE_ variable in the shell aborts (a secret-looking name is called out) without echoing its value');
  const fromFile = resolve({}, { '.env.development.local': fileOf(PUBLIC), '.env.production': 'VITE_DATA_BASE_URL=https://elsewhere.example/data/\nVITE_NEW_SHELL=0' });
  ok(text(fromFile).includes('VITE_DATA_BASE_URL (in .env.production)') && !text(fromFile).includes('elsewhere.example'), 'an unapproved VITE_ variable in a file Vite loads for a production build aborts');
  ok(!text(fromFile).includes('VITE_NEW_SHELL'), 'an approved name in such a file is not the problem (the build environment overrides it)');
  const local = resolve({}, { '.env.development.local': fileOf(PUBLIC), '.env.local': 'VITE_TOKEN_X=LEAKME-2' });
  ok(text(local).includes('VITE_TOKEN_X (in .env.local)') && !text(local).includes('LEAKME'), 'the same holds for .env.local');
  ok(parseEnvText('# c\nA="x y"\nB=\'z\'\n  export C = 3  \nbad line').A === 'x y' && parseEnvText("B='z'").B === 'z' && parseEnvText('export C = 3').C === '3', 'the env file parser handles quotes, export and spacing');
}

// ---------- 3. missing or malformed required environment configuration
{
  for (const name of PUBLIC_REQUIRED) {
    const { [name]: _, ...rest } = PUBLIC;
    const r = resolve({}, { '.env.development.local': fileOf(rest) });
    ok(r.errors.length === 1 && text(r).includes(name), `without ${name} the deployment aborts and names it`);
  }
  ok(resolve({}, {}).errors.length === PUBLIC_REQUIRED.length, 'with no environment files at all, every missing public value is reported');
  const bad = (vars) => text(resolve({}, { '.env.development.local': fileOf({ ...PUBLIC, ...vars }) }));
  ok(/VITE_SUPABASE_URL must be/.test(bad({ VITE_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' })), 'a plain http Supabase address is refused');
  ok(/VITE_SUPABASE_URL must be/.test(bad({ VITE_SUPABASE_URL: 'https://evil.example.com' })) && /VITE_SUPABASE_URL must be/.test(bad({ VITE_SUPABASE_URL: 'https://user:pw@abcdefghijklmnopqrst.supabase.co' })) && /VITE_SUPABASE_URL must be/.test(bad({ VITE_SUPABASE_URL: 'not a url' })), 'a Supabase address that is not https://<project>.supabase.co, has credentials or is not a URL is refused');
  const jwt = (role) => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig-FAKE-SIGNATURE-0123456789';
  const e1 = bad({ VITE_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') });
  const e2 = bad({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_FAKESECRETKEY0123456789' });
  ok(/holds a SECRET/.test(e1) && /holds a SECRET/.test(e2) && !e1.includes('FAKE-SIGNATURE') && !e2.includes('FAKESECRET'), 'a service-role or secret key in the publishable slot is refused, without echoing it');
  ok(/VITE_SUPABASE_PUBLISHABLE_KEY is malformed/.test(bad({ VITE_SUPABASE_PUBLISHABLE_KEY: 'short' })) && /VITE_CARTO_API_KEY is malformed/.test(bad({ VITE_CARTO_API_KEY: 'x y' })), 'malformed publishable and CARTO keys are refused');
  ok(!resolve({}, { '.env.development.local': fileOf(PUBLIC) }).errors.some((e) => e.includes(KEY_OK) || e.includes(CARTO_OK) || e.includes(URL_OK)), 'a valid configuration reports no value either');
  const every = [bad({ VITE_SUPABASE_URL: 'http://x.supabase.co' }), bad({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_FAKESECRETKEY0123456789' }), text(resolve({}, {}))].join('\n');
  ok(![KEY_OK, CARTO_OK, 'FAKESECRETKEY'].some((v) => every.includes(v)), 'no error message contains a key value');
  ok(resolve({ CACHE_DIR: 'relative/cache' }, { '.env.development.local': fileOf(PUBLIC) }).errors.some((e) => e.startsWith('CACHE_DIR')), 'a relative CACHE_DIR is refused');
  ok(resolve({ CACHE_DIR: 'C:/gpc' }, { '.env.development.local': fileOf(PUBLIC) }).errors.length === 0 && resolve({ CACHE_DIR: '/var/tmp/gp' }, { '.env.development.local': fileOf(PUBLIC) }).errors.length === 0 && resolve({}, { '.env.development.local': fileOf(PUBLIC) }).errors.length === 0, 'CACHE_DIR is optional and an absolute path (Windows or POSIX) is accepted');
  const order = resolve({ VITE_CARTO_API_KEY: 'SHELLCARTOKEY0123456789' }, { '.env.production.local': fileOf({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }), '.env.development.local': fileOf({ ...PUBLIC, VITE_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }) });
  ok(order.env.VITE_CARTO_API_KEY === 'SHELLCARTOKEY0123456789' && order.env.VITE_SUPABASE_URL === URL_OK, 'public values: the shell wins, then .env.production.local, then .env.development.local');
}

// ---------- 4. the production build: configuration, flags and secrets (Vite API, temp folders)
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
const SECRETS = { SUPABASE_SERVICE_ROLE_KEY: 'FAKE-SERVICE-ROLE-KEY-0123456789', SUPABASE_DB_PASSWORD: 'FAKE-DB-PASSWORD-0123456789', HEIGIT_API_KEY: 'FAKE-HEIGIT-KEY-0123456789', STEAM_API_KEY: 'FAKE-STEAM-KEY-0123456789' };
const saved = { ...process.env };
async function buildWith(env) {
  for (const k of Object.keys(process.env)) if (k.startsWith('VITE_') || k in SECRETS) delete process.env[k];
  Object.assign(process.env, env);
  const out = fs.mkdtempSync(path.join(tmp, 'dist-'));
  await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true, copyPublicDir: false } });
  return out;
}
let good;
try {
  const resolved = resolve({ ...SECRETS }, { '.env.development.local': fileOf(PUBLIC) });
  good = await buildWith(resolved.env);
  const problems = checkDist(good, resolved.env);
  ok(problems.length === 0, 'a build from the resolved environment passes the bundle check: ' + problems.join(' | '));
  ok(Object.values(FLAG_PAGES).flat().every((p) => fs.existsSync(path.join(good, p))), 'the flagged pages (motor diagnostics, bench lab, preflight lab) are in the build');
  const all = fs.readdirSync(path.join(good, 'assets')).map((f) => fs.readFileSync(path.join(good, 'assets', f), 'utf8')).join('\n');
  ok(all.includes(FLAG_MARKERS.VITE_NEW_SHELL), 'the new shell is in the bundle');
  ok(all.includes(URL_OK) && all.includes(KEY_OK) && all.includes(CARTO_OK), 'the three public values are embedded in the bundle');
  ok(!Object.values(SECRETS).some((v) => all.includes(v)), 'no private secret from the environment (service-role key, database password, HeiGIT, Steam) is in the bundle, although all were set during the build');

  const off = await buildWith({ ...PUBLIC });
  const offProblems = checkDist(off, { ...PUBLIC });
  ok(offProblems.some((e) => e.includes('VITE_NEW_SHELL')) && offProblems.some((e) => e.includes('VITE_BENCH_PHASE3')), 'a build made without the flags fails the bundle check on the shell and on the bench pages (the markers track the flags)');
  const noCarto = await buildWith({ ...PRODUCTION_FLAGS, VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK });
  ok(checkDist(noCarto, { ...PRODUCTION_FLAGS, ...PUBLIC }).some((e) => e.includes('VITE_CARTO_API_KEY')), 'a build made without the CARTO key fails the bundle check instead of silently losing the dark basemap');
} finally {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}
{
  // the bundle check itself, on a planted leak (a synthetic dist): the message names the variable and never the value
  const fake = fs.mkdtempSync(path.join(tmp, 'leak-'));
  fs.cpSync(good, fake, { recursive: true });
  fs.appendFileSync(path.join(fake, 'assets', fs.readdirSync(path.join(fake, 'assets')).find((f) => f.endsWith('.js'))), `\n;var leaked="${SECRETS.HEIGIT_API_KEY}";var k="sb_secret_ABCDEFGHIJKLMNOPQRSTUVWX";`);
  const errs = checkDist(fake, { ...PRODUCTION_FLAGS, ...PUBLIC, ...SECRETS }).join('\n');
  ok(/HEIGIT_API_KEY/.test(errs) && /service-role\) key/.test(errs) && !errs.includes(SECRETS.HEIGIT_API_KEY) && !errs.includes('ABCDEFGHIJKLMNOPQRSTUVWX'), 'a planted secret in the bundle is detected by name, and its value is not printed');
}

// ---------- 5. existing safeguards and isolation
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const steps = pkg.scripts.deploy.split('&&').map((s) => s.trim());
  const at = (frag) => steps.findIndex((s) => s.includes(frag));
  ok(steps[0] === 'node scripts/preflight-data.js --restore' && at('vite build') === 1 && at('strip-local.js') === 2 && at('check-dist.js') === 3 && steps[4] === 'node scripts/preflight-data.js' && steps[5] === 'gh-pages -d dist --nojekyll --no-history' && steps.length === 6,
    'the deploy chain keeps its order: restore regions, build, strip local regions, bundle check, data preflight, publish with .nojekyll');
  ok(pkg.scripts['deploy:live'] === 'node scripts/deploy-live.js' && pkg.scripts['deploy:check'] === 'node scripts/deploy-live.js --check', 'deploy:live is the standard command and deploy:check validates without publishing');
  ok(fs.readFileSync(path.join(ROOT, 'public/CNAME'), 'utf8').trim() === 'uavcompanion.com', 'public/CNAME is unchanged (the custom domain survives the publish)');
  const flagNames = Object.keys(PRODUCTION_FLAGS);
  ok(['dev', 'build', 'preview', 'test'].every((s) => !flagNames.some((f) => pkg.scripts[s].includes(f))) && !/deploy-config/.test(fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8')), 'npm run dev, build, preview and test neither set the production flags nor import the production configuration');
  const srcFiles = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith('.js') && srcFiles.push(p); } }; walk(path.join(ROOT, 'src'));
  ok(!srcFiles.some((f) => /deploy-config/.test(fs.readFileSync(f, 'utf8'))), 'no application source imports the deployment configuration');
  ok(!fs.existsSync(path.join(ROOT, '.env')) && !fs.existsSync(path.join(ROOT, '.env.production')), 'no committed .env or .env.production file sets flags for ordinary builds');

  const run = (script, args, env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const baseEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, Path: process.env.Path };
  const noProfile = run('check-dist.js', [good], { ...baseEnv, ...PRODUCTION_FLAGS, ...PUBLIC });
  ok(noProfile.status === 1 && /deploy:live/.test(noProfile.stderr), 'check-dist refuses a build that did not come from deploy:live (a plain npm run deploy cannot publish)');
  const wrongFlag = run('check-dist.js', [good], { ...baseEnv, ...PRODUCTION_FLAGS, ...PUBLIC, VITE_NEW_SHELL: '0', [PROFILE_VAR]: PROFILE_VALUE });
  ok(wrongFlag.status === 1 && /VITE_NEW_SHELL/.test(wrongFlag.stderr), 'check-dist refuses a build environment whose flag differs from the approved value');
  const passes = run('check-dist.js', [good], { ...baseEnv, ...PRODUCTION_FLAGS, ...PUBLIC, [PROFILE_VAR]: PROFILE_VALUE });
  ok(passes.status === 0 && /check-dist ok/.test(passes.stdout), 'check-dist accepts a correct production build');
  const leakEnv = run('check-dist.js', [good], { ...baseEnv, ...PRODUCTION_FLAGS, ...PUBLIC, [PROFILE_VAR]: PROFILE_VALUE, ...SECRETS });
  ok(leakEnv.status === 0, 'private secrets present in the environment do not trip the check when they are not in the bundle');

  // deploy-live.js: only runs that abort before building (and never a real publish)
  const conflict = run('deploy-live.js', ['--check'], { ...baseEnv, VITE_NEW_SHELL: '0' });
  ok(conflict.status === 1 && /VITE_NEW_SHELL/.test(conflict.stderr) && !/Production configuration/.test(conflict.stdout), 'deploy-live aborts on a conflicting flag before printing a configuration or building');
  const oldUi = run('deploy-live.js', ['--check'], { ...baseEnv, DEPLOY_OLD_UI: '1' });
  ok(oldUi.status === 1 && /DEPLOY_OLD_UI is no longer supported/.test(oldUi.stderr), 'the DEPLOY_OLD_UI escape hatch is gone');
  const badArg = run('deploy-live.js', ['--publish-anyway'], { ...baseEnv });
  ok(badArg.status === 1 && /unknown argument/.test(badArg.stderr), 'an unknown argument is refused');
  const stray = run('deploy-live.js', ['--check'], { ...baseEnv, VITE_SOMETHING_ELSE: 'LEAKME-3' });
  ok(stray.status === 1 && /VITE_SOMETHING_ELSE/.test(stray.stderr) && !/LEAKME/.test(stray.stderr + stray.stdout), 'deploy-live aborts on an unapproved VITE_ variable without printing its value');
}

fs.rmSync(tmp, { recursive: true, force: true });
