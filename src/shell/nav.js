// The new four-destination shell navigation (Review 01 S10.2, NAV-01 to NAV-09; G1 spec section 28). Behind VITE_NEW_SHELL (default off,
// the production build has none of this): with the flag off `initShellNav` is a constant no-op and everything it imports is tree-shaken
// out of the bundle, the same build-flag-gated-constant pattern already used elsewhere in this app for another experimental feature.
//
// Scope (NAV-01 to NAV-09 only, per the approved S10.2 authorization): the chrome and its adapters. Destination *content* (Map/Trips/
// Explore/Profile redesign) is S10.3 to S10.6 and is explicitly out of scope here. Each destination below is a temporary adapter onto
// the existing, unchanged panel/account/sessions-hub code - nothing in those modules is modified by this file, so every control they
// already offer stays reachable exactly as the G1 spec section 28.3 entry-point inventory requires.
import { el } from '../cards.js';
import { watchTier, navPlacement, railLabelsShown, touchTarget, isShort } from './tier.js';
import { SHELL_NAV_ID } from './nav-id.js';

const ICONS = {
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 3 5.5v15L9 18l6 2.5 6-2.5v-15L15 5.5 9 3Zm0 2.2 6 2.5v12.1l-6-2.5V5.2ZM3.9 6.3 8 4.6v12.1l-4.1 1.7V6.3Zm16.2 11.4-4.1 1.7V6.3l4.1-1.7v13.1Z"/></svg>',
  trips: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Zm2-1h14V9H9.2l-2-2H5v10Z"/></svg>',
  explore: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-5 2-2 5 5-2 2-5Z" fill="#fff"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>',
};
const DESTS = [
  { key: 'map', label: 'Map' },
  { key: 'trips', label: 'Trips' },
  { key: 'explore', label: 'Explore' },
  { key: 'profile', label: 'Profile' },
];

function buildNav() {
  const root = el('nav', 'shell-nav'); root.id = SHELL_NAV_ID; root.setAttribute('aria-label', 'Primary');
  const buttons = DESTS.map(({ key, label }) => {
    const b = el('button', 'shell-nav-item'); b.type = 'button'; b.dataset.dest = key;
    b.setAttribute('aria-current', 'false');
    b.setAttribute('aria-label', label); // the accessible name regardless of whether the visible label is shown (icon-only tiers, short-height)
    b.innerHTML = ICONS[key] + '<span class="shell-nav-label" aria-hidden="true"></span>';
    b.querySelector('.shell-nav-label').textContent = label;
    b.title = label;
    root.append(b);
    return b;
  });
  document.body.append(root);
  return { root, buttons };
}

/**
 * `deps`: { map, panel, getSessionsHub() -> hub|null, toast, accountBtnId = 'account-btn' }.
 * Returns { destination(), setDestination(key), destroy() }, or null if the flag is off (nothing was built).
 */
function createShellNav({ panel, getSessionsHub, toast, accountBtnId = 'account-btn' }) {
  const { root, buttons } = buildNav();
  let current = 'map';
  let stopTier = null;

  function paint() {
    for (const b of buttons) b.setAttribute('aria-current', String(b.dataset.dest === current));
  }

  function go(key) {
    current = key;
    paint();
    if (key === 'map') { panel.close(); return; }
    if (key === 'trips') { panel.open('trips'); return; }
    if (key === 'explore') {
      const hub = getSessionsHub?.();
      if (hub) hub.open('discover'); else toast?.('Explore needs an internet connection to this build’s project.', 5000);
      return;
    }
    if (key === 'profile') { document.getElementById(accountBtnId)?.click(); }
  }

  for (const b of buttons) b.addEventListener('click', () => go(b.dataset.dest));

  // The panel can close by other means (Escape, a map click, swipe-to-dismiss); reflect that as "Map" being current again,
  // but only when it was Trips that closed - Explore/Profile use their own, separate surfaces and are not affected by the panel.
  panel.onChange(() => { if (current === 'trips' && !panel.isOpen()) go('map'); });

  stopTier = watchTier(({ tier, short, coarse }) => {
    root.dataset.tier = tier;
    root.dataset.placement = navPlacement(tier);
    root.dataset.labels = String(railLabelsShown(tier));
    root.dataset.short = String(short);
    root.style.setProperty('--shell-nav-target', `${touchTarget(coarse)}px`);
  });

  return {
    el: root,
    destination: () => current,
    setDestination: go,
    destroy() { stopTier?.(); root.remove(); },
  };
}

/** With the flag off this is a constant no-op: nothing it imports is reachable from a default build. */
export const initShellNav = import.meta.env.VITE_NEW_SHELL === '1' ? createShellNav : () => null;
