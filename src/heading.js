// Which way the phone points. The maths is pure (and tested in tests/heading-unit.mjs); createHeading() wraps the browser's orientation sensor.
//
// Angles are in degrees, compass style: 0 = north, 90 = east, clockwise. "Pointing" means the way the screen's top edge faces when the phone lies flat, and
// the way the back camera faces when it is held upright (so it works held either way, the same as map apps).

const rad = (d) => (d * Math.PI) / 180;
export const normalize = (d) => ((d % 360) + 360) % 360;
/** The shortest signed turn from one angle to another, in (-180, 180]. */
export const shortestDelta = (from, to) => { const d = normalize(to - from); return d > 180 ? d - 360 : d; };
/** Moves `prev` a fraction `k` of the way to `next` along the shorter arc (a low-pass filter that does not spin at 359 to 1). */
export const smoothAngle = (prev, next, k) => (prev === null ? normalize(next) : normalize(prev + k * shortestDelta(prev, next)));

/** Multiplies the W3C rotation (alpha about z, then beta about x, then gamma about y) into the vector (x, y, z); the world is x east, y north, z up. */
function worldVector(alpha, beta, gamma, v) {
  const a = rad(alpha || 0), b = rad(beta || 0), g = rad(gamma || 0);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Ry(gamma)
  let [x, y, z] = [cg * v[0] + sg * v[2], v[1], -sg * v[0] + cg * v[2]];
  // Rx(beta)
  [x, y, z] = [x, cb * y - sb * z, sb * y + cb * z];
  // Rz(alpha)
  return [ca * x - sa * y, sa * x + ca * y, z];
}

/**
 * The compass heading from an absolute device orientation (alpha 0 when the top of a flat phone points north, increasing counter-clockwise).
 * `screen` is the screen's rotation (0, 90, 180, 270) so a phone held sideways still gives the way the screen's top faces.
 */
export function compassHeading(alpha, beta, gamma, screen = 0) {
  const back = worldVector(alpha, beta, gamma, [0, 0, -1]);           // where the back camera points
  const up = worldVector(alpha, beta, gamma, [Math.sin(rad(screen)), Math.cos(rad(screen)), 0]); // where the top of the screen points
  const v = Math.abs(back[2]) < 0.7 ? back : up;                       // upright: the camera; lying flat: the top edge
  return normalize((Math.atan2(v[0], v[1]) * 180) / Math.PI);
}

/** The screen's rotation in degrees (0, 90, 180, 270), or 0 if the browser does not say. */
export function screenAngle(win = globalThis) {
  const a = win.screen?.orientation?.angle ?? win.orientation ?? 0;
  return normalize(Number.isFinite(a) ? a : 0);
}

/** The heading to show: the compass if there is one; otherwise the direction of travel, but only when moving fast enough for it to mean something. */
export function chooseHeading({ compass = null, travel = null, speed = null }) {
  if (Number.isFinite(compass)) return normalize(compass);
  if (Number.isFinite(travel) && Number.isFinite(speed) && speed >= 1.5) return normalize(travel);
  return null;
}

/** The on-screen angle of the arrow on the location marker: the heading minus how far the map is turned (both clockwise from north). */
export const arrowAngle = (heading, bearing = 0) => (Number.isFinite(heading) ? normalize(heading - bearing) : null);

/** "north-east" for a heading, for a screen reader. */
export const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const pointName = (heading) => COMPASS_POINTS[Math.round(normalize(heading) / 45) % 8];

/**
 * The orientation sensor. start() must be called from a tap (iOS asks permission then). onHeading(deg) gets a smoothed heading at most about 10 times a second and
 * only when it changed by 2 degrees or more; onUnavailable() is called if nothing arrives within 2 seconds; onDenied() if the permission was refused.
 */
export function createHeading({ win = globalThis, onHeading, onUnavailable, onDenied, now = () => Date.now(), minGapMs = 100, minStep = 2, smooth = 0.3, waitMs = 2000 } = {}) {
  let running = false, granted = false, smoothed = null, lastSent = null, lastAt = 0, got = false, timer = null;

  function handle(e) {
    let raw = null;
    if (Number.isFinite(e.webkitCompassHeading)) raw = e.webkitCompassHeading;                        // iOS
    else if ((e.type === 'deviceorientationabsolute' || e.absolute === true) && Number.isFinite(e.alpha)) raw = compassHeading(e.alpha, e.beta, e.gamma, screenAngle(win));
    if (raw === null) return;                                                                          // a relative orientation says nothing about north
    got = true; clearTimeout(timer);
    smoothed = smoothAngle(smoothed, raw, lastSent === null ? 1 : smooth);
    const t = now();
    if (t - lastAt < minGapMs) return;
    if (lastSent !== null && Math.abs(shortestDelta(lastSent, smoothed)) < minStep) return;
    lastAt = t; lastSent = smoothed;
    onHeading?.(smoothed);
  }

  const listen = (on) => {
    const f = on ? win.addEventListener.bind(win) : win.removeEventListener.bind(win);
    f('deviceorientationabsolute', handle, true); f('deviceorientation', handle, true);
  };

  return {
    /** Starts listening. Resolves { ok: true } or { ok: false, reason: 'denied' | 'unsupported' }. */
    async start() {
      if (running) return { ok: true };
      const DOE = win.DeviceOrientationEvent;
      if (!DOE) { onUnavailable?.(); return { ok: false, reason: 'unsupported' }; }
      if (!granted && typeof DOE.requestPermission === 'function') {
        let res;
        try { res = await DOE.requestPermission(); } catch { res = 'denied'; }
        if (res !== 'granted') { onDenied?.(); return { ok: false, reason: 'denied' }; }
      }
      granted = true; running = true; got = false; smoothed = null; lastSent = null;
      listen(true);
      clearTimeout(timer);
      timer = setTimeout(() => { if (running && !got) onUnavailable?.(); }, waitMs);
      return { ok: true };
    },
    stop() { if (!running) return; running = false; listen(false); clearTimeout(timer); },
    isRunning: () => running,
    /** The latest smoothed heading, or null. */
    current: () => smoothed,
  };
}
