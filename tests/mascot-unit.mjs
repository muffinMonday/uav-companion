// The mascot files and the app icon set: every pose points at a real small file, the manifest and the head links name files that exist and use relative paths
// (the app is served from a sub-path on GitHub Pages), and the full-size originals are kept out of the deployed build.
import { readFileSync, existsSync, statSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const f = (p) => new URL(p, root);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const src = readFileSync(f('src/mascot-ui.js'), 'utf8');
const poses = [...src.matchAll(/(\w+): new URL\('\.\/(assets\/mascots\/[\w.-]+)'/g)];
ok(poses.length >= 2, 'the pose map lists ' + poses.map((m) => m[1]).join(', '));
for (const [, name, rel] of poses) {
  const p = f('src/' + rel);
  ok(existsSync(p) && rel.endsWith(name + '.webp'), name + ' -> ' + rel + ' exists and is named after the pose');
  ok(existsSync(p) && statSync(p).size <= 40 * 1024, name + ' stays under 40 KB (' + (existsSync(p) ? statSync(p).size : 0) + ' bytes)');
  ok(existsSync(f('public/mascots/' + name + '.png')), name + ' has its original in public/mascots');
}
ok(!/public\/mascots|(^|[^s])\/mascots\//.test(src.replace(/\/\/.*$/gm, '')), 'no code path refers to the originals');

const man = JSON.parse(readFileSync(f('public/manifest.webmanifest'), 'utf8'));
ok(man.start_url === './' && man.scope === './', 'manifest start_url and scope are relative');
ok(man.icons.length >= 2 && man.icons.every((i) => !i.src.startsWith('/') && !/^[a-z]+:/i.test(i.src) && existsSync(f('public/' + i.src))), 'manifest icons are relative and exist');
ok(man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512'), 'manifest has 192 and 512');
ok(!man.icons.some((i) => /maskable/.test(i.purpose || '')), 'no maskable icon is claimed (the picture is full-bleed)');

const html = readFileSync(f('index.html'), 'utf8');
const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)];
ok(links.length === 4, 'index.html has the two favicons, the touch icon and the manifest');
for (const [, rel, href] of links) ok(existsSync(f('public' + href)), rel + ' ' + href + ' exists in public/');
ok(!/data:image\/svg/.test(html), 'the generic inline favicon is gone');
ok(/name="theme-color" content="#ffffff"/.test(html), 'theme-color is unchanged');

const strip = readFileSync(f('scripts/strip-local.js'), 'utf8');
ok(/'mascots'/.test(strip), 'strip-local.js removes dist/mascots');
