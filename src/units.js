// Distance settings from the Points of Interest tab: the units shown, and an optional maximum range.
// Remembered in this browser (prefs.js) and held in memory, so a change applies at once even if storage is blocked.
// Units cover horizontal distances and the map's scale bar. Elevation and height limits stay in metres, because the
// rules they are compared with (such as the 120 m limit) are written in metres.
import { loadPrefs, savePrefs } from './prefs.js';
import { log } from './log.js';

const saved = loadPrefs();
let state = {
  units: saved.units === 'imperial' ? 'imperial' : 'metric',
  maxRangeM: Number.isFinite(saved.maxRangeM) ? saved.maxRangeM : null, // metres; null = no limit
};
const listeners = new Set();

export const getDistanceSettings = () => state;
export const onDistanceSettings = (fn) => { listeners.add(fn); };

export function setDistanceSettings(patch) {
  state = { ...state, ...patch };
  savePrefs({ units: state.units === 'imperial' ? 'imperial' : null, maxRangeM: state.maxRangeM });
  listeners.forEach((fn) => { try { fn(state); } catch (e) { log.error('units', 'a listener failed', e); } }); // one failing listener must not stop the others
}
