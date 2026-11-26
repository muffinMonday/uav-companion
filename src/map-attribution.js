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

  // Tile providers require visible on-map credit (not just an entry in a tools menu).
  // Keep only the basemap credit here; Leaflet's full, live list stays in the disclosure.
  const BaseCredit = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const line = L.DomUtil.create('div', 'map-base-attribution');
      L.DomEvent.disableClickPropagation(line);
      this.update = () => {
        const active = new Set();
        map.eachLayer((layer) => {
          if (layer.options?.className === 'base-tiles' && layer.getAttribution()) active.add(layer.getAttribution());
        });
        line.innerHTML = [...active].join(' | ');
        line.hidden = !active.size;
      };
      map.on('layeradd layerremove', this.update);
      this.update();
      return line;
    },
    onRemove() { map.off('layeradd layerremove', this.update); },
  });
  new BaseCredit().addTo(map);
}
