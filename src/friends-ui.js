// The Friends tab: your name and friend code, adding a friend by their code, requests, friends and blocked people.
// Only built when this build has a project address (see sync-ui.js); the tab shows a sign-in pointer until the visitor is signed in.
import { createSocial, formatCode, presenceText } from './social.js';
import { describeWhen } from './sync/core.js';
import { avatarEl } from './avatars.js';
import { profileBits } from './profile-ui.js';
import { createProfileDialog } from './profile-dialog.js';
import { profileTrigger, setProgressionSource } from './profile-popover.js';
import { getProgression } from './progression-api.js';
import { mountProgression } from './progression-ui.js';
import { createSessionsCard } from './sessions-ui.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c3 .3 5 2.6 5 5.8"/></svg>';
const POLL_MS = 120000; // how often to look for new requests while signed in and the page is visible
const LIVE_MS = 30000;   // while the Friends tab is showing: how often to refresh who is online

/** `handle` is what initSyncUI returns: { sync, adapter, onChange }. `cloud` is the holder the dashboard reads (friends: { incoming, open }). */
export function initFriendsUI({ panel, handle, toast, cloud }) {
  const social = createSocial(handle.adapter.client);
  const progression = getProgression(handle.adapter.client);
  setProgressionSource(progression);
  const sessions = createSessionsCard({ client: handle.adapter.client });
  const sesSlot = el('div'); sessions.mount(sesSlot); // kept between redraws of the tab so an open manage panel or form is not lost
  const pane = el('section'); pane.id = 'pane-friends';
  const tab = panel.addTab({ key: 'friends', label: 'Friends', icon: ICON, pane });
  let profile = null, list = [], blocked = [], message = '', busy = false, loadedFor = null;
  const profileDialog = createProfileDialog({ social, toast, onSaved: (p) => { profile = p; render(); handle.account?.reload?.(); } });
  const signedIn = () => !!handle.sync.status().session;
  const shown = () => panel.isOpen() && panel.getTab() === 'friends';

  const say = (m) => { message = m; render(); };
  async function act(fn, done) {
    if (busy) return;
    busy = true;
    try { const r = await fn(); if (done) message = typeof done === 'function' ? done(r) : done; else message = ''; }
    catch (e) { message = e.message; }
    busy = false;
    await load(); // render happens in load
  }

  async function load({ withProfile = false } = {}) {
    if (!signedIn()) { profile = null; list = []; blocked = []; loadedFor = null; progression.forget(); sessions.reset(); publish(); render(); return; }
    try {
      if (loadedFor && loadedFor !== handle.sync.status().session.email) progression.forget(); // a different account on the same page: nothing of the last one's is kept
      list = await social.list();
      sessions.reload();
      if (withProfile || profile) profile = await social.profile();
      if (shown()) blocked = await social.blocked();
      loadedFor = handle.sync.status().session.email;
    } catch (e) { message = e.message; }
    publish(); render();
  }
  function publish() {
    const reqs = list.filter((f) => f.status === 'incoming').length;
    const invites = cloud.party?.invitations().length ?? 0;
    tab.badge(reqs + invites);
    if (cloud.friends.incoming !== reqs || cloud.friends.invites !== invites) { cloud.friends.incoming = reqs; cloud.friends.invites = invites; cloud.refresh?.(); }
  }

  function render() {
    pane.replaceChildren();
    if (!signedIn()) {
      const c = el('div', 'card');
      c.append(el('h2', '', 'Friends'), el('p', 'hint', 'Sign in to add friends and, later, plan flights together. People find each other only by a friend code that its owner shares: nobody can search for you or see a list of people.'));
      const b = el('button', 'btn small', 'Sign in…'); b.type = 'button';
      b.addEventListener('click', () => handle.open());
      c.append(b); pane.append(c); return;
    }
    if (!profile) { const c = el('div', 'card'); c.append(el('p', 'hint', 'Loading…')); pane.append(c); return; }

    const invites = cloud.party?.invitationsCard(); // trip invitations come first: they are what someone is waiting on
    if (invites) pane.append(invites);
    // ---- you
    const me = el('div', 'card');
    me.append(el('h2', '', 'You'));
    const who = el('div', 'fr-me');
    const nm = el('b', '', profile.display_name); nm.id = 'fr-me-name';
    const edit = el('button', 'btn small', 'Edit profile'); edit.type = 'button'; edit.id = 'fr-edit-profile';
    edit.addEventListener('click', () => profileDialog.open());
    who.append(avatarEl(profile.avatar, profile.display_name, 34), nm, edit);
    me.append(who);
    me.append(el('div', 'fr-label', 'Your friend code'));
    const row = el('div', 'fr-code-row');
    const code = el('span', 'fr-code', formatCode(profile.friend_code)); code.id = 'fr-code';
    const copy = el('button', 'btn small', 'Copy'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(formatCode(profile.friend_code)); toast('Friend code copied.'); } catch { toast('Could not copy; select the code and copy it.'); } });
    const fresh = el('button', 'btn small', 'New code'); fresh.type = 'button';
    fresh.addEventListener('click', () => { if (confirm('Get a new friend code? The old one stops working. Friends you already have stay.')) act(async () => { profile = await social.newCode(); }, 'New code ready.'); });
    row.append(code, copy, fresh);
    me.append(row);
    const sw = el('label', 'switch'); const sp = el('span', '', 'Let people send me requests'); sp.append(el('small', '', 'Off: your code stops working for new requests until you turn it back on.'));
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'fr-accepts'; cb.checked = profile.accepts_requests;
    cb.addEventListener('change', () => act(async () => { profile = await social.setAccepts(cb.checked); }));
    sw.append(sp, cb); me.append(sw);
    const sho = el('label', 'switch'); const sp2 = el('span', '', 'Show when I am online'); sp2.append(el('small', '', 'Friends and trip party members see "online" or when you were last seen. Off: nothing is recorded or shown, and you do not see theirs either.'));
    const cb2 = el('input'); cb2.type = 'checkbox'; cb2.id = 'fr-online'; cb2.checked = profile.show_online !== false;
    cb2.addEventListener('change', () => act(async () => { profile = await social.setShowOnline(cb2.checked); }));
    sho.append(sp2, cb2); me.append(sho);
    me.append(el('p', 'hint', 'Share your code only with people you know. Someone with it can send you a request, which you can accept, decline or block.'));
    pane.append(me);

    // ---- your progression (rank, XP, featured achievements); the same card others see, plus your history
    const pc = el('div', 'card'); pc.id = 'fr-progression'; pc.append(el('h2', '', 'Progression'));
    const slot = el('div'); pc.append(slot);
    mountProgression(slot, { load: () => progression.mine(), peek: () => progression.peek('me'), mode: 'self', api: progression, toast });
    pane.append(pc);

    // ---- flight sessions: RSVP; organisers and administrators also manage them
    const sc = el('div', 'card'); sc.id = 'fr-sessions'; sc.append(el('h2', '', 'Flight sessions'), sesSlot);
    pane.append(sc);

    // ---- add a friend
    const add = el('div', 'card');
    add.append(el('h2', '', 'Add a friend'));
    const af = el('form', 'fr-name');
    const ai = el('input'); ai.type = 'text'; ai.id = 'fr-add'; ai.placeholder = 'Their friend code'; ai.autocomplete = 'off'; ai.setAttribute('aria-label', 'Their friend code'); ai.maxLength = 20;
    const ab = el('button', 'btn small', 'Send request'); ab.type = 'submit';
    af.append(ai, ab);
    af.addEventListener('submit', (e) => { e.preventDefault(); const v = ai.value; if (!v.trim()) return; act(() => social.request(v), (r) => (r.status === 'friends' ? 'You are friends.' : 'Request sent. They will see it next time they open Friends.')); });
    add.append(af);
    if (message) { const m = el('p', 'hint fr-message', message); m.setAttribute('role', 'status'); add.append(m); }
    pane.append(add);

    const person = (name, sub, buttons, online = null, row = null) => {
      const r = el('div', 'fr-row');
      if (row) r.append(profileTrigger(avatarEl(row.avatar, name, 34), row, sub));
      const who = el('div', 'fr-who'); const nm = el('b'); if (online !== null) { const dot = el('i', 'presence ' + (online ? 'on' : 'off')); dot.setAttribute('aria-hidden', 'true'); nm.append(dot); } nm.append(name); who.append(row ? profileTrigger(nm, row, sub) : nm); if (sub) who.append(el('small', '', sub));
      if (row) who.append(...profileBits(row));
      const bs = el('div', 'fr-actions'); for (const [label, fn, cls] of buttons) { const b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); bs.append(b); }
      r.append(who, bs); return r;
    };
    // ---- requests
    const incoming = list.filter((x) => x.status === 'incoming'), outgoing = list.filter((x) => x.status === 'outgoing');
    if (incoming.length || outgoing.length) {
      const c = el('div', 'card'); c.id = 'fr-requests';
      c.append(el('h2', '', 'Requests'));
      for (const x of incoming) c.append(person(x.display_name, 'wants to be friends · ' + describeWhen(x.since), [
        ['Accept', () => act(() => social.respond(x.id, true), x.display_name + ' is now a friend.')],
        ['Decline', () => act(() => social.respond(x.id, false))],
        ['Block', () => { if (confirm('Block ' + x.display_name + '? They cannot send you another request and are not told.')) act(() => social.block(x.id), 'Blocked.'); }, 'danger'],
      ]));
      for (const x of outgoing) c.append(person(x.display_name, 'waiting for an answer', [['Cancel', () => act(() => social.remove(x.id))]]));
      pane.append(c);
    }
    // ---- friends
    const fc = el('div', 'card'); fc.id = 'fr-friends';
    const friends = list.filter((x) => x.status === 'friends');
    fc.append(el('h2', '', 'Friends (' + friends.length + ')'));
    if (!friends.length) fc.append(el('p', 'hint', 'No friends yet. Share your code, or enter theirs above.'));
    for (const x of friends) fc.append(person(x.display_name, [presenceText(x, describeWhen), 'friends since ' + describeWhen(x.since)].filter(Boolean).join(' · '), [
      ['Remove', () => { if (confirm('Remove ' + x.display_name + ' from your friends?')) act(() => social.remove(x.id), 'Removed.'); }],
      ['Block', () => { if (confirm('Block ' + x.display_name + '? This also removes them from your friends.')) act(() => social.block(x.id), 'Blocked.'); }, 'danger'],
    ], x.online, x));
    pane.append(fc);
    // ---- blocked
    if (blocked.length) {
      const bc = el('div', 'card'); bc.id = 'fr-blocked';
      bc.append(el('h2', '', 'Blocked'));
      for (const x of blocked) bc.append(person(x.display_name, 'blocked ' + describeWhen(x.created_at), [['Unblock', () => act(() => social.unblock(x.id), 'Unblocked.')]]));
      pane.append(bc);
    }
    // ---- delete
    const dc = el('div', 'card');
    const del = el('button', 'btn small danger', 'Delete my profile and friends'); del.type = 'button';
    del.addEventListener('click', () => { if (confirm('Delete your profile, your friends and your blocked list, and leave your shared trips? A trip you own that others have joined goes to the person who joined first; a trip nobody else joined is deleted. Your cloud copy is not touched. Your friends are not told. You can set up a new profile later.')) act(async () => { await social.deleteProfile(); profile = null; }, 'Profile deleted.'); });
    dc.append(del); pane.append(dc);
  }

  cloud.friends = { incoming: 0, invites: 0, open: () => panel.open('friends'), editProfile: () => profileDialog.open(), reload: () => load({ withProfile: true }), recount: () => { publish(); render(); } };
  handle.onChange(() => { if (signedIn() && loadedFor !== handle.sync.status().session.email) load(); else if (!signedIn() && loadedFor) load(); });
  panel.onChange(() => { if (shown() && signedIn()) load({ withProfile: true }); else if (shown()) render(); });
  setInterval(() => { if (signedIn() && document.visibilityState === 'visible') load(); }, POLL_MS);
  setInterval(() => { if (shown() && signedIn() && document.visibilityState === 'visible') load(); }, LIVE_MS);
  render();
  if (signedIn()) load();
  return { reload: () => load({ withProfile: true }) };
}
