// Community flying areas, optional location photo: the server-side image check (supabase/functions/_shared/area-photo.js). Real structure, no pixel decoding. No browser, no network.
import { inspectImage, inspectJpeg, inspectPng, inspectWebp, LIMITS } from '../supabase/functions/_shared/area-photo.js';
import { jpeg, png, webp, GIF, SVG, HTML } from './lib-photo.mjs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const code = (r) => (r.ok ? 'ok' : r.code);

// ---- valid files
let r = inspectImage(jpeg(1600, 1200), 'image/jpeg');
ok(r.ok && r.mime === 'image/jpeg' && r.ext === 'jpg' && r.width === 1600 && r.height === 1200, 'a plain JPEG passes, with its real size');
ok(inspectImage(jpeg(400, 300, { progressive: true })).ok && inspectImage(jpeg(400, 300, { noJfif: true })).ok, 'progressive and header-less JPEG pass');
r = inspectImage(png(800, 600), 'image/png'); ok(r.ok && r.mime === 'image/png' && r.width === 800 && r.height === 600, 'a plain PNG passes');
ok(inspectImage(png(400, 300, { chunks: [['gAMA', [0, 1, 0, 0]], ['sRGB', [0]], ['pHYs', [0, 0, 0x0B, 0x13, 0, 0, 0x0B, 0x13, 1]]] })).ok, 'harmless PNG chunks (gAMA, sRGB, pHYs) pass');
r = inspectImage(webp(1000, 700, 'lossy'), 'image/webp'); ok(r.ok && r.mime === 'image/webp' && r.width === 1000 && r.height === 700, 'a lossy WebP passes');
r = inspectImage(webp(640, 480, 'lossless')); ok(r.ok && r.width === 640 && r.height === 480, 'a lossless WebP passes');
ok(inspectImage(webp(400, 300, 'lossy', { vp8x: 0x10 })).ok, 'a WebP with an extended header and only the alpha flag passes');

// ---- metadata, in every container
// JPEG: metadata segments are REMOVED (the cleaned bytes are returned); the cleaned file is valid, has none left, and is otherwise identical in structure
const markers = (u) => { const out = []; let i = 2; while (i < u.length && u[i] === 0xFF && u[i + 1] !== 0xDA) { out.push(u[i + 1]); i += 2 + ((u[i + 2] << 8) | u[i + 3]); } return out; };
for (const [label, o] of [['EXIF (APP1, GPS)', { app1: true }], ['XMP', { xmp: true }], ['IPTC (APP13)', { iptc: true }], ['ICC profile (APP2)', { icc: true }], ['comment', { comment: true }], ['EXIF + XMP + ICC + comment together', { app1: true, xmp: true, icc: true, comment: true }]]) {
  const src = jpeg(400, 300, o), res = inspectImage(src);
  const again = res.ok && res.data ? inspectImage(res.data) : null;
  ok(res.ok && res.stripped >= 1 && res.data.length < src.length && again?.ok && !again.data && !markers(res.data).some((m) => m >= 0xE1 && m <= 0xEF) && !markers(res.data).includes(0xFE) && res.width === 400, `JPEG ${label}: removed, the cleaned file is valid and carries none (${res.stripped} segment(s))`);
}
ok(!Buffer.from(inspectImage(jpeg(400, 300, { app1: true })).data).includes(Buffer.from('Exif')), 'the EXIF bytes are really gone from the cleaned file');
ok(inspectImage(jpeg(400, 300)).data === undefined, 'a JPEG without metadata is returned as it is (no rewrite)');
for (const [label, buf] of [['JPEG JFIF thumbnail', jpeg(400, 300, { thumbnail: true })],
  ['PNG tEXt', png(400, 300, { chunks: [['tEXt', [...Buffer.from('Author\0me')]]] })], ['PNG iTXt (XMP)', png(400, 300, { chunks: [['iTXt', [...Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x/>')]]] })], ['PNG zTXt', png(400, 300, { chunks: [['zTXt', [97, 0, 0, 1]]] })],
  ['PNG eXIf', png(400, 300, { chunks: [['eXIf', [0x4D, 0x4D, 0, 42, 0, 0, 0, 8]]] })], ['PNG iCCP', png(400, 300, { chunks: [['iCCP', [97, 0, 0, 1]]] })], ['PNG tIME', png(400, 300, { chunks: [['tIME', [7, 234, 11, 27, 1, 2, 3]]] })],
  ['PNG unknown ancillary', png(400, 300, { chunks: [['abCD', [1, 2, 3]]] })],
  ['WebP EXIF', webp(400, 300, 'lossy', { vp8x: 0x08, exif: true })], ['WebP XMP', webp(400, 300, 'lossy', { vp8x: 0x04, xmp: true })], ['WebP ICC', webp(400, 300, 'lossy', { vp8x: 0x20, iccp: true })],
  ['WebP EXIF chunk without the flag', webp(400, 300, 'lossy', { vp8x: 0x10, exif: true })], ['WebP flags only (EXIF)', webp(400, 300, 'lossy', { vp8x: 0x08 })]]) {
  ok(code(inspectImage(buf)) === 'metadata', `${label} is refused as metadata`);
}

// ---- animation, damage, wrong or hostile types
ok(code(inspectImage(png(400, 300, { animated: true }))) === 'animated' && code(inspectImage(webp(400, 300, 'lossy', { vp8x: 0x02 }))) === 'animated' && code(inspectImage(webp(400, 300, 'lossy', { vp8x: 0x10, anim: true }))) === 'animated', 'animated PNG and WebP are refused');
ok(code(inspectImage(png(400, 300, { badCrc: true }))) === 'corrupt', 'a PNG with a bad checksum is refused');
ok(code(inspectImage(png(400, 300, { noIdat: true }))) === 'corrupt', 'a PNG without image data is refused');
ok(code(inspectImage(png(400, 300, { trailing: [1, 2, 3] }))) === 'corrupt' && code(inspectImage(jpeg(400, 300, { trailing: [1, 2, 3] }))) === 'corrupt' && code(inspectImage(webp(400, 300, 'lossy', { trailing: [1, 2] }))) === 'corrupt', 'data after the end of the image (a polyglot) is refused in every format');
ok(code(inspectImage(jpeg(400, 300).subarray(0, 60))) === 'corrupt' && code(inspectImage(png(400, 300).subarray(0, 40))) === 'corrupt' && code(inspectImage(webp(400, 300).subarray(0, 25))) === 'corrupt', 'truncated files are refused');
ok(code(inspectImage(webp(400, 300, 'lossy', { sizeOff: 4 }))) === 'corrupt', 'a RIFF size that does not match the file is refused');
for (const [label, buf] of [['GIF', GIF], ['SVG', SVG], ['HTML', HTML], ['empty', new Uint8Array(0)], ['text', Uint8Array.from(Buffer.from('hello world'))]]) ok(['type', 'corrupt'].includes(code(inspectImage(buf))), `${label} is refused`);
ok(code(inspectImage(png(400, 300), 'image/jpeg')) === 'type' && code(inspectImage(jpeg(400, 300), 'image/webp')) === 'type', 'a file that is not the type it claims is refused');
ok(code(inspectImage(jpeg(400, 300), 'text/html')) === 'type', 'the claimed type must be one of the three');

// ---- size
ok(code(inspectImage(jpeg(199, 400))) === 'dimensions' && code(inspectImage(jpeg(400, 199))) === 'dimensions' && code(inspectImage(png(2001, 400))) === 'dimensions' && code(inspectImage(webp(400, 2001))) === 'dimensions', 'under 200 or over 2000 px on a side is refused');
ok(inspectImage(jpeg(200, 200)).ok && inspectImage(jpeg(2000, 2000)).ok, 'exactly 200 and 2000 px pass');
ok(code(inspectImage(jpeg(400, 300, { fill: LIMITS.maxBytes }))) === 'size', 'more than 1 MB is refused');
ok(inspectImage(jpeg(400, 300, { fill: LIMITS.maxBytes - 700 })).ok, 'just under 1 MB passes');
ok(code(inspectImage(jpeg(400, 300, { fill: LIMITS.maxBytes - 700 }), 'image/jpeg')) === 'ok' && !inspectJpeg(Uint8Array.of(0xFF, 0xD8, 0xFF, 0xD9)).ok && !inspectPng(Uint8Array.of(1, 2, 3)).ok && !inspectWebp(Uint8Array.of(1, 2, 3)).ok, 'tiny or junk input never throws');
// fuzz: random corruption never throws and never passes a file with a byte flipped inside a PNG chunk
let threw = 0, passedCorrupt = 0;
const base = png(400, 300);
for (let i = 0; i < 400; i++) { const c = Uint8Array.from(base); const p = 8 + Math.floor(Math.random() * (c.length - 8)); c[p] ^= 1 << (i % 8); try { if (inspectImage(c).ok) passedCorrupt++; } catch { threw++; } }
ok(threw === 0 && passedCorrupt === 0, `400 bit flips in a PNG: none throws, none passes (${threw}, ${passedCorrupt})`);
let threw2 = 0; for (let i = 0; i < 300; i++) { const src = [jpeg(400, 300), webp(400, 300)][i % 2]; const c = Uint8Array.from(src); c[Math.floor(Math.random() * c.length)] = Math.floor(Math.random() * 256); try { inspectImage(c); } catch { threw2++; } }
ok(threw2 === 0, 'random byte changes in a JPEG or WebP never make the check throw');
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
