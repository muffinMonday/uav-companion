// The More tools menu: one button under the map's Zoom, Locate and (while the map is turned) Compass buttons that opens a small menu of the other
// map tools: Marker details, Side Quests, Trip markers, Crosshair and Flight Sessions (only where this build has it).
//   - Nothing is cloned or re-implemented. Each tool keeps its own Leaflet control, handler and state (poi-ui.js, crosshair.js, sessions-hub.js); the control is only
//     taken off the map (class tool-folded) and a menu row presses it, so there is one handler per tool. A row reads the tool's own aria-pressed.
//   - Rows follow the buttons: one that arrives later (Flight Sessions, after the cloud code loads) gets a row, one that is hidden or removed loses it. Observers, no polling.
//   - Roomy screens: a popover beside the button. Narrow phones (max-width 520px): a compact sheet along the bottom, above the safe area.
//   - Display toggles keep the menu open; Flight Sessions closes it first. Outside press or Escape closes it (Escape returns to the button). It also closes when a marker is
//     being placed or a point picked. Whether it is open is page memory only: a reload starts closed.
import L from 'leaflet';
import { FOLDED, toolRow } from './map-tool-labels.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></svg>';
const TOOL_OF = (a) => a.dataset.tool || null;

export function initMapMoreTools(map, { onOpen = null, onUse = null } = {}) {
  const container = map.getContainer();
  let isOpen = false, raf = 0, toggle = null;
  const menu = document.createElement('div');
  menu.id = 'more-tools-menu'; menu.className = 'more-menu'; menu.hidden = true;
  menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'More map tools');
  const head = document.createElement('div'); head.className = 'more-head';
  const title = document.createElement('span'); title.className = 'more-title'; title.textContent = 'More tools';
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'more-close'; closeBtn.setAttribute('aria-label', 'Close More tools'); closeBtn.textContent = '×';
  head.append(title, closeBtn);
  const list = document.createElement('div'); list.className = 'more-list';
  menu.append(head, list);
  L.DomEvent.disableClickPropagation(menu); L.DomEvent.disableScrollPropagation(menu);
  container.append(menu);

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'more-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'more';
      a.title = 'More tools'; a.setAttribute('aria-label', 'More tools');
      a.setAttribute('aria-haspopup', 'true'); a.setAttribute('aria-expanded', 'false'); a.setAttribute('aria-controls', menu.id);
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); set(!isOpen, { focus: true }); });
      toggle = a;
      return bar;
    },
  });
  new Control().addTo(map);
  const corner = container.querySelector('.leaflet-top.leaflet-left');

  const stepAside = () => container.classList.contains('is-placing') || !!document.querySelector('.ses-bar:not([hidden])');
  const present = (a) => !a.closest('[hidden]'); // a control the owning module has hidden has no row (the button itself is folded away, so it has no box either way)
  const tools = () => [...(corner?.querySelectorAll('.leaflet-control a[data-tool]') ?? [])].filter((a) => FOLDED.includes(TOOL_OF(a)) && present(a)).sort((x, y) => FOLDED.indexOf(TOOL_OF(x)) - FOLDED.indexOf(TOOL_OF(y)));
  const pressedOf = (a) => (a.getAttribute('aria-pressed') === 'true' ? true : a.getAttribute('aria-pressed') === 'false' ? false : null);

  /** Takes the folded tools' own controls off the map (they stay in the page: the rows press them) and keeps this button last. */
  function fold() {
    if (!corner || !toggle) return;
    for (const a of corner.querySelectorAll('.leaflet-control a[data-tool]')) { const bar = FOLDED.includes(TOOL_OF(a)) ? a.closest('.leaflet-control') : null; if (bar && !bar.classList.contains('tool-folded')) bar.classList.add('tool-folded'); } // (add() on a present class still fires the observer)
    const bar = toggle.parentElement; // buttons that arrive later (Flight sessions, after the cloud code loads) go above this one, which stays last
    if (bar && corner.lastElementChild !== bar) corner.append(bar);
  }

  function rows() {
    const out = [];
    for (const a of tools()) {
      const tool = TOOL_OF(a), pressed = pressedOf(a), r = toolRow(tool, { pressed });
      if (!r) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'more-row'; b.dataset.tool = tool;
      if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
      const name = document.createElement('span'); name.className = 'more-name'; name.textContent = r.name;
      b.append(name);
      if (r.state) { const st = document.createElement('span'); st.className = 'more-state'; st.textContent = r.state; b.append(st); }
      b.addEventListener('click', () => press(a, tool));
      out.push(b);
    }
    return out;
  }
  /** Presses the tool's own control: its handler runs once and it repaints its own state; the menu then follows through the observer. */
  function press(a, tool) {
    if (tool === 'sessions') { toggle?.focus({ preventScroll: true }); set(false, { focus: false }); } // the hub opens a dialog: the menu steps out of its way first, and the hub returns focus to this button
    onUse?.(tool);
    a.click();
  }

  function paint() {
    raf = 0;
    fold();
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', String(isOpen));
    if (toggle.classList.contains('on') !== isOpen) toggle.classList.toggle('on', isOpen);
    if (isOpen && stepAside()) { set(false, { focus: false }); return; }
    menu.hidden = !isOpen;
    if (!isOpen) return;
    const focused = document.activeElement?.closest?.('.more-row')?.dataset.tool;
    list.replaceChildren(...rows());
    if (focused) list.querySelector(`.more-row[data-tool="${focused}"]`)?.focus({ preventScroll: true }); // the redraw after a press keeps the focus where it was
    place();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  function place() {
    const phone = matchMedia('(max-width: 520px)').matches;
    menu.classList.toggle('sheet', phone);
    if (phone || !toggle) { menu.style.left = ''; menu.style.top = ''; return; }
    const cr = container.getBoundingClientRect(), r = toggle.getBoundingClientRect();
    menu.style.left = Math.round(r.right - cr.left + 8) + 'px';
    const top = Math.max(8, Math.min(r.top - cr.top, cr.height - menu.offsetHeight - 8));
    menu.style.top = Math.round(top) + 'px';
  }

  function set(on, { focus = false } = {}) {
    if (on === isOpen) return;
    if (on && stepAside()) return;
    isOpen = on;
    paint();
    if (on) { onOpen?.(); if (focus) list.querySelector('.more-row')?.focus({ preventScroll: true }); }
    else if (focus) toggle?.focus({ preventScroll: true });
  }

  closeBtn.addEventListener('click', () => set(false, { focus: true }));
  document.addEventListener('pointerdown', (e) => { if (isOpen && !menu.contains(e.target) && !toggle?.contains(e.target)) set(false); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && (menu.contains(document.activeElement) || toggle === document.activeElement)) { e.stopPropagation(); set(false, { focus: true }); } }, true);

  // what changes the picture: a button added, removed, hidden or re-stated; a resize, fold or rotation of the screen; placing a marker. A redraw of the map itself is not one of them.
  if (corner) new MutationObserver(schedule).observe(corner, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'aria-pressed'] });
  new MutationObserver(schedule).observe(container, { attributes: true, attributeFilter: ['class'] });
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(schedule); ro.observe(container); if (corner) ro.observe(corner); }
  map.on('resize', schedule);
  addEventListener('resize', schedule);
  corner?.addEventListener('click', (e) => { const a = e.target.closest?.('a[data-tool]'); if (a && ['locate', 'compass'].includes(a.dataset.tool)) onUse?.(a.dataset.tool); }, true);
  schedule();

  return { open: () => set(true), close: () => set(false), toggle: () => set(!isOpen), get isOpen() { return isOpen; }, button: toggle, refresh: schedule };
}
