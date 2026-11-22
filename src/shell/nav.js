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
import { initSettingsUI } from './settings.js';
import { initActivityUI } from './activity.js';

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
const GLOBAL_ICONS = {
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.3-.9c.5.4 1.1.8 1.7 1L10 21h4l.4-2.9c.6-.2 1.2-.6 1.7-1l2.3.9 2-3.4-2-1.6Z"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17v-6a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
};
/** Review 01 S10.7 (NAV-05/ACT-01): Settings and the Activity bell are app-wide, not tied to one destination - shown on every tier, every destination. */
const GLOBAL_ACTIONS = [
  { key: 'settings', label: 'Settings' },
  { key: 'activity', label: 'Activity' },
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
  const globalActions = GLOBAL_ACTIONS.map(({ key, label }) => {
    const b = el('button', 'shell-nav-item shell-nav-action shell-nav-global'); b.type = 'button'; b.dataset.action = key;
    b.setAttribute('aria-label', label);
    b.innerHTML = GLOBAL_ICONS[key] + '<span class="shell-nav-label" aria-hidden="true"></span><span class="tab-badge" hidden></span>';
    b.querySelector('.shell-nav-label').textContent = label;
    b.title = label;
    root.append(b);
    return b;
  });
  document.body.append(root);
  // Review 01 S10.9 (NAV-04 row 2): marks the legacy dock/panel-tabs as superseded so styles.css can hide that now-duplicate chrome
  // while the new shell is active, without this file (or panel.js) knowing anything about the other's DOM.
  document.body.dataset.shell = 'new';
  return { root, buttons, mapActions, globalActions };
}

/**
 * `deps`: { map, panel, getSessionsHub() -> hub|null, getAccount() -> account|null, toast, trips?, cloud?, getDash?, accountBtnId = 'account-btn' }.
 * `trips`: the object `initTripsUI` returns (S10.4, TRIP-02/NAV-07) - optional so this still works if Trips has not been wired up yet.
 * `getAccount`: a lazy getter for what `initAccountUI` returns (S10.6, PROF-01..06) - optional for the same reason.
 * `cloud`/`getDash`: the same mutable holder and dashboard instance `main.js` already builds (S10.7, SET-01..08/ACT-01..04) - optional,
 * read-only here, never written; the Settings/Activity sections simply have nothing real to adapt onto until they exist.
 * Returns { destination(), setDestination(key), destroy() }, or null if the flag is off (nothing was built).
 */
function createShellNav({ panel, getSessionsHub, getAccount, toast, trips, cloud, getDash, accountBtnId = 'account-btn' }) {
  const { root, buttons, mapActions, globalActions } = buildNav();
  let current = 'map';
  let stopTier = null;

  // S10.7 (SET-01..08/ACT-01..04): built once, unconditionally - both are additive panel tabs that hold no preference/notification
  // state of their own (they read `cloud`/`panel`/`getDash` live on every open), so there is nothing to defer the way the Explore hub
  // and the account popover are deferred below (those are async-loaded modules this file does not own).
  const settings = initSettingsUI({ panel, openData: () => cloud?.openData?.(), getDash, accountBtnId });
  const activity = initActivityUI({ panel, cloud: cloud ?? {} });
  let sessionsWired = false, partyWired = false;
  function wireActivitySources() {
    const hub = getSessionsHub?.();
    if (hub && !sessionsWired) { sessionsWired = true; hub.onSummary(() => activity.refresh()); }
    if (cloud?.party && !partyWired) { partyWired = true; cloud.party.onChange(() => activity.refresh()); }
  }

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

  // S10.6/PROF-01..06: the account popover (`account-ui.js`) already holds everything the Profile destination needs - progression (rank/
  // XP/achievements), friends, Steam (PROF-06/C-35) and account controls - unmodified. Only the nav-state reconciliation is new here, the
  // same pattern Trips and Explore already have: the popover can close by its own means (✕, Escape, an outside tap, a swipe-down), so
  // reflect that as "Map" being current again. No NAV-07 history entry: the popover, like the hub, is reachable from several pre-existing
  // entry points (the panel header button, the rail button, an automatic open after a failed sign-in return), so the *outer* Back-closes-it
  // level is deferred for the same reason it is for Trips and Explore - only wiring it for Profile alone would be an inconsistent partial fix.
  let accountWired = false;
  function wireAccount(acct) {
    if (accountWired) return;
    accountWired = true;
    acct.onClose(() => { if (current === 'profile') go('map'); });
  }

  const bellButton = globalActions.find((b) => b.dataset.action === 'activity');
  const bellBadge = bellButton.querySelector('.tab-badge');
  function paint() {
    for (const b of buttons) b.setAttribute('aria-current', String(b.dataset.dest === current));
    for (const b of mapActions) b.hidden = current !== 'map'; // the Layers/Saved Places quick actions only make sense while viewing the map
    wireActivitySources();
    activity.refresh();
    const n = activity.pendingCount();
    bellBadge.hidden = !n;
    bellBadge.textContent = n > 9 ? '9+' : String(n || '');
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
    if (key === 'profile') {
      const acct = getAccount?.();
      if (acct) wireAccount(acct);
      document.getElementById(accountBtnId)?.click();
    }
  }

  for (const b of buttons) b.addEventListener('click', () => go(b.dataset.dest));
  for (const b of mapActions) {
    const { tab } = MAP_ACTIONS.find((a) => a.key === b.dataset.action);
    b.addEventListener('click', () => panel.open(tab)); // reuses the existing pane verbatim (MAP-02: Layers = the Map Configs tab; MAP-06: Saved Places = the POI tab)
  }
  for (const b of globalActions) {
    b.addEventListener('click', () => (b.dataset.action === 'settings' ? settings.open() : activity.open()));
  }

  // The panel can close by other means (Escape, a map click, swipe-to-dismiss); reflect that as "Map" being current again,
  // but only when it was Trips that closed (Layers/Saved Places already leave current as 'map') - Explore/Profile use their own,
  // separate surfaces and are not affected by the panel.
  panel.onChange(() => { if (current === 'trips' && !panel.isOpen()) go('map'); paint(); });

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
    destroy() { stopTier?.(); tripHistory.destroy(); exploreHistory.destroy(); root.remove(); delete document.body.dataset.shell; },
  };
}

/** With the flag off this is a constant no-op: nothing it imports is reachable from a default build. */
export const initShellNav = import.meta.env.VITE_NEW_SHELL === '1' ? createShellNav : () => null;
