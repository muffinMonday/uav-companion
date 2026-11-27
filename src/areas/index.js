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
import { createAdminUI } from './admin-ui.js';
import { createPublicAreas } from './public-layer.js';
import { createExploreApi } from './explorer-api.js';
import { createAreasExplorer } from './explorer.js';

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
export function initAreas({ map, toast, panel = null, isBusy = () => false, storage, backend = null, host = null, weatherButton, showWeather, publicEnabled = true } = {}) {
  const store = createAreaStore(storage ? { storage } : undefined);
  const layer = createAreaLayer(map, store);
  let ui = null;
  const draw = createDrawController({ map, store, layer, toast, isBusy, onEnd: () => ui?.open() });
  const submit = createSubmitController({ store, backend: backend ?? createCloudBackend(() => null) });
  const backendUsed = backend ?? createCloudBackend(() => null);
  // Public discovery (Phase 4): approved areas for the current viewport, online only, drawn apart from the local drafts. Nothing is requested until start().
  const publicAreas = createPublicAreas({ map, store, backend: backendUsed, enabled: publicEnabled, onView: (id) => details?.openPublicArea(publicAreas.find(id)) });
  publicAreas.mountNote();
  // a moderation decision changes what is public: the next public query must not be served from the cache
  const adminBackend = { ...backendUsed, rpc: async (fn, args, o) => { const r = await backendUsed.rpc(fn, args, o); if (/^(review|unpublish)_community_area$/.test(fn)) publicAreas.invalidate(); return r; } };
  const admin = createAdminUI({ map, backend: adminBackend, toast }); // administrator review panel: reachable only while the account is an administrator
  ui = createAreasUI({ map, store, layer, draw, toast, panel, submit, admin, openDetails: (id) => details?.open(id), closeDetails: () => details?.close() });
  const details = host ? createAreaDetails({ map, store, layer, submit, ops: ui.ops, isBusy: () => draw.isBusy() || isBusy(), host, weatherButton, showWeather, publicAreas, toast }) : null;
  // Explorer (Explore tab, "Flying areas"): public summary list beyond the viewport; "Show on map" opens the same details panel
  const explorer = createAreasExplorer({ api: createExploreApi(backendUsed), map, showOnMap: (id, before) => (details ? details.showPublicById(id, before) : Promise.resolve(false)), toast });
  return { isBusy: () => draw.isBusy(), store, layer, publicAreas, explorer, draw, submit, details, admin, open: ui.open, close: ui.close, handleMapClick: (e) => details?.handleMapClick(e) ?? false };
}
