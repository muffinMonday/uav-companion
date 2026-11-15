# Chengdu candidate inputs

**Historical inputs:** Chengdu is live at production `b9e2378`; the candidate [Sichuan replacement](../../../../docs/regions/cn-sichuan.md) retires this registration. The source descriptor is now archived at `docs/china-airspace/evidence/chengdu-source-retired.json`; use that path in the historical reconstruction below. The boundary and original captures remain rollback evidence.

See [provenance and release state](../../../../docs/regions/cn-chengdu.md).
`boundary.geojson` is © OpenStreetMap contributors, ODbL 1.0; its geometry is
unchanged from the archived Nominatim response. `zones.geojson` is ignored raw data.

From the repository root, materialize the complete source using the existing
capture directory (adjust the read-only path if the earlier worktree was relocated):

```powershell
@'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fixtureEvidence,deduplicateEvidence} from './scripts/china-airspace/fixture-evidence.js';
import {sha256,stringify} from './scripts/china-airspace/core.js';
const base='../express-chongqing-chengdu/planning/express/chengdu-capture-network/responses/';
const hashes=['ea31059ccb0e2f1a09e1023a177a22eb41d7d2c552eb0b17c73fe4623fc9b64b','f5d7d7cfc3da631206353e24492b10112cb84ed7c0ac1201c3f6a8f33a1d3c71'];
const captures=['0-0','0-1'].map((id,i)=>{
  const bytes=fs.readFileSync(base+id+'.json');
  assert.equal(sha256(bytes),hashes[i]);
  return fixtureEvidence(JSON.parse(bytes));
});
const union=deduplicateEvidence(captures);
assert.equal(union.occurrences,59); assert.equal(union.items.length,57);
assert.equal(union.duplicates,2); assert.deepEqual(union.conflicts,[]);
const source={type:'FeatureCollection',coordinateSystem:'WGS84',features:union.items.map(x=>x.feature)};
const meta=JSON.parse(fs.readFileSync('data/regions/cn/chengdu/source.json'));
assert.equal(sha256(stringify(source)),meta.source.contentSha256);
fs.writeFileSync('data/regions/cn/chengdu/zones.geojson',JSON.stringify(source,null,2)+'\n');
'@ | node --input-type=module
```

Stop if the checksum/count assertions fail or the captures are unavailable.
Restore existing production artifacts before building only this region; see the
production-data preflight instructions in the provenance document. Deploy code,
manifest, original archive and strict boundary mask together.
