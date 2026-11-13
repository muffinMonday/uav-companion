// A small read-only popover with someone's profile, opened by their avatar or name in the Friends list and in a trip's party.
// It draws only the row it is given (list_friends / list_trip_members); what a row contains is decided by the database, so nothing here asks for more.
import { profileView } from './profile-ui.js';
import { mountProgression } from './progression-ui.js';
import { onSwipe, atTop } from './swipe.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

let pop = null, anchor = null;

function hide(focus = true) {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  if (focus && anchor?.isConnected) anchor.focus();
  anchor = null;
}

function build() {
  pop = el('div', 'account-pop profile-pop'); pop.id = 'profile-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Profile');
  document.body.append(pop);
  onSwipe(pop, { direction: 'down', enabled: () => isPhone() && !pop.hidden, canStart: (t) => pop.scrollTop <= 0 && atTop(t, pop), onDismiss: () => hide() }); // the bottom sheet on a phone
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) hide(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest?.('.pv-trigger')) hide(false); });
  window.addEventListener('resize', () => { if (!pop.hidden && anchor) place(anchor); });
}

function place(from) {
  if (isPhone()) { pop.style.top = pop.style.right = pop.style.left = ''; return; } // a bottom sheet (see .account-pop in styles.css)
  const panel = document.getElementById('panel');
  const r = from.getBoundingClientRect(), pr = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
  pop.style.left = 'auto';
  pop.style.right = (pr ? Math.max(8, innerWidth - pr.left + 8) : 12) + 'px';
  pop.style.top = Math.max(8, Math.min(r.top - 8, innerHeight - pop.offsetHeight - 8)) + 'px';
}

let progression = null; // getProgression(client), set by the screens that list people (friends-ui, party-ui)
/** Lets the popover show rank, XP and achievements: `api` is a progression-api instance (or null to show the profile alone). */
export function setProgressionSource(api) { progression = api; }
/** The handle the database knows a person by: a party member id, or the friendship id of an accepted friend. Nothing else can be asked for. */
const handleOf = (row) => (row?.member_id ? { kind: 'member', id: row.member_id } : row?.status === 'friends' && row.id ? { kind: 'friend', id: row.id } : null);

/**
 * The body of a profile, shared by the popover and the Edit profile preview: the profile view and, when `load` is given, the progression card under it.
 * `load()`/`peek()` fetch the cleaned progression payload; `mode` 'self' with an `api` adds the XP history button. Returns the nodes to append.
 */
export function profileContent(row, { load = null, peek = null, mode = 'other', api = null, onDraw = () => {} } = {}) {
  const nodes = [profileView(row)];
  if (load) {
    const slot = el('div', 'pv-prog'); nodes.push(slot);
    mountProgression(slot, { load, peek, mode, api, onDraw });
  }
  return nodes;
}

/** Shows `row` (a friend or party member: display_name, avatar, bio, location, interests) next to `from`; `sub` is an optional line such as "online". */
export function showProfile(row, from, sub = '') {
  if (!pop) build();
  const close = el('button', 'icon-btn account-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.title = 'Close';
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; // constant markup
  close.addEventListener('click', () => hide());
  const h = handleOf(row);
  const self = row.is_me === true;
  const onDraw = () => { if (!pop.hidden && anchor) place(anchor); };
  pop.replaceChildren(close, ...profileContent(row, progression && h
    ? { load: () => progression.get(h.kind, h.id), peek: () => progression.peek(h.kind, h.id), mode: self ? 'self' : 'other', api: self ? progression : null, onDraw }
    : {}));
  if (sub) pop.append(el('small', 'pv-sub', sub));
  pop.hidden = false; anchor = from;
  place(from);
  close.focus();
}

/** Wraps `child` (an avatar or a name) in a button that opens the profile of `row`; clicking it again closes the popover. */
export function profileTrigger(child, row, sub = '') {
  const b = el('button', 'pv-trigger'); b.type = 'button'; b.setAttribute('aria-label', 'View profile of ' + row.display_name); b.setAttribute('aria-haspopup', 'dialog');
  b.append(child);
  b.addEventListener('click', () => { if (pop && !pop.hidden && anchor === b) hide(); else showProfile(row, b, sub); });
  return b;
}
