/**
 * Loads the region index, the manifests and the place lists. Nothing is fetched until this is called.
 * `urls` is { dataUrl, localUrl, mayHaveLocalData } from config.js (passed in so this file has no build-time dependency).
 * Regions built locally only (publish: false) sit in ./data-local; they are looked for on localhost and private addresses only,
 * and a failure there is ignored. A public failure rejects. Returns { index, regions, places }.
 */
export async function loadRegionData({ dataUrl, localUrl, mayHaveLocalData }) {
  const loadJson = async (path) => {
    const r = await fetch(dataUrl(path));
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  const index = await loadJson('index.json');
  const localManifests = [];
  if (mayHaveLocalData()) {
    try {
      const r = await fetch(localUrl('index.json'));
      const li = r.ok ? await r.json().catch(() => null) : null;
      for (const lc of li?.countries ?? []) {
        if (!lc.manifest) continue;
        const m = await (await fetch(localUrl(lc.manifest))).json();
        m.regions.forEach((x) => { x.local = true; });
        localManifests.push(m);
        const entry = index.countries.find((c) => c.id === lc.id);
        if (entry) entry.regions += m.regions.length; else index.countries.push({ ...lc, regions: m.regions.length, manifest: null, places: null });
      }
    } catch { /* no local data here: fine */ }
  }
  const [manifests, placeLists] = await Promise.all([
    Promise.all(index.countries.filter((c) => c.manifest).map((c) => loadJson(c.manifest))),
    Promise.all(index.countries.filter((c) => c.places).map((c) => loadJson(c.places))),
  ]);
  const regions = [...manifests, ...localManifests].flatMap((m) => m.regions);
  const places = placeLists.flat();
  return { index, regions, places };
}
