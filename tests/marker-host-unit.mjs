// The pure parts of the marker host (src/marker-host.js): panel width by viewport, keyboard inset from a visual viewport. The dev-only switch needs Vite's import.meta.env and is covered in the browser suite. No browser here.
import { hostWidth, keyboardInset } from '../src/marker-host.js';
import { dockMode } from '../src/free-area.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
ok(hostWidth(1440) === 480 && hostWidth(1000) === 420 && hostWidth(1100) === 420 && hostWidth(1280) === 474, 'desktop: about 37% of the width, 420 to 480');
ok(hostWidth(760) === 357 && hostWidth(660) === 340 && hostWidth(999) === 470, 'unfolded: about 47% of the width, 340 to 480');
ok([360, 390, 430, 520, 640, 660, 760, 1080].every((w) => { const d = hostWidth(w); return d >= 340 && d <= 480 && (dockMode(w, d, 320) === 'side') === (w - d >= 320); }), 'the width and the room rule agree at every tested screen width');
ok(dockMode(640, hostWidth(640)) === 'bottom' && dockMode(660, hostWidth(660)) === 'side', 'bottom below about 660 px, side from there');
ok(keyboardInset(740, { height: 400, offsetTop: 0 }) === 340, 'a keyboard of 340 px is measured');
ok(keyboardInset(740, { height: 700, offsetTop: 0 }) === 0 && keyboardInset(740, { height: 735, offsetTop: 0 }) === 0, 'a browser bar (under 80 px) is not a keyboard');
ok(keyboardInset(740, { height: 400, offsetTop: 100 }) === 240, 'a scrolled visual viewport is accounted for');
ok(keyboardInset(740, null) === 0 && keyboardInset(740, { height: 740 }) === 0, 'no visual viewport, or a full one: no inset');
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
