// The shared-trip functions of the cloud database (supabase/migrations/20261111140000_shared_trips.sql), called through the sync adapter's client.
// Every call throws an Error carrying the database's own message ("trip not found", "you can only invite friends", ...).

export function createTripsApi(client, { device = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now() } = {}) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const num = (r) => (r && r.rev !== undefined ? { ...r, rev: Number(r.rev) } : r);
  return {
    /** Every shared trip and invitation of the caller: [{ id, name, role, status, owner_name, rev, members_rev, markers, start_date, end_date, members, updated_at, live_active, online_others }] */
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
    // `device` names this page (made fresh at each load, so two tabs are two devices); `claim` is true for the first position after sharing is turned on.
    shareLocation: (id, lat, lon, accuracy, claim = false) => rpc('share_location', { p_trip: id, p_lat: lat, p_lon: lon, p_accuracy: accuracy ?? null, p_device: device, p_claim: !!claim }),
    stopSharing: (id) => rpc('stop_sharing_location', { p_trip: id, p_device: device }),
    stopAll: () => rpc('stop_all_sharing', { p_device: device }),
    live: () => rpc('list_live_locations'),
    // The same for friends (all accepted friends, no trip): the positions come back with the friendship id as member_id.
    shareLocationFriends: (lat, lon, accuracy, claim = false) => rpc('share_location_friends', { p_lat: lat, p_lon: lon, p_accuracy: accuracy ?? null, p_device: device, p_claim: !!claim }),
    stopSharingFriends: () => rpc('stop_sharing_friends', { p_device: device }),
    friendLive: () => rpc('list_friend_live_locations'),
    /** [{ rev, updated_at, updated_by_name, markers }] */
    versions: async (id) => (await rpc('list_shared_trip_versions', { p_trip: id })).map((v) => ({ ...v, rev: Number(v.rev) })),
    restore: async (id, rev) => num(await rpc('restore_shared_trip_version', { p_trip: id, p_rev: rev })),
  };
}
