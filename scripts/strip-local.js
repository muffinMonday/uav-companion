// Run after `vite build` and before publishing: removes everything built for this machine only (regions with "publish": false).
// Vite copies public/ into dist/, so public/data-local would otherwise go to the public site.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', process.argv[2] ?? 'dist');
const local = path.join(dist, 'data-local');
if (fs.existsSync(local)) { fs.rmSync(local, { recursive: true, force: true }); console.log('removed dist/data-local (local-only regions are never deployed)'); }
if (fs.existsSync(local)) { console.error('dist/data-local is still there: refusing to continue'); process.exit(1); }
// belt and braces: no manifest in the tree may mention a local region
for (const f of fs.existsSync(dist) ? fs.readdirSync(dist, { recursive: true }) : []) {
  if (!/manifest\.json$/.test(String(f))) continue;
  if (/"local":\s*true/.test(fs.readFileSync(path.join(dist, String(f)), 'utf8'))) { console.error(`${f} lists a local region: refusing to continue`); process.exit(1); }
}
