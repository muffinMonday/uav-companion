// The Edit profile dialog: display name, avatar, bio, location, interests and who sees them, plus a preview of how others see the profile.
// It opens only from an Edit profile button (the account popover and the Friends tab); it is not a tab and has no rail icon.
import { createProfileEditor } from './profile-ui.js';
import { profileContent } from './profile-popover.js';
import { onDialogSwipe } from './swipe.js';
import { showModalQuiet } from './touch.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** `social` is createSocial(client); `progression` is getProgression(client) (the preview shows your own rank and achievements); `onSaved(profile)` runs after a save (the callers refresh their copy of the profile). */
export function createProfileDialog({ social, progression = null, toast, onSaved }) {
  const dlg = el('dialog', 'account-dialog profile-dialog'); dlg.id = 'profile-dialog'; dlg.setAttribute('aria-labelledby', 'profile-dialog-title');
  document.body.append(dlg);
  let profile = null, mode = 'edit', nameDraft = null;

  const editor = createProfileEditor({
    toast, rerender: () => paint(),
    save: async (patch) => { try { profile = await social.updateProfile(patch); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
    saved: () => { dlg.close(); onSaved?.(profile); },
    getName: () => (nameDraft !== null && nameDraft !== profile.display_name ? nameDraft : undefined),
  });

  const unsaved = () => editor.isDirty() || (nameDraft !== null && nameDraft !== profile?.display_name);
  const leave = () => { if (unsaved() && !confirm('Discard your unsaved changes?')) return; dlg.close(); };
  dlg.addEventListener('cancel', (e) => { if (unsaved() && !confirm('Discard your unsaved changes?')) e.preventDefault(); }); // Escape
  onDialogSwipe(dlg, { close: leave }); // a swipe down on a phone is Cancel (and asks first when there are unsaved changes)
  const closeBtn = (label = 'Cancel') => { const b = el('button', 'btn small', label); b.type = 'button'; b.addEventListener('click', leave); return b; };

  function paint() {
    dlg.replaceChildren();
    const h = el('h2', '', mode === 'edit' ? 'Edit profile' : 'Preview'); h.id = 'profile-dialog-title';
    if (mode === 'edit') {
      const lab = el('label', 'fr-label', 'Display name'); lab.setAttribute('for', 'pf-name');
      const name = el('input'); name.type = 'text'; name.id = 'pf-name'; name.maxLength = 40; name.autocomplete = 'off'; name.value = nameDraft ?? profile.display_name;
      name.setAttribute('aria-required', 'true');
      name.addEventListener('input', () => { nameDraft = name.value; name.setAttribute('aria-invalid', String(!name.value.trim())); });
      const row = el('div', 'btn-row');
      const prev = el('button', 'btn small', 'Preview as others see it'); prev.type = 'button'; prev.id = 'pf-preview-btn';
      prev.addEventListener('click', () => { mode = 'preview'; paint(); });
      row.append(prev, closeBtn());
      const gi = el('div', 'pf-group'); gi.append(el('h3', '', 'Identity'));
      dlg.append(h, gi, lab, name, editor.card(profile), row, editor.foot()); // Save sits under Preview and Cancel
      return;
    }
    const d = editor.draft();
    const view = { display_name: (nameDraft ?? profile.display_name).trim() || profile.display_name, avatar: d.avatar, ...(d.share ? { bio: d.bio, location: d.location, interests: d.interests } : {}) };
    const note = el('p', 'hint', 'This is what your friends and the people in your shared trips see. Anyone else sees nothing.');    const back = el('button', 'btn small', 'Back to editing'); back.type = 'button'; back.id = 'pf-preview-back';
    back.addEventListener('click', () => { mode = 'edit'; paint(); });
    const row = el('div', 'btn-row'); row.append(back, closeBtn());
    // the same body as the profile popover (profile-popover.js), without the XP history button; with the visibility switch off, others see no progression
    const box = el('div', 'pf-preview-box'); box.id = 'pf-preview';
    box.append(...profileContent(view, progression && d.share ? { load: () => progression.mine(), peek: () => progression.peek('me', null), mode: 'other' } : {}));
    if (!d.share) box.append(el('small', 'hint', 'Your rank, XP and achievements are hidden.'));
    dlg.append(h, note, box, row);
  }

  return {
    async open() {
      editor.reset(); nameDraft = null; mode = 'edit';
      try { profile = await social.profile(); } catch (e) { toast(e.message); return; }
      paint();
      showModalQuiet(dlg);
    },
    close: () => { if (dlg.open) dlg.close(); },
  };
}
