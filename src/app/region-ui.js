import { zoneFill } from '../map.js';
import { MEANINGS } from '../legends.js';
import { savePrefs } from '../prefs.js';

const $ = (id) => document.getElementById(id);

/**
 * Country shortcut (re-centres on a country's view box, whether or not it has zone data yet) and the dashboard's Fly in buttons.
 * Returns { clearOfPanel }: fit options that keep what is fitted clear of a docked side panel (phones use a bottom sheet that is closed while viewing).
 */
export function initRegionUI({ map, panel, dash, prefs, index, toast }) {
  const countrySel = $('country');
  for (const c of index.countries.filter((x) => x.view).sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.regions ? c.name : `${c.name} (no zone data yet)`;
    countrySel.append(o);
  }
  const clearOfPanel = () => (panel.isOpen() && window.innerWidth > 520 ? { paddingBottomRight: [$('panel').offsetWidth + 24, 0] } : undefined);
  const goToCountry = (id) => {
    const c = index.countries.find((x) => x.id === id && x.view);
    if (!c) return;
    map.fitBounds([[c.view[1], c.view[0]], [c.view[3], c.view[2]]], clearOfPanel());
    if (!c.regions) toast(`No zone data for ${c.name} yet. The map shows nothing about flying rules there.`, 7000);
  };
  // The choice stays shown in the menu and is remembered. Choosing it again after panning away: use the Centre button.
  countrySel.addEventListener('change', () => { savePrefs({ country: countrySel.value || null }); goToCountry(countrySel.value); });
  $('country-go').addEventListener('click', () => {
    if (!countrySel.value) { toast('Choose a country first.', 3000); return; }
    goToCountry(countrySel.value);
  });
  dash.setRegions(index.countries.filter((c) => c.regions && c.view).sort((x, y) => x.name.localeCompare(y.name)), goToCountry); // the dashboard's Fly in buttons
  if (prefs.country && index.countries.some((c) => c.id === prefs.country && c.view)) countrySel.value = prefs.country; // position itself comes from the saved view
  return { clearOfPanel };
}

/** The map legend and the coverage note. Called once the zones are on the map. */
export function renderRegionInfo({ index, regions }) {
  const legend = $('legend');
  const meanings = { allow: [zoneFill('allow'), MEANINGS.allow.text], restrict: [zoneFill('restrict'), MEANINGS.restrict.text] }; // the wording is shared with the explanation beside each verdict (legends.js)
  const addLegend = (colour, text) => { const row = document.createElement('div'); const sw = document.createElement('i'); sw.style.background = colour; row.append(sw, text); legend.append(row); };
  for (const r of regions.filter((x) => x.classes)) {
    for (const c of r.classes) addLegend(c.color, c.points ? `${c.label}: where flying is allowed (a pin on the map).` : `${c.label}.`);
    const p = document.createElement('div'); p.className = 'legend-note'; p.textContent = `${r.name}: ${r.source.authority}, updated ${r.source.effective}. Approximate: not in a zone here does not mean flying is allowed. Check the official map.`; legend.append(p);
  }
  for (const sem of new Set(regions.filter((r) => !r.classes).map((r) => r.semantics))) {
    const row = document.createElement('div');
    const sw = document.createElement('i');
    sw.style.background = meanings[sem][0];
    row.append(sw, meanings[sem][1]);
    legend.append(row);
  }

  const note = $('regions-note');
  note.textContent = '';
  const b = document.createElement('b');
  const pending = index.countries.filter((c) => !c.regions).map((c) => c.name);
  b.textContent = `Coverage: ${regions.map((r) => r.name).join(', ') || 'none'}.${pending.length ? ` No data yet: ${pending.join(', ')}.` : ''} `;
  note.append(b, 'Official data: ' + [...new Set(regions.map((r) => `${r.source.authority} (effective ${r.source.effective})`))].join('; ') + '.');
}
