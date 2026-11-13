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

const listeners = new Set(), choiceListeners = new Set(), prefListeners = new Set();
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
  for (const fn of choiceListeners) { try { fn(); } catch { /* ignore */ } }
}

/** Calls fn() when the user picks a theme here (not when one arrives from another device): cloud sync uploads it. */
export function onThemeChoice(fn) { choiceListeners.add(fn); return () => choiceListeners.delete(fn); }

/** The synced choice, for cloud sync: { theme, themeAt } or null when the user never chose. */
export function themeSetting() { const p = loadPrefs(); return p.theme && p.themeAt ? { theme: p.theme, themeAt: p.themeAt } : null; }

/** A choice that arrived from another device: kept with its own time (so it is not mistaken for a new choice here) and applied. */
export function adoptTheme({ theme, themeAt }) {
  if (!THEMES.includes(theme)) return;
  savePrefs({ theme, themeAt });
  applyTheme();
  notifyPref();
}

/** Calls fn(pref) when the stored choice changed by itself (from another tab or another device), so the selector can follow. */
export function onThemePref(fn) { prefListeners.add(fn); return () => prefListeners.delete(fn); }
function notifyPref() { for (const fn of prefListeners) { try { fn(currentPref()); } catch { /* ignore */ } } }

/** Applies the stored choice, follows the device while it is System, and follows a change made in another tab. */
export function initTheme() {
  applyTheme();
  try {
    mq = matchMedia(QUERY);
    mq.addEventListener('change', () => { if (currentPref() === 'system') applyTheme(); });
  } catch { /* no matchMedia: the stored choice still applies */ }
  window.addEventListener('storage', (e) => { if (e.key === null || e.key === 'uavzones.v1.prefs') { applyTheme(); notifyPref(); } });
}
