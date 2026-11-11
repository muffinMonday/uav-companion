import L from 'leaflet';
import { parseCoordinates } from './coordparse.js';

const KIND = { city: 'City', county: 'District / county', landmark: 'Landmark' };
const norm = (t) => t.toLowerCase().replace(/[\s'’\-]/g, '');
const strip = (t) => t.replace(/(土家族自治县|林区|市|区|县)$/, '');

/**
 * The search box: place names (offline, then online) and coordinates (typed or from a pasted map link).
 * Picking a result drops a blue pin and opens the point-check window for it, through `show` (see showCheck in main.js).
 */
export function initSearch(map, places, { show }) {
  const qEl = document.getElementById('q');
  const resEl = document.getElementById('results');
  const box = document.getElementById('search'), toggle = document.getElementById('search-toggle');
  let items = [], sel = -1, marker = null;

  // collapsed to a magnifying glass until it is needed
  const expand = () => { box.classList.remove('collapsed'); toggle.setAttribute('aria-expanded', 'true'); qEl.focus(); };
  const collapse = () => { box.classList.add('collapsed'); toggle.setAttribute('aria-expanded', 'false'); resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); if (document.activeElement === qEl) qEl.blur(); };
  /** Out of use: nothing typed and no list showing. */
  const idle = () => !qEl.value.trim() && resEl.hidden;
  toggle.addEventListener('click', () => { if (box.classList.contains('collapsed')) expand(); else if (idle()) collapse(); else qEl.focus(); });
  document.addEventListener('keydown', (e) => { // / opens it, as in many sites, unless something is being typed into
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !box.classList.contains('collapsed')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault(); expand();
  });

  function offline(q) {
    const n = norm(strip(q.trim()));
    if (!n) return [];
    const out = [];
    for (const [zh, en, lat, lon, kind] of places) {
      const z = strip(zh), e = norm(en);
      let score = -1;
      if (z === n || e === n) score = 0;
      else if (z.startsWith(n) || e.startsWith(n)) score = 1;
      else if (zh.includes(n) || e.includes(n)) score = 2;
      if (score >= 0) out.push({ score, label: zh, sub: `${en} · ${KIND[kind]}`, lat, lon, zoom: kind === 'city' ? 11 : kind === 'county' ? 12 : 14 });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 8);
  }

  /** What the text means: coordinates (or a map link) are read here and never searched online; anything else is a place name. */
  function interpret(q) {
    const c = parseCoordinates(q);
    if (c === null) return { list: offline(q), coords: false, error: '' };
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
      li.textContent = list.length ? `Search online for “${q.trim()}”` : `No offline match. Search online for “${q.trim()}”`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); online(q.trim()); });
      resEl.appendChild(li);
    }
    resEl.hidden = !resEl.children.length;
    qEl.setAttribute('aria-expanded', String(!resEl.hidden));
  }

  async function online(q) {
    msg('Searching online…');
    const c = map.getCenter();
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat}&lon=${c.lng}&limit=8`);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const list = d.features.map((f) => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const sub = [p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
        return { label: p.name || q, sub: `${sub} · online`, lat, lon, zoom: 14 };
      });
      if (list.length) return render(list, '');
    } catch { /* fall through to Nominatim */ }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh,en&q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const list = d.map((x) => ({ label: x.name || x.display_name.split(',')[0], sub: `${x.display_name} · online`, lat: +x.lat, lon: +x.lon, zoom: 14 }));
      if (list.length) return render(list, '');
      msg('No online results. Try another spelling or the Chinese name.');
    } catch { msg('Online search unavailable (no connection, or the service blocked the request). Offline names still work.'); }
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
}
