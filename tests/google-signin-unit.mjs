// Google sign-in, unit level. MOCKED: no Google, no network. The real supabase-js client is created, but its signInWithOAuth is replaced by a recorder,
// so this proves what the app asks for (provider, redirect, scopes), the engine's { ok, error } shape and the return-URL handling, not Google itself.
// The live run with the real OAuth client is the owner's (backlog D3).
import { createSupabaseAdapter } from '../src/sync/supabase.js';
import { createSync } from '../src/sync/engine.js';
import { takeAuthReturnError } from '../src/sync-ui.js';
import { makeCloud, memStorage } from './lib-sync.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// ---------- adapter (mocked client call)
{
  const a = await createSupabaseAdapter({ url: 'https://example.invalid', key: 'sb_publishable_test', redirectTo: 'https://host.example/uav-companion/' });
  const calls = [];
  a.client.auth.signInWithOAuth = async (arg) => { calls.push(arg); return { data: {}, error: null }; };
  await a.signInWithGoogle();
  ok(calls.length === 1 && calls[0].provider === 'google', 'adapter: asks Supabase for the google provider (mocked)');
  ok(calls[0].options.redirectTo === 'https://host.example/uav-companion/', 'adapter: returns to the same redirect the email link uses, subpath included (mocked)');
  ok(Object.keys(calls[0].options).join() === 'redirectTo', 'adapter: no scopes, queryParams or extra options (default identity scopes only)');
  ok(a.client.auth.flowType === 'implicit', 'adapter: flow stays implicit (D1)');
  a.client.auth.signInWithOAuth = async () => ({ data: {}, error: { message: 'Unsupported provider: provider is not enabled' } });
  let msg = null; try { await a.signInWithGoogle(); } catch (e) { msg = e.message; }
  ok(msg === 'Unsupported provider: provider is not enabled', 'adapter: a Supabase error is thrown with its message');
  const sent = []; a.client.auth.signInWithOtp = async (arg) => { sent.push(arg); return { error: null }; };
  await a.signIn('x@example.test');
  ok(sent.length === 1 && sent[0].options.emailRedirectTo === 'https://host.example/uav-companion/' && sent[0].options.shouldCreateUser === true, 'adapter: the magic link call is unchanged');
}

// ---------- engine
{
  const cloud = makeCloud();
  const ad = cloud.adapter({ email: 'a@example.test' }, { signedIn: false });
  let n = 0; ad.signInWithGoogle = async () => { n++; };
  globalThis.localStorage = memStorage();
  const { createStore } = await import('../src/poi.js');
  const sync = createSync({ store: createStore(), adapter: ad, storage: memStorage(), device: 't', debounceMs: 10 });
  const r = await sync.signInWithGoogle();
  ok(r.ok === true && n === 1, 'engine: signInWithGoogle returns { ok: true } and calls the adapter');
  ad.signInWithGoogle = async () => { throw new Error('boom'); };
  const r2 = await sync.signInWithGoogle();
  ok(r2.ok === false && r2.error === 'boom', 'engine: a failure comes back as { ok: false, error }');
  await sync.stop?.();
}

// ---------- return URL
const fake = (hash = '', search = '', path = '/uav-companion/') => { const loc = { hash, search, pathname: path }; const urls = []; return { loc, urls, hist: { replaceState: (_s, _t, u) => urls.push(u) } }; };
{
  const f = fake('#error=access_denied&error_code=bad&error_description=Nope');
  ok(takeAuthReturnError(f.loc, f.hist) === true && f.urls[0] === '/uav-companion/', 'return: an error in the hash is detected and removed, subpath kept');
  const g = fake('', '?error=server_error&error_description=x&steam=ok');
  ok(takeAuthReturnError(g.loc, g.hist) === true && g.urls[0] === '/uav-companion/?steam=ok', 'return: an error in the query is detected; other parameters stay');
  const h = fake('#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer');
  ok(takeAuthReturnError(h.loc, h.hist) === false && h.urls.length === 0, 'return: a session in the hash is left alone for the library');
  const i = fake('#access_token=a&error=weird');
  ok(takeAuthReturnError(i.loc, i.hist) === false && i.urls.length === 0, 'return: a session wins over a stray error parameter');
  const j = fake('#session=TOKEN');
  ok(takeAuthReturnError(j.loc, j.hist) === false && j.urls.length === 0, 'return: a pending session-link hash is untouched');
  const k = fake('#session=TOKEN&error=access_denied');
  ok(takeAuthReturnError(k.loc, k.hist) === true && k.urls[0] === '/uav-companion/#session=TOKEN', 'return: an error beside another hash parameter keeps that parameter');
  ok(takeAuthReturnError(fake().loc, fake().hist) === false, 'return: a plain load is not an error return');
  ok(takeAuthReturnError({ get hash() { throw new Error('x'); } }, {}) === false, 'return: an unreadable location does not throw');
}
