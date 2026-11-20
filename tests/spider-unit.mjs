// Coincident-marker grouping and fan layout. Pure, no browser.
import { clusterByScreen, fanLayout, COINCIDENT_PX, MAX_FAN } from '../src/spider.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const pt = (id, x, y) => ({ id, x, y });
const ids = (g) => g.map((p) => p.id).join();

let g = clusterByScreen([pt('a', 100, 100), pt('b', 100, 100), pt('c', 400, 400)]);
ok(g.length === 1 && ids(g[0]) === 'a,b', 'two pins on one point are a stack; a lone pin is not');
g = clusterByScreen([pt('a', 100, 100), pt('b', 100 + COINCIDENT_PX, 100), pt('c', 100 + COINCIDENT_PX + 2, 100)]);
ok(g.length === 1 && ids(g[0]) === 'a,b,c', 'near-identical points join, and a chain of near pins is one stack');
g = clusterByScreen([pt('a', 100, 100), pt('b', 100 + COINCIDENT_PX + 3, 100)]);
ok(g.length === 0, 'pins just apart (' + (COINCIDENT_PX + 3) + ' px) are not a stack');
g = clusterByScreen([pt('a', 0, 0), pt('b', 5, 5), pt('c', 500, 500), pt('d', 503, 502), pt('e', 900, 0)]);
ok(g.length === 2 && ids(g[0]) === 'a,b' && ids(g[1]) === 'c,d', 'separate stacks stay separate, in input order');
ok(clusterByScreen([]).length === 0 && clusterByScreen([pt('a', 1, 1)]).length === 0, 'no pins, one pin: nothing');
g = clusterByScreen([pt('a', -3, -3), pt('b', -3, -3), pt('c', 14, 14)]);
ok(g.length === 1 && g[0].length === 2 || g[0].length === 3, 'negative coordinates group as well');
g = clusterByScreen(Array.from({ length: 2000 }, (_, i) => pt('p' + i, (i % 50) * 100, Math.floor(i / 50) * 100)).concat([pt('x', 0, 0)]));
ok(g.length === 1 && g[0].length === 2, 'two thousand pins on a grid: only the real coincidence is found (and it is fast)');

// ---------- layout
for (const n of [2, 3, 5, 8]) {
  const l = fanLayout(n);
  let min = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(l[i].x - l[j].x, l[i].y - l[j].y));
  ok(l.length === n && min >= 32 && l.every((p) => Math.hypot(p.x, p.y) >= 39), `${n} pins on a circle: every pin clear of the stack and of its neighbours (${min.toFixed(0)} px)`);
}
ok(Math.abs(fanLayout(4)[0].x) < 0.001 && fanLayout(4)[0].y < 0, 'the first pin goes straight up');
ok(fanLayout(3)[1].x > 0, 'and the next turns clockwise');
const sp = fanLayout(MAX_FAN);
let minSp = Infinity;
for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) minSp = Math.min(minSp, Math.hypot(sp[i].x - sp[j].x, sp[i].y - sp[j].y));
ok(sp.length === MAX_FAN && minSp >= 30, `${MAX_FAN} pins on a spiral keep at least 30 px apart (${minSp.toFixed(0)} px)`);
ok(fanLayout(0).length === 0 && fanLayout(1).length === 1, 'zero and one pin');
ok(JSON.stringify(fanLayout(6)) === JSON.stringify(fanLayout(6)), 'the layout is deterministic');
