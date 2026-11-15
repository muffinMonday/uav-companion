// The mascot: a decorative picture (alt is empty, never focusable) that welcomes, orients and explains empty states. It is never a control and
// never carries information: the text beside it says everything. Derived 256 px images in src/assets/mascots (made by scripts/make-mascots.mjs
// from the originals in public/mascots); Vite hashes the files and keeps the paths right under any base. Add a pose here only when a screen uses it.
const POSES = {
  waving: new URL('./assets/mascots/waving.webp', import.meta.url).href,
  thinking: new URL('./assets/mascots/thinking.webp', import.meta.url).href,
};

/** The mascot as an <img class="mascot mascot-POSE">. Its displayed size is set in CSS per place; `size` only gives the intrinsic box so nothing jumps. */
export function mascotEl(pose, size = 64) {
  const img = document.createElement('img');
  img.className = 'mascot mascot-' + pose;
  img.src = POSES[pose]; img.alt = ''; img.width = size; img.height = size;
  img.decoding = 'async'; img.draggable = false; img.setAttribute('aria-hidden', 'true');
  return img;
}
export const MASCOT_POSES = Object.keys(POSES);
