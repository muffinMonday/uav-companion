// Community flying areas, optional location photo (client side): choosing, resizing and re-encoding a photo in the browser, the limits, and the accessible text.
// The original (up to 5 MB, JPEG, PNG or WebP) never leaves the device: it is decoded, scaled so its longest edge is about 1600 px, drawn on a canvas and re-encoded as JPEG (a canvas
// carries no EXIF, GPS, device or time data) at the highest quality that stays under 1 MB. The server checks the result again (supabase/functions/_shared/area-photo.js).
export const PHOTO = { maxOriginal: 5 * 1024 * 1024, maxEdge: 1600, maxBytes: 1000000, minSide: 200, maxCaption: 120, types: ['image/jpeg', 'image/png', 'image/webp'] };
export const PHOTO_WARNING = 'Show the place, not people. Do not include faces, vehicle number plates, the inside of private property or personal details. A photo is not proof that you may enter or fly there.';

/** The size after scaling the longest edge down to `max` (never up). */
export function fitSize(w, h, max = PHOTO.maxEdge) {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** The text for the image: the caption when there is one, else a plain description (never empty). */
export const photoAlt = (areaName, caption) => (caption && caption.trim() ? caption.trim() : `Photo of ${areaName || 'this flying area'}, added by a contributor (no description given)`);

/** Why a file cannot be used before any work is done, or null. */
export function checkFile(file) {
  if (!file || typeof file.size !== 'number') return 'Choose a photo.';
  if (!PHOTO.types.includes(file.type)) return 'Only JPEG, PNG and WebP photos can be used.';
  if (file.size > PHOTO.maxOriginal) return 'That photo is larger than 5 MB. Choose a smaller one.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

/**
 * @param {File|Blob} file
 * @returns {Promise<{ ok: true, blob: Blob, mime: string, width: number, height: number, bytes: number } | { ok: false, message: string }>}
 */
export async function prepareImage(file) {
  const why = checkFile(file);
  if (why) return { ok: false, message: why };
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { try { bmp = await createImageBitmap(file); } catch { return { ok: false, message: 'That photo could not be read. Try another one.' }; } }
  try {
    let { width, height } = fitSize(bmp.width, bmp.height);
    if (Math.min(width, height) < PHOTO.minSide) return { ok: false, message: `That photo is too small (at least ${PHOTO.minSide} px on each side).` };
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) return { ok: false, message: 'This browser cannot process photos.' };
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bmp, 0, 0, width, height);
      for (const q of [0.86, 0.76, 0.66, 0.56]) {
        const blob = await toBlob(canvas, q);
        if (!blob) return { ok: false, message: 'This browser cannot process photos.' };
        if (blob.size <= PHOTO.maxBytes) return { ok: true, blob, mime: 'image/jpeg', width, height, bytes: blob.size };
      }
      width = Math.round(width * 0.85); height = Math.round(height * 0.85);
      if (Math.min(width, height) < PHOTO.minSide) break;
    }
    return { ok: false, message: 'That photo could not be made small enough. Try another one.' };
  } finally { bmp.close?.(); }
}
