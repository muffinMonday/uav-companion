// Structured logging for the edge functions, free of Deno and Supabase so Node tests can run it (tests/edgelog-unit.mjs).
//
// One JSON line per event through console.warn / console.error, which the Supabase function logs pick up: no extra storage and no extra service. What reaches a line is
// an allow-list: fixed field names with a number or a short slug as the value. Error messages are never logged (a database or network error message can hold SQL, ids,
// tokens or addresses): an error is reduced to a classification code by classify(), from the kind of error, its SteamError code, HTTP status or SQLSTATE class only.
// Never in a line: Authorization or x-cron-secret headers, the signed link state, Steam ids, the API key, return addresses, user ids.

/** What an error is, as one of a fixed set of codes. The message text is not read. */
export function classify(err) {
  const name = String(err?.name ?? '');
  const code = err?.code;
  const status = Number(err?.status ?? err?.statusCode);
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  if (name === 'SteamError' || (typeof code === 'string' && /^(bad_state|expired|not_verified|bad_return|not_configured|unavailable)$/.test(code))) {
    return code === 'unavailable' ? 'steam_unavailable' : 'steam_other';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'network';
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) { // a Postgres SQLSTATE
    if (code === '28000' || code === '28P01' || code === '42501') return 'auth';
    if (code.startsWith('22') || code.startsWith('23')) return 'validation';
    return 'db';
  }
  if (name === 'TypeError') return 'network'; // what fetch throws when the connection fails
  if (name === 'SyntaxError') return 'validation';
  return 'unknown';
}

const NUMBER_FIELDS = new Set(['status', 'ms', 'due', 'ok', 'private', 'error', 'skipped', 'left', 'count']);
const SLUG_FIELDS = new Set(['code', 'req']); // a short lower-case word: a classification, a Steam error code, a request id
const SLUG = /^[a-z0-9_]{1,24}$/;
const LEVELS = new Set(['info', 'warn', 'error']);

/** Only the allow-listed fields with acceptable values; everything else is dropped. */
export function safeFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    if (NUMBER_FIELDS.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v);
    else if (SLUG_FIELDS.has(k) && typeof v === 'string' && SLUG.test(v)) out[k] = v;
  }
  return out;
}

/** The line as an object, or null when the level, function name or event is not acceptable. */
export function buildLine(level, fn, event, fields) {
  if (!LEVELS.has(level) || typeof fn !== 'string' || !SLUG.test(fn.replace(/-/g, '_')) || typeof event !== 'string' || !SLUG.test(event)) return null;
  return { lvl: level, fn, event, ...safeFields(fields) };
}

/** A short random id to tie the lines of one request together. */
export function requestId() {
  const b = new Uint8Array(4); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Deno (the platform) is where lines are wanted; Node tests stay quiet unless they inject their own `out`.
const defaultOut = (line) => {
  if (typeof Deno === 'undefined') return;
  const text = JSON.stringify(line);
  if (line.lvl === 'error') console.error(text); else if (line.lvl === 'warn') console.warn(text); else console.info(text);
};

/** logEvent('warn', 'steam-sync', 'sync_failed', { code: classify(e) }). Never throws. `out(line)` receives the line object (tests). */
export function logEvent(level, fn, event, fields = {}, out = defaultOut) {
  try {
    const line = buildLine(level, fn, event, fields);
    if (line) out(line);
  } catch { /* logging must never break a function */ }
}
