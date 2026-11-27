// Community flying areas, Explorer: the "Flying areas" section of the Explore tab (the Flight sessions hub). It lists approved, currently published areas (summary rows from
// explore_public_areas), nearest first when a centre is known, otherwise most recently approved first, 20 per page and at most 520 results per search.
//   - Guests and signed-in people see the same thing. Nothing is requested until the section is opened; location is never read from the device. A centre comes only from
//     the map centre (when the person picks a distance) or from coordinates / a map link typed into the search box (parsed here, never sent to a place-search service).
//   - "Show on map" fetches the one full public record (get_public_area), opens the existing unified details panel and centres the map on the area.
//   - States: loading, empty, error with Try again, refused search, "refine the search" at the paging limit. A stale response (an older search) is dropped.
import { el } from '../cards.js';
import { parseCoordinates } from '../coordparse.js';
import { formatArea, ENVIRONMENTS, ACCESS } from './core.js';
import { buildFilter, PAGE, MAX_OFFSET, RADII } from './explorer-api.js';

const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };

/**
 * @param {object} o
 * @param {ReturnType<import('./explorer-api.js').createExploreApi>} o.api
 * @param {L.Map} o.map
 * @param {(areaId: string, beforeOpen: () => void) => Promise<boolean>} o.showOnMap  reads the area, calls beforeOpen (the hub steps aside), opens the details panel and centres the map; resolves false when the area is no longer published
 * @param {(text: string) => void} [o.toast]
 */
export function createAreasExplorer({ api, map, showOnMap, toast = () => {} }) {
  let s = { status: 'idle', items: [], hasMore: false, offset: 0, query: '', near: 'any', center: null, hint: '', error: '' };
  let seq = 0, ctrl = null;

  // typed coordinates are the centre, never a name search
  const filterOf = () => buildFilter({ query: s.center?.kind === 'coords' ? '' : s.query, center: s.center, radiusKm: s.near === 'any' ? null : Number(s.near) });

  async function load({ more = false, repaint }) {
    const me = ++seq; ctrl?.abort?.(); ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (!more) s = { ...s, status: 'loading', items: [], hasMore: false, offset: 0, error: '' };
    else s = { ...s, status: 'more', error: '' };
    repaint();
    try {
      const r = await api.list(filterOf(), more ? s.offset : 0, PAGE, ctrl?.signal);
      if (me !== seq) return;
      const have = new Set((more ? s.items : []).map((i) => i.areaId));
      const items = more ? [...s.items, ...r.items.filter((i) => !have.has(i.areaId))] : r.items;
      s = { ...s, status: 'ready', items, hasMore: r.hasMore, offset: (more ? s.offset : 0) + PAGE };
    } catch (e) {
      if (me !== seq || e?.code === 'aborted') return;
      s = { ...s, status: more ? 'ready' : 'error', error: e?.message ?? 'Community flying areas could not be loaded.', errorCode: e?.code };
    }
    repaint();
  }

  /** Reads the search box: coordinates or a map link set the centre (nearest first); anything else is a name search. */
  function apply(text, near, repaint) {
    const t = String(text ?? '').trim();
    let center = null, hint = '';
    const c = t ? parseCoordinates(t) : null;
    if (c && !c.ok) hint = c.error;
    else if (c?.ok) { const p = c.candidates[0]; center = { lat: p.lat, lng: p.lon, kind: 'coords', text: t }; hint = `Nearest to ${p.label}`; }
    if (!center && near !== 'any') { const m = map.getCenter().wrap(); center = { lat: m.lat, lng: m.lng, kind: 'map', text: '' }; hint = `Within ${near} km of the map centre`; }
    else if (center && near !== 'any') hint += `, within ${near} km`;
    s = { ...s, query: t, near, center, hint };
    if (c && !c.ok) { seq++; s = { ...s, status: 'ready', items: [], hasMore: false, error: '' }; repaint(); return; } // not usable coordinates: say why, ask nothing
    load({ repaint });
  }

  function row(it, { repaint, showOnMapRow }) {
    const r = el('div', 'ses-row area-ex-row'); r.dataset.id = it.areaId;
    const top = el('div', 'ses-top'); top.append(el('b', 'ses-title', it.name)); r.append(top);
    const meta = [Number.isFinite(it.distanceKm) ? `About ${it.distanceKm < 1 ? 'under 1' : it.distanceKm.toFixed(1)} km away` : '', formatArea(it.areaM2), it.spotCount ? `${it.spotCount} setup spot${it.spotCount === 1 ? '' : 's'}` : 'No setup spots mapped'].filter(Boolean);
    r.append(el('small', 'ses-count', meta.join(' · ')));
    { // approved site details (environment and access only; the rest is in the details panel). Access that is not public is marked; a missing one is not shown as public.
      const tags = el('ul', 'area-attr-tags area-ex-attrs'); const at = it.attributes ?? {};
      if (at.environment) tags.append(el('li', '', ENVIRONMENTS[at.environment]));
      if (at.access) { const li = el('li', at.access === 'public' ? '' : 'is-caution', ACCESS[at.access]); li.dataset.access = at.access; tags.append(li); }
      if (tags.children.length) r.append(tags);
    }
    const bs = el('div', 'btn-row'); const b = btn('Show on map'); b.dataset.act = 'show-area';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { const ok = await showOnMapRow(it); if (ok === false) { toast('This community flying area is no longer published.'); s = { ...s, items: s.items.filter((x) => x.areaId !== it.areaId) }; repaint(); } }
      catch { toast('That flying area could not be opened. Check the connection and try again.'); }
      b.disabled = false;
    });
    bs.append(b); r.append(bs);
    return r;
  }

  return {
    /** Draws the section into `f`. `repaint` redraws the hub; `close` steps the hub aside before the map shows the area. */
    draw(f, { repaint, close }) {
      f.append(el('p', 'hint', 'Community-recommended places to fly, approved by an administrator. They are not flight authorization: check official restrictions, access and local conditions first.'));
      const form = el('form', 'ses-filters area-ex-filters'); form.setAttribute('role', 'search');
      const q = el('input'); q.type = 'search'; q.id = 'area-ex-q'; q.placeholder = 'Search by name, or enter coordinates'; q.value = s.query; q.maxLength = 120; q.setAttribute('aria-label', 'Search flying areas by name, or enter coordinates to see the nearest');
      const near = el('select'); near.id = 'area-ex-near'; near.setAttribute('aria-label', 'Distance from the map centre or the coordinates');
      near.append(new Option('Anywhere', 'any')); for (const k of RADII) near.append(new Option(`Within ${k} km`, String(k))); near.value = s.near;
      form.append(q, near);
      const go = () => apply(q.value, near.value, repaint);
      form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
      near.addEventListener('change', go);
      f.append(form);
      if (s.hint) f.append(el('small', 'hint area-ex-hint', s.hint));
      if (s.status === 'idle') { queueMicrotask(() => load({ repaint })); f.append(el('p', 'hint', 'Loading flying areas…')); return; }
      if (s.status === 'loading') { f.append(el('p', 'hint', 'Loading flying areas…')); return; }
      if (s.status === 'error') { f.append(el('p', 'hint', s.error || 'Community flying areas could not be loaded.')); const r = btn('Try again'); r.dataset.act = 'retry'; r.addEventListener('click', () => load({ repaint })); f.append(r); return; }
      if (!s.items.length) { f.append(el('p', 'hint ses-empty', 'No flying areas match. Try another name, a wider distance, or search Anywhere.')); return; }
      const list = el('div', 'area-ex-list');
      for (const it of s.items) list.append(row(it, { repaint, showOnMapRow: (x) => showOnMap(x.areaId, close) }));
      f.append(list);
      if (s.error) f.append(el('p', 'hint', s.error));
      if (s.hasMore && s.offset <= MAX_OFFSET) { const m = btn(s.status === 'more' ? 'Loading…' : 'Show more'); m.dataset.act = 'more'; m.disabled = s.status === 'more'; m.addEventListener('click', () => load({ more: true, repaint })); f.append(m); }
      else if (s.hasMore) f.append(el('p', 'hint', 'There are more areas than can be listed. Search by name or use a distance to narrow them.'));
    },
    reset() { seq++; ctrl?.abort?.(); s = { status: 'idle', items: [], hasMore: false, offset: 0, query: '', near: 'any', center: null, hint: '', error: '' }; },
    state: () => s,
  };
}
