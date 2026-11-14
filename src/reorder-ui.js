// Press and hold a row in the Saved places list for 1 second, then drag it to a new place. Alt + Up / Down does the same a step at a time.
// This file only does the dragging: where a drop lands is worked out by the list (poi-ui.js) and reorder.js.
//
// The list marks its rows: li[data-drag="1"][data-id][data-scope][data-mode][data-gkey], and its headings: li.day-head[data-scope][data-gkey].
// A drop is only possible inside the group of rows with the same data-scope (one trip, or the markers with no trip).
// A Side Quest row is also li[data-sub="1"][data-parent=<its main stop's id>]. It is dropped between its siblings, on another main stop's row
// (it then hangs from that stop) or on a heading (it leaves its stop and takes that date). A main stop's Side Quest rows fold away while it is lifted.

export const HOLD_REORDER_MS = 1000;
const SLOP = 8;

/**
 * @param {object} o
 * @param {HTMLElement} o.list      the <ul> of rows
 * @param {HTMLElement} o.scroller  the element that scrolls it
 * @param {(scope: string) => void} o.onLift   called once a row is lifted (the list can add empty dates to drop on)
 * @param {() => void} o.onEnd                 called when the drag is over, dropped or not
 * @param {(drop: { id, scope, mode, key, index, sub, parent, kind }) => void} o.onDrop  (a Side Quest: sub true; parent = the main stop it is dropped under; kind 'head' on a heading)
 * @param {(id: string, scope: string, mode: string, dir: number) => void} o.onStep  Alt + arrow
 */
export function initReorder({ list, scroller, onLift = () => {}, onEnd = () => {}, onDrop, onStep, holdMs = HOLD_REORDER_MS, flat = false }) {
  let st = null;

  // Rows are any elements with data-drag (li.poi-item rows in the list; .plan-stop rows, or a .plan-row holding one, on a day page of the Trips tab).
  // `flat`: a list with no headings, all of its rows in one group whose key is the dragged row's data-gkey (the day page: a drop stays within the day).
  const rowOf = (id) => list.querySelector(`[data-id="${CSS.escape(id)}"][data-scope]`);
  const holder = (li) => (li?.matches('.plan-stop') ? li : li?.querySelector('.poi-item, .plan-stop'));
  const scoped = () => [...list.querySelectorAll('[data-scope]')].filter((li) => li.dataset.scope === st.scope && !li.hidden);

  function clearHold() {
    if (!st) return;
    clearTimeout(st.timer);
    holder(st.li)?.classList.remove('holding');
  }
  function finish(drop) {
    if (!st) return;
    clearHold();
    cancelAnimationFrame(st.raf);
    const wasLifted = st.lifted, target = st.target, id = st.id, scope = st.scope, mode = st.mode, sub = st.sub;
    st.ghost?.remove(); st.line?.remove();
    for (const r of st.folded ?? []) r.hidden = false;
    document.body.classList.remove('reordering');
    rowOf(id)?.classList.remove('lift-source');
    st = null;
    if (wasLifted) {
      // the pointer release that ends a drag must not count as a click on the row: swallow one click, until the next touch or press
      // (a new tap right after a drop must not be swallowed) or 400 ms, whichever comes first
      const release = () => { list.removeEventListener('click', swallow, true); document.removeEventListener('pointerdown', release, true); clearTimeout(timer); };
      const swallow = (e) => { release(); e.stopPropagation(); e.preventDefault(); };
      const timer = setTimeout(release, 400);
      list.addEventListener('click', swallow, true);
      document.addEventListener('pointerdown', release, true);
      onEnd();
      if (drop && target) onDrop({ id, scope, mode, key: target.key, index: target.index, sub, parent: target.parent, kind: target.kind });
    }
  }

  /** The places a row can be dropped into, within the group of the dragged row, and the one nearest to y. */
  /** Places for a Side Quest: between the Side Quests of each main stop (the last place also covers a stop whose Side Quests are folded) and on each heading. */
  function sideSlotsFor() {
    const rows = scoped();
    const slots = [];
    for (const li of rows) {
      if (li.classList.contains('day-head')) { const r = li.getBoundingClientRect(); slots.push({ kind: 'head', key: li.dataset.gkey, index: 0, y: (r.top + r.bottom) / 2, before: null, after: li }); continue; }
      if (!li.dataset.id || li.dataset.sub || li.dataset.id === st.id) continue;
      const kids = rows.filter((x) => x.dataset.sub && x.dataset.parent === li.dataset.id && x.dataset.id !== st.id);
      const base = { kind: 'card', key: li.dataset.gkey, parent: li.dataset.id };
      kids.forEach((k, i) => slots.push({ ...base, index: i, y: k.getBoundingClientRect().top, before: k, after: null }));
      const last = kids.length ? kids[kids.length - 1] : li;
      slots.push({ ...base, index: Infinity, y: last.getBoundingClientRect().bottom, before: null, after: last });
    }
    return slots;
  }
  function slotsFor() {
    if (st.sub) return sideSlotsFor();
    const all = scoped();
    const groups = flat ? [{ key: st.li.dataset.gkey, head: null, rows: [] }] : [];
    for (const li of all) {
      if (li.classList.contains('day-head')) groups.push({ key: li.dataset.gkey, head: li, rows: [] });
      else if (li.dataset.id && li.dataset.id !== st.id && !li.dataset.sub && groups.length) groups[groups.length - 1].rows.push(li);
    }
    // the unfolded Side Quests of a row belong to it: a drop below the row lands below them
    const tail = (row) => all.filter((x) => x.dataset.sub && x.dataset.parent === row.dataset.id).pop() ?? row;
    const slots = [];
    for (const g of groups) {
      if (!g.head && !g.rows.length) continue;
      for (let i = 0; i <= g.rows.length; i++) {
        const prev = i > 0 ? tail(g.rows[i - 1]) : g.head;
        const y = i < g.rows.length ? g.rows[i].getBoundingClientRect().top : prev.getBoundingClientRect().bottom;
        slots.push({ key: g.key, index: i, y, before: i < g.rows.length ? g.rows[i] : null, after: i < g.rows.length ? null : prev });
      }
    }
    return slots;
  }
  function place() {
    const slots = slotsFor();
    if (!slots.length) return;
    // well outside this group (over another trip, or the page below): no place to drop, so letting go changes nothing
    const mine = scoped();
    const top = mine[0].getBoundingClientRect().top, bottom = mine[mine.length - 1].getBoundingClientRect().bottom;
    if (st.y < top - 28 || st.y > bottom + 28) { st.target = null; st.line?.remove(); return; }
    let best = slots[0];
    for (const s of slots) if (Math.abs(s.y - st.y) < Math.abs(best.y - st.y)) best = s;
    st.target = { key: best.key, index: best.index, parent: best.parent, kind: best.kind };
    if (!st.line) { st.line = document.createElement(list.tagName === 'UL' ? 'li' : 'div'); st.line.className = 'drop-line'; st.line.setAttribute('aria-hidden', 'true'); }
    if (best.before) best.before.before(st.line); else best.after.after(st.line);
  }
  function tick() {
    if (!st?.lifted) return;
    const r = scroller.getBoundingClientRect();
    const edge = 56;
    let dy = 0;
    if (st.y < r.top + edge) dy = -Math.ceil((1 - Math.max(0, st.y - r.top) / edge) * 14);
    else if (st.y > r.bottom - edge) dy = Math.ceil((1 - Math.max(0, r.bottom - st.y) / edge) * 14);
    if (dy) { scroller.scrollTop += dy; place(); }
    st.raf = requestAnimationFrame(tick);
  }

  function lift() {
    if (!st) return;
    clearHold();
    st.lifted = true;
    onLift(st.scope);                       // the list may add empty dates to drop on (it must not redraw the row under the finger)
    const li = rowOf(st.id);
    if (!li) { finish(false); return; }
    const r = li.getBoundingClientRect();
    st.grab = st.y - r.top;
    const ghost = li.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-drag');
    Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    document.body.append(ghost);
    st.ghost = ghost;
    li.classList.add('lift-source');
    if (!st.sub) { // the Side Quests of a lifted main stop fold away
      st.folded = [...list.querySelectorAll(`[data-sub="1"][data-parent="${CSS.escape(st.id)}"]`)];
      for (const r of st.folded) r.hidden = true;
    }
    document.body.classList.add('reordering');
    navigator.vibrate?.(30);
    place();
    st.raf = requestAnimationFrame(tick);
  }

  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('[data-drag="1"]');
    if (!li || !list.contains(li) || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (st) finish(false);
    st = { id: li.dataset.id, scope: li.dataset.scope, mode: li.dataset.mode, sub: li.dataset.sub === '1', li, x: e.clientX, y: e.clientY, pid: e.pointerId, lifted: false, target: null };
    const btn = holder(li);
    btn?.style.setProperty('--hold-ms', `${holdMs}ms`);
    btn?.classList.add('holding');
    st.timer = setTimeout(lift, holdMs);
  });
  document.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.pid) return;
    if (!st.lifted) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > SLOP) { clearHold(); st = null; } // moved before the hold was over: scrolling, not dragging
      return;
    }
    st.y = e.clientY;
    if (st.ghost) st.ghost.style.top = `${e.clientY - st.grab}px`;
    place();
  });
  const up = (e) => { if (st && e.pointerId === st.pid) finish(e.type === 'pointerup'); };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st?.lifted) { e.preventDefault(); e.stopPropagation(); finish(false); } }, true);
  // once a row is lifted the finger moves the row, not the page
  document.addEventListener('touchmove', (e) => { if (st?.lifted && e.cancelable) e.preventDefault(); }, { passive: false });
  list.addEventListener('contextmenu', (e) => { if (st) e.preventDefault(); }); // a touch long-press would open the browser menu

  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const li = e.target.closest('[data-drag="1"]');
    if (!li || !list.contains(li)) return;
    e.preventDefault();
    onStep(li.dataset.id, li.dataset.scope, li.dataset.mode, e.key === 'ArrowUp' ? -1 : 1);
  });
}
