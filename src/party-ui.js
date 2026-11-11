// Shared trips in the interface: the "Party Members" section of a trip's screen, and the trip invitations shown in the Friends tab.
// Built only when this build has accounts (see sync-ui.js). The sync itself is sharedtrip/engine.js.
import { createTripsApi } from './sharedtrip/api.js';
import { createSharedTrips } from './sharedtrip/engine.js';
import { describeWhen } from './sync/core.js';
import { presenceText } from './social.js';
import { createLive } from './live.js';
import { createLiveLayer } from './livemap.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const WHO_KEY = 'uavzones.v1.sharedwho';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** `handle` is what initSyncUI returns ({ sync, adapter, onChange, open }); `cloud` is the holder the dashboard reads. Returns the hooks the trips screen uses. */
export function initPartyUI({ handle, store, panel, toast, cloud, map }) {
  const api = createTripsApi(handle.adapter.client);
  const eng = createSharedTrips({ store, api });
  // Live locations: sending this device's position (only when the person turns it on, for one trip) and drawing the party's on the map
  const live = createLive({ api, getTrip: (id) => store.getTrip(id) });
  const layer = map ? createLiveLayer(map) : null;
  const HIDE_KEY = 'uavzones.v1.livehide'; // trips whose party this person chose not to see on the map
  const hiddenTrips = (() => { try { const a = JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'); return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []); } catch { return new Set(); } })();
  const saveHidden = () => { try { localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenTrips])); } catch { /* ignore */ } };
  const wantsLive = () => !!handle.sync.status().session && store.trips().some((t) => t.shared);
  const signedIn = () => !!handle.sync.status().session;
  let view = null; // the trips screen: { refresh() }
  const members = new Map();   // trip id -> { rev, list }
  const asking = new Set();
  const openParty = new Set(); // trips whose Party Members section is unfolded
  const invitable = new Map(); // trip id -> [{ friendship_id, display_name }]
  const openVersions = new Set(), versionsOf = new Map(); // the "Earlier versions" lists that are unfolded, and what they showed

  const refresh = () => view?.refresh?.();
  async function loadMembers(id, { force = false } = {}) {
    const rev = eng.snapshot().trips[id]?.members_rev ?? null;
    const have = members.get(id);
    if (asking.has(id) || (!force && have && have.rev === rev)) return;
    asking.add(id);
    let changed = true;
    try {
      const list = await eng.members(id);
      changed = !have || JSON.stringify(have.list) !== JSON.stringify(list); // a refresh that finds nothing new does not redraw the screen
      members.set(id, { rev, list });
      if (store.getTrip(id)?.shared?.owner) invitable.set(id, await eng.invitable(id));
    } catch { /* shown as loading; the next check tries again */ }
    asking.delete(id);
    if (changed) refresh();
  }
  // while a trip's Party Members is open, look every 30 s for who is online
  setInterval(() => {
    if (!signedIn() || document.visibilityState !== 'visible') return;
    const id = document.querySelector('#trip-detail:not([hidden]) .trip-party[open]')?.dataset.trip;
    if (id) loadMembers(id, { force: true });
  }, 30000);

  // ---------- keeping the engine running while signed in
  let started = false;
  function lifecycle() {
    const s = handle.sync.status().session;
    if (s && !started) {
      let who = null; try { who = localStorage.getItem(WHO_KEY); } catch { /* ignore */ }
      if (who && who !== s.email) eng.reset(); // another person signed in on this device: shared trips here are not theirs
      try { localStorage.setItem(WHO_KEY, s.email); } catch { /* ignore */ }
      started = true; eng.start(); live.startPolling(wantsLive); live.poll();
    } else if (!s && started) { started = false; eng.stop(); live.stopAll(); live.stopPolling(); layer?.clear(); }
  }
  eng.onChange(() => {
    for (const id of live.sharingIds()) if (!store.getTrip(id)?.shared) live.stop(id, 'You are no longer in this trip, so sharing your location stopped.');
    for (const m of eng.takeNotices()) toast(m, 9000);
    cloud.friends?.recount?.();
    refresh();
  });
  handle.onChange(lifecycle);
  lifecycle();
  document.addEventListener('visibilitychange', () => { if (started && document.visibilityState === 'visible') { eng.poll(); live.poll(); } });
  window.addEventListener('pagehide', () => { live.stopAll(); }); // closing the page ends sharing (the server forgets a position after 2 minutes in any case)


  // ---------- the indicator that stays on screen while this device is sharing
  const chip = el('div', 'live-chip'); chip.id = 'live-chip'; chip.hidden = true; chip.setAttribute('role', 'status');
  const chipText = el('span'); const chipStop = el('button', 'btn small', 'Stop'); chipStop.type = 'button'; chipStop.setAttribute('aria-label', 'Stop sharing my location');
  chipStop.addEventListener('click', () => live.stopAll('Sharing your location stopped.'));
  chip.append(chipText, chipStop); document.body.append(chip);
  function updateChip() {
    const ids = live.sharingIds();
    chip.hidden = !ids.length;
    if (ids.length) chipText.textContent = ids.length === 1 ? `Sharing your location with “${store.getTrip(ids[0])?.name ?? 'your party'}”` : `Sharing your location with ${ids.length} trips`;
  }
  let liveSig = '';
  live.onChange((s) => {
    layer?.update(s.others, hiddenTrips);
    for (const m of live.takeNotices()) toast(m, 9000);
    updateChip();
    // redraw the trip screen only when who is sharing changes, not on every new position (that would reset anything being typed)
    const sig = JSON.stringify([Object.entries(s.sharing).map(([id, v]) => [id, v.status, v.error]), s.others.map((o) => [o.trip_id, o.member_id])]);
    if (sig !== liveSig) { liveSig = sig; refresh(); }
  });

  // ---------- the section of a trip's screen
  const say = (m) => toast(m, 5000);
  const fail = (e) => say(e.message || String(e));
  async function share(t) {
    if (!confirm(`Share “${t.name}” with friends? Its ${plural(store.items().filter((i) => i.tripId === t.id).length, 'marker')} and details are stored on the server and shown to the friends you invite, who can then edit them. Your Home marker and your check-ins are never shared.`)) return;
    try { await eng.share(t.id); openParty.add(t.id); say('Shared. Invite friends in Party Members.'); } catch (e) { fail(e); }
    refresh();
  }
  async function leave(t) {
    if (!confirm(`Leave “${t.name}”? It stays on this device as a private trip, no longer updated.`)) return;
    try { await eng.leave(t.id); say('You left the trip. It is now a private copy.'); } catch (e) { fail(e); }
    refresh();
  }
  /** The owner deletes the shared trip for everyone, then the local trip. */
  async function deleteShared(t) {
    try { await eng.deleteShared(t.id); return true; } catch (e) { fail(e); return false; }
  }
  const statusText = (t) => {
    if (!signedIn()) return 'Sign in to sync changes with the party.';
    const st = eng.snapshot().trips[t.id];
    if (!st) return 'Checking…';
    if (st.status === 'error') return 'Could not sync: ' + st.error + '. Your changes stay on this device and will be tried again.';
    if (st.status === 'pending') return 'Waiting to save your changes…';
    if (st.status === 'syncing') return 'Saving…';
    return 'Up to date' + (st.lastBy ? ' · last change by ' + st.lastBy : '') + '.';
  };

  function section(t) {
    const box = el('details', 'trip-party'); box.dataset.trip = t.id;
    box.open = openParty.has(t.id);
    box.addEventListener('toggle', () => { if (box.open) openParty.add(t.id); else openParty.delete(t.id); });
    const mem = members.get(t.id)?.list;
    box.append(el('summary', '', 'Party Members' + (t.shared ? ` (${mem ? mem.filter((m) => m.status === 'joined').length : eng.snapshot().trips[t.id]?.members ?? '…'})` : '')));

    if (!t.shared) {
      box.append(el('p', 'hint', 'Plan this trip with friends. Party members can edit the trip and its markers; only you can delete it.'));
      if (!signedIn()) {
        const b = el('button', 'btn small', 'Sign in…'); b.type = 'button'; b.addEventListener('click', () => panel.openPrivacy());
        box.append(b, el('small', 'hint', ' Sign-in is under the shield button.'));
      } else {
        const b = el('button', 'btn small primary', 'Share this trip'); b.type = 'button'; b.addEventListener('click', () => share(t));
        box.append(b);
      }
      return box;
    }

    loadMembers(t.id);
    const owner = !!t.shared.owner;
    const status = el('p', 'hint party-status', statusText(t)); status.setAttribute('role', 'status');
    box.append(status);
    const mine = live.snapshot().sharing[t.id];
    const sw = el('label', 'switch'); const sp = el('span', '', 'Share my location with the party');
    sp.append(el('small', '', 'Only while this page is open: the others in the party see where you are on the map. It is off every time you open the app, and stops when you close it, sign out or leave the trip.'));
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'party-live'; cb.checked = !!mine; cb.disabled = !signedIn();
    cb.addEventListener('change', () => {
      if (cb.checked) { const r = live.start(t.id); if (!r.ok) { cb.checked = false; say(r.reason); } } else live.stop(t.id);
      updateChip(); refresh();
    });
    sw.append(sp, cb); box.append(sw);
    if (mine) box.append(el('p', 'hint party-live-status', mine.status === 'error' ? 'Could not send your position: ' + mine.error : mine.accuracy ? `Sharing your location · accurate to about ${Math.round(mine.accuracy)} m` : 'Waiting for a position…'));
    const sw2 = el('label', 'switch'); const sp2 = el('span', '', 'Show the party on the map');
    sp2.append(el('small', '', 'Pins with names for the party members who are sharing their location.'));
    const cb2 = el('input'); cb2.type = 'checkbox'; cb2.id = 'party-map'; cb2.checked = !hiddenTrips.has(t.id);
    cb2.addEventListener('change', () => { if (cb2.checked) hiddenTrips.delete(t.id); else hiddenTrips.add(t.id); saveHidden(); layer?.update(live.snapshot().others, hiddenTrips); });
    sw2.append(sp2, cb2); box.append(sw2);
    const sharers = new Map(live.snapshot().others.filter((o) => o.trip_id === t.id).map((o) => [o.member_id, o]));
    if (!mem) box.append(el('p', 'hint', 'Loading the party…'));
    else {
      const ul = el('ul', 'party-list');
      for (const m of mem) {
        const li = el('li', 'party-row');
        const who = el('span', 'party-who');
        if (m.online !== null && m.online !== undefined) { const dot = el('i', 'presence ' + (m.online ? 'on' : 'off')); dot.setAttribute('aria-hidden', 'true'); who.append(dot); }
        who.append(el('b', '', m.display_name));
        if (m.is_me) who.append(' ', el('span', 'badge', 'You'));
        if (m.role === 'owner') who.append(' ', el('span', 'badge ok', 'Owner'));
        if (m.status === 'invited') who.append(' ', el('span', 'badge', 'Invited'));
        const pt = m.status === 'joined' ? presenceText(m, describeWhen) : '';
        if (pt) who.append(' ', el('small', 'presence-text', pt));
        if (sharers.has(m.member_id)) who.append(' ', el('small', 'presence-text', '📍 sharing their location'));
        li.append(who);
        if (sharers.has(m.member_id)) {
          const sb = el('button', 'btn small', 'Show on map'); sb.type = 'button';
          sb.addEventListener('click', () => { if (layer?.focus(m.member_id)) panel.closeIfPhone(); else say('Turn on “Show the party on the map” to see them.'); });
          li.append(sb);
        }
        if (owner && m.role !== 'owner') {
          const b = el('button', 'btn small', m.status === 'invited' ? 'Cancel invite' : 'Remove'); b.type = 'button';
          b.addEventListener('click', async () => {
            if (m.status === 'joined' && !confirm(`Remove ${m.display_name} from the trip? They keep a private copy.`)) return;
            try { await eng.removeMember(t.id, m.member_id); members.delete(t.id); } catch (e) { fail(e); }
            refresh();
          });
          li.append(b);
        }
        ul.append(li);
      }
      box.append(ul);
    }
    if (owner) {
      const list = invitable.get(t.id);
      const row = el('form', 'party-invite');
      if (list && list.length) {
        const sel = el('select'); sel.setAttribute('aria-label', 'Friend to invite');
        for (const f of list) { const o = el('option', '', f.display_name); o.value = f.friendship_id; sel.append(o); }
        const b = el('button', 'btn small', 'Invite'); b.type = 'submit';
        row.append(sel, b);
        row.addEventListener('submit', async (e) => {
          e.preventDefault();
          try { await eng.invite(t.id, sel.value); members.delete(t.id); invitable.delete(t.id); say('Invitation sent.'); } catch (err) { fail(err); }
          refresh();
        });
      } else if (list) {
        row.append(el('small', 'hint', 'No friends to invite: they are all in this trip, or you have no friends yet. '));
        const b = el('button', 'btn small', 'Open Friends'); b.type = 'button'; b.addEventListener('click', () => panel.open('friends'));
        row.append(b);
      }
      box.append(row);
    } else {
      const b = el('button', 'btn small', 'Leave trip'); b.type = 'button'; b.addEventListener('click', () => leave(t));
      box.append(el('p', 'hint', 'You can edit this trip and its markers. Only the owner can delete it.'), b);
    }
    // earlier versions, loaded when opened
    const vbox = el('details', 'party-versions');
    vbox.append(el('summary', '', 'Earlier versions'));
    vbox.open = openVersions.has(t.id);
    const fill = (vs) => {
      vbox.querySelectorAll('.party-version, .hint').forEach((n) => n.remove());
      vbox.append(el('small', 'hint', vs.length ? 'Every change is kept for 30 days (the last 20). Restoring one replaces the trip for the whole party; the current version is kept too.' : 'No earlier versions yet.'));
      for (const v of vs) {
        const r = el('div', 'party-version');
        r.append(el('span', '', `${describeWhen(v.updated_at)} · ${v.updated_by_name} · ${plural(v.markers, 'marker')}`));
        const b = el('button', 'btn small', 'Restore'); b.type = 'button';
        b.addEventListener('click', async () => {
          if (!confirm('Restore this version for the whole party? The current version is kept, so this can be undone.')) return;
          try { await eng.restore(t.id, v.rev); say('Restored.'); } catch (e) { fail(e); }
          versionsOf.delete(t.id); refresh();
        });
        r.append(b); vbox.append(r);
      }
    };
    const load = async () => { try { const vs = await eng.versions(t.id); versionsOf.set(t.id, vs); fill(vs); } catch (e) { vbox.append(el('small', 'hint', e.message)); } };
    if (versionsOf.has(t.id)) fill(versionsOf.get(t.id));
    vbox.addEventListener('toggle', () => { if (vbox.open) { openVersions.add(t.id); load(); } else openVersions.delete(t.id); });
    if (vbox.open && !versionsOf.has(t.id)) load();
    box.append(vbox);
    return box;
  }

  // ---------- invitations, for the Friends tab
  function invitationsCard() {
    const inv = eng.snapshot().invitations;
    if (!inv.length) return null;
    const c = el('div', 'card'); c.id = 'party-invites';
    c.append(el('h2', '', 'Trip invitations'));
    for (const i of inv) {
      const r = el('div', 'fr-row');
      const who = el('div', 'fr-who'); who.append(el('b', '', i.name), el('small', '', `from ${i.ownerName}${i.startDate ? ' · ' + i.startDate + (i.endDate && i.endDate !== i.startDate ? ' to ' + i.endDate : '') : ''}`));
      const bs = el('div', 'fr-actions');
      const yes = el('button', 'btn small', 'Join'); yes.type = 'button';
      yes.addEventListener('click', async () => { try { await eng.respond(i.id, true); say(`You joined “${i.name}”. It is in your Trips.`); } catch (e) { fail(e); } cloud.friends?.recount?.(); refresh(); });
      const no = el('button', 'btn small', 'Decline'); no.type = 'button';
      no.addEventListener('click', async () => { try { await eng.respond(i.id, false); } catch (e) { fail(e); } cloud.friends?.recount?.(); });
      bs.append(yes, no); r.append(who, bs); c.append(r);
    }
    return c;
  }

  const party = {
    section, invitationsCard, leave, deleteShared,
    invitations: () => eng.snapshot().invitations,
    /** How many people are in a shared trip (joined), or null if not known yet. */
    membersCount: (id) => members.get(id)?.list.filter((m) => m.status === 'joined').length ?? eng.snapshot().trips[id]?.members ?? null,
    ready: signedIn,
    attach(v) { view = v; },
    onChange: (fn) => eng.onChange(fn),
    engine: eng,
  };
  cloud.party = party;
  return party;
}
