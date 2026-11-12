// The preset avatars and interest tags of a profile. The keys are the fixed lists of the database (supabase/migrations/20261112110000_profile.sql:
// profile_avatars() and profile_interests()); keep them in step (tests/db-profile-unit.mjs checks it). No upload, no Storage: a picture is a few shapes
// drawn here, white on a disc whose colour comes from the key, so it looks the same everywhere.
// The lists are data and safe to import in Node; `avatarEl` builds the picture and needs the page.

// Shapes: ['c', cx, cy, r] circle, ['r', x, y, w, h, rx] rect, ['p', d] path. All stroked, none filled, in a 24 x 24 box.
const prop = (x, y, r) => ['c', x, y, r];
const X = (a, b) => ['p', `M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}`];
const rays = (cx, cy, r1, r2, n) => ['p', Array.from({ length: n }, (_, i) => { const t = (i / n) * 2 * Math.PI; return `M${(cx + r1 * Math.cos(t)).toFixed(1)} ${(cy + r1 * Math.sin(t)).toFixed(1)}L${(cx + r2 * Math.cos(t)).toFixed(1)} ${(cy + r2 * Math.sin(t)).toFixed(1)}`; }).join('')];
const hex = (r) => Array.from({ length: 6 }, (_, i) => { const t = (i / 6) * 2 * Math.PI; return prop(+(12 + r * Math.cos(t)).toFixed(1), +(12 + r * Math.sin(t)).toFixed(1), 2.6); });

export const AVATARS = [
  // FPV platforms
  { key: 'fpv-5in', label: '5-inch freestyle quad', shapes: [X(6, 18), prop(5.5, 5.5, 3.6), prop(18.5, 5.5, 3.6), prop(5.5, 18.5, 3.6), prop(18.5, 18.5, 3.6), ['r', 9.5, 10.5, 5, 3, 1]] },
  { key: 'fpv-7in', label: '7-inch long-range quad', shapes: [X(6, 18), prop(5, 5, 4.4), prop(19, 5, 4.4), prop(5, 19, 4.4), prop(19, 19, 4.4), ['r', 10, 10.5, 4, 3, 1], ['p', 'M12 13.5V17']] },
  { key: 'fpv-cinewhoop', label: 'Cinewhoop (ducted)', shapes: [prop(6.5, 6.5, 4.2), prop(17.5, 6.5, 4.2), prop(6.5, 17.5, 4.2), prop(17.5, 17.5, 4.2), prop(6.5, 6.5, 2), prop(17.5, 6.5, 2), prop(6.5, 17.5, 2), prop(17.5, 17.5, 2), ['r', 9.5, 10.5, 5, 3, 1]] },
  { key: 'fpv-tinywhoop', label: 'Tiny whoop', shapes: [prop(7.5, 7.5, 3), prop(16.5, 7.5, 3), prop(7.5, 16.5, 3), prop(16.5, 16.5, 3), ['r', 9.8, 10, 4.4, 4, 1.2]] },
  { key: 'fpv-toothpick', label: 'Toothpick', shapes: [['p', 'M6 12H18M6 12L4.5 8.5M18 12L19.5 8.5M6 12L4.5 15.5M18 12L19.5 15.5'], prop(4, 7, 2.2), prop(20, 7, 2.2), prop(4, 17, 2.2), prop(20, 17, 2.2), ['r', 9.5, 10.8, 5, 2.4, 1.1]] },
  { key: 'fpv-racer', label: 'Race quad', shapes: [X(6.5, 17.5), prop(5, 6, 3), prop(19, 6, 3), prop(5, 18, 3), prop(19, 18, 3), ['p', 'M12 8.5L15.5 12L12 15.5L8.5 12Z']] },
  { key: 'fpv-wing', label: 'FPV wing', shapes: [['p', 'M12 4L21 19L12 16L3 19Z'], ['p', 'M12 4V16']] },
  // photography drones
  { key: 'photo-folding', label: 'Folding camera drone', shapes: [['p', 'M7 7L17 17M17 7L7 17'], prop(6, 6, 3), prop(18, 6, 3), prop(6, 18, 3), prop(18, 18, 3), ['r', 9, 9, 6, 6, 2], prop(12, 16.5, 1.4)] },
  { key: 'photo-pro', label: 'Cinema drone with gimbal', shapes: [['p', 'M7 7L17 17M17 7L7 17'], prop(5.5, 5.5, 3.5), prop(18.5, 5.5, 3.5), prop(5.5, 14.5, 3.5), prop(18.5, 14.5, 3.5), ['r', 8.5, 8.5, 7, 5, 1.5], ['p', 'M7 20H17M9 14L7.5 20M15 14L16.5 20'], prop(12, 11, 1.6)] },
  { key: 'photo-mini', label: 'Mini camera drone', shapes: [['p', 'M8 8L16 16M16 8L8 16'], prop(7, 7, 2.6), prop(17, 7, 2.6), prop(7, 17, 2.6), prop(17, 17, 2.6), ['r', 9.8, 9.8, 4.4, 4.4, 1.5], prop(12, 12, 1)] },
  { key: 'photo-hex', label: 'Hexacopter', shapes: [['p', 'M12 12L20 12M12 12L16 5M12 12L8 5M12 12L4 12M12 12L8 19M12 12L16 19'], ...hex(8), prop(12, 12, 2.4)] },
  // travel
  { key: 'travel-compass', label: 'Compass', shapes: [prop(12, 12, 8.5), ['p', 'M15.5 8.5L13.5 13.5L8.5 15.5L10.5 10.5Z']] },
  { key: 'travel-mountain', label: 'Mountain', shapes: [['p', 'M3 19L10 7L14 13L16 10L21 19Z']] },
  { key: 'travel-camera', label: 'Camera', shapes: [['r', 3.5, 8, 17, 11, 2], prop(12, 13.5, 3), ['p', 'M9 8L10.5 5.5H13.5L15 8']] },
  { key: 'travel-tent', label: 'Tent', shapes: [['p', 'M3 19L12 5L21 19Z'], ['p', 'M9.5 19L12 14L14.5 19']] },
  { key: 'travel-pin', label: 'Map pin', shapes: [['p', 'M12 21S6 15.6 6 11a6 6 0 0 1 12 0c0 4.6-6 10-6 10Z'], prop(12, 11, 2.2)] },
  { key: 'travel-sun', label: 'Sun', shapes: [prop(12, 12, 4), rays(12, 12, 6.8, 9.5, 8)] },
  { key: 'travel-wave', label: 'Wave', shapes: [['p', 'M3 10C6 7 9 13 12 10S18 13 21 10'], ['p', 'M3 15C6 12 9 18 12 15S18 18 21 15']] },
  { key: 'travel-leaf', label: 'Leaf', shapes: [['p', 'M5 19C5 10 11 5 20 5C20 14 15 20 6 19Z'], ['p', 'M5 19L13 11']] },
  { key: 'travel-plane', label: 'Paper plane', shapes: [['p', 'M21 3L3 10L10 14L14 21Z'], ['p', 'M21 3L10 14']] },
];

export const INTERESTS = [
  { key: 'drone-photography', label: 'Drone photography' }, { key: 'hiking', label: 'Hiking' }, { key: 'city-trips', label: 'City trips' }, { key: 'beaches', label: 'Beaches' },
  { key: 'mountains', label: 'Mountains' }, { key: 'food', label: 'Food' }, { key: 'history', label: 'History' }, { key: 'wildlife', label: 'Wildlife' },
  { key: 'road-trips', label: 'Road trips' }, { key: 'night-sky', label: 'Night sky' }, { key: 'cycling', label: 'Cycling' }, { key: 'camping', label: 'Camping' },
  { key: 'fpv-freestyle', label: 'FPV freestyle' }, { key: 'fpv-racing', label: 'FPV racing' }, { key: 'fpv-cinematic', label: 'FPV cinematic' },
  { key: 'fpv-long-range', label: 'FPV long range' }, { key: 'fpv-bando', label: 'FPV bando' }, { key: 'fpv-micro', label: 'FPV micro and indoor' },
];
export const MAX_INTERESTS = 5, MAX_BIO = 160, MAX_LOCATION = 60;

export const avatarLabel = (key) => AVATARS.find((a) => a.key === key)?.label ?? '';
export const interestLabel = (key) => INTERESTS.find((t) => t.key === key)?.label ?? key;
/** The disc colour for a key (dark enough for white lines). */
export const avatarColor = (key) => { const i = AVATARS.findIndex((a) => a.key === key); return i < 0 ? null : `hsl(${(i * 47) % 360} 52% 36%)`; };

const NS = 'http://www.w3.org/2000/svg';
/**
 * A round avatar: the preset picture, or the first letter of `name` when there is none (or the key is not in the list).
 * `size` is in px. The picture is decorative; the caller names the person next to it.
 */
export function avatarEl(key, name = '', size = 26) {
  const a = AVATARS.find((x) => x.key === key);
  const s = document.createElement('span');
  s.className = 'avatar'; s.style.width = s.style.height = size + 'px'; s.style.fontSize = Math.round(size * 0.5) + 'px';
  if (!a) { s.textContent = (String(name).trim()[0] || '?').toUpperCase(); return s; }
  s.dataset.avatar = key; s.style.background = avatarColor(key);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const [t, ...v] of a.shapes) {
    let e;
    if (t === 'c') { e = document.createElementNS(NS, 'circle'); e.setAttribute('cx', v[0]); e.setAttribute('cy', v[1]); e.setAttribute('r', v[2]); }
    else if (t === 'r') { e = document.createElementNS(NS, 'rect'); ['x', 'y', 'width', 'height', 'rx'].forEach((n, i) => e.setAttribute(n, v[i])); }
    else { e = document.createElementNS(NS, 'path'); e.setAttribute('d', v[0]); }
    svg.append(e);
  }
  s.append(svg);
  return s;
}
