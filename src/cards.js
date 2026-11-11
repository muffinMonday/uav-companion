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

export const disclaimer = () => el('p', 'disclaimer', 'Planning aid, not flight advice.');

// ---------- the small icon toolbar at the top of a window ----------
const PATHS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  visit: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  pin: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 8v6M9 11h6',
  unpin: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM9.5 8.5l5 5M14.5 8.5l-5 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
/**
 * An icon button (the label is the tooltip and the accessible name). The icon is built from constants only.
 * `danger`: the first press turns it into "Confirm <label>" for four seconds, the second one acts.
 */
export function toolButton({ icon, label, onClick, danger = false }) {
  const b = el('button', danger ? 'btn tool danger' : 'btn tool');
  b.type = 'button'; b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[icon]}"/></svg>`;
  const text = el('span', 'tool-label', label);
  b.append(text);
  let armed = null;
  b.addEventListener('click', (e) => {
    if (danger && !armed) {
      text.textContent = `Confirm ${label.toLowerCase()}`; b.classList.add('armed');
      armed = setTimeout(() => { text.textContent = label; b.classList.remove('armed'); armed = null; }, 4000);
      return;
    }
    clearTimeout(armed); armed = null;
    onClick(e);
  });
  return b;
}
/**
 * The bar at the top of a window: a caption on the left, the tools on the right. `menu` is a list of the same kind of options
 * ({ icon, label, onClick, danger }) that goes behind a ⋯ button; the rest stay as icons.
 */
export function toolBar({ caption, tools = [], menu = [] }) {
  const bar = el('div', 'pop-bar');
  bar.append(el('div', 'pop-type', caption));
  const right = el('div', 'pop-tools');
  for (const t of tools) right.append(toolButton(t));
  if (menu.length) {
    const more = toolButton({ icon: 'more', label: 'More', onClick: () => {} });
    const list = el('div', 'pop-menu'); list.hidden = true;
    for (const m of menu) list.append(toolButton(m));
    more.addEventListener('click', () => { list.hidden = !list.hidden; });
    right.append(more);
    bar.append(right, list);
  } else bar.append(right);
  return bar;
}
