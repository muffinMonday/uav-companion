// Country buttons: the dashboard's Fly in card and Map Config's Go to card. One button per supported country. A country with one
// region navigates straight to it; a country with several regions opens a menu of its regions (no whole-country item). Rule and
// the keep-in-sync list: ARCHITECTURE.md ("Fly In regions").

/**
 * The buttons to show: one group per country that has zone data, with its regions sorted by label.
 * `countries`: index.json countries that have zone data and a view; `areas`: { id, country, label } per region archive.
 */
export function countryGroups(countries, areas) {
  return countries
    .map((c) => ({ id: c.id, name: c.name, areas: areas.filter((a) => a.country === c.id).sort((x, y) => x.label.localeCompare(y.label)) }))
    .filter((g) => g.areas.length)
    .sort((x, y) => x.name.localeCompare(y.name));
}

let seq = 0;

/**
 * The picker element. `onPick(areaId)` runs when a region is chosen (directly, or from a country's menu); the menu then closes.
 * Keyboard: Tab reaches each button; Enter or Space opens a menu and moves focus into it; Up and Down move within it; Escape or
 * choosing a region closes it and returns focus to its country button. A press outside the picker closes an open menu.
 */
export function countryPicker(groups, onPick) {
  const menuId = `country-menu-${++seq}`;
  const root = document.createElement('div');
  root.className = 'country-picker';
  const row = document.createElement('div');
  row.className = 'country-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Countries');
  const menu = document.createElement('div');
  menu.className = 'country-menu';
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute('role', 'group');
  let open = null; // { trigger, items }

  const close = (refocus) => {
    if (!open) return;
    const { trigger } = open;
    open = null;
    menu.hidden = true;
    menu.replaceChildren();
    for (const b of row.querySelectorAll('[aria-controls]')) b.setAttribute('aria-expanded', 'false');
    if (refocus) trigger.focus();
  };
  const show = (group, trigger) => {
    close(false);
    menu.setAttribute('aria-label', `${group.name} regions`);
    const items = group.areas.map((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = a.label;
      b.dataset.region = a.id;
      b.addEventListener('click', () => { close(true); onPick(a.id); });
      return b;
    });
    menu.append(...items);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    open = { trigger, items };
    items[0].focus();
  };

  for (const g of groups) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn country-btn';
    b.dataset.country = g.id;
    b.append(document.createTextNode(g.name));
    if (g.areas.length === 1) {
      const area = g.areas[0];
      b.addEventListener('click', () => { close(false); onPick(area.id); });
    } else {
      const chev = document.createElement('span');
      chev.className = 'country-chev';
      chev.setAttribute('aria-hidden', 'true');
      b.append(chev);
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-controls', menuId);
      b.addEventListener('click', () => (open?.trigger === b ? close(true) : show(g, b)));
    }
    row.append(b);
  }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(true); return; } // a dialog would otherwise close too
    if (!open || !(e.key === 'ArrowDown' || e.key === 'ArrowUp') || !menu.contains(e.target)) return;
    e.preventDefault();
    const i = open.items.indexOf(e.target);
    const next = open.items[(i + (e.key === 'ArrowDown' ? 1 : -1) + open.items.length) % open.items.length];
    next.focus();
  });
  // Stops listening once the picker has been replaced (the dashboard re-renders its cards).
  const outside = (e) => {
    if (!root.isConnected) { document.removeEventListener('pointerdown', outside); return; }
    if (open && !root.contains(e.target)) close(false);
  };
  document.addEventListener('pointerdown', outside);

  root.append(row, menu);
  return root;
}
