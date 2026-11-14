// Reproduce local pilot audits. This program contains no live-acquisition path.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquire, writeJson } from './acquire.js';
import { sha256, stringify, validateCollection } from './core.js';
import { fixtureEvidence, compareEvidence, deduplicateEvidence, knownUniverseFiltering } from './fixture-evidence.js';
import { previewHTML } from './preview.js';
import { readRegion } from '../lib/readers.js';
const ROOT=path.resolve(import.meta.dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const relative=p=>path.relative(ROOT,p).replaceAll('\\','/');

export async function resumePilots(args=[]) {
  const fromIndex=args.indexOf('--import-from');
  const importFrom=fromIndex<0?null:args[fromIndex+1];
  if(args.some((a,i)=>a!=='--import-only'&&a!=='--import-from'&&!(fromIndex>=0&&i===fromIndex+1))||fromIndex>=0&&!importFrom) throw new Error('Usage: resume-pilots.mjs [--import-from DIRECTORY] [--import-only]');
  const manifestFile=path.join(ROOT,'data/china-airspace/fixture-manifest.json'),manifest=read(manifestFile);
  for(const f of manifest.fixtures) {
    const file=path.resolve(ROOT,f.archive),allowed=path.join(ROOT,'planning/china-airspace/fixtures');
    if(!file.startsWith(allowed+path.sep))throw new Error('Archive path is outside fixture staging');
    if(!fs.existsSync(file)&&importFrom) {
      const source=path.resolve(importFrom,f.region,f.file),bytes=fs.readFileSync(source);
      if(sha256(bytes)!==f.sha256)throw new Error('Supplied original checksum mismatch: '+f.file);
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});
    }
    if(sha256(fs.readFileSync(file))!==f.sha256)throw new Error('Original archive checksum mismatch: '+f.file);
  }
  if(args.includes('--import-only')) {console.log('Verified '+manifest.fixtures.length+' original byte archives');return;}
  const auditFile=path.join(ROOT,'planning/china-airspace/local-pilots/geos-report.json'),audit=read(auditFile);
  if(audit.manifestSha256!==sha256(fs.readFileSync(manifestFile)))throw new Error('GEOS audit is not bound to the current fixture manifest; rerun validate_geos.py');
  const all=manifest.fixtures.map(f=>({...f,evidence:fixtureEvidence(read(path.resolve(ROOT,f.archive)))}));
  const summaries=[];
  for(const region of ['cn-guangdong','cn-chongqing']) {
    const fixtures=all.filter(x=>x.region===region),combined=deduplicateEvidence(fixtures.map(x=>x.evidence));
    const regionAudit=audit.regions.find(x=>x.region===region);
    const configFile=path.join(ROOT,'data/china-airspace/pilots',region+'.json'),config=read(configFile);
    config.localFiles=fixtures.map(f=>({file:path.relative(path.dirname(configFile),path.resolve(ROOT,f.archive)).replaceAll('\\','/'),bbox:f.evidence.summary.query}));
    config.validation={...config.validation,crs:'wgs84',idProperty:'id'};
    config.provenance={...config.provenance,crsDeclared:'WGS84',fixtureStatus:'Supplied original local responses; SHA-256 identities in ../fixture-manifest.json',sourceSnapshotFetchedAtClaims:[...new Set(fixtures.map(f=>f.metadataClaims.snapshotFetchedAt))],httpCaptureTime:null};
    writeJson(configFile,config);
    const out=path.join(ROOT,'planning/china-airspace/local-pilots',region);
    // Reuse the existing offline acquisition, archive and strict validation framework.
    const acquired=await acquire(config,path.dirname(configFile),out,{fetchImpl:()=>{throw new Error('Live HTTP is forbidden in local pilots');}});
    const fixtureReports=[];
    for(const f of fixtures) {
      const geos=audit.fixtures.find(x=>x.file===f.file&&x.sourceSha256===f.sha256);
      if(!geos)throw new Error('Missing checksum-bound GEOS result: '+f.file);
      const collection=read(path.resolve(ROOT,f.archive)),strict=validateCollection(collection,config.validation),issues=new Map();
      for(const error of strict.errors){const match=/^feature-(\d+):(.*)$/.exec(error);if(match){const index=Number(match[1]),old=issues.get(index)??[];old.push(match[2]);issues.set(index,old);}}
      fixtureReports.push({file:f.file,sha256:f.sha256,bytes:f.bytes,...f.evidence.summary,metadataClaims:f.metadataClaims,geos,strictPolicy:{valid:strict.valid,acceptedSubset:strict.features.length,budgetExhausted:strict.errors.some(x=>x.includes('budget-exhausted')),reviewFeatures:[...issues].map(([index,reasons])=>({index,id:collection.features[index].properties.id,reasons})),collectionErrors:strict.errors.filter(x=>!x.startsWith('feature-'))},knownUniverseFiltering:knownUniverseFiltering(f.evidence,combined.items)});
    }
    const comparisons=[];
    for(let i=0;i<fixtures.length;i++)for(let j=0;j<i;j++)comparisons.push({a:fixtures[j].file,b:fixtures[i].file,...compareEvidence(fixtures[j].evidence,fixtures[i].evidence)});
    const allGeometryValid=fixtureReports.every(f=>!f.structuralIssues.length&&!f.missingIds&&!f.duplicateIds.length&&f.sourceDeclaresCrs==='WGS84'&&f.coordinateRangeValid&&f.geos.invalidFeatures.length===0&&f.geos.validFeatures===f.features);
    const overlapValid=regionAudit?.overlaps.complete&&regionAudit.overlaps.positiveAreaPairs.length===0&&regionAudit.idConflicts.length===0;
    const completeReference={type:'FeatureCollection',coordinateSystem:'WGS84',features:combined.items.map(x=>x.feature)};
    const completeFile=path.join(out,'deduplicated-reference.geojson');
    // Retain original geometries, including all contacts that the conservative JS policy flags.
    // Only emit the complete derivative with a successful independent source-bound audit.
    if(allGeometryValid&&overlapValid&&!combined.conflicts.length)writeJson(completeFile,completeReference);
    const reader=allGeometryValid&&overlapValid&&!combined.conflicts.length?await readRegion(out,{id:region,format:'geojson',file:'deduplicated-reference.geojson',crs:'wgs84'}):null;
    const extent=combined.items.reduce((b,x)=>[Math.min(b[0],x.bounds[0]),Math.min(b[1],x.bounds[1]),Math.max(b[2],x.bounds[2]),Math.max(b[3],x.bounds[3])],[Infinity,Infinity,-Infinity,-Infinity]);
    const report={schemaVersion:2,region,checkedOn:manifest.receivedOn,status:allGeometryValid&&overlapValid&&!combined.conflicts.length?'technically-validated-reference-staging-with-policy-warnings':'staging-validation-incomplete',quality:'unverified-reference',networkRequests:acquired.report.acquisition.networkRequests,sourceOccurrences:combined.occurrences,uniqueIds:combined.uniqueIds,uniqueGeometries:combined.items.length,deduplicatedOccurrences:combined.duplicates,idOrPropertyConflicts:combined.conflicts,extent,fixtures:fixtureReports,comparisons,independentAudit:{sha256:sha256(fs.readFileSync(auditFile)),engine:audit.engine,region:regionAudit},strictPipeline:{...acquired.report.technical,note:'Conservative shell/hole contact policy; its normalized.geojson is a filtered subset, not the full reference dataset.'},completeReference:{file:relative(completeFile),emitted:!!reader,contentSha256:reader?sha256(stringify(completeReference)):null,features:reader?.features.length??0,geometryPolicy:'Original geometry unchanged; exact duplicates removed only. No repair, clipping, union, reprojection or PMTiles.'},pmtilesReaderCompatibility:reader?{supported:true,features:reader.features.length,bounds:reader.bounds,pmtilesGenerated:false}:null,resolvedBlockers:['original-local-fixtures-available-and-checksummed','source-declares-wgs84','source-snapshot-timestamp-claim-available','all-source-geometries-checked-by-geos','ids-unique-within-captures','source-union-overlaps-and-duplicates-checked'],remainingBlockers:['api-access-and-request-limits-unverified','universal-pagination-filtering-and-clipping-contract-unverified','crs-landmark-alignment-unverified','polygon-airspace-semantics-not-authoritatively-confirmed','province-wide-completeness-unproven','effective-date-and-current-validity-unverified','redistribution-not-cleared','conservative-pipeline-contact-policy-requires-review'],queryBounds:fixtures.map(x=>x.evidence.summary.query),provincialCompleteness:'unverified',regulatoryValidity:'unverified',integrationReady:false};
    report.completeReference.winding='Source ring order preserved; full RFC 7946 winding normalization remains a separate reviewed derivative.';
    report.remainingBlockers.push('complete-reference-winding-normalization-requires-review');
    writeJson(path.join(out,'pilot-report.json'),report);
    writeJson(path.join(ROOT,'docs/china-airspace/pilots',region+'.report.json'),report);
    fs.writeFileSync(path.join(out,'preview.html'),previewHTML(completeReference,report,config.bbox));
    summaries.push({region,status:report.status,occurrences:combined.occurrences,unique:combined.items.length,strictAcceptedSubset:acquired.report.technical.uniqueFeatures,rawGeometryValid:allGeometryValid,positiveAreaOverlaps:regionAudit.overlaps.positiveAreaPairs.length,output:relative(out)});
  }
  console.log(JSON.stringify(summaries,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)resumePilots(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
