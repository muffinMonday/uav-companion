// Minimal PMTiles v3 writer (vector tiles, gzip). Enough for static hosting with range requests.
import zlib from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

const gz = (buf) => zlib.gzipSync(buf, { level: 9 });

function varint(out, n) {
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
}

function serializeDir(entries) {
  const out = [];
  varint(out, entries.length);
  let last = 0;
  for (const e of entries) { varint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) varint(out, e.runLength);
  for (const e of entries) varint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) varint(out, 0);
    else varint(out, e.offset + 1);
  }
  return gz(Buffer.from(out));
}

// Root directory (+ header) must fit in the first 16 KiB; split into leaf directories if not.
function buildDirectories(entries) {
  const LIMIT = 16384 - 127;
  let root = serializeDir(entries);
  if (root.length <= LIMIT) return { root, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize = Math.max(1, Math.floor(leafSize / 2))) {
    const leafBufs = [];
    const rootEntries = [];
    let off = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const buf = serializeDir(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset: off, length: buf.length, runLength: 0 });
      leafBufs.push(buf);
      off += buf.length;
    }
    root = serializeDir(rootEntries);
    if (root.length <= LIMIT) return { root, leaves: Buffer.concat(leafBufs) };
    if (leafSize === 1) throw new Error('Cannot fit PMTiles root directory');
  }
}

/** tiles: [{z,x,y,data:Buffer (uncompressed MVT)}]. bounds: [minLon,minLat,maxLon,maxLat]. */
export function writePMTiles({ tiles, bounds, minZoom, maxZoom, metadata }) {
  const sorted = tiles
    .map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: gz(t.data) }))
    .sort((a, b) => a.id - b.id);
  const entries = [];
  const chunks = [];
  let offset = 0;
  for (const t of sorted) {
    entries.push({ tileId: t.id, offset, length: t.data.length, runLength: 1 });
    chunks.push(t.data);
    offset += t.data.length;
  }
  const tileData = Buffer.concat(chunks);
  const { root, leaves } = buildDirectories(entries);
  const meta = gz(Buffer.from(JSON.stringify(metadata)));

  const rootOff = 127;
  const metaOff = rootOff + root.length;
  const leafOff = metaOff + meta.length;
  const dataOff = leafOff + leaves.length;

  const h = Buffer.alloc(127);
  h.write('PMTiles', 0, 'latin1');
  h.writeUInt8(3, 7);
  const u64 = (v, o) => h.writeBigUInt64LE(BigInt(v), o);
  u64(rootOff, 8); u64(root.length, 16);
  u64(metaOff, 24); u64(meta.length, 32);
  u64(leafOff, 40); u64(leaves.length, 48);
  u64(dataOff, 56); u64(tileData.length, 64);
  u64(entries.length, 72); u64(entries.length, 80); u64(entries.length, 88);
  h.writeUInt8(1, 96);   // clustered
  h.writeUInt8(2, 97);   // internal compression: gzip
  h.writeUInt8(2, 98);   // tile compression: gzip
  h.writeUInt8(1, 99);   // tile type: MVT
  h.writeUInt8(minZoom, 100); h.writeUInt8(maxZoom, 101);
  const e7 = (v) => Math.round(v * 1e7);
  h.writeInt32LE(e7(bounds[0]), 102); h.writeInt32LE(e7(bounds[1]), 106);
  h.writeInt32LE(e7(bounds[2]), 110); h.writeInt32LE(e7(bounds[3]), 114);
  h.writeUInt8(Math.min(maxZoom, Math.max(minZoom, 8)), 118);
  h.writeInt32LE(e7((bounds[0] + bounds[2]) / 2), 119);
  h.writeInt32LE(e7((bounds[1] + bounds[3]) / 2), 123);
  return Buffer.concat([h, root, meta, leaves, tileData]);
}
