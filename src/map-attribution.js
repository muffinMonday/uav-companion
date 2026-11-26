import L from 'leaflet';

/** Keep Leaflet's live layer credits intact, behind an always-available map control. */
export function initMapAttribution(map) {
  const credits = map.attributionControl.getContainer();
  const events = new AbortController();
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const details = L.DomUtil.create('details', 'map-attribution');
      const summary = L.DomUtil.create('summary', '', details);
      summary.textContent = 'ⓘ';
      summary.title = 'Map credits';
      summary.setAttribute('aria-label', 'Map credits');
      // Move the original node: Leaflet still updates it as layers and basemaps change.
      details.append(credits);
      L.DomEvent.disableClickPropagation(details);
      L.DomEvent.disableScrollPropagation(details);
      details.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && details.open) {
          e.stopPropagation(); details.open = false; summary.focus();
        }
      });
      document.addEventListener('pointerdown', (e) => {
        if (!details.contains(e.target)) details.open = false;
      }, { signal: events.signal });
      return details;
    },
    onRemove() { events.abort(); },
  });
  new Control().addTo(map);
}
