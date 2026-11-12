// The Flight sessions card (in the Friends tab): the upcoming sessions with RSVP and withdraw; for organisers and administrators also creating a session, the people
// who said they will come, marking someone present (from the RSVP list or by friend code), closing or cancelling, and, for administrators, revoking a mistaken mark.
// The database decides everything (see sessions.js); this file only draws what it is given. Plain DOM, textContent only.
import { createSessions, sessionState, whenText } from './sessions.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** `client` is the database client. Returns { mount(host), reload(), reset() }: mount only draws; reload() fetches (the Friends tab calls it when it loads); reset() forgets everything (sign-out). */
export function createSessionsCard({ client }) {
  const api = createSessions(client);
  let host = null, state = { status: 'loading', list: [], roles: { admin: false, organiser: false } };
  const open = new Set();          // session ids whose manage panel is open
  const people = new Map();        // session id -> list of people (loaded when the panel opens)
  let message = '', busy = false, seq = 0, showForm = false;

  async function load() {
    const mine = ++seq;
    if (!state.list.length) { state = { ...state, status: 'loading' }; paint(); }
    try {
      const [list, roles] = await Promise.all([api.list(), api.roles()]);
      if (mine !== seq) return;
      state = { status: 'ready', list, roles };
      await Promise.all([...open].map(async (id) => { if (list.some((s) => s.id === id && s.canManage)) { try { people.set(id, await api.people(id)); } catch { people.delete(id); } } else open.delete(id); }));
    } catch { if (mine === seq) state = { ...state, status: 'error' }; }
    if (mine === seq) paint();
  }

  async function act(fn, done) {
    if (busy) return; busy = true; message = '';
    try { const r = await fn(); message = typeof done === 'function' ? done(r) : done || ''; } catch (e) { message = e.message || 'That did not work.'; }
    busy = false; await load();
  }

  function sessionRow(s) {
    const now = Date.now(), st = sessionState(s, now);
    const row = el('div', 'ses-row'); row.dataset.id = s.id; row.dataset.status = s.status;
    const top = el('div', 'ses-top'); top.append(el('b', 'ses-title', s.title));
    if (s.status !== 'scheduled') top.append(el('span', 'badge', s.status === 'closed' ? 'Closed' : 'Cancelled'));
    else if (st.started) top.append(el('span', 'badge ok', st.over ? 'Ended' : 'Under way'));
    row.append(top, el('small', 'ses-when', whenText(s.startsAt, s.endsAt) + (s.location ? ' · ' + s.location : '')));
    if (s.description) row.append(el('small', 'ses-desc', s.description));
    row.append(el('small', 'ses-count', s.rsvpCount === 1 ? '1 person is coming' : `${s.rsvpCount} people are coming`));
    const bs = el('div', 'btn-row');
    if (s.myAttended) bs.append(el('span', 'badge ok ses-attended', 'You were there'));
    if (st.canRsvp) { const b = btn('I will come', 'btn small primary'); b.dataset.act = 'rsvp'; b.addEventListener('click', () => act(() => api.rsvp(s.id), 'You are on the list.')); bs.append(b); }
    else if (s.iRsvped && s.status === 'scheduled') {
      if (st.canWithdraw) { const b = btn('Withdraw'); b.dataset.act = 'withdraw'; b.addEventListener('click', () => act(() => api.withdraw(s.id), 'Removed from the list.')); bs.append(b); }
      else bs.append(el('span', 'badge', 'You said you will come'));
    }
    if (s.canManage) {
      const m = btn(open.has(s.id) ? 'Hide manage' : 'Manage'); m.dataset.act = 'manage'; m.setAttribute('aria-expanded', String(open.has(s.id)));
      m.addEventListener('click', async () => { if (open.has(s.id)) open.delete(s.id); else { open.add(s.id); try { people.set(s.id, await api.people(s.id)); } catch (e) { message = e.message; } } paint(); });
      bs.append(m);
    }
    row.append(bs);
    if (s.canManage && open.has(s.id)) row.append(managePanel(s, st));
    return row;
  }

  function managePanel(s, st) {
    const p = el('div', 'ses-manage');
    const list = people.get(s.id) ?? [];
    p.append(el('h3', '', `People (${list.length})`));
    if (!list.length) p.append(el('p', 'hint', 'Nobody has said they will come yet.'));
    for (const x of list) {
      const r = el('div', 'ses-person'); r.dataset.name = x.name;
      r.append(el('b', '', x.name), el('small', '', x.attended ? (x.source === 'walk_in' ? 'Present (walk-in)' : 'Present') : x.revoked ? 'Mark revoked' : 'Said they will come'));
      if (x.rsvpId && !x.attended && !x.revoked && st.canMark) { const b = btn('Mark present'); b.dataset.act = 'mark'; b.addEventListener('click', () => act(() => api.mark(s.id, 'rsvp', x.rsvpId), (res) => `${res.display_name}: ${res.status === 'marked' ? 'marked present' : 'already marked'}.`)); r.append(b); }
      if (x.attendanceId && x.attended && state.roles.admin) { const b = btn('Revoke'); b.dataset.act = 'revoke'; b.addEventListener('click', () => { const why = window.prompt('Why is this mark being revoked? (required, shown in their XP history)'); if (why && why.trim()) act(() => api.revoke(s.id, x.attendanceId, why), 'Mark revoked.'); }); r.append(b); }
      p.append(r);
    }
    if (s.status === 'scheduled') {
      if (!st.started) p.append(el('p', 'hint', 'Attendance can be marked once the session has started.'));
      else {
        const f = el('form', 'fr-name ses-walkin');
        const i = el('input'); i.type = 'text'; i.placeholder = 'Friend code of someone who came without RSVP'; i.autocomplete = 'off'; i.maxLength = 20; i.setAttribute('aria-label', 'Friend code of a walk-in');
        const g = btn('Mark present', 'btn small'); g.type = 'submit'; g.dataset.act = 'mark-code';
        f.append(i, g);
        f.addEventListener('submit', (e) => { e.preventDefault(); const v = i.value.trim(); if (!v) return; act(() => api.mark(s.id, 'code', v), (res) => `${res.display_name}: ${res.status === 'marked' ? 'marked present' : 'already marked'}.`); });
        p.append(f);
      }
      const row = el('div', 'btn-row');
      const close = btn('Close session'); close.dataset.act = 'close'; close.addEventListener('click', () => { if (window.confirm('Close this session? Nobody can be marked present afterwards.')) act(() => api.close(s.id), 'Session closed.'); });
      const cancel = btn('Cancel session', 'btn small danger'); cancel.dataset.act = 'cancel'; cancel.addEventListener('click', () => { if (window.confirm('Cancel this session?')) act(() => api.cancel(s.id), 'Session cancelled.'); });
      row.append(close, cancel); p.append(row);
    }
    return p;
  }

  function createForm() {
    const f = el('form', 'ses-form'); f.id = 'ses-form';
    const field = (label, input) => { const l = el('label', 'fr-label', label); const id = 'ses-' + label.toLowerCase().replace(/\W+/g, '-'); input.id = id; l.setAttribute('for', id); f.append(l, input); return input; };
    const title = field('Title', el('input')); title.type = 'text'; title.maxLength = 80; title.required = true;
    const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
    const end = new Date(+start + 3 * 3600000);
    const starts = field('Starts', el('input')); starts.type = 'datetime-local'; starts.value = localInput(start); starts.required = true;
    const ends = field('Ends', el('input')); ends.type = 'datetime-local'; ends.value = localInput(end); ends.required = true;
    const loc = field('Location', el('input')); loc.type = 'text'; loc.maxLength = 120;
    const desc = field('Details', el('textarea')); desc.rows = 2; desc.maxLength = 500;
    const go = btn('Create session', 'btn small primary'); go.type = 'submit'; go.id = 'ses-create';
    f.append(go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = new Date(starts.value), en = new Date(ends.value);
      if (Number.isNaN(+s) || Number.isNaN(+en)) { message = 'Choose a start and an end time.'; paint(); return; }
      showForm = false;
      act(() => api.create({ title: title.value, description: desc.value, location: loc.value, startsAt: s.toISOString(), endsAt: en.toISOString() }), 'Session created.');
    });
    return f;
  }

  function paint() {
    if (!host) return;
    const c = el('div', 'ses-card'); c.dataset.status = state.status;
    if (state.status === 'loading') c.append(el('p', 'hint', 'Loading sessions…'));
    else if (state.status === 'error') { c.append(el('p', 'hint', 'Sessions are unavailable right now.')); const r = btn('Try again'); r.addEventListener('click', () => load()); c.append(r); }
    else {
      if (!state.list.length) c.append(el('p', 'hint', 'No flight sessions are planned yet.'));
      for (const s of state.list) c.append(sessionRow(s));
      if (state.roles.organiser) {
        const n = btn(showForm ? 'Cancel new session' : 'New session'); n.id = 'ses-new'; n.addEventListener('click', () => { showForm = !showForm; paint(); });
        c.append(n);
        if (showForm) c.append(createForm());
      }
    }
    if (message) { const m = el('p', 'hint ses-message', message); m.setAttribute('role', 'status'); c.append(m); }
    host.replaceChildren(c);
  }

  return {
    mount(h) { host = h; paint(); },
    reload: load,
    reset() { seq++; state = { status: 'loading', list: [], roles: { admin: false, organiser: false } }; open.clear(); people.clear(); message = ''; showForm = false; paint(); },
  };
}
