// Small helpers for the animations that need JavaScript: leaving (an element stays until its exit animation has played) and gliding a height.
// Everything here does nothing for visitors who asked for reduced motion: the change just happens.
export const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const EASE = 'cubic-bezier(.2,.7,.2,1)';

/** Plays the CSS animation that class `cls` starts on `el`, then calls `done` (at once with reduced motion; never later than 400 ms). */
export function animateOut(el, cls, done) {
  if (reduced() || el.classList.contains(cls)) { if (!el.classList.contains(cls)) done(); return; }
  el.classList.add(cls);
  let over = false;
  const end = () => { if (over) return; over = true; el.classList.remove(cls); done(); };
  el.addEventListener('animationend', end, { once: true });
  setTimeout(end, 400);
}

/** Animates an element's height from one value to another, then calls `done`. The element's own layout takes over afterwards. */
export function glide(el, from, to, done) {
  const a = el.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 240, easing: EASE, fill: 'forwards' });
  a.onfinish = () => { done?.(); a.cancel(); };
}
