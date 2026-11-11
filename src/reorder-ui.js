// Press and hold a row in the Saved places list for 1 second, then drag it to a new place. Alt + Up / Down does the same a step at a time.
// This file only does the dragging: where a drop lands is worked out by the list (poi-ui.js) and reorder.js.
//
// The list marks its rows: li[data-drag="1"][data-id][data-scope][data-mode][data-gkey], and its headings: li.day-head[data-scope][data-gkey].
// A drop is only possible inside the group of rows with the same data-scope (one trip, or the markers with no trip).

export const HOLD_REORDER_MS = 1000;
const SLOP = 8;

/**
 * @param {object} o
 * @param {HTMLElement} o.list      the <ul> of rows
 * @param {HTMLElement} o.scroller  the element that scrolls it
 * @param {(scope: string) => void} o.onLift   called once a row is lifted (the list can add empty dates to drop on)
 * @param {() => void} o.onEnd                 called when the drag is over, dropped or not
 * @param {(drop: { id, scope, mode, key, index }) => void} o.onDrop
 * @param {(id: string, scope: string, mode: string, dir: number) => void} o.onStep  Alt + arrow
 */
export function initReorder({ list, scroller, onLift, onEnd, onDrop, onStep, holdMs = HOLD_REORDER_MS }) {
  let st = null;

  const rowOf = (id) => list.querySelector(`li[data-id="${CSS.escape(id)}"]`);

  function clearHold() {
    if (!st) return;
    clearTimeout(st.timer);
    st.li?.querySelector('.poi-item')?.classList.remove('holding');
  }
  function finish(drop) {
    if (!st) return;
    clearHold();
    cancelAnimationFrame(st.raf);
    const wasLifted = st.lifted, target = st.target, id = st.id, scope = st.scope, mode = st.mode;
    st.ghost?.remove(); st.line?.remove();
    document.body.classList.remove('reordering');
    rowOf(id)?.classList.remove('lift-source');
    st = null;
    if (wasLifted) {
      // the pointer release that ends a drag must not count as a click on the row
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      list.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => list.removeEventListener('click', swallow, true), 400);
      onEnd();
      if (drop && target) onDrop({ id, scope, mode, key: target.key, index: target.index });
    }
  }

  /** The places a row can be dropped into, within the group of the dragged row, and the one nearest to y. */
  function slotsFor() {
    const groups = [];
    for (const li of list.children) {
      if (li.dataset.scope !== st.scope) continue;
      if (li.classList.contains('day-head')) groups.push({ key: li.dataset.gkey, head: li, rows: [] });
      else if (li.dataset.id && li.dataset.id !== st.id && groups.length) groups[groups.length - 1].rows.push(li);
    }
    const slots = [];
    for (const g of groups) {
      for (let i = 0; i <= g.rows.length; i++) {
        const y = i < g.rows.length ? g.rows[i].getBoundingClientRect().top : (g.rows.length ? g.rows[i - 1] : g.head).getBoundingClientRect().bottom;
        slots.push({ key: g.key, index: i, y, before: i < g.rows.length ? g.rows[i] : null, after: i < g.rows.length ? null : (g.rows.length ? g.rows[i - 1] : g.head) });
      }
    }
    return slots;
  }
  function place() {
    const slots = slotsFor();
    if (!slots.length) return;
    // well outside this group (over another trip, or the page below): no place to drop, so letting go changes nothing
    const mine = [...list.children].filter((li) => li.dataset.scope === st.scope);
    const top = mine[0].getBoundingClientRect().top, bottom = mine[mine.length - 1].getBoundingClientRect().bottom;
    if (st.y < top - 28 || st.y > bottom + 28) { st.target = null; st.line?.remove(); return; }
    let best = slots[0];
    for (const s of slots) if (Math.abs(s.y - st.y) < Math.abs(best.y - st.y)) best = s;
    st.target = { key: best.key, index: best.index };
    if (!st.line) { st.line = document.createElement('li'); st.line.className = 'drop-line'; st.line.setAttribute('aria-hidden', 'true'); }
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
    document.body.classList.add('reordering');
    navigator.vibrate?.(30);
    place();
    st.raf = requestAnimationFrame(tick);
  }

  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-drag="1"]');
    if (!li || !list.contains(li) || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (st) finish(false);
    st = { id: li.dataset.id, scope: li.dataset.scope, mode: li.dataset.mode, li, x: e.clientX, y: e.clientY, pid: e.pointerId, lifted: false, target: null };
    const btn = li.querySelector('.poi-item');
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
    const li = e.target.closest('li[data-drag="1"]');
    if (!li) return;
    e.preventDefault();
    onStep(li.dataset.id, li.dataset.scope, li.dataset.mode, e.key === 'ArrowUp' ? -1 : 1);
  });
}
