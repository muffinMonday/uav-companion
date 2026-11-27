// Community flying areas: the PUBLIC data adapter for the shared details panel (details.js). Phase 4 (public discovery) is NOT built or deployed: this adapter only
// accepts an already validated approved-area record, and today the only callers are tests with mocked fixtures. There is no production lookup here.
//
// MINIMUM FUTURE PUBLIC API CONTRACT (for the Phase 4 backend; nothing below exists on the hosted project):
//   A read-only function returns only rows whose current revision is approved AND published (the server enforces it, the client re-checks):
//     { area_id uuid, revision_id uuid, status 'approved', published true, name, description, geometry (GeoJSON Polygon, same limits as core.js), spots [...],
//       area_m2, approved_at, last_observed_on? (date, only if a reviewer recorded one), attribution null | { display_name, avatar } }
//   `attribution` is DERIVED BY THE SERVER at read time from a separate persisted account preference (suggested: profiles.community_attribution boolean not null default false,
//   labelled "Show my name and avatar on approved community areas"). It is NOT profiles.share_profile and NOT show_online: those do not grant public attribution.
//   It is non-null only when that preference is true, and then carries only the preset avatar key and display name: never bio, location, interests, friend code, online
//   status, XP or the user id. No friend-list or trip-member RPC may be used to look up an identity. Pending, rejected, withdrawn and private rows are never returned.
import { validateArea } from './core.js';
import { areaCentre } from './geo.js';
import { AVATARS } from '../avatars.js';
import { CONTEXT_BADGE } from './status.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** The consenting contributor, reduced to what may be shown: { display_name, avatar }; null otherwise (a neutral label is used). Everything else in the object is dropped. */
export function cleanAttribution(a) {
  if (!a || typeof a !== 'object') return null;
  const name = typeof a.display_name === 'string' ? Array.from(a.display_name.trim()).slice(0, 40).join('') : '';
  if (!name) return null;
  return { display_name: name, avatar: AVATARS.some((x) => x.key === a.avatar) ? a.avatar : null };
}

/** -> a view for details.js, or null when the record is not a currently approved, published, valid area. No private action is ever returned. */
export function publicView(rec) {
  if (!rec || typeof rec !== 'object' || rec.status !== 'approved' || rec.published !== true || !UUID.test(String(rec.area_id))) return null;
  const v = validateArea({ name: rec.name, description: rec.description, geometry: rec.geometry, spots: rec.spots, drawKind: 'polygon' });
  if (!v.ok) return null;
  const area = { ...v.area, id: `pub-${rec.area_id}`, created: isDate(rec.approved_at) ? rec.approved_at : '', updated: null, submission: null };
  const who = cleanAttribution(rec.attribution);
  return {
    key: `area:${area.id}`, context: 'public-approved', caption: 'Community flying area', badge: CONTEXT_BADGE['public-approved'],
    byline: who ? { profileRow: who } : { text: 'Community contributor' }, status: null,
    area, centre: areaCentre(area.geometry.coordinates[0]),
    dates: { modified: isDate(rec.approved_at) ? rec.approved_at : null, modifiedLabel: 'Approved', observed: isDate(rec.last_observed_on) ? rec.last_observed_on : null },
    actions: [],
  };
}
