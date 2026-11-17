// Range-vs-full-file probe against production. Usage: node rangeprobe.mjs <base> <file...>
import crypto from 'node:crypto';
const base = process.argv[2];
const files = process.argv.slice(3);
const out = [];
for (const f of files) {
  const url = `${base}/${f}`;
  const full = await fetch(url, { cache: 'no-store' });
  const ref = Buffer.from(await full.arrayBuffer());
  const hash = crypto.createHash('sha256').update(ref).digest('hex').slice(0, 8);
  const want = /\.([0-9a-f]{8})\.pmtiles$/.exec(f)[1];
  const dv = new DataView(ref.buffer, ref.byteOffset, ref.byteLength);
  const big = (o) => Number(dv.getBigUint64(o, true));
  const rootOff = big(8), rootLen = big(16), metaOff = big(24), metaLen = big(32), dataOff = big(56), dataLen = big(64);
  const N = ref.length;
  const ranges = [
    ['header', 0, 127], ['root', rootOff, rootOff + rootLen - 1], ['meta', metaOff, metaOff + Math.min(metaLen, 4096) - 1],
    ['data-start', dataOff, dataOff + 4095], ['data-mid', dataOff + (dataLen >> 1), dataOff + (dataLen >> 1) + 9999],
    ['data-3/4', dataOff + Math.floor(dataLen * 0.75), dataOff + Math.floor(dataLen * 0.75) + 49999], ['tail', N - 1000, N - 1],
    ['odd', 12345, 99999],
  ].map(([n, a, b]) => [n, a, Math.min(b, N - 1)]);
  const res = { file: f, size: N, fullStatus: full.status, fullHashOk: hash === want, fullHdr: { ar: full.headers.get('accept-ranges'), cc: full.headers.get('cache-control'), etag: full.headers.get('etag'), cors: full.headers.get('access-control-allow-origin'), ce: full.headers.get('content-encoding'), via: full.headers.get('x-cache') ?? full.headers.get('age') }, ranges: [] };
  for (let rep = 0; rep < 3; rep++) {
    for (const [n, a, b] of ranges) {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
      const body = Buffer.from(await r.arrayBuffer());
      const exp = ref.subarray(a, b + 1);
      const cr = r.headers.get('content-range');
      res.ranges.push({
        rep, n, status: r.status, cr, crOk: cr === `bytes ${a}-${b}/${N}`, cl: r.headers.get('content-length'), clOk: Number(r.headers.get('content-length')) === exp.length,
        lenOk: body.length === exp.length, bytesOk: body.equals(exp), age: r.headers.get('age'), xc: r.headers.get('x-cache'),
      });
    }
  }
  const bad = res.ranges.filter((x) => !(x.status === 206 && x.crOk && x.clOk && x.lenOk && x.bytesOk));
  res.badCount = bad.length; res.total = res.ranges.length; res.bad = bad.slice(0, 5);
  out.push(res);
}
console.log(JSON.stringify(out, null, 1));
