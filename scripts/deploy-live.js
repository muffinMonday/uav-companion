// Deploys with sign-in on: reads the two public Supabase values from .env.development.local, sets them for this one build, and runs `npm run deploy`.
// Stops if either is missing, so a deploy never goes out with accounts silently switched off, and stops unless VITE_NEW_SHELL=1 is set (see below). The values are never printed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const NAMES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
let text = '';
try { text = readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8'); } catch { /* reported below */ }
const env = { ...process.env };
for (const n of NAMES) { const m = new RegExp('^' + n + '=(.+)$', 'm').exec(text); if (m) env[n] = m[1].trim(); }
// Optional: the CARTO dark basemap key (public, restricted to the site domain by CARTO). Without it the build uses the inverted standard map for dark mode.
for (const n of ['VITE_CARTO_API_KEY']) { const m = new RegExp('^' + n + '=(.+)$', 'm').exec(text); if (m) env[n] = m[1].trim(); }
if (!env.VITE_CARTO_API_KEY) console.warn('Note: VITE_CARTO_API_KEY is not set; dark mode will use the inverted standard map.');
const missing = NAMES.filter((n) => !env[n]);
if (missing.length) { console.error('Not deploying: missing ' + missing.join(', ') + ' (set them in .env.development.local or the shell).'); process.exit(1); }
// The new UI is a build flag, not a default: a deploy that does not name it publishes the old UI (it happened on 2026-11-26 and 2026-11-28). Use the full command in AGENTS.md;
// DEPLOY_OLD_UI=1 is the deliberate exception (a rollback to the old UI), never the default.
if (env.VITE_NEW_SHELL !== '1' && env.DEPLOY_OLD_UI !== '1') {
  console.error('Not deploying: VITE_NEW_SHELL=1 is not set, so this build would publish the OLD UI. Use the production command in Project_context/AGENTS.md (VITE_NEW_SHELL=1 VITE_PREFLIGHT_DIAGNOSTICS=1 VITE_BENCH_PHASE3=1 VITE_BENCH_FOURWAY=synthetic CACHE_DIR=C:/gpc node scripts/deploy-live.js), or set DEPLOY_OLD_UI=1 to publish the old UI on purpose.');
  process.exit(1);
}
const r = spawnSync('npm run deploy', { env, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
