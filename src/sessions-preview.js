// A small map preview of a session's meeting point for Discover cards: four raster tiles of the current basemap (original light cartography, without filtering), a pin and
// the basemap's credit. No Leaflet instance, no airspace overlay (the text points to the map for that). Built only when a card is expanded; the browser cache does the rest.
import { baseTiles } from './map.js';
import { tileGrid, creditText, TILE } from './sessions-preview-model.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

/** The expandable preview of a card: { chevron, panel }. `open()` shows the map of `s` (needs `s.lat`, `s.lng`); tapping the map calls `onOpenMap`. Returns null when the point is unusable. */
export function previewParts(s, { basemap, expanded, onToggle, onOpenMap }) {
  const [url, opts] = baseTiles(basemap);
  const grid = tileGrid(s.lat, s.lng, [url, opts]);
  if (!grid) return null;
  const pid = 'ses-prev-' + s.id.replace(/[^A-Za-z0-9_-]/g, '');
  const chevron = el('button', 'ses-chev'); chevron.type = 'button'; chevron.dataset.act = 'preview';
  chevron.setAttribute('aria-expanded', String(expanded)); chevron.setAttribute('aria-controls', pid);
  chevron.setAttribute('aria-label', (expanded ? 'Hide' : 'Show') + ' the map preview of ' + s.title);
  chevron.innerHTML = SVG(expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'); // constant markup
  chevron.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  const panel = el('div', 'ses-prev'); panel.id = pid; panel.dataset.open = String(expanded);
  const inner = el('div', 'ses-prev-in');
  if (expanded) {
    const fig = el('figure', 'ses-prev-fig');
    const map = el('div', 'ses-prev-map'); map.style.setProperty('--px', grid.pin.x + 'px'); map.style.setProperty('--py', grid.pin.y + 'px'); map.style.setProperty('--grid', grid.size + 'px');
    for (const t of grid.tiles) { const im = el('img', 'base-tiles'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.width = im.height = TILE; im.src = t.url; im.style.setProperty('--tx', t.left + 'px'); im.style.setProperty('--ty', t.top + 'px'); im.referrerPolicy = 'strict-origin-when-cross-origin'; map.append(im); }
    map.append(el('span', 'ses-prev-pin'));
    const open = el('button', 'ses-prev-open'); open.type = 'button'; open.dataset.act = 'preview-open'; open.setAttribute('aria-label', s.title + ': open on the map');
    open.addEventListener('click', (e) => { e.stopPropagation(); onOpenMap(); });
    const credit = creditText(opts.attribution), i = credit.indexOf('OpenStreetMap');
    const cap = el('figcaption', 'ses-prev-credit');
    if (i >= 0) { const a = el('a', '', 'OpenStreetMap'); a.href = 'https://www.openstreetmap.org/copyright'; a.target = '_blank'; a.rel = 'noopener noreferrer'; cap.append(credit.slice(0, i), a, credit.slice(i + 13)); } else cap.append(credit);
    fig.append(map, open, cap);
    inner.append(fig, el('small', 'ses-prev-note', 'Open the map to check airspace.'));
  }
  panel.append(inner);
  return { chevron, panel };
}
