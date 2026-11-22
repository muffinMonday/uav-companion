// The responsive tier of the new four-destination shell (Review 01 S10.2, NAV-01/NAV-09, G1 spec section 28.1). Three independent
// signals (width, height, pointer/hover capability), not device category. Legacy components (Map Configs, POI panel, Privacy panel,
// the current dock) are untouched and keep DESIGN.md section 9's breakpoints until each is individually migrated; nothing here
// changes those. `tierOf` takes plain values so it is testable without a browser, mirroring free-area.js's pure-function style.

/** @returns {'compact'|'expandedTouch'|'tabletTouch'|'tabletHover'|'desktop'} */
export function tierOf({ width, coarse, hover }) {
  if (width <= 600) return 'compact';
  if (width <= 900) return 'expandedTouch';
  if (width <= 1200) return coarse && !hover ? 'tabletTouch' : 'tabletHover'; // U-16: touch-only (no hover) gets the compact rail; anything else in this band gets the labeled one
  return 'desktop';
}

/** Whether the nav should collapse to icon-only for lack of height (phone landscape; a tablet split-screen for tabletTouch). */
export const isShort = (tier, height) => (tier === 'compact' || tier === 'expandedTouch') ? height <= 420 : (tier === 'tabletTouch' && height <= 500);

/** 'bottom' | 'rail'. */
export const navPlacement = (tier) => (tier === 'compact' || tier === 'expandedTouch') ? 'bottom' : 'rail';

/** Whether the rail shows text labels (the compact touch-only rail at tabletTouch never does; the cross-cutting rule is icon-only + 44px there). */
export const railLabelsShown = (tier) => tier === 'tabletHover' || tier === 'desktop';

/** Minimum touch target in px: 44 wherever a coarse pointer is detected, independent of tier (the cross-cutting rule; U-16 makes it explicit and non-optional for tabletTouch). */
export const touchTarget = (coarse) => (coarse ? 44 : 40);

/** Whether a destination with a natural list+detail split may show both panes (Tier 2/3 "room, not device" rule, reusing the same idea as MD-06):
 * true only when free-area has enough width left after the nav chrome for a sensible detail pane. `navWidth`/`navHeight` describe the nav bar/rail's own box. */
export function canShowTwoPane(tier, { freeWidth }) {
  if (tier === 'compact') return false;
  return freeWidth >= 560; // enough for a list column (~240px) plus a usable detail pane
}

/**
 * Watches width/height/pointer/hover and calls `onChange({ tier, short, coarse })` whenever the computed state changes.
 * Returns a function that stops watching. `win` is injectable for tests (mirrors free-area.js's DOM-free testability where it can be).
 */
export function watchTier(onChange, { win = window } = {}) {
  const coarseQuery = win.matchMedia('(pointer: coarse)');
  const hoverQuery = win.matchMedia('(any-hover: hover)');
  let last = null;
  function check() {
    const width = win.innerWidth, height = win.innerHeight, coarse = coarseQuery.matches, hover = hoverQuery.matches;
    const tier = tierOf({ width, coarse, hover });
    const short = isShort(tier, height);
    const key = `${tier}|${short}|${coarse}`;
    if (key === last) return;
    last = key;
    onChange({ tier, short, coarse });
  }
  win.addEventListener('resize', check);
  coarseQuery.addEventListener('change', check);
  hoverQuery.addEventListener('change', check);
  check();
  return () => {
    win.removeEventListener('resize', check);
    coarseQuery.removeEventListener('change', check);
    hoverQuery.removeEventListener('change', check);
  };
}
