// The production deployment configuration: the single authoritative, version-controlled place for what a production build must contain, and the checks that enforce it.
// Used only by scripts/deploy-live.js (`npm run deploy:live`) and scripts/check-dist.js (a step of `npm run deploy`). vite.config.js, src/ and the dev, build and preview
// scripts never import it, so local runs, tests and preview builds do not inherit these flags.
//
// Who owns what:
//   feature flags            this file (PRODUCTION_FLAGS), reviewed in git
//   public project values    the environment: the shell, else .env.production.local, else .env.development.local (all git-ignored). Public by design (they are in the bundle).
//   secrets                  never in a file in this repository and never in a VITE_ variable (everything named VITE_ is embedded in the bundle); PRIVATE_NAMES below are checked for
//   local-only settings      CACHE_DIR (the gh-pages clone cache, an absolute path; optional, e.g. a short path on Windows). Never hardcoded here.
// No error or log line built here ever contains the value of a public key, a URL or a secret; only variable names.
import fs from 'node:fs';
import path from 'node:path';

/** The approved production feature flags. A different value in the environment aborts the deployment; there is no way to switch one off from here. */
export const PRODUCTION_FLAGS = Object.freeze({
  VITE_NEW_SHELL: '1', // the new four-destination shell (bottom navigation, side rail on larger screens)
  VITE_PREFLIGHT_DIAGNOSTICS: '1', // the read-only motor diagnostics lab
  VITE_BENCH_PHASE3: '1', // the motor diagnostics workspace and bench lab pages
  VITE_BENCH_FOURWAY: 'synthetic', // the four-way identification step on the simulated flight controller only
});

/** Public values every production build needs; their absence silently turns a feature off (accounts, the dark basemap), so they are required. */
export const PUBLIC_REQUIRED = Object.freeze(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_CARTO_API_KEY']);

/** The only VITE_ names a production build may see (Vite embeds every VITE_ variable in the client bundle). */
export const ALLOWED_VITE = Object.freeze(new Set([...Object.keys(PRODUCTION_FLAGS), ...PUBLIC_REQUIRED]));

/** Where the public values are read from after the shell, in order. The first file that defines a name wins. */
export const PUBLIC_FILES = Object.freeze(['.env.production.local', '.env.development.local']);

/** Files Vite itself loads for `vite build` (mode production). A VITE_ name outside ALLOWED_VITE in any of them would be embedded silently. */
export const VITE_PRODUCTION_FILES = Object.freeze(['.env', '.env.local', '.env.production', '.env.production.local']);

/** Backend secrets that must never appear in the shipped bundle (Edge Function secrets and the CLI credentials). */
export const PRIVATE_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_ACCESS_TOKEN', 'HEIGIT_API_KEY', 'AREA_PHOTO_CLEANUP_SECRET', 'STEAM_API_KEY', 'STEAM_CRON_SECRET', 'STEAM_STATE_SECRET',
]);

/** Set by deploy-live.js for the child build; scripts/check-dist.js refuses to let a build be published without it. */
export const PROFILE_VAR = 'UAV_DEPLOY_PROFILE';
export const PROFILE_VALUE = 'production';

/** Text that is in a built bundle only when its flag was on (the code behind a flag is removed from the bundle when it is off). tests/deploy-config-unit.mjs proves each one tracks its flag. */
export const FLAG_MARKERS = Object.freeze({
  VITE_NEW_SHELL: 'Map, Trips, Explore and Profile are along the bottom',
});

/** Pages that exist in dist only when their flag was on, as paths inside dist. */
export const FLAG_PAGES = Object.freeze({
  VITE_PREFLIGHT_DIAGNOSTICS: ['tools/preflight-spike/index.html'],
  VITE_BENCH_PHASE3: ['motor-diagnostics/index.html', 'tools/motor-bench-lab/index.html'],
});

const SECRET_LIKE = /(SECRET|SERVICE_ROLE|PASSWORD|PRIVATE|TOKEN|ACCESS_KEY|DB_URL)/i;

/** KEY=value lines (comments and blanks skipped, one pair of surrounding quotes removed, as Vite does). */
export function parseEnvText(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let v = m[2];
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Reads the named files from `root`; a missing file is an empty entry. */
export function readEnvFiles(root, names) {
  const out = {};
  for (const n of names) { try { out[n] = fs.readFileSync(path.join(root, n), 'utf8'); } catch { out[n] = null; } }
  return out;
}

const decodeJwtRole = (jwt) => {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role ?? null; } catch { return null; }
};

/** Shape checks on the public values. Names only in the messages. */
function checkPublicValues(v, errors) {
  const url = v.VITE_SUPABASE_URL;
  if (url) {
    let u = null;
    try { u = new URL(url); } catch { /* reported below */ }
    if (!u || u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname) || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      errors.push('VITE_SUPABASE_URL must be the project address, https://<project>.supabase.co, with no path, query or credentials.');
    }
  }
  const key = v.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key) {
    if (/\s/.test(key) || key.length < 20) errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is malformed (it must be one token of at least 20 characters).');
    else if (key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role') errors.push('VITE_SUPABASE_PUBLISHABLE_KEY holds a SECRET (service-role) key. Never put it in a VITE_ variable: it would be published in the bundle. Use the publishable (anon) key.');
  }
  const carto = v.VITE_CARTO_API_KEY;
  if (carto && (/\s/.test(carto) || carto.length < 8)) errors.push('VITE_CARTO_API_KEY is malformed (it must be one token of at least 8 characters).');
}

/**
 * Builds the environment for the production build and validates everything before anything is built or published.
 * @param {object} p
 * @param {Record<string,string|undefined>} p.processEnv  the shell environment
 * @param {Record<string,string|null>} p.files  contents of PUBLIC_FILES and VITE_PRODUCTION_FILES by name (null: not present)
 * @returns {{ env: Record<string,string>, errors: string[], notes: string[] }}
 */
export function resolveDeployEnv({ processEnv, files = {} }) {
  const errors = [];
  const notes = [];
  const shell = processEnv ?? {};

  // 1. Flags: applied automatically; any different value is a conflict, never a silent override.
  for (const [name, approved] of Object.entries(PRODUCTION_FLAGS)) {
    if (shell[name] !== undefined && shell[name] !== approved) {
      errors.push(`${name} is set in the environment to a value other than the approved production value "${approved}". Unset it: the production flags come from scripts/deploy-config.js and cannot be overridden or switched off from the shell.`);
    }
  }

  // 2. No other VITE_ variable may reach the bundle: not from the shell, not from a file Vite loads for a production build.
  const strays = new Set();
  for (const n of Object.keys(shell)) if (n.startsWith('VITE_') && !ALLOWED_VITE.has(n)) strays.add(n);
  for (const f of VITE_PRODUCTION_FILES) for (const n of Object.keys(parseEnvText(files[f]))) if (n.startsWith('VITE_') && !ALLOWED_VITE.has(n)) strays.add(`${n} (in ${f})`);
  for (const s of strays) {
    const name = s.split(' ')[0];
    errors.push(`${s} is not an approved production variable and Vite would embed it in the public bundle${SECRET_LIKE.test(name) ? ' (its name looks like a secret)' : ''}. Remove it, or add it to scripts/deploy-config.js in a reviewed change if it is meant to be public.`);
  }

  // 3. Public values: the shell first, then the git-ignored files. Required, validated, never printed.
  const parsed = PUBLIC_FILES.map((f) => ({ f, vars: parseEnvText(files[f]) }));
  const values = {};
  const sources = {};
  for (const name of PUBLIC_REQUIRED) {
    if (shell[name]) { values[name] = shell[name].trim(); sources[name] = 'shell'; continue; }
    const hit = parsed.find((p) => p.vars[name]);
    if (hit) { values[name] = hit.vars[name].trim(); sources[name] = hit.f; }
  }
  const missing = PUBLIC_REQUIRED.filter((n) => !values[n]);
  for (const n of missing) errors.push(`${n} is missing. Set it in the shell or in ${PUBLIC_FILES.join(' or ')} (git-ignored). Without it the build would silently lose ${n === 'VITE_CARTO_API_KEY' ? 'the dark basemap' : 'accounts and sign-in'}.`);
  checkPublicValues(values, errors);

  // 4. CACHE_DIR is a local-only setting, passed through to gh-pages. Never hardcoded; must be absolute if set.
  if (shell.CACHE_DIR !== undefined && shell.CACHE_DIR !== '' && !path.isAbsolute(shell.CACHE_DIR) && !path.win32.isAbsolute(shell.CACHE_DIR)) {
    errors.push('CACHE_DIR must be an absolute path (it is the gh-pages clone cache; it is optional, leave it unset to use the default).');
  }

  const env = { ...shell, ...PRODUCTION_FLAGS, ...values, [PROFILE_VAR]: PROFILE_VALUE };
  for (const n of PUBLIC_REQUIRED) notes.push(`${n}: set (from ${sources[n] ?? 'nowhere'})`);
  return { env, errors, notes };
}

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

/**
 * Checks a built `dist` against the production configuration: the flagged pages and code are in it, the public values are embedded, and no private secret is.
 * @param {string} dist  the build output folder
 * @param {Record<string,string|undefined>} env  the build environment (the values are compared, never printed)
 * @returns {string[]} errors (names only)
 */
export function checkDist(dist, env) {
  const errors = [];
  if (!fs.existsSync(path.join(dist, 'index.html'))) return [`${dist}/index.html is missing: nothing was built.`];
  for (const [flag, pages] of Object.entries(FLAG_PAGES)) {
    for (const page of pages) if (!fs.existsSync(path.join(dist, page))) errors.push(`dist/${page} is missing: the build does not have ${flag} on.`);
  }
  // the app and its scripts: assets/ and every html page; the data and tile archives are binary and large, so they are not read
  const files = [];
  const assets = path.join(dist, 'assets');
  if (fs.existsSync(assets)) files.push(...walk(assets).filter((f) => /\.(js|css|html)$/.test(f)));
  for (const f of walk(dist)) if (f.endsWith('.html') && !f.includes(`${path.sep}data${path.sep}`)) files.push(f);
  const text = [...new Set(files)].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const [flag, marker] of Object.entries(FLAG_MARKERS)) if (!text.includes(marker)) errors.push(`The bundle has no code for ${flag}: the build was made without it.`);
  for (const n of PUBLIC_REQUIRED) if (!env[n] || !text.includes(env[n])) errors.push(`${n} is not embedded in the bundle (it was missing or empty at build time).`);
  for (const n of PRIVATE_NAMES) if (env[n] && env[n].length >= 8 && text.includes(env[n])) errors.push(`The bundle contains the value of ${n}. A private secret was published; do not deploy.`);
  // supabase-js itself contains the literal prefix `sb_secret_` (it refuses such keys in a browser), so only a prefix followed by key characters counts
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text) || text.includes('InJvbGUiOiJzZXJ2aWNlX3JvbGUi')) errors.push('The bundle contains something that looks like a Supabase secret (service-role) key. Do not deploy.');
  return errors;
}
