// The account button: one in the panel header and one on the rail, both opening the same small popover.
// A guest sees that their data stays in this browser, the email sign-in form and a way to export or import. A signed-in visitor sees their name,
// friend code, sync state, and shortcuts to edit the profile and open Friends, plus Sign out.
// Only built when this build has a project address (see sync-ui.js). Nothing is fetched until the popover is opened while signed in.
import { createSocial, formatCode } from './social.js';
import { statusLine } from './sync-ui.js';
import { avatarEl } from './avatars.js';
import { profileBits } from './profile-ui.js';
import { getProgression } from './progression-api.js';
import { mountProgression } from './progression-ui.js';
import { createSteamCard, announceSteamReturn } from './steam-ui.js';
import { onSwipe, onDialogSwipe, atTop } from './swipe.js';
import { coarse, focusField, showModalQuiet } from './touch.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>';
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;
const $ = (id) => document.getElementById(id);

/** `handle` is what initSyncUI returns; `cloud` is the holder the dashboard and Friends tab share (cloud.friends). */
export function initAccountUI({ handle, panel, toast, cloud }) {
  const social = createSocial(handle.adapter.client);
  const session = () => handle.sync.status().session;
  let profile = null, profileFor = null, loading = false, trigger = null;
  const openState = {}; // which sections the person left open, kept between redraws
  const progression = getProgression(handle.adapter.client); // the one shared instance (also feeds other people's cards, see friends-ui.js)
  const steam = createSteamCard({ client: handle.adapter.client, onChange: () => { progression.forget(); if (!pop.hidden) render(); } });
  const steamSlot = el('div'); steam.mount(steamSlot); // kept between redraws so an open form is not lost
  announceSteamReturn(toast); // Steam's sign-in sends the person back here with ?steam=...

  const name = () => (profile?.display_name || session()?.email || '').trim();

  // ---- the two buttons
  const headBtn = el('button', 'icon-btn account-btn'); headBtn.id = 'account-btn';
  const dockBtn = el('button', 'account-btn'); dockBtn.id = 'dock-account';
  for (const b of [headBtn, dockBtn]) { b.type = 'button'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'account-pop'); }
  $('privacy-btn').before(headBtn);
  $('dock-fold').before(dockBtn);

  function paintButtons() {
    const on = !!session();
    const label = on ? 'Account: signed in as ' + name() : 'Account: not signed in';
    for (const b of [headBtn, dockBtn]) {
      b.replaceChildren();
      if (on) b.append(avatarEl(profile?.avatar, name(), b === dockBtn ? 28 : 26)); else b.innerHTML = PERSON; // constant markup
      b.setAttribute('aria-label', label); b.title = label; b.dataset.state = on ? 'in' : 'guest';
    }
  }

  // ---- the popover
  const pop = el('div', 'account-pop'); pop.id = 'account-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Account'); pop.tabIndex = -1;
  document.body.append(pop);

  function render() {
    const s = handle.sync.status();
    pop.replaceChildren();
    const close = el('button', 'icon-btn account-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.title = 'Close';
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; // constant markup
    close.addEventListener('click', () => hide());
    if (!s.session) {
      pop.append(close, el('h2', '', 'Not signed in'));
      pop.append(el('p', 'hint', 'Your markers and trips are stored only in this browser. Sign in to keep a copy that follows you to other devices and to use friends and shared trips.'));
      pop.append(handle.signInForm());
      const link = el('button', 'link-btn', 'Export or import your data'); link.type = 'button';
      link.addEventListener('click', () => { hide(false); cloud.openData?.(); });
      pop.append(link);
      return;
    }
    // ---- overview: who you are (the email is never shown here)
    const sec = (key, title, open) => { const d = el('details', 'pane-sec'); d.id = 'pane-' + key; d.open = openState[key] ?? open; d.addEventListener('toggle', () => { openState[key] = d.open; }); d.append(el('summary', '', title)); const body = el('div', 'pane-body'); d.append(body); return { d, body }; };
    const head = el('div', 'account-who');
    head.append(avatarEl(profile?.avatar, name(), 56));
    const who = el('div'); who.append(el('b', 'account-name', name() || '…'));
    if (profile) who.append(...profileBits(profile));
    head.append(who);
    pop.append(close, head);
    if (profile?.friend_code) {
      const row = el('div', 'fr-code-row');
      const code = el('span', 'fr-code', formatCode(profile.friend_code)); code.id = 'account-code';
      const copy = el('button', 'btn small', 'Copy'); copy.type = 'button';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(formatCode(profile.friend_code)); toast('Friend code copied.'); } catch { toast('Could not copy; select the code and copy it.'); } });
      row.append(code, copy);
      pop.append(el('div', 'fr-label', 'Your friend code'), row);
    } else if (loading) pop.append(el('p', 'hint', 'Loading…'));
    const line = el('p', 'hint cloud-status', statusLine(s)); line.setAttribute('role', 'status'); pop.append(line);
    const n = (cloud.friends?.incoming ?? 0) + (cloud.friends?.invites ?? 0);
    const row = el('div', 'btn-row');
    const btn = (label, fn, cls = '') => { const b = el('button', 'btn small ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); return b; };
    btn('Edit profile', () => { hide(false); cloud.friends?.editProfile(); }).id = 'account-edit';
    btn('Friends' + (n ? ` (${n})` : ''), () => { hide(false); cloud.friends?.open(); });
    pop.append(row);
    // ---- progression and Steam: yours to see and manage; others only ever see the read-only card
    const ps = sec('progression', 'Progression', true);
    const slot = el('div'); ps.body.append(slot); pop.append(ps.d);
    mountProgression(slot, { load: () => progression.mine(), peek: () => progression.peek('me'), mode: 'self', api: progression, toast });
    const ss = sec('steam', 'Steam', false);
    ss.body.append(steamSlot); pop.append(ss.d);
    const out = el('button', 'btn small', 'Sign out'); out.type = 'button';
    out.addEventListener('click', async () => { if (await handle.signOut()) hide(false); });
    const del = el('button', 'btn small danger', 'Delete my account…'); del.type = 'button'; del.id = 'account-delete';
    del.addEventListener('click', () => { hide(false); confirmDelete(); });
    const end = el('div', 'btn-row'); end.append(out, del);
    pop.append(end);
  }

  /** Fetches the profile (the name, avatar and friend code). `force` refreshes one already held, as when the popover opens after edits made in the Friends tab. */
  // ---- deleting the account: says what goes, offers a backup, and asks for the word DELETE before the button works
  const dlg = el('dialog', 'account-dialog'); dlg.id = 'account-delete-dialog'; dlg.setAttribute('aria-labelledby', 'account-del-title');
  document.body.append(dlg);
  function confirmDelete() {
    dlg.replaceChildren();
    const h = el('h2', '', 'Delete your account?'); h.id = 'account-del-title';
    const list = el('ul', 'hint');
    for (const t of ['Your profile, friends and blocked list are removed.', 'Your cloud copy and all its earlier versions are deleted.', 'You leave every shared trip. A trip you own that others have joined goes to the person who joined first; a trip nobody else joined is deleted.', 'Your sign-in is deleted. Signing in with the same email later starts a new, empty account.', 'Markers and trips on this device stay here.']) list.append(el('li', '', t));
    const back = el('button', 'btn small', 'Download a backup of this device first'); back.type = 'button';
    back.addEventListener('click', () => handle.backupThisDevice());
    const lab = el('label', 'fr-label', 'Type DELETE to confirm'); lab.setAttribute('for', 'account-delete-word');
    const word = el('input'); word.type = 'text'; word.id = 'account-delete-word'; word.autocomplete = 'off'; word.spellcheck = false;
    const msg = el('p', 'hint'); msg.setAttribute('role', 'alert'); msg.hidden = true;
    const go = el('button', 'btn danger', 'Delete my account'); go.type = 'button'; go.id = 'account-delete-go'; go.disabled = true;
    const no = el('button', 'btn small', 'Cancel'); no.type = 'button'; no.addEventListener('click', () => dlg.close());
    word.addEventListener('input', () => { go.disabled = word.value !== 'DELETE'; });
    go.addEventListener('click', async () => {
      go.disabled = no.disabled = word.disabled = true; msg.hidden = true;
      try { await handle.deleteAccount(); dlg.close(); toast('Your account was deleted. Markers and trips on this device are still here.', 8000); }
      catch (e) { msg.textContent = e.message; msg.hidden = false; no.disabled = word.disabled = false; go.disabled = word.value !== 'DELETE'; }
    });
    const row = el('div', 'btn-row'); row.append(go, no);
    dlg.append(h, list, back, lab, word, msg, row);
    showModalQuiet(dlg); focusField(word);
  }

  // ---- the first time someone signs in (profile.named is false) they are asked for a display name; Skip keeps the default and does not ask again
  const nameDlg = el('dialog', 'account-dialog'); nameDlg.id = 'name-dialog'; nameDlg.setAttribute('aria-labelledby', 'name-dlg-title');
  document.body.append(nameDlg);
  let asking = false, skipName = null;
  nameDlg.addEventListener('cancel', (e) => { e.preventDefault(); skipName?.(); }); // Escape counts as Skip
  function askName() {
    if (asking || !profile || profile.named !== false) return;
    asking = true;
    let decided = false;
    const finish = async (name) => {
      if (decided) return; decided = true;
      try { profile = await social.chooseName(name); profileFor = session()?.email ?? profileFor; paintButtons(); if (!pop.hidden) render(); cloud.friends?.reload?.(); if (name) toast('Welcome, ' + name + '.'); }
      catch (e) { decided = false; msg.textContent = e.message; msg.hidden = false; return; }
      asking = false; nameDlg.close();
    };
    nameDlg.replaceChildren();
    const h = el('h2', '', 'Choose a display name'); h.id = 'name-dlg-title';
    const p = el('p', 'hint', 'This is the name your friends and trip partners see. You can change it later in Edit profile.');
    const lab = el('label', 'fr-label', 'Display name'); lab.setAttribute('for', 'name-dlg-input');
    const input = el('input'); input.type = 'text'; input.id = 'name-dlg-input'; input.maxLength = 40; input.autocomplete = 'off'; input.placeholder = profile.display_name;
    const msg = el('p', 'hint'); msg.setAttribute('role', 'alert'); msg.hidden = true;
    const go = el('button', 'btn primary', 'Save name'); go.type = 'button'; go.id = 'name-dlg-save';
    const skip = el('button', 'btn small', 'Skip for now'); skip.type = 'button'; skip.id = 'name-dlg-skip';
    const row = el('div', 'btn-row'); row.append(go, skip);
    go.addEventListener('click', () => { if (!input.value.trim()) { msg.textContent = 'Type a name, or choose Skip for now.'; msg.hidden = false; input.focus(); return; } finish(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    skip.addEventListener('click', () => finish(null));
    skipName = () => finish(null);
    nameDlg.append(h, p, lab, input, msg, row);
    showModalQuiet(nameDlg); focusField(input);
  }

  let profileLoad = null;
  /** A call made while the profile is already being fetched shares that fetch. */
  function loadProfile(opts = {}) { return profileLoad ?? (profileLoad = loadProfileNow(opts).finally(() => { profileLoad = null; })); }
  async function loadProfileNow({ force = false } = {}) {
    const email = session()?.email;
    if (!email) { profile = null; profileFor = null; paintButtons(); return; }
    if (!force && profileFor === email && profile) return;
    loading = !profile; if (loading && !pop.hidden) render();
    try { profile = await social.profile(); profileFor = email; } catch { profile = null; }
    loading = false;
    paintButtons(); if (!pop.hidden) render();
    askName();
  }

  function place() {
    if (isPhone() || !trigger) { pop.style.top = pop.style.right = pop.style.left = ''; return; }
    const r = trigger.getBoundingClientRect(), inDock = trigger === dockBtn;
    pop.style.left = 'auto';
    pop.style.right = Math.max(8, inDock ? innerWidth - r.left + 8 : innerWidth - r.right) + 'px';
    pop.style.top = Math.max(8, inDock ? r.top : r.bottom + 6) + 'px';
  }
  function show(from) {
    trigger = from && !from.hidden && from.offsetParent !== null ? from : (panel.isOpen() ? headBtn : dockBtn);
    if (session()) steam.reload();
    render(); pop.hidden = false; place();
    for (const b of [headBtn, dockBtn]) b.setAttribute('aria-expanded', String(b === trigger));
    (coarse() ? pop : pop.querySelector('input, button:not(.account-close)') || pop).focus?.(); // on a touch screen the sign-in field is not focused: that would raise the keyboard
    loadProfile({ force: true });
  }
  function hide(focus = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    for (const b of [headBtn, dockBtn]) b.setAttribute('aria-expanded', 'false');
    if (focus && trigger && trigger.offsetParent !== null) trigger.focus();
  }
  for (const b of [headBtn, dockBtn]) b.addEventListener('click', () => (pop.hidden ? show(b) : hide()));
  onSwipe(pop, { direction: 'down', enabled: () => isPhone() && !pop.hidden, canStart: (t) => pop.scrollTop <= 0 && atTop(t, pop), onDismiss: () => hide() }); // the bottom sheet on a phone
  onDialogSwipe(dlg); onDialogSwipe(nameDlg, { close: () => skipName?.() }); // a swipe down is Cancel, and Skip for the name
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) hide(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest?.('dialog') && !headBtn.contains(e.target) && !dockBtn.contains(e.target)) hide(false); });
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  panel.onChange(() => { if (!pop.hidden && trigger && trigger.offsetParent === null) { hide(false); } });

  handle.onChange(() => {
    if (!session()) { profile = null; profileFor = null; steam.reset(); }
    paintButtons();
    if (session()) loadProfile();
    if (!pop.hidden) render();
  });
  handle.account = { open: () => show(), close: () => hide(false), reload: () => loadProfile({ force: true }) };
  paintButtons();
  if (session()) loadProfile();
  return { reload: () => loadProfile({ force: true }) };
}
