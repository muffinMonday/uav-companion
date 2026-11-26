// Community flying areas, Phase 1 (local authoring only): the one entry point main.js calls. No network, no account, no Supabase.
// Nothing here is read by pointcheck.js or any zone layer: a community area can never change a verdict.
import { createAreaStore } from './store.js';
import { createAreaLayer } from './layer.js';
import { createDrawController } from './draw.js';
import { createAreasUI } from './ui.js';

/**
 * @param {object} o
 * @param {L.Map} o.map
 * @param {(text, ms?) => void} o.toast
 * @param {object} [o.panel]              the side panel (closeIfPhone)
 * @param {() => boolean} [o.isBusy]      true while a marker is being placed or edited: drawing will not start then
 * @returns {{ isBusy: () => boolean, store, open: () => void, close: () => void, draw }}
 */
export function initAreas({ map, toast, panel = null, isBusy = () => false, storage } = {}) {
  const store = createAreaStore(storage ? { storage } : undefined);
  const layer = createAreaLayer(map, store);
  let ui = null;
  const draw = createDrawController({ map, store, layer, toast, isBusy, onEnd: () => ui?.open() });
  ui = createAreasUI({ map, store, layer, draw, toast, panel });
  return { isBusy: () => draw.isBusy(), store, layer, draw, open: ui.open, close: ui.close };
}
