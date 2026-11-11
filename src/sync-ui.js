// The optional cloud copy: a card in the privacy settings to sign in with an email link and see the sync state, and the question that appears
// when this device and the cloud copy both changed. Does nothing (and loads nothing) unless the build has a project address; see sync/.
import { configured } from './sync/supabase.js';
import { deviceName, describeWhen } from './sync/core.js';
import { toGeoJSON } from './poi.js';

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
  const sync = createSync({ store, adapter, device: deviceName(navigator.userAgent), backup: async (side, doc) => download(side, doc) });

  const card = el('div', 'card'); card.id = 'cloud-card';
  anchor.after(card);
  const dlg = el('dialog', 'cloud-dialog'); dlg.setAttribute('aria-labelledby', 'cloud-q-title');
  document.body.append(dlg);
  const listeners = new Set();
  let message = '', versions = null;

  function render(s = sync.status()) {
    card.replaceChildren(el('h2', '', 'Cloud copy (optional)'));
    if (!s.session) {
      card.append(el('p', 'hint', 'Sign in to keep a copy of your markers and trips on a server, so they follow you to other devices. Without it everything stays in this browser. Weather caches, privacy choices and check-in positions are never uploaded.'));
      const f = el('form', 'cloud-form');
      const input = el('input'); input.type = 'email'; input.required = true; input.placeholder = 'you@example.com'; input.autocomplete = 'email'; input.setAttribute('aria-label', 'Email address');
      const b = el('button', 'btn small', 'Email me a sign-in link'); b.type = 'submit';
      f.append(input, b);
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); b.disabled = true;
        const r = await sync.signIn(input.value.trim());
        message = r.ok ? 'Check your email for the link, open it on this device, and you will be signed in.' : 'Could not send the link: ' + r.error;
        b.disabled = false; render();
      });
      card.append(f);
      if (message) { const m = el('p', 'hint', message); m.setAttribute('role', 'status'); card.append(m); }
      return;
    }
    card.append(el('p', '', 'Signed in as ' + s.session.email));
    const line = el('p', 'hint cloud-status', statusLine(s)); line.setAttribute('role', 'status'); card.append(line);
    const row = el('div', 'btn-row');
    const btn = (label, fn) => { const b = el('button', 'btn small', label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); return b; };
    if (s.status === 'ask') btn('Choose…', () => question(s));
    btn('Sync now', () => sync.sync());
    btn('Earlier versions', async () => { try { versions = await adapter.listVersions(); } catch (e) { toast('Could not load versions: ' + e.message); return; } render(); });
    btn('Sign out', async () => { await sync.signOut(); message = ''; versions = null; render(); toast('Signed out. Your data stays on this device.'); });
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
  adapter.onAuthChange?.((ev) => { if (ev === 'SIGNED_IN') sync.sync(); });
  render();
  sync.start();
  return {
    line: () => (sync.status().session ? statusLine(sync.status()) : null),
    onChange: (fn) => listeners.add(fn),
    open: () => $('privacy-btn')?.click(),
    sync,
  };
}
