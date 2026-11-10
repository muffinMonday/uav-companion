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

export const disclaimer = () => el('p', 'disclaimer', 'Planning aid only, not flight advice. Check the official platform before every flight.');
