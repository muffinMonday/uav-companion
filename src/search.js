import L from 'leaflet';
import { parseCoordinates } from './coordparse.js';
import { log } from './log.js';
import { onSwipe } from './swipe.js';

/**
 * The search box: coordinates (typed or from a pasted map link), and place names searched online only when the person asks (Enter, or the "Search online" row).
 * Picking a result drops a blue pin and opens the point-check window for it, through `show` (see showCheck in main.js).
 */
export function initSearch(map, { show }) {
  const qEl = document.getElementById('q');
  const resEl = document.getElementById('results');
  const box = document.getElementById('search'), toggle = document.getElementById('search-toggle'), closeBtn = document.getElementById('search-close');
  let items = [], sel = -1, marker = null;
  const openListeners = new Set(), closeListeners = new Set();

  // collapsed to a magnifying glass until it is needed
  const expand = () => { box.classList.remove('collapsed'); toggle.setAttribute('aria-expanded', 'true'); qEl.tabIndex = 0; qEl.focus(); for (const fn of openListeners) fn(); };
  qEl.tabIndex = -1; // folded: out of the tab order
  const collapse = () => { const was = !box.classList.contains('collapsed'); box.classList.add('collapsed'); qEl.tabIndex = -1; toggle.setAttribute('aria-expanded', 'false'); resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); if (document.activeElement === qEl) qEl.blur(); if (was) for (const fn of closeListeners) fn(); };
  closeBtn?.addEventListener('click', () => collapse()); // the full-screen close affordance (new shell only; CSS-hidden otherwise)
  // Swipe to fold, from the header only (the magnifier, the close button or the empty bar around them; the input and the results are left alone, so typing,
  // selecting text and scrolling the list are untouched). The compact box hangs off the left, so it goes left; the full-screen box (new shell, its close button shows) goes down.
  const fullScreen = () => getComputedStyle(closeBtn).display !== 'none';
  const header = (t) => t === box || !!t.closest('.search-btn, .search-close');
  onSwipe(box, { direction: 'left', distance: 40, enabled: () => !box.classList.contains('collapsed') && !fullScreen(), canStart: header, onDismiss: () => collapse() });
  onSwipe(box, { direction: 'down', enabled: () => !box.classList.contains('collapsed') && fullScreen(), canStart: header, onDismiss: () => collapse() });
  /** Out of use: nothing typed and no list showing. */
  const idle = () => !qEl.value.trim() && resEl.hidden;
  toggle.addEventListener('click', () => { if (box.classList.contains('collapsed')) expand(); else if (idle()) collapse(); else qEl.focus(); });
  document.addEventListener('keydown', (e) => { // / opens it, as in many sites, unless something is being typed into
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !box.classList.contains('collapsed')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault(); expand();
  });

  /** What the text means: coordinates (or a map link) are read here and never searched online; anything else is a place name. */
  function interpret(q) {
    const c = parseCoordinates(q);
    if (c === null) return { list: [], coords: false, error: '' };
    if (!c.ok) return { list: [], coords: true, error: c.error };
    return { list: c.candidates.map((x) => ({ ...x, zoom: 15 })), coords: true, error: '' };
  }

  function msg(t) {
    resEl.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'msg'; li.textContent = t;
    resEl.appendChild(li);
    resEl.hidden = false;
    qEl.setAttribute('aria-expanded', 'true');
  }

  function render(list, q, { coords = false, error = '' } = {}) {
    items = list; sel = -1; resEl.innerHTML = '';
    if (error) { msg(error); return; }
    list.forEach((it, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `r${i}`;
      const main = document.createElement('span'); main.textContent = it.label;
      const sub = document.createElement('small'); sub.textContent = it.sub;
      li.append(main, sub);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); go(it); });
      resEl.appendChild(li);
    });
    if (q.trim() && !coords) { // coordinates never go to an online search
      const li = document.createElement('li');
      li.className = 'online';
      li.textContent = `Search online for “${q.trim()}”`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); online(q.trim()); });
      resEl.appendChild(li);
    }
    resEl.hidden = !resEl.children.length;
    qEl.setAttribute('aria-expanded', String(!resEl.hidden));
  }

  /** Says what went wrong with an online search, in words a person can act on. */
  const failureText = (kind) => (kind === 'offline' ? 'You are offline. Place-name search needs a connection; coordinates still work.'
    : kind === 'network' ? 'Could not reach the search services. Check the connection, then try again.'
    : kind === 'bad' ? 'The search service sent an answer that could not be read. Try again later.'
    : `The search service answered with an error (${kind}). Try again later.`);

  /** One request to a search service: the JSON answer, or an error that says what kind of failure it was. */
  async function answer(url) {
    let r;
    try { r = await fetch(url); } catch { throw Object.assign(new Error('no answer'), { kind: 'network' }); }
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { kind: r.status });
    try { return await r.json(); } catch { throw Object.assign(new Error('unreadable answer'), { kind: 'bad' }); }
  }

  /** Runs only when the person asks (Enter, or the "Search online" row). Photon first; Nominatim when Photon has nothing or fails. */
  async function online(q) {
    if (navigator.onLine === false) { msg(failureText('offline')); return; }
    msg('Searching online…');
    const c = map.getCenter();
    try {
      const d = await answer(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat}&lon=${c.lng}&limit=8`);
      const list = d.features.map((f) => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const sub = [p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
        return { label: p.name || q, sub: `${sub} · online`, lat, lon, zoom: 14 };
      });
      if (list.length) return render(list, '');
    } catch (e) { log.warn('search', 'Photon lookup failed, trying Nominatim', e.kind ?? e); /* fall through to Nominatim */ }
    try {
      const d = await answer(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh,en&q=${encodeURIComponent(q)}`);
      const list = d.map((x) => ({ label: x.name || x.display_name.split(',')[0], sub: `${x.display_name} · online`, lat: +x.lat, lon: +x.lon, zoom: 14 }));
      if (list.length) return render(list, '');
      msg('No online results. Try another spelling or the Chinese name.');
    } catch (e) { msg(failureText(e.kind ?? 'bad')); }
  }

  function removePin() { if (marker) { map.removeLayer(marker); marker = null; } }

  /** The picked result: a blue pin, and the point-check window above it (the same window as a press and hold gives). */
  function go(it) {
    removePin();
    const ll = L.latLng(it.lat, it.lon);
    marker = L.marker(ll, { title: it.label, alt: it.label, keyboard: true }).addTo(map);
    const open = (zoom) => show(ll, it.label, { offsetY: -38, zoom, onRemovePin: removePin, onAdded: removePin });
    marker.on('click', () => open(undefined)); // the pin reopens the window without moving the zoom
    open(it.zoom);
    resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); qEl.blur();
    collapse(); // a picked result has its window; the box folds away
  }

  const refresh = () => { const r = interpret(qEl.value); render(r.list, qEl.value, r); };
  qEl.addEventListener('input', refresh);
  qEl.addEventListener('keydown', (e) => {
    const lis = [...resEl.querySelectorAll('li[role=option]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!lis.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
      qEl.setAttribute('aria-activedescendant', lis[sel].id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0 && items[sel]) go(items[sel]);
      else if (items.length) go(items[0]);
      else if (qEl.value.trim() && parseCoordinates(qEl.value) === null) online(qEl.value.trim()); // coordinates are never sent to a search service
    } else if (e.key === 'Escape') { if (resEl.hidden || !qEl.value.trim()) { qEl.value = ''; collapse(); } else resEl.hidden = true; }
  });
  qEl.addEventListener('blur', () => setTimeout(() => { resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); if (idle() && document.activeElement !== toggle) collapse(); }, 150));
  qEl.addEventListener('focus', () => { if (qEl.value.trim()) refresh(); });

  // Minimal additive hooks for the new shell's full-screen presentation (Review 01 MAP-01): this module's own state and behavior
  // (expand/collapse, parsing, online search, selection) are unchanged; a shell layer only needs to know when the box opens or closes.
  return {
    isOpen: () => !box.classList.contains('collapsed'),
    close: () => collapse(),
    onOpen: (fn) => openListeners.add(fn),
    onClose: (fn) => closeListeners.add(fn),
  };
}
