// Swipe to dismiss: a panel follows the finger and, past a short distance or a quick flick, goes the rest of the way and is dismissed.
// Built on touch events (not pointer events): a pointer drag over scrollable content is cancelled by the browser as soon as it starts to scroll, while a touch
// gesture can be taken over with preventDefault, the way the drag-to-reorder does after its hold. Mouse and keyboard are untouched.
//
// onSwipe(el, { direction: 'down' | 'up' | 'left' | 'right', onDismiss, canStart, enabled, follow, distance, flick, ignore })
//   canStart(target)  may a gesture start on this element? (default: yes)
//   enabled()         is the gesture switched on right now? (default: yes)
//   follow            the element that moves with the finger (default: el); or a function returning it, or a list of elements (resolved when used)
//   css               the CSS property that carries the movement: 'transform' (default) or 'translate' (for an element that already has a transform)
//   fade              the followed elements also fade with the drag (opacity 1 to 0 over the distance they travel), and fade out on a dismissal
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

export function onSwipe(el, { direction, onDismiss, canStart = () => true, enabled = () => true, follow = el, css = 'transform', fade = false, distance = 64, flick = 0.45, ignore = IGNORE }) {
  const [axis, sign] = AXES[direction];
  const along = (t, g) => sign * ((axis === 'y' ? t.clientY - g.y0 : t.clientX - g.x0));
  const across = (t, g) => Math.abs(axis === 'y' ? t.clientX - g.x0 : t.clientY - g.y0);
  const targets = () => { const f = typeof follow === 'function' ? follow() : follow; return Array.isArray(f) ? f : [f]; };
  const gone = () => { const first = targets()[0]; return (axis === 'y' ? first.offsetHeight : first.offsetWidth) + 40; }; // how far it has to travel to be off screen
  const offset = (px, opacity = 1) => { // px is signed along the axis: every target moves together
    for (const t of targets()) {
      if (css === 'translate') t.style.translate = axis === 'y' ? `0 ${px}px` : `${px}px 0`;
      else t.style.transform = axis === 'y' ? `translateY(${px}px)` : `translateX(${px}px)`;
      if (fade) t.style.opacity = String(opacity);
    }
  };
  const move = (px) => offset(sign * px, fade ? Math.max(0, 1 - px / Math.max(1, gone())) : 1); // with fade, it gets fainter as it goes
  const setTransition = (v) => { for (const t of targets()) t.style.transition = v; };
  const ease = (dur, timing) => [css, ...(fade ? ['opacity'] : [])].map((p) => `${p} ${dur} ${timing}`).join(', ');
  let g = null;

  const clear = () => { for (const t of targets()) { t.style.transition = ''; t.style[css] = ''; if (fade) t.style.opacity = ''; } };
  const snapBack = () => {
    if (g?.taken) { setTransition(ease('.16s', 'ease-out')); for (const t of targets()) { t.style[css] = ''; if (fade) t.style.opacity = ''; } setTimeout(() => setTransition(''), 200); }
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
    setTransition('none');
    move(g.last > 80 ? 80 + (g.last - 80) * 0.5 : g.last); // a little resistance past the first 80 px
  }, { passive: false });

  const end = (e) => {
    if (!g) return;
    if (g.state !== 'swipe') { g = null; return; }
    const dt = Math.max(1, performance.now() - g.t0);
    const a = g.last, fast = a / dt >= flick && a > 24;
    if (a >= distance || fast) {
      // A faded pane is not cleared: its popup is removed with it, and Leaflet keeps the popup's container for a moment while it fades out,
      // so clearing here would bring the pane back to the middle while it is still on screen.
      const finish = () => { g = null; if (fade) onDismiss(); else { clear(); onDismiss(); } };
      if (reduced()) { finish(); return; }
      setTransition(ease('.14s', 'ease-in'));
      offset(sign * gone(), 0);
      g.state = 'done';
      setTimeout(finish, 150);
    } else snapBack();
    e?.stopPropagation?.();
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', () => { if (g && g.state !== 'done') snapBack(); }, { passive: true });
}

/**
 * A map popup window (root is its content): a swipe left or right anywhere on it, or up or down from its border, closes it.
 * borders(target, root) says which places count as the border.
 * The whole pane moves: the bubble, its tip and its close button, which are the children of the Leaflet popup container. They move with the CSS `translate`
 * property, because Leaflet positions the container with `transform`, and the map's rotation may set `translate` on it.
 */
export function onPopupSwipe(root, { close, enabled = () => true, borders }) {
  const pane = () => { const pop = root.closest('.leaflet-popup'); return pop ? [...pop.children] : [root]; };
  const opts = { enabled, follow: pane, css: 'translate', fade: true, onDismiss: close };
  for (const direction of ['left', 'right']) onSwipe(root, { ...opts, direction });
  for (const direction of ['up', 'down']) onSwipe(root, { ...opts, direction, canStart: (t) => borders(t, root) });
}
