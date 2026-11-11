// The compass maths and the orientation sensor wrapper (src/heading.js). No browser: the browser's window is a small fake.
import { normalize, shortestDelta, smoothAngle, compassHeading, screenAngle, chooseHeading, arrowAngle, pointName, createHeading } from '../src/heading.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const near = (a, b, t = 0.01) => Math.abs(shortestDelta(a, b)) < t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- angles
ok(normalize(-10) === 350 && normalize(370) === 10 && normalize(360) === 0, 'normalize wraps into 0 to 360');
ok(shortestDelta(350, 10) === 20 && shortestDelta(10, 350) === -20 && shortestDelta(0, 180) === 180 && shortestDelta(90, 90) === 0, 'shortestDelta takes the short way round');
ok(near(smoothAngle(350, 10, 0.5), 0) && near(smoothAngle(10, 350, 0.5), 0) && smoothAngle(null, 123, 0.3) === 123 && near(smoothAngle(0, 90, 1), 90), 'smoothAngle moves along the shorter arc and starts at the first value');

// ---------- the compass heading from an orientation (alpha 0 = top of a flat phone points north, growing counter-clockwise)
ok(near(compassHeading(0, 0, 0), 0) && near(compassHeading(270, 0, 0), 90) && near(compassHeading(180, 0, 0), 180) && near(compassHeading(90, 0, 0), 270), 'a phone lying flat: north, east, south, west');
ok(near(compassHeading(0, 90, 0), 0) && near(compassHeading(270, 90, 0), 90) && near(compassHeading(180, 90, 0), 180) && near(compassHeading(90, 90, 0), 270), 'held upright: the way the back camera faces');
ok(near(compassHeading(0, 45, 0), 0) && near(compassHeading(270, 45, 0), 90) && near(compassHeading(270, 60, 0), 90), 'tilted: still the same way, with no jump between lying flat and upright');
let worst = 0;
for (let tilt = 0; tilt <= 90; tilt += 5) worst = Math.max(worst, Math.abs(shortestDelta(compassHeading(300, tilt, 0), 60)));
ok(worst < 0.01, 'sweeping the tilt from flat to upright at one compass direction never changes the heading (largest change ' + worst.toFixed(4) + '°)');
ok(near(compassHeading(0, 0, 0, 90), 90) && near(compassHeading(0, 0, 0, 270), 270) && near(compassHeading(0, 0, 0, 180), 180), 'turned to landscape, the way the screen\'s top faces');
ok(near(compassHeading(0, 90, 0, 90), 0), 'the back camera does not depend on the screen\'s rotation');
ok(near(compassHeading(0, 90, 15), 0, 20) && Number.isFinite(compassHeading(null, null, null)), 'a little roll changes little, and missing values do not give NaN');
ok(screenAngle({ screen: { orientation: { angle: 90 } } }) === 90 && screenAngle({ orientation: 270 }) === 270 && screenAngle({}) === 0, 'the screen angle is read from the browser, 0 if it does not say');

// ---------- what to show
ok(chooseHeading({ compass: 123 }) === 123 && chooseHeading({ compass: 0, travel: 90, speed: 5 }) === 0, 'the compass wins when there is one');
ok(chooseHeading({ travel: 90, speed: 3 }) === 90 && chooseHeading({ travel: 90, speed: 0.5 }) === null && chooseHeading({ travel: null, speed: 3 }) === null && chooseHeading({}) === null, 'otherwise the direction of travel, only when moving, otherwise nothing');
ok(arrowAngle(90, 90) === 0 && arrowAngle(10, 350) === 20 && arrowAngle(0, 90) === 270 && arrowAngle(45) === 45 && arrowAngle(null, 10) === null, 'the arrow\'s on-screen angle is the heading minus the map\'s bearing');
ok(pointName(0) === 'north' && pointName(44) === 'north-east' && pointName(90) === 'east' && pointName(225) === 'south-west' && pointName(359) === 'north', 'a heading in words');

// ---------- the sensor, with a fake window
function fakeWin({ ios = false, answer = 'granted', supported = true, angle = 0 } = {}) {
  const listeners = {};
  const w = {
    listeners, screen: { orientation: { angle } },
    addEventListener: (t, f) => { (listeners[t] ??= new Set()).add(f); }, removeEventListener: (t, f) => listeners[t]?.delete(f),
    fire(type, props) { for (const f of [...(listeners[type] ?? [])]) f({ type, ...props }); },
    count: () => Object.values(listeners).reduce((n, s) => n + s.size, 0),
  };
  if (supported) { w.DeviceOrientationEvent = function () {}; if (ios) w.DeviceOrientationEvent.requestPermission = async () => answer; }
  return w;
}
let t = 1000; const now = () => t;
let got = [], unavailable = 0, denied = 0;
const mk = (w, extra = {}) => createHeading({ win: w, onHeading: (d) => got.push(d), onUnavailable: () => unavailable++, onDenied: () => denied++, now, waitMs: 40, ...extra });

let w = fakeWin(); let h = mk(w);
ok((await h.start()).ok && w.count() === 2 && h.isRunning(), 'starting listens for orientation events');
w.fire('deviceorientationabsolute', { alpha: 270, beta: 0, gamma: 0 });
ok(got.length === 1 && near(got[0], 90), 'an absolute orientation gives a heading (east): ' + got[0]);
w.fire('deviceorientation', { alpha: 123, beta: 0, gamma: 0, absolute: false });
ok(got.length === 1, 'a relative orientation, which says nothing about north, is ignored');
w.fire('deviceorientation', { alpha: 270, beta: 0, gamma: 0, absolute: true });
ok(got.length === 1, 'a second absolute event (the other event name) within 100 ms is held back');
t += 150; w.fire('deviceorientationabsolute', { alpha: 270, beta: 0, gamma: 0 });
ok(got.length === 1, 'a change under 2 degrees is not reported');
t += 150; w.fire('deviceorientationabsolute', { alpha: 220, beta: 0, gamma: 0 });
ok(got.length === 2 && got[1] > 90 && got[1] < 140, 'a bigger change is, smoothed rather than jumping (' + Math.round(got[1]) + '° on the way to 140°)');
t += 150; w.fire('deviceorientation', { webkitCompassHeading: 140, alpha: 0, beta: 0, gamma: 0 });
ok(got.length === 3 && got[2] > got[1] && got[2] < 140, 'iOS gives webkitCompassHeading, which is used (smoothed) instead of alpha');
h.stop();
ok(w.count() === 0 && !h.isRunning(), 'stopping removes the listeners');
await sleep(80);
ok(unavailable === 0, 'a sensor that sent events never reports itself unavailable');

// wrap-around does not spin
got = []; w = fakeWin(); h = mk(w); await h.start();
t += 500; w.fire('deviceorientationabsolute', { alpha: 5, beta: 0, gamma: 0 });   // heading 355
t += 500; w.fire('deviceorientationabsolute', { alpha: 355, beta: 0, gamma: 0 });  // heading 5
ok(got.length === 2 && Math.abs(shortestDelta(got[0], got[1])) < 12, 'going from 355° to 5° moves a few degrees, not 350 (' + Math.round(got[0]) + '° to ' + Math.round(got[1]) + '°)');
h.stop();

// no events at all
unavailable = 0; w = fakeWin(); h = mk(w); await h.start(); await sleep(90);
ok(unavailable === 1, 'a phone with no usable compass says so after the wait');
h.stop();
unavailable = 0; w = fakeWin({ supported: false }); h = mk(w);
ok((await h.start()).reason === 'unsupported' && unavailable === 1, 'a browser without orientation events is reported at once');

// iOS permission
denied = 0; w = fakeWin({ ios: true, answer: 'denied' }); h = mk(w);
let r = await h.start();
ok(!r.ok && r.reason === 'denied' && denied === 1 && w.count() === 0 && !h.isRunning(), 'on iOS a refused permission is reported and nothing is listened to');
w = fakeWin({ ios: true, answer: 'granted' }); h = mk(w);
let asked = 0; w.DeviceOrientationEvent.requestPermission = async () => { asked++; return 'granted'; };
r = await h.start(); h.stop(); await h.start();
ok(r.ok && asked === 1 && h.isRunning(), 'a granted permission is asked for once, not again when sensing restarts');
h.stop();
