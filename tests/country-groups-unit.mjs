// Country buttons (src/app/country-menu.js, countryGroups): one group per supported country, a country with one region navigates
// directly, a country with several opens a menu of its regions sorted by label, no "China" menu item. Reads public/data only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
const { countryGroups } = await import(pathToFileURL(path.join(ROOT, 'src/app/country-menu.js')).href);
const { regionLabel } = await import(pathToFileURL(path.join(ROOT, 'src/app/region-labels.js')).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const data = path.join(ROOT, 'public/data');
const index = JSON.parse(fs.readFileSync(path.join(data, 'index.json'), 'utf8'));
const supported = index.countries.filter((c) => c.regions && c.view);
const areas = index.countries.filter((c) => c.manifest)
  .flatMap((c) => JSON.parse(fs.readFileSync(path.join(data, c.manifest), 'utf8')).regions.map((r) => ({ id: r.id, country: r.country, label: regionLabel(r), bounds: r.bounds })));

const groups = countryGroups(supported, areas);
const names = groups.map((g) => g.name);
ok(JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))), 'the country buttons are in name order: ' + names.join(', '));
ok(JSON.stringify(names) === JSON.stringify(['China', 'Malaysia', 'Singapore', 'Vietnam']), 'one button per supported country: ' + names.join(', '));

const sg = groups.find((g) => g.name === 'Singapore');
ok(sg && sg.areas.length === 1 && sg.areas[0].id === 'sg-nofly', 'Singapore has one region, so its button navigates directly (no menu)');

const cn = groups.find((g) => g.name === 'China');
const cnLabels = cn.areas.map((a) => a.label);
ok(cn.areas.length > 1, 'China has several regions, so its button opens a menu');
ok(JSON.stringify(cnLabels) === JSON.stringify(['Anhui', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong', 'Guangxi', 'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan', 'Inner Mongolia', 'Jiangsu', 'Jiangxi', 'Jilin', 'Liaoning', 'Ningxia', 'Qinghai', 'Shaanxi', 'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Tianjin', 'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang']), 'the China menu lists the regions by label, sorted: ' + cnLabels.join(', '));
ok(cnLabels.every((l) => /^[A-Z]/.test(l)), 'region labels are capitalised');
ok(!cnLabels.includes('China') && cn.areas.every((a) => a.country === 'cn'), 'no country-wide "China" item, and only China regions in its menu');

const none = countryGroups([{ id: 'xx', name: 'Nowhere', regions: 1, view: [0, 0, 1, 1] }], areas);
ok(none.length === 0, 'a country whose regions are not in the data gets no button');
