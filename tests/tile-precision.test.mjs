import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTiles} from '../scripts/lib/tiles.js';
import {zonesInArchive} from '../src/zones.js';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {writePMTiles} from '../scripts/lib/pmtiles-writer.js';

// Exact original Chongqing triangle: no buffering, replacement point or geometry repair.
const feature={type:'Feature',properties:{id:'chongqing-271-0'},geometry:{type:'Polygon',coordinates:[[[106.482239,28.568576],[106.482241,28.568573],[106.482239,28.568573],[106.482239,28.568576]]]}};
const bounds=[106.482239,28.568573,106.482241,28.568576];
const arc=tiles=>({getZxy:async(z,x,y)=>{const t=tiles.find(t=>t.z===z&&t.x===x&&t.y===y);return t&&{data:t.data};}});
test('regional max-zoom precision preserves the original sub-metre polygon and geographic location',async()=>{
  const original=JSON.stringify(feature);
  const normal=buildTiles([feature],bounds);
  const precise=buildTiles([feature],bounds,()=>{},{maxZoomExtent:65536});
  assert.equal((await zonesInArchive(arc(normal),14,28.56857375,106.4822395)).length,0);
  assert.equal((await zonesInArchive(arc(precise),14,28.56857375,106.4822395))[0].id,feature.properties.id);
  for(const [lat,lon] of [[28.5685755,106.4822405],[28.568572,106.4822395],[28.568574,106.482242]])
    assert.equal((await zonesInArchive(arc(precise),14,lat,lon)).length,0);
  for(const tile of normal.filter(t=>t.z<14)) assert.deepEqual(precise.find(t=>t.z===tile.z&&t.x===tile.x&&t.y===tile.y),tile);
  const large={...feature,geometry:{type:'Polygon',coordinates:[[[106.4,28.5],[106.41,28.5],[106.41,28.51],[106.4,28.51],[106.4,28.5]]]}};
  const b=[106.4,28.5,106.41,28.51],a=buildTiles([large],b),p=buildTiles([large],b,()=>{},{maxZoomExtent:65536});
  assert(a.some(t=>t.z<14));
  assert.deepEqual(p.filter(t=>t.z<14),a.filter(t=>t.z<14));
  const tile=precise.find(t=>t.z===14);
  assert.equal(new VectorTile(new PbfReader(tile.data)).layers.zones.extent,65536);
  assert.equal(JSON.stringify(feature),original);
  assert.deepEqual(buildTiles([feature],bounds),normal);
  assert.throws(()=>buildTiles([feature],bounds,()=>{},{maxZoomExtent:123}),/extent/);
});

test('the sub-metre polygon renders at its correct location on desktop and mobile',async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const dir=fs.mkdtempSync(path.join(root,'planning/precision-render-'));
  const tiles=buildTiles([feature],bounds,()=>{},{maxZoomExtent:65536});
  fs.writeFileSync(path.join(dir,'tiny.pmtiles'),writePMTiles({tiles,bounds,minZoom:3,maxZoom:14,metadata:{}}));
  fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><style>html,body,#map{margin:0;width:100%;height:100%}</style><div id="map"></div><script type="module">
import L from 'leaflet';import 'leaflet/dist/leaflet.css';import {leafletLayer,PolygonSymbolizer} from 'protomaps-leaflet';
const map=L.map('map',{zoomControl:false,attributionControl:false,maxZoom:19}).setView([28.56857375,106.4822395],19);
leafletLayer({url:new URL('./tiny.pmtiles',location.href).href,maxDataZoom:14,maxZoom:19,paintRules:[{dataLayer:'zones',symbolizer:new PolygonSymbolizer({fill:'#e000a0'})}],labelRules:[]}).addTo(map);
</script>`);
  const server=await createServer({configFile:false,root,logLevel:'error',cacheDir:path.join(root,'planning/.precision-cache'),server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:['leaflet','protomaps-leaflet']}});
  let browser;
  try{
    await server.listen();browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge'});
    for(const viewport of [{width:800,height:600},{width:390,height:844}]){
      const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${path.relative(root,dir).replaceAll('\\','/')}/index.html`);
      await page.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>{
        const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<80&&d[i+2]>90&&d[i+3]>0)return true;return false;
      }));
      const pixels=await page.evaluate(()=>[...document.querySelectorAll('canvas')].flatMap(c=>{
        const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getBoundingClientRect(),out=[];
        for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<80&&d[i+2]>90&&d[i+3]>0)out.push([b.x+(i/4%c.width)*b.width/c.width,b.y+Math.floor(i/4/c.width)*b.height/c.height]);return out;
      }));
      assert(pixels.length>0&&pixels.length<100);
      assert(pixels.every(([x,y])=>Math.abs(x-viewport.width/2)<4&&Math.abs(y-viewport.height/2)<4));
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(dir,`render-${viewport.width}.png`)});await page.close();
    }
  }finally{await browser?.close();await server.close();}
});
