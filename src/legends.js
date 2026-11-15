// Contextual explanations of what a zone verdict means, shown beside the verdict itself (point-check and marker windows) as a folded "What does this mean?".
// The verdict, its detail line and the disclaimer stay where they are, always visible: this only adds the symbols and the semantics of the region the point is in.
// Region semantics are never mixed: `allow` regions (China suitable-flight grids) and `restrict` regions (Singapore) mean opposite things for a coloured area, and a point
// outside the data's coverage says nothing at all. The wording for the two meanings lives here and is also what the map key in Help uses (app/region-ui.js).
import { el } from './cards.js';

/** The two meanings of a coloured zone. `colour` is the CSS variable the map and the key both draw from (styles.css), so the swatch and the map cannot drift apart. */
export const MEANINGS = {
  allow: { colour: '--zone', text: 'Teal: suitable-flight airspace (flying permitted within the stated height); everything else is controlled.' },
  restrict: { colour: '--zone-restrict', text: 'Red: restricted area. Elsewhere there is no restriction in this data, which is not the same as permission to fly.' },
};
export const SELECTED_SOURCE_MEANING = 'Teal: suitable-flight polygons in the selected source. Gaps and areas outside these polygons have unknown coverage; current flight permission is unverified. Check UOM before flying.';

const day = (iso) => iso?.slice(0, 10) || null;
const isThirdParty = (r) => r.sourceConfidence?.type === 'third-party-uom-snapshot';
/** Selected-source regions grouped by provider, for the map legend and coverage note: [{ authority, names, snapshots (sorted dates), thirdParty }]. */
export function selectedProviders(regions) {
  const groups = new Map();
  for (const r of regions) {
    if (r.sourceConfidence?.mode !== 'selected-source') continue;
    const g = groups.get(r.source.authority) ?? { authority: r.source.authority, names: [], snapshots: new Set(), thirdParty: isThirdParty(r) };
    g.names.push(r.name); if (day(r.source.snapshotAt)) g.snapshots.add(day(r.source.snapshotAt));
    groups.set(r.source.authority, g);
  }
  return [...groups.values()].map((g) => ({ ...g, snapshots: [...g.snapshots].sort() }));
}
/** "snapshot 2026-09-22", "snapshots 2026-09-22 to 2026-09-23" or "snapshot date unknown". */
export const snapshotText = (dates) => !dates.length ? 'snapshot date unknown' : dates.length === 1 ? `snapshot ${dates[0]}` : `snapshots ${dates[0]} to ${dates[dates.length - 1]}`;

const swatch = (colour) => { const i = el('i', 'mean-swatch'); i.style.background = colour; i.setAttribute('aria-hidden', 'true'); return i; };
const row = (colour, text) => { const r = el('div', 'mean-row'); r.append(swatch(colour), el('span', '', text)); return r; };

/** The folded explanation for a check result ({ status, region, zones }), or null when there is nothing region-specific to add. */
export function zoneExplanation(res) {
  const box = el('details', 'zone-meaning');
  box.append(el('summary', '', 'What does this mean?'));
  const body = el('div', 'mean-body');
  box.append(body);
  if (!res || res.status === 'nodata' || !res.region) {
    body.append(el('p', '', 'No zone data covers this spot, so the map says nothing about it. Unknown is not permission: check the official platform for the place you are flying before every flight.'));
    return box;
  }
  const r = res.region, m = MEANINGS[r.semantics];
  if (r.sourceConfidence?.mode === 'selected-source') {
    body.append(row('var(--zone)', SELECTED_SOURCE_MEANING));
    body.append(el('p', '', `${r.name} data: ${r.source.authority}${isThirdParty(r) ? ' (a third-party reference snapshot, not a government-published release)' : ''}; ${snapshotText(day(r.source.snapshotAt) ? [day(r.source.snapshotAt)] : [])}; effective date ${r.source.effective || 'unknown'}.`));
    body.append(el('p', '', 'Only the captured polygons are mapped. A spot outside them is unknown: that is neither restricted nor permitted airspace. Coordinate alignment, completeness and currency are unverified, and temporary restrictions may be missing. Verify current official UOM information (uom.caac.gov.cn) before flying.'));
    return box;
  }
  if (r.classes) { // named classes (Singapore): one row per kind of zone, with the colour it has on the map
    body.append(el('p', '', 'Red areas on the map are no-fly zones of the kinds below. Not being inside one does not mean flying is allowed.'));
    for (const c of r.classes) body.append(row(c.color, c.points ? `${c.label}: where flying is allowed (a pin on the map).` : `${c.label}${c.summary ? ': ' + c.summary : '.'}`));
  } else if (m) body.append(row(`var(${m.colour})`, m.text));
  body.append(el('p', '', res.status === 'outside'
    ? `This spot is inside the ${r.name} data's coverage but not inside a zone. Outside the coverage, or near its edge, the data says nothing.`
    : `Zones shown here come from the ${r.name} data (${r.source.authority}, effective ${r.source.effective}). Outside its coverage the data says nothing.`));
  body.append(el('p', 'hint', 'Approximate and for planning only. Official source: ' + (r.officialMap?.label ?? r.source.authority) + '.'));
  return box;
}
