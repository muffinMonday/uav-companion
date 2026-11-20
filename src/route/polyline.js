// Encoded polylines (precision 5, the Google/ORS format) and a small simplifier, so a stored route is a short string instead of a coordinate array.
// Coordinates here are [lat, lon] pairs.
const P = 1e5;

export function encodePolyline(points) {
  let out = '', pLat = 0, pLon = 0;
  const put = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } out += String.fromCharCode(n + 63); };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * P), b = Math.round(lon * P);
    put(a - pLat); put(b - pLon); pLat = a; pLon = b;
  }
  return out;
}

/** Decodes; returns [] for anything that is not a well-formed polyline. */
export function decodePolyline(str, maxPoints = 20000) {
  if (typeof str !== 'string' || !str.length || str.length > 400000) return [];
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  const get = () => {
    let shift = 0, result = 0, b;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift; shift += 5;
      if (shift > 30) return null;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    const a = get(), b = get();
    if (a === null || b === null) return [];
    lat += a; lon += b;
    if (pts.length >= maxPoints) return [];
    pts.push([lat / P, lon / P]);
  }
  return pts;
}

/** Douglas-Peucker on [lat, lon] pairs, tolerance in degrees (iterative: a long route cannot overflow the stack). */
export function simplify(points, tol) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const d2 = (p, a, b) => {
    const dx = b[1] - a[1], dy = b[0] - a[0], l = dx * dx + dy * dy;
    let t = l ? ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[1] + t * dx - p[1], y = a[0] + t * dy - p[0];
    return x * x + y * y;
  };
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, at = -1;
    for (let k = s + 1; k < e; k++) { const d = d2(points[k], points[s], points[e]); if (d > max) { max = d; at = k; } }
    if (at >= 0 && max > tol * tol) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return points.filter((_, k) => keep[k]);
}

/** Simplifies until the route has at most `maxPoints` points (the tolerance doubles each pass; the end points always stay). */
export function fitPoints(points, maxPoints = 1500, tol = 0.00002) {
  let out = simplify(points, tol), t = tol;
  while (out.length > maxPoints && t < 1) { t *= 2; out = simplify(points, t); }
  return out;
}
