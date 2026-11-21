// The free area of the map (src/free-area.js): rectangle cutting, centre, rotation and the pan. A fake map and fake overlays; no browser.
import { cut, freeRect, freeCentre, unrotate, createFreeArea, dockMode } from '../src/free-area.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const MAP = R(0, 0, 1000, 600);

// cut: a tall bar trims a side, a wide bar trims top or bottom, a small or distant one changes nothing
let r = cut(MAP, R(0, 0, 360, 600)); ok(r.left === 360 && r.right === 1000 && r.top === 0 && r.bottom === 600, 'left dock trims the left edge');
r = cut(MAP, R(700, 0, 1000, 600)); ok(r.right === 700 && r.left === 0, 'right panel trims the right edge');
r = cut(MAP, R(0, 400, 1000, 600)); ok(r.bottom === 400 && r.top === 0, 'bottom sheet trims the bottom edge');
r = cut(MAP, R(0, 0, 1000, 80)); ok(r.top === 80 && r.bottom === 600, 'top bar trims the top edge');
r = cut(MAP, R(100, 100, 200, 200)); ok(r.left === 0 && r.right === 1000 && r.top === 0 && r.bottom === 600, 'a small overlay in the middle changes nothing');
r = cut(MAP, R(1200, 0, 1400, 600)); ok(r === MAP, 'an overlay outside the map changes nothing');
r = cut(MAP, R(0, 0, 0, 600)); ok(r === MAP, 'a zero-width overlay changes nothing');

// freeRect and freeCentre: side dock plus right panel; the container offset is kept
r = freeRect(R(50, 20, 1050, 620), [R(50, 20, 410, 620), R(800, 20, 1050, 620)]);
ok(r.left === 410 && r.right === 800 && r.top === 20 && r.bottom === 620, 'dock and panel both trim; the container offset is kept');
let c = freeCentre(r, R(50, 20, 1050, 620)); ok(near(c.x, 605 - 50) && near(c.y, 300), 'centre of the free area, in container pixels');
r = freeRect(MAP, []); ok(r.left === 0 && r.right === 1000 && r.bottom === 600, 'no cover leaves the whole map');
ok(freeRect(MAP, [R(0, 0, 360, 600)]) !== MAP && MAP.left === 0 && MAP.right === 1000, 'the container rectangle is not mutated');

// unrotate
let u = unrotate({ x: 10, y: 0 }, 0); ok(near(u.x, 10) && near(u.y, 0), 'no bearing: offset unchanged');
u = unrotate({ x: 10, y: 0 }, Math.PI / 2); ok(near(u.x, 0) && near(u.y, 10), 'bearing 90 degrees turns the offset a quarter turn');
u = unrotate({ x: 10, y: 5 }, Math.PI); ok(near(u.x, -10) && near(u.y, -5), 'bearing 180 degrees reverses the offset');

// createFreeArea on a fake map (the real projection, so the pan can be read back)
const calls = [];
// spherical Mercator, 256 px tiles (what Leaflet's default CRS does)
const merc = (ll, z) => { const [lat, lng] = Array.isArray(ll) ? ll : [ll.lat, ll.lng], sc = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180); return { x: (lng + 180) / 360 * sc, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * sc }; };
const unmerc = (p, z) => { const sc = 256 * 2 ** z; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * p.y / sc))) * 180 / Math.PI, p.x / sc * 360 - 180]; };
const fake = {
  _rot: { bearing: () => 0 },
  getContainer: () => ({ getBoundingClientRect: () => MAP }),
  getSize: () => ({ x: 1000, y: 600 }),
  getZoom: () => 12,
  project: (ll, z) => merc(ll, z),
  unproject: (p, z) => unmerc(p, z),
  setView: (ll, z, o) => calls.push({ ll, z, o }),
};
const el = (rect, hidden = false) => ({ hidden, getBoundingClientRect: () => rect });
const pxOffset = (ll, z, target) => { const a = fake.project(ll, z), b = fake.project(target, z); return { x: a.x - b.x, y: a.y - b.y }; };
const target = [1.35, 103.8];

// side dock 360 wide: the free centre is 180 px right of the map centre, so the view centre must sit 180 px LEFT of the point
let fa = createFreeArea(fake, () => [el(R(0, 0, 360, 600))]);
let fr = fa.rect(); ok(fr.left === 360 && fr.right === 1000, 'rect(): side dock removed');
fa.centerOn(target, { zoom: 14, animate: false });
let k = calls.pop(), off = pxOffset(k.ll, 14, target);
ok(k.z === 14 && k.o.animate === false && k.o.duration === 0.35, 'centerOn: zoom, animate and duration passed to setView');
ok(near(off.x, -180, 1e-3) && near(off.y, 0, 1e-3), 'side dock: the point sits at the centre of the free area (view centre 180 px left of it)');

// bottom sheet 200 high: the free centre is 100 px above the map centre
fa = createFreeArea(fake, () => [el(R(0, 400, 1000, 600))]);
fa.centerOn(target, { animate: false }); k = calls.pop(); off = pxOffset(k.ll, 12, target);
ok(k.z === 12, 'zoom defaults to the current zoom');
ok(near(off.x, 0, 1e-3) && near(off.y, 100, 1e-3), 'bottom sheet: view centre 100 px below the point');

// hidden covers are skipped; a null entry is tolerated
fa = createFreeArea(fake, () => [el(R(0, 0, 360, 600), true), null]);
fa.centerOn(target, { animate: false }); k = calls.pop(); off = pxOffset(k.ll, 12, target);
ok(near(off.x, 0, 1e-3) && near(off.y, 0, 1e-3), 'hidden and missing covers change nothing');

// rotated map: the screen offset is turned into map pixels
fake._rot = { bearing: () => 90 };
fa = createFreeArea(fake, () => [el(R(0, 0, 360, 600))]);
fa.centerOn(target, { zoom: 14, animate: false }); k = calls.pop(); off = pxOffset(k.ll, 14, target);
// screen offset t = (-180, 0) from the map centre; rotated by 90 deg: (t.x cos - t.y sin, t.x sin + t.y cos) = (0, -180); view = point - d, so off = d
ok(near(off.x, 0, 1e-3) && near(off.y, -180, 1e-3), 'bearing 90: the 180 px offset is applied along the map\'s own y axis');
fake._rot = undefined;
fa = createFreeArea(fake, () => [el(R(0, 0, 360, 600))]);
fa.centerOn(target, { zoom: 14, animate: false }); k = calls.pop(); off = pxOffset(k.ll, 14, target);
ok(near(off.x, -180, 1e-3), 'a map without rotation support is treated as bearing 0');

// a cover list that changes between calls is read each time (manual pan and relayout rely on a fresh rectangle)
let open = true;
fa = createFreeArea(fake, () => open ? [el(R(0, 0, 360, 600))] : []);
fa.centerOn(target, { zoom: 14, animate: false }); const withDock = pxOffset(calls.pop().ll, 14, target).x;
open = false; fa.centerOn(target, { zoom: 14, animate: false }); const without = pxOffset(calls.pop().ll, 14, target).x;
ok(near(withDock, -180, 1e-3) && near(without, 0, 1e-3), 'covers are re-read on every call');

// dockMode: the room rule shared by the explorer and the marker panel
ok(dockMode(1200, 360, 320) === 'side' && dockMode(680, 360, 320) === 'side' && dockMode(679, 360, 320) === 'bottom' && dockMode(360, 300, 320) === 'bottom', 'dockMode: side while 320 px of map remain beside the dock, else bottom');
ok(dockMode(660, 340) === 'side' && dockMode(640, 340) === 'bottom', 'dockMode: default minimum 320 (660 side, 640 bottom for a 340 px panel)');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
