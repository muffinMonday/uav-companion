// The new shell's responsive tier resolver (src/shell/tier.js, Review 01 S10.2, NAV-01/NAV-09, G1 spec 28.1). Pure functions; no browser.
import { tierOf, isShort, navPlacement, railLabelsShown, touchTarget, canShowTwoPane, watchTier } from '../src/shell/tier.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };

// tierOf: width bands, and the Tier 3 hover/pointer split (U-16)
ok(tierOf({ width: 344, coarse: true, hover: false }) === 'compact', 'folded phone: compact');
ok(tierOf({ width: 600, coarse: true, hover: false }) === 'compact', '600px is still compact (the boundary is inclusive)');
ok(tierOf({ width: 601, coarse: true, hover: false }) === 'expandedTouch', '601px starts expandedTouch');
ok(tierOf({ width: 884, coarse: true, hover: false }) === 'expandedTouch', 'unfolded foldable: expandedTouch');
ok(tierOf({ width: 900, coarse: true, hover: false }) === 'expandedTouch', '900px is still expandedTouch');
ok(tierOf({ width: 901, coarse: true, hover: false }) === 'tabletTouch', 'U-16: a touch-only device (coarse, no hover) at 901px gets the compact rail (tabletTouch)');
ok(tierOf({ width: 1000, coarse: true, hover: false }) === 'tabletTouch', 'touch-only tablet stays tabletTouch through the band');
ok(tierOf({ width: 950, coarse: true, hover: true }) === 'tabletHover', 'U-16: a touch-capable device that ALSO has hover (a hybrid laptop) gets the labeled rail, not the compact one');
ok(tierOf({ width: 950, coarse: false, hover: true }) === 'tabletHover', 'a mouse/trackpad device in the same width band gets the labeled rail');
ok(tierOf({ width: 1200, coarse: true, hover: false }) === 'tabletTouch', '1200px is still the tablet band');
ok(tierOf({ width: 1201, coarse: false, hover: true }) === 'desktop', '1201px is desktop');
ok(tierOf({ width: 1600, coarse: true, hover: true }) === 'desktop', 'a touchscreen laptop above 1200px is still desktop (sizing, not placement, follows pointer there)');

// isShort: the short/landscape collapse rule
ok(isShort('compact', 420) === true && isShort('compact', 421) === false, 'compact: short at 420px height, not above');
ok(isShort('expandedTouch', 400) === true, 'expandedTouch uses the same short-height rule as compact');
ok(isShort('tabletTouch', 500) === true && isShort('tabletTouch', 501) === false, 'tabletTouch: short at 500px height (a tablet split-screen), not above');
ok(isShort('tabletHover', 300) === false && isShort('desktop', 300) === false, 'tabletHover and desktop have no short-height collapse');

// navPlacement / railLabelsShown
ok(navPlacement('compact') === 'bottom' && navPlacement('expandedTouch') === 'bottom', 'Tier 1/2 use the bottom bar');
ok(navPlacement('tabletTouch') === 'rail' && navPlacement('tabletHover') === 'rail' && navPlacement('desktop') === 'rail', 'Tier 3/4 use a rail');
ok(railLabelsShown('tabletTouch') === false, 'U-16: the compact touch-only rail never shows text labels');
ok(railLabelsShown('tabletHover') === true, 'the labeled rail (hybrid tablet) shows text labels');
ok(railLabelsShown('desktop') === false, 'production hotfix (Issue 1): the desktop rail is icon-only too now - a full-width labeled rail crowded the map search/Leaflet controls, see nav.js\'s --shell-nav-rail-w');

// touchTarget: 44px wherever a coarse pointer is detected, independent of tier (the cross-cutting rule; U-16 makes it explicit for tabletTouch)
ok(touchTarget(true) === 44, 'a coarse pointer always gets a 44px minimum target');
ok(touchTarget(false) === 40, 'a fine pointer gets the existing 40px target');

// canShowTwoPane: Tier 1 never splits; Tier 2+ splits only when free-area has enough room (MD-06's "room, not device" rule, reused)
ok(canShowTwoPane('compact', { freeWidth: 2000 }) === false, 'Tier 1 (compact) is always single-pane, regardless of free width');
ok(canShowTwoPane('expandedTouch', { freeWidth: 560 }) === true && canShowTwoPane('expandedTouch', { freeWidth: 559 }) === false, 'Tier 2 splits only with >=560px of free width');
ok(canShowTwoPane('desktop', { freeWidth: 1000 }) === true, 'Tier 4 splits with ample free width');

// watchTier: a fake window (matchMedia + resize/change listeners), confirming it fires once at start and again only when the computed state actually changes
{
  const listeners = { resize: [] };
  const mq = (matches) => { const m = { matches, listeners: [] }; m.addEventListener = (ev, fn) => m.listeners.push(fn); m.removeEventListener = (ev, fn) => { m.listeners = m.listeners.filter((f) => f !== fn); }; m.fire = () => m.listeners.forEach((f) => f()); return m; };
  const coarseMq = mq(true), hoverMq = mq(false);
  const win = {
    innerWidth: 1000, innerHeight: 800,
    matchMedia: (q) => (q.includes('pointer') ? coarseMq : hoverMq),
    addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
  };
  const seen = [];
  const stop = watchTier((s) => seen.push(s), { win });
  ok(seen.length === 1 && seen[0].tier === 'tabletTouch', 'fires once immediately with the initial computed state');
  win.innerWidth = 1000; listeners.resize.forEach((f) => f()); // no change: width/coarse/hover/short all the same
  ok(seen.length === 1, 'a resize that does not change the computed tier/short/coarse key fires nothing more');
  win.innerWidth = 1400; listeners.resize.forEach((f) => f());
  ok(seen.length === 2 && seen[1].tier === 'desktop', 'a resize that crosses a tier boundary fires again with the new tier');
  stop();
  win.innerWidth = 300; listeners.resize.forEach((f) => f());
  ok(seen.length === 2, 'after stop() no further callbacks fire');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
