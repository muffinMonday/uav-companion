// Connects the hint registry (help-content.js), its once-only state (help-state.js) and the card (help-ui.js) to the page:
//   panel tabs   the first time a tab opens, its hint shows at the top of the pane; a tab change removes a hint that belongs to the tab just left
//   map          the first press of a map button (map-tools) and the first point-check window (point-check)
//   sessions     the hub passes its tab row when it opens (hubHint)
//   replay(id)   the dashboard's Tips list: opens the place the hint belongs to and shows it again, without changing what has been seen
// Nothing here asks for a permission, stores anything but the list of seen ids, or touches the safety and privacy confirmations.
import L from 'leaflet';
import { HELP, helpById } from './help-content.js';
import { createHelpState } from './help-state.js';
import { createHelp } from './help-ui.js';

export function initHelp({ map, panel, sessions = () => null, state = createHelpState() }) {
  const help = createHelp({ state });
  const mapPlace = (card) => { card.classList.add('on-map'); L.DomEvent.disableClickPropagation(card); map.getContainer().append(card); };
  const panePlace = (tab) => (card) => document.getElementById('pane-' + tab)?.prepend(card);
  const hubPlace = (tabs) => (card) => tabs.after(card);

  // ---- side-panel tabs
  const tabHint = (tab) => HELP.find((h) => h.where === 'panel' && h.tab === tab);
  panel.onChange(() => {
    const open = panel.isOpen() ? panel.getTab() : null;
    const cur = help.current && helpById(help.current);
    if (cur?.where === 'panel' && cur.tab !== open) help.clear();
    const h = open && tabHint(open);
    if (h) help.auto(h.id, panePlace(open));
  });

  // ---- parts of the Points of Interest pane: shown after a first use of that part (placed by `anchor`)
  const anchorOf = (h) => (card) => {
    const pane = document.getElementById('pane-poi'); if (!pane) return;
    if (h.anchor === 'type') (document.getElementById('poi-type-now') ?? pane).after(card);
    else if (h.anchor === 'list') (document.getElementById('poi-list') ?? pane).before(card);
    else pane.prepend(card);
  };
  let pendingTimer = 0;
  const poiAuto = (id) => { const h = helpById(id); if (h) help.auto(id, anchorOf(h)); };
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('#poi-type-tabs .chip')) poiAuto('poi-types'); // the first change of group in the type picker
    const fold = t.closest('#poi-list .sec-toggle:not([data-day])');
    if (fold && fold.getAttribute('aria-expanded') === 'true') poiAuto('trip-visibility'); // the first time a trip is opened, where its On map button is
  });

  // ---- the map
  map.on('popupopen', (e) => {
    const bar = e.popup.getElement()?.querySelector('.pop-bar');
    if (bar && /Point check/i.test(bar.textContent)) help.auto('point-check', mapPlace);
  });

  return {
    help, state,
    /** The first press of any map button (called by the toolbar). */
    mapToolUsed: () => help.auto('map-tools', mapPlace),
    /** The visitor found the tag button themselves: nothing left to explain. */
    labelsOpened: () => help.done('map-tools'),
    /** A newer marker type was just put into a shared trip (create, edit, bulk change or import): the one notice a visitor must dismiss. */
    newTypeShared() { // unlike a tip, this waits (a marker window or a drag is up right after creating) and tries again until it can be shown, or the visitor has dismissed it
      if (state.has('newtype-shared') || pendingTimer) return;
      let tries = 0;
      const attempt = () => { if (state.has('newtype-shared') || help.current === 'newtype-shared' || ++tries > 120) { clearInterval(pendingTimer); pendingTimer = 0; return; } poiAuto('newtype-shared'); };
      pendingTimer = setInterval(attempt, 1000); setTimeout(attempt, 500);
    },
    /** The sessions hub has opened: `tabs` is its tab row. Not for a deep link to one session. */
    hubHint(tabs, opts = {}) { if (!opts.id) help.auto('sessions', hubPlace(tabs), { inDialog: true }); },
    /** Where each hint can be replayed from now (a tab or the hub only exists when this build has accounts). */
    replayable() {
      return HELP.filter((h) => h.where === 'map' || (h.where === 'panel' && document.getElementById('pane-' + h.tab)) || (h.where === 'poi' && document.getElementById('pane-poi')) || (h.where === 'hub' && sessions()));
    },
    /** Shows a hint again on request (seen state unchanged). */
    replay(id) {
      const h = helpById(id); if (!h) return;
      if (h.where === 'panel') { panel.open(h.tab); help.replay(id, panePlace(h.tab)); }
      else if (h.where === 'poi') { panel.open('poi'); if (h.anchor === 'type') { const a = document.getElementById('poi-add'); if (a) a.open = true; } help.replay(id, anchorOf(h)); }
      else if (h.where === 'hub') { sessions()?.open('discover'); const tabs = document.querySelector('#ses-hub .ses-tabs'); if (tabs) help.replay(id, hubPlace(tabs)); }
      else help.replay(id, mapPlace);
    },
  };
}
