// For the shared-trip engine tests: an api (the interface of src/sharedtrip/api.js) whose calls run the real database functions on PGlite as a given user.
import { as } from './lib-db.mjs';
import { memStorage } from './lib-sync.mjs';

const locks = new WeakMap(); // one database call at a time per database: the role is set for each call
const serial = (db, fn) => { const prev = locks.get(db) ?? Promise.resolve(); const r = prev.then(fn, fn); locks.set(db, r.catch(() => {})); return r; };

export function dbApi(db, uid, hooks = {}) {
  const J = (o) => JSON.stringify(o);
  const one = (sql, params = []) => serial(db, async () => (await as(db, uid, `select ${sql} as r`, params))[0].r);
  const rows = (sql, params = []) => serial(db, () => as(db, uid, sql, params));
  const num = (r) => (r && r.rev !== undefined ? { ...r, rev: Number(r.rev) } : r);
  const api = {
    calls: [],
    list: async () => { api.calls.push('list'); if (hooks.failNext) { const m = hooks.failNext; hooks.failNext = null; throw new Error(m); } return (await rows('select * from public.list_my_trips()')).map((t) => ({ ...t, rev: Number(t.rev), members_rev: Number(t.members_rev) })); },
    get: async (id) => { api.calls.push('get'); return num(await one('public.get_shared_trip($1)', [id])); },
    save: async (id, doc, baseRev) => { api.calls.push('save'); if (hooks.beforeSave) await hooks.beforeSave(id, doc); if (!hooks.quick) await serial(db, () => db.exec(`update public.shared_trips set updated_at = updated_at - interval '3 minutes' where id = '${id}'`)); // saves minutes apart, not seconds (version_coalesce)
      return num(await one('public.save_shared_trip($1, $2::jsonb, $3)', [id, J(doc), baseRev])); },
    share: async (doc) => num(await one('public.share_trip($1::jsonb)', [J(doc)])),
    invite: (id, f) => one('public.invite_to_trip($1, $2)', [id, f]),
    respond: (id, a) => one('public.respond_trip_invite($1, $2)', [id, !!a]),
    leave: (id) => one('public.leave_trip($1)', [id]),
    removeMember: (id, m) => one('public.remove_member($1, $2)', [id, m]),
    deleteTrip: (id) => one('public.delete_shared_trip($1)', [id]),
    shareLocation: async (id, lat, lon, acc, claim = false) => { api.calls.push('shareLocation'); if (hooks.beforeShare) await hooks.beforeShare(id); return one('public.share_location($1, $2::float8, $3::float8, $4::float8, $5, $6)', [id, lat, lon, acc, hooks.device ?? null, !!claim]); },
    stopSharing: async (id) => { api.calls.push('stopSharing'); return one('public.stop_sharing_location($1, $2)', [id, hooks.device ?? null]); },
    stopAll: async () => { api.calls.push('stopAll'); return one('public.stop_all_sharing($1)', [hooks.device ?? null]); },
    live: async () => (await rows('select * from public.list_live_locations()')).map((l) => ({ ...l, age_seconds: Number(l.age_seconds) })),
    shareLocationFriends: async (lat, lon, acc, claim = false) => { api.calls.push('shareLocationFriends'); return one('public.share_location_friends($1::float8, $2::float8, $3::float8, $4, $5)', [lat, lon, acc, hooks.device ?? null, !!claim]); },
    stopSharingFriends: async () => { api.calls.push('stopSharingFriends'); return one('public.stop_sharing_friends($1)', [hooks.device ?? null]); },
    friendLive: async () => (await rows('select * from public.list_friend_live_locations()')).map((l) => ({ ...l, age_seconds: Number(l.age_seconds) })),
    invitable: (id) => rows('select * from public.list_invitable_friends($1)', [id]),
    members: (id) => rows('select * from public.list_trip_members($1)', [id]),
    versions: async (id) => (await rows('select * from public.list_shared_trip_versions($1)', [id])).map((v) => ({ ...v, rev: Number(v.rev) })),
    restore: async (id, rev) => num(await one('public.restore_shared_trip_version($1, $2)', [id, rev])),
  };
  return api;
}
export { memStorage };
