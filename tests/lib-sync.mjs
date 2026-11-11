// An in-memory cloud for the sync engine tests. It mirrors the semantics of supabase/migrations (revision numbers, conflicts, versions), and
// several devices can share one cloud: makeCloud() holds the server, cloud.adapter(user) is what one device talks to.
export function makeCloud() {
  const rows = new Map(); // user → { doc, rev, updated_at, device }
  const versions = new Map(); // user → [{ rev, doc, ... }]
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 11, 12, 0, tick++)).toISOString();
  const brief = (r) => ({ rev: r.rev, updated_at: r.updated_at, device: r.device, markers: r.doc.items?.length ?? 0, trips: r.doc.trips?.length ?? 0 });
  const server = {
    rows, versions, calls: [], failNext: null,
    adapter(user = { email: 'a@example.test' }, { signedIn = true } = {}) {
      let session = signedIn ? user : null;
      const enter = (name) => { server.calls.push(name); if (server.failNext) { const e = server.failNext; server.failNext = null; throw new Error(e); } };
      return {
        async getSession() { return session; },
        async signIn() { enter('signIn'); },
        async signOut() { session = null; },
        async info() { enter('info'); const r = rows.get(user.email); return r ? brief(r) : null; },
        async fetch() { enter('fetch'); const r = rows.get(user.email); return r ? { doc: structuredClone(r.doc), ...brief(r) } : null; },
        async save(doc, baseRev, device, force) {
          enter('save');
          if (!session) throw new Error('not signed in');
          const r = rows.get(user.email);
          if (!r) { const n = { doc: structuredClone(doc), rev: 1, updated_at: stamp(), device }; rows.set(user.email, n); return { status: 'ok', ...brief(n) }; }
          if (!force && baseRev !== r.rev) return { status: 'conflict', ...brief(r) };
          const v = versions.get(user.email) ?? []; v.unshift({ ...r }); versions.set(user.email, v);
          const n = { doc: structuredClone(doc), rev: r.rev + 1, updated_at: stamp(), device };
          rows.set(user.email, n);
          return { status: 'ok', ...brief(n) };
        },
        async listVersions() { return (versions.get(user.email) ?? []).map(brief); },
        async remove() { rows.delete(user.email); versions.delete(user.email); },
      };
    },
  };
  return server;
}

/** A tiny localStorage stand-in, one per simulated device. */
export function memStorage() { const s = {}; return { _s: s, getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; }
