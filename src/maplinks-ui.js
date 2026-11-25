// The map-app controls: one Navigate action for a place (marker windows, point-check windows, session cards) and the route buttons for several markers.
// Links come from maplinks.js. Opening one shares those coordinates with the map app, but only when the visitor taps it.
import { APP_LABEL, MODES, appsFor, resolveApp, hereUrl, routeUrls, amapLaunch } from './maplinks.js';
import { inChina } from './coords.js';
import { loadPrefs } from './prefs.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
export const mapPlatform = (nav = navigator) => /Android/i.test(nav.userAgent) ? 'android'
  : /iPhone|iPad|iPod/i.test(nav.userAgent) || (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1) ? 'ios' : 'desktop';

let cancelLaunch = () => {};
/** Call synchronously from a tap so Chrome keeps the user gesture for app launching. */
export function openMapUrl(url) {
  cancelLaunch();
  const platform = mapPlatform(), launch = amapLaunch(url, platform);
  if (!launch) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
  if (platform === 'android') { window.location.assign(launch.url); return; } // Chrome owns the intent fallback
  // iOS has no intent fallback. Cancel permanently when the app takes over, including when the user returns later.
  let timer;
  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', cleanup);
    cancelLaunch = () => {};
  };
  const hidden = () => { if (document.hidden) cleanup(); };
  cancelLaunch = cleanup;
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', cleanup);
  timer = window.setTimeout(() => {
    const visible = !document.hidden;
    cleanup();
    if (visible) window.location.assign(launch.fallbackUrl);
  }, 1800);
  try { window.location.assign(launch.url); } catch { cleanup(); window.location.assign(launch.fallbackUrl); }
}

// Keep HTTPS hrefs for copying, context menus and modified clicks. Ordinary mobile taps try the app in this tab.
function appFirst(a, url) {
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !amapLaunch(url, mapPlatform())) return;
    e.preventDefault(); openMapUrl(url);
  });
  return a;
}
/** A phone or tablet: Google Maps takes fewer stops in a mobile browser. */
export const isMobileBrowser = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * One link or button. A normal link is a real <a> with a copyable HTTPS URL; mobile taps try Amap first. With `confirm` (the Home marker's
 * location) it is a button that asks first: the first tap changes its text, the second opens the app.
 */
export function linkButton({ label, url, confirm = false }) {
  if (!confirm) {
    const a = el('a', 'btn small maplink', label);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return appFirst(a, url);
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
    openMapUrl(url);
  });
  b.dataset.url = url;
  return b;
}

const ICONS = {
  go: 'M4 12l16-8-8 16-2-6-6-2z', // Navigate: a square 24x24 drawing, shown 16 px square (width, height and CSS agree, and it never shrinks: .map-action svg)
};
const iconSvg = (icon) => '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="' + ICONS[icon] + '"/></svg>'; // built from constants only

/**
 * One outlined icon + visible text control (`.map-action`, styles.css), shared by marker windows, point-check windows and session cards.
 * It is a real external <a> (mobile Amap app first, otherwise a new tab; shares the location only when tapped). With `confirm` (the Home marker's location) it is a button
 * that asks first: the first tap changes its text, the second opens the app. `title` is the full accessible name ("Navigate to X in Google Maps").
 */
function actionControl({ icon, label, url, confirm = false, title }) {
  const tip = (title || label) + '. Opens the map app or browser and shares this location with the map app when tapped.';
  if (!confirm) {
    const a = el('a', 'btn map-action maplink');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = tip; a.setAttribute('aria-label', title || label);
    a.innerHTML = iconSvg(icon);
    a.append(el('span', 'map-action-label', label));
    return appFirst(a, url);
  }
  // the Home marker: the first tap turns the text into "Tap again to share" for five seconds, the second opens the app
  const b = el('button', 'btn map-action maplink');
  b.type = 'button'; b.title = (title || label) + '. Asks before it shares your Home location.'; b.setAttribute('aria-label', title || label); b.dataset.url = url;
  b.innerHTML = iconSvg(icon);
  const text = el('span', 'map-action-label', label);
  b.append(text);
  let armed = null;
  b.addEventListener('click', () => {
    if (!armed) {
      text.textContent = 'Tap again to share'; b.removeAttribute('aria-label'); b.classList.add('armed', 'share');
      armed = setTimeout(() => { text.textContent = label; b.setAttribute('aria-label', title || label); b.classList.remove('armed', 'share'); armed = null; }, 5000);
      return;
    }
    clearTimeout(armed); armed = null; text.textContent = label; b.setAttribute('aria-label', title || label); b.classList.remove('armed', 'share');
    openMapUrl(url);
  });
  return b;
}

/** True for a usable WGS84 point. */
export const hasPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * The one outlined control for a place, in marker windows and point-check windows: Navigate (external). The map app comes from the Maps settings (automatic: Amap in
 * China, Google Maps elsewhere) and it uses the usual way of travelling from the same settings. `home`: the Home marker (the traveller's residence), which asks
 * before sharing. Seeing the place on UAV Companion's own map is what selecting its pin already does.
 */
export function mapLinkIcons({ lat, lon, name = '', home = false }) {
  const prefs = loadPrefs();
  const app = resolveApp([{ lat, lon }], prefs.mapApp);
  const place = { lat, lon, name };
  const box = el('span', 'maplinks maplinks-row map-icons map-actions');
  box.append(actionControl({ icon: 'go', label: 'Navigate', title: `Navigate to ${name || 'this place'} in ${APP_LABEL[app]}`, url: hereUrl(app, place, prefs.mapMode ?? MODES[0].id), confirm: home }));
  return box;
}

/**
 * The control of a session card: an external Navigate link, or a short explanation when the session has no usable meeting point. Clicks on it never reach the
 * card's own selection. Choosing the card itself is the card's job (the hub opens the map explorer on it; the explorer selects and centres it).
 */
export function sessionMapActions({ lat, lng, title }) {
  const box = el('span', 'map-actions ses-map-actions');
  if (!hasPoint(lat, lng)) { box.append(el('small', 'hint ses-nopoint', 'No meeting point set')); return box; }
  const prefs = loadPrefs(), app = resolveApp([{ lat, lon: lng }], prefs.mapApp);
  const n = actionControl({ icon: 'go', label: 'Navigate', title: `Navigate to ${title} in ${APP_LABEL[app]}`, url: hereUrl(app, { lat, lon: lng, name: title }, prefs.mapMode ?? MODES[0].id) });
  n.dataset.act = 'navigate';
  n.addEventListener('click', (e) => e.stopPropagation());
  box.append(n);
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
