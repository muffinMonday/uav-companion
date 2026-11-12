// Supabase edge function: delete the signed-in user's account. See handler.js for the rules and tests/delete-account-unit.mjs for the tests.
// The service-role key is a function secret supplied by the platform (SUPABASE_SERVICE_ROLE_KEY); it never reaches the browser and is not in the repository.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const asUser = (authorization: string) => createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  return handle(req, {
    getUser: async (authorization: string) => { const { data, error } = await asUser(authorization).auth.getUser(); return error ? null : data.user; },
    deleteData: async (authorization: string) => { const { error } = await asUser(authorization).rpc('delete_account'); if (error) throw new Error(error.message); },
    deleteAuthUser: async (id: string) => { const { error } = await createClient(url, service, { auth: { persistSession: false } }).auth.admin.deleteUser(id); if (error) throw new Error(error.message); },
  });
});
