import { boundsOf, bboxIntersects, canonicalGeometry, polygons, equal, intersectsBox } from './geometry.js';
import { sha256, stringify, validBox } from './core.js';

export function fixtureEvidence(collection) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Expected original FeatureCollection');
  const b = collection.bounds, query = b ? [b.west,b.south,b.east,b.north] : null;
  if (query && !validBox(query)) throw new Error('Invalid source query bounds');
  const extent = [Infinity,Infinity,-Infinity,-Infinity], ids = new Map(), geometryIds = new Map(), items = [], structuralIssues = [];
  let positions=0, holes=0, rings=0, missingIds=0,clockwiseShells=0,counterclockwiseHoles=0;
  for (const [index,f] of collection.features.entries()) {
    const id = f?.properties?.id ?? f?.id;
    if (id === undefined || id === null) missingIds++;
    else ids.set(id,(ids.get(id)??0)+1);
    if (f?.type!=='Feature' || !['Polygon','MultiPolygon'].includes(f.geometry?.type) || !Array.isArray(f.geometry.coordinates) || !f.geometry.coordinates.length) { structuralIssues.push({index,id,reason:'unsupported-geometry'}); continue; }
    let structured=true;
    for (const poly of polygons(f.geometry)) {
      if(!Array.isArray(poly)||!poly.length) {structuralIssues.push({index,id,reason:'empty-polygon'});structured=false;continue;}
      holes+=Math.max(0,poly.length-1);
      for (const [ringIndex,ring] of poly.entries()) {
        if(!Array.isArray(ring)||ring.some(p=>!Array.isArray(p)||p.length!==2)) {structuralIssues.push({index,id,reason:'invalid-ring'});structured=false;continue;}
        rings++; positions+=ring.length;
        const signedArea=ring.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*ring[i+1][1]-ring[i+1][0]*p[1],0);
        if(ringIndex===0&&signedArea<0)clockwiseShells++;
        if(ringIndex>0&&signedArea>0)counterclockwiseHoles++;
        if (ring.length<4 || !equal(ring[0],ring.at(-1))) { structuralIssues.push({index,id,reason:'unclosed-or-short-ring'}); structured=false; }
        for (const p of ring) {
          if (p.length!==2 || !p.every(Number.isFinite) || Math.abs(p[0])>180 || Math.abs(p[1])>85) {structuralIssues.push({index,id,reason:'invalid-coordinate'});structured=false;}
        }
      }
    }
    if(!structured) continue;
    const bounds=boundsOf(f.geometry), geometryHash=sha256(stringify(canonicalGeometry(f.geometry)));
    for (let i=0;i<2;i++) {extent[i]=Math.min(extent[i],bounds[i]);extent[i+2]=Math.max(extent[i+2],bounds[i+2]);}
    const matching=geometryIds.get(geometryHash)??[]; matching.push(id);geometryIds.set(geometryHash,matching);
    items.push({id,bounds,geometryHash,feature:f});
  }
  return {items,summary:{features:collection.features.length,uniqueIds:ids.size,missingIds,duplicateIds:[...ids].filter(([,n])=>n>1).map(([id,count])=>({id,count})),duplicateGeometryGroups:[...geometryIds].filter(([,v])=>v.length>1).map(([hash,ids])=>({hash,ids})),geometryTypes:[...new Set(collection.features.map(f=>f.geometry?.type))],extent,positions,rings,holes,sourceWinding:{clockwiseShells,counterclockwiseHoles,preservedUnmodified:true},structuralIssues,query,sourceDeclaresCrs:collection.coordinateSystem??null,coordinateRangeValid:!structuralIssues.some(x=>x.reason==='invalid-coordinate'),bboxIntersectionMatches:query?items.filter(x=>bboxIntersects(x.bounds,query)).length:null,geometryNonIntersectionIds:query?items.filter(x=>!intersectsBox(x.feature.geometry,query)).map(x=>x.id):null,featuresExtendingBeyondQuery:query?items.filter(x=>x.bounds[0]<query[0]||x.bounds[1]<query[1]||x.bounds[2]>query[2]||x.bounds[3]>query[3]).length:null}};
}

export function deduplicateEvidence(evidence) {
  const ids=new Map(),geometries=new Map(),conflicts=[];
  let occurrences=0;
  for(const e of evidence)for(const item of e.items) {
    occurrences++;
    const previous=ids.get(item.id);
    if(previous && (previous.geometryHash!==item.geometryHash || stringify(previous.feature.properties)!==stringify(item.feature.properties))) conflicts.push(item.id);
    else ids.set(item.id,item);
    const same=geometries.get(item.geometryHash);
    if(same && stringify(same.feature.properties)!==stringify(item.feature.properties)) conflicts.push(item.id);
    if(!same || stringify(item.feature)<stringify(same.feature)) geometries.set(item.geometryHash,item);
  }
  return {items:[...geometries.values()].sort((a,b)=>a.geometryHash<b.geometryHash?-1:a.geometryHash>b.geometryHash?1:0),occurrences,uniqueIds:ids.size,duplicates:occurrences-geometries.size,conflicts:[...new Set(conflicts)].sort()};
}

export function compareEvidence(a,b) {
  const ai=new Map(a.items.map(x=>[x.id,x])),bi=new Map(b.items.map(x=>[x.id,x]));
  const shared=[...ai.keys()].filter(id=>bi.has(id)).sort();
  const common=a.summary.query&&b.summary.query?[Math.max(a.summary.query[0],b.summary.query[0]),Math.max(a.summary.query[1],b.summary.query[1]),Math.min(a.summary.query[2],b.summary.query[2]),Math.min(a.summary.query[3],b.summary.query[3])]:null;
  const selection=e=>new Set(e.items.filter(x=>bboxIntersects(x.bounds,common)).map(x=>x.id));
  const ac=common&&validBox(common)?selection(a):null,bc=ac?selection(b):null;
  return {sharedIds:shared.length,identicalSharedGeometry:shared.filter(id=>ai.get(id).geometryHash===bi.get(id).geometryHash).length,geometryConflictIds:shared.filter(id=>ai.get(id).geometryHash!==bi.get(id).geometryHash),onlyA:[...ai.keys()].filter(id=>!bi.has(id)).sort(),onlyB:[...bi.keys()].filter(id=>!ai.has(id)).sort(),commonQuery:ac?common:null,bboxSelectedOverlap:ac?{a:ac.size,b:bc.size,onlyA:[...ac].filter(x=>!bc.has(x)).sort(),onlyB:[...bc].filter(x=>!ac.has(x)).sort()}:null,provesUniversalFiltering:false,provesProvincialCompleteness:false};
}

export function knownUniverseFiltering(evidence,universe) {
  if(!evidence.summary.query) return {status:'unknown-query'};
  const received=new Set(evidence.items.map(x=>x.id)),predicted=new Set(universe.filter(x=>bboxIntersects(x.bounds,evidence.summary.query)).map(x=>x.id));
  const missing=[...predicted].filter(x=>!received.has(x)).sort(),unexpected=[...received].filter(x=>!predicted.has(x)).sort();
  return {knownUniverseFeatures:universe.length,received:received.size,predictedByBoundingBox:predicted.size,missing,unexpected,exactSampleMatch:!missing.length&&!unexpected.length,scope:'Observed fixture union only; does not test unknown/missing source features or prove a universal API contract.'};
}
