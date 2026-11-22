// Explicit map inspection (Review 01 MAP-05): a deliberate, visible alternative to the existing two-second long-press point check
// (holdcheck.js), which stays exactly as it is. Pressing this button arms a one-shot "Inspect here" mode; the next ordinary tap on the
// map runs the same point-check callback the hold does (passed in as onCheck - no point-check logic is duplicated), then disarms.
// Escape, the button itself, or the banner's Cancel disarm it without side effects. Guarded by isBusy() throughout so it never fires
// while a marker is being placed or edited, and never interferes with ordinary panning (a drag never raises Leaflet's own 'click').
import L from 'leaflet';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M14.7 14.7 20 20"/><path d="M10 7v6M7 10h6"/></svg>';

/**
 * @param {object} o
 * @param {L.Map} o.map
 * @param {() => boolean} o.isBusy      true while placing or editing a marker: Inspect neither arms nor fires then
 * @param {(latlng) => void} o.onCheck  the same point-check callback holdcheck.js's onCheck uses
 * @returns {{ armed: boolean, cancel: () => void }}
 */
export function initInspect({ map, isBusy, onCheck }) {
  const container = map.getContainer();
  let armed = false, btn = null;

  const banner = document.createElement('div');
  banner.className = 'banner'; banner.id = 'inspect-banner'; banner.hidden = true;
  const text = document.createElement('span'); text.textContent = 'Tap the map to inspect that spot.';
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => set(false));
  banner.append(text, cancelBtn);
  document.body.append(banner);

  function paint() {
    container.classList.toggle('inspecting', armed);
    banner.hidden = !armed;
    if (!btn) return;
    btn.classList.toggle('armed', armed);
    btn.setAttribute('aria-pressed', String(armed));
    btn.title = armed ? 'Inspect: tap the map, or press Escape to cancel' : 'Inspect a spot on the map';
  }

  function set(value) {
    if (value === armed) return;
    if (value && isBusy()) return; // never arms while placing or editing a marker
    armed = value;
    paint();
  }

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'inspect-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'inspect';
      a.setAttribute('aria-label', 'Inspect a spot on the map'); a.setAttribute('aria-pressed', 'false');
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); set(!armed); });
      btn = a;
      return bar;
    },
  });
  new Control().addTo(map);
  paint();

  // The next ordinary tap while armed performs the check and disarms - a one-shot "Inspect here", not a standing mode. A drag/pan
  // never reaches this: Leaflet only raises 'click' for a press-and-release with no meaningful movement, same as everywhere else in the app.
  map.on('click', (e) => {
    if (!armed || isBusy()) return;
    set(false);
    onCheck(e.latlng.wrap());
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) set(false); });

  return { get armed() { return armed; }, cancel: () => set(false) };
}
