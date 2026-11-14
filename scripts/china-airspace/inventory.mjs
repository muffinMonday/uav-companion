// Validate the curated discovery inventory and regenerate its small, reviewable table.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '../..');
export function validateInventory(data) {
  const codes = '11 12 13 14 15 21 22 23 31 32 33 34 35 36 37 41 42 43 44 45 46 50 51 52 53 54 61 62 63 64 65'.split(' ').map(x => `CN-${x}`);
  if (data.regions?.length !== 31 || new Set(data.regions.map(x => x.regionCode)).size !== 31 || codes.some(c => !data.regions.some(x => x.regionCode === c))) throw new Error('Inventory must contain exactly the 31 mainland provincial divisions');
  const required = ['regionCode','regionId','name','governmentSourceUrl','thirdPartySourceUrl','dataFormat','acquisitionMethod','sourcePublicationDate','snapshotDate','completeness','crsVerification','geometryValidation','redistributionStatus','qualityClassification','integrationReadiness','lastCheckedDate','notes'];
  for (const r of data.regions) {
    if (required.some(k => !(k in r))) throw new Error(`${r.regionId}: missing inventory field`);
    if (!['verified-official','verified-reference','unverified-reference'].includes(r.qualityClassification)) throw new Error(`${r.regionId}: invalid quality class`);
    if (r.integrationReadiness !== 'blocked' && r.regionId !== 'cn-hubei') throw new Error('Discovery entries are not production approvals');
  }
  return true;
}
export function inventoryMarkdown(data) {
  validateInventory(data);
  const safe = s => String(s ?? 'Unknown').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return `# Nationwide acquisition inventory\n\nChecked ${data.checkedOn}. Machine-readable details: [inventory.json](../../data/china-airspace/inventory.json). This is a discovery inventory, not a coverage assertion. Dates below are notice publication dates, not polygon effective dates. The reference index claims 30 divisions; Beijing is absent. All new datasets remain blocked. Null fields mean unknown, never unrestricted airspace.\n\n| Division | Code | Official source / observation | Format | Publication date | Readiness |\n|---|---|---|---|---|---|\n` + data.regions.map(r => `| ${safe(r.name)} | ${r.regionCode} | ${r.governmentSourceUrl ? `[${safe(r.sourceStatus)}](${r.governmentSourceUrl})` : safe(r.sourceStatus)} | ${safe(r.dataFormat)} | ${safe(r.sourcePublicationDate)} | ${safe(r.integrationReadiness)} |`).join('\n') + '\n\nPer-entry acquisition method, snapshot date, completeness, CRS, geometry result, redistribution, quality, last check and limitations are in the JSON. `verified-official` for Hubei describes established source provenance; it does not resolve its existing alignment or licence caveats. No other entry has been assigned verified status.\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/china-airspace/inventory.json')));
  fs.writeFileSync(path.join(ROOT,'docs/china-airspace/INVENTORY.md'),inventoryMarkdown(data));
  console.log('Validated all 31 divisions and regenerated docs/china-airspace/INVENTORY.md');
}
