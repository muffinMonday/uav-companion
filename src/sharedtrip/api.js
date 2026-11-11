// The shared-trip functions of the cloud database (supabase/migrations/20261111140000_shared_trips.sql), called through the sync adapter's client.
// Every call throws an Error carrying the database's own message ("trip not found", "you can only invite friends", ...).

export function createTripsApi(client) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const num = (r) => (r && r.rev !== undefined ? { ...r, rev: Number(r.rev) } : r);
  return {
    /** Every shared trip and invitation of the caller: [{ id, name, role, status, owner_name, rev, members_rev, markers, start_date, end_date, members, updated_at }] */
    list: async () => (await rpc('list_my_trips')).map((t) => ({ ...t, rev: Number(t.rev), members_rev: Number(t.members_rev) })),
    /** { doc, rev, updated_at, updated_by_name, role } */
    get: async (id) => num(await rpc('get_shared_trip', { p_trip: id })),
    /** { status: 'ok' | 'conflict', rev, ... } */
    save: async (id, doc, baseRev) => num(await rpc('save_shared_trip', { p_trip: id, p_doc: doc, p_base_rev: baseRev })),
    share: async (doc) => num(await rpc('share_trip', { p_doc: doc })),
    invite: (id, friendshipId) => rpc('invite_to_trip', { p_trip: id, p_friendship: friendshipId }),
    respond: (id, accept) => rpc('respond_trip_invite', { p_trip: id, p_accept: !!accept }),
    leave: (id) => rpc('leave_trip', { p_trip: id }),
    removeMember: (id, memberId) => rpc('remove_member', { p_trip: id, p_member: memberId }),
    deleteTrip: (id) => rpc('delete_shared_trip', { p_trip: id }),
    /** [{ member_id, display_name, role, status, is_me, since }] */
    members: (id) => rpc('list_trip_members', { p_trip: id }),
    /** The owner's friends who are not in the trip yet: [{ friendship_id, display_name }] */
    invitable: (id) => rpc('list_invitable_friends', { p_trip: id }),
    /** Live locations (see live.js): sends this device's position for a trip, stops sharing there or everywhere, and lists the others' positions. */
    shareLocation: (id, lat, lon, accuracy) => rpc('share_location', { p_trip: id, p_lat: lat, p_lon: lon, p_accuracy: accuracy ?? null }),
    stopSharing: (id) => rpc('stop_sharing_location', { p_trip: id }),
    stopAll: () => rpc('stop_all_sharing'),
    live: () => rpc('list_live_locations'),
    /** [{ rev, updated_at, updated_by_name, markers }] */
    versions: async (id) => (await rpc('list_shared_trip_versions', { p_trip: id })).map((v) => ({ ...v, rev: Number(v.rev) })),
    restore: async (id, rev) => num(await rpc('restore_shared_trip_version', { p_trip: id, p_rev: rev })),
  };
}
