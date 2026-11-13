// The map layer for the party's live positions: a coloured pin with the person's initial and a label with their name and how long ago, a faint circle for the
// accuracy, dimmed when the position is a little old. See live.js for where the positions come from.
// A person whose progression the database lets us see gets a ring in their rank's colour and a small tier badge (the pin keeps its size); selecting the pin
// shows their name, rank, exact XP and progress. Without a rank (hidden, or not loaded yet) the pin is as before and does nothing when clicked.
// Friends (o.relation === 'friend') are told apart from party members by shape (a rounded square, not a circle), a dashed accuracy circle and the word
// "Friend" in the label, so colour is never the only signal. A friend who is also in the party is sent by the server as party only.
import L from 'leaflet';
import { progressionMini } from './progression-ui.js';

const PALETTE = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#3949ab', '#c0ca33'];
const colorOf = (id) => PALETTE[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const ageText = (s) => (s < 10 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);
const STALE_S = 45; // a position older than this is drawn dimmed

export function createLiveLayer(map) {
  const group = L.layerGroup().addTo(map);
  const pins = new Map(); // key -> { marker, circle, o, tier }; the key is the member id, with "f:" in front for a friend
  let ranks = new Map();  // member id -> cleaned brief progression (progression.js)
  const rankOf = (id) => { const r = ranks.get(id); return r?.visible ? r : null; };
  const keyOf = (o) => (o.relation === 'friend' ? 'f:' : '') + o.member_id;
  const isFriend = (o) => o.relation === 'friend';

  function icon(o) {
    const rank = rankOf(o.member_id);
    const root = document.createElement('div');
    root.className = 'live-pin' + (o.age_seconds > STALE_S ? ' stale' : '') + (rank ? ' ranked' : '') + (isFriend(o) ? ' friend' : '');
    root.style.setProperty('--c', colorOf(o.member_id));
    const av = document.createElement('div'); av.className = 'live-av';
    const dot = document.createElement('b'); dot.textContent = ([...o.display_name][0] ?? '?').toUpperCase();
    av.append(dot);
    if (rank) {
      root.dataset.tier = String(rank.tier);
      root.style.setProperty('--rank', `var(--rank-${Math.min(10, Math.max(1, rank.tier))})`);
      const badge = document.createElement('i'); badge.className = 'live-rank'; badge.textContent = String(rank.tier); badge.title = rank.rankName;
      av.append(badge);
    }
    const name = document.createElement('span'); name.textContent = `${isFriend(o) ? 'Friend · ' : ''}${o.display_name} · ${ageText(o.age_seconds)}`;
    root.append(av, name);
    return L.divIcon({ className: 'live-pin-wrap', html: root, iconSize: [0, 0] });
  }

  /** Opens the small rank card above a pin, if we know the person's rank. */
  function select(key) {
    const p = pins.get(key), r = rankOf(p?.o.member_id);
    if (!p || !r) return;
    L.popup({ className: 'live-pop', offset: [0, -22], closeButton: true, autoPan: true, maxWidth: 260 }).setLatLng(p.marker.getLatLng()).setContent(progressionMini(r, p.o.display_name)).openOn(map);
  }

  return {
    /** Gives the layer the ranks of the people on the map (a Map of member id to cleaned brief progression); pins whose rank changed are redrawn. */
    setRanks(next) {
      ranks = next instanceof Map ? next : new Map();
      for (const p of pins.values()) { const t = rankOf(p.o.member_id)?.tier ?? 0; if (t !== p.tier) { p.tier = t; p.marker.setIcon(icon(p.o)); } }
    },
    /** Draws the positions (from list_live_locations and list_friend_live_locations); trips in `hiddenTrips` are not drawn, nor friends when it holds 'friends'. */
    update(others, hiddenTrips = new Set()) {
      const keep = new Set();
      for (const o of others) {
        if (hiddenTrips.has(isFriend(o) ? 'friends' : o.trip_id)) continue;
        const key = keyOf(o);
        keep.add(key);
        const ll = [o.lat, o.lon];
        const show = o.accuracy && o.accuracy <= 300;
        let p = pins.get(key);
        if (!p) {
          p = { marker: L.marker(ll, { icon: icon(o), zIndexOffset: 900, keyboard: false }).addTo(group), circle: null, o, tier: rankOf(o.member_id)?.tier ?? 0 };
          p.marker.on('click', () => select(key));
          pins.set(key, p);
        } else { p.o = o; p.tier = rankOf(o.member_id)?.tier ?? 0; p.marker.setLatLng(ll); p.marker.setIcon(icon(o)); }
        if (show) {
          if (!p.circle) p.circle = L.circle(ll, { radius: o.accuracy, color: colorOf(o.member_id), weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false, ...(isFriend(o) ? { dashArray: '4 4' } : {}) }).addTo(group);
          else { p.circle.setLatLng(ll); p.circle.setRadius(o.accuracy); }
        } else if (p.circle) { group.removeLayer(p.circle); p.circle = null; }
      }
      for (const [id, p] of [...pins]) if (!keep.has(id)) { group.removeLayer(p.marker); if (p.circle) group.removeLayer(p.circle); pins.delete(id); }
    },
    /** Centres the map on a member's pin (at least zoom 15). Returns false if they are not on the map. */
    focus(memberId) {
      const p = pins.get(memberId) ?? pins.get('f:' + memberId);
      if (!p) return false;
      map.flyTo(p.marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
      return true;
    },
    count: () => pins.size,
    clear() { group.clearLayers(); pins.clear(); },
  };
}
