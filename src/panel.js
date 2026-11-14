// Collapsible side panel with tabs, plus a privacy-settings sub-panel that slides over it.
// Collapsing (the > button) slides the panel off to the right and leaves a slim rail (the dock) with a < button and one icon per tab.
const $ = (id) => document.getElementById(id);
const isPhone = () => window.matchMedia('(max-width: 520px)').matches;

import { loadPrefs, savePrefs } from './prefs.js';
import { animateOut } from './motion.js';
import { onSwipe, atTop } from './swipe.js';

export function initPanel() {
  const panel = $('panel'), dock = $('dock'), sub = $('privacy');
  const tabs = [...panel.querySelectorAll('[role=tab]')];
  const panes = new Map(tabs.map((t) => [t.dataset.tab, $(t.getAttribute('aria-controls'))]));
  let current = 'config';
  const openers = [], changers = [];
  const changed = () => changers.forEach((fn) => fn());
  const mark = () => { document.body.dataset.panel = panel.hidden ? 'closed' : 'open'; };

  // The highlight behind the selected tab is one element (.tab-pill). The tabs themselves change size at once (the chosen one shows its name); the pill is moved
  // to the new tab's box and slides there by a CSS transition, which is only switched on (class "glide") for a change of tab, never for opening or resizing.
  const tabBar = panel.querySelector('.tabs');
  const pill = document.createElement('span'); pill.className = 'tab-pill'; pill.setAttribute('aria-hidden', 'true');
  tabBar.prepend(pill);
  function movePill(glide) {
    const t = tabs.find((x) => x.getAttribute('aria-selected') === 'true');
    if (!t || !t.offsetWidth) return; // panel closed: nothing to measure yet
    pill.classList.toggle('glide', glide);
    pill.style.width = t.offsetWidth + 'px';
    pill.style.transform = `translateX(${t.offsetLeft}px)`;
  }
  new ResizeObserver(() => movePill(false)).observe(tabBar);

  function selectTab(name, focus = false) {
    if (!panes.has(name)) return;
    const was = current;
    current = name;
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const [k, el] of panes) el.hidden = k !== name;
    movePill(was !== name && !panel.hidden);
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
    for (const b of dock.querySelectorAll('#dock-expand, button[data-tab]')) b.setAttribute('aria-expanded', String(open));
    mark();
    if (open) movePill(false);
    if (open) openers.forEach((fn) => fn());
    changed();
  }

  // On a phone the bottom sheet can grow to 90% of the screen (the handle on its top edge). The choice is remembered (prefs.panelTall).
  const expandBtn = $('panel-expand');
  function setTall(on, { save = true } = {}) {
    panel.classList.toggle('tall', on);
    if (save) savePrefs({ panelTall: on || null });
    expandBtn.setAttribute('aria-pressed', String(on));
    expandBtn.setAttribute('aria-label', on ? 'Shrink the panel back to its usual height' : 'Expand the panel');
    expandBtn.title = on ? 'Shrink back' : 'Expand';
  }
  expandBtn.addEventListener('click', () => setTall(!panel.classList.contains('tall')));
  if (loadPrefs().panelTall) setTall(true, { save: false });

  /** Remembers a choice made by the visitor on a computer (a phone always starts with the panel out of the way). */
  const remember = (collapsed) => { if (!isPhone()) savePrefs({ panelCollapsed: collapsed || null }); };
  // The rail folds up into one circle (a fold button, or a swipe up; the circle, or a swipe down, brings the icons back). Remembered.
  const circle = $('dock-circle'), foldBtn = $('dock-fold'), icons = $('dock-icons');
  const counts = new Map(); // badge counts per tab; the circle shows their sum so an invitation is never hidden
  const showCircleBadge = () => { const n = [...counts.values()].reduce((a, b) => a + b, 0); const b = circle.querySelector('.tab-badge'); b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || ''); };
  const isFolded = () => dock.classList.contains('folded');
  function setFolded(on, { save = true, focus = true } = {}) {
    dock.classList.toggle('folded', on);
    icons.inert = on; circle.hidden = !on;
    circle.setAttribute('aria-expanded', String(!on)); foldBtn.setAttribute('aria-expanded', String(!on));
    if (save) savePrefs({ railFolded: on || null });
    if (focus) (on ? circle : $('dock-expand')).focus();
  }
  foldBtn.addEventListener('click', () => setFolded(true));
  circle.addEventListener('click', () => setFolded(false));
  onSwipe(dock, { direction: 'up', distance: 28, follow: icons, ignore: '[data-no-swipe]', enabled: () => !isFolded() && !dock.hidden, onDismiss: () => setFolded(true) });
  // swiping the unfolded icons toward the map (left) pulls the panel out, the way it came in
  onSwipe(dock, { direction: 'left', distance: 28, follow: dock, ignore: '[data-no-swipe]', enabled: () => !isFolded() && !dock.hidden, onDismiss: () => open() });
  onSwipe(dock, { direction: 'down', distance: 28, follow: circle, ignore: '[data-no-swipe]', enabled: () => isFolded() && !dock.hidden, onDismiss: () => setFolded(false) });
  if (loadPrefs().railFolded) setFolded(true, { save: false, focus: false });

  function open(tab, { save = true } = {}) { selectTab(tab || current); setOpen(true); if (save) remember(false); }
  function close({ instant = false } = {}) {
    if (panel.hidden) { setOpen(false); return; }
    const done = () => { setOpen(false); remember(true); (isFolded() ? circle : $('dock-expand'))?.focus(); };
    if (instant) done(); else animateOut(panel, 'closing', done); // slides out to the right, then the rail comes back (a swipe has already slid it away)
  }

  // Swipe to dismiss: the phone's bottom sheet goes down, and on every screen size the panel goes to the right, the way it leaves. A swipe starts in the header or handle,
  // or in the body once it is scrolled to the top.
  const inHeader = (t) => !!t.closest('.sp-head, .sp-grab');
  onSwipe(panel, { direction: 'down', enabled: () => isPhone() && !panel.hidden, canStart: (t) => inHeader(t) || atTop(t, panel), onDismiss: () => close({ instant: true }) });
  onSwipe(panel, { direction: 'right', enabled: () => !panel.hidden, onDismiss: () => close({ instant: true }) }); // to the right, on a phone as well as on a computer

  function wireTab(t) {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      selectTab(tabs[(i + tabs.length) % tabs.length].dataset.tab, true);
    });
  }
  for (const t of tabs) wireTab(t);
  for (const b of dock.querySelectorAll('#dock-expand, button[data-tab]')) b.addEventListener('click', () => open(b.dataset.tab));

  /** Adds a tab after start-up: { key, label, icon (svg markup built from constants), pane (the tab's content element) }. Returns { badge(n) } to show a count on its tab and rail icon. */
  function addTab({ key, label, icon, pane }) {
    const svg = icon;
    const t = document.createElement('button');
    t.type = 'button'; t.setAttribute('role', 'tab'); t.id = 'tab-' + key; t.dataset.tab = key;
    t.setAttribute('aria-controls', pane.id); t.setAttribute('aria-selected', 'false'); t.tabIndex = -1;
    t.innerHTML = svg + '<span class="tab-label"></span><span class="tab-badge" hidden></span>'; // icon markup comes from constants in the calling module
    t.querySelector('.tab-label').textContent = label;
    tabBar.append(t);
    tabs.push(t); panes.set(key, pane); pane.hidden = true; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', t.id);
    panel.querySelector('.sp-body').append(pane);
    wireTab(t);
    movePill(false);
    const d =document.createElement('button');
    d.type = 'button'; d.dataset.tab = key; d.setAttribute('aria-controls', 'panel'); d.setAttribute('aria-expanded', String(!panel.hidden)); d.setAttribute('aria-label', label); d.title = label;
    d.innerHTML = svg + '<span></span><span class="tab-badge" hidden></span>';
    d.querySelector('span').textContent = label;
    d.addEventListener('click', () => open(key));
    $('dock-fold').before(d);
    return { badge(n) { for (const b of [t.querySelector('.tab-badge'), d.querySelector('.tab-badge')]) { b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || ''); } counts.set(key, n || 0); showCircleBadge(); } };
  }
  $('panel-close').addEventListener('click', close);
  $('privacy-close').addEventListener('click', close); // the sub-panel covers the main header, so it needs its own
  $('privacy-btn').addEventListener('click', () => (sub.hidden ? openPrivacy() : closePrivacy()));
  $('privacy-back').addEventListener('click', () => closePrivacy());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sub.hidden) closePrivacy(); });

  setOpen(false);
  if (!isPhone() && !loadPrefs().panelCollapsed) open('config', { save: false }); // phones start with the map unobstructed

  return {
    open, close, selectTab, openPrivacy, closePrivacy, addTab,
    isOpen: () => !panel.hidden,
    /** Calls fn whenever the panel opens (the dashboard steps aside for it on a phone). */
    onOpen(fn) { openers.push(fn); },
    /** The tab showing, and a hook for any change (open, close, tab). */
    getTab: () => current,
    onChange(fn) { changers.push(fn); },
    /** On phones the panel is a bottom sheet that would hide the map, so get it out of the way. */
    closeIfPhone() { if (isPhone() && !panel.hidden) { setOpen(false); } },
    /** Hides the panel for a while without touching the saved choice (the sessions map explorer needs the room). Returns a function that brings it back if it is still hidden. */
    suspend() { if (panel.hidden) return () => {}; setOpen(false); return () => { if (panel.hidden) setOpen(true); }; },
  };
}
