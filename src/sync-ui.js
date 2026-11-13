// The optional cloud copy: a card in the privacy settings with the sync state and its tools, the sign-in form and sign-out flow that the
// account button (account-ui.js) uses, and the question that appears when this device and the cloud copy both changed. Does nothing (and loads nothing) unless the build has a project address; see sync/.
import { configured } from './sync/supabase.js';
import { deviceName, describeWhen, buildDoc } from './sync/core.js';
import { toGeoJSON } from './poi.js';
import { themeSetting, adoptTheme, onThemeChoice } from './theme.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What the status line says, for the card and the dashboard. */
export function statusLine(s, now = Date.now()) {
  if (!s || s.status === 'off') return 'Not signed in.';
  if (s.status === 'syncing') return 'Syncing…';
  if (s.status === 'ask') return 'Your cloud copy and this device differ. Choose which to keep.';
  if (s.status === 'error') return 'Could not sync: ' + s.error + '. Your data on this device is unchanged.';
  if (s.baseRev == null && !s.dirty) return 'No cloud copy yet. It is created at your next change.';
  if (s.dirty) return 'Changes on this device will upload shortly.';
  return s.lastSyncedAt ? 'Cloud copy up to date (' + describeWhen(s.lastSyncedAt, now) + ').' : 'Cloud copy up to date.';
}

/** Offers the file download of one side's data. */
function download(side, doc) {
  const blob = new Blob([JSON.stringify(toGeoJSON(doc.items ?? [], doc.trips ?? []), null, 2)], { type: 'application/geo+json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `uav-companion-${side === 'cloud' ? 'cloud-copy' : 'this-device'}-${new Date().toISOString().slice(0, 10)}.geojson`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function initSyncUI({ store, toast }) {
  if (!configured()) return null;
  const anchor = $('pv-checkin')?.closest('.card');
  if (!anchor) return null;
  const [{ createSupabaseAdapter }, { createSync }] = await Promise.all([import('./sync/supabase.js'), import('./sync/engine.js')]);
  let adapter;
  try { adapter = await createSupabaseAdapter(); } catch (e) { console.warn('cloud copy unavailable', e); return null; }
  const sync = createSync({ store, adapter, device: deviceName(navigator.userAgent), settings: { get: themeSetting, apply: adoptTheme }, backup: async (side, doc) => download(side, doc) });
  onThemeChoice(() => sync.noteSettings()); // the theme travels with the cloud copy (last choice wins)
  { // coming back to the tab: a quick look for a newer theme chosen on another device, at most once a minute
    let last = 0;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - last > 60000) { last = Date.now(); sync.checkSettings(); } });
  }

  const card = el('div', 'card'); card.id = 'cloud-card';
  anchor.after(card);
  const dlg = el('dialog', 'cloud-dialog'); dlg.setAttribute('aria-labelledby', 'cloud-q-title');
  document.body.append(dlg);
  const listeners = new Set();
  let versions = null;
  const handle = {};

  /** The email sign-in form with its own status line; the account popover shows it. */
  function signInForm() {
    const box = el('div', 'cloud-signin');
    const f = el('form', 'cloud-form');
    const input = el('input'); input.type = 'email'; input.required = true; input.placeholder = 'you@example.com'; input.autocomplete = 'email'; input.setAttribute('aria-label', 'Email address');
    const b = el('button', 'btn small', 'Email me a sign-in link'); b.type = 'submit';
    const m = el('p', 'hint'); m.setAttribute('role', 'status'); m.hidden = true;
    f.append(input, b);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); b.disabled = true;
      const r = await sync.signIn(input.value.trim());
      m.textContent = r.ok ? 'Check your email for the link, open it on this device, and you will be signed in.' : 'Could not send the link: ' + r.error;
      m.hidden = false; b.disabled = false;
    });
    box.append(f, m);
    return box;
  }

  /** Signs out: warns when something exists only here, offers the backup, then clears this device's markers and trips. Resolves true when signed out. */
  async function signOut() {
    let r = await sync.signOut({ wipe: true });
    if (!r.ok) {
      const why = r.reason === 'checkins' ? 'Your check-ins are not uploaded, so they exist only on this device.' : 'Your latest changes have not reached the cloud copy.';
      if (!confirm(why + ' Download a backup of this device and sign out? Its markers and trips will be removed from this device.')) return false;
      r = await sync.signOut({ wipe: true, force: true });
    }
    versions = null; render();
    toast('Signed out. This device\'s markers and trips were removed; they stay in your cloud copy.', 8000);
    return true;
  }

  /** Offers this device's markers and trips (check-ins included) as a GeoJSON download. */
  function backupThisDevice() { download('device', buildDoc({ items: store.items(), trips: store.trips(), includeCheckins: true })); }

  /**
   * Deletes the account on the server (the delete-account edge function: the app data, then the sign-in record), then signs this browser out. Markers and trips on
   * this device are kept: they are the only copy left, and the person is now a guest here. Throws an Error with the server's own message.
   */
  async function deleteAccount() {
    const r = await adapter.client.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
    if (r.error) {
      let m = r.error.message;
      try { const b = await r.error.context?.json(); if (b?.error) m = b.error; } catch { /* keep the generic message */ }
      throw new Error(m);
    }
    try { await sync.signOut(); } catch (e) { console.warn('sign-out after deletion', e); }
    versions = null; render();
  }

  function render(s = sync.status()) {
    card.replaceChildren(el('h2', '', 'Cloud copy (optional)'));
    if (!s.session) {
      card.append(el('p', 'hint', 'Sign in to keep a copy of your markers and trips on a server, so they follow you to other devices. Without it everything stays in this browser. Weather caches, privacy choices and check-in positions are never uploaded.'));
      const b = el('button', 'btn small', 'Sign in…'); b.type = 'button'; b.addEventListener('click', () => handle.open());
      card.append(b);
      return;
    }
    const line = el('p', 'hint cloud-status', statusLine(s)); line.setAttribute('role', 'status'); card.append(line);
    const row = el('div', 'btn-row');
    const btn = (label, fn) => { const b = el('button', 'btn small', label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); return b; };
    if (s.status === 'ask') btn('Choose…', () => question(s));
    btn('Sync now', () => sync.sync());
    btn('Earlier versions', async () => { try { versions = await adapter.listVersions(); } catch (e) { toast('Could not load versions: ' + e.message); return; } render(); });
    card.append(row);
    if (versions) {
      const box = el('div', 'cloud-versions');
      box.append(el('small', '', versions.length ? 'Earlier versions are kept for 30 days (most recent 20). Restoring replaces this device\'s data; a copy of it is offered for download first.' : 'No earlier versions yet.'));
      for (const v of versions) {
        const r = el('div', 'cloud-version');
        r.append(el('span', '', `${describeWhen(v.updated_at)} · ${v.device || 'a device'} · ${plural(v.markers, 'marker')}, ${plural(v.trips, 'trip')}`));
        const b = el('button', 'btn small', 'Restore'); b.type = 'button';
        b.addEventListener('click', async () => { versions = null; await sync.restoreVersion(v.rev); render(); });
        r.append(b); box.append(r);
      }
      card.append(box);
    }
    const del = el('button', 'btn small danger', 'Delete my cloud copy'); del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm('Delete your cloud copy and all its earlier versions? Markers and trips on this device stay. You can upload again later.')) return;
      try { await sync.deleteCloud(); toast('Cloud copy deleted.'); } catch (e) { toast('Could not delete: ' + e.message); }
      render();
    });
    card.append(del);
  }

  function question(s) {
    const p = s.pending; if (!p) return;
    const c = p.cloud, l = p.local, d = p.diff;
    dlg.replaceChildren();
    const h = el('h2', '', p.cloudReset ? 'Your cloud copy was reset' : p.neverSynced ? 'Your cloud copy already has data' : 'Both copies changed'); h.id = 'cloud-q-title';
    dlg.append(h);
    dlg.append(el('p', 'hint', p.cloudReset ? 'The cloud copy is older than the one this device last synced from.' : p.neverSynced ? 'This device has markers of its own and so does your cloud copy.' : 'This device and your cloud copy have both changed since they last matched. Nothing has been overwritten.'));
    const t = el('div', 'cloud-compare');
    const col = (title, lines) => { const x = el('div'); x.append(el('b', '', title)); for (const t2 of lines) x.append(el('div', '', t2)); return x; };
    t.append(
      col('Cloud copy', [`${plural(c.markers, 'marker')}, ${plural(c.trips, 'trip')}`, `changed ${describeWhen(c.updated_at)}`, c.device ? `on ${c.device}` : '']),
      col('This device', [`${plural(l.markers, 'marker')}, ${plural(l.trips, 'trip')}`]),
    );
    dlg.append(t);
    if (d) dlg.append(el('p', 'hint', `Only on the cloud: ${plural(d.markers.onlyCloud, 'marker')} and ${plural(d.trips.onlyCloud, 'trip')}. Only here: ${plural(d.markers.onlyLocal, 'marker')} and ${plural(d.trips.onlyLocal, 'trip')}. Changed on both sides: ${d.markers.differ + d.trips.differ}.`));
    const lab = el('label', 'switch'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
    const sp = el('span', '', 'Download the side that is replaced first (recommended)'); lab.append(sp, cb);
    dlg.append(lab);
    const row = el('div', 'btn-row');
    const pick = async (choice) => { dlg.close(); await sync.resolve(choice, { backup: cb.checked }); };
    const a = el('button', 'btn', 'Use the cloud copy'); a.type = 'button'; a.addEventListener('click', () => pick('cloud'));
    const b = el('button', 'btn', 'Keep this device'); b.type = 'button'; b.addEventListener('click', () => pick('device'));
    const later = el('button', 'btn small', 'Decide later'); later.type = 'button'; later.addEventListener('click', () => dlg.close());
    row.append(a, b, later);
    dlg.append(row);
    if (!dlg.open) dlg.showModal();
  }

  let asked = false;
  sync.onStatus((s) => {
    if (s.status === 'ask' && !asked) { asked = true; question(s); }
    if (s.status !== 'ask') { asked = false; if (dlg.open) dlg.close(); }
    render(s); listeners.forEach((fn) => fn(s));
  });
  adapter.onAuthChange?.((ev) => { sync.sync(); }); // SIGNED_IN: sync; SIGNED_OUT (another tab, or a refresh that failed): sync() finds no session and the polls stop
  render();
  sync.start();
  Object.assign(handle, {
    line: () => (sync.status().session ? statusLine(sync.status()) : null),
    onChange: (fn) => listeners.add(fn),
    /** Opens the account popover (account-ui.js sets `account`); the privacy settings until it exists. */
    open: () => (handle.account ? handle.account.open() : $('privacy-btn')?.click()),
    signInForm,
    signOut,
    backupThisDevice,
    deleteAccount,
    sync,
    adapter,
  });
  return handle;
}
