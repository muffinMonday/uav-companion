// The Steam card (in the Friends tab): what counts, linking a Steam account, how many hours have been credited, Sync now (with its cooldown) and Unlink.
// The database and the edge functions decide everything (see steam.js); this file only draws what it is given. Plain DOM, textContent only.
import { createSteam, waitText, returnResult, withoutResult, RESULT_TEXT } from './steam.js';
import { log } from './log.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const ago = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };

/** If Steam's sign-in has just sent the person back (?steam=...), says what happened once and tidies the address. */
export function announceSteamReturn(toast, loc = window.location, hist = window.history) {
  const r = returnResult(loc.search);
  if (!r) return null;
  try { hist.replaceState(hist.state, '', withoutResult(loc.href)); } catch { /* the address stays as it is */ }
  toast(RESULT_TEXT[r], 9000);
  return r;
}

/** `client` is the database client. `onChange()` runs after something that may change XP (a sync, a link). Returns { mount(host), reload(), reset() } like the sessions card. */
export function createSteamCard({ client, onChange = () => {} }) {
  const api = createSteam(client);
  let host = null, busy = false, message = '', seq = 0;
  let state = { status: 'loading', info: null, apps: [] };

  async function load() {
    const mine = ++seq;
    if (!state.info) { state = { ...state, status: 'loading' }; paint(); }
    try {
      const info = await api.status();
      const apps = state.apps.length || !info.enabled ? state.apps : await api.apps().catch((e) => { log.warn('steam', 'the app list did not load', e); return []; });
      if (mine !== seq) return;
      state = { status: 'ready', info, apps };
    } catch { if (mine === seq) state = { ...state, status: 'error' }; }
    if (mine === seq) paint();
  }

  async function act(fn, done) {
    if (busy) return; busy = true; message = ''; paint();
    try { const r = await fn(); message = typeof done === 'function' ? done(r) : done || ''; onChange(); } catch (e) { message = e.message || 'That did not work.'; }
    busy = false; await load();
  }

  function paint() {
    if (!host) return;
    const c = el('div', 'steam-card'); c.dataset.status = state.status;
    const info = state.info;
    if (state.status === 'loading') c.append(el('p', 'hint', 'Loading Steam…'));
    else if (state.status === 'error') { c.append(el('p', 'hint', 'Steam is unavailable right now.')); const r = btn('Try again'); r.addEventListener('click', () => load()); c.append(r); }
    else if (!info.enabled) { c.dataset.state = 'disabled'; c.append(el('p', 'hint', 'Linking a Steam account is not available yet. It will earn XP for playtime in FPV simulators.')); }
    else if (!info.linked) {
      c.dataset.state = 'unlinked';
      c.append(el('p', '', `Link your Steam account to earn ${info.xpPerHour} XP for every completed hour in an approved simulator.`));
      const ul = el('ul', 'steam-rules');
      for (const t of ['Your Steam profile’s Game details must be Public (Steam, Edit Profile, Privacy Settings, Game details). Otherwise nothing can be read.', 'Hours you played before linking count too, once per Steam account, and so does everything you play later.', 'Your Steam ID is never shown to anyone, and only the approved simulators count.']) ul.append(el('li', '', t));
      c.append(ul);
      if (state.apps.length) { const d = el('details', 'steam-apps'); d.append(el('summary', '', `Approved simulators (${state.apps.length})`)); const l = el('ul'); for (const a of state.apps) l.append(el('li', '', a.name)); d.append(l); c.append(d); }
      const b = btn(busy ? 'Opening Steam…' : 'Link Steam account', 'btn small primary'); b.dataset.act = 'link'; b.disabled = busy;
      b.addEventListener('click', async () => {
        if (busy) return; busy = true; message = ''; paint();
        try { const url = await api.startLink(window.location.origin + window.location.pathname); window.location.assign(url); return; }
        catch (e) { message = e.message || 'Could not start linking.'; busy = false; paint(); }
      });
      c.append(b);
    } else {
      c.dataset.state = 'linked';
      const head = el('div', 'steam-head'); head.append(el('b', '', 'Steam account linked'));
      c.append(head);
      const stats = el('div', 'steam-stats');
      stats.append(el('span', 'steam-hours', `${info.hours} ${info.hours === 1 ? 'hour' : 'hours'} credited`), el('small', 'steam-minutes', `${info.minutesToNext} min towards the next hour`));
      c.append(stats);
      c.append(el('small', 'steam-last', info.lastSyncedAt ? 'Last checked ' + ago(info.lastSyncedAt) + '. It is checked about once a day.' : 'Not checked yet. It is checked about once a day.'));
      if (info.lastStatus === 'private') c.append(el('p', 'hint steam-warn', 'Steam says your Game details are private, so no playtime can be read. Set Game details to Public in your Steam privacy settings.'));
      else if (info.lastStatus === 'error') c.append(el('p', 'hint steam-warn', 'The last check could not reach Steam. It will try again.'));
      const row = el('div', 'btn-row');
      const wait = info.manualAvailableAt ? waitText(info.manualAvailableAt) : '';
      const sync = btn(wait ? `Sync now (in ${wait})` : busy ? 'Syncing…' : 'Sync now'); sync.dataset.act = 'sync'; sync.disabled = !!wait || busy;
      sync.addEventListener('click', () => act(() => api.syncNow(), (r) => (r?.status === 'private' ? 'Steam says your Game details are private. Make them public and try again.' : r?.hours_added > 0 ? `Synced: ${r.hours_added} new ${r.hours_added === 1 ? 'hour' : 'hours'} credited.` : 'Synced: no new completed hour yet.')));
      const un = btn('Unlink', 'btn small danger'); un.dataset.act = 'unlink'; un.disabled = busy;
      un.addEventListener('click', () => { if (window.confirm('Unlink your Steam account? Hours already credited stay. If you link again, playtime in between is not counted.')) act(() => api.unlink(), 'Steam account unlinked.'); });
      row.append(sync, un); c.append(row);
    }
    if (message) { const m = el('p', 'hint steam-message', message); m.setAttribute('role', 'status'); c.append(m); }
    host.replaceChildren(c);
  }

  return {
    mount(h) { host = h; paint(); },
    reload: load,
    reset() { seq++; state = { status: 'loading', info: null, apps: [] }; message = ''; busy = false; paint(); },
  };
}
