// How a class of zone is painted. A verified class is a flat fill in its colour. An APPROXIMATE class (a boundary reconstructed from a described coastline or border, never an
// official polygon) keeps its P/R/D colour as diagonal stripes with an outline in the uncertainty colour (--zone-approx-line: purple, lighter in the dark theme), so it reads
// as "maybe" and never as the solid, exact boundary or as green (green means flyable). The decision is a pure function so the map, the key and the tests share it.

/** { kind: 'solid', fill } for a verified class; { kind: 'hatch', stripe, outline } for an approximate one. `outline` is the resolved --zone-approx-line. */
export const zonePaintSpec = (c, outline = '#6a1b9a') => (c?.approximate ? { kind: 'hatch', stripe: c.color, outline } : { kind: 'solid', fill: c.color });

/** The CSS --zone-approx-line for the current theme (the stylesheet redefines it for the dark theme). */
export const approxOutline = () => (typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--zone-approx-line').trim() : '') || '#6a1b9a';

/** An 8 px tile of diagonal stripes for a canvas fill pattern. */
export function hatchTile(stripe) {
  const t = document.createElement('canvas'); t.width = t.height = 8;
  const g = t.getContext('2d'); g.strokeStyle = stripe; g.lineWidth = 2.4; g.beginPath();
  for (const [x0, y0, x1, y1] of [[-2, 10, 10, -2], [-2, 2, 2, -2], [6, 10, 10, 6]]) { g.moveTo(x0, y0); g.lineTo(x1, y1); }
  g.stroke();
  return t;
}

/** CSS background for a swatch (the key, the zone list): stripes for an approximate class, the flat colour otherwise. */
export const swatchBackground = (c) => (c?.approximate ? `repeating-linear-gradient(45deg, ${c.color} 0 2px, transparent 2px 5px)` : c?.color ?? '#999');
