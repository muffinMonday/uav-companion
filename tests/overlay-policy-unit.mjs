// The overlay announcements (src/overlay-policy.js): owners announce open and close, listeners react, unsubscribing works. No browser.
import { OVERLAY_KINDS, announce, onOverlay } from '../src/overlay-policy.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
ok(Object.keys(OVERLAY_KINDS).sort().join() === 'contextual,dialog,fullScreen' && Object.isFrozen(OVERLAY_KINDS), 'three presentation kinds, frozen');
const seen = [];
const off = onOverlay((owner, phase) => seen.push(owner + ':' + phase));
announce('marker', 'open'); announce('explorer', 'open'); announce('marker', 'close');
ok(seen.join() === 'marker:open,explorer:open,marker:close', 'every announcement reaches a listener, in order');
const seen2 = []; const off2 = onOverlay((o, p) => seen2.push(o + p));
off(); announce('explorer', 'close');
ok(seen.length === 3 && seen2.join() === 'explorerclose', 'an unsubscribed listener hears nothing; the others still do');
off2();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
