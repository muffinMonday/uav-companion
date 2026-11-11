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
};
/** A round icon for one map link. The label is its name and, with the sentence about sharing, its tooltip. */
function iconLink({ icon, label, url, confirm }) {
  const tip = label + '. Opens in a new tab and shares this location with the map app.';
  const svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[icon] + '"/></svg>'; // built from constants only
  if (!confirm) {
    const a = el('a', 'btn tool maplink');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = tip;
    a.innerHTML = svg;
    a.append(el('span', 'tool-label', label));
    return a;
  }
  // the Home marker: the first tap turns the icon into "Tap again to share" for five seconds, the second opens the app
  const b = el('button', 'btn tool maplink');
  b.type = 'button'; b.title = label + '. Asks before it shares your Home location.'; b.dataset.url = url;
  b.innerHTML = svg;
  const text = el('span', 'tool-label', label);
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

/**
 * The two icons for one place, to sit beside its coordinates: Open in <app> and Navigate in <app>. `home`: the Home marker (the traveller's
 * residence), whose icons ask before sharing. The app comes from the Maps settings (automatic: Amap in China, Google Maps elsewhere) and
 * Navigate uses the usual way of travelling from the same settings.
 */
export function mapLinkIcons({ lat, lon, name = '', home = false }) {
  const prefs = loadPrefs();
  const app = resolveApp([{ lat, lon }], prefs.mapApp);
  const place = { lat, lon, name };
  const box = el('span', 'maplinks maplinks-row map-icons');
  box.append(
    iconLink({ icon: 'open', label: `Open in ${APP_LABEL[app]}`, url: placeUrl(app, place), confirm: home }),
    iconLink({ icon: 'go', label: `Navigate in ${APP_LABEL[app]}`, url: hereUrl(app, place, prefs.mapMode ?? MODES[0].id), confirm: home }),
  );
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
