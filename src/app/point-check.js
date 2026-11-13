import L from 'leaflet';
import { checkPoint, describeCheck } from '../pointcheck.js';
import { weatherButton } from '../weather.js';
import { mapLinkIcons } from '../maplinks-ui.js';
import { toolBar, tile, statsGrid } from '../cards.js';
import { onPopupSwipe } from '../swipe.js';
import { centreOn, popupMaxHeight } from '../view.js';
import { getPrivacy } from '../privacy.js';
import { lookupElevation } from '../elevation.js';

/**
 * The point-check popup shared by map clicks, searches, flying-area pins and the location button.
 * `addAt(latlng, label, opts)` saves a spot as a marker; it is called late, so the POI module may be created after this one.
 * Returns { showCheck, showWeather }.
 */
export function createPointCheckUI({ map, panel, weather, addAt }) {
  function showWeather(lat, lon, label) {
    panel.closeIfPhone(); // the bottom sheet would sit on top of the forecast card
    weather.show(lat, lon, label);
  }
  /** Adds what the privacy settings allow to a point-check popup: ground elevation, and the weather button. */
  function decorate(content, latlng, label, onResize, extras = {}) {
    if (getPrivacy().fetchAltitude) {
      const t = tile('elev', 'Elevation', '…');
      const box = document.createElement('div');
      box.className = 'stats-wrap';
      box.append(statsGrid([t]));
      content.insertBefore(box, content.querySelector('.disclaimer'));
      const set = (text) => { t.querySelector('.v').textContent = text; onResize?.(); };
      lookupElevation(latlng.lat, latlng.lng).then((m) => set(m === null ? '–' : `${Math.round(m)} m`)).catch(() => set('–'));
    }
    content.append(weatherButton(() => { map.closePopup(); showWeather(latlng.lat, latlng.lng, label); }));
    // the map-app icons sit right after the title (or, with no title, a line of coordinates)
    let sub = content.querySelector('.pop-sub');
    if (!sub) { sub = document.createElement('div'); sub.className = 'pop-sub'; sub.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`; content.querySelector('.pop-bar')?.after(sub); }
    sub.classList.add('has-icons');
    sub.append(mapLinkIcons({ lat: latlng.lat, lon: latlng.lng, name: label }));
    if (extras.official) { // the region's own authoritative map (Singapore: OneMap), in a new tab
      const a = document.createElement('a');
      a.className = 'btn small maplink official-link'; a.href = extras.official.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = extras.official.label;
      content.append(a);
    }
    // save the spot as a marker (a searched spot also has a pin that can be removed): icons in the bar at the top
    const tools = [{ icon: 'pin', label: 'Add as marker', onClick: () => setTimeout(() => { map.closePopup(); extras.onAdded?.(); addAt(latlng, label); }, 0) },
      { icon: 'flag', label: 'Add as Side Quest', onClick: () => setTimeout(() => { map.closePopup(); extras.onAdded?.(); addAt(latlng, label, { sub: true }); }, 0) }];
    if (extras.onRemovePin) tools.push({ icon: 'unpin', label: 'Remove pin', onClick: () => setTimeout(() => { map.closePopup(); extras.onRemovePin(); }, 0) });
    content.prepend(toolBar({ caption: 'Point check', tools }));
    return content;
  }

  // Point check popup shared by map clicks and the location pin
  // opts: offsetY (how far above the spot the window starts: a pin is in the way), zoom (to zoom to), onRemovePin, onAdded
  async function showCheck(latlng, title, opts = {}) {
    const offsetY = opts.offsetY ?? 0;
    centreOn(map, latlng, { zoom: opts.zoom }); // the spot is centred at once, before the check has read its tile
    const res = await checkPoint(latlng.lat, latlng.lng);
    // a window too tall to fit above the spot scrolls inside instead of pushing the map around
    const popup = L.popup({ maxWidth: Math.min(320, window.innerWidth - 32), minWidth: Math.min(250, window.innerWidth - 40), offset: [0, offsetY], autoPan: false, closeOnClick: false, maxHeight: popupMaxHeight(map, offsetY) }).setLatLng(latlng);
    const content = decorate(describeCheck(res, title, opts.note), latlng, title, () => popup.update(), { ...opts, official: res.region?.officialMap });
    popup.setContent(content).openOn(map);
    // swipe left or right anywhere, or up or down from the top bar or the bottom row (the weather button or the official map link)
    onPopupSwipe(content, { close: () => popup.close(), borders: (t, root) => !!t.closest('.pop-bar') || !!root.lastElementChild?.contains(t) });
  }

  return { showCheck, showWeather };
}
