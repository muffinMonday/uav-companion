// area-photo: serves a photo by its random id after the database access check (public / owner / administrator). Everything else is 404. Revalidated on every request.
// Supabase edge function (see ../_shared/area-photo-handlers.js for the rules and tests/areas-photo-fn-unit.mjs for the tests). The service-role key and URL are supplied by the platform.
// Storage: the PRIVATE bucket 'area-photos' (no storage policies exist, so only this service-role code can reach it).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleView } from '../_shared/area-photo-handlers.js';

const BUCKET = 'area-photos';

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await admin.rpc(fn, args); if (error) throw new Error(error.message); return data; };
  return handleView(req, {
    getUser: async (authorization: string) => { const { data, error } = await createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }).auth.getUser(); return error ? null : data.user; },
    rpc,
    storage: {
      put: async (key: string, bytes: Uint8Array, mime: string) => { const { error } = await admin.storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: false }); if (error) throw new Error(error.message); },
      get: async (key: string) => { const { data, error } = await admin.storage.from(BUCKET).download(key); if (error || !data) return null; return { bytes: new Uint8Array(await data.arrayBuffer()) }; },
      remove: async (keys: string[]) => { const { error } = await admin.storage.from(BUCKET).remove(keys); if (error) throw new Error(error.message); },
    },
    env: { cleanupSecret: Deno.env.get('AREA_PHOTO_CLEANUP_SECRET') ?? '' },
  });
});
