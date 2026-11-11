// Ground elevation from Open-Meteo's elevation endpoint (a terrain model of roughly 90 m resolution, free for non-commercial use).
// Opt-in (privacy.js). Always requested with precise coordinates (4 decimals, about 10 m): at the ~1 km rounding used for
// weather, the terrain can differ by hundreds of metres in the mountains, so the answer would describe the wrong spot.
import { getPrivacy, setPrivacy } from './privacy.js';

const API = 'https://api.open-meteo.com/v1/elevation';
const KEY = 'uavzones.v1.elevcache';
const r4 = (v) => (Math.round(v * 1e4) / 1e4).toFixed(4);
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** One request for several points. Returns metres above sea level (or null) in the order given. */
export async function fetchElevations(points, signal) {
  const url = `${API}?latitude=${points.map((p) => r4(p.lat)).join(',')}&longitude=${points.map((p) => r4(wrapLon(p.lon))).join(',')}`;
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error(`http ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j.elevation) || j.elevation.length !== points.length) throw new Error('unexpected response');
  return j.elevation.map((v) => (Number.isFinite(v) ? v : null));
}

// Lookups for points that are not markers (map clicks, the location pin). Remembered for this page only.
const memo = new Map();
export function lookupElevation(lat, lon) {
  const key = `${r4(lat)},${r4(lon)}`;
  if (!memo.has(key)) memo.set(key, fetchElevations([{ lat, lon }]).then((r) => r[0]).catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
}

/** Elevation for saved markers, cached per marker (it only changes if the marker moves). */
export function createMarkerElevation({ getItems, onChange }) {
  let cache = {};
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && typeof d.items === 'object' && d.items) {
      for (const [id, e] of Object.entries(d.items)) if (e && Number.isFinite(e.lat) && Number.isFinite(e.lon) && Number.isFinite(e.m)) cache[id] = { m: e.m, lat: e.lat, lon: e.lon };
    }
  } catch { cache = {}; }
  const loading = new Set(), failed = new Set();

  const isOn = () => getPrivacy().fetchAltitude;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items: cache })); } catch { /* cache lives for this page only */ } };
  const emit = () => onChange?.();
  const here = (id) => { const it = getItems().find((i) => i.id === id); return it && cache[id] && r4(cache[id].lat) === r4(it.lat) && r4(cache[id].lon) === r4(it.lon); };

  return {
    enabled: isOn,

    /** Looks the marker's elevation up if it is on, not known yet and not already being fetched. */
    async ensure(id) {
      if (!isOn() || loading.has(id) || here(id)) return;
      const it = getItems().find((i) => i.id === id);
      if (!it || it.type === 'residence') return; // the Home marker (a residence) is never looked up automatically
      const twin = Object.values(cache).find((c) => r4(c.lat) === r4(it.lat) && r4(c.lon) === r4(it.lon)); // another visit at this spot
      if (twin) { cache[id] = { m: twin.m, lat: it.lat, lon: it.lon }; save(); emit(); return; }
      loading.add(id); failed.delete(id); emit();
      try {
        const [m] = await fetchElevations([{ lat: it.lat, lon: it.lon }]);
        if (isOn() && m !== null) { cache[id] = { m, lat: it.lat, lon: it.lon }; save(); } else if (m === null) failed.add(id);
      } catch { failed.add(id); }
      loading.delete(id); emit();
    },

    get(id) {
      return { value: here(id) ? cache[id].m : null, loading: loading.has(id), failed: failed.has(id) };
    },
    invalidate(id) { delete cache[id]; failed.delete(id); save(); },
    forget(id) { delete cache[id]; failed.delete(id); save(); },

    setEnabled(on) {
      setPrivacy({ fetchAltitude: on });
      if (!on) { cache = {}; memo.clear(); failed.clear(); save(); } // switching off forgets what was fetched
      emit();
    },
  };
}
