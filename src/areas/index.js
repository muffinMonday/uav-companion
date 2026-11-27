// Community flying areas: the one entry point main.js calls. Phase 1 is local authoring; Phase 2 adds an explicit, signed-in "Submit for review" (submit.js, api.js).
// Nothing is sent unless the person submits an area; the account backend is passed in by main.js.
// Nothing here is read by pointcheck.js or any zone layer: a community area can never change a verdict.
import { createAreaStore } from './store.js';
import { createAreaLayer } from './layer.js';
import { createDrawController } from './draw.js';
import { createAreasUI } from './ui.js';
import { createSubmitController } from './submit.js';
import { createCloudBackend } from './api.js';
import { createAreaDetails } from './details.js';

/**
 * @param {object} o
 * @param {L.Map} o.map
 * @param {(text, ms?) => void} o.toast
 * @param {object} [o.panel]              the side panel (closeIfPhone)
 * @param {object} [o.host]               poi-ui's external marker host (externalHost): the shared details panel opens in it; without it there is no details panel
 * @param {Function} [o.weatherButton]    the existing opt-in "Show weather here" control, and showWeather(lat, lon, name) behind it
 * @param {() => boolean} [o.isBusy]      true while a marker is being placed or edited: drawing will not start then
 * @returns {{ isBusy: () => boolean, store, open: () => void, close: () => void, draw }}
 */
export function initAreas({ map, toast, panel = null, isBusy = () => false, storage, backend = null, host = null, weatherButton, showWeather } = {}) {
  const store = createAreaStore(storage ? { storage } : undefined);
  const layer = createAreaLayer(map, store);
  let ui = null;
  const draw = createDrawController({ map, store, layer, toast, isBusy, onEnd: () => ui?.open() });
  const submit = createSubmitController({ store, backend: backend ?? createCloudBackend(() => null) });
  ui = createAreasUI({ map, store, layer, draw, toast, panel, submit, openDetails: (id) => details?.open(id), closeDetails: () => details?.close() });
  const details = host ? createAreaDetails({ map, store, layer, submit, ops: ui.ops, isBusy: () => draw.isBusy() || isBusy(), host, weatherButton, showWeather }) : null;
  return { isBusy: () => draw.isBusy(), store, layer, draw, submit, details, open: ui.open, close: ui.close, handleMapClick: (e) => details?.handleMapClick(e) ?? false };
}
