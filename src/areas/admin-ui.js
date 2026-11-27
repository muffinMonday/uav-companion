// Community flying areas, Phase 3: the administrator moderation panel. Reached only from a button in "My flying areas" that exists while the signed-in account is an
// administrator (my_roles). That check is presentation: every moderation function enforces has_role(auth.uid(), 'admin') on the server. All text is set with textContent.
import L from 'leaflet';
import { el } from '../cards.js';
import { formatArea, SPOT_LABELS } from './core.js';
import { areaCentre } from './geo.js';
import { createAdminApi, describeChanges, XP_AMOUNTS, XP_DEFAULT, MAX_REASON, checkReason, checkReward } from './admin-api.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

/** A small outline preview of a ring (and its setup spots) as an SVG: equirectangular, corrected for latitude, fitted to the box. No map tiles, nothing fetched. */
export function previewSvg(ring, spots = [], size = { w: 240, h: 150 }) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`); svg.setAttribute('class', 'area-admin-preview'); svg.setAttribute('role', 'img');
  if (!ring?.length) return svg;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length, k = Math.cos(lat0 * Math.PI / 180);
  const pts = ring.map((p) => [p[0] * k, -p[1]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(...xs) - x0 || 1e-9, dy = Math.max(...ys) - y0 || 1e-9, pad = 10;
  const sc = Math.min((size.w - 2 * pad) / dx, (size.h - 2 * pad) / dy);
  const ox = (size.w - dx * sc) / 2, oy = (size.h - dy * sc) / 2;
  const pos = (lng, lat) => [(lng * k - x0) * sc + ox, (-lat - y0) * sc + oy];
  const poly = document.createElementNS(SVGNS, 'polygon');
  poly.setAttribute('points', ring.map((p) => pos(p[0], p[1]).map((n) => n.toFixed(1)).join(',')).join(' ')); poly.setAttribute('class', 'area-admin-shape');
  svg.append(poly);
  for (const s of spots) {
    const [cx, cy] = pos(s.coordinates[0], s.coordinates[1]);
    const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('cx', cx.toFixed(1)); c.setAttribute('cy', cy.toFixed(1)); c.setAttribute('r', '4'); c.setAttribute('class', 'area-admin-spot');
    svg.append(c);
  }
  return svg;
}

export function createAdminUI({ map, backend, toast }) {
  const api = createAdminApi(backend);
  const container = map.getContainer();
  const overlay = L.layerGroup().addTo(map);
  const listeners = new Set();
  let admin = false, isOpen = false, tab = 'pending', items = [], next = null, loading = false, failed = '', sel = null, confirm = null, token = 0;
  let award = true, amount = XP_DEFAULT, reason = '';

  const root = el('div', 'areas-panel areas-admin-panel'); root.id = 'areas-admin-panel'; root.hidden = true;
  root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Review community flying areas');
  L.DomEvent.disableClickPropagation(root); L.DomEvent.disableScrollPropagation(root);
  container.append(root);
  const b = (label, fn, { cls = 'btn', act = '', aria = '' } = {}) => { const x = el('button', cls, label); x.type = 'button'; if (act) x.dataset.act = act; if (aria) x.setAttribute('aria-label', aria); x.addEventListener('click', fn); return x; };

  async function refreshRole() {
    const mine = ++token; // a role answer that arrives after sign-out or a newer check is ignored
    const now = backend.signedIn() ? await api.isAdmin() : false;
    if (mine !== token) return;
    if (now !== admin) { admin = now; if (!admin && isOpen) set(false); for (const f of listeners) { try { f(); } catch { /* ignore */ } } }
  }
  async function load(more = false) {
    if (loading) return;
    loading = true; failed = ''; paint();
    try {
      const page = await (tab === 'pending' ? api.listPending(more ? next : null) : api.listPublished(more ? next : null));
      items = more ? [...items, ...page.items.filter((x) => !items.some((y) => y.revisionId === x.revisionId))] : page.items; next = page.next;
    } catch (e) { failed = e.message ?? 'Could not load.'; if (e.code === 'not_allowed') { admin = false; set(false); } }
    loading = false; paint();
  }
  function show(item) {
    overlay.clearLayers();
    if (!item?.ring) return;
    const p = L.polygon(item.ring.map((c) => [c[1], c[0]]), { className: 'community-area', interactive: false }).addTo(overlay);
    map.fitBounds(p.getBounds(), { padding: [40, 40], maxZoom: 18 });
  }
  function open(it) { sel = it; confirm = null; award = !it.own; amount = XP_DEFAULT; reason = ''; paint(); }
  function back() { sel = null; confirm = null; overlay.clearLayers(); paint(); }

  async function decide(kind) { // kind: 'approve' | 'reject' | 'unpublish'
    const it = sel; if (!it) return;
    try {
      if (kind === 'unpublish') { await api.unpublish(it, reason); toast(`“${it.name}” is no longer published. Its history is kept.`, 7000); }
      else {
        const r = await api.review(it, kind, { reason, award, amount });
        if (!r.changed) toast('That decision was already recorded.', 5000);
        else if (kind === 'approve') toast(r.xpAwarded ? `Approved and published. ${r.xp} XP awarded to the contributor.` : 'Approved and published. No XP awarded.', 8000);
        else toast('Rejected. The contributor can see your reason.', 7000);
      }
      sel = null; confirm = null; overlay.clearLayers(); await load();
    } catch (e) {
      confirm = null; toast(e.message, 8000);
      if (e.code === 'not_pending' || e.code === 'not_found' || e.code === 'not_published') { sel = null; overlay.clearLayers(); await load(); } else paint();
    }
  }

  function itemMeta(it) {
    const c = areaCentre(it.ring ?? []);
    return [it.contributorName ? `${it.contributorName}${it.contributorCode ? ' (' + it.contributorCode + ')' : ''}` : 'Contributor unavailable', `submitted ${fmtDate(it.submittedAt)}`, c ? `${c[1].toFixed(4)}, ${c[0].toFixed(4)}` : 'location unavailable', formatArea(it.areaM2),
      `${it.spots.length} setup spot${it.spots.length === 1 ? '' : 's'}`, it.published ? `proposed change (revision ${it.revisionNo}) to a published area` : `revision ${it.revisionNo}${it.hasPublished ? '' : ' (new area)'}`];
  }
  function card(it) {
    const li = el('li', 'area-item area-admin-item'); li.dataset.revision = it.revisionId;
    li.append(el('div', 'area-item-name', it.name));
    if (it.published) { const tag = el('span', 'area-admin-tag', 'Proposed change'); li.querySelector('.area-item-name').append(' ', tag); }
    li.append(el('div', 'area-item-meta', itemMeta(it).join(' · ')));
    if (it.description) li.append(el('div', 'area-item-desc', it.description.length > 140 ? it.description.slice(0, 140) + '…' : it.description));
    li.append(previewSvg(it.ring, it.spots));
    if (!it.valid) li.append(el('div', 'areas-warn', 'This outline did not pass the local checks; review it carefully.'));
    const row = el('div', 'area-item-actions'); row.append(b(tab === 'pending' ? 'Review' : 'Open', () => open(it), { cls: 'btn primary', act: 'open', aria: `Open ${it.name}` })); li.append(row);
    return li;
  }

  function detail() {
    const it = sel, own = it.own, pending = it.status === 'pending' && tab === 'pending';
    const box = el('div', 'area-admin-detail');
    box.append(b('← Back to the list', back, { act: 'back' }), el('strong', 'area-admin-name', it.name), el('div', 'area-item-meta', itemMeta(it).join(' · ')));
    if (it.published) {
      box.append(el('p', 'areas-warn area-admin-revision', 'This is a proposed change to a published area. The published version stays public until you approve it.'));
      const ch = el('ul', 'area-admin-changes'); ch.setAttribute('aria-label', 'What changes'); for (const c of describeChanges(it)) ch.append(el('li', '', c)); box.append(ch);
      const cmp = el('div', 'area-admin-compare');
      const cur = el('figure', 'area-admin-fig'); cur.dataset.which = 'published'; cur.append(previewSvg(it.published.ring, it.published.spots), el('figcaption', '', `Published now (revision ${it.published.revisionNo}): ${it.published.name}, ${formatArea(it.published.areaM2)}`));
      const prop = el('figure', 'area-admin-fig'); prop.dataset.which = 'proposed'; prop.append(previewSvg(it.ring, it.spots), el('figcaption', '', `Proposed (revision ${it.revisionNo}): ${it.name}, ${formatArea(it.areaM2)}`));
      cmp.append(cur, prop); box.append(cmp);
      if (it.published.description !== it.description) box.append(el('div', 'area-admin-prevdesc', 'Published description: ' + (it.published.description || 'none')));
    } else box.append(previewSvg(it.ring, it.spots, { w: 300, h: 190 }));
    box.append(b('Show on the map', () => show(it), { act: 'show-map' }));
    box.append(el('div', 'area-admin-desc', it.description || 'No description.'));
    if (it.spots.length) { const ul = el('ul', 'area-admin-spots'); for (const s of it.spots) ul.append(el('li', '', `${SPOT_LABELS[s.type] ?? s.type}${s.note ? ': ' + s.note : ''} (${s.coordinates[1].toFixed(5)}, ${s.coordinates[0].toFixed(5)})`)); box.append(ul); }
    box.append(el('p', 'areas-note', 'A community area is a recommendation, never flight authorization, and never changes an official airspace result.'));
    if (own) box.append(el('p', 'areas-warn', 'This is your own submission: it can be approved or rejected, but it cannot earn you XP.'));

    if (confirm) { box.append(confirmBox(it)); return box; }
    if (pending) {
      const ap = el('fieldset', 'area-admin-approve'); ap.append(el('legend', 'area-label', 'Approve and publish'));
      const lab = el('label', 'area-ack'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'area-award'; cb.checked = award && !own; cb.disabled = own;
      lab.append(cb, el('span', '', ' Award contribution XP'));
      const sl = el('input'); sl.type = 'range'; sl.id = 'area-xp'; sl.min = String(XP_AMOUNTS[0]); sl.max = String(XP_AMOUNTS[XP_AMOUNTS.length - 1]); sl.step = '100'; sl.value = String(amount); sl.disabled = !cb.checked;
      sl.setAttribute('aria-label', 'XP amount');
      const out = el('output', 'area-admin-xp', `${amount} XP`); out.id = 'area-xp-out';
      cb.addEventListener('change', () => { award = cb.checked; sl.disabled = !award; out.hidden = !award; });
      sl.addEventListener('input', () => { amount = Number(sl.value); out.textContent = `${amount} XP`; });
      out.hidden = !cb.checked;
      const note = el('textarea'); note.id = 'area-approve-note'; note.rows = 2; note.maxLength = MAX_REASON; note.placeholder = 'Optional note kept with the decision'; note.addEventListener('input', () => { reason = note.value; });
      ap.append(lab, el('div', 'area-admin-xp-row'), note);
      ap.querySelector('.area-admin-xp-row').append(sl, out);
      if (it.published) ap.append(el('p', 'area-note', 'A revision earns XP only when it materially improves the area (a corrected boundary, a missing part, useful site information). Untick it for cosmetic or identical-in-effect changes.'));
      ap.append(el('p', 'area-note', 'XP is a judgement of value: untick it for a duplicate, cosmetic or marginal contribution. It never decides whether the area is published.'));
      ap.append(b('Approve…', () => {
        const w = checkReward(award, amount, own); const r = checkReason(reason, false);
        if (!w.ok || !r.ok) { toast(w.message || r.message, 6000); return; }
        confirm = 'approve'; paint();
      }, { cls: 'btn primary', act: 'approve' }));
      const rj = el('fieldset', 'area-admin-reject'); rj.append(el('legend', 'area-label', 'Reject'));
      const why = el('textarea'); why.id = 'area-reject-reason'; why.rows = 3; why.maxLength = MAX_REASON; why.placeholder = 'Reason shown to the contributor (required)'; why.value = confirm === null && sel.rejectDraft ? sel.rejectDraft : '';
      const count = el('div', 'area-count', `0 / ${MAX_REASON}`); const rerr = el('div', 'area-errors'); rerr.setAttribute('role', 'alert');
      why.addEventListener('input', () => { sel.rejectDraft = why.value; count.textContent = `${why.value.length} / ${MAX_REASON}`; });
      rj.append(why, count, rerr, b('Reject…', () => {
        const r = checkReason(why.value, true);
        if (!r.ok) { rerr.textContent = r.message; return; }
        reason = r.text; confirm = 'reject'; paint();
      }, { cls: 'btn danger', act: 'reject' }));
      box.append(ap, rj);
    } else if (tab === 'published') {
      const un = el('fieldset', 'area-admin-reject'); un.append(el('legend', 'area-label', 'Unpublish'));
      const why = el('textarea'); why.id = 'area-unpublish-reason'; why.rows = 3; why.maxLength = MAX_REASON; why.placeholder = 'Reason (required)';
      const rerr = el('div', 'area-errors'); rerr.setAttribute('role', 'alert');
      un.append(why, rerr, el('p', 'area-note', 'The area stops being eligible for any public read. Its history and any XP already awarded stay.'),
        b('Unpublish…', () => { const r = checkReason(why.value, true); if (!r.ok) { rerr.textContent = r.message; return; } reason = r.text; confirm = 'unpublish'; paint(); }, { cls: 'btn danger', act: 'unpublish' }));
      box.append(un);
    }
    return box;
  }
  function confirmBox(it) {
    const c = el('div', 'area-admin-confirm'); c.setAttribute('role', 'alertdialog'); c.setAttribute('aria-label', 'Confirm decision');
    if (confirm === 'approve') {
      const w = checkReward(award, amount, it.own);
      c.append(el('p', '', it.published ? `Approve this change and replace the published version of “${it.published.name}”?` : `Approve and publish “${it.name}”?`), el('p', 'area-admin-xp-line', w.award ? `${w.amount} XP will be awarded to ${it.contributorName || 'the contributor'}.` : 'No XP will be awarded.'));
    } else if (confirm === 'reject') c.append(el('p', '', `Reject “${it.name}”?`), el('p', 'area-note', 'The contributor will see this reason:'), el('blockquote', 'area-admin-quote', reason));
    else c.append(el('p', '', `Unpublish “${it.name}”?`), el('p', 'area-note', 'Reason (kept with the area): ' + reason));
    const row = el('div', 'area-item-actions');
    row.append(b('Confirm', (e) => { e.currentTarget.disabled = true; decide(confirm); }, { cls: 'btn primary', act: 'confirm' }), b('Cancel', () => { confirm = null; paint(); }, { act: 'cancel' }));
    c.append(row); return c;
  }

  function paint() {
    root.classList.toggle('sheet', matchMedia('(max-width: 520px)').matches);
    root.hidden = !isOpen || !admin;
    if (root.hidden) return;
    const head = el('div', 'areas-head');
    head.append(el('strong', 'areas-title', 'Review flying areas'), b('×', () => set(false), { cls: 'areas-close', act: 'close', aria: 'Close review' }));
    if (sel) { root.replaceChildren(head, detail()); return; }
    const tabs = el('div', 'areas-actions');
    for (const [k, label] of [['pending', 'Pending'], ['published', 'Published']]) { const t = b(label, () => { if (tab !== k) { tab = k; items = []; next = null; load(); } }, { cls: 'btn' + (tab === k ? ' primary' : ''), act: 'tab-' + k }); t.setAttribute('aria-pressed', String(tab === k)); tabs.append(t); }
    tabs.append(b('Refresh', () => load(), { act: 'refresh' }));
    const list = el('ul', 'areas-list'); list.setAttribute('aria-label', tab === 'pending' ? 'Pending submissions, oldest first' : 'Published areas');
    if (failed) list.append(el('li', 'areas-warn', failed));
    else if (loading && !items.length) list.append(el('li', 'areas-empty', 'Loading…'));
    else if (!items.length) list.append(el('li', 'areas-empty', tab === 'pending' ? 'Nothing is waiting for review.' : 'No published areas.'));
    for (const it of items) list.append(card(it));
    const more = next ? [b('Load more', () => load(true), { act: 'more' })] : [];
    root.replaceChildren(head, el('p', 'areas-note', 'Administrators only. The contributor’s name and code are shown here for review and nowhere else.'), tabs, list, ...more);
  }
  function set(on) {
    if (on && !admin) return;
    if (on === isOpen) return;
    isOpen = on; sel = null; confirm = null; overlay.clearLayers(); paint();
    if (on) { tab = 'pending'; items = []; next = null; load(); }
  }
  backend.onChange?.(() => refreshRole());
  refreshRole();
  addEventListener('resize', () => { if (isOpen) paint(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && root.contains(document.activeElement)) { e.stopPropagation(); set(false); } }, true);
  return { isAdmin: () => admin, open: () => set(true), close: () => set(false), refreshRole, get isOpen() { return isOpen; }, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); } };
}
