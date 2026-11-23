// Review 01 S10.7 (SET-01 to SET-08; G1 spec section 19): a dedicated, grouped Settings page - six sections, named exactly as the
// spec's SET-01 requires (Map & display; Units & navigation; Privacy & location; Account & synchronization; Data management; Help &
// about). Every section is a real adapter onto the surface that already implements it (the Layers pane, the Privacy sub-panel, the
// account popover, the dashboard's data row and Help subview) - no control is rebuilt here and no preference state is duplicated
// (SET-02's "one source of truth" rule: Settings holds zero Map Configs controls of its own, since every one of them is already in the
// Layers sheet, MAP-02). Built as one more panel tab (`panel.addTab`), the same adaptive-host primitive every other pane already uses
// (NAV-03), not a bespoke panel.
import { el } from '../cards.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.3-.9c.5.4 1.1.8 1.7 1L10 21h4l.4-2.9c.6-.2 1.2-.6 1.7-1l2.3.9 2-3.4-2-1.6Z"/></svg>';

function row(title, hint, actionLabel, onOpen) {
  const r = el('div', 'set-row');
  const body = el('div', 'set-row-body');
  body.append(el('h3', '', title), el('p', 'hint', hint));
  const b = el('button', 'btn small', actionLabel);
  b.type = 'button';
  b.addEventListener('click', onOpen);
  r.append(body, b);
  return r;
}

/**
 * `deps`: { panel, openData() (cloud.openData - the existing export/import entry point), getDash() -> dashboard|null,
 * accountBtnId = 'account-btn' }. Returns { open(), el: pane }.
 */
export function initSettingsUI({ panel, openData, getDash, accountBtnId = 'account-btn' }) {
  const pane = el('section');
  pane.id = 'pane-settings';
  pane.append(
    el('h2', '', 'Settings'),
    row(
      'Map & display',
      'Basemap, country layers, zone opacity and theme live in the Layers sheet, open while viewing the map (MAP-02) - nothing here duplicates them.',
      'Open Layers', () => panel.open('config'),
    ),
    row(
      'Units & navigation',
      'Distance units and the travel-app preference are part of the same Map Configs controls above.',
      'Open Layers', () => panel.open('config'),
    ),
    row(
      'Privacy & location',
      'Every consent toggle (location, attendance, live sharing) and the local diagnostics log, unchanged.',
      'Open Privacy', () => panel.openPrivacy(),
    ),
    // SET-05's "identity/social (Profile) vs technical/sync (Settings)" split is drawn here, once: there is no second
    // controls surface to split into - account-ui.js's popover is the only place sign-in, friend code, cloud sync status
    // (sync-ui.js's cloud card) and Steam are implemented, so both Profile and this row intentionally open that same
    // popover rather than Settings re-hosting a duplicate sync panel. Documented here per SET-05's AC, not left ambiguous.
    row(
      'Account & synchronization',
      'Sign-in, friend code, cloud sync status and Steam - opens the same account panel as Profile.',
      'Open Account', () => document.getElementById(accountBtnId)?.click(),
    ),
    row(
      'Data management',
      'Export, import or clear your saved data.',
      'Open', () => openData?.(),
    ),
    row(
      'Help & about',
      'Guides and what changed.',
      'Open Help', () => getDash?.()?.showHelp(),
    ),
  );
  const tab = panel.addTab({ key: 'settings', label: 'Settings', icon: ICON, pane });
  return { open: () => panel.open('settings'), el: pane, badge: tab.badge };
}
