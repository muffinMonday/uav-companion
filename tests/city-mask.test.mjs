import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { PMTiles } from 'pmtiles';
import { maskPolygons, inMask, maskTilePoint } from '../src/coverage-mask.js';
import { buildTiles } from '../scripts/lib/tiles.js';
import { writePMTiles } from '../scripts/lib/pmtiles-writer.js';
import { zonesInArchive } from '../src/zones.js';

const root = path.resolve(import.meta.dirname, '..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const ring = (w, s, e, n) => [[w,s],[e,s],[e,n],[w,n],[w,s]];
const boundary = { type: 'MultiPolygon', coordinates: [
  [ring(103, 1, 103.1, 1.1), ring(103.04, 1.04, 103.06, 1.06)],
  [ring(103.15, 1.15, 103.2, 1.2)],
] };

test('strict mask handles multipart geometry, holes, invalid data and Mercator tile projection', () => {
  const polys = maskPolygons(boundary);
  assert.equal(inMask(polys, 1.02, 103.02), true);
  assert.equal(inMask(polys, 1.05, 103.05), false);
  assert.equal(inMask(polys, 1.17, 103.17), true);
  assert.equal(inMask(polys, 1.12, 103.12), false);
  for (const g of [null, {type:'Point',coordinates:[103,1]}, {type:'Polygon',coordinates:[]}, {type:'Polygon',coordinates:[[[0,0],[1,0],[0,1]]]}]) assert.throws(() => maskPolygons(g));
  for (const z of [3, 14, 19]) {
    const [x, y] = maskTilePoint([0,0], {x:2 ** (z-1),y:2 ** (z-1),z});
    assert.equal(x, 0); assert.equal(y, 0);
  }
});

test('Chengdu boundary contains city districts and excludes neighbouring cities', () => {
  const polys = maskPolygons(read(path.join(root, 'data/regions/cn/chengdu/boundary.geojson')));
  for (const [lat,lon] of [[30.66,104.063],[30.99,103.63],[30.39,104.55]]) assert(inMask(polys,lat,lon));
  for (const [lat,lon] of [[31.13,104.398],[30.07,103.85],[30.13,104.64],[30,100]]) assert(!inMask(polys,lat,lon));
});

// A synthetic polygon deliberately extends across both components and the mask hole.
test('real renderer and point checker agree; missing masks fail closed; rerenders and overzoom stay masked', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'planning/city-mask-test-'));
  const bounds = [102.98,.98,103.22,1.22];
  const features = [{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring(...bounds)]}}];
  const arc = writePMTiles({tiles:buildTiles(features,bounds),bounds,minZoom:3,maxZoom:14,metadata:{vector_layers:[{id:'zones',fields:{}}]}});
  fs.writeFileSync(path.join(dir,'zones.pmtiles'),arc);
  fs.writeFileSync(path.join(dir,'boundary.json'),JSON.stringify(boundary));
  fs.writeFileSync(path.join(dir,'blank.html'),'<!doctype html><style>:root{--zone:#008080}body{margin:0}#map{width:640px;height:480px}</style><div id="map"></div><script type="module">import L from "leaflet"; import "leaflet/dist/leaflet.css"; window.L=L;</script>');
  const server = await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null}});
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const prefix = '/' + path.relative(root,dir).replaceAll('\\','/');
    browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge'});
    for (const deviceScaleFactor of [1,2]) {
      const page = await browser.newPage({deviceScaleFactor});
      await page.goto(origin+prefix+'/blank.html');
      await page.waitForFunction(()=>!!window.L);
      const result = await page.evaluate(async ({prefix,origin}) => {
        const L = window.L;
        const {createZones} = await import('/src/map.js');
        const {initPointCheck,checkPoint} = await import('/src/pointcheck.js');
        const r = {id:'cn-mask-test',name:'Mask test',country:'cn',file:origin+prefix+'/zones.pmtiles',boundary:origin+prefix+'/boundary.json',bounds:[103,1,103.2,1.2],maxZoom:14,maskToBoundary:true,semantics:'allow',coverageMode:'positive-only',sourceConfidence:{mode:'selected-source'},source:{authority:'Test'}};
        const map = L.map('map',{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:false}).setView([1.02,103.02],14);
        const zones = createZones(map,[r]); zones.sync();
        initPointCheck([r]);
        const samples = [];
        const paintedAt = (lat,lon) => [...document.querySelectorAll('#map canvas')].some(c => {
          const b = c.getBoundingClientRect(), p = map.latLngToContainerPoint([lat,lon]), mb = map.getContainer().getBoundingClientRect();
          const x = (mb.left+p.x-b.left)*c.width/b.width, y = (mb.top+p.y-b.top)*c.height/b.height;
          if (x<0 || y<0 || x>=c.width || y>=c.height) return false;
          return c.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>0;
        });
        for (const [lat,lon,inside,z] of [[1.02,103.02,true,14],[1.05,103.05,false,14],[1.12,103.12,false,14],[1.17,103.17,true,14],[1.12,103.12,false,17],[1.02,103.02,true,17],[1.12,103.12,false,10],[1.02,103.02,true,10]]) {
          map.setView([lat,lon],z);
          await new Promise(resolve=>setTimeout(resolve,500));
          const painted = paintedAt(lat,lon);
          samples.push({inside,painted,status:(await checkPoint(lat,lon)).status,z});
        }
        // The library calls renderTile again when labels/tiles invalidate.
        map.setView([1.12,103.12],14);
        await new Promise(resolve=>setTimeout(resolve,400));
        map.eachLayer(l=>l.rerenderTiles?.());
        await new Promise(resolve=>setTimeout(resolve,300));
        const rerenderPainted = paintedAt(1.12,103.12);
        const legacy = {...r,id:'cn-hubei',maskToBoundary:undefined,coverageMode:undefined,sourceConfidence:undefined,boundary:null};
        initPointCheck([r,legacy]);
        const precedence = await checkPoint(1.02,103.02);
        const unavailable = {...r,id:'cn-missing-mask',boundary:origin+prefix+'/missing.json'};
        initPointCheck([unavailable]);
        const missing = await checkPoint(1.02,103.02);
        zones.setVisible(false);
        map.setView([1.02,103.02],14);
        const missingZones = createZones(map,[unavailable]); missingZones.sync();
        await new Promise(resolve=>setTimeout(resolve,400));
        const missingPainted = paintedAt(1.02,103.02);
        map.remove();
        return {samples,precedence:precedence.region.id,missing:missing.status,missingPainted,rerenderPainted};
      }, {prefix,origin});
      for (const s of result.samples) {
        assert.equal(s.painted,s.inside,JSON.stringify(s));
        assert.equal(s.status,s.inside?'inside':'nodata',JSON.stringify(s));
      }
      assert.equal(result.precedence,'cn-hubei');
      assert.equal(result.missing,'nodata');
      assert.equal(result.missingPainted,false);
      assert.equal(result.rerenderPainted,false);
      await page.close();
    }
  } finally {
    await browser?.close(); await server.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('built Chengdu archive retains all 57 original feature interiors and the six production registrations', {skip:!fs.existsSync(path.join(root,'public/data/cn/manifest.json'))}, async () => {
  const proof = read(process.env.CHENGDU_GEOS_REPORT || path.join(root,'docs/china-airspace/evidence/chengdu-mask-geos.json'));
  const manifest = read(path.join(root,'public/data/cn/manifest.json'));
  const r = manifest.regions.find(r=>r.id==='cn-chengdu');
  assert.equal(r.cells,57); assert.equal(r.maskToBoundary,true);
  const polys = maskPolygons(read(path.join(root,'public/data',r.boundary)));
  const bytes = fs.readFileSync(path.join(root,'public/data',r.file));
  const arc = new PMTiles({getKey:()=>r.file,getBytes:async(o,n)=>({data:Uint8Array.from(bytes.subarray(o,o+n)).buffer})});
  assert.equal(proof.features.length,57);
  for (const f of proof.features) {
    const p = f.originalInterior;
    assert((await zonesInArchive(arc,r.maxZoom,p.lat,p.lon)).length>0, f.id+' lost from archive');
    for (const key of ['maskedInterior','outsideMaskWithinBounds','outsideMaskInterior']) if(f[key]) {
      const p = f[key];
      assert.equal(inMask(polys,p.lat,p.lon),key==='maskedInterior',f.id+' '+key);
    }
  }
  for (const [id,n] of [['hubei',84863],['jilin',140],['hunan',53],['ningxia',79],['guangdong',101],['chongqing',777]]) assert.equal(manifest.regions.find(r=>r.id==='cn-'+id).cells,n);
});

test('real Chengdu mask gates all GEOS witnesses; Hubei and Singapore verdicts remain unchanged', {skip:!fs.existsSync(path.join(root,'public/data/cn/manifest.json'))}, async () => {
  const proof = read(path.join(root,'docs/china-airspace/evidence/chengdu-mask-geos.json'));
  const cases = proof.features.flatMap(f=>['maskedInterior','outsideMaskInterior','outsideMaskWithinBounds'].filter(k=>f[k]).map(k=>({...f[k],id:f.id,inside:k==='maskedInterior'})));
  const dir = fs.mkdtempSync(path.join(root,'planning/city-mask-app-'));
  fs.writeFileSync(path.join(dir,'blank.html'),'<!doctype html><style>:root{--zone:#008080}body{margin:0}#map{width:640px;height:480px}</style><div id="map"></div><script type="module">import L from "leaflet";import "leaflet/dist/leaflet.css";window.L=L;</script>');
  const server = await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null}});
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge'});
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(origin+'/'+path.relative(root,dir).replaceAll('\\','/')+'/blank.html');
    await page.waitForFunction(()=>!!window.L);
    const result = await page.evaluate(async cases=>{
      const {initPointCheck,checkPoint,zoneSummary} = await import('/src/pointcheck.js');
      const all = (await Promise.all(['cn','sg'].map(c=>fetch('/data/'+c+'/manifest.json').then(r=>r.json())))).flatMap(m=>m.regions);
      for(const r of all) { r.file = location.origin+'/data/'+r.file; if(r.boundary) r.boundary = location.origin+'/data/'+r.boundary; }
      const r = all.find(r=>r.id==='cn-chengdu');
      initPointCheck([r]);
      const answers = [];
      for(const p of cases) answers.push({...p,status:(await checkPoint(p.lat,p.lon)).status});
      initPointCheck(all);
      const legacy = [];
      for(const [lat,lon] of [[30,110],[30,112],[1.3020,103.8291],[1.2800,103.8600],[1.4927,103.7414]]) {
        const res = await checkPoint(lat,lon);
        legacy.push({status:res.status,region:res.region?.id,title:zoneSummary(res).title});
      }
      // Paint actual crossing source geometry on each side of the city boundary.
      const {createZones} = await import('/src/map.js');
      const pairs = cases.filter(p=>p.id==='sichuan-66-0' && (p.inside || p.lon>=r.bounds[0] && p.lon<=r.bounds[2] && p.lat>=r.bounds[1] && p.lat<=r.bounds[3]));
      const map = window.L.map('map',{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:false}).setView([pairs[0].lat,pairs[0].lon],14);
      const zones = createZones(map,[r]); zones.sync();
      const pixels = [];
      for(const p of pairs) {
        map.setView([p.lat,p.lon],14);
        await new Promise(resolve=>setTimeout(resolve,600));
        const painted = [...document.querySelectorAll('#map canvas')].some(c=>{
          const b=c.getBoundingClientRect(),mb=map.getContainer().getBoundingClientRect();
          const x=(mb.left+320-b.left)*c.width/b.width,y=(mb.top+240-b.top)*c.height/b.height;
          return x>=0&&y>=0&&x<c.width&&y<c.height&&c.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>0;
        });
        pixels.push({...p,painted});
      }
      map.remove();
      return {answers,legacy,pixels};
    },cases);
    for(const a of result.answers) assert.equal(a.status,a.inside?'inside':'nodata',a.id+' '+JSON.stringify(a));
    assert.deepEqual(result.legacy.map(r=>[r.status,r.region]),[['inside','cn-hubei'],['outside','cn-hubei'],['inside','sg-nofly'],['outside','sg-nofly'],['nodata',undefined]]);
    assert.match(result.legacy[0].title,/120 m/);
    assert.match(result.legacy[1].title,/controlled/);
    assert.match(result.legacy[2].title,/No-fly/);
    assert.match(result.legacy[3].title,/Not inside/);
    assert(result.pixels.some(p=>p.inside)); assert(result.pixels.some(p=>!p.inside));
    for(const p of result.pixels) assert.equal(p.painted,p.inside,JSON.stringify(p));
  } finally { await browser?.close(); await server.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
