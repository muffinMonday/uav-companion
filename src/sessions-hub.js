// The Sessions hub: one dialog opened from the map (calendar button), the dashboard card and the Friends tab. Discover (public sessions, readable by guests), My sessions
// (hosting, joined, history, updates), Invitations, a session's detail with its host tools, and the New session form. The map point picker closes the dialog while the person
// chooses on the map and reopens it with the draft intact. The database decides everything (sessions.js); this only draws. Plain DOM, textContent only.
import L from 'leaflet';
import { createSessions, sessionState, whenText, capacityText, roleText, seriesText, linkUrl, tokenFromHash } from './sessions.js';
import { createSessionForm, clearDraft } from './sessions-create.js';
import { localDate, localTime } from './sessions-recurrence.js';
import { avatarEl } from './avatars.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { log } from './log.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';
const NEAR_KM = 10, PAGE = 20, SUMMARY_MS = 300000, PENDING = 'uavzones.session-link';
const SECTIONS = [['discover', 'Discover'], ['mine', 'My sessions'], ['invites', 'Invitations']];
const asSession = (p) => ({ ...p, status: 'scheduled', visibility: 'public', iRsvped: false, myAttended: false, canManage: false, canVerify: false, isHost: false, invited: false });

/** `handle` is what initSyncUI returns (handle.adapter.client, handle.sync.status().session). Returns the hub: { open(section, opts), reload(), reset(), summary(), setNearby(on), onSummary(fn), redeemFromHash(), button }. */
export function initSessionsHub({ handle, map, toast, panel, markers = () => [] }) {
  const api = createSessions(handle.adapter.client);
  const signedIn = () => !!handle.sync.status().session;
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const mineEmpty = () => ({ status: 'idle', sessions: [], roles: { admin: false, organiser: false }, notices: [], takedowns: [], invites: [] });
  let mine = mineEmpty(), section = 'discover', view = 'list', detail = null, message = '', busy = false, seqMine = 0, seqPub = 0, summaryAt = 0, nearby = null;
  let pub = { status: 'idle', list: [], more: false, query: '', near: 'any', when: 'any', space: false, offset: 0 };
  let manageOpen = new Set(), people = new Map(), invite = new Map(), newLink = null, editing = null, reporting = null;
  let quietClose = false; // the close event is queued and fires later; this marks the close that only steps aside for the map
  let opener = null; // the element that had focus when the hub was opened
  const listeners = new Set();
  const scroll = new Map();

  // ---- the dialog
  const dlg = el('dialog', 'ses-hub'); dlg.id = 'ses-hub'; dlg.setAttribute('aria-labelledby', 'ses-hub-title');
  const head = el('header', 'ses-hub-head'); const h = el('h2', '', 'Flight sessions'); h.id = 'ses-hub-title';
  const closeB = el('button', 'icon-btn'); closeB.type = 'button'; closeB.id = 'ses-hub-close'; closeB.setAttribute('aria-label', 'Close'); closeB.title = 'Close';
  closeB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(h, closeB);
  const tabs = el('div', 'ses-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sessions');
  const body = el('div', 'ses-hub-body'); body.id = 'ses-hub-body'; body.setAttribute('role', 'tabpanel');
  dlg.append(head, tabs, body); document.body.append(dlg);
  closeB.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('cancel', (e) => { if (view !== 'list') { e.preventDefault(); back(); } }); // Escape closes the detail or the form before the hub
  dlg.addEventListener('close', () => { dlg.style.removeProperty('--ses-vvh'); dlg.style.removeProperty('--ses-vvtop'); if (quietClose) { quietClose = false; return; } scroll.clear(); const o = opener; opener = null; if (o?.isConnected && !o.closest('[inert]')) o.focus?.({ preventScroll: true }); }); // focus goes back to what opened the hub, also after the map picker closed and reopened it
  // The sheet (a touch screen up to 900 px wide, styles.css) follows the visual viewport, so the on-screen keyboard and a moving browser toolbar never cover its header, tabs or the Create / Cancel row.
  const vv = window.visualViewport;
  const fit = () => { if (!dlg.open || !vv || vv.scale > 1.01) return; dlg.style.setProperty('--ses-vvh', vv.height + 'px'); dlg.style.setProperty('--ses-vvtop', vv.offsetTop + 'px'); };
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit);
  dlg.addEventListener('focusin', (e) => { fit(); if (matchMedia('(pointer:coarse)').matches && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'instant' }), 350); });

  // ---- the bar that floats over the map while the dialog is out of the way (picking a point, or showing sessions on the map)
  const bar = el('div', 'ses-bar'); bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Sessions on the map'); document.body.append(bar);
  const barShow = (text, buttons) => { bar.replaceChildren(el('span', 'ses-bar-text', text)); for (const [label, cls, fn] of buttons) { const b = btn(label, cls); b.addEventListener('click', fn); bar.append(b); } bar.hidden = false; };
  const barHide = () => { bar.hidden = true; bar.replaceChildren(); };
  let keepTop = 0; // the form behind the closed dialog is kept as it is (nothing is redrawn), so what was typed stays
  const suspend = () => { keepTop = body.scrollTop; quietClose = dlg.open; dlg.close(); panel?.closeIfPhone?.(); };
  const resume = () => { if (!dlg.open) { dlg.showModal(); fit(); } body.scrollTop = keepTop; };

  function pickPoint(initial) {
    return new Promise((resolve) => {
      suspend();
      const c = initial ?? map.getCenter().wrap();
      const mk = L.marker([c.lat, c.lng], { draggable: true, keyboard: true, title: 'Meeting point', alt: 'Meeting point' }).addTo(map);
      const onClick = (e) => mk.setLatLng(e.latlng);
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      map.on('click', onClick); document.addEventListener('keydown', onKey);
      function finish(ll) { map.off('click', onClick); document.removeEventListener('keydown', onKey); mk.remove(); barHide(); resume(); resolve(ll ? { lat: ll.lat, lng: ll.lng } : null); }
      barShow('Drag the pin or tap the map to set the meeting point.', [['Use this point', 'btn small primary', () => finish(mk.getLatLng().wrap())], ['Move pin to the map centre', 'btn small', () => mk.setLatLng(map.getCenter())], ['Cancel', 'btn small', () => finish(null)]]);
    });
  }
  let shown = null;
  function showOnMap(list, focus) {
    const pts = list.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (!pts.length) return;
    suspend(); shown?.remove();
    const layer = L.layerGroup().addTo(map); shown = layer;
    for (const s of pts) {
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'ses-map-pin', html: '<span>✈</span>', iconSize: [30, 30], iconAnchor: [15, 15] }), title: s.title, alt: s.title, keyboard: true });
      m.on('click', () => { end(); open('discover', { id: s.id, fallback: s }); });
      m.addTo(layer);
    }
    const f = pts.find((s) => s.id === focus);
    if (pts.length === 1 || f) map.setView([(f ?? pts[0]).lat, (f ?? pts[0]).lng], Math.max(map.getZoom(), 14));
    else map.fitBounds(L.latLngBounds(pts.map((s) => [s.lat, s.lng])), { padding: [60, 60], maxZoom: 14 });
    const end = () => { layer.remove(); if (shown === layer) shown = null; barHide(); };
    barShow(pts.length === 1 ? 'Showing the session on the map.' : `Showing ${pts.length} sessions on the map. Tap one to open it.`, [['Back to sessions', 'btn small primary', () => { end(); resume(); }]]);
  }

  // ---- loading
  async function loadMine({ quiet = false } = {}) {
    if (!signedIn()) { mine = mineEmpty(); summaryDone(); return; }
    const me = ++seqMine;
    if (mine.status === 'idle' && !quiet) { mine = { ...mine, status: 'loading' }; if (dlg.open) paint(); }
    const one = async (fn, fallback) => { try { return await fn(); } catch (e) { log.warn('sessions', 'load failed', e); return fallback; } };
    const failed = { v: false };
    const [sessions, roles, notices, takedowns, invites] = await Promise.all([
      api.list().catch((e) => { failed.v = true; log.warn('sessions', 'list failed', e); return null; }), one(() => api.roles(), { admin: false, organiser: false }),
      one(() => api.notices(), []), one(() => api.takedowns(), []), one(() => api.invitations(), []),
    ]);
    if (me !== seqMine) return;
    mine = failed.v ? { ...mine, status: 'error' } : { status: 'ready', sessions, roles, notices, takedowns, invites };
    summaryAt = Date.now();
    if (!failed.v) await Promise.all([...manageOpen].map(async (id) => { const s = mine.sessions.find((x) => x.id === id); if (s?.canManage) await loadPeople(s); else manageOpen.delete(id); }));
    summaryDone();
    if (dlg.open) paint();
  }
  async function loadPeople(s) {
    try { people.set(s.id, await api.people(s.id)); } catch { people.delete(s.id); }
    if (s.visibility === 'private') { try { invite.set(s.id, await api.inviteList(s.id)); } catch { invite.delete(s.id); } }
  }
  async function loadPublic({ more = false, quiet = false } = {}) {
    const me = ++seqPub;
    if (!more && !(quiet && pub.status === 'ready')) { pub = { ...pub, status: 'loading', offset: 0 }; if (dlg.open) paint(); }
    const f = { limit: PAGE, offset: more ? pub.offset : 0, query: pub.query.trim() || undefined };
    if (pub.near !== 'any') { const c = map.getCenter().wrap(); f.lat = Math.round(c.lat * 1e4) / 1e4; f.lng = Math.round(c.lng * 1e4) / 1e4; f.radiusKm = Number(pub.near); }
    const now = Date.now(); if (pub.when === 'week') { f.from = new Date(now).toISOString(); f.until = new Date(now + 7 * 864e5).toISOString(); } else if (pub.when === 'month') { f.from = new Date(now).toISOString(); f.until = new Date(now + 30 * 864e5).toISOString(); }
    try {
      const rows = await api.listPublic(f);
      if (me !== seqPub) return;
      pub = { ...pub, status: 'ready', list: more ? [...pub.list, ...rows] : rows, more: rows.length === PAGE, offset: (more ? pub.offset : 0) + rows.length };
    } catch (e) { if (me !== seqPub) return; log.warn('sessions', 'public list failed', e); pub = { ...pub, status: 'error' }; }
    if (dlg.open) paint();
  }

  // ---- the summary the dashboard and the Friends card show
  function summaryNow() {
    const t = Date.now(), up = mine.sessions.filter((s) => s.status === 'scheduled' && Date.parse(s.endsAt) > t && (s.isHost || s.iRsvped)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const next = up[0] ?? null;
    return {
      signedIn: signedIn(), ready: mine.status === 'ready', soon: next && Date.parse(next.startsAt) - t < 48 * 3600e3 ? next : null, next,
      invites: new Set(mine.invites.map((i) => i.id)).size, updates: mine.notices.filter((n) => n.unread).length, takedowns: mine.takedowns.length,
      nearbyOn: loadPrefs().sessionsNearby === true, nearby,
    };
  }
  const summaryDone = () => { for (const fn of listeners) { try { fn(summaryNow()); } catch (e) { log.warn('sessions', 'summary listener failed', e); } } };
  async function loadNearby() {
    if (loadPrefs().sessionsNearby !== true) { nearby = null; return; }
    const c = map.getCenter().wrap();
    try { const rows = await api.listPublic({ lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100, radiusKm: NEAR_KM, limit: 20 }); nearby = { count: rows.length, first: rows[0] ?? null, more: rows.length === 20 }; } catch { nearby = null; }
  }
  async function refreshSummary(force = false) {
    if (!force && Date.now() - summaryAt < SUMMARY_MS && mine.status === 'ready') return;
    await Promise.all([loadMine({ quiet: true }), loadNearby()]);
    summaryDone();
  }

  // ---- doing things
  async function act(fn, done) {
    if (busy) return; busy = true; message = '';
    try { const r = await fn(); message = typeof done === 'function' ? done(r) : done || ''; } catch (e) { message = e.message || 'That did not work.'; }
    busy = false; await loadMine(); if (section === 'discover') await loadPublic();
    paint();
  }
  const warningText = (r) => (Array.isArray(r?.warnings) && r.warnings.some((w) => w.code === 'public_overlap') ? ' Another public session overlaps this one in time and place.' : '');
  const currentOf = (id) => mine.sessions.find((x) => x.id === id) ?? pub.list.map(asSession).find((x) => x.id === id) ?? (detail?.id === id ? detail.fallback : null);
  const hostBadge = (s) => { const w = el('span', 'ses-host'); w.append(avatarEl(s.hostAvatar, s.hostName, 20), el('small', '', s.isHost ? 'You' : s.hostName)); return w; };

  function go(sec, v = 'list') { section = sec; view = v; message = ''; editing = null; reporting = null; newLink = null; if (v === 'list') detail = null; paint(); if (sec === 'discover' && v === 'list') loadPublic({ quiet: true }); }
  function back() { if (view === 'detail' || view === 'create') { view = 'list'; detail = null; message = ''; editing = null; paint(); } }
  function openDetail(s) { detail = { id: s.id, fallback: s }; view = 'detail'; message = ''; editing = null; reporting = null; newLink = null; paint(); if (s.visibility === 'public') loadPublic({ quiet: true }); if (signedIn()) loadMine({ quiet: true }); const sess = currentOf(s.id); if (sess?.canManage) { manageOpen.add(s.id); loadPeople(sess).then(paint); } }

  // ---- drawing
  function rowFor(s, extra = []) {
    const st = sessionState(s), r = el('div', 'ses-row'); r.dataset.id = s.id; r.dataset.status = s.status;
    const top = el('div', 'ses-top'); top.append(el('b', 'ses-title', s.title));
    top.append(el('span', 'badge', s.visibility === 'public' ? 'Public' : 'Private'));
    if (s.status !== 'scheduled') top.append(el('span', 'badge', s.status === 'closed' ? 'Closed' : 'Cancelled')); else if (st.started && !st.over) top.append(el('span', 'badge ok', 'Under way')); if (st.full && s.status === 'scheduled' && !s.iRsvped) top.append(el('span', 'badge', 'Full'));
    r.append(top, el('small', 'ses-when', whenText(s.startsAt, s.endsAt) + (s.location ? ' · ' + s.location : '')));
    const meta = [seriesText(s), capacityText(s), Number.isFinite(s.distanceKm) ? `${s.distanceKm.toFixed(1)} km away` : ''].filter(Boolean);
    r.append(el('small', 'ses-count', meta.join(' · ')), hostBadge(s));
    const bs = el('div', 'btn-row'); const d = btn('Details'); d.dataset.act = 'details'; d.addEventListener('click', () => openDetail(s)); bs.append(d, ...extra); r.append(bs);
    return r;
  }
  const empty = (t) => el('p', 'hint ses-empty', t);
  const signInBox = (t) => { const b = el('div', 'ses-signin'); b.append(el('p', 'hint', t)); const s = btn('Sign in', 'btn small primary'); s.dataset.act = 'signin'; s.addEventListener('click', () => { dlg.close(); document.getElementById('account-btn')?.click(); }); b.append(s); return b; };

  function paintTabs() {
    tabs.replaceChildren();
    for (const [id, label] of SECTIONS) {
      const b = el('button', 'ses-tab'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.section = id; b.setAttribute('aria-selected', String(section === id)); b.tabIndex = section === id ? 0 : -1;
      b.append(document.createTextNode(label));
      const n = id === 'invites' ? summaryNow().invites : id === 'mine' ? summaryNow().updates : 0;
      if (n) { const c = el('span', 'tab-badge', String(n)); c.setAttribute('aria-label', n === 1 ? '1 new' : `${n} new`); b.append(c); }
      b.addEventListener('click', () => { scroll.set(`${section}:${view}`, body.scrollTop); go(id); });
      b.addEventListener('keydown', (e) => { const i = SECTIONS.findIndex((x) => x[0] === section), j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null; if (j === null) return; e.preventDefault(); go(SECTIONS[(j + SECTIONS.length) % SECTIONS.length][0]); tabs.querySelector('[aria-selected=true]')?.focus(); });
      tabs.append(b);
    }
  }

  function paint() {
    if (!dlg.open) return;
    const key = `${section}:${view}`, keep = scroll.get(key) ?? 0;
    paintTabs(); tabs.hidden = view !== 'list';
    const frag = el('div', 'ses-hub-inner');
    if (message) { const m = el('p', 'hint ses-message', message); m.setAttribute('role', 'status'); frag.append(m); }
    if (view === 'create') drawCreate(frag); else if (view === 'detail') drawDetail(frag); else if (section === 'discover') drawDiscover(frag); else if (section === 'mine') drawMine(frag); else drawInvites(frag);
    body.setAttribute('aria-label', SECTIONS.find((x) => x[0] === section)[1]);
    body.replaceChildren(frag); body.scrollTop = keep;
  }
  body.addEventListener('scroll', () => scroll.set(`${section}:${view}`, body.scrollTop), { passive: true });

  function drawDiscover(f) {
    const form = el('form', 'ses-filters'); form.setAttribute('role', 'search');
    const q = el('input'); q.type = 'search'; q.placeholder = 'Search title or place'; q.value = pub.query; q.maxLength = 60; q.setAttribute('aria-label', 'Search sessions'); q.id = 'ses-q';
    const near = el('select'); near.setAttribute('aria-label', 'Distance from the map centre'); near.id = 'ses-near';
    for (const [v, t] of [['any', 'Anywhere'], ['10', 'Within 10 km'], ['25', 'Within 25 km'], ['100', 'Within 100 km']]) near.append(new Option(t, v)); near.value = pub.near;
    const when = el('select'); when.setAttribute('aria-label', 'When'); when.id = 'ses-when-f';
    for (const [v, t] of [['any', 'Any date'], ['week', 'Next 7 days'], ['month', 'Next 30 days']]) when.append(new Option(t, v)); when.value = pub.when;
    const sl = el('label', 'ses-check'); const sp = el('input'); sp.type = 'checkbox'; sp.checked = pub.space; sl.append(sp, el('span', '', 'Has space'));
    form.append(q, near, when, sl);
    const apply = () => { pub = { ...pub, query: q.value, near: near.value, when: when.value, space: sp.checked }; loadPublic(); };
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    for (const c of [near, when]) c.addEventListener('change', apply);
    sp.addEventListener('change', () => { pub = { ...pub, space: sp.checked }; paint(); });
    f.append(form);
    if (pub.status === 'loading' || pub.status === 'idle') f.append(el('p', 'hint', 'Loading sessions…'));
    else if (pub.status === 'error') { f.append(el('p', 'hint', 'Public sessions are unavailable right now.')); const r = btn('Try again'); r.addEventListener('click', () => loadPublic()); f.append(r); }
    else {
      const list = pub.space ? pub.list.filter((s) => s.capacity === null || s.rsvpCount < s.capacity) : pub.list;
      if (!list.length) f.append(empty('No public sessions match. Try a wider distance or date, or plan one yourself.'));
      else {
        const mapBtn = btn('Show these on the map'); mapBtn.dataset.act = 'show-map'; mapBtn.addEventListener('click', () => showOnMap(list)); f.append(mapBtn);
        for (const p of list) { const s = mine.sessions.find((x) => x.id === p.id) ?? asSession(p); f.append(rowFor({ ...s, distanceKm: p.distanceKm }, [])); }
        if (pub.more) { const m = btn('Show more'); m.dataset.act = 'more'; m.addEventListener('click', () => loadPublic({ more: true })); f.append(m); }
      }
    }
    f.append(createButton());
  }
  function createButton() {
    if (!signedIn()) return signInBox('Sign in to plan a session, RSVP and see your invitations.');
    const n = btn('New session', 'btn small primary'); n.id = 'ses-new'; n.addEventListener('click', () => { scroll.set(`${section}:list`, body.scrollTop); view = 'create'; message = ''; paint(); }); return n;
  }

  function drawMine(f) {
    if (!signedIn()) { f.append(signInBox('Sign in to see the sessions you host and join.')); return; }
    if (mine.status === 'loading' || mine.status === 'idle') { f.append(el('p', 'hint', 'Loading sessions…')); return; }
    if (mine.status === 'error') { f.append(el('p', 'hint', 'Sessions are unavailable right now.')); const r = btn('Try again'); r.addEventListener('click', () => loadMine()); f.append(r); return; }
    f.append(createButton());
    const unread = mine.notices.filter((n) => n.unread);
    if (unread.length || mine.takedowns.length) {
      const box = el('div', 'ses-notices'); box.append(el('h3', '', 'Updates'));
      for (const n of unread) box.append(el('p', 'ses-notice', n.message));
      for (const t of mine.takedowns) box.append(el('p', 'ses-notice', `A moderator took down “${t.title}”. It is not visible to others.`));
      if (unread.length) { const a = btn('Mark as read'); a.dataset.act = 'ack'; a.addEventListener('click', () => act(() => api.ackNotices(), '')); box.append(a); }
      f.append(box);
    }
    const t = Date.now(), mineOnly = mine.sessions.filter((s) => s.isHost || s.iRsvped || s.myAttended);
    const upcoming = mineOnly.filter((s) => s.status === 'scheduled' && Date.parse(s.endsAt) > t), history = mineOnly.filter((s) => !(s.status === 'scheduled' && Date.parse(s.endsAt) > t)).reverse();
    const group = (title, list, none) => { f.append(el('h3', 'ses-group', title)); if (!list.length) f.append(empty(none)); for (const s of list) f.append(rowFor(s)); };
    group('Hosting', upcoming.filter((s) => s.isHost), 'You are not hosting anything upcoming.');
    group('Joined', upcoming.filter((s) => !s.isHost), 'You have not joined any session yet.');
    if (history.length) group('History (last 90 days)', history, '');
    f.append(el('p', 'hint', `You can have five active hosted sessions at a time, public or private. A repeating series counts once, however many dates it has.`));
  }

  function drawInvites(f) {
    if (!signedIn()) { f.append(signInBox('Sign in to see private invitations sent to you.')); return; }
    if (mine.status !== 'ready') { f.append(el('p', 'hint', mine.status === 'error' ? 'Invitations are unavailable right now.' : 'Loading invitations…')); return; }
    if (!mine.invites.length) { f.append(empty('No invitations waiting. A host can invite you by your friend code or give you a private link.')); return; }
    f.append(el('p', 'hint', 'Private sessions you were invited to. Open one to say you will come.'));
    for (const i of mine.invites) {
      const note = i.scope === 'series' ? 'Invited to the whole series' : 'Invited to this session only';
      const r = rowFor({ ...i, isHost: false }); r.querySelector('.ses-count').textContent = [note, seriesText(i), `from ${i.hostName}`].filter(Boolean).join(' · '); f.append(r);
    }
  }

  function drawCreate(f) {
    f.classList.add('ses-narrow');
    const back_ = btn('← Back'); back_.id = 'ses-back'; back_.addEventListener('click', back); f.append(back_, el('h3', '', 'New session'));
    f.append(el('p', 'hint', 'Anyone signed in can host. Hosting gives no XP, and a host cannot verify attendance for XP unless they are an organiser or administrator.'));
    const form = createSessionForm({
      tz, tools: { pickPoint, center: () => map.getCenter().wrap(), markers: () => markers() },
      onCancel: () => { clearDraft(); back(); },
      onSubmit: async (req) => {
        const r = req.series ? await api.createSeries(req) : await api.create(req);
        await loadMine(); await loadPublic();
        view = 'list'; section = 'mine'; message = (req.series ? `${req.count} sessions created.` : 'Session created.') + (req.visibility === 'public' ? ' It is public.' : ' It is private: invite people or share a link from its Details.') + warningText(r); paint();
        return '';
      },
    });
    f.append(form.el);
  }

  function drawDetail(f) {
    f.classList.add('ses-narrow');
    const s = currentOf(detail.id);
    const back_ = btn('← Back'); back_.id = 'ses-back'; back_.addEventListener('click', back); f.append(back_);
    if (!s) { f.append(empty('This session is no longer available.')); return; }
    const st = sessionState(s);
    const top = el('div', 'ses-top'); top.append(el('h3', 'ses-title', s.title), el('span', 'badge', s.visibility === 'public' ? 'Public' : 'Private'));
    if (s.status !== 'scheduled') top.append(el('span', 'badge', s.status === 'closed' ? 'Closed' : 'Cancelled')); f.append(top);
    f.append(el('p', 'ses-when', whenText(s.startsAt, s.endsAt)));
    if (seriesText(s)) f.append(el('p', 'hint', seriesText(s) + '. Each session has its own RSVPs, capacity and attendance.'));
    if (s.location) f.append(el('p', 'ses-place', s.location));
    if (s.lat !== null) { const p = el('p', 'ses-coords'); p.append(el('span', '', `Meeting point: ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)} `)); const m = btn('Show on the map'); m.dataset.act = 'show-map'; m.addEventListener('click', () => showOnMap([s], s.id)); p.append(m); f.append(p); }
    else f.append(el('p', 'hint', 'No meeting point was set for this session.'));
    f.append(hostBadge(s), el('p', 'ses-count', capacityText(s)));
    if (s.description) f.append(el('p', 'ses-desc', s.description));
    const rt = roleText(s); if (rt) { const n = el('p', 'ses-role', rt); n.dataset.role = s.isHost ? (s.canVerify ? 'host-verifier' : 'host') : 'verifier'; f.append(n); }
    if (s.myAttended) f.append(el('span', 'badge ok ses-attended', 'You were there'));
    const bs = el('div', 'btn-row');
    if (!signedIn()) bs.append(signInBox('Sign in to say you will come.'));
    else if (st.canRsvp) { const b = btn('I will come', 'btn small primary'); b.dataset.act = 'rsvp'; b.addEventListener('click', () => act(() => api.rsvp(s.id), 'You are on the list.')); bs.append(b); }
    else if (s.iRsvped && s.status === 'scheduled') {
      if (st.canWithdraw) { const b = btn('Withdraw'); b.dataset.act = 'withdraw'; b.addEventListener('click', () => act(() => api.withdraw(s.id), 'Removed from the list.')); bs.append(b); }
      else bs.append(el('span', 'badge', 'You said you will come'));
    } else if (st.full && s.status === 'scheduled') bs.append(el('span', 'badge', 'Full'));
    if (signedIn() && s.visibility === 'public' && !s.isHost && s.status === 'scheduled') { const b = btn('Report'); b.dataset.act = 'report'; b.addEventListener('click', () => { reporting = reporting ? null : s.id; paint(); }); bs.append(b); }
    f.append(bs);
    if (reporting === s.id) f.append(reportForm(s));
    if (s.canManage) f.append(managePanel(s, st));
  }

  function reportForm(s) {
    const form = el('form', 'ses-report'); form.append(el('h3', '', 'Report this session'));
    const sel = el('select'); sel.id = 'ses-report-reason'; sel.setAttribute('aria-label', 'Reason');
    for (const [v, t] of [['spam', 'Spam'], ['unsafe_location', 'Unsafe or restricted location'], ['harassment', 'Harassment'], ['illegal', 'Illegal activity'], ['other', 'Something else']]) sel.append(new Option(t, v));
    const note = el('input'); note.type = 'text'; note.maxLength = 200; note.placeholder = 'Add a note (optional)'; note.setAttribute('aria-label', 'Note');
    const go_ = btn('Send report', 'btn small primary'); go_.type = 'submit'; go_.dataset.act = 'send-report';
    form.append(sel, note, go_, el('small', 'hint', 'Reports go to the moderators. Several reports hide a session until it is reviewed.'));
    form.addEventListener('submit', (e) => { e.preventDefault(); reporting = null; act(() => api.report(s.id, sel.value, note.value), (r) => (r?.status === 'already_reported' ? 'You already reported this session.' : 'Thank you. The moderators will look at it.')); });
    return form;
  }

  function managePanel(s, st) {
    const p = el('div', 'ses-manage'); p.id = 'ses-manage';
    const list = people.get(s.id) ?? [];
    p.append(el('h3', '', `People (${list.length})`));
    if (!list.length) p.append(el('p', 'hint', 'Nobody has said they will come yet.'));
    for (const x of list) {
      const r = el('div', 'ses-person'); r.dataset.name = x.name;
      r.append(el('b', '', x.name), el('small', '', x.attended ? (x.source === 'walk_in' ? 'Present (walk-in)' : 'Present') : x.revoked ? 'Mark revoked' : 'Said they will come'));
      if (x.rsvpId && !x.attended && !x.revoked && st.canMark) { const b = btn('Mark present'); b.dataset.act = 'mark'; b.addEventListener('click', () => act(() => api.mark(s.id, 'rsvp', x.rsvpId), (res) => `${res.display_name}: ${res.status === 'marked' ? 'marked present' : 'already marked'}.`)); r.append(b); }
      if (x.rsvpId && !x.attended && s.status === 'scheduled') { const b = btn('Remove'); b.dataset.act = 'remove'; b.addEventListener('click', () => { if (window.confirm(`Remove ${x.name} from this session? They cannot rejoin it.`)) act(() => api.removePerson(s.id, x.rsvpId), `${x.name} was removed.`); }); r.append(b); }
      if (x.attendanceId && x.attended && mine.roles.admin) { const b = btn('Revoke'); b.dataset.act = 'revoke'; b.addEventListener('click', () => { const why = window.prompt('Why is this mark being revoked? (required, shown in their XP history)'); if (why && why.trim()) act(() => api.revoke(s.id, x.attendanceId, why), 'Mark revoked.'); }); r.append(b); }
      p.append(r);
    }
    if (s.status === 'scheduled') {
      if (!s.canVerify) p.append(el('p', 'hint ses-noverify', 'You can manage this session but not verify attendance for XP. That needs an organiser who hosts the session, or an administrator.'));
      else if (!st.started) p.append(el('p', 'hint', 'Attendance can be marked once the session has started.'));
      else {
        const wf = el('form', 'fr-name ses-walkin'); const i = el('input'); i.type = 'text'; i.placeholder = 'Friend code of someone who came without RSVP'; i.autocomplete = 'off'; i.maxLength = 20; i.setAttribute('aria-label', 'Friend code of a walk-in');
        const g = btn('Mark present', 'btn small'); g.type = 'submit'; g.dataset.act = 'mark-code'; wf.append(i, g);
        wf.addEventListener('submit', (e) => { e.preventDefault(); const v = i.value.trim(); if (v) act(() => api.mark(s.id, 'code', v), (res) => `${res.display_name}: ${res.status === 'marked' ? 'marked present' : 'already marked'}.`); });
        p.append(wf);
      }
      if (s.visibility === 'private') p.append(invitePanel(s));
      p.append(editing === s.id ? editForm(s) : manageButtons(s));
    }
    return p;
  }

  function manageButtons(s) {
    const row = el('div', 'btn-row');
    const e = btn('Edit'); e.dataset.act = 'edit'; e.addEventListener('click', () => { editing = s.id; paint(); }); row.append(e);
    if (s.canVerify) { const c = btn('Close session'); c.dataset.act = 'close'; c.addEventListener('click', () => { if (window.confirm('Close this session? Nobody can be marked present afterwards.')) act(() => api.close(s.id), 'Session closed.'); }); row.append(c); }
    const x = btn('Cancel session', 'btn small danger'); x.dataset.act = 'cancel'; x.addEventListener('click', () => { if (window.confirm('Cancel this session? People who said they will come are told.')) act(() => api.cancel(s.id), 'Session cancelled.'); }); row.append(x);
    if (s.seriesId) { const y = btn('Cancel this and the following', 'btn small danger'); y.dataset.act = 'cancel-series'; y.addEventListener('click', () => { if (window.confirm('Cancel this session and every later one in the series?')) act(() => api.cancelSeries(s.id), 'The series was cancelled from here.'); }); row.append(y); }
    return row;
  }

  function editForm(s) {
    const f = el('form', 'ses-form ses-edit'); let n = 0, lat = s.lat, lng = s.lng;
    const field = (label, input) => { const l = el('label', 'fr-label', label); input.id = 'se-' + (++n); l.setAttribute('for', input.id); f.append(l, input); return input; };
    const a = new Date(s.startsAt), b = new Date(s.endsAt);
    let scope = 'one';
    if (s.seriesId) {
      const g = el('fieldset', 'ses-vis'); g.append(el('legend', 'fr-label', 'Apply changes to'));
      for (const [v, t] of [['one', 'Only this session'], ['following', 'This and the following sessions']]) { const l = el('label', 'ses-radio'); const r = el('input'); r.type = 'radio'; r.name = 'ses-scope'; r.value = v; r.checked = v === scope; r.addEventListener('change', () => { scope = v; dateRow.hidden = visRow.hidden = v !== 'one'; }); l.append(r, el('span', '', t)); g.append(l); }
      f.append(g);
    }
    const title = field('Title', el('input')); title.value = s.title; title.maxLength = 80;
    const desc = field('Details', el('textarea')); desc.rows = 2; desc.maxLength = 500; desc.value = s.description;
    const label = field('Place name', el('input')); label.value = s.location; label.maxLength = 120;
    const pt = el('p', 'ses-pin-text'); const showPt = () => { pt.textContent = lat === null ? 'No point set.' : `Point: ${lat.toFixed(5)}, ${lng.toFixed(5)}`; }; showPt();
    const pickB = btn('Choose on the map'); pickB.addEventListener('click', async () => { const q = await pickPoint(lat === null ? null : { lat, lng }); if (q) { lat = Math.round(q.lat * 1e6) / 1e6; lng = Math.round(q.lng * 1e6) / 1e6; } showPt(); });
    f.append(pt, pickB);
    const dateRow = el('div'); f.append(dateRow);
    const date = el('input'); date.type = 'date'; date.value = localDate(a); const st_ = el('input'); st_.type = 'time'; st_.value = localTime(a); const en = el('input'); en.type = 'time'; en.value = localTime(b);
    for (const [t, i] of [['Date', date], ['Starts', st_], ['Ends', en]]) { const l = el('label', 'fr-label', t); i.id = 'se-' + (++n); l.setAttribute('for', i.id); dateRow.append(l, i); }
    const cap = field('Capacity (empty for no limit)', el('input')); cap.type = 'number'; cap.min = 1; cap.max = 500; cap.value = s.capacity ?? '';
    const visRow = el('div'); const vis = el('select'); vis.id = 'se-vis'; vis.append(new Option('Private', 'private'), new Option('Public (exact point visible to anyone)', 'public')); vis.value = s.visibility; const vl = el('label', 'fr-label', 'Who can see it'); vl.setAttribute('for', 'se-vis'); visRow.append(vl, vis); f.append(visRow);
    const msg = el('p', 'hint ses-message'); msg.setAttribute('role', 'status'); f.append(msg);
    const row = el('div', 'btn-row'); const save = btn('Save changes', 'btn small primary'); save.type = 'submit'; save.dataset.act = 'save'; const cancel = btn('Discard'); cancel.addEventListener('click', () => { editing = null; paint(); }); row.append(save, cancel); f.append(row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const common = {}; if (title.value.trim() !== s.title) common.title = title.value.trim(); if (desc.value.trim() !== s.description) common.description = desc.value.trim(); if (label.value.trim() !== s.location) common.location = label.value.trim();
      if (lat !== s.lat || lng !== s.lng) { common.latitude = lat; common.longitude = lng; }
      const capV = cap.value === '' ? null : Number(cap.value); if (capV !== s.capacity) common.capacity = capV;
      const startsAt = new Date(`${date.value}T${st_.value}`); const dur = (() => { const m = (t) => { const x = /^(\d\d):(\d\d)$/.exec(t); return x ? +x[1] * 60 + +x[2] : null; }; const p = m(st_.value), q = m(en.value); return p === null || q === null ? null : q > p ? q - p : q + 1440 - p; })();
      if (Number.isNaN(+startsAt) || dur === null) { msg.textContent = 'Choose a date, a start and an end time.'; return; }
      if (scope === 'one') {
        const patch = { ...common }; const oldDur = Math.round((b - a) / 60000);
        if (+startsAt !== +a || dur !== oldDur) { patch.starts_at = startsAt.toISOString(); patch.ends_at = new Date(+startsAt + dur * 60000).toISOString(); patch.timezone = tz; }
        if (vis.value !== s.visibility) { if (vis.value === 'public' && !window.confirm('Make this session public? Anyone will be able to see its exact meeting point.')) return; patch.visibility = vis.value; }
        if (!Object.keys(patch).length) { msg.textContent = 'Nothing was changed.'; return; }
        editing = null; act(() => api.update(s.id, patch), (r) => 'Saved.' + (s.iRsvped || people.get(s.id)?.length ? ' People who said they will come are told.' : '') + warningText(r));
      } else {
        const patch = { ...common };
        if (st_.value !== localTime(a)) patch.start_time = st_.value; if (dur !== Math.round((b - a) / 60000)) patch.duration_minutes = dur;
        if (!Object.keys(patch).length) { msg.textContent = 'Nothing was changed.'; return; }
        editing = null; act(() => api.updateSeries(s.id, patch), 'Saved for this and the following sessions.');
      }
    });
    return f;
  }

  function invitePanel(s) {
    const p = el('div', 'ses-invites'); p.append(el('h3', '', 'Invite people'));
    p.append(el('p', 'hint', 'This session is private: only people you invite, or who open a link you share, can see it.'));
    const scopeSel = () => { const c = el('select'); c.setAttribute('aria-label', 'Invitation covers'); c.append(new Option('This session only', 'occurrence')); if (s.seriesId) c.append(new Option('The whole series', 'series')); return c; };
    const f = el('form', 'fr-name ses-invite-form'); const code = el('input'); code.type = 'text'; code.placeholder = 'Friend code'; code.autocomplete = 'off'; code.maxLength = 20; code.setAttribute('aria-label', 'Friend code to invite');
    const sc = scopeSel(), add = btn('Invite', 'btn small'); add.type = 'submit'; add.dataset.act = 'invite'; f.append(code, ...(s.seriesId ? [sc] : []), add);
    f.addEventListener('submit', (e) => { e.preventDefault(); const v = code.value.trim(); if (v) act(async () => { await api.invite(s.id, v, sc.value); await loadPeople(s); }, 'Invitation sent.'); });
    p.append(f);
    const lf = el('form', 'ses-link-form'); const sc2 = scopeSel(), ex = el('select'); ex.setAttribute('aria-label', 'Link lasts');
    for (const [v, t] of [[24, '1 day'], [168, '7 days'], [720, '30 days']]) ex.append(new Option(t, String(v))); ex.value = '168';
    const uses = el('input'); uses.type = 'number'; uses.min = 1; uses.max = 500; uses.value = 25; uses.setAttribute('aria-label', 'Most uses');
    const mk = btn('Create private link', 'btn small'); mk.type = 'submit'; mk.dataset.act = 'link'; lf.append(...(s.seriesId ? [sc2] : []), ex, uses, mk); p.append(lf);
    lf.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { const r = await api.createLink(s.id, { scope: sc2.value, hours: Number(ex.value), maxUses: Number(uses.value) }); newLink = { id: s.id, url: linkUrl(r.token, location.origin + location.pathname) }; await loadPeople(s); }, 'Link created. Copy it now: it is shown only once.'); });
    if (newLink?.id === s.id) {
      const box = el('div', 'ses-newlink'); const i = el('input'); i.type = 'text'; i.readOnly = true; i.value = newLink.url; i.id = 'ses-link-url'; i.setAttribute('aria-label', 'Private link'); i.addEventListener('focus', () => i.select());
      const c = btn('Copy'); c.dataset.act = 'copy'; c.addEventListener('click', async () => { try { await navigator.clipboard.writeText(newLink.url); toast('Link copied.'); } catch { i.select(); toast('Press Ctrl+C to copy the link.'); } });
      box.append(i, c, el('small', 'hint', 'Anyone who signs in and opens this link is added to the invited list. Revoke it below to stop it working.')); p.append(box);
    }
    const inv = invite.get(s.id);
    if (inv) {
      for (const i of inv.invitations) { const r = el('div', 'ses-person'); r.append(el('b', '', i.name), el('small', '', `${i.scope === 'series' ? 'Series' : 'This session'} · ${i.via === 'link' ? 'via link' : 'invited'}${i.revoked ? ' · revoked' : ''}`)); if (!i.revoked) { const b = btn('Revoke'); b.dataset.act = 'revoke-invite'; b.addEventListener('click', () => act(async () => { await api.revokeInvitation(i.id); await loadPeople(s); }, 'Invitation revoked.')); r.append(b); } p.append(r); }
      for (const k of inv.links) { const r = el('div', 'ses-person'); r.append(el('b', '', 'Private link'), el('small', '', `${k.scope === 'series' ? 'Series' : 'This session'} · ${k.uses} of ${k.maxUses} uses · ${k.revoked ? 'revoked' : Date.parse(k.expiresAt) < Date.now() ? 'expired' : 'expires ' + new Date(k.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)); if (!k.revoked) { const b = btn('Revoke'); b.dataset.act = 'revoke-link'; b.addEventListener('click', () => act(async () => { await api.revokeLink(k.id); await loadPeople(s); }, 'Link revoked.')); r.append(b); } p.append(r); }
    }
    return p;
  }

  // ---- links: #session=TOKEN
  let prompted = false;
  async function redeemFromHash() {
    let token = tokenFromHash(location.hash);
    if (token) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* keep the hash */ } try { sessionStorage.setItem(PENDING, token); } catch { /* memory only */ } }
    else { try { token = sessionStorage.getItem(PENDING); } catch { token = null; } }
    if (!token) return;
    if (!signedIn() && ['idle', 'syncing'].includes(handle.sync.status().status)) return; // the saved sign-in is still being read: the status listener below calls this again
    if (!signedIn()) { if (prompted) return; prompted = true; open('invites'); message = 'Sign in to accept the invitation you opened. It will be waiting.'; paint(); return; }
    try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
    try {
      const r = await api.redeemLink(token);
      await loadMine({ quiet: true });
      const s = mine.sessions.find((x) => x.id === r?.session_id);
      open('invites'); if (s) openDetail(s); message = r?.status === 'host' ? 'This is your own session.' : r?.status === 'already_invited' ? 'You were already invited.' : s ? 'You are invited. You can say you will come below.' : 'You are invited. Open the session from the list to say you will come.'; paint();
    } catch (e) { open('invites'); message = e.message || 'This link is not valid.'; paint(); }
  }

  // ---- public
  function open(sec = 'discover', opts = {}) {
    section = sec === 'detail' ? 'mine' : sec; view = 'list'; detail = null; message = ''; editing = null; reporting = null;
    if (opts.near) pub = { ...pub, near: String(opts.near) };
    if (!dlg.open) { opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : opener; dlg.showModal(); fit(); }
    paint();
    if (signedIn()) loadMine({ quiet: mine.status === 'ready' }).then(() => { if (opts.id) { const s = mine.sessions.find((x) => x.id === opts.id) ?? opts.fallback; if (s) openDetail(s); } });
    else if (opts.id && opts.fallback) openDetail(opts.fallback);
    if (section === 'discover' || opts.id) loadPublic().then(() => { if (opts.id && !detail) { const p = pub.list.find((x) => x.id === opts.id) ?? opts.fallback; if (p) openDetail(p.status ? p : asSession(p)); } });
    dlg.querySelector('.ses-tab[aria-selected=true]')?.focus();
  }
  function reset() { seqMine++; seqPub++; mine = mineEmpty(); nearby = null; manageOpen.clear(); people.clear(); invite.clear(); newLink = null; editing = null; reporting = null; message = ''; summaryAt = 0; clearDraft(); if (dlg.open) { if (view !== 'list' && section !== 'discover') { view = 'list'; detail = null; } paint(); } summaryDone(); }

  // sign-in changes: a person who signs in gets their sessions (and a link they opened as a guest is used); sign-out forgets them; a link waits until the saved sign-in has been read
  let was = signedIn();
  handle.onChange(() => {
    const now = signedIn();
    if (now !== was) { was = now; if (now) refreshSummary(true); else reset(); }
    redeemFromHash();
  });

  // ---- the map button (below the other left-hand buttons)
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const b = L.DomUtil.create('div', 'leaflet-bar leaflet-control'); const a = L.DomUtil.create('a', 'sessions-btn', b);
      a.href = '#'; a.role = 'button'; a.title = 'Flight sessions'; a.setAttribute('aria-label', 'Flight sessions: find, join or plan a session'); a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); open('discover'); });
      this._a = a; return b;
    },
  });
  const control = new Control().addTo(map);

  return {
    open, reset, button: control._a,
    reload: () => refreshSummary(true),
    refresh: () => refreshSummary(false),
    summary: summaryNow,
    onSummary: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    setNearby(on) { savePrefs({ sessionsNearby: on ? true : null }); return loadNearby().then(summaryDone); },
    redeemFromHash,
  };
}
