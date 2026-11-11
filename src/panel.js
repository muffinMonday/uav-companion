// Collapsible side panel with tabs, plus a privacy-settings sub-panel that slides over it.
// Collapsing (the > button) slides the panel off to the right and leaves a slim rail (the dock) with a < button and one icon per tab.
const $ = (id) => document.getElementById(id);
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

import { loadPrefs, savePrefs } from './prefs.js';
import { animateOut } from './motion.js';

export function initPanel() {
  const panel = $('panel'), dock = $('dock'), sub = $('privacy');
  const tabs = [...panel.querySelectorAll('[role=tab]')];
  const panes = new Map(tabs.map((t) => [t.dataset.tab, $(t.getAttribute('aria-controls'))]));
  let current = 'config';
  const openers = [], changers = [];
  const changed = () => changers.forEach((fn) => fn());
  const mark = () => { document.body.dataset.panel = panel.hidden ? 'closed' : 'open'; };

  function selectTab(name, focus = false) {
    if (!panes.has(name)) return;
    current = name;
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const [k, el] of panes) el.hidden = k !== name;
    changed();
  }

  function openPrivacy() {
    if (panel.hidden) setOpen(true);
    sub.hidden = false;
    $('privacy-btn').setAttribute('aria-expanded', 'true');
    $('privacy-back').focus();
  }
  function closePrivacy({ focus = true } = {}) {
    if (sub.hidden) return;
    sub.hidden = true;
    $('privacy-btn').setAttribute('aria-expanded', 'false');
    if (focus) $('privacy-btn').focus();
  }

  function setOpen(open) {
    panel.hidden = !open;
    dock.hidden = open;
    if (!open) closePrivacy({ focus: false });
    for (const b of dock.querySelectorAll('button')) b.setAttribute('aria-expanded', String(open));
    mark();
    if (open) openers.forEach((fn) => fn());
    changed();
  }

  /** Remembers a choice made by the visitor on a computer (a phone always starts with the panel out of the way). */
  const remember = (collapsed) => { if (!isPhone()) savePrefs({ panelCollapsed: collapsed || null }); };
  function open(tab, { save = true } = {}) { selectTab(tab || current); setOpen(true); if (save) remember(false); }
  function close() {
    if (panel.hidden) { setOpen(false); return; }
    animateOut(panel, 'closing', () => { setOpen(false); remember(true); $('dock-expand')?.focus(); }); // slides out to the right, then the rail comes back
  }

  for (const t of tabs) {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      selectTab(tabs[(i + tabs.length) % tabs.length].dataset.tab, true);
    });
  }
  for (const b of dock.querySelectorAll('button')) b.addEventListener('click', () => open(b.dataset.tab));
  $('panel-close').addEventListener('click', close);
  $('privacy-close').addEventListener('click', close); // the sub-panel covers the main header, so it needs its own
  $('privacy-btn').addEventListener('click', () => (sub.hidden ? openPrivacy() : closePrivacy()));
  $('privacy-back').addEventListener('click', () => closePrivacy());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sub.hidden) closePrivacy(); });

  setOpen(false);
  if (!isPhone() && !loadPrefs().panelCollapsed) open('config', { save: false }); // phones start with the map unobstructed

  return {
    open, close, selectTab, openPrivacy, closePrivacy,
    isOpen: () => !panel.hidden,
    /** Calls fn whenever the panel opens (the dashboard steps aside for it on a phone). */
    onOpen(fn) { openers.push(fn); },
    /** The tab showing, and a hook for any change (open, close, tab). */
    getTab: () => current,
    onChange(fn) { changers.push(fn); },
    /** On phones the panel is a bottom sheet that would hide the map, so get it out of the way. */
    closeIfPhone() { if (isPhone() && !panel.hidden) { setOpen(false); } },
  };
}
