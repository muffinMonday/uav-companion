// Steam in the app, the plain part: validating what the database returns (my_steam, list_steam_apps), the wording, reading the result Steam's sign-in leaves in the address,
// and the calls to the database and the edge functions (supabase/migrations/20261114140000_steam.sql, supabase/functions/steam-*). The app never sends playtime: the edge functions
// read it from Steam and the database counts it. The Steam id is never returned to the app.

const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const when = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** my_steam made safe to draw. */
export function cleanSteam(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true, linked: r.linked === true, everLinked: r.ever_linked === true, hours: int(r.hours), minutesToNext: int(r.minutes_to_next),
    lastSyncedAt: when(r.last_synced_at), lastStatus: ['ok', 'private', 'error'].includes(r.last_status) ? r.last_status : null, manualAvailableAt: when(r.manual_available_at),
    xpPerHour: int(r.xp_per_hour) || 10,
  };
}

/** list_steam_apps as [{ id, name }]. */
export function cleanApps(rows) {
  return Array.isArray(rows) ? rows.filter((a) => a && Number.isFinite(Number(a.app_id)) && typeof a.name === 'string' && a.name).map((a) => ({ id: Number(a.app_id), name: a.name.slice(0, 80) })).slice(0, 50) : [];
}

/** "a few seconds", "5 minutes" until `iso`, or '' when it is not in the future. */
export function waitText(iso, now = Date.now()) {
  const s = Math.ceil((Date.parse(iso) - +now) / 1000);
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return 'a few seconds';
  const m = Math.ceil(s / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export const RESULT_TEXT = {
  linked: 'Steam account linked. Playtime from now on in the approved simulators earns XP.',
  private: 'Your Steam game details are private, so nothing could be read. Set Game details to Public in your Steam privacy settings, then link again.',
  taken: 'That Steam account is already linked to another UAV Companion account.',
  error: 'Linking your Steam account did not work. Try again in a little while.',
};

/** The result Steam's sign-in left in the address (?steam=linked|private|taken|error), or null. */
export function returnResult(search) {
  try { const v = new URLSearchParams(search).get('steam'); return v && Object.hasOwn(RESULT_TEXT, v) ? v : null; } catch { return null; }
}

/** The address without the steam parameter, so a reload does not announce the result again. */
export function withoutResult(href) {
  const u = new URL(href); u.searchParams.delete('steam'); return u.pathname + (u.search || '') + u.hash;
}

/** True only for an address on Steam's own sign-in page: the app goes nowhere else when linking. */
export const isSteamSignIn = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'steamcommunity.com' && u.pathname === '/openid/login'; } catch { return false; } };

async function fnError(error) {
  let body = null;
  try { body = await error.context.json(); } catch { body = null; }
  const e = new Error(body?.error || (body?.reason === 'cooldown' ? 'Sync now is not available yet.' : body?.reason === 'not_linked' ? 'No Steam account is linked.' : body?.reason === 'disabled' ? 'Steam is not switched on yet.' : 'That did not work. Try again.'));
  e.reason = body?.reason ?? null; e.retryAfterSeconds = Number.isFinite(body?.retry_after_seconds) ? body.retry_after_seconds : null;
  return e;
}

export function createSteam(client) {
  const rpc = async (fn, args) => { const { data, error } = await client.rpc(fn, args); if (error) throw new Error(error.message); return data; };
  const invoke = async (name, body) => { const { data, error } = await client.functions.invoke(name, { body }); if (error) throw await fnError(error); return data; };
  return {
    async status() { return cleanSteam(await rpc('my_steam')); },
    async apps() { return cleanApps(await rpc('list_steam_apps')); },
    unlink: () => rpc('unlink_steam'),
    /** The Steam sign-in address for a person who wants to link; `returnUrl` is where Steam sends them back (it must be an origin the project allows). */
    async startLink(returnUrl) { const d = await invoke('steam-link', { return: returnUrl }); if (!isSteamSignIn(d?.url)) throw new Error('Steam linking is not available right now.'); return d.url; },
    /** "Sync now". Resolves { status: 'ok' | 'private', hours_added?, hours? }; throws with .reason ('cooldown', 'not_linked', ...) and .retryAfterSeconds. */
    syncNow: () => invoke('steam-sync', {}),
  };
}
