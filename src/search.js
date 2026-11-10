import L from 'leaflet';

const KIND = { city: 'City', county: 'District / county', landmark: 'Landmark' };
const norm = (t) => t.toLowerCase().replace(/[\s'’\-]/g, '');
const strip = (t) => t.replace(/(土家族自治县|林区|市|区|县)$/, '');

export function initSearch(map, places) {
  const qEl = document.getElementById('q');
  const resEl = document.getElementById('results');
  let items = [], sel = -1, marker = null;

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

  function render(list, q) {
    items = list; sel = -1; resEl.innerHTML = '';
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
    if (q.trim()) {
      const li = document.createElement('li');
      li.className = 'online';
      li.textContent = list.length ? `Search online for “${q.trim()}”` : `No offline match. Search online for “${q.trim()}”`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); online(q.trim()); });
      resEl.appendChild(li);
    }
    resEl.hidden = !resEl.children.length;
    qEl.setAttribute('aria-expanded', String(!resEl.hidden));
  }

  function msg(t) {
    resEl.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'msg'; li.textContent = t;
    resEl.appendChild(li);
    resEl.hidden = false;
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

  function go(it) {
    map.setView([it.lat, it.lon], it.zoom);
    if (marker) map.removeLayer(marker);
    marker = L.marker([it.lat, it.lon]).addTo(map).bindPopup(it.label).openPopup();
    resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); qEl.blur();
  }

  qEl.addEventListener('input', () => render(offline(qEl.value), qEl.value));
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
      else if (qEl.value.trim()) online(qEl.value.trim());
    } else if (e.key === 'Escape') { resEl.hidden = true; }
  });
  qEl.addEventListener('blur', () => setTimeout(() => { resEl.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }, 150));
  qEl.addEventListener('focus', () => { if (qEl.value.trim()) render(offline(qEl.value), qEl.value); });
}
