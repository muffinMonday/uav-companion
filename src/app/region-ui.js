import { zoneFill } from '../map.js';
import { swatchBackground } from '../zone-style.js';
import { MEANINGS, SELECTED_SOURCE_MEANING, selectedProviders, snapshotText, regionNotice } from '../legends.js';
import { regionLabel } from './region-labels.js';
import { countryGroups, countryPicker } from './country-menu.js';

const $ = (id) => document.getElementById(id);

/**
 * The country buttons (Map Config's Go to card, and the dashboard's Fly in choices through the same groups) and the Fly in region
 * focus. Returns { clearOfPanel }: fit options that keep what is fitted clear of a docked side panel (phones use a bottom sheet that is closed while viewing).
 */
export function initRegionUI({ map, panel, dash, index, regions }) {
  const clearOfPanel = () => (panel.isOpen() && window.innerWidth > 520 ? { paddingBottomRight: [$('panel').offsetWidth + 24, 0] } : undefined);
  // Focus on one region archive. Only the archives that the new view touches are loaded (createZones.sync on moveend).
  const areas = regions.filter((r) => r.bounds).map((r) => ({ id: r.id, country: r.country, label: regionLabel(r), bounds: r.bounds }));
  const goToArea = (id) => {
    const a = areas.find((x) => x.id === id);
    if (a) map.fitBounds([[a.bounds[1], a.bounds[0]], [a.bounds[3], a.bounds[2]]], clearOfPanel());
  };
  const supported = index.countries.filter((c) => c.regions && c.view);
  const groups = countryGroups(supported, areas);
  $('country-buttons').replaceChildren(countryPicker(groups, goToArea));
  dash.setRegions(supported.sort((x, y) => x.name.localeCompare(y.name)), groups, goToArea); // the dashboard's Fly in buttons and the "How it works" list
  return { clearOfPanel };
}

/** The map legend and the coverage note. Called once the zones are on the map. */
export function renderRegionInfo({ index, regions }) {
  const legend = $('legend');
  const meanings = { allow: [zoneFill('allow'), MEANINGS.allow.text], restrict: [zoneFill('restrict'), MEANINGS.restrict.text] }; // the wording is shared with the explanation beside each verdict (legends.js)
  const addLegend = (colour, text, approx = false) => { const row = document.createElement('div'); const sw = document.createElement('i'); sw.style.background = colour; if (approx) sw.className = 'approx'; row.append(sw, text); legend.append(row); };
  for (const r of regions.filter((x) => x.classes)) {
    for (const c of r.classes) addLegend(swatchBackground(c), c.points ? `${c.label}: where flying is allowed (a pin on the map).` : `${c.label}.`, !!c.approximate);
    const p = document.createElement('div'); p.className = 'legend-note'; p.textContent = `${r.name}: ${r.source.authority}, updated ${r.source.effective}. Approximate: not in a zone here does not mean flying is allowed. Check the official map.`; legend.append(p);
  }
  const selected = regions.filter(r => r.sourceConfidence?.mode === 'selected-source');
  const legacy = regions.filter(r => r.sourceConfidence?.mode !== 'selected-source');
  for (const sem of new Set(legacy.filter((r) => !r.classes).map((r) => r.semantics))) {
    const row = document.createElement('div');
    const sw = document.createElement('i');
    sw.style.background = meanings[sem][0];
    row.append(sw, (selected.length ? legacy.filter(r => r.semantics === sem).map(r => r.name).join(', ') + ': ' : '') + meanings[sem][1]);
    legend.append(row);
  }
  if (selected.length) {
    addLegend(zoneFill('allow'), selected.map(r => r.name).join(', ') + ': ' + SELECTED_SOURCE_MEANING);
    const official = legacy.filter(r => !r.classes && r.source?.authority).map(r => `${r.name}: ${r.source.authority} (official)`);
    const third = selectedProviders(regions).map(g => `${g.names.join(', ')}: ${g.authority}, ${snapshotText(g.snapshots)}${g.thirdParty ? ' (third-party reference, not a government release)' : ''}`);
    const p = document.createElement('div'); p.className = 'legend-note'; p.textContent = [...official, ...third].join('. ') + '.'; legend.append(p);
    for (const r of selected.filter(regionNotice)) { const n = document.createElement('div'); n.className = 'legend-note'; n.textContent = regionNotice(r); legend.append(n); }
  }

  const note = $('regions-note');
  note.textContent = '';
  const b = document.createElement('b');
  const pending = index.countries.filter((c) => !c.regions).map((c) => c.name);
  b.textContent = `Coverage: ${regions.map((r) => r.name + (r.sourceConfidence?.mode === 'selected-source' ? ' (mapped polygons only)' : '')).join(', ') || 'none'}.${pending.length ? ` No data yet: ${pending.join(', ')}.` : ''} `;
  const official = [...new Set(legacy.map((r) => `${r.source.authority} (effective ${r.source.effective})`))];
  const third = selectedProviders(regions).map(g => `${g.names.join(', ')}: ${g.authority} (${snapshotText(g.snapshots)}; effective date unknown; current permission unverified)`);
  note.append(b, selected.length ? 'Data sources: ' + [...official.map(o => 'official ' + o), ...third].join('; ') + '.' : 'Official data: ' + official.join('; ') + '.');
  for (const r of selected.filter(regionNotice)) note.append(' ' + regionNotice(r));
}
