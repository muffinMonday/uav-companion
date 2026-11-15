// The plain side of the session map preview (src/sessions-preview-model.js): tile maths, URLs, wrapping, clamping, credit text. No browser.
import { tileXY, tileUrl, tileGrid, creditText, PREVIEW_ZOOM, TILE } from '../src/sessions-preview-model.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const OSM = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }];
const HOT = ['https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { subdomains: 'abc' }];

let t = tileXY(0, 0, 1);
ok(Math.abs(t.x - 1) < 1e-9 && Math.abs(t.y - 1) < 1e-9, 'the equator and the meridian are the centre of the world at zoom 1');
t = tileXY(85.0511, -180, 2); ok(Math.abs(t.x) < 1e-9 && t.y >= 0 && t.y < 0.001, 'the north-west corner of the map');
ok(tileUrl('https://x/{z}/{x}/{y}', undefined, 3, 4, 5) === 'https://x/3/4/5' && tileUrl('https://{s}.x/{z}', 'bc', 3, 1, 1) === 'https://b.x/3' && tileUrl(5, 'a', 1, 1, 1) === null, 'tile URLs: subdomain, template check');

for (const [lat, lng, name] of [[30.55, 114.37, 'Wuhan'], [1.3521, 103.8198, 'Singapore'], [-33.87, 151.21, 'Sydney'], [0, 0, 'null island']]) {
  const g = tileGrid(lat, lng, OSM);
  const c = tileXY(lat, lng, PREVIEW_ZOOM);
  ok(g && g.tiles.length === 4 && g.size === 2 * TILE && g.pin.x >= TILE / 2 && g.pin.x <= TILE * 1.5 && g.pin.y >= TILE / 2 && g.pin.y <= TILE * 1.5, name + ': four tiles, the pin sits in the middle half of the grid');
  const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(g.tiles[0].url);
  ok(+m[1] === PREVIEW_ZOOM && +m[2] + g.pin.x / TILE - c.x < 1e-6 && Math.abs(+m[2] + g.pin.x / TILE - c.x) < 1e-6 && Math.abs(+m[3] + g.pin.y / TILE - c.y) < 1e-6, name + ': the first tile and the pin add up to the point');
  ok(g.tiles.map((x) => x.left + ',' + x.top).join('|') === '0,0|256,0|0,256|256,256', name + ': tile offsets');
}
let g = tileGrid(10, 179.99999, OSM);
ok(g.tiles[1].url.endsWith('/0/' + /\/(\d+)\.png$/.exec(g.tiles[0].url)[1] + '.png') && /\/32767\//.test(g.tiles[0].url), 'longitude wraps at the antimeridian');
g = tileGrid(10, -179.99999, OSM);
ok(/\/0\//.test(g.tiles[1].url) || /\/32767\//.test(g.tiles[0].url), 'and on the west side');
g = tileGrid(89.9, 0, OSM); const ys = g.tiles.map((x) => +/\/(\d+)\.png$/.exec(x.url)[1]);
ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 2 ** PREVIEW_ZOOM - 1, 'a point near the pole stays inside the tile range');
g = tileGrid(-89.9, 0, OSM); const ys2 = g.tiles.map((x) => +/\/(\d+)\.png$/.exec(x.url)[1]);
ok(Math.max(...ys2) <= 2 ** PREVIEW_ZOOM - 1, 'and at the south pole');
for (const bad of [[NaN, 0], [0, NaN], [91, 0], [0, 181], [null, 0], [undefined, 1], ['1', 1]]) ok(tileGrid(bad[0], bad[1], OSM) === null, 'refused: ' + String(bad));
ok(tileGrid(1, 1, [5, {}]) === null, 'a bad template is refused');
ok(/^https:\/\/[abc]\.tile\.openstreetmap\.fr\/hot\//.test(tileGrid(1, 1, HOT).tiles[0].url), 'a subdomain basemap works');
ok(creditText('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors') === '© OpenStreetMap contributors', 'credit text drops the markup');
ok(creditText('') === '© OpenStreetMap contributors' && creditText(null) === '© OpenStreetMap contributors' && !/[<>]/.test(creditText('a <b>b</b> &amp; c')), 'credit text has a safe default and no markup');
