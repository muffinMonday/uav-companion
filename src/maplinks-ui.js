// The "open in Google Maps / Amap" buttons: for one place (marker windows, point-check windows) and for a route through several markers.
// Links come from maplinks.js. Opening one shares those coordinates with the map app, but only when the visitor taps it.
import { APP_LABEL, MODES, appsFor, resolveApp, placeUrl, hereUrl, routeUrls } from './maplinks.js';
import { inChina } from './coords.js';
import { loadPrefs } from './prefs.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const open = (url) => window.open(url, '_blank', 'noopener,noreferrer');
/** A phone or tablet: Google Maps takes fewer stops in a mobile browser. */
export const isMobileBrowser = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * One link or button. A normal link is a real <a>, so it opens in a new tab and can be copied. With `confirm` (the Home marker's
 * location) it is a button that asks first: the first tap changes its text, the second opens the app.
 */
export function linkButton({ label, url, confirm = false }) {
  if (!confirm) {
    const a = el('a', 'btn small maplink', label);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  const b = el('button', 'btn small maplink', label);
  b.type = 'button';
  let armed = null;
  b.addEventListener('click', () => {
    if (!armed) {
      b.textContent = 'Share Home location? Tap again';
      armed = setTimeout(() => { b.textContent = label; armed = null; }, 5000);
      return;
    }
    clearTimeout(armed); armed = null; b.textContent = label;
    open(url);
  });
  b.dataset.url = url;
  return b;
}

const ICONS = {
  open: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  go: 'M4 12l16-8-8 16-2-6-6-2z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
};
const iconSvg = (icon) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[icon] + '"/></svg>'; // built from constants only

/**
 * One outlined icon + visible text control (`.map-action`, styles.css), shared by marker windows, point-check windows and session cards.
 * With `url` it is a real external <a> (new tab; it shares the location with the map app only when tapped). With `confirm` (the Home marker's
 * location) it is a button that asks first: the first tap changes its text, the second opens the app. With `onClick` it is an internal <button>
 * (deliberately not a `.maplink`: it opens nothing outside the app).
 */
function actionControl({ icon, label, url, confirm = false, onClick, title }) {
  if (onClick) {
    const b = el('button', 'btn map-action');
    b.type = 'button'; if (title) b.title = title;
    b.innerHTML = iconSvg(icon);
    b.append(el('span', 'map-action-label', label));
    b.addEventListener('click', onClick);
    return b;
  }
  if (!confirm) {
    const a = el('a', 'btn map-action maplink');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = label + '. Opens in a new tab and shares this location with the map app.';
    a.innerHTML = iconSvg(icon);
    a.append(el('span', 'map-action-label', label));
    return a;
  }
  // the Home marker: the first tap turns the text into "Tap again to share" for five seconds, the second opens the app
  const b = el('button', 'btn map-action maplink');
  b.type = 'button'; b.title = label + '. Asks before it shares your Home location.'; b.dataset.url = url;
  b.innerHTML = iconSvg(icon);
  const text = el('span', 'map-action-label', label);
  b.append(text);
  let armed = null;
  b.addEventListener('click', () => {
    if (!armed) {
      text.textContent = 'Tap again to share'; b.classList.add('armed', 'share');
      armed = setTimeout(() => { text.textContent = label; b.classList.remove('armed', 'share'); armed = null; }, 5000);
      return;
    }
    clearTimeout(armed); armed = null; text.textContent = label; b.classList.remove('armed', 'share');
    open(url);
  });
  return b;
}

/** True for a usable WGS84 point. */
export const hasPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * The two outlined controls for one place, in marker windows and point-check windows: Open in <app> and Navigate in <app>, both external.
 * `home`: the Home marker (the traveller's residence), whose controls ask before sharing. The app comes from the Maps settings (automatic: Amap in
 * China, Google Maps elsewhere) and Navigate uses the usual way of travelling from the same settings.
 */
export function mapLinkIcons({ lat, lon, name = '', home = false }) {
  const prefs = loadPrefs();
  const app = resolveApp([{ lat, lon }], prefs.mapApp);
  const place = { lat, lon, name };
  const box = el('span', 'maplinks maplinks-row map-icons map-actions');
  box.append(
    actionControl({ icon: 'open', label: `Open in ${APP_LABEL[app]}`, url: placeUrl(app, place), confirm: home }),
    actionControl({ icon: 'go', label: `Navigate in ${APP_LABEL[app]}`, url: hereUrl(app, place, prefs.mapMode ?? MODES[0].id), confirm: home }),
  );
  return box;
}

/**
 * The controls of a session card: an internal Map button (focuses UAV Companion's own map) and an external Navigate link, or a short explanation
 * when the session has no usable meeting point. Clicks on them never reach the card's own selection.
 */
export function sessionMapActions({ lat, lng, title, onMap }) {
  const box = el('span', 'map-actions ses-map-actions');
  if (!hasPoint(lat, lng)) { box.append(el('small', 'hint ses-nopoint', 'No meeting point set')); return box; }
  const m = actionControl({ icon: 'map', label: 'Map', title: `Show ${title} on the map`, onClick: (e) => { e.stopPropagation(); onMap(); } });
  m.dataset.act = 'map';
  const prefs = loadPrefs(), app = resolveApp([{ lat, lon: lng }], prefs.mapApp);
  const n = actionControl({ icon: 'go', label: 'Navigate', url: hereUrl(app, { lat, lon: lng, name: title }, prefs.mapMode ?? MODES[0].id) });
  n.title = `Navigate to ${title} in ${APP_LABEL[app]}. Opens in a new tab and shares this location with the map app.`; n.dataset.act = 'navigate';
  n.addEventListener('click', (e) => e.stopPropagation());
  box.append(m, n);
  return box;
}

/**
 * The route buttons for the markers ticked in the list, in order: { stops: [{ lat, lon, name }], mode, home }.
 * Returns the elements to show: the links for the chosen app (see the Maps settings) and a note when it has to split the route.
 */
export function routeLinks({ stops, mode, home = false }) {
  const out = [];
  const app = resolveApp(stops, loadPrefs().mapApp);
  const { parts, note } = routeUrls(app, stops, mode, { mobile: isMobileBrowser() });
  const group = el('div', 'route-group');
  const row = el('div', 'btn-row');
  for (const p of parts) row.append(linkButton({ label: p.label, url: p.url, confirm: home }));
  group.append(row);
  if (note) group.append(el('small', 'route-note', note));
  out.push(group);
  if (appsFor(stops).length === 1 && stops.some((s) => inChina(s.lat, s.lon)) && stops.some((s) => !inChina(s.lat, s.lon))) {
    out.push(el('small', 'route-note', 'Amap is used when every stop is in China; this route has stops elsewhere, so Google Maps is used.'));
  }
  return out;
}
