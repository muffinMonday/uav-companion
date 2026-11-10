// Small DOM builders shared by the marker window and the point-check popup. Text always goes in via textContent.
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The zone verdict as a prominent banner. s = { cls: 'ok' | 'no' | 'unk', title, detail }. */
export function statusEl(s) {
  const d = el('div', `status ${s.cls}`);
  const body = el('div', 'st');
  body.append(el('strong', '', s.title), el('small', '', s.detail));
  d.append(el('span', 'dot'), body);
  return d;
}

/** A big-number tile. key is for tests and styling hooks. */
export function tile(key, label, value, cls = '') {
  const t = el('div', `stat ${cls}`.trim());
  t.dataset.k = key;
  t.append(el('div', 'v', value), el('div', 'k', label));
  return t;
}

export function statsGrid(tiles) {
  const g = el('div', 'stats');
  g.style.setProperty('--cols', String(tiles.length === 4 ? 2 : Math.min(tiles.length, 3)));
  g.append(...tiles);
  return g;
}

/**
 * The rain block of a marker window: a headline (peak chance and when, or expected millimetres) and one bar per hour.
 * `outlook` comes from rainOutlook() in markerweather.js.
 */
export function rainBlock(outlook) {
  const box = el('div', 'rain');
  const head = el('div', 'rain-head');
  if (outlook.kind === 'prob') {
    head.append(el('b', '', `Rain chance up to ${Math.round(outlook.peak)}%`), outlook.peak > 0 ? ` around ${outlook.at}` : ' (none expected)');
  } else if (outlook.kind === 'mm') {
    head.append(el('b', '', outlook.total > 0 ? `Rain expected: ${outlook.total.toFixed(1)} mm` : 'No rain forecast'), ' (no chance given for this place)');
  } else {
    head.append(el('b', '', 'Rain chance unavailable'), ' (the forecast model has none for this place)');
    box.append(head);
    return box;
  }
  box.append(head);
  const strip = el('div', 'rain-strip');
  strip.setAttribute('role', 'img');
  const mmMax = Math.max(1, ...outlook.hours.map((x) => x.mm ?? 0));
  const parts = [];
  for (const h of outlook.hours) {
    const value = outlook.kind === 'prob' ? h.p : h.mm;
    const frac = value === null ? 0 : outlook.kind === 'prob' ? value / 100 : Math.min(1, value / mmMax);
    const col = el('div', 'rain-col');
    const bar = el('i', value === null ? 'rain-bar none' : 'rain-bar');
    bar.style.setProperty('--h', `${Math.max(frac * 100, value > 0 ? 6 : 2).toFixed(0)}%`);
    const text = value === null ? '–' : outlook.kind === 'prob' ? `${Math.round(value)}%` : value.toFixed(1);
    col.append(el('span', 'rain-v', text), el('div', 'rain-bar-wrap'), el('span', 'rain-t', h.label.slice(0, 2)));
    col.children[1].append(bar);
    strip.append(col);
    parts.push(`${h.label} ${text}`);
  }
  strip.setAttribute('aria-label', `${outlook.kind === 'prob' ? 'Rain chance' : 'Expected rain in mm'} by hour: ${parts.join(', ')}`);
  box.append(strip);
  return box;
}

export const disclaimer = () => el('p', 'disclaimer', 'Planning aid only, not flight advice. Check the official platform before every flight.');
