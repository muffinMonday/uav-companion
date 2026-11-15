import { zoneFill } from '../map.js';
import { MEANINGS, SELECTED_SOURCE_MEANING, selectedProviders, snapshotText } from '../legends.js';
import { savePrefs } from '../prefs.js';
import { regionLabel } from './region-labels.js';

const $ = (id) => document.getElementById(id);

/**
 * Country shortcut (re-centres on a country's view box, whether or not it has zone data yet) and the dashboard's Fly in choices (one per region archive).
 * Returns { clearOfPanel }: fit options that keep what is fitted clear of a docked side panel (phones use a bottom sheet that is closed while viewing).
 */
export function initRegionUI({ map, panel, dash, prefs, index, regions, toast }) {
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
  // Fly in: one region archive. Only the archives that the new view touches are loaded (createZones.sync on moveend).
  const areas = regions.filter((r) => r.bounds).map((r) => ({ id: r.id, label: regionLabel(r), bounds: r.bounds })).sort((a, b) => a.label.localeCompare(b.label));
  const goToArea = (id) => {
    const a = areas.find((x) => x.id === id);
    if (a) map.fitBounds([[a.bounds[1], a.bounds[0]], [a.bounds[3], a.bounds[2]]], clearOfPanel());
  };
  // The choice stays shown in the menu and is remembered. Choosing it again after panning away: use the Centre button.
  countrySel.addEventListener('change', () => { savePrefs({ country: countrySel.value || null }); goToCountry(countrySel.value); });
  $('country-go').addEventListener('click', () => {
    if (!countrySel.value) { toast('Choose a country first.', 3000); return; }
    goToCountry(countrySel.value);
  });
  dash.setRegions(index.countries.filter((c) => c.regions && c.view).sort((x, y) => x.name.localeCompare(y.name)), goToCountry, areas, goToArea); // the dashboard's Fly in choices and the country menu's targets
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
  }

  const note = $('regions-note');
  note.textContent = '';
  const b = document.createElement('b');
  const pending = index.countries.filter((c) => !c.regions).map((c) => c.name);
  b.textContent = `Coverage: ${regions.map((r) => r.name + (r.sourceConfidence?.mode === 'selected-source' ? ' (mapped polygons only)' : '')).join(', ') || 'none'}.${pending.length ? ` No data yet: ${pending.join(', ')}.` : ''} `;
  const official = [...new Set(legacy.map((r) => `${r.source.authority} (effective ${r.source.effective})`))];
  const third = selectedProviders(regions).map(g => `${g.names.join(', ')}: ${g.authority} (${snapshotText(g.snapshots)}; effective date unknown; current permission unverified)`);
  note.append(b, selected.length ? 'Data sources: ' + [...official.map(o => 'official ' + o), ...third].join('; ') + '.' : 'Official data: ' + official.join('; ') + '.');
}
