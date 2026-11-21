// Parallel lanes for opposite-direction overlaps: detection, tolerance, partial overlap, smooth merge, left-alone cases. Pure geometry, no browser.
import { resample, oppositeFlags, laneWeights, assignLanes } from '../src/route/overlap.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const P = (...a) => a.map(([x, y]) => ({ x, y }));
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;
const rev = (pts) => pts.slice().reverse();
const tangentsOf = (pts) => pts.map((_, i) => { const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)]; const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; });

// ---------- resampling
const line = P([0, 0], [100, 0]);
let r = resample(line, 8);
ok(r[0].x === 0 && r[r.length - 1].x === 100 && r.slice(1, -1).every((p, i) => near(p.x - r[i].x, 8, 0.01)), 'resampling keeps both end points and steps evenly');
ok(resample(P([0, 0], [50, 0], [50, 50]), 10).length === 11 && resample(P([5, 5]), 8).length === 1, 'resampling a corner and a single point');

// ---------- detection
const east = P([0, 0], [300, 0]);
const eastR = resample(east), westR = resample(rev(east));
ok(oppositeFlags(eastR, tangentsOf(eastR), westR, 10).filter(Boolean).length >= eastR.length - 1, 'an exact reverse leg: every sample overlaps');
ok(oppositeFlags(eastR, tangentsOf(eastR), eastR, 10).every((f) => !f), 'the same direction is not an opposite overlap (duplicates share one geometry)');
const perp = resample(P([150, -150], [150, 150]));
ok(oppositeFlags(eastR, tangentsOf(eastR), perp, 10).every((f) => !f), 'a road that crosses at right angles is not an overlap');
const apart = resample(P([300, 40], [0, 40]));
ok(oppositeFlags(eastR, tangentsOf(eastR), apart, 10).every((f) => !f), 'a reverse leg 40 px away is its own road, not an overlap');
const close = resample(P([300, 6], [0, 6]));
ok(oppositeFlags(eastR, tangentsOf(eastR), close, 10).filter(Boolean).length >= eastR.length - 1, 'a reverse leg 6 px away (the same road, drawn a little differently) is an overlap');
const partial = resample(P([200, 0], [100, 0], [100, 200]));
const pf = oppositeFlags(eastR, tangentsOf(eastR), partial, 10);
ok(pf.slice(0, 8).every((f) => !f) && pf.slice(14, 24).some((f) => f) && pf.slice(30).every((f) => !f), 'a partial overlap flags only the shared stretch');
const diagA = resample(P([0, 0], [300, 300])), diagB = resample(P([300, 300], [0, 0]));
ok(oppositeFlags(diagA, tangentsOf(diagA), diagB, 10).filter(Boolean).length >= diagA.length - 1, 'it works on a diagonal too');
ok(oppositeFlags(eastR, tangentsOf(eastR), resample(P([2000, 2000], [2100, 2000])), 10).every((f) => !f), 'a distant path is skipped');

// ---------- weights
let w = laneWeights([false, false, true, true, true, true, false, false, false, false, false]);
ok(w[2] === 1 && w[5] === 1 && w[1] > 0 && w[1] < 1 && w[0] > 0 && w[0] < w[1] && w[6] > 0 && w[6] < 1 && w[10] === 0, 'a run is full strength inside and ramps down on both sides: ' + w.map((x) => x.toFixed(2)).join(' '));
w = laneWeights([false, true, true, false, false, true, false, false]);
ok(w.every((x) => x === 0), 'a run of two samples (a crossing) is ignored');
ok(laneWeights([true, true, true, true]).every((x) => x === 1), 'a leg that overlaps from end to end is moved end to end');

// ---------- lanes
const mk = (pts, width = 12) => ({ pts, width });
let a = mk(east), b = mk(rev(east));
assignLanes([a, b], { lane: (it) => it.width / 2 + 1.5 });
ok(a.drawPts && b.drawPts, 'two opposite legs on one road both get a lane');
const mid = (it) => it.drawPts[Math.floor(it.drawPts.length / 2)];
ok(near(mid(a).y, 7.5) && near(mid(b).y, -7.5), 'each is shifted to its own right-hand side of travel (east-bound lower on a y-down screen, west-bound upper): ' + mid(a).y.toFixed(1) + ' / ' + mid(b).y.toFixed(1));
ok(near(mid(a).y - mid(b).y, 15, 0.5) && mid(a).y - mid(b).y > 12, 'the two 12 px bands sit side by side without overlapping');
ok(near(mid(a).x, 150, 8) && near(a.drawPts[Math.floor(a.drawPts.length / 2)].x - mid(a).x, 0), 'and are moved sideways only');
const c = mk(resample(P([0, 400], [300, 400])));
assignLanes([mk(east), mk(rev(east)), c]);
ok(!c.drawPts, 'a leg that overlaps nothing is left on its true geometry');
a = mk(east); b = mk(east);
assignLanes([a, b]);
ok(!a.drawPts && !b.drawPts, 'two legs in the same direction share one geometry');
// partial overlap: the shifted stretch merges back smoothly
a = mk(P([0, 0], [300, 0]));
b = mk(P([200, 0], [100, 0], [100, 200]));
assignLanes([a, b], { lane: () => 8 });
const dy = a.drawPts.map((p, i) => p.y);
ok(near(dy[0], 0, 0.01) && near(dy[dy.length - 1], 0, 0.01), 'outside the shared stretch the leg is on its true road (offset zero at both ends)');
ok(Math.max(...dy) > 7 && dy.slice(1).every((y, i) => Math.abs(y - dy[i]) <= 8 / 3 + 0.01), 'the offset reaches the lane width inside and changes by at most a third of it per 8 px step: smooth, no jump');
const bx = b.drawPts;
ok(bx[bx.length - 1].x === 100 && bx[bx.length - 1].y === 200, 'the other leg keeps its far end exactly where it is');
// three legs on one road: nothing breaks, the opposite pairs move
const t1 = mk(east), t2 = mk(rev(east)), t3 = mk(east);
assignLanes([t1, t2, t3]);
ok(t1.drawPts && t2.drawPts && t3.drawPts && near(t1.drawPts[10].y, t3.drawPts[10].y, 0.01), 'two eastbound legs and one westbound: the eastbound pair share a lane, the westbound has its own');
ok(assignLanes([mk(east)]).length === 1 && assignLanes([]).length === 0, 'one leg, or none: nothing to do');
// screen-space: the offset does not depend on length or zoom
const small = mk(P([0, 0], [60, 0])), smallR = mk(P([60, 0], [0, 0]));
assignLanes([small, smallR]);
ok(Math.abs(small.drawPts[4].y) >= 7 && Math.abs(small.drawPts[4].y) <= 7.6, 'a short leg gets the same pixel offset: ' + small.drawPts[4].y.toFixed(1));
// the end of a leg that points into the overlap is not detached from its marker when the overlap stops short
const part = mk(P([0, 0], [300, 0]));
assignLanes([part, mk(P([300, 0], [200, 0]))], { lane: () => 8 });
ok(part.drawPts[0].x === 0 && part.drawPts[0].y === 0, 'the start of a leg stays on its marker');

// ---------- the grid gives the answers of a full scan, and long legs stay fast
{
  const scan = (a, ta, b, tol) => a.map((p, i) => { // the straightforward version: every sample against every segment
    let best = Infinity, dir = null;
    for (let k = 1; k < b.length; k++) { const dx = b[k].x - b[k - 1].x, dy = b[k].y - b[k - 1].y, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p.x - b[k - 1].x) * dx + (p.y - b[k - 1].y) * dy) / l2)) : 0; const d = Math.hypot(b[k - 1].x + t * dx - p.x, b[k - 1].y + t * dy - p.y); if (d < best) { best = d; dir = l2 ? { x: dx / Math.sqrt(l2), y: dy / Math.sqrt(l2) } : { x: 1, y: 0 }; } }
    return best <= tol && dir && ta[i].x * dir.x + ta[i].y * dir.y < -0.5;
  });
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wander = (x0, y0, n, dir) => { const pts = [{ x: x0, y: y0 }]; for (let i = 1; i < n; i++) pts.push({ x: pts[i - 1].x + dir * (20 + rnd() * 30), y: pts[i - 1].y + (rnd() - 0.5) * 40 }); return pts; };
  let same = true, any = 0;
  for (let n = 0; n < 40; n++) {
    const a = resample(wander(0, 0, 30, 1)), b = resample(rev(wander(0, (rnd() - 0.5) * 30, 30, 1)).map((p) => ({ x: p.x + (rnd() - 0.5) * 6, y: p.y + (rnd() - 0.5) * 6 })));
    const ta = tangentsOf(a), got = oppositeFlags(a, ta, b, 10), want = scan(a, ta, b, 10);
    any += want.filter(Boolean).length;
    if (got.some((f, i) => f !== !!want[i])) same = false;
  }
  ok(same && any > 50, 'on 40 random pairs of paths the indexed search flags the same samples as a full scan (' + any + ' flagged in all)');
  const longRoad = (x0, n, ph) => Array.from({ length: n }, (_, i) => ({ x: x0 + (60000 * i) / n, y: 300 * Math.sin(i / 40 + ph) }));
  const legs = [0, 60000, 120000].map((x, i) => ({ pts: longRoad(x, 8000, i), width: 9 })); // three consecutive 60,000 px legs of 8,000 points
  const t0 = performance.now();
  assignLanes(legs);
  const ms = performance.now() - t0;
  ok(ms < 1500, 'three consecutive 60,000 px legs of 8,000 points lay out in under 1.5 s (took ' + Math.round(ms) + ' ms; the full scan took about 7 s)');
  ok(oppositeFlags([{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 0 }], [{ x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: Infinity, y: 5 }, { x: 10, y: 0 }], 10).length === 3, 'a non-finite point does not hang the search');
}
