// Colour theme: System (follows the device), Light or Dark. The choice is kept in the prefs ('theme', 'themeAt').
// The resolved value ('light' | 'dark') is always written to <html data-theme>, which styles.css reads.
// index.html runs a few lines of the same logic before first paint (tests/theme-unit.mjs keeps the two in step).
import { loadPrefs, savePrefs } from './prefs.js';

export const THEMES = ['system', 'light', 'dark'];
const QUERY = '(prefers-color-scheme: dark)';
const META_COLOR = { light: '#ffffff', dark: '#18222c' }; // the --bg of each theme: the browser bar on a phone

/** What is drawn: a chosen light or dark, otherwise (system, unset or damaged) whatever the device uses. */
export function resolveTheme(pref, systemDark) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark ? 'dark' : 'light';
}

const listeners = new Set();
let mq = null;

function systemDark() { try { return matchMedia(QUERY).matches; } catch { return false; } }

export function currentPref() { return loadPrefs().theme || 'system'; }
export function currentTheme() { return resolveTheme(currentPref(), systemDark()); }

/** Writes the resolved theme to the page and tells listeners (only when it changed). */
export function applyTheme() {
  const t = currentTheme();
  const root = document.documentElement;
  const changed = root.dataset.theme !== t;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[t]);
  if (changed) for (const fn of listeners) { try { fn(t); } catch { /* a listener must not break the others */ } }
  return t;
}

/** Calls fn(theme) whenever the resolved theme changes. Returns a function that stops it. */
export function onTheme(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The user's choice: saved (with the time, for syncing later) and applied at once. */
export function setTheme(pref) {
  if (!THEMES.includes(pref)) return;
  savePrefs({ theme: pref, themeAt: Date.now() });
  applyTheme();
}

/** Applies the stored choice, follows the device while it is System, and follows a change made in another tab. */
export function initTheme() {
  applyTheme();
  try {
    mq = matchMedia(QUERY);
    mq.addEventListener('change', () => { if (currentPref() === 'system') applyTheme(); });
  } catch { /* no matchMedia: the stored choice still applies */ }
  window.addEventListener('storage', (e) => { if (e.key === null || e.key === 'uavzones.v1.prefs') applyTheme(); });
}
