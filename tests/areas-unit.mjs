// Community flying areas (src/areas/core.js): vertex limits, geodesic area, self-intersection, antimeridian, rectangles, text limits, setup spots. No browser.
import * as C from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const codes = (r) => r.errors.map((e) => e.code);
// a 0.01 degree square near Singapore: about 1.2 km2
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const circle = (n, r = 0.005) => Array.from({ length: n }, (_, i) => [103.8 + r * Math.cos(2 * Math.PI * i / n), 1.3 + r * Math.sin(2 * Math.PI * i / n)]);

// vertex counts
ok(C.validateVertices(sq().slice(0, 3)).ok, '3 vertices are valid');
ok(codes(C.validateVertices(sq().slice(0, 2))).includes('vertex-count'), '2 vertices are rejected');
ok(C.validateVertices(circle(100)).ok, '100 vertices are valid');
ok(codes(C.validateVertices(circle(101))).includes('vertex-count'), '101 vertices are rejected');
ok(C.validateVertices([...sq(), sq()[0]]).ok && C.validateVertices([...sq(), sq()[0]]).vertices.length === 4, 'a closed ring is accepted and its repeat is not counted');
ok(codes(C.validateVertices([sq()[0], sq()[1], sq()[2], sq()[1]])).includes('duplicate-vertex'), 'a repeated vertex is rejected');
ok(codes(C.validateVertices('x')).includes('not-array') && codes(C.validateVertices(null)).includes('not-array'), 'a non-list is rejected');

// coordinates
for (const [label, bad] of [['latitude 91', [103.8, 91]], ['longitude 181', [181, 1.3]], ['NaN', [NaN, 1]], ['Infinity', [Infinity, 1]], ['string', ['1', '2']], ['short', [1]], ['null', null]]) {
  const r = C.validateVertices([...sq().slice(0, 3), bad]);
  ok(!r.ok && codes(r).includes('bad-coordinate'), `invalid coordinate rejected: ${label}`);
}
ok(C.validateVertices([[0, 0], [0.01, 0], [0.01, 0.01, 55]]).ok, 'a third element (altitude) is dropped, not an error');
ok(C.cleanPosition([1.123456789, 2.987654321]).join() === '1.1234568,2.9876543', 'positions are rounded to 7 decimals');

// geodesic area
{
  const a = C.geodesicAreaM2(sq(103.8, 1.3, 0.01)); // the spherical model: 0.01 deg of arc is 1111.95 m
  ok(Math.abs(a - 1111.95 * 1111.95 * Math.cos(1.305 * Math.PI / 180)) / a < 0.005, `0.01 degree square near the equator is about 1.24 km2 (${(a / 1e6).toFixed(3)})`);
  const hi = C.geodesicAreaM2(sq(10, 60, 0.01)); // at 60 N a degree of longitude is half as long
  ok(Math.abs(hi / a - 0.5) < 0.01, 'area shrinks with latitude (cos 60 = 0.5)');
  ok(C.geodesicAreaM2(sq().reverse()) === C.geodesicAreaM2(sq()), 'area does not depend on winding');
  ok(C.geodesicAreaM2([...sq(), sq()[0]]) === C.geodesicAreaM2(sq()), 'area is the same for a closed ring');
  ok(C.geodesicAreaM2([[0, 0], [1, 1]]) === 0, 'fewer than 3 points have no area');
}
// 25 km2 limit: a square of side 5 km is the limit
{
  const side = (km) => km / 111.195; // degrees of arc for km
  const at = C.validateVertices(sq(0, 0, side(4.99)));
  ok(at.ok && at.areaM2 < 25e6, `just under 25 km2 is valid (${(at.areaM2 / 1e6).toFixed(2)})`);
  const over = C.validateVertices(sq(0, 0, side(5.02)));
  ok(!over.ok && codes(over).includes('too-large') && /km²/.test(over.errors[0].message), `just over 25 km2 is rejected (${(over.areaM2 / 1e6).toFixed(2)})`);
  ok(codes(C.validateVertices(sq(0, 0, 1))).includes('too-large'), 'a one degree square is far too large');
}

// self-intersection and degenerate shapes
ok(codes(C.validateVertices([[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01]])).includes('self-intersection'), 'a bow-tie crosses itself');
ok(C.validateVertices([[0, 0], [0.02, 0], [0.02, 0.02], [0.01, 0.005], [0, 0.02]]).ok, 'a concave (arrow-head) polygon is valid');
ok(codes(C.validateVertices([[0, 0], [0.02, 0], [0.02, 0.02], [0.01, 0], [0, 0.02]])).includes('self-intersection'), 'a vertex touching another edge is rejected');
ok(!C.validateVertices([[0, 0], [0.01, 0.01], [0.02, 0.02]]).ok, 'three collinear points have no area');
ok(codes(C.validateVertices([[0, 0], [0, 0.0000001], [0.0000001, 0]])).includes('degenerate'), 'a sliver under 1 m2 is degenerate');
ok(!C.validateVertices([[0, 0], [0.02, 0], [0.01, 0]]).ok, 'three collinear points on a line (spike) are rejected');
ok(codes(C.validateVertices([[0, 0], [0.02, 0], [0.01, 0], [0.01, 0.01]])).includes('self-intersection'), 'an edge doubling back on itself is rejected');
ok(C.validateVertices([[0, 0], [0.01, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]]).ok, 'a collinear middle vertex on a side is fine');

// antimeridian
ok(codes(C.validateVertices([[179.99, 0], [-179.99, 0], [-179.99, 0.01], [179.99, 0.01]])).includes('antimeridian'), 'a polygon crossing the 180th meridian is rejected');
ok(C.validateVertices([[179.98, 0], [180, 0], [180, 0.01], [179.98, 0.01]]).ok, 'a polygon ending at exactly 180 is valid');
ok(C.validateVertices([[-179.98, 0], [-180, 0], [-180, 0.01], [-179.98, 0.01]]).ok, 'a polygon ending at exactly -180 is valid');

// rectangles
{
  const r = C.rectangleFromCorners([103.81, 1.31], [103.8, 1.3]);
  ok(JSON.stringify(r) === JSON.stringify([[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.31]]), 'opposite corners in any order give SW, SE, NE, NW');
  ok(C.validateVertices(r).ok, 'a rectangle is a valid polygon');
  ok(JSON.stringify(C.rectangleFromCorners([103.8, 1.3], [103.81, 1.31])) === JSON.stringify(r), 'corner order does not matter');
  ok(codes(C.validateVertices(C.rectangleFromCorners([103.8, 1.3], [103.8, 1.31]))).some((c) => c === 'duplicate-vertex' || c === 'degenerate'), 'a zero-width rectangle is degenerate');
}

// ring orientation
{
  const ring = C.closeRing(sq().reverse());
  const sum = ring.slice(0, -1).reduce((s, a, i) => { const b = ring[i + 1]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  ok(sum > 0 && ring.length === 5 && JSON.stringify(ring[0]) === JSON.stringify(ring[4]), 'closeRing gives a closed counter-clockwise ring');
}

// point in polygon (boundary included)
{
  const v = sq(0, 0, 0.01);
  ok(C.pointInPolygon([0.005, 0.005], v), 'inside');
  ok(!C.pointInPolygon([0.02, 0.005], v) && !C.pointInPolygon([0.005, -0.001], v), 'outside');
  ok(C.pointInPolygon([0.005, 0], v) && C.pointInPolygon([0, 0.005], v), 'on an edge counts as inside');
  ok(C.pointInPolygon([0, 0], v) && C.pointInPolygon([0.01, 0.01], v), 'on a vertex counts as inside');
  const Lshape = [[0, 0], [0.02, 0], [0.02, 0.01], [0.01, 0.01], [0.01, 0.02], [0, 0.02]];
  ok(C.pointInPolygon([0.005, 0.015], Lshape) && !C.pointInPolygon([0.015, 0.015], Lshape), 'a concave notch is outside');
  ok(C.pointInPolygon([0.005, 0.005], C.closeRing(v)), 'works on a closed ring');
}

// text
ok(C.cleanText('  Tampines   Park ', { max: 80, required: true }).value === 'Tampines Park', 'a name is trimmed and spaces collapsed');
ok(!C.cleanText('   ', { max: 80, required: true }).ok, 'a blank name is rejected');
ok(C.cleanText('x'.repeat(80), { max: 80, required: true }).ok && !C.cleanText('x'.repeat(81), { max: 80 }).ok, 'name limit is 80');
ok(C.cleanText('😀'.repeat(80), { max: 80 }).ok, 'an emoji counts as one character');
ok(C.cleanText('a'.repeat(500), { max: 500, multiline: true }).ok && !C.cleanText('a'.repeat(501), { max: 500, multiline: true }).ok, 'description limit is 500');
ok(C.cleanText('line1\r\nline2', { max: 500, multiline: true }).value === 'line1\nline2', 'a description keeps line breaks');
ok(C.cleanText('a\nb\u0000c', { max: 80 }).value === 'a b c', 'a name has no line breaks or control characters');
ok(!C.cleanText(42, { max: 80 }).ok, 'non-text is rejected');

// setup spots
{
  const ring = sq(0, 0, 0.01);
  const spot = (x = 0.005, y = 0.005, type = 'shelter', note = '') => ({ type, note, coordinates: [x, y] });
  ok(C.validateSpots([], ring).ok && C.validateSpots(undefined, ring).ok, 'zero spots is valid');
  ok(C.validateSpots(Array.from({ length: 10 }, () => spot()), ring).ok, '10 spots are valid');
  ok(codes(C.validateSpots(Array.from({ length: 11 }, () => spot()), ring)).includes('too-many-spots'), '11 spots are rejected');
  ok(codes(C.validateSpots([spot(0.02, 0.005)], ring)).includes('spot-outside'), 'a spot outside the area is rejected');
  ok(C.validateSpots([spot(0, 0.005), spot(0.01, 0.01)], ring).ok, 'spots on the boundary and on a vertex are accepted');
  ok(codes(C.validateSpots([spot(0.005, 0.005, 'toilet')], ring)).includes('bad-spot-type'), 'an unknown type is rejected');
  for (const t of C.SPOT_TYPES) ok(C.validateSpots([spot(0.005, 0.005, t)], ring).ok, `type ${t} is accepted`);
  ok(C.SPOT_TYPES.length === 4, 'exactly four types');
  ok(C.validateSpots([spot(0.005, 0.005, 'other', 'x'.repeat(120))], ring).ok && !C.validateSpots([spot(0.005, 0.005, 'other', 'x'.repeat(121))], ring).ok, 'spot note limit is 120');
  ok(codes(C.validateSpots([{ type: 'open', coordinates: [500, 5] }], ring)).includes('bad-coordinate'), 'a spot with a bad coordinate is rejected');
  ok(codes(C.validateSpots('x', ring)).includes('spots-not-array') && codes(C.validateSpots([null], ring)).includes('bad-spot'), 'malformed spot lists are rejected');
  ok(C.validateSpots([{ type: 'open', coordinates: [0.005, 0.005], id: '<b>' }], ring).spots[0].id === undefined, 'an unsafe spot id is dropped');
}

// whole record
{
  const good = { name: 'Park', description: 'Open grass', drawKind: 'rectangle', geometry: { type: 'Polygon', coordinates: [C.closeRing(sq())] }, spots: [{ type: 'seating', note: 'tables', coordinates: [103.805, 1.305] }] };
  const r = C.validateArea(good);
  ok(r.ok && r.area.drawKind === 'rectangle' && r.area.areaM2 > 1e6, 'a good record validates');
  ok(!C.validateArea({ ...good, name: '' }).ok, 'a record needs a name');
  ok(!C.validateArea({ ...good, geometry: { type: 'MultiPolygon', coordinates: [] } }).ok, 'only Polygon geometry');
  ok(codes(C.validateArea({ ...good, geometry: { type: 'Polygon', coordinates: [C.closeRing(sq()), C.closeRing(sq(103.802, 1.302, 0.002))] } })).includes('holes'), 'holes are rejected');
  ok(!C.validateArea({ ...good, spots: [{ type: 'open', coordinates: [110, 1] }] }).ok, 'an out-of-area spot fails the whole record');
  ok(C.validateArea({ ...good, drawKind: 'weird' }).area.drawKind === 'polygon', 'an unknown drawKind falls back to polygon');
  ok(!C.validateArea(null).ok && !C.validateArea('x').ok, 'a non-object is rejected');
  ok(JSON.stringify(C.validateArea({ ...good, geometry: { type: 'Polygon', coordinates: [sq().reverse()] } }).area.geometry.coordinates[0]) === JSON.stringify(C.closeRing(sq())), 'a clockwise ring is stored counter-clockwise and closed');
}
ok(C.formatArea(500) === '500 m²' && C.formatArea(1.5e6) === '1.50 km²' && C.formatArea(2.5e7) === '25.0 km²', 'area text');
ok(C.bboxOf(C.closeRing(sq())).join() === '103.8,1.3,103.81,1.31', 'bounding box');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
