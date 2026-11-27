// Community flying areas, Explorer: the client side of explore_public_areas (supabase/migrations/20261127160000_community_area_explorer.sql), the paginated public list shown in the
// Explore tab. Read-only, no account needed. The server returns summary rows only; every row is re-validated here before it is drawn. What is sent: an optional name search, an optional
// centre (rounded to 0.01 degree, about 1 km) with a radius, a page size and an offset. No person, device or session value is sent.
export const PAGE = 20;
export const MAX_OFFSET = 500;   // the server refuses a larger offset; the screen asks the person to refine the search instead
export const MAX_QUERY = 60;
export const RADII = [10, 25, 100];
import { validateAttributes } from './core.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

/** The filter object for the server, from the screen's state; null centre and blank query are simply left out. */
export function buildFilter({ query = '', center = null, radiusKm = null } = {}) {
  const f = {};
  const q = String(query ?? '').trim().slice(0, MAX_QUERY);
  if (q) f.query = q;
  if (center && num(center.lat) && num(center.lng) && Math.abs(center.lat) <= 90 && Math.abs(center.lng) <= 180) {
    f.center = { lat: r2(center.lat), lng: r2(center.lng) };
    if (RADII.includes(radiusKm)) f.radius_km = radiusKm;
  }
  return f;
}

/** One summary row, or null when it is not a usable record. */
export function cleanItem(r) {
  if (!r || typeof r !== 'object' || !UUID.test(String(r.area_id)) || typeof r.name !== 'string' || !r.name.trim()) return null;
  if (!num(r.area_m2) || r.area_m2 <= 0 || !Number.isInteger(r.spot_count) || r.spot_count < 0 || r.spot_count > 10) return null;
  const c = r.center;
  if (!c || !num(c.lat) || !num(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return null;
  const d = r.distance_km;
  if (d !== null && d !== undefined && !(num(d) && d >= 0)) return null;
  return { areaId: r.area_id, name: Array.from(r.name.trim()).slice(0, 80).join(''), areaM2: r.area_m2, spotCount: r.spot_count, approvedAt: typeof r.approved_at === 'string' && !Number.isNaN(Date.parse(r.approved_at)) ? r.approved_at : null, center: { lat: c.lat, lng: c.lng }, distanceKm: d ?? null, attributes: (() => { const a = validateAttributes(r.attributes); return a.ok ? a.attributes : {}; })() };
}

const CODES = /(invalid_filter|invalid_query|invalid_center|invalid_radius|invalid_limit|invalid_offset)/;
/** A failure: { code, message }. A refusal is not "no areas", and neither is a network failure. */
export function describeExploreError(e) {
  const raw = String(e?.message ?? e ?? '');
  if (e?.name === 'AbortError' || /AbortError|aborted/i.test(raw)) return { code: 'aborted', message: 'cancelled' };
  if (CODES.test(raw)) return { code: 'bad-request', message: 'The server refused this search. Change it and try again.' };
  return { code: 'network', message: 'Community flying areas could not be loaded.' };
}

/** @param {{ rpc: Function, available?: () => boolean }} backend createCloudBackend's */
export function createExploreApi(backend) {
  return {
    available: () => !!backend?.available?.(),
    /** -> { items, hasMore } for one page; failures throw { code, message }. */
    async list(filter, offset = 0, limit = PAGE, signal) {
      if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw { code: 'bad-request', message: 'That page is out of range.' };
      let res;
      try { res = await backend.rpc('explore_public_areas', { p_filter: filter, p_limit: limit, p_offset: offset }, { signal }); } catch (e) { throw describeExploreError(e); }
      if (res?.error) throw describeExploreError(res.error);
      const d = res?.data;
      if (!d || typeof d !== 'object' || !Array.isArray(d.areas) || typeof d.has_more !== 'boolean') throw { code: 'bad-response', message: 'The server answered in an unexpected way.' };
      const seen = new Set(), items = [];
      for (const r of d.areas.slice(0, 50)) { const c = cleanItem(r); if (c && !seen.has(c.areaId)) { seen.add(c.areaId); items.push(c); } }
      return { items, hasMore: d.has_more };
    },
  };
}
