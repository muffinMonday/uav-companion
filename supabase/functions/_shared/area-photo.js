// Community flying areas, optional location photo: the server-side image check (no Deno, no Supabase: Node tests run it, tests/areas-photo-unit.mjs).
// It does NOT decode pixels. It reads the real container structure and refuses anything that is not a plain, single, still JPEG, PNG or WebP of an allowed size and that carries ANY metadata:
//   JPEG  only SOI, DQT, DHT, SOF0/1/2, DRI, SOS (+ its entropy data), RSTn, JFIF APP0 without a thumbnail, Adobe APP14, EOI; nothing after EOI. EXIF, XMP, IPTC, ICC profiles, comments and every other APPn segment are
//         REMOVED by this check (the file is rewritten without them: browsers add an sRGB ICC profile to canvas output, and a client could add anything); the stored bytes are the cleaned ones.
//   PNG   only IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, sBIT, bKGD, pHYs, every chunk CRC checked; no eXIf, tEXt, zTXt, iTXt, iCCP, tIME, acTL (animation) or unknown chunks; nothing after IEND.
//   WebP  RIFF container with VP8 / VP8L (+ VP8X without EXIF, XMP, ICC or animation flags, + ALPH); the RIFF size must match the file exactly; no EXIF, XMP, ICCP, ANIM, ANMF chunks.
// The browser re-encodes every photo through a canvas, which already drops EXIF and GPS; this check is the server not trusting that. A structure that passes is still only as safe as the viewer's image decoder:
// the photo is served with nosniff and a sandboxing CSP and never as HTML.
export const LIMITS = { maxBytes: 1048576, minSide: 200, maxSide: 2000, maxCaption: 120 };
export const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const fail = (code, message) => ({ ok: false, code, message });
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const l32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const l24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const same = (b, i, s) => ascii(b, i, s.length) === s;

function size(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < LIMITS.minSide || h < LIMITS.minSide || w > LIMITS.maxSide || h > LIMITS.maxSide) return fail('dimensions', `The photo must be between ${LIMITS.minSide} and ${LIMITS.maxSide} px on each side.`);
  return null;
}

export function inspectJpeg(b) {
  const n = b.length;
  if (n < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return fail('corrupt', 'Not a JPEG.');
  let i = 2, w = 0, h = 0, sof = false, sos = false;
  const drops = []; // [from, to) ranges of metadata segments to remove
  for (;;) {
    if (i + 1 >= n || b[i] !== 0xFF) return fail('corrupt', 'The JPEG is damaged.');
    while (b[i + 1] === 0xFF) i++;
    const m = b[i + 1];
    if (m === 0xD9) { if (!sof || !sos) return fail('corrupt', 'The JPEG has no image data.'); if (i + 2 !== n) return fail('corrupt', 'The JPEG has extra data after its end.'); break; }
    if (m === 0x00 || m === 0x01 || m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) return fail('corrupt', 'The JPEG is damaged.');
    if (i + 4 > n) return fail('corrupt', 'The JPEG is damaged.');
    const len = u16(b, i + 2), end = i + 2 + len;
    if (len < 2 || end > n) return fail('corrupt', 'The JPEG is damaged.');
    if (m === 0xDB || m === 0xC4 || m === 0xDD) { i = end; continue; }
    if (m === 0xC0 || m === 0xC1 || m === 0xC2) {
      if (len < 8 || sof || b[i + 4] !== 8) return fail('corrupt', 'The JPEG is not a plain 8-bit image.');
      h = u16(b, i + 5); w = u16(b, i + 7); const comps = b[i + 9];
      if (comps !== 1 && comps !== 3) return fail('corrupt', 'The JPEG colour layout is not supported.');
      sof = true; i = end; continue;
    }
    if (m === 0xE0) { // JFIF only, no embedded thumbnail
      if (len < 16 || !same(b, i + 4, 'JFIF\0') || b[i + 16] !== 0 || b[i + 17] !== 0 || len !== 16) return fail('metadata', 'The JPEG carries extra data (thumbnail or non-JFIF header).');
      i = end; continue;
    }
    if (m === 0xEE) { if (!same(b, i + 4, 'Adobe') || len !== 14) return fail('metadata', 'The JPEG carries extra data.'); i = end; continue; }
    if (m === 0xDA) {
      if (!sof) return fail('corrupt', 'The JPEG is damaged.');
      sos = true; let j = end;
      for (; j < n; j++) { if (b[j] !== 0xFF) continue; const x = b[j + 1]; if (x === 0x00 || (x >= 0xD0 && x <= 0xD7)) { j++; continue; } if (x === 0xFF) continue; break; }
      if (j >= n) return fail('corrupt', 'The JPEG is cut short.');
      i = j; continue;
    }
    if ((m >= 0xE1 && m <= 0xEF) || m === 0xFE) { drops.push([i, end]); i = end; continue; } // EXIF, XMP, IPTC, ICC, comments: removed
    return fail('corrupt', 'The JPEG uses a feature that is not supported.');
  }
    const bad = size(w, h); if (bad) return bad;
  let data = null;
  if (drops.length) { const parts = []; let at = 0; for (const [a, z] of drops) { parts.push(b.subarray(at, a)); at = z; } parts.push(b.subarray(at)); data = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of parts) { data.set(x, o); o += x.length; } }
  return { ok: true, mime: 'image/jpeg', ext: 'jpg', width: w, height: h, ...(data ? { data, stripped: drops.length } : {}) };
}

let CRC = null;
function crc32(b, from, to) {
  if (!CRC) { CRC = new Uint32Array(256); for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[k] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = from; i < to; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
const PNG_OK = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs']);
export function inspectPng(b) {
  const n = b.length, SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (n < 33 || SIG.some((v, k) => b[k] !== v)) return fail('corrupt', 'Not a PNG.');
  let i = 8, w = 0, h = 0, first = true, idat = false;
  for (;;) {
    if (i + 12 > n) return fail('corrupt', 'The PNG is cut short.');
    const len = u32(b, i), type = ascii(b, i + 4, 4), end = i + 12 + len;
    if (len > 0x7FFFFFFF || end > n) return fail('corrupt', 'The PNG is damaged.');
    if (crc32(b, i + 4, i + 8 + len) !== u32(b, i + 8 + len)) return fail('corrupt', 'The PNG is damaged.');
    if (first) { if (type !== 'IHDR' || len !== 13) return fail('corrupt', 'The PNG is damaged.'); w = u32(b, i + 8); h = u32(b, i + 12); const bd = b[i + 16], ct = b[i + 17]; if (b[i + 18] !== 0 || b[i + 19] !== 0 || (b[i + 20] !== 0 && b[i + 20] !== 1)) return fail('corrupt', 'The PNG is not supported.'); if (![1, 2, 4, 8, 16].includes(bd) || ![0, 2, 3, 4, 6].includes(ct)) return fail('corrupt', 'The PNG is not supported.'); first = false; i = end; continue; }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return fail('animated', 'Animated images are not accepted.');
    if (!PNG_OK.has(type)) return fail(/^[a-z]/.test(type) ? 'metadata' : 'corrupt', /^[a-z]/.test(type) ? 'The photo carries metadata (text, EXIF, colour profile or similar). Re-save it without.' : 'The PNG uses a feature that is not supported.');
    if (type === 'IDAT') idat = true;
    if (type === 'IEND') { if (len !== 0 || end !== n) return fail('corrupt', 'The PNG has extra data after its end.'); if (!idat) return fail('corrupt', 'The PNG has no image data.'); break; }
    i = end;
  }
  return size(w, h) ?? { ok: true, mime: 'image/png', ext: 'png', width: w, height: h };
}

export function inspectWebp(b) {
  const n = b.length;
  if (n < 30 || !same(b, 0, 'RIFF') || !same(b, 8, 'WEBP')) return fail('corrupt', 'Not a WebP.');
  if (l32(b, 4) + 8 !== n) return fail('corrupt', 'The WebP size does not match the file.');
  let i = 12, w = 0, h = 0, frame = 0, canvas = null, first = true;
  while (i < n) {
    if (i + 8 > n) return fail('corrupt', 'The WebP is cut short.');
    const t = ascii(b, i, 4), len = l32(b, i + 4), data = i + 8, end = data + len + (len & 1);
    if (end > n) return fail('corrupt', 'The WebP is damaged.');
    if (first && !['VP8 ', 'VP8L', 'VP8X'].includes(t)) return fail('corrupt', 'The WebP is not supported.');
    first = false;
    if (t === 'VP8X') {
      if (len !== 10 || canvas) return fail('corrupt', 'The WebP is damaged.');
      const f = b[data];
      if (f & 0x02) return fail('animated', 'Animated images are not accepted.');
      if (f & (0x04 | 0x08 | 0x20)) return fail('metadata', 'The photo carries metadata (EXIF, XMP or a colour profile). Re-save it without.');
      canvas = [l24(b, data + 4) + 1, l24(b, data + 7) + 1];
    } else if (t === 'VP8 ') {
      if (frame || len < 10 || b[data + 3] !== 0x9D || b[data + 4] !== 0x01 || b[data + 5] !== 0x2A) return fail('corrupt', 'The WebP is damaged.');
      w = (b[data + 6] | (b[data + 7] << 8)) & 0x3FFF; h = (b[data + 8] | (b[data + 9] << 8)) & 0x3FFF; frame++;
    } else if (t === 'VP8L') {
      if (frame || len < 5 || b[data] !== 0x2F) return fail('corrupt', 'The WebP is damaged.');
      const bits = l32(b, data + 1); w = (bits & 0x3FFF) + 1; h = ((bits >>> 14) & 0x3FFF) + 1; frame++;
    } else if (t === 'ALPH') { /* alpha plane of a lossy image */ }
    else if (t === 'EXIF' || t === 'XMP ' || t === 'ICCP') return fail('metadata', 'The photo carries metadata (EXIF, XMP or a colour profile). Re-save it without.');
    else if (t === 'ANIM' || t === 'ANMF') return fail('animated', 'Animated images are not accepted.');
    else return fail('corrupt', 'The WebP contains an unknown part.');
    i = end;
  }
  if (frame !== 1) return fail('corrupt', 'The WebP has no image data.');
  if (canvas && (canvas[0] !== w || canvas[1] !== h)) return fail('corrupt', 'The WebP is damaged.');
  return size(w, h) ?? { ok: true, mime: 'image/webp', ext: 'webp', width: w, height: h };
}

/** The real type comes from the bytes; `claimed` (the Content-Type) must agree. -> { ok, mime, ext, width, height, data?, stripped? } | { ok: false, code, message }. `data` (JPEG only) is the file without its metadata segments: store THAT. */
export function inspectImage(bytes, claimed = null) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return fail('corrupt', 'The file is empty.');
  if (bytes.length > LIMITS.maxBytes) return fail('size', 'The photo is larger than 1 MB after processing.');
  let r;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) r = inspectJpeg(bytes);
  else if (bytes[0] === 0x89 && bytes[1] === 0x50) r = inspectPng(bytes);
  else if (bytes.length > 12 && same(bytes, 0, 'RIFF') && same(bytes, 8, 'WEBP')) r = inspectWebp(bytes);
  else return fail('type', 'Only JPEG, PNG and WebP photos are accepted.');
  if (r.ok && claimed && claimed !== r.mime) return fail('type', 'The file is not the type it says it is.');
  return r;
}
