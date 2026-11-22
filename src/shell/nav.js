// The new four-destination shell navigation (Review 01 S10.2/S10.3, NAV-01 to NAV-09, MAP-02/MAP-06; G1 spec sections 14 and 28). Behind
// VITE_NEW_SHELL (default off, the production build has none of this): with the flag off `initShellNav` is a constant no-op and
// everything it imports is tree-shaken out of the bundle, the same build-flag-gated-constant pattern already used elsewhere in this app
// for another experimental feature.
//
// Scope: the chrome, its destination adapters (S10.2), the Map destination's two quick-access actions (Layers, Saved Places; S10.3),
// NAV-07 history for Trips (S10.4) and Explore (S10.5). Profile *content* (S10.6) is still explicitly out of scope. Nothing in
// panel.js/poi-ui.js/sessions-hub.js/app/map-settings.js is modified by this file beyond the small, additive hooks those modules expose
// for it, so every control they already offer stays reachable exactly as the G1 spec section 28.3 entry-point inventory requires.
import { el } from '../cards.js';
import { watchTier, navPlacement, railLabelsShown, touchTarget, isShort } from './tier.js';
import { SHELL_NAV_ID } from './nav-id.js';
import { createHistoryStack } from './history.js';

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
const MAP_ACTION_ICONS = {
  layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/></svg>',
  places: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v15l-7-3-7 3V4Z"/></svg>',
};
/** The Map destination's quick-access actions (S10.3, MAP-02/MAP-06): adapters onto the existing Map Configs ('config') and POI ('poi') panel tabs. */
const MAP_ACTIONS = [
  { key: 'layers', label: 'Layers', tab: 'config' },
  { key: 'places', label: 'Saved Places', tab: 'poi' },
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
  const mapActions = MAP_ACTIONS.map(({ key, label }) => {
    const b = el('button', 'shell-nav-item shell-nav-action'); b.type = 'button'; b.dataset.action = key; b.hidden = true;
    b.setAttribute('aria-label', label);
    b.innerHTML = MAP_ACTION_ICONS[key] + '<span class="shell-nav-label" aria-hidden="true"></span>';
    b.querySelector('.shell-nav-label').textContent = label;
    b.title = label;
    root.append(b);
    return b;
  });
  document.body.append(root);
  return { root, buttons, mapActions };
}

/**
 * `deps`: { map, panel, getSessionsHub() -> hub|null, toast, trips?, accountBtnId = 'account-btn' }.
 * `trips`: the object `initTripsUI` returns (S10.4, TRIP-02/NAV-07) - optional so this still works if Trips has not been wired up yet.
 * Returns { destination(), setDestination(key), destroy() }, or null if the flag is off (nothing was built).
 */
function createShellNav({ panel, getSessionsHub, toast, trips, accountBtnId = 'account-btn' }) {
  const { root, buttons, mapActions } = buildNav();
  let current = 'map';
  let stopTier = null;

  // NAV-07/TRIP-02: a trip's full-screen detail gets one history entry (Back returns to the trip list instead of leaving the app),
  // and expands the phone sheet to nearly full height while it is open (a no-op above the phone breakpoint, where "tall" has no CSS effect).
  const tripHistory = createHistoryStack();
  let tripEntry = null;
  trips?.onDetailChange((open) => {
    panel.setExpanded?.(open);
    if (open && !tripEntry) tripEntry = tripHistory.push(() => trips.closeDetail());
    else if (!open && tripEntry) { tripEntry.pop(); tripEntry = null; }
  });

  // S10.5/NAV-07: the Sessions hub (Explore) is its own native <dialog>, already full-screen on a phone with no change needed here - only
  // wire (a) a session's full-screen detail/New-session form into one history entry (Back returns to the Discover/My sessions/Invitations
  // list), same granularity as Trips above, and (b) the shell's current destination reverting to Map when the hub closes by its own means
  // (✕, Escape, an outside tap) - the same reconciliation `panel.onChange` already does for Trips. Wired lazily, once, the first time the
  // hub actually exists (it loads after this module does), exactly like `getSessionsHub` is already called lazily below.
  const exploreHistory = createHistoryStack();
  let exploreEntry = null, hubWired = false;
  function wireExploreHub(hub) {
    if (hubWired) return;
    hubWired = true;
    hub.onClose(() => {
      if (exploreEntry) { exploreEntry.pop(); exploreEntry = null; } // the hub can close while a detail/form was showing (no paint() runs to report it closed)
      if (current === 'explore') go('map');
    });
    hub.onViewChange((open) => {
      if (open && !exploreEntry) exploreEntry = exploreHistory.push(() => hub.back());
      else if (!open && exploreEntry) { exploreEntry.pop(); exploreEntry = null; }
    });
  }

  function paint() {
    for (const b of buttons) b.setAttribute('aria-current', String(b.dataset.dest === current));
    for (const b of mapActions) b.hidden = current !== 'map'; // the Layers/Saved Places quick actions only make sense while viewing the map
  }

  function go(key) {
    current = key;
    paint();
    if (key === 'map') { panel.close(); return; }
    if (key === 'trips') { panel.open('trips'); return; }
    if (key === 'explore') {
      const hub = getSessionsHub?.();
      if (hub) { wireExploreHub(hub); hub.open('discover'); } else toast?.('Explore needs an internet connection to this build’s project.', 5000);
      return;
    }
    if (key === 'profile') { document.getElementById(accountBtnId)?.click(); }
  }

  for (const b of buttons) b.addEventListener('click', () => go(b.dataset.dest));
  for (const b of mapActions) {
    const { tab } = MAP_ACTIONS.find((a) => a.key === b.dataset.action);
    b.addEventListener('click', () => panel.open(tab)); // reuses the existing pane verbatim (MAP-02: Layers = the Map Configs tab; MAP-06: Saved Places = the POI tab)
  }

  // The panel can close by other means (Escape, a map click, swipe-to-dismiss); reflect that as "Map" being current again,
  // but only when it was Trips that closed (Layers/Saved Places already leave current as 'map') - Explore/Profile use their own,
  // separate surfaces and are not affected by the panel.
  panel.onChange(() => { if (current === 'trips' && !panel.isOpen()) go('map'); });

  paint(); // establish the initial state (Map current, its actions visible) without calling go('map') and closing a panel the real app may have opened by default

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
    destroy() { stopTier?.(); tripHistory.destroy(); exploreHistory.destroy(); root.remove(); },
  };
}

/** With the flag off this is a constant no-op: nothing it imports is reachable from a default build. */
export const initShellNav = import.meta.env.VITE_NEW_SHELL === '1' ? createShellNav : () => null;
