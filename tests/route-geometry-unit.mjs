// Route drawing geometry: chevron placement and fit, label text, deterministic label placement. Pure, no browser.
import { cumulative, pointAt, tangentAt, chevronMarks, chevronShape, armFor, visibleSpan, simplifyIdx, fmtDuration, labelText, labelSize, layoutLabels, BAND, CHEVRON_SPACING } from '../src/route/geometry.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const P = (...a) => a.map(([x, y]) => ({ x, y }));
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

// ---------- path basics
const L = P([0, 0], [100, 0], [100, 100]);
const { cum, total } = cumulative(L);
ok(total === 200 && cum.join() === '0,100,200', 'cumulative length');
let q = pointAt(L, cum, 50);
ok(q.x === 50 && q.y === 0 && q.angle === 0, 'a point on the first leg, heading right');
q = pointAt(L, cum, 150);
ok(q.x === 100 && q.y === 50 && near(q.angle, 90), 'a point on the second leg, heading down the screen (90 degrees)');
ok(pointAt(L, cum, -5).x === 0 && pointAt(L, cum, 999).y === 100, 'beyond either end: clamped to the end point');
ok(near(tangentAt(L, cum, 20), 0, 0.5) && near(tangentAt(L, cum, 180), 90, 0.5), 'the tangent follows the local direction of the path, not the overall bearing');

// ---------- chevrons
const straight = P([0, 0], [400, 0]);
let m = chevronMarks(straight);
ok(m.length >= 4 && m.length <= 6 && m.every((c) => c.angle === 0 && c.y === 0), 'a 400 px straight path: chevrons every ~80 px, along the path, pointing along it (' + m.length + ')');
ok(m.slice(1).every((c, i) => near(c.x - m[i].x, CHEVRON_SPACING, 0.01)), 'spacing is the screen-space target');
ok(m[0].x >= 20 && m[m.length - 1].x <= 380, 'none within 20 px of either end (that is where the pins are)');
ok(chevronMarks(P([0, 0], [30, 0])).length === 0, 'a path shorter than 44 px has no chevron');
ok(chevronMarks(P([0, 0], [60, 0])).length === 1, 'a short path has one, in the middle');
const diag = chevronMarks(P([0, 0], [300, 300]));
ok(diag.length > 0 && diag.every((c) => near(c.angle, 45, 0.1)), 'on a diagonal the chevrons point 45 degrees');
const zig = chevronMarks(P([0, 0], [200, 0], [200, 4], [400, 4]));
ok(zig.every((c) => Math.abs(c.angle) < 20), 'a 4 px jog turns the chevrons by less than 20 degrees (the tangent is taken over a window)');
const sharp = chevronMarks(P([0, 0], [100, 0], [100, 100]), { spacing: 100 });
ok(!sharp.some((c) => Math.hypot(c.x - 100, c.y) < 14), 'no chevron sits on a sharp corner (it would point the wrong way)');
ok(chevronMarks(straight, { inView: (p) => p.x > 200 }).every((c) => c.x > 200), 'chevrons outside the view are not generated');
const shifted = chevronMarks(P([500, 300], [900, 300]));
ok(shifted.length === m.length && near(shifted[0].x - 500, m[0].x), 'panning does not move the chevrons along the path: positions are measured from the path start');
ok(chevronMarks(P([0, 0], [100000, 0]), { maxCount: 50 }).length === 50, 'a very long path is capped');

// ---------- chevrons fit inside the band
for (const w of [BAND.normal, BAND.bold]) {
  const arm = armFor(w);
  const shp = chevronShape({ x: 0, y: 0, angle: 0 }, 3.4, arm);
  ok(shp.every((p) => Math.abs(p.y) <= w / 2 - 1) && arm >= 2, `a chevron's arms stay inside a ${w} px band (arm ${arm})`);
  const rot = chevronShape({ x: 10, y: 10, angle: 90 }, 3.4, arm);
  ok(rot.every((p) => Math.abs(p.x - 10) <= w / 2 - 1), 'and a rotated one too');
}
ok(armFor(BAND.normal) <= armFor(BAND.bold), 'a wider band allows a larger chevron');

// ---------- visible span
const span = visibleSpan(straight, cumulative(straight).cum, (p) => p.x >= 100 && p.x <= 300);
ok(span && span[0] >= 90 && span[0] <= 110 && span[1] >= 290 && span[1] <= 310, 'the visible span of a path');
ok(visibleSpan(straight, cumulative(straight).cum, () => false) === null, 'nothing visible: null');

// ---------- label text
ok(fmtDuration(10) === '<1 min' && fmtDuration(60) === '1 min' && fmtDuration(1080) === '18 min' && fmtDuration(3600) === '1 h' && fmtDuration(5400) === '1 h 30 min' && fmtDuration(NaN) === '', 'durations');
const fmt = (v) => (v / 1000).toFixed(1) + ' km';
let t = labelText({ state: 'road', distanceM: 9800, durationS: 1080 }, fmt);
ok(t.full === '9.8 km · 18 min' && t.compact === '9.8 km' && /Driving route, 9\.8 km, about 18 min/.test(t.aria), 'a road label shows driving distance and time');
t = labelText({ state: 'fallback', distanceM: 9800, durationS: null }, fmt);
ok(t.full === '≈ 9.8 km · straight line' && t.compact === '≈ 9.8 km' && /Straight-line distance, 9\.8 km\. Driving route unavailable/.test(t.aria), 'a fallback label says straight line and is marked approximate; its accessible text says the driving route is unavailable');
ok(!/driving/i.test(t.full) && !/driving/i.test(t.compact) && /driving route unavailable/i.test(t.aria), 'a fallback distance is never called a driving distance');

// ---------- label placement
const mkItem = (key, pts, text = '9.8 km · 18 min', o = {}) => { const c = cumulative(pts); return { key, pts, cum: c.cum, texts: { full: text, compact: text.split(' · ')[0] }, span: [0, c.total], ...o }; };
const A = mkItem('a', P([0, 0], [300, 0]));
let out = layoutLabels([A]);
ok(out.get('a').mode === 'full' && near(out.get('a').x, 150) && out.get('a').y === 0, 'a lone leg: the full label at the middle of its path');
const B = mkItem('b', P([0, 0], [300, 0]));
out = layoutLabels([A, B]);
ok(out.get('b').omitted === false && Math.abs(out.get('b').x - 150) >= 60, 'a second leg on the same stretch is moved along its path, not stacked on the first');
out = layoutLabels([mkItem('a', P([0, 0], [300, 0])), mkItem('b', P([0, 0], [300, 0]), '9.8 km · 18 min', { dupKey: 'x' }), mkItem('c', P([0, 0], [300, 0]), '9.8 km · 18 min', { dupKey: 'x' })]);
ok(out.get('c').omitted && out.get('c').reason === 'duplicate' && !out.get('b').omitted, 'identical legs (same road, direction and text) share one label');
const pin = [{ x: 150, y: 0, w: 32, h: 44 }];
out = layoutLabels([A], { obstacles: pin });
ok(out.get('a').mode === 'full' && Math.abs(out.get('a').x - 150) > 30, 'the label avoids a pin standing on its preferred place');
const wall = Array.from({ length: 9 }, (_, i) => ({ x: i * 40, y: 0, w: 40, h: 44 }));
out = layoutLabels([A], { obstacles: wall });
ok(out.get('a').mode === 'forced' && !out.get('a').omitted, 'pins everywhere: the compact label is still placed (it may sit on a pin) rather than dropped');
const tiny = layoutLabels([mkItem('s', P([0, 0], [30, 0]))]);
ok(tiny.get('s').omitted && tiny.get('s').reason === 'short', 'a leg too short to carry a label has none (its accessible text and details remain)');
const nospan = layoutLabels([{ ...A, span: null }]);
ok(nospan.get('a').omitted, 'a leg with nothing on screen has no label');
// crowding: many legs through one stretch
const many = Array.from({ length: 12 }, (_, i) => mkItem('k' + String(i).padStart(2, '0'), P([0, 0], [300, 0])));
out = layoutLabels(many);
const placed = [...out.values()].filter((v) => !v.omitted);
let overlap = 0;
for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) { const a = placed[i], b = placed[j], sa = labelSize(a.text), sb = labelSize(b.text); if (Math.abs(a.x - b.x) * 2 < sa.w + sb.w && Math.abs(a.y - b.y) * 2 < sa.h + sb.h) overlap++; }
ok(placed.length >= 2 && overlap === 0, 'twelve legs over one stretch: the labels that are placed (' + placed.length + ') never overlap; the rest degrade by the documented rule');
ok(JSON.stringify([...layoutLabels(many)]) === JSON.stringify([...layoutLabels(many)]), 'placement is deterministic: the same input gives the same result');
out = layoutLabels([B, A]);
ok(near(out.get('b').x, 150) && Math.abs(out.get('a').x - 150) >= 60, 'the first leg in the order (the selected one, by the caller) wins the preferred place');
// rotation: collisions are tested on the screen-aligned positions
const rotate90 = (p) => ({ x: -p.y, y: p.x });
const vert = mkItem('v', P([0, 0], [0, 300])), horiz = mkItem('h', P([-150, 150], [150, 150]));
out = layoutLabels([vert, horiz], { screen: rotate90 });
ok(!out.get('h').omitted && !out.get('v').omitted, 'with a turned map the rectangles are compared the way the viewer sees them');

// ---------- render-time simplification: fewer points to project and draw, the same line to within half a pixel
{
  const distTo = (pt, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2)) : 0; return Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y); };
  const within = (pts, idx, tol) => pts.every((pt) => { let best = Infinity; for (let k = 1; k < idx.length; k++) best = Math.min(best, distTo(pt, pts[idx[k - 1]], pts[idx[k]])); return best <= tol + 1e-9; });
  const road = Array.from({ length: 4000 }, (_, i) => ({ x: Math.round(i * 0.4 + 6 * Math.sin(i / 90)), y: Math.round(40 * Math.sin(i / 300) + 3 * Math.sin(i / 7)) }));
  const idx = simplifyIdx(road, 0.5);
  ok(idx[0] === 0 && idx[idx.length - 1] === road.length - 1 && idx.every((v, i) => i === 0 || v > idx[i - 1]), 'the first and last points are kept and the indices ascend');
  ok(idx.length < road.length / 3 && within(road, idx, 0.5), 'a dense road keeps a fraction of its points (' + idx.length + ' of ' + road.length + ') and no dropped point is further than half a pixel from the line drawn');
  ok(simplifyIdx(P([0, 0], [10, 0], [20, 0], [30, 0])).join() === '0,3', 'collinear points collapse to the two ends');
  ok(simplifyIdx(P([0, 0], [10, 8], [20, 0])).join() === '0,1,2' && simplifyIdx(P([0, 0], [5, 5])).join() === '0,1' && simplifyIdx(P([3, 3])).join() === '0' && simplifyIdx([]).length === 0, 'a real corner is kept; two points, one point and none are returned as they are');
  ok(simplifyIdx(P([0, 0], [10, 10], [0, 0])).join() === '0,1,2' && simplifyIdx(P([4, 4], [4, 4], [4, 4])).join() === '0,2', 'a path that returns to its start keeps its turning point; identical points collapse');
  const bad = simplifyIdx([{ x: 0, y: 0 }, { x: NaN, y: 2 }, { x: 5, y: 0 }, { x: Infinity, y: 1 }, { x: 9, y: 0 }]);
  ok(bad[0] === 0 && bad[bad.length - 1] === 4 && bad.includes(1) && bad.includes(3), 'points that are not finite are kept and do not hang or throw');
  const huge = Array.from({ length: 60000 }, (_, i) => ({ x: i * 0.05, y: Math.sin(i / 50) * 30 + Math.sin(i * 1.7) * 0.2 }));
  const t0 = performance.now(), hi = simplifyIdx(huge);
  ok(performance.now() - t0 < 1500 && hi.length < huge.length && hi.length > 100, 'sixty thousand points are simplified in well under 1.5 s (' + Math.round(performance.now() - t0) + ' ms) without recursion');
  const zig = Array.from({ length: 20000 }, (_, i) => ({ x: i, y: (i % 2) * 40 })); // every point is a corner: nothing may be dropped, and it must still finish
  const t1 = performance.now();
  ok(simplifyIdx(zig).length === zig.length && performance.now() - t1 < 1500, 'a path with no redundant point loses none and does not go quadratic');
}
