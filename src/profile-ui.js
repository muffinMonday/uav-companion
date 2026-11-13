// The profile editor (drawn inside the Edit profile dialog, see profile-dialog.js), the profile view, and the small lines that show someone's bio, location and interests next to their name.
// What is shown to others, and to whom, is decided by the database (see supabase/migrations/20261112110000_profile.sql); this file only draws what it is given.
import { AVATARS, INTERESTS, MAX_INTERESTS, MAX_BIO, MAX_LOCATION, avatarEl, interestLabel } from './avatars.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** The lines under a name: "Wuhan · FPV freestyle, Hiking" and the bio. A row without any of them gives []. Works on a list_friends or list_trip_members row. */
export function profileBits(row) {
  const out = [];
  const tags = (row?.interests ?? []).map(interestLabel).join(', ');
  const line = [row?.location, tags].filter(Boolean).join(' · ');
  if (line) out.push(el('small', 'profile-bits', line));
  if (row?.bio) out.push(el('small', 'profile-bio', row.bio));
  return out;
}

/** A profile as someone else sees it (also the preview in the editor): avatar, name and, when the row carries them, location, interests and bio. Takes a list_friends row, a list_trip_members row or a draft. */
export function profileView(row) {
  const v = el('div', 'pv');
  const head = el('div', 'pv-head');
  head.append(avatarEl(row.avatar, row.display_name, 56));
  const who = el('div', 'pv-who'); who.append(el('b', 'pv-name', row.display_name));
  head.append(who);
  v.append(head);
  const bits = profileBits(row);
  if (bits.length) v.append(...bits); else v.append(el('small', 'pv-none', 'No more details are shared.'));
  return v;
}

/**
 * The editor. `save(patch)` sends a patch to update_profile and resolves { ok: true } or { ok: false, error }, after the caller holds the new profile;
 * `rerender()` redraws the dialog; `toast` shows a line; `saved()` is called after a full save; `getName()` gives a changed display name to send with it (or undefined).
 * The draft lives here, not in the card, so redrawing the card (after a save, or switching to the preview and back) does not lose what is being typed.
 */
export function createProfileEditor({ save, toast, rerender, saved, getName }) {
  const d = { dirty: false, avatar: null, bio: '', location: '', interests: [], share: true };
  const take = (p) => { if (d.dirty) return; Object.assign(d, { avatar: p.avatar ?? null, bio: p.bio ?? '', location: p.location ?? '', interests: [...(p.interests ?? [])], share: p.share_profile !== false }); };
  let note = '', foot = null; // foot: the Save button and its message, drawn by the dialog below its own buttons

  function card(profile) {
    take(profile);
    const c = el('div', 'card profile-card'); c.id = 'pf-card';
    c.append(el('h2', '', 'Profile'));
    const msg = el('p', 'hint pf-msg', note); msg.setAttribute('role', 'alert'); msg.hidden = !note;
    const say = (t) => { note = t; msg.textContent = t; msg.hidden = !t; };
    const touch = () => { d.dirty = true; say(''); };

    const group = (title, hint) => { const h = el('div', 'pf-group'); h.append(el('h3', '', title)); if (hint) h.append(el('small', '', hint)); return h; };
    const optional = (label, text) => { label.append(' ', el('small', 'pf-opt', '(optional)')); return label; };
    c.append(group('Photo', 'Pick one, or tap it again to go back to the default.'));
    // ---- avatar
    const head = el('div', 'pf-head');
    const preview = el('span', 'pf-preview'); const paint = () => preview.replaceChildren(avatarEl(d.avatar, profile.display_name, 44));
    paint();
    head.append(preview, el('b', '', 'Avatar'));
    const grid = el('div', 'pf-avatars'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Choose an avatar');
    const picks = [];
    for (const a of AVATARS) {
      const b = el('button', 'pf-pick'); b.type = 'button'; b.dataset.pick = a.key; b.title = a.label; b.setAttribute('aria-label', a.label); b.setAttribute('aria-pressed', String(d.avatar === a.key));
      b.append(avatarEl(a.key, '', 34));
      b.addEventListener('click', () => { d.avatar = d.avatar === a.key ? null : a.key; touch(); picks.forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.pick === d.avatar))); paint(); });
      picks.push(b); grid.append(b);
    }
    c.append(head, grid);

    // ---- bio
    c.append(group('About you', 'Everything here is optional. Empty a field to remove it.'));
    const bl = optional(el('label', 'fr-label', 'Bio')); bl.setAttribute('for', 'pf-bio');
    const bio = el('textarea'); bio.id = 'pf-bio'; bio.rows = 2; bio.maxLength = MAX_BIO; bio.value = d.bio; bio.placeholder = 'A line about you and your flying';
    const count = el('small', 'pf-count', `${d.bio.length}/${MAX_BIO}`);
    bio.addEventListener('input', () => { d.bio = bio.value; count.textContent = `${bio.value.length}/${MAX_BIO}`; touch(); });
    const bioRow = el('div', 'pf-row'); bioRow.append(count);
    c.append(bl, bio, bioRow);

    // ---- location (typed text; the app never reads a position for it)
    const ll = optional(el('label', 'fr-label', 'Location')); ll.setAttribute('for', 'pf-location');
    const loc = el('input'); loc.type = 'text'; loc.id = 'pf-location'; loc.maxLength = MAX_LOCATION; loc.value = d.location; loc.placeholder = 'For example Wuhan, China'; loc.autocomplete = 'off';
    loc.addEventListener('input', () => { d.location = loc.value; touch(); });
    const locRow = el('div', 'pf-row'); locRow.append(el('small', 'pf-count', 'Typed by you; your position is never used.'));
    c.append(ll, loc, locRow);

    // ---- interests
    const il = optional(el('div', 'fr-label', `Interests (up to ${MAX_INTERESTS})`));
    const tags = el('div', 'pf-tags'); tags.setAttribute('role', 'group'); tags.setAttribute('aria-label', 'Interests');
    for (const t of INTERESTS) {
      const b = el('button', 'chip', t.label); b.type = 'button'; b.dataset.interest = t.key; b.setAttribute('aria-pressed', String(d.interests.includes(t.key)));
      b.addEventListener('click', () => {
        if (d.interests.includes(t.key)) d.interests = d.interests.filter((k) => k !== t.key);
        else if (d.interests.length >= MAX_INTERESTS) { say(`Choose up to ${MAX_INTERESTS} interests.`); return; }
        else d.interests = [...d.interests, t.key];
        touch(); b.setAttribute('aria-pressed', String(d.interests.includes(t.key)));
      });
      tags.append(b);
    }
    c.append(il, tags);

    // ---- who sees the bio, location and interests
    c.append(group('Visibility'));
    const sw = el('label', 'switch'); const sp = el('span', '', 'Show my bio, location, interests and progression');
    sp.append(el('small', '', 'To your friends and the people in your shared trips: the bio, location and interests, and your rank, XP and achievements (on the map too). Your name and avatar are shown to them either way. Off: they see only those two.'));
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'pf-share'; cb.checked = d.share;
    cb.addEventListener('change', () => { d.share = cb.checked; touch(); });
    sw.append(sp, cb); c.append(sw);

    const go = el('button', 'btn primary', 'Save profile'); go.type = 'button'; go.id = 'pf-save';
    go.addEventListener('click', async () => {
      const name = getName?.();
      if (name !== undefined && !name.trim()) { say('Display name cannot be empty.'); return; }
      go.disabled = true; go.textContent = 'Saving…'; c.setAttribute('aria-busy', 'true');
      const r = await save({ ...(name !== undefined ? { display_name: name } : {}), avatar: d.avatar, bio: d.bio, location: d.location, interests: d.interests, share_profile: d.share });
      go.disabled = false; go.textContent = 'Save profile'; c.removeAttribute('aria-busy');
      if (r.ok) { d.dirty = false; note = ''; rerender(); toast('Profile saved.'); saved?.(); } else say(r.error);
    });
    foot = el('div', 'pf-foot'); foot.append(go, msg);
    return c;
  }
  return { card, foot: () => foot, draft: () => ({ avatar: d.avatar, bio: d.bio, location: d.location, interests: [...d.interests], share: d.share }), reset: () => { d.dirty = false; note = ''; }, isDirty: () => d.dirty };
}
