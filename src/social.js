// The friends functions of the cloud database (supabase/migrations/20261111130000_friends.sql), called through the sync adapter's client.
// Nothing here knows about the page. Every call throws an Error carrying the database's own message ("that code was not found", ...).

export function createSocial(client) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    /** The caller's profile { display_name, friend_code, accepts_requests, show_online, avatar, bio, location, interests, share_profile }, created on first use; a name sets or changes it. */
    profile: (name) => rpc('ensure_profile', name === undefined ? {} : { p_display_name: name }),
    /** Changes the profile fields from a patch ({ avatar, bio, location, interests, share_profile, display_name }; null clears). Returns the profile. */
    updateProfile: (patch) => rpc('update_profile', { p_patch: patch }),
    setAccepts: (on) => rpc('set_accepts_requests', { p_accepts: !!on }),
    newCode: () => rpc('regenerate_friend_code'),
    /** Asks the owner of a friend code; { status: 'pending' | 'friends' }. */
    request: (code) => rpc('request_friend', { p_code: code }),
    respond: (id, accept) => rpc('respond_friend', { p_id: id, p_accept: !!accept }),
    remove: (id) => rpc('remove_friendship', { p_id: id }),
    /** [{ id, display_name, status: 'incoming' | 'outgoing' | 'friends', since }] */
    list: () => rpc('list_friends'),
    block: (id) => rpc('block_user', { p_id: id }),
    blocked: () => rpc('list_blocked'),
    unblock: (id) => rpc('unblock', { p_id: id }),
    deleteProfile: () => rpc('delete_profile'),
    /** Shows or hides this person's online status (and, with it, theirs to them). Returns the profile. */
    setShowOnline: (on) => rpc('set_show_online', { p_on: !!on }),
    /** "I am here": the app calls this every 30 s or so while it is open. */
    touch: () => rpc('touch_presence'),
  };
}

/** "Online", "Seen 5 minutes ago", or "" when the status is hidden: from a row of list_friends or list_trip_members. */
export function presenceText(row, when) {
  if (!row || row.online === null || row.online === undefined) return '';
  if (row.online) return 'Online';
  return row.last_seen ? 'Seen ' + when(row.last_seen) : 'Offline';
}

/** "A1B2C-3D4E5" from the stored 10 characters. */
export const formatCode = (c) => (c ? c.slice(0, 5).toUpperCase() + '-' + c.slice(5).toUpperCase() : '');
