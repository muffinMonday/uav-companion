// Steam, the pure part, shared by the steam-link, steam-sync and steam-sync-all edge functions: the signed link state, the Steam OpenID check, reading a player's owned games.
// Free of Deno and Supabase so Node tests can run it (tests/steam-unit.mjs). Nothing here logs or returns the Web API key; Steam is reached through the injected `fetchFn`.

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const API = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/';

/** An error with a short code the callers turn into a message: bad_state, expired, not_verified, unavailable, bad_return, not_configured. */
export class SteamError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** A state string that proves who started the link and where to send them back: signed with the function's secret, valid for ten minutes. */
export async function signState({ userId, returnUrl, now = Date.now(), ttlMs = 10 * 60 * 1000 }, secret) {
  if (!secret) throw new SteamError('not_configured');
  const p = b64u(enc.encode(JSON.stringify({ u: userId, r: returnUrl, e: now + ttlMs })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(p)));
  return p + '.' + b64u(sig);
}

/** { userId, returnUrl } from a state, or a SteamError (bad_state for anything wrong with it, expired when it is old). The signature is checked in constant time. */
export async function verifyState(state, secret, now = Date.now()) {
  if (!secret) throw new SteamError('not_configured');
  if (typeof state !== 'string' || state.length > 2000 || state.split('.').length !== 2) throw new SteamError('bad_state');
  const [p, sig] = state.split('.');
  let good = false, body = null;
  try {
    good = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(sig), enc.encode(p));
    if (good) body = JSON.parse(new TextDecoder().decode(unb64u(p)));
  } catch { good = false; }
  if (!good || !body || typeof body.u !== 'string' || typeof body.r !== 'string' || !Number.isFinite(body.e)) throw new SteamError('bad_state');
  if (now > body.e) throw new SteamError('expired');
  return { userId: body.u, returnUrl: body.r };
}

/** The address to send the person back to, if it is one of the allowed origins (https, or http on localhost); otherwise null. The path and query are kept, the hash dropped. */
export function allowedReturn(value, origins) {
  let u;
  try { u = new URL(String(value)); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) return null;
  if (!Array.isArray(origins) || !origins.includes(u.origin)) return null;
  u.hash = ''; u.searchParams.delete('steam');
  return u.toString();
}

/** The return address with ?steam=<result> added (linked, private, taken, error). */
export function withResult(returnUrl, result) {
  const u = new URL(returnUrl); u.searchParams.set('steam', result); return u.toString();
}

/** Where to send the browser to sign in at Steam; Steam comes back to `callbackUrl` with the state attached. */
export function authUrl({ callbackUrl, state }) {
  const ret = callbackUrl + (callbackUrl.includes('?') ? '&' : '?') + 'state=' + encodeURIComponent(state);
  const p = new URLSearchParams({
    'openid.ns': OPENID_NS, 'openid.mode': 'checkid_setup', 'openid.return_to': ret, 'openid.realm': new URL(callbackUrl).origin,
    'openid.identity': OPENID_NS + '/identifier_select', 'openid.claimed_id': OPENID_NS + '/identifier_select',
  });
  return STEAM_OPENID + '?' + p.toString();
}

/** The 17-digit SteamID from a claimed id, or null. */
export function parseSteamId(claimed) {
  const m = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(String(claimed ?? ''));
  return m ? m[1] : null;
}

/**
 * Checks what Steam sent back with Steam itself (OpenID check_authentication) and returns the SteamID. `params` is a URLSearchParams of the callback query;
 * `callbackUrl` is this function's own address, which the assertion must have been issued for.
 */
export async function verifyAssertion(params, { callbackUrl, fetchFn }) {
  const get = (k) => params.get(k) ?? '';
  if (get('openid.mode') !== 'id_res' || get('openid.op_endpoint') !== STEAM_OPENID) throw new SteamError('not_verified');
  if (!get('openid.return_to').startsWith(callbackUrl)) throw new SteamError('not_verified');
  const steamId = parseSteamId(get('openid.claimed_id'));
  if (!steamId || get('openid.identity') !== get('openid.claimed_id')) throw new SteamError('not_verified');
  const body = new URLSearchParams();
  for (const [k, v] of params) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  let text = '';
  try {
    const res = await fetchFn(STEAM_OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!res.ok) throw new Error('status');
    text = await res.text();
  } catch { throw new SteamError('unavailable'); }
  if (!/^is_valid:true\s*$/m.test(text)) throw new SteamError('not_verified');
  return steamId;
}

/**
 * The player's playtime in the approved games: { status: 'ok', totals: { '<appid>': minutes } } (only games in `appIds`), or { status: 'private' } when Steam returns nothing because
 * the player's game details are not public. Anything else (an HTTP error, a malformed answer, no network) is a SteamError('unavailable') that never carries the key.
 */
export async function fetchOwnedGames({ steamId, key, appIds, fetchFn }) {
  if (!key) throw new SteamError('not_configured');
  if (!/^\d{17}$/.test(String(steamId))) throw new SteamError('bad_return');
  const url = API + '?' + new URLSearchParams({ key, steamid: steamId, include_played_free_games: '1', include_appinfo: '0', format: 'json' }).toString();
  let json;
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('status');
    json = await res.json();
  } catch { throw new SteamError('unavailable'); }
  const r = json?.response;
  if (!r || typeof r !== 'object') throw new SteamError('unavailable');
  if (!('game_count' in r) && !('games' in r)) return { status: 'private' };
  const want = new Set((appIds ?? []).map(Number));
  const totals = {};
  for (const g of Array.isArray(r.games) ? r.games : []) {
    if (g && want.has(g.appid) && Number.isInteger(g.playtime_forever) && g.playtime_forever >= 0) totals[String(g.appid)] = g.playtime_forever;
  }
  return { status: 'ok', totals };
}

/** Compares two secrets without stopping at the first different character. */
export function sameSecret(a, b) {
  const x = enc.encode(String(a ?? '')), y = enc.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && x.length > 0;
}
