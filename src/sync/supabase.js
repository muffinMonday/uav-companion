// The sync adapter for Supabase (see sync/engine.js for the interface). Loaded only when the project address and publishable key are configured,
// and the Supabase library itself only then (a dynamic import), so a visitor who never signs in downloads none of it.

/** True when this build has a project to talk to. */
export const configured = () => !!(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY);

export async function createSupabaseAdapter({ url = import.meta.env?.VITE_SUPABASE_URL, key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY, redirectTo = location.origin + location.pathname } = {}) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };

  return {
    client: sb, // for tests
    async getSession() { const { data } = await sb.auth.getSession(); const u = data.session?.user; return u ? { email: u.email, id: u.id } : null; },
    async signIn(email) { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } }); if (error) throw new Error(error.message); },
    async signOut() { await sb.auth.signOut(); },
    onAuthChange(fn) { const { data } = sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') fn(event); }); return () => data.subscription.unsubscribe(); },
    async info() {
      const { data, error } = await sb.from('user_data').select('rev, updated_at, device, markers, trips, settings:doc->settings').maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { ...data, rev: Number(data.rev) } : null;
    },
    async fetch() {
      const { data, error } = await sb.from('user_data').select('doc, rev, updated_at, device, markers, trips').maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { ...data, rev: Number(data.rev) } : null;
    },
    async save(doc, baseRev, device, force = false) { const r = await rpc('save_user_data', { p_doc: doc, p_base_rev: baseRev, p_device: device, p_force: force }); return { ...r, rev: Number(r.rev) }; },
    async listVersions() { return (await rpc('list_user_data_versions')).map((v) => ({ ...v, rev: Number(v.rev) })); },
    async restore(rev) { const r = await rpc('restore_user_data_version', { p_rev: rev }); return { ...r, rev: Number(r.rev) }; },
    async remove() { await rpc('delete_user_data'); },
  };
}
