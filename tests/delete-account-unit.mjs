// The delete-account edge function's rules, with its three outside calls stubbed: who is let in, what must be sent, the order of the steps and what a failure leaves.
import { handle, CONFIRM_WORD } from '../supabase/functions/delete-account/handler.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const run = async ({ method = 'POST', auth = 'Bearer good', body = { confirm: CONFIRM_WORD }, user = { id: 'u1' }, dataFails = null, authFails = null, rawBody = null } = {}) => {
  const calls = [];
  const deps = {
    getUser: async (a) => { calls.push('getUser'); return a === 'Bearer good' ? user : null; },
    deleteData: async (a) => { calls.push('deleteData:' + a); if (dataFails) throw new Error(dataFails); },
    deleteAuthUser: async (id) => { calls.push('deleteAuthUser:' + id); if (authFails) throw new Error(authFails); },
  };
  const headers = new Headers(); if (auth !== null) headers.set('authorization', auth); headers.set('content-type', 'application/json');
  const res = await handle(new Request('https://x.test/functions/v1/delete-account', { method, headers, body: method === 'POST' ? (rawBody ?? JSON.stringify(body)) : undefined }), deps);
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, calls, res };
};
const deleted = (r) => r.calls.some((c) => c.startsWith('delete'));

let r = await run();
ok(r.status === 200 && r.json.status === 'deleted', 'a signed-in caller who sends the confirmation word gets "deleted"');
ok(r.calls.join() === 'getUser,deleteData:Bearer good,deleteAuthUser:u1', 'the data is deleted as the caller first, then the sign-in record of that same user: ' + r.calls.join());
r = await run({ method: 'OPTIONS' });
ok(r.status === 204 && r.res.headers.get('access-control-allow-origin') === '*' && r.calls.length === 0, "the browser's preflight is answered without touching anything");
r = await run({ method: 'GET' });
ok(r.status === 405 && r.calls.length === 0, 'GET is refused');
for (const [what, auth] of [['no token', null], ['a token that is not a Bearer token', 'Basic abc'], ['an empty Bearer', 'Bearer '], ['a token the platform does not accept', 'Bearer bad']]) {
  r = await run({ auth });
  ok(r.status === 401 && !deleted(r), what + ' gets 401 and nothing is deleted');
}
r = await run({ user: {} });
ok(r.status === 401 && !deleted(r), 'a session with no user id gets 401');
for (const [what, body, raw] of [['no confirmation', {}, null], ['the wrong word', { confirm: 'delete' }, null], ['a different value', { confirm: true }, null], ['a body that is not JSON', null, 'nope'], ['no body at all', null, '']]) {
  r = await run({ body, rawBody: raw });
  ok(r.status === 400 && !deleted(r), what + ' gets 400 and nothing is deleted');
}
r = await run({ dataFails: 'boom' });
ok(r.status === 500 && /Nothing was deleted/.test(r.json.error) && !r.calls.some((c) => c.startsWith('deleteAuthUser')), 'if the data step fails the sign-in record is not touched, and the answer says nothing was deleted');
r = await run({ authFails: 'admin down' });
ok(r.status === 500 && r.json.partial === true && /data was deleted/.test(r.json.error) && /Try again/.test(r.json.error), 'if only the last step fails the answer says the data is gone and to try again');
ok(!JSON.stringify(r.json).includes('Bearer'), 'and no answer repeats the token');
