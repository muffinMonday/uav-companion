// Derives the web images from the owner-approved originals in public/mascots/ (never edited, never shipped: strip-local.js removes them from dist).
//   node scripts/make-mascots.mjs
// Source -> output (nothing is redrawn; only resized, and cropped for the small favicons):
//   waving.png, thinking.png  -> src/assets/mascots/<name>.webp   256 px, used by src/mascot-ui.js
//   icon.png (a JPEG despite the name) -> public/icons/icon-512.png, icon-192.png, apple-touch-icon.png (180, whole picture)
//                                         favicon-32.png, favicon-48.png (head and goggles crop: the whole picture is unreadable at 16 to 48 px)
// No image library: the installed browser resizes and encodes through a canvas (the same browser the tests use).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium, CHANNEL } from '../tests/lib.mjs';

const root = new URL('..', import.meta.url);
const file = (p) => new URL(p, root);
const MASCOTS = ['waving', 'thinking'];
const HEAD = { x: 150, y: 0, w: 1100, h: 1100 }; // in icon.png (1536 x 1536): hair, antennas, goggles, face
const ICONS = [
  { out: 'public/icons/icon-512.png', size: 512 },
  { out: 'public/icons/icon-192.png', size: 192 },
  { out: 'public/icons/apple-touch-icon.png', size: 180 },
  { out: 'public/icons/favicon-48.png', size: 48, crop: HEAD },
  { out: 'public/icons/favicon-32.png', size: 32, crop: HEAD },
];

mkdirSync(file('src/assets/mascots/'), { recursive: true });
mkdirSync(file('public/icons/'), { recursive: true });
const b64 = (p, mime) => `data:${mime};base64,` + readFileSync(file(p)).toString('base64');

const browser = await chromium.launch({ channel: CHANNEL });
const page = await browser.newPage();
await page.goto('about:blank');
// Resizes by repeated halving (a single big step aliases), then encodes.
await page.evaluate(() => {
  window.derive = async (src, size, type, quality, crop) => {
    const img = new Image(); img.src = src; await img.decode();
    let c = document.createElement('canvas'), x = c.getContext('2d');
    const s = crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    c.width = s.w; c.height = s.h; x.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    while (c.width > size) {
      const w = Math.max(size, Math.round(c.width / 2));
      const n = document.createElement('canvas'); n.width = w; n.height = w;
      const nx = n.getContext('2d'); nx.imageSmoothingQuality = 'high'; nx.drawImage(c, 0, 0, w, w); c = n;
    }
    return c.toDataURL(type, quality);
  };
});
const save = (out, url) => { const buf = Buffer.from(url.split(',')[1], 'base64'); writeFileSync(file(out), buf); console.log(out.padEnd(40), buf.length + ' bytes'); };
for (const name of MASCOTS) save(`src/assets/mascots/${name}.webp`, await page.evaluate(([s, n]) => window.derive(s, n, 'image/webp', 0.86), [b64(`public/mascots/${name}.png`, 'image/png'), 256]));
const icon = b64('public/mascots/icon.png', 'image/jpeg');
for (const i of ICONS) save(i.out, await page.evaluate(([s, n, c]) => window.derive(s, n, 'image/png', undefined, c), [icon, i.size, i.crop ?? null]));
await browser.close();
