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
