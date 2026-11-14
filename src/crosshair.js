// A crosshair at the centre of the map, with the coordinates under it, and a button on the map to switch it. The centre it marks is the point
// "Place at map centre" uses. It is on by default; the choice is remembered. It steps aside while a window is open (the window would cover it).
import L from 'leaflet';
import { loadPrefs, savePrefs } from './prefs.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path class="slash" d="M4 3l16 18"/></svg>';

export function initCrosshair(map) {
  let on = loadPrefs().crosshair !== false;
  const box = L.DomUtil.create('div', 'crosshair', map.getContainer());
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2v8M14 18v8M2 14h8M18 14h8"/></svg><span class="cross-label"></span>'; // built from constants only
  const label = box.querySelector('.cross-label');
  const update = () => { const c = map.getCenter().wrap(); label.textContent = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5); };
  map.on('move', update); update();
  map.on('popupopen', () => box.classList.add('under'));
  map.on('popupclose', () => box.classList.remove('under'));

  const listeners = new Set();
  let btn = null;
  const paint = () => {
    box.hidden = !on;
    if (!btn) return;
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = 'Crosshair at the map centre: ' + (on ? 'on' : 'off') + ' (click to switch)';
  };
  function set(value) { on = value; savePrefs({ crosshair: value ? null : false }); paint(); for (const fn of listeners) fn(); }
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'cross-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'crosshair'; a.setAttribute('aria-label', 'Show a crosshair at the centre of the map');
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); set(!on); });
      btn = a;
      return bar;
    },
  });
  new Control().addTo(map);
  paint();
  return { get on() { return on; }, set, toggle: () => set(!on), onChange: (fn) => listeners.add(fn) };
}
