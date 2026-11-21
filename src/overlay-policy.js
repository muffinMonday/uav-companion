// The overlay policy for the map screen (Review 01 C03, narrow slice; U-04). Three presentation kinds, and one rule:
// only one primary non-modal contextual overlay (the marker panel or the Sessions explorer) is visible at a time.
// Modal dialogs sit above everything and are not announced here. No scrim, no stack: an owner announces that it opened or closed, and the others react.
export const OVERLAY_KINDS = Object.freeze({ contextual: 'non-modal contextual', dialog: 'modal dialog', fullScreen: 'full-screen view' });

const bus = new EventTarget();
/** owner: 'marker' | 'explorer'; phase: 'open' | 'close'. */
export const announce = (owner, phase) => bus.dispatchEvent(new CustomEvent('overlay', { detail: { owner, phase } }));
/** `fn(owner, phase)` runs for every announcement. Returns the function that stops listening. */
export function onOverlay(fn) {
  const h = (e) => fn(e.detail.owner, e.detail.phase);
  bus.addEventListener('overlay', h);
  return () => bus.removeEventListener('overlay', h);
}
