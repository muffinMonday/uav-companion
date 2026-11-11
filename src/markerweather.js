// Automatic weather summaries for saved markers (opt-in; off by default, see privacy.js).
// When on: a marker's weather is fetched when it is placed, and all markers are refreshed on page load if the last
// bulk refresh is more than 30 minutes old. Results are cached in this browser, apart from the markers themselves,
// so they are never exported and are dropped when the feature is switched off.
import { fetchSummaries } from './weather.js';
import { getPrivacy, setPrivacy } from './privacy.js';

const KEY = 'uavzones.v1.wxcache';
export const INTERVAL_MS = 30 * 60 * 1000; // bulk refresh at most this often
const STALE_MS = 3 * 60 * 60 * 1000;       // older than this is labelled outdated
const CHUNK = 50;                          // points per request

const num = (v) => (Number.isFinite(v) ? v : null);
/** An hourly list read back from storage: up to 6 numbers or nulls, or undefined for an entry saved before rain was fetched. */
const hours = (a) => (Array.isArray(a) ? a.slice(0, 6).map(num) : undefined);

/**
 * What the next hours hold for rain, from a cached entry. kind 'prob' (a chance in %, peak and the hour it peaks), 'mm' (no chance from
 * the model, only expected millimetres, total), 'none' (the model gave neither) or null for an entry saved before rain was fetched.
 * hours: [{ label: '15:00', p, mm }].
 */
export function rainOutlook(e) {
  if (!e || !Array.isArray(e.pp) || !Array.isArray(e.pr)) return null;
  const [h0] = String(e.start).split(':').map(Number);
  const count = Math.max(e.pp.length, e.pr.length);
  const list = Array.from({ length: count }, (_, i) => ({ label: `${String(((Number.isFinite(h0) ? h0 : 0) + i) % 24).padStart(2, '0')}:00`, p: e.pp[i] ?? null, mm: e.pr[i] ?? null }));
  const probs = list.filter((x) => x.p !== null);
  if (probs.length) {
    const peak = Math.max(...probs.map((x) => x.p));
    return { kind: 'prob', peak, at: probs.find((x) => x.p === peak).label, hours: list };
  }
  const mms = list.filter((x) => x.mm !== null);
  if (mms.length) return { kind: 'mm', total: mms.reduce((a, x) => a + x.mm, 0), hours: list };
  return { kind: 'none', hours: list };
}

function loadCache() {
  const empty = { lastBulk: null, items: {} };
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!d || typeof d.items !== 'object' || !d.items) return empty;
    const items = {};
    for (const [id, e] of Object.entries(d.items)) {
      if (!e || !Number.isFinite(e.t) || typeof e.start !== 'string') continue;
      items[id] = { t: e.t, temp: num(e.temp), wind: num(e.wind), gust: num(e.gust), n: Number.isFinite(e.n) ? e.n : 0, start: e.start.slice(0, 5), tz: String(e.tz || '').slice(0, 12), pp: hours(e.pp), pr: hours(e.pr) };
    }
    return { lastBulk: Number.isFinite(d.lastBulk) ? d.lastBulk : null, items };
  } catch { return empty; }
}

/** "14:05" for today, "10 Nov 14:05" otherwise, in the visitor's own time. */
export function formatWhen(ms) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function createMarkerWeather({ getItems, onChange }) {
  let cache = loadCache();
  let running = false, failed = false;
  const loading = new Set();
  const pending = new Set();

  const isOn = () => getPrivacy().autoWeather;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, ...cache })); } catch { /* storage blocked: cache lives for this page only */ } };
  const emit = () => onChange?.();
  const ids = () => getItems().map((i) => i.id);

  /** Fetches the given marker ids in batches. A bulk run also stamps the time of the refresh. */
  async function run(wanted, { bulk }) {
    const live = new Map(getItems().map((i) => [i.id, i]));
    // The Home marker is the traveller's residence: it is never sent to a weather service automatically.
    const points = wanted.filter((id) => live.has(id) && live.get(id).type !== 'residence').map((id) => ({ id, lat: live.get(id).lat, lon: live.get(id).lon }));
    if (!points.length) return;
    // several visits to one place share a spot: ask for it once and give every one of them the answer
    const keyOf = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const twins = new Map(), unique = [];
    for (const p of points) { const k = keyOf(p); if (twins.has(k)) twins.get(k).push(p.id); else { twins.set(k, [p.id]); unique.push(p); } }
    const keyById = new Map(unique.map((u) => [u.id, keyOf(u)]));
    if (running) { points.forEach((p) => pending.add(p.id)); return; } // picked up when the current run ends
    running = true;
    points.forEach((p) => loading.add(p.id));
    const prevBulk = cache.lastBulk;
    if (bulk) { cache.lastBulk = Date.now(); save(); } // claim it first, so a second tab opening now does not repeat the work
    emit();
    let ok = true;
    try {
      for (let i = 0; i < unique.length; i += CHUNK) {
        const results = await fetchSummaries(unique.slice(i, i + CHUNK));
        if (!isOn()) break; // switched off while the request was in flight: keep nothing
        const stillThere = new Set(ids());
        const t = Date.now();
        for (const r of results) for (const id of twins.get(keyById.get(r.id)) ?? []) if (stillThere.has(id)) cache.items[id] = { t, temp: r.temp, wind: r.wind, gust: r.gust, n: r.n, start: r.start, tz: r.tz, pp: r.pp, pr: r.pr };
        save();
        emit();
      }
    } catch { ok = false; }
    running = false;
    loading.clear();
    failed = !ok;
    if (bulk && !ok) { cache.lastBulk = prevBulk; save(); } // let the next page load try again
    emit();
    if (pending.size && isOn()) { const next = [...pending]; pending.clear(); await run(next, { bulk: false }); }
  }

  return {
    enabled: isOn,

    async setEnabled(on) {
      setPrivacy({ autoWeather: on });
      if (on) { await run(ids(), { bulk: true }); return; }
      cache = { lastBulk: null, items: {} }; // switching off also forgets what was fetched
      failed = false;
      pending.clear();
      save();
      emit();
    },

    /** Call once at start-up. */
    async init() {
      if (!isOn()) return;
      const known = new Set(ids());
      for (const id of Object.keys(cache.items)) if (!known.has(id)) delete cache.items[id];
      const due = cache.lastBulk === null || Date.now() - cache.lastBulk > INTERVAL_MS;
      await run(due ? ids() : ids().filter((id) => !cache.items[id]), { bulk: due });
    },

    refresh: (idList) => (isOn() ? run(idList, { bulk: false }) : Promise.resolve()),
    refreshMissing: () => (isOn() ? run(ids().filter((id) => !cache.items[id]), { bulk: false }) : Promise.resolve()),
    invalidate(id) { delete cache.items[id]; save(); },
    forget(id) { delete cache.items[id]; pending.delete(id); save(); },

    get(id) {
      const entry = cache.items[id] || null;
      return { entry, loading: loading.has(id), failed, outdated: !!entry && Date.now() - entry.t > STALE_MS };
    },
    status() {
      const times = Object.values(cache.items).map((e) => e.t);
      return { enabled: isOn(), busy: running, failed, lastRefreshed: times.length ? Math.max(...times) : null, markers: ids().length };
    },
  };
}
