// The Fly in choices: each region archive's ID and the name shown for it on the dashboard. A region with no entry here shows its
// manifest name instead, so tests/region-labels-unit.mjs fails until every region in public/data has an entry. See ARCHITECTURE.md ("Fly In regions").
export const REGION_LABELS = {
  'cn-chongqing': 'Chongqing',
  'cn-guangdong': 'Guangdong',
  'cn-hubei': 'Hubei',
  'cn-hunan': 'Hunan',
  'cn-jilin': 'Jilin',
  'cn-ningxia': 'Ningxia',
  'cn-sichuan': 'Sichuan',
  'sg-nofly': 'Singapore',
};

/** The display label of a region (a manifest entry): its mapped name, else its manifest name. */
export const regionLabel = (r) => REGION_LABELS[r.id] ?? r.name;
