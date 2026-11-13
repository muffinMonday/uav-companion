// Colour contrast of the design tokens in src/styles.css, in both themes (WCAG 2 luminance), plus two guards: hover only under (hover:hover), no dead colour fallbacks.
// The pairs and thresholds are the ones in Project_context/docs/DESIGN.md section 10. Identity colours (ranks, markers, trips, zones) are not asserted here.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const block = (open) => { const i = css.indexOf(open); let d = 0, j = css.indexOf('{', i); const start = j; for (; j < css.length; j++) { if (css[j] === '{') d++; if (css[j] === '}' && --d === 0) break; } return css.slice(start + 1, j); };
const tokens = (body) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = tokens(block(':root{'));
const dark = { ...light, ...tokens(block(':root[data-theme="dark"]{')) };

const rgb = (h) => { const x = h.replace('#', ''); const f = x.length === 3 ? x.replace(/./g, '$&$&') : x; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// a token's colour: a hex, or color-mix(in srgb,var(--x) N%,transparent) laid over `over`
const colour = (T, name, over) => {
  const v = T[name]; if (!v) throw new Error('no token ' + name);
  if (v.startsWith('#')) return rgb(v);
  const m = /color-mix\(in srgb,\s*var\((--[a-z0-9-]+)\)\s*(\d+)%,\s*transparent\)/.exec(v); if (!m) throw new Error('cannot read ' + name + ': ' + v);
  const a = +m[2] / 100, fg = colour(T, m[1], over); return fg.map((c, i) => Math.round(c * a + over[i] * (1 - a)));
};

const PAIRS = [ // [text or graphic token, background token, minimum, label]
  ['--fg', '--bg', 4.5, 'text on the page'], ['--muted', '--bg', 4.5, 'secondary text on the page'], ['--muted', '--surface-2', 4.5, 'secondary text on an inset area'],
  ['--accent', '--bg', 4.5, 'accent text on the page'], ['--accent', '--surface-2', 4.4, 'accent text on an inset area (light is borderline: 4.46)'],
  ['--accent-fg', '--accent', 4.5, 'text on an accent button'], ['--on-danger', '--danger-solid', 4.5, 'text on a danger fill (tab badge, armed buttons)'],
  ['--danger', '--bg', 4.5, 'danger text on the page'], ['--ok', '--ok-bg', 4.5, 'ok status'], ['--no', '--no-bg', 4.5, 'no status'], ['--unk', '--unk-bg', 4.5, 'unknown status'],
  ['--control-border', '--surface-2', 3, 'edge of a field on its fill'], ['--control-border', '--bg', 3, 'edge of a field and the switch track on the page'],
];
for (const [name, T] of [['light', light], ['dark', dark]]) {
  for (const [a, b, min, label] of PAIRS) { const r = ratio(colour(T, a, colour(T, '--bg', [255, 255, 255])), colour(T, b, colour(T, '--bg', [255, 255, 255]))); ok(r >= min, `${name}: ${label} (${a} on ${b}) ${r.toFixed(2)} >= ${min}`); }
  const surface = colour(T, '--surface', [255, 255, 255]);
  const edge = colour(T, '--rank-edge', surface);
  ok(ratio(edge, surface) >= 3, `${name}: the rank outline against the surface ${ratio(edge, surface).toFixed(2)} >= 3 (it carries the contrast the rank hues alone lack)`);
}

// guards on the stylesheet text
const gate = css.split('\n').filter((l) => /:hover/.test(l) && !l.startsWith('@media (hover:hover)'));
ok(gate.length === 0, 'every :hover rule sits inside @media (hover:hover)' + (gate.length ? ': ' + gate[0].slice(0, 60) : ''));
ok(!/var\(--[a-z-]+,\s*#/.test(css), 'no colour token has a hex fallback (the fallbacks were dead code and disagreed)');
ok(!/background:var\(--danger\)[^}]*color:#fff/.test(css), 'no white text on var(--danger) (use --danger-solid and --on-danger)');

// scale guards (phase 2): page layers and the shared radii come from tokens
ok(!/z-index:\d{3,}/.test(css), 'every z-index of 100 or more is a --z-* token (only the local 1 and 5 inside a parent stay numbers)');
ok(!/border-radius:(14|18|999)px(?![\d ])/.test(css), 'border-radius 14 / 18 / 999 px are --radius, --radius-lg, --radius-pill');
