import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PMTiles } from 'pmtiles';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { zonesInArchive } from '../src/zones.js';
import { inspectTree, compareToProduction, readRemovals } from '../scripts/lib/prod-data.js';

const root = path.resolve(import.meta.dirname,'..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const proof = read('docs/china-airspace/evidence/sichuan-geos.json');
const acquisition = read('docs/china-airspace/evidence/sichuan-acquisition.json');
const manifest = read('public/data/cn/manifest.json');
const region = manifest.regions.find(r=>r.id==='cn-sichuan');

test('complete Sichuan archive preserves all 468 original interiors without an administrative mask', async () => {
  assert.equal(region.cells,468); assert.equal(region.name,'Sichuan'); assert.equal(region.nameZh,'四川');
  assert.equal(region.maskToBoundary,undefined); assert.equal(region.boundary,null);
  assert.equal(region.coverageMode,'positive-only'); assert.equal(region.semantics,'allow');
  assert(!manifest.regions.some(r=>r.id==='cn-chengdu'));
  assert.equal(acquisition.originalChengdu.unchangedFeatures,57);
  assert.equal(proof.valid,true); assert.equal(proof.features,468);
  const bytes=fs.readFileSync(path.join(root,'public/data',region.file));
  const arc=new PMTiles({getKey:()=>region.file,getBytes:async(o,n)=>({data:Uint8Array.from(bytes.subarray(o,o+n)).buffer})});
  for(const [i,p] of proof.interiorWitnesses.entries()) assert((await zonesInArchive(arc,14,p.lat,p.lon)).length>0,'Lost source feature '+i);
});

test('approved replacement is atomic and cannot excuse unrelated production region loss', () => {
  const cand=inspectTree(path.join(root,'public/data')),prod=inspectTree(path.join(root,'planning/sichuan/production/data'));
  // Replay the reviewed approval against the saved pre-release baseline after release cleanup.
  const active=readRemovals(path.join(root,'data/removed-regions.json'));
  const completed=read('docs/china-airspace/evidence/sichuan-release.json').completedRemovalApproval || [];
  const removals=active.size ? active : new Map(completed.map(r=>[r.id,r]));
  assert.deepEqual([...removals.keys()],['cn-chengdu']);
  assert.deepEqual(cand.errors,[]); assert.deepEqual(prod.errors,[]);
  assert.deepEqual(compareToProduction(cand,prod,removals),[]);
  for(const [id,{region:r}] of prod.regions) if(id!=='cn-chengdu') {
    assert.deepEqual(cand.regions.get(id).region,r,id+' metadata changed');
    for(const f of [r.file,r.boundary,r.points].filter(Boolean)) assert(fs.readFileSync(path.join(root,'public/data',f)).equals(fs.readFileSync(path.join(root,'planning/sichuan/production/data',f))),f+' changed');
    const lost={...cand,regions:new Map(cand.regions)};lost.regions.delete(id);
    assert(compareToProduction(lost,prod,removals).some(x=>x.startsWith(id+':')),id+' loss accepted');
  }
  const partial={...cand,regions:new Map(cand.regions)};partial.regions.delete('cn-sichuan');
  assert(compareToProduction(partial,prod,removals).some(x=>x.includes('approved replacement cn-sichuan is missing')));
});

test('real map and point checker expose formerly masked polygons and preserve existing regional verdicts',async()=>{
  const dir=fs.mkdtempSync(path.join(root,'planning/sichuan-browser-'));
  fs.writeFileSync(path.join(dir,'blank.html'),'<!doctype html><style>:root{--zone:#008080}body{margin:0}#map{width:640px;height:480px}</style><div id="map"></div><script type="module">import L from "leaflet";import "leaflet/dist/leaflet.css";window.L=L;</script>');
  const server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null}});
  let browser;
  try {
    await server.listen();browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge'});
    const page=await browser.newPage();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(origin+'/'+path.relative(root,dir).replaceAll('\\','/')+'/blank.html');await page.waitForFunction(()=>!!window.L);
    const old=read('docs/china-airspace/evidence/chengdu-mask-geos.json');
    const witnesses=old.features.filter(f=>f.outsideMaskInterior).map(f=>f.outsideMaskInterior);
    const result=await page.evaluate(async({witnesses,interiors})=>{
      const {initPointCheck,checkPoint,zoneSummary}=await import('/src/pointcheck.js');
      const {zoneExplanation}=await import('/src/legends.js');
      const all=(await Promise.all(['cn','sg'].map(c=>fetch('/data/'+c+'/manifest.json').then(r=>r.json())))).flatMap(m=>m.regions);
      for(const r of all){r.file=location.origin+'/data/'+r.file;if(r.boundary)r.boundary=location.origin+'/data/'+r.boundary;}
      const r=all.find(r=>r.id==='cn-sichuan');initPointCheck([r]);
      const answers=[];for(const p of [...interiors,...witnesses])answers.push((await checkPoint(p.lat,p.lon)).status);
      const explanation=zoneExplanation(await checkPoint(witnesses[0].lat,witnesses[0].lon)).textContent;
      const unknown=(await checkPoint(25.95,97.25)).status;
      initPointCheck(all);const legacy=[];
      for(const [lat,lon] of [[30,110],[30,112],[1.302,103.8291],[1.28,103.86],[1.4927,103.7414]]){const a=await checkPoint(lat,lon);legacy.push([a.status,a.region?.id]);}
      const {createZones}=await import('/src/map.js');const p=witnesses[0];
      const map=window.L.map('map',{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:false}).setView([p.lat,p.lon],14);
      createZones(map,[r]).sync();await new Promise(resolve=>setTimeout(resolve,1200));
      const painted=[...document.querySelectorAll('#map canvas')].some(c=>{const b=c.getBoundingClientRect(),mb=map.getContainer().getBoundingClientRect();const x=(mb.left+320-b.left)*c.width/b.width,y=(mb.top+240-b.top)*c.height/b.height;return x>=0&&y>=0&&x<c.width&&y<c.height&&c.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>0;});
      map.remove();return {answers,unknown,legacy,explanation,painted};
    },{witnesses,interiors:proof.interiorWitnesses});
    assert(result.answers.every(s=>s==='inside'));assert.equal(result.unknown,'nodata');assert(result.painted,'Formerly masked geometry must render');
    assert.match(result.explanation,/Sichuan data: KDji/);assert.match(result.explanation,/unverified/);
    assert.deepEqual(result.legacy,[['inside','cn-hubei'],['outside','cn-hubei'],['inside','sg-nofly'],['outside','sg-nofly'],['nodata',undefined]]);
  } finally {await browser?.close();await server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
