import L from 'leaflet';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>';

/**
 * "My location" control. The first press asks for permission, drops a pin and starts following the position;
 * later presses re-centre on the latest fix. Nothing is requested until the user presses the button.
 */
export function addLocateControl(map, { onFix, onError }) {
  let dot = null, ring = null, last = null, active = false;

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'locate-btn', bar);
      a.href = '#';
      a.role = 'button';
      a.title = 'Show my location / re-centre';
      a.setAttribute('aria-label', 'Show my location and re-centre the map');
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); press(); });
      this._a = a;
      return bar;
    },
  });
  const control = new Control().addTo(map);

  /** Returns false if location cannot be used at all (the user has been told why). */
  function press({ recentre = true } = {}) {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      onError('Location needs a secure page (https). It will not work from a file or plain http.');
      return false;
    }
    if (last) { if (recentre) map.setView(last, Math.max(map.getZoom(), 15)); return true; }
    if (!navigator.geolocation) { onError('This browser does not support location.'); return false; }
    map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 10000, timeout: 20000 });
    return true;
  }

  /** Resolves with the latest position, starting location tracking first if needed. Rejects if it cannot be had. */
  function request() {
    return new Promise((resolve, reject) => {
      if (last) { resolve(last); return; }
      const done = () => { map.off('locationfound', ok); map.off('locationerror', fail); };
      const ok = (e) => { done(); resolve(e.latlng); };
      const fail = () => { done(); reject(new Error('location unavailable')); };
      map.on('locationfound', ok);
      map.on('locationerror', fail);
      if (!press({ recentre: false })) { done(); reject(new Error('location unavailable')); }
    });
  }

  map.on('locationfound', (e) => {
    const first = !last;
    last = e.latlng;
    if (!dot) {
      ring = L.circle(e.latlng, { radius: e.accuracy, weight: 1, color: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
      dot = L.marker(e.latlng, {
        icon: L.divIcon({ className: '', html: '<div class="you-dot" style="width:14px;height:14px"></div>', iconSize: [14, 14] }),
        zIndexOffset: 1000, title: 'You are here',
      }).addTo(map);
      active = true;
      control._a.classList.add('active');
    } else {
      dot.setLatLng(e.latlng);
      ring.setLatLng(e.latlng).setRadius(e.accuracy);
    }
    if (first) map.setView(e.latlng, Math.max(map.getZoom(), 15));
    onFix?.(dot, e);
  });

  map.on('locationerror', (e) => {
    if (active && last) return; // keep the last fix on a transient error
    map.stopLocate();
    const denied = e.code === 1;
    onError(denied ? 'Location permission was denied. Allow it in the browser settings and try again.' : 'Could not get your location. Check that location services are on.');
  });

  return { control, request };
}
