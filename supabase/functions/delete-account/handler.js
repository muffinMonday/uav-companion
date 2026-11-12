// The logic of the delete-account edge function, free of Deno and Supabase so Node tests can run it (tests/delete-account-unit.mjs).
// `deps` supplies the three things that touch the outside world:
//   getUser(authorization)    -> { id } for a valid session, else null
//   deleteData(authorization) -> runs public.delete_account() as that user; throws on failure
//   deleteAuthUser(id)        -> removes the sign-in record with the service-role key; throws on failure
// The app data goes first and is one database transaction, so a failure leaves everything as it was; if only the last step fails the data is already gone and a retry
// (the function can be called again, delete_account does nothing the second time) finishes the job.

export const CONFIRM_WORD = 'DELETE';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'use POST' });
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return reply(401, { error: 'not signed in' });
  let user = null;
  try { user = await deps.getUser(authorization); } catch { user = null; }
  if (!user?.id) return reply(401, { error: 'not signed in' });
  let body = null;
  try { body = await req.json(); } catch { body = null; }
  if (!body || body.confirm !== CONFIRM_WORD) return reply(400, { error: `send {"confirm":"${CONFIRM_WORD}"} to delete the account` });
  try { await deps.deleteData(authorization); } catch (e) { return reply(500, { error: 'Could not delete your data: ' + String(e?.message || e) + '. Nothing was deleted.' }); }
  try { await deps.deleteAuthUser(user.id); } catch (e) { return reply(500, { error: 'Your data was deleted, but the sign-in record could not be: ' + String(e?.message || e) + '. Try again.', partial: true }); }
  return reply(200, { status: 'deleted' });
}
