// Live check: the published manifest lists every expected region and every referenced artifact returns 200 with a matching SHA-256 prefix.
import crypto from 'node:crypto';
const base = process.argv[2] || 'https://uavcompanion.com/data/';
const want = Number(process.argv[3] || 0);
const j = async (u) => (await fetch(u + '?t=' + Date.now())).json();
const idx = await j(base + 'index.json'), man = await j(base + 'cn/manifest.json');
let bad = 0;
for (const r of man.regions) {
  const res = await fetch(base + r.file); const buf = Buffer.from(await res.arrayBuffer());
  const h = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  if (res.status !== 200 || !r.file.includes('.' + h + '.')) { bad++; console.log('BAD', r.id, res.status, h); }
}
console.log(JSON.stringify({ indexCn: idx.countries.find((c) => c.id === 'cn').regions, manifest: man.regions.length, sg: idx.countries.find((c) => c.id === 'sg')?.regions, bad, ok: !bad && (!want || man.regions.length === want) }));
process.exit(bad ? 1 : 0);
