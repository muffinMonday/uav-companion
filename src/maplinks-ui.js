// The "open in Google Maps / Amap" buttons: for one place (marker windows, point-check windows) and for a route through several markers.
// Links come from maplinks.js. Opening one shares those coordinates with the map app, but only when the visitor taps it.
import { APP_LABEL, MODES, appsFor, placeUrl, hereUrl, routeUrls } from './maplinks.js';
import { inChina } from './coords.js';

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
 * The block of buttons for one place. `home`: this is the Home marker (the traveller's residence), so each button asks before opening.
 * Inside China Amap comes first, then Google Maps; elsewhere Google Maps only.
 */
export function mapLinksBlock({ lat, lon, name = '', home = false }) {
  const apps = appsFor([{ lat, lon }]);
  const box = el('div', 'maplinks');
  const place = { lat, lon, name };

  const show = el('div', 'maplinks-row');
  show.append(el('span', 'maplinks-label', 'Open in'));
  for (const app of apps) show.append(linkButton({ label: APP_LABEL[app], url: placeUrl(app, place), confirm: home }));
  box.append(show);

  const dir = el('div', 'maplinks-row');
  dir.append(el('span', 'maplinks-label', 'Directions here'));
  const sel = el('select', 'maplinks-mode'); sel.setAttribute('aria-label', 'Travel mode');
  for (const m of MODES) { const o = el('option', '', m.label); o.value = m.id; sel.append(o); }
  dir.append(sel);
  const dirButtons = el('span', 'maplinks-btns');
  const paint = () => {
    dirButtons.replaceChildren(...apps.map((app) => linkButton({ label: APP_LABEL[app], url: hereUrl(app, place, sel.value), confirm: home })));
  };
  sel.addEventListener('change', paint);
  paint();
  dir.append(dirButtons);
  box.append(dir);

  box.append(el('small', 'maplinks-note', home
    ? 'This is your Home location: each button asks before it shares it. Directions start from where you are.'
    : 'Opens in a new tab and shares this location with the map app. Directions start from where you are.'));
  return box;
}

/**
 * The route buttons for the markers ticked in the list, in order: { stops: [{ lat, lon, name }], mode, home }.
 * Returns the elements to show: one group per app (Amap only when every stop is in China), each with its links and a note.
 */
export function routeLinks({ stops, mode, home = false }) {
  const out = [];
  for (const app of appsFor(stops)) {
    const { parts, note } = routeUrls(app, stops, mode, { mobile: isMobileBrowser() });
    const group = el('div', 'route-group');
    const row = el('div', 'btn-row');
    for (const p of parts) row.append(linkButton({ label: p.label, url: p.url, confirm: home }));
    group.append(row);
    if (note) group.append(el('small', 'route-note', note));
    out.push(group);
  }
  if (appsFor(stops).length === 1 && stops.some((s) => inChina(s.lat, s.lon)) && stops.some((s) => !inChina(s.lat, s.lon))) {
    out.push(el('small', 'route-note', 'Amap is offered when every stop is in China; this route has stops elsewhere, so only Google Maps is shown.'));
  }
  return out;
}
