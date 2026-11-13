// loadRegionData (src/app/region-loader.js): public data, optional local-only regions, failures. fetch is stubbed; no browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { loadRegionData } = await import(pathToFileURL(path.join(ROOT, 'src/app/region-loader.js')).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const urls = (local) => ({ dataUrl: (p) => `pub:${p}`, localUrl: (p) => `loc:${p}`, mayHaveLocalData: () => local });
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => (body instanceof Error ? Promise.reject(body) : JSON.parse(JSON.stringify(body))) });
function stub(files, { delay = 0, log = [], active = { now: 0, max: 0 } } = {}) {
  globalThis.fetch = async (u) => {
    log.push(u); active.now++; active.max = Math.max(active.max, active.now);
    await new Promise((r) => setTimeout(r, delay));
    active.now--;
    if (!(u in files)) return reply({}, 404);
    return reply(files[u]);
  };
  return { log, active };
}
const pubIndex = () => ({ countries: [
  { id: 'sg', name: 'Singapore', regions: 1, manifest: 'sg/manifest.json', places: 'sg/places.json' },
  { id: 'cn', name: 'China', regions: 1, manifest: 'cn/manifest.json', places: null },
  { id: 'xx', name: 'Nowhere', regions: 0, manifest: null, places: null },
] });
const pubFiles = () => ({
  'pub:index.json': pubIndex(),
  'pub:sg/manifest.json': { regions: [{ id: 'sg1', name: 'SG' }] },
  'pub:cn/manifest.json': { regions: [{ id: 'cn1', name: 'CN' }, { id: 'cn2', name: 'CN2' }] },
  'pub:sg/places.json': [{ name: 'A' }, { name: 'B' }],
});

// public only
let s = stub(pubFiles());
let r = await loadRegionData(urls(false));
ok(r.regions.map((x) => x.id).join() === 'sg1,cn1,cn2' && r.places.length === 2 && r.index.countries.length === 3, 'public: regions in country order, places flattened, index kept');
ok(!s.log.some((u) => u.startsWith('loc:')), 'public: no local request when local data is not possible on this address');

// manifests and place lists are requested at the same time
s = stub(pubFiles(), { delay: 15 });
await loadRegionData(urls(false));
ok(s.active.max >= 3, `concurrency: manifests and places overlap (${s.active.max} requests at once)`);

// local regions are merged: new country added, existing country's count raised, regions follow public ones and are flagged
let files = { ...pubFiles(),
  'loc:index.json': { countries: [{ id: 'sg', name: 'Singapore', manifest: 'sg-local.json' }, { id: 'hb', name: 'Hubei', view: [1, 2, 3, 4], manifest: 'hb.json' }, { id: 'nm', name: 'No manifest' }] },
  'loc:sg-local.json': { regions: [{ id: 'sgl' }] },
  'loc:hb.json': { regions: [{ id: 'hb1' }, { id: 'hb2' }] } };
stub(files);
r = await loadRegionData(urls(true));
const sg = r.index.countries.find((c) => c.id === 'sg'), hb = r.index.countries.find((c) => c.id === 'hb');
ok(r.regions.map((x) => x.id).join() === 'sg1,cn1,cn2,sgl,hb1,hb2', 'local: local regions come after the public ones');
ok(r.regions.filter((x) => x.local).map((x) => x.id).join() === 'sgl,hb1,hb2', 'local: only local regions are flagged');
ok(sg.regions === 2 && hb.regions === 2 && hb.manifest === null && hb.places === null && hb.view.length === 4, 'local: an existing country counts the extra region; a new country is added with no public manifest or places');
ok(!r.index.countries.some((c) => c.id === 'nm' && c.regions), 'local: an entry without a manifest adds nothing');

// no local data here: fine
for (const [label, extra] of [['missing local index', {}], ['local index is not JSON', { 'loc:index.json': new Error('bad json') }], ['local manifest missing', { 'loc:index.json': { countries: [{ id: 'q', manifest: 'gone.json' }] } }]]) {
  stub({ ...pubFiles(), ...extra });
  r = await loadRegionData(urls(true)).catch((e) => e);
  ok(!(r instanceof Error) && r.regions.length === 3, `local failure tolerated: ${label}`);
}

// a public failure rejects with the path and status
const f = pubFiles(); delete f['pub:cn/manifest.json']; stub(f);
r = await loadRegionData(urls(false)).catch((e) => e);
ok(r instanceof Error && /cn\/manifest\.json: 404/.test(r.message), 'public failure: rejects naming the file and status');
stub({}); r = await loadRegionData(urls(false)).catch((e) => e);
ok(r instanceof Error && /index\.json: 404/.test(r.message), 'public failure: a missing index rejects');
