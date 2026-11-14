// An optional label for each of the map's left-hand buttons. The buttons stay as they are (icon-only, their own handlers and state, their own accessible names):
// a toggle button, added last under them, writes the name of what each one does beside it. The labels are a separate layer over the map, placed from the
// buttons' own positions, so no control is cloned, moved or re-bound.
//   - Expanded or not is page memory only: a reload starts collapsed (nothing is stored).
//   - A label follows its button's state (read from data-tool and aria-pressed), and a hidden button (the compass, north-up) has no label.
//   - The layer never takes a tap (pointer-events none), steps aside while a marker is being placed or a point picked, and keeps its state while it does.
//   - Changes are noticed by observers on the button column, not by polling.
import L from 'leaflet';
import { toolLabel } from './map-tool-labels.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor"/></svg>';
const TOOL_OF = (a) => a.dataset.tool || null;

export function initMapToolbarHelp(map, { onExpand = null, onUse = null } = {}) {
  const container = map.getContainer();
  let expanded = false, raf = 0, toggle = null;
  const layer = document.createElement('div');
  layer.id = 'map-tool-labels'; layer.className = 'tool-labels'; layer.hidden = true;
  container.append(layer);

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'labels-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'labels';
      a.title = 'Show map tool labels'; a.setAttribute('aria-label', 'Show map tool labels');
      a.setAttribute('aria-expanded', 'false'); a.setAttribute('aria-controls', layer.id);
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); set(!expanded); });
      a.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) { e.stopPropagation(); set(false); } });
      toggle = a;
      return bar;
    },
  });
  new Control().addTo(map);
  const corner = container.querySelector('.leaflet-top.leaflet-left');

  const stepAside = () => container.classList.contains('is-placing') || !!document.querySelector('.ses-bar:not([hidden])');
  const visible = (a) => !a.closest('[hidden]') && a.getClientRects().length > 0;

  function paint() {
    raf = 0;
    if (!toggle) return;
    const bar = toggle.parentElement; // buttons that arrive later (Flight sessions, after the cloud code loads) go above the toggle, which stays last
    if (bar && corner && corner.lastElementChild !== bar) corner.append(bar);
    toggle.setAttribute('aria-expanded', String(expanded));
    const t = expanded ? 'Hide map tool labels' : 'Show map tool labels';
    if (toggle.title !== t) toggle.title = t;
    toggle.classList.toggle('on', expanded);
    const show = expanded && !stepAside();
    layer.hidden = !show;
    if (!show) { layer.replaceChildren(); return; }
    const cr = container.getBoundingClientRect();
    const rows = [];
    for (const a of corner.querySelectorAll('.leaflet-control a')) {
      const tool = TOOL_OF(a); if (!tool || !visible(a)) continue;
      const text = toolLabel(tool, { pressed: tool === 'labels' ? expanded : a.getAttribute('aria-pressed') === 'true' ? true : a.getAttribute('aria-pressed') === 'false' ? false : null, text: a.getAttribute('aria-label') || '' });
      if (!text) continue;
      const r = a.getBoundingClientRect();
      const row = document.createElement('span');
      row.className = 'tool-label-row'; row.textContent = text; row.setAttribute('aria-hidden', 'true'); row.dataset.tool = tool;
      row.style.setProperty('--tl-left', Math.round(r.right - cr.left + 6) + 'px');
      row.style.top = Math.round(r.top - cr.top) + 'px'; row.style.height = Math.round(r.height) + 'px';
      rows.push(row);
    }
    layer.replaceChildren(...rows);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  function set(on) {
    if (on === expanded) return;
    expanded = on; paint();
    if (on) onExpand?.();
  }

  // what changes the picture: a button added, removed, hidden or re-stated; a resize, fold or rotation of the screen; placing a marker
  if (corner) new MutationObserver(schedule).observe(corner, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'aria-pressed', 'aria-label'] });
  new MutationObserver(schedule).observe(container, { attributes: true, attributeFilter: ['class'] });
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(schedule); ro.observe(container); if (corner) ro.observe(corner); }
  map.on('resize', schedule);
  addEventListener('resize', schedule);
  corner?.addEventListener('click', (e) => { const a = e.target.closest?.('a[data-tool]'); if (a && a.dataset.tool !== 'labels') onUse?.(a.dataset.tool); }, true);
  schedule();

  return { expand: () => set(true), collapse: () => set(false), toggle: () => set(!expanded), get expanded() { return expanded; }, button: toggle, refresh: schedule };
}
