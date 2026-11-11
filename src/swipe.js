// Swipe to dismiss: a panel follows the finger and, past a short distance or a quick flick, goes the rest of the way and is dismissed.
// Built on touch events (not pointer events): a pointer drag over scrollable content is cancelled by the browser as soon as it starts to scroll, while a touch
// gesture can be taken over with preventDefault, the way the drag-to-reorder does after its hold. Mouse and keyboard are untouched.
//
// onSwipe(el, { direction: 'down' | 'up' | 'left' | 'right', onDismiss, canStart, enabled, follow, distance, flick, ignore })
//   canStart(target)  may a gesture start on this element? (default: yes)
//   enabled()         is the gesture switched on right now? (default: yes)
//   follow            the element that moves with the finger (default: el)
//   distance          pixels that make a dismissal (default 64); flick: pixels per millisecond that also does (default 0.45, and at least 24 px)
//   ignore            a selector for places a swipe never starts: form controls, the trip card flip, sideways scrollers
// A gesture is only taken over once it is clearly along the chosen direction; anything else (a scroll, a swipe the other way, a tap) is left alone.

import { reduced } from './motion.js';

const AXES = { down: ['y', 1], up: ['y', -1], right: ['x', 1], left: ['x', -1] };
export const IGNORE = 'input, select, textarea, [data-no-swipe], .flip-body, .wx-scroll, .leaflet-control';

/** Is every scrollable ancestor of `target`, up to `root`, scrolled to the top (so a downward pull is not a scroll)? */
export function atTop(target, root) {
  for (let n = target; n && n !== root && n.nodeType === 1; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return false;
  }
  return true;
}

export function onSwipe(el, { direction, onDismiss, canStart = () => true, enabled = () => true, follow = el, distance = 64, flick = 0.45, ignore = IGNORE }) {
  const [axis, sign] = AXES[direction];
  const along = (t, g) => sign * ((axis === 'y' ? t.clientY - g.y0 : t.clientX - g.x0));
  const across = (t, g) => Math.abs(axis === 'y' ? t.clientX - g.x0 : t.clientY - g.y0);
  const move = (px) => { follow.style.transform = axis === 'y' ? `translateY(${sign * px}px)` : `translateX(${sign * px}px)`; };
  let g = null;

  const clear = () => { follow.style.transition = ''; follow.style.transform = ''; };
  const snapBack = () => {
    if (g?.taken) { follow.style.transition = 'transform .16s ease-out'; follow.style.transform = ''; setTimeout(() => { follow.style.transition = ''; }, 200); }
    g = null;
  };

  el.addEventListener('touchstart', (e) => {
    g = null;
    if (!enabled() || e.touches.length !== 1 || document.body.classList.contains('reordering')) return;
    const target = e.target;
    if (!(target instanceof Element) || target.closest(ignore) || !canStart(target)) return;
    const t = e.touches[0];
    g = { x0: t.clientX, y0: t.clientY, t0: performance.now(), state: 'maybe', taken: false, last: 0 };
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!g || g.state === 'no') return;
    if (e.touches.length !== 1) { snapBack(); return; }
    const t = e.touches[0];
    const a = along(t, g), c = across(t, g);
    if (g.state === 'maybe') {
      if (Math.abs(a) < 8 && c < 8) return;                // not moved far enough to tell
      if (a > 0 && a > c * 1.2) { g.state = 'swipe'; g.taken = true; } // clearly along the chosen direction: ours
      else { g.state = 'no'; g = null; return; }           // a scroll, the other way, or sideways: leave it alone
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    g.last = Math.max(0, a);
    follow.style.transition = 'none';
    move(g.last > 80 ? 80 + (g.last - 80) * 0.5 : g.last); // a little resistance past the first 80 px
  }, { passive: false });

  const end = (e) => {
    if (!g) return;
    if (g.state !== 'swipe') { g = null; return; }
    const dt = Math.max(1, performance.now() - g.t0);
    const a = g.last, fast = a / dt >= flick && a > 24;
    if (a >= distance || fast) {
      const gone = (axis === 'y' ? follow.offsetHeight : follow.offsetWidth) + 40;
      const finish = () => { clear(); g = null; onDismiss(); };
      if (reduced()) { finish(); return; }
      follow.style.transition = 'transform .14s ease-in';
      follow.style.transform = axis === 'y' ? `translateY(${sign * gone}px)` : `translateX(${sign * gone}px)`;
      g.state = 'done';
      setTimeout(finish, 150);
    } else snapBack();
    e?.stopPropagation?.();
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', () => { if (g && g.state !== 'done') snapBack(); }, { passive: true });
}
