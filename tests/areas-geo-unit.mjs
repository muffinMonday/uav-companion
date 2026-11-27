// Community flying areas (src/areas/geo.js): the geographic centre of concave shapes, deterministic overlap resolution, and the setup-spot scale rule
// (500 m on a 140 px scale bar, independent of units). A fake Web-Mercator map stands in for Leaflet. No browser.
import { areaCentre, pickArea, metresAcross, spotsShown, SPOT_SCALE_M } from '../src/areas/geo.js';
import { pointInPolygon, closeRing, geodesicAreaM2 } from '../src/areas/core.js';
import { publicView, cleanAttribution } from '../src/areas/adapter-public.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };

// ---- centre
const sq = closeRing([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]);
const c1 = areaCentre(sq);
ok(Math.abs(c1[0] - 0.005) < 1e-9 && Math.abs(c1[1] - 0.005) < 1e-9, 'a square: its middle');
// a "C": the centroid sits in the notch, outside the shape
const C = closeRing([[0, 0], [0.03, 0], [0.03, 0.01], [0.01, 0.01], [0.01, 0.02], [0.03, 0.02], [0.03, 0.03], [0, 0.03]]);
const c2 = areaCentre(C);
ok(pointInPolygon(c2, C), 'a C-shaped area: the centre is inside the shape, not in its notch');
// a thin "U" whose bounding-box centre is outside
const U = closeRing([[0, 0], [0.03, 0], [0.03, 0.03], [0.02, 0.03], [0.02, 0.005], [0.01, 0.005], [0.01, 0.03], [0, 0.03]]);
const bbox = [0.015, 0.015];
ok(!pointInPolygon(bbox, U) && pointInPolygon(areaCentre(U), U), 'a U-shaped area: the bounding-box centre is outside, the chosen centre is inside');
// an L and a triangle
ok(pointInPolygon(areaCentre(closeRing([[0, 0], [0.04, 0], [0.04, 0.005], [0.005, 0.005], [0.005, 0.04], [0, 0.04]])), closeRing([[0, 0], [0.04, 0], [0.04, 0.005], [0.005, 0.005], [0.005, 0.04], [0, 0.04]])), 'an L-shaped area: the centre is inside');
const tri = closeRing([[10, 50], [10.01, 50], [10.005, 50.01]]);
ok(pointInPolygon(areaCentre(tri), tri), 'a triangle at 50 degrees north');

// ---- overlap
const mk = (id, ring, created) => ({ id, created, areaM2: Math.round(geodesicAreaM2(ring)), geometry: { type: 'Polygon', coordinates: [ring] } });
const big = mk('b', closeRing([[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]]), '2026-01-01T00:00:00Z');
const small = mk('a', closeRing([[0.005, 0.005], [0.01, 0.005], [0.01, 0.01], [0.005, 0.01]]), '2026-02-01T00:00:00Z');
ok(pickArea([big, small], 0.007, 0.007).id === 'a' && pickArea([small, big], 0.007, 0.007).id === 'a', 'overlap: the smallest area wins, whatever the list order');
ok(pickArea([big, small], 0.015, 0.015).id === 'b', 'a tap outside the small area gets the large one');
ok(pickArea([big, small], 0.05, 0.05) === null, 'a tap outside every area gets none');
const twin1 = mk('z', small.geometry.coordinates[0], '2026-03-01T00:00:00Z'), twin2 = mk('y', small.geometry.coordinates[0], '2026-03-01T00:00:00Z');
ok(pickArea([twin1, twin2], 0.007, 0.007).id === 'y' && pickArea([twin2, twin1], 0.007, 0.007).id === 'y', 'identical areas: ties break by id, so the result never depends on order');
ok(pickArea([big, small], 0.007, 0.007).id === 'a' && pickArea([mk('late', small.geometry.coordinates[0], '2026-04-01T00:00:00Z'), mk('early', small.geometry.coordinates[0], '2026-01-01T00:00:00Z')], 0.007, 0.007).id === 'early', 'equal size: the earlier one wins');

// ---- scale rule on a fake Web-Mercator map (256 px tiles, as Leaflet)
const R = 6378137, rad = (d) => (d * Math.PI) / 180;
function fakeMap(lat, zoom) {
  const scale = (z) => 256 * 2 ** z;
  const project = (ll, z = zoom) => ({ x: ((ll.lng + 180) / 360) * scale(z), y: (0.5 - Math.log(Math.tan(Math.PI / 4 + rad(ll.lat) / 2)) / (2 * Math.PI)) * scale(z), add(o) { return { ...this, x: this.x + o[0], y: this.y + o[1] }; } });
  const unproject = (p, z = zoom) => ({ lng: (p.x / scale(z)) * 360 - 180, lat: (2 * Math.atan(Math.exp((0.5 - p.y / scale(z)) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI });
  const dist = (a, b) => { const dl = rad(b.lat - a.lat), dg = rad(b.lng - a.lng), h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(h)); };
  return { getCenter: () => ({ lat, lng: 103.8 }), getZoom: () => zoom, project, unproject, distance: dist };
}
const at = (lat, z) => metresAcross(fakeMap(lat, z));
ok(SPOT_SCALE_M === 500, 'the threshold is 500 m');
ok(Math.abs(at(1.3, 16) - 334) < 5, `at zoom 16 near the equator the 140 px bar spans about 334 m (${at(1.3, 16).toFixed(0)})`);
ok(spotsShown(fakeMap(1.3, 16)), 'about 300 m: spots shown');
ok(!spotsShown(fakeMap(1.3, 14)) && !spotsShown(fakeMap(1.3, 15)), 'about 670 m and beyond: spots hidden');
// the boundary: the same latitude, a zoom between 15 and 16 (fractional zoom): shown at or below 500 m, hidden above
const zAt500 = (() => { let lo = 15, hi = 16; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (at(1.3, m) > 500) lo = m; else hi = m; } return hi; })();
ok(spotsShown(fakeMap(1.3, zAt500 + 0.001)) && !spotsShown(fakeMap(1.3, zAt500 - 0.001)), `the switch is at the 500 m scale (zoom ${zAt500.toFixed(3)} at 1.3 degrees)`);
// the ground resolution follows latitude: no fixed zoom number means 500 m everywhere
const z = 15.2;
ok(spotsShown(fakeMap(60, z)) && !spotsShown(fakeMap(0, z)), 'zoom 15.2 shows spots at 60 degrees north (shorter ground distance) but not at the equator');
ok(Math.abs(at(60, 16) / at(0, 16) - 0.5) < 0.01, 'a pixel is half as long on the ground at 60 degrees as at the equator');
// no unit input: the rule reads nothing from the display preference
ok(spotsShown.length === 1 && metresAcross.length <= 2, 'the rule takes the map only; metric or imperial display cannot change it');

// ---- public adapter: only approved, published, valid records; attribution only when the server says so
const ID = '3f1b9c0e-6a52-4d3b-9a3e-0c7d2b1a5e11';
const pub = (o = {}) => ({ area_id: ID, status: 'approved', published: true, name: 'Marina field', description: '<b>x</b> open space', geometry: { type: 'Polygon', coordinates: [sq] }, spots: [], approved_at: '2026-11-20T10:00:00Z', attribution: null, ...o });
const v0 = publicView(pub());
ok(v0 && v0.context === 'public-approved' && v0.actions.length === 0 && v0.byline.text === 'Community contributor', 'an approved record: public context, no management actions, neutral contributor');
ok(v0.area.description === '<b>x</b> open space', 'a description stays plain text (rendered with textContent by details.js)');
for (const st of ['pending', 'rejected', 'withdrawn', 'draft']) ok(publicView(pub({ status: st })) === null, `a ${st} record is never shown as public`);
ok(publicView(pub({ published: false })) === null && publicView(pub({ published: undefined })) === null, 'an approved but unpublished record is not shown');
ok(publicView(pub({ area_id: 'nope' })) === null && publicView(pub({ geometry: { type: 'Point', coordinates: [0, 0] } })) === null, 'a malformed record is rejected');
const named = publicView(pub({ attribution: { display_name: 'Mei', avatar: 'fox', bio: 'secret', location: 'Wuhan', friend_code: 'ABC', xp: 99, online: true, user_id: 'u1' } }));
ok(named.byline.profileRow && Object.keys(named.byline.profileRow).sort().join() === 'avatar,display_name', 'attribution keeps only display_name and avatar (no bio, location, friend code, XP, online, user id)');
ok(cleanAttribution({ display_name: '  ' }) === null && cleanAttribution('x') === null && publicView(pub({ attribution: { avatar: 'fox' } })).byline.text === 'Community contributor', 'no name, no attribution: neutral label');
ok(publicView(pub({ attribution: { display_name: 'Mei', avatar: 'not-a-preset' } })).byline.profileRow.avatar === null, 'an avatar that is not a preset is dropped');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
