// Deploys with sign-in on: reads the two public Supabase values from .env.development.local, sets them for this one build, and runs `npm run deploy`.
// Stops if either is missing, so a deploy never goes out with accounts silently switched off. The values are never printed.
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
const r = spawnSync('npm run deploy', { env, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
