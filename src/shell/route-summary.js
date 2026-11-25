// Review 01 MAP-10: a compact, expandable route summary (new shell only). Presentation only - reads poi.routeSummary()/
// onRouteSummaryChange() (poi-ui.js), the same entries route/render.js already draws on the map, and reuses route/geometry.js's own
// labelText() so a leg's words here are worded exactly as the map's own route labels are (road vs straight-line fallback, never
// relabeled). No routing algorithm, cache key, distance or availability is computed in this file; it only hides when there is nothing
// to show (poi.routeSummary() is null) and shows again when there is, as the real route state changes.
import { el } from '../cards.js';
import { labelText } from '../route/geometry.js';
import { fmtDistance } from '../distance.js';
import { getDistanceSettings } from '../units.js';
import { onSwipe, atTop } from '../swipe.js';

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

function compactText(summary, units) {
  const n = summary.legs.length;
  const total = fmtDistance(summary.totalM, units);
  const kind = summary.allRoad ? 'by road' : summary.anyRoad ? 'part by road' : 'straight-line';
  return `${n} leg${n === 1 ? '' : 's'} · ${total} ${kind}${summary.anyPending ? ' · updating…' : ''}`;
}

function legRow(leg, units) {
  const label = labelText(leg, (m) => fmtDistance(m, units)); // leg already has { state, distanceM, durationS } like a route/result.js result
  const row = el('div', 'route-summary-leg');
  row.append(el('span', '', `${leg.from} → ${leg.to}`), el('small', '', label.full + (leg.pending ? ' · updating…' : '')));
  return row;
}

/** `deps`: { poi } - the object initPOI()/poi-ui.js returns. Returns { el, destroy() }. */
function createRouteSummaryUI({ poi }) {
  const box = el('div', 'route-summary');
  box.hidden = true; box.dataset.open = 'false';
  const status = el('button', 'route-summary-status'); status.type = 'button';
  status.setAttribute('aria-expanded', 'false');
  const text = el('span', 'route-summary-text');
  status.append(text);
  status.insertAdjacentHTML('beforeend', CHEVRON);
  const detail = el('div', 'route-summary-detail'); detail.hidden = true;
  box.append(status, detail);
  document.body.append(box);

  // The dashboard and its peek handle sit above this chip: publish where the chip's top edge is (px above the bar), 0 while hidden.
  const rootStyle = document.documentElement.style;
  const publishTop = () => rootStyle.setProperty('--route-chip-top', box.hidden ? '0px' : `${16 + box.offsetHeight}px`);
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(publishTop) : null;
  sizeObserver?.observe(box);

  let open = false;
  function setOpen(v) { open = v; box.dataset.open = String(open); detail.hidden = !open; status.setAttribute('aria-expanded', String(open)); }
  status.addEventListener('click', () => setOpen(!open));
  // The chip sits on the bottom edge and opens upward: a swipe up on it expands the leg list, a swipe down (from the chip, or from the list once scrolled to its top) folds it. Same setOpen as the tap.
  onSwipe(box, { direction: 'up', distance: 24, follow: status, enabled: () => !box.hidden && !open, onDismiss: () => setOpen(true) });
  onSwipe(box, { direction: 'down', distance: 24, follow: status, enabled: () => !box.hidden && open, canStart: (t) => atTop(t, box), onDismiss: () => setOpen(false) });

  function render(summary) {
    box.hidden = !summary;
    publishTop();
    if (!summary) return;
    const { units } = getDistanceSettings();
    text.textContent = compactText(summary, units);
    detail.replaceChildren(...summary.legs.map((l) => legRow(l, units)));
  }

  render(poi.routeSummary());
  const off = poi.onRouteSummaryChange(render);

  return { el: box, destroy() { off(); sizeObserver?.disconnect(); rootStyle.removeProperty('--route-chip-top'); box.remove(); } };
}

/** With the flag off this is a constant no-op: nothing it imports is reachable from a default build. */
export const initRouteSummaryUI = import.meta.env.VITE_NEW_SHELL === '1' ? createRouteSummaryUI : () => null;
