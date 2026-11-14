import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { PMTiles } from 'pmtiles';
import { zonesInArchive } from '../../src/zones.js';
import { inGeometry } from '../china-airspace/geometry.js';

// Uses the application's actual polygon query, including holes, against the built archive.
export async function pointSmoke(file, collection, checks) {
  const bytes = fs.readFileSync(file);
  const arc = new PMTiles({ getKey: () => file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
  const header = await arc.getHeader();
  if (!header.numAddressedTiles || header.tileType !== 1) throw new Error('Empty/non-vector PMTiles');
  for (const { lon, lat, inside } of checks) {
    const source = collection.features.some(f => inGeometry([lon, lat], f.geometry) >= 0);
    const tiled = (await zonesInArchive(arc, header.maxZoom, lat, lon)).length > 0;
    if (source !== inside || tiled !== inside) throw new Error(`Point smoke failed at ${lon},${lat}: source=${source}, tiles=${tiled}, expected=${inside}`);
  }
  return { points: checks.length, tiles: header.numAddressedTiles };
}

export async function renderSmoke(dir, manifest) {
  const root = path.resolve(import.meta.dirname, '../..');
  const payload = JSON.stringify({ file: `./tiles/${manifest.file}`, bounds: manifest.bounds }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><title>Local PMTiles rendering smoke</title>
<style>body{margin:0}#map{width:800px;height:600px}</style><div id="map"></div>
<script type="module">
import L from 'leaflet'; import 'leaflet/dist/leaflet.css';
import {leafletLayer,PolygonSymbolizer} from 'protomaps-leaflet';
const data=${payload}; const map=L.map('map',{zoomControl:false,attributionControl:false});
const b=data.bounds; map.fitBounds([[b[1],b[0]],[b[3],b[2]]]);
leafletLayer({url:new URL(data.file,location.href).href,maxDataZoom:14,
paintRules:[{dataLayer:'zones',symbolizer:new PolygonSymbolizer({fill:'#e000a0'})}],labelRules:[]}).addTo(map);
</script>`;
  fs.writeFileSync(path.join(dir, 'render.html'), html);
  const server = await createServer({ configFile: false, root, cacheDir: path.join(root, 'planning/.airspace-vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true, include: ['leaflet', 'protomaps-leaflet'] } });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const url = path.relative(root, path.join(dir, 'render.html')).split(path.sep).map(encodeURIComponent).join('/');
    await page.goto(`${origin}/${url}`);
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] > 90 && data[i + 3] > 100) return true;
      return false;
    }), null, { timeout: 30000 });
    if (errors.length) throw new Error(`Rendering errors: ${errors.join('; ')}`);
    await page.screenshot({ path: path.join(dir, 'render.png') });
    return { renderer: 'leaflet/protomaps-leaflet', painted: true, pageErrors: 0 };
  } finally { await browser?.close(); await server.close(); }
}
