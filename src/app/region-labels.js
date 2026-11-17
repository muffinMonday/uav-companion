// The Fly in choices: each region archive's ID and the name shown for it on the dashboard. A region with no entry here shows its
// manifest name instead, so tests/region-labels-unit.mjs fails until every region in public/data has an entry. See ARCHITECTURE.md ("Fly In regions").
export const REGION_LABELS = {
  'cn-anhui': 'Anhui',
  'cn-chongqing': 'Chongqing',
  'cn-fujian': 'Fujian',
  'cn-gansu': 'Gansu',
  'cn-guangdong': 'Guangdong',
  'cn-hebei': 'Hebei',
  'cn-hubei': 'Hubei',
  'cn-hunan': 'Hunan',
  'cn-jiangsu': 'Jiangsu',
  'cn-jiangxi': 'Jiangxi',
  'cn-jilin': 'Jilin',
  'cn-liaoning': 'Liaoning',
  'cn-ningxia': 'Ningxia',
  'cn-qinghai': 'Qinghai',
  'cn-shaanxi': 'Shaanxi',
  'cn-shanghai': 'Shanghai',
  'cn-shanxi': 'Shanxi',
  'cn-sichuan': 'Sichuan',
  'cn-tianjin': 'Tianjin',
  'cn-zhejiang': 'Zhejiang',
  'sg-nofly': 'Singapore no-fly zones',
};

/** The display label of a region (a manifest entry): its mapped name, else its manifest name. */
export const regionLabel = (r) => REGION_LABELS[r.id] ?? r.name;
