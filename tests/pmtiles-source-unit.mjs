// Whole-file PMTiles source (src/pmtiles-source.js): memory and Cache API reuse, name-hash validation, eviction on a full store,
// fallback to memory. No browser needed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
const { wholeFileArchive, sharedArchive } = await import(pathToFileURL(path.join(ROOT, 'src/pmtiles-source.js')).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const sha8 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const digest = async (buf) => sha8(Buffer.from(buf));
const bytesOf = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 7) & 255);
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 15)); };
const silent = () => {};

// fake storage: named caches; the archive cache has a byte quota, the index cache does not
function makeCaches({ quota = Infinity } = {}) {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const used = () => [...(stores.get(name)).values()].reduce((s, b) => s + b.length, 0);
    return {
      match: async (k) => (m.has(k) ? new Response(m.get(k).slice()) : undefined),
      put: async (k, res) => {
        const body = Buffer.from(await res.arrayBuffer());
        const other = m.has(k) ? m.get(k).length : 0;
        if (name === 'uavzones-pmtiles-v1' && used() - other + body.length > quota) throw new DOMException('storage full', 'QuotaExceededError');
        m.set(k, body);
      },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (k) => m.delete(k),
    };
  };
  return { open, archive: () => stores.get('uavzones-pmtiles-v1') ?? new Map(), index: () => stores.get('uavzones-pmtiles-index-v1') ?? new Map() };
}
const fakeFetch = (table) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const body = table[url];
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(body).buffer }; // exact-length copy
  };
  return { f, calls };
};
let clock = 1000;
const deps = (over = {}) => ({ fetch: over.fetch, caches: over.caches ?? null, digest, warn: silent, info: silent, now: () => ++clock, referenced: () => new Set(), estimate: async () => null, ...over });

const A = bytesOf(5000, 37), B = bytesOf(5000, 11), C = bytesOf(5000, 53), BIG = bytesOf(13000, 5);
const urlA = `https://example.test/data/tiles/cn/cn-a.${sha8(A)}.pmtiles`;
const urlB = `https://example.test/data/tiles/cn/cn-b.${sha8(B)}.pmtiles`;
const urlC = `https://example.test/data/tiles/cn/cn-c.${sha8(C)}.pmtiles`;
const urlBig = `https://example.test/data/tiles/cn/cn-big.${sha8(BIG)}.pmtiles`;

// 1. ranges are slices; one download serves every range in a session
{
  const net = fakeFetch({ [urlA]: A });
  const a = wholeFileArchive(urlA, deps({ fetch: net.f }));
  const r1 = await a.source.getBytes(0, 127);
  const r2 = await a.source.getBytes(4000, 1000);
  const r3 = await a.source.getBytes(4990, 100);
  ok(Buffer.from(r1.data).equals(Buffer.from(A.slice(0, 127))), 'first range is the first 127 bytes');
  ok(Buffer.from(r2.data).equals(Buffer.from(A.slice(4000, 5000))), 'a middle range matches the file');
  ok(r3.data.byteLength === 10, 'a range past the end is clipped to the file');
  ok(net.calls.length === 1, `one download for three ranges (saw ${net.calls.length})`);
}

// 2. first visit stores; a reload (new session, same caches) is served from storage with no download
{
  const caches = makeCaches();
  const net1 = fakeFetch({ [urlA]: A });
  const s1 = wholeFileArchive(urlA, deps({ fetch: net1.f, caches }));
  await s1.source.getBytes(0, 10);
  await settle();
  ok(net1.calls.length === 1 && caches.archive().has(urlA), 'first visit: downloaded once and stored under its URL');
  const net2 = fakeFetch({ [urlA]: A });
  const s2 = wholeFileArchive(urlA, deps({ fetch: net2.f, caches }));
  const r = await s2.source.getBytes(4990, 10);
  ok(net2.calls.length === 0 && Buffer.from(r.data).equals(Buffer.from(A.slice(4990, 5000))), 'reload: served from storage, no download, same bytes');
  ok(caches.index().size === 1, 'the last-use record lists the stored archive');
}

// 3. a stored copy that does not match its name is dropped and downloaded again
{
  const caches = makeCaches();
  (await caches.open('uavzones-pmtiles-v1')).put(urlA, new Response(Buffer.from(bytesOf(4000, 3))));
  await settle();
  const net = fakeFetch({ [urlA]: A });
  const s = wholeFileArchive(urlA, deps({ fetch: net.f, caches }));
  const r = await s.source.getBytes(0, 16);
  await settle();
  ok(net.calls.length === 1 && Buffer.from(r.data).equals(Buffer.from(A.slice(0, 16))), 'bad stored copy: dropped, re-downloaded, correct bytes used');
  ok(Buffer.from(caches.archive().get(urlA)).equals(Buffer.from(A)), 'bad stored copy: replaced by the valid archive');
}

// 4. a download whose bytes do not match the name is rejected and not stored
{
  const caches = makeCaches();
  const net = fakeFetch({ [urlA]: bytesOf(5000, 99) });
  const s = wholeFileArchive(urlA, deps({ fetch: net.f, caches }));
  let threw = false;
  try { await s.source.getBytes(0, 10); } catch (e) { threw = /does not match/.test(e.message); }
  await settle();
  ok(threw && !caches.archive().has(urlA), 'mismatched download: rejected, not stored');
}

// 5. a failed download is not stored, and a later read downloads and stores it
{
  const caches = makeCaches();
  const net = fakeFetch({});
  const s = wholeFileArchive(urlA, deps({ fetch: net.f, caches }));
  let threw = false;
  try { await s.source.getBytes(0, 10); } catch (e) { threw = /404/.test(e.message); }
  await settle();
  ok(threw && !caches.archive().has(urlA), 'HTTP 404: rejects, nothing stored');
  const net2 = fakeFetch({ [urlA]: A });
  const s2 = wholeFileArchive(urlA, deps({ fetch: net2.f, caches }));
  const r = await s2.source.getBytes(0, 10);
  await settle();
  ok(r.data.byteLength === 10 && caches.archive().has(urlA), 'a later read downloads and stores it');
}

// 6. storage full: one eviction, preferring an archive no longer referenced, then the save is retried and succeeds
{
  const caches = makeCaches({ quota: 12000 }); // two 5000-byte archives fit, a third does not
  const refs = new Set([urlB, urlC]); // A is not referenced by the current manifests
  const d = deps({ caches, referenced: () => refs });
  const net = fakeFetch({ [urlA]: A, [urlB]: B, [urlC]: C });
  const s = (u) => wholeFileArchive(u, { ...d, fetch: net.f });
  await s(urlB).source.getBytes(0, 1); await settle(); // B: older use
  await s(urlA).source.getBytes(0, 1); await settle(); // A: newer use, but not referenced
  const warnings = [];
  const d2 = { ...d, fetch: net.f, warn: (...x) => warnings.push(x) };
  await wholeFileArchive(urlC, d2).source.getBytes(0, 1);
  await settle();
  ok(caches.archive().has(urlC) && caches.archive().has(urlB), 'storage full: the new archive is saved and the referenced one stays');
  ok(!caches.archive().has(urlA), 'storage full: the unreferenced archive is the one evicted (not the older referenced one)');
  ok(warnings.length === 0, 'a successful retry logs no warning');
}

// 7. storage still full after one eviction: nothing else is deleted, the map is served from memory, persistence stops
{
  const caches = makeCaches({ quota: 12000 });
  const d = deps({ caches, referenced: () => new Set([urlBig]) });
  const net = fakeFetch({ [urlA]: A, [urlBig]: BIG, [urlC]: C });
  const warnings = [];
  const dd = { ...d, fetch: net.f, warn: (...x) => warnings.push(x) };
  await wholeFileArchive(urlA, dd).source.getBytes(0, 1); await settle();
  const big = wholeFileArchive(urlBig, dd);
  const r = await big.source.getBytes(0, 16);
  await settle();
  ok(Buffer.from(r.data).equals(Buffer.from(BIG.slice(0, 16))), 'still full: the archive is served from memory');
  ok(!caches.archive().has(urlBig) && !caches.archive().has(urlA), 'still full: one eviction, and the archive that does not fit is not stored');
  await wholeFileArchive(urlC, dd).source.getBytes(0, 1); await settle();
  ok(!caches.archive().has(urlC), 'still full: persistence is off for the rest of the session (no more saves)');
  ok(warnings.some((w) => /memory/.test(String(w[0]))), 'still full: the failure is reported');
}

// 8. no Cache API: works as before, nothing persisted
{
  const net = fakeFetch({ [urlA]: A });
  const s = wholeFileArchive(urlA, deps({ fetch: net.f, caches: null }));
  const r = await s.source.getBytes(0, 10);
  ok(r.data.byteLength === 10 && net.calls.length === 1, 'no Cache API: downloads and serves');
}

// 9. a URL without a content hash is never stored
{
  const plain = 'https://example.test/data/tiles/cn/plain.pmtiles';
  const caches = makeCaches();
  const net = fakeFetch({ [plain]: A });
  await wholeFileArchive(plain, deps({ fetch: net.f, caches })).source.getBytes(0, 10);
  await settle();
  ok(caches.archive().size === 0, 'unhashed name: not stored');
}

// 10. one reader per URL for the page (map and point check share the copy in memory)
ok(sharedArchive(urlA) === sharedArchive(urlA) && sharedArchive(urlA) !== sharedArchive(urlB), 'sharedArchive: one reader per URL');

// 11. a real archive read through the source gives a valid header (skipped when the local build is absent)
const local = path.join(ROOT, 'public/data/tiles/sg/sg-nofly.52266140.pmtiles');
if (fs.existsSync(local)) {
  const buf = fs.readFileSync(local);
  const url = `https://example.test/data/tiles/sg/sg-nofly.${sha8(buf)}.pmtiles`;
  const real = wholeFileArchive(url, deps({ fetch: fakeFetch({ [url]: buf }).f, caches: makeCaches() }));
  const h = await real.getHeader();
  ok(h.tileType === 1 && h.minZoom === 3 && h.maxZoom === 14, 'header of the local Singapore archive reads through the source (MVT, zoom 3 to 14)');
} else {
  console.log('SKIP  header check: no local Singapore archive in public/data/tiles');
}
