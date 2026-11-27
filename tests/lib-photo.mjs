// Synthetic, structurally valid JPEG / PNG / WebP files for the photo tests (the validator reads structure, not pixels), and variants that each carry one kind of metadata or defect.
import zlib from 'node:zlib';

const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const asc = (s) => [...s].map((c) => c.charCodeAt(0));
const cat = (...p) => Uint8Array.from(p.flat());

let T = null;
export function crc32(bytes) {
  if (!T) { T = new Uint32Array(256); for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[k] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (const b of bytes) c = T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}

/** opts: app1 (EXIF segment), comment, xmp, thumbnail, trailing (bytes after EOI), noJfif, progressive, fill (extra entropy bytes to reach a size) */
export function jpeg(w = 400, h = 300, o = {}) {
  const seg = (m, data) => [0xFF, m, ...be16(data.length + 2), ...data];
  const parts = [[0xFF, 0xD8]];
  if (!o.noJfif) parts.push(seg(0xE0, [...asc('JFIF'), 0, 1, 1, 0, ...be16(1), ...be16(1), o.thumbnail ? 2 : 0, o.thumbnail ? 2 : 0, ...(o.thumbnail ? [1, 2, 3, 4, 5, 6] : [])]));
  if (o.app1) parts.push(seg(0xE1, [...asc('Exif'), 0, 0, 0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0]));
  if (o.xmp) parts.push(seg(0xE1, [...asc('http://ns.adobe.com/xap/1.0/'), 0, ...asc('<x:xmpmeta/>')]));
  if (o.iptc) parts.push(seg(0xED, [...asc('Photoshop 3.0'), 0]));
  if (o.icc) parts.push(seg(0xE2, [...asc('ICC_PROFILE'), 0, 1, 1, 0, 0]));
  if (o.comment) parts.push(seg(0xFE, asc('hello')));
  parts.push(seg(0xDB, [0, ...Array(64).fill(8)]));
  parts.push(seg(o.progressive ? 0xC2 : 0xC0, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0]));
  parts.push(seg(0xC4, [0, 1, ...Array(15).fill(0), 1]));
  parts.push(seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3F, 0]));
  parts.push([0x12, 0x34, 0xFF, 0x00, 0x56, ...Array(o.fill ?? 0).fill(0x11)]);
  parts.push([0xFF, 0xD9]);
  if (o.trailing) parts.push(o.trailing);
  return cat(...parts);
}

/** opts: chunks (extra [type, bytes] inserted before IDAT), badCrc, trailing, noIdat, animated */
export function png(w = 400, h = 300, o = {}) {
  const chunk = (type, data, bad = false) => { const body = [...asc(type), ...data]; return [...be32(data.length), ...body, ...be32(bad ? 0 : crc32(Uint8Array.from(body)))]; };
  const raw = Buffer.alloc((w + 1) * h);
  const parts = [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], chunk('IHDR', [...be32(w), ...be32(h), 8, 0, 0, 0, 0], o.badCrc)];
  for (const [t, d] of o.chunks ?? []) parts.push(chunk(t, d));
  if (o.animated) parts.push(chunk('acTL', [...be32(2), ...be32(0)]));
  if (!o.noIdat) parts.push(chunk('IDAT', [...zlib.deflateSync(raw)]));
  parts.push(chunk('IEND', []));
  if (o.trailing) parts.push(o.trailing);
  return cat(...parts);
}

/** kind: 'lossy' | 'lossless'; opts: vp8x flags (number), exif, xmp, iccp, anim, trailing, sizeOff (RIFF size error) */
export function webp(w = 400, h = 300, kind = 'lossy', o = {}) {
  const chunk = (t, data) => [...asc(t), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  const frame = kind === 'lossy'
    ? chunk('VP8 ', [0x10, 0x00, 0x00, 0x9D, 0x01, 0x2A, ...[w & 255, (w >> 8) & 0x3F], ...[h & 255, (h >> 8) & 0x3F], ...Array(20).fill(7)])
    : chunk('VP8L', [0x2F, ...le32((w - 1) | ((h - 1) << 14)), ...Array(20).fill(7)]);
  const body = [...asc('WEBP')];
  if (o.vp8x !== undefined) body.push(...chunk('VP8X', [o.vp8x, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
  if (o.exif) body.push(...chunk('EXIF', asc('Exif\0\0MM')));
  if (o.xmp) body.push(...chunk('XMP ', asc('<x:xmpmeta/>')));
  if (o.iccp) body.push(...chunk('ICCP', [1, 2, 3, 4]));
  if (o.anim) body.push(...chunk('ANIM', [0, 0, 0, 0, 0, 0]));
  body.push(...frame);
  const out = [...asc('RIFF'), ...le32(body.length + (o.sizeOff ?? 0)), ...body, ...(o.trailing ?? [])];
  return cat(out);
}

export const GIF = cat(asc('GIF89a'), [1, 0, 1, 0, 0, 0, 0], [0x3B]);
export const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><script>alert(1)</script></svg>'));
export const HTML = Uint8Array.from(Buffer.from('<!doctype html><script>alert(1)</script>'));
