// The map layer for the party's live positions: a coloured pin with the person's initial and a label with their name and how long ago, a faint circle for the
// accuracy, dimmed when the position is a little old. See live.js for where the positions come from.
import L from 'leaflet';

const PALETTE = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#3949ab', '#c0ca33'];
const colorOf = (id) => PALETTE[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const ageText = (s) => (s < 10 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);
const STALE_S = 45; // a position older than this is drawn dimmed

export function createLiveLayer(map) {
  const group = L.layerGroup().addTo(map);
  const pins = new Map(); // member id -> { marker, circle }

  function icon(o) {
    const root = document.createElement('div');
    root.className = 'live-pin' + (o.age_seconds > STALE_S ? ' stale' : '');
    root.style.setProperty('--c', colorOf(o.member_id));
    const dot = document.createElement('b'); dot.textContent = ([...o.display_name][0] ?? '?').toUpperCase();
    const name = document.createElement('span'); name.textContent = `${o.display_name} · ${ageText(o.age_seconds)}`;
    root.append(dot, name);
    return L.divIcon({ className: 'live-pin-wrap', html: root, iconSize: [0, 0] });
  }

  return {
    /** Draws the positions (from list_live_locations); trips in `hiddenTrips` are not drawn. */
    update(others, hiddenTrips = new Set()) {
      const keep = new Set();
      for (const o of others) {
        if (hiddenTrips.has(o.trip_id)) continue;
        keep.add(o.member_id);
        const ll = [o.lat, o.lon];
        const show = o.accuracy && o.accuracy <= 300;
        let p = pins.get(o.member_id);
        if (!p) {
          p = { marker: L.marker(ll, { icon: icon(o), zIndexOffset: 900, keyboard: false, interactive: false }).addTo(group), circle: null };
          pins.set(o.member_id, p);
        } else { p.marker.setLatLng(ll); p.marker.setIcon(icon(o)); }
        if (show) {
          if (!p.circle) p.circle = L.circle(ll, { radius: o.accuracy, color: colorOf(o.member_id), weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false }).addTo(group);
          else { p.circle.setLatLng(ll); p.circle.setRadius(o.accuracy); }
        } else if (p.circle) { group.removeLayer(p.circle); p.circle = null; }
      }
      for (const [id, p] of [...pins]) if (!keep.has(id)) { group.removeLayer(p.marker); if (p.circle) group.removeLayer(p.circle); pins.delete(id); }
    },
    /** Centres the map on a member's pin (at least zoom 15). Returns false if they are not on the map. */
    focus(memberId) {
      const p = pins.get(memberId);
      if (!p) return false;
      map.flyTo(p.marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
      return true;
    },
    count: () => pins.size,
    clear() { group.clearLayers(); pins.clear(); },
  };
}
