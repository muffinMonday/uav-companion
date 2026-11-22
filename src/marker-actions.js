// The marker window's actions (Review 01 S6, MD-E): ONE list of what can be done to a marker, and two layouts of it.
//   markerActions(it, h)    the list, with today's availability rules (no Visit for Home, no Side Quest for a Home point, Hotel or Home marker)
//   popupLayout(acts, phone) the Leaflet popup's icon bar and ⋯ menu, exactly as before S6
//   panelLayout(acts)        the adaptive host: Edit, Move location (S7) and Add visit as secondary buttons, the rest behind "More"
// Navigate is not here: it is an external link built by maplinks-ui.js `mapLinkIcons` (it keeps its Home confirmation).
import { isSub, NOT_SUB } from './poi.js';
import { el, toolButton } from './cards.js';

/**
 * `h` = { eyeOn, eyeLabel, edit(), visit(), side(), remove(), toggleEye(), move() (host only) }: what each action does (supplied by poi-ui.js through marker-content.js).
 * -> { eye, edit, visit?, side?, delete }, each { id, icon, label, onClick, cls?, danger? }. Nothing here changes data: the handlers do.
 */
export function markerActions(it, h) {
  const home = it.type === 'residence';
  const acts = {
    eye: { id: 'eye', icon: 'eye', label: h.eyeLabel, cls: h.eyeOn ? 'pop-eye' : 'pop-eye off', onClick: h.toggleEye },
    edit: { id: 'edit', icon: 'edit', label: 'Edit', onClick: h.edit },
    delete: { id: 'delete', icon: 'trash', label: 'Delete', danger: true, onClick: h.remove }, // keeps the two-press confirmation of toolButton
  };
  if (h.move) acts.move = { id: 'move', icon: 'move', label: 'Move location', cls: 'pop-move', onClick: h.move }; // the host only: the popup keeps its drag
  if (!home) acts.visit = { id: 'visit', icon: 'visit', label: 'Add visit', onClick: h.visit };
  if (!home && !NOT_SUB.has(it.type)) acts.side = { id: 'side', icon: 'flag', label: isSub(it) ? 'Make main stop' : 'Make Side Quest', onClick: h.side };
  return acts;
}

const list = (...a) => a.filter(Boolean);

/** The popup's bar: icons on a wide popup, fewer icons and a menu on a phone. Same sets and order as before the extraction. */
export function popupLayout(a, phone) {
  return {
    tools: phone ? [a.eye, a.edit] : list(a.eye, a.edit, a.visit, a.side, a.delete),
    menu: phone ? list(a.visit, a.side, a.delete) : [],
  };
}

/** The adaptive host: the frequent actions beside each other, the rare and destructive ones in the overflow menu. */
export function panelLayout(a) {
  return { secondary: list(a.edit, a.move, a.visit), overflow: list(a.side, a.delete, a.eye) };
}

let uid = 0;

/**
 * The generic "More" disclosure: one `role=menu` box wired with the marker host's keyboard/outside-press contract (Enter/Space/an
 * arrow opens it, focused at the first or last item; Up/Down/Home/End move; Escape closes and returns focus to the trigger without
 * reaching whatever hosts this (a marker panel, a trip card); Tab leaves and closes it; a press outside closes it). First built for
 * the marker host's More menu (S6, MD-E); reused verbatim by `panelActions` below and by Trips' card/detail overflow (Review 01
 * S10.8, TRIP-03) - one implementation, not two. `root`/`more`/`menu`/`itemEls` are already-built elements; this function only wires
 * the open/close/keyboard behavior onto them, so each caller keeps building its own trigger/menu markup and its own item buttons
 * (with whatever danger-confirm wording they already have) exactly as before.
 */
export function wireDisclosure({ root, more, menu, itemEls }) {
  let opened = false;
  const items = () => itemEls();
  const onDown = (e) => { if (!root.isConnected) { close(false); return; } if (!root.contains(e.target)) close(false); };
  function close(restoreFocus) {
    if (!opened) return;
    opened = false; menu.hidden = true; more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDown, true);
    if (restoreFocus) more.focus({ preventScroll: true });
  }
  function openMenu(focusAt = 0) {
    if (opened) return;
    opened = true; menu.hidden = false; more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDown, true);
    const it = items(); const t = it[focusAt < 0 ? it.length + focusAt : focusAt]; t?.focus({ preventScroll: true });
    menu.scrollIntoView?.({ block: 'nearest' });
  }
  more.addEventListener('click', () => { if (opened) close(true); else openMenu(0); });
  more.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(0); } else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(-1); }
  });
  menu.addEventListener('keydown', (e) => {
    const it = items(), at = it.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); it[(i + it.length) % it.length]?.focus({ preventScroll: true }); };
    if (e.key === 'ArrowDown') go(at + 1); else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(-1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
  root.addEventListener('focusout', (e) => { if (opened && e.relatedTarget && !root.contains(e.relatedTarget)) close(false); });
  return { close, openMenu, isOpen: () => opened };
}

/**
 * The host's action area: Navigate (the `navigate` element, full width), a row of secondary buttons and a "More" menu button.
 * The menu is a disclosure inside the panel (not a popover, not a dialog), so it can neither be clipped by the scrolling body nor take the map's clicks.
 * Delete keeps its confirmation: the first press only arms it.
 */
export function panelActions({ navigate, layout }) {
  const root = el('div', 'pop-actions'); root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Marker actions');
  const primary = el('div', 'pop-primary'); if (navigate) primary.append(navigate);
  const row = el('div', 'pop-secondary');
  for (const a of layout.secondary) row.append(toolButton({ ...a, cls: ['tool-text', a.cls].filter(Boolean).join(' ') }));
  root.append(primary, row);
  if (!layout.overflow.length) return root;

  const id = `mh-more-${++uid}`;
  const more = toolButton({ icon: 'more', label: 'More', cls: 'tool-text pop-more', onClick: () => {} });
  more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', id);
  more.title = 'More actions';
  const menu = el('div', 'pop-overflow'); menu.id = id; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'More marker actions');
  const wiring = wireDisclosure({ root, more, menu, itemEls: () => [...menu.querySelectorAll('[role=menuitem]')] });
  for (const a of layout.overflow) {
    const b = toolButton({ ...a, cls: ['tool-text', a.cls].filter(Boolean).join(' '), onClick: (e) => { wiring.close(false); a.onClick(e); } }); // only the confirmed press gets here
    b.setAttribute('role', 'menuitem'); b.tabIndex = -1;
    menu.append(b);
  }
  row.append(more);
  root.append(menu);
  return root;
}
