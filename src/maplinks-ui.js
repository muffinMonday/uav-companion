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

/**
 * The two buttons for one place: Open in <app> and Navigate in <app>. `home`: this is the Home marker (the traveller's residence),
 * so each button asks before opening. The app comes from the Maps settings (automatic: Amap in China, Google Maps elsewhere) and
 * Navigate uses the usual way of travelling from the same settings.
 */
export function mapLinksBlock({ lat, lon, name = '', home = false }) {
  const prefs = loadPrefs();
  const app = resolveApp([{ lat, lon }], prefs.mapApp);
  const place = { lat, lon, name };
  const box = el('div', 'maplinks');
  const row = el('div', 'maplinks-row');
  row.append(
    linkButton({ label: `Open in ${APP_LABEL[app]}`, url: placeUrl(app, place), confirm: home }),
    linkButton({ label: `Navigate in ${APP_LABEL[app]}`, url: hereUrl(app, place, prefs.mapMode ?? MODES[0].id), confirm: home }),
  );
  box.append(row);
  const note = home
    ? 'This is your Home location: each button asks before it shares it.'
    : 'Opens in a new tab and shares this location with the map app. Navigation starts from where you are.';
  box.append(el('small', 'maplinks-note', note));
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
