// Privacy scrubbing for the diagnostic log (see log.js). Pure: no DOM, no storage.
//
// The log stays in this browser, but an exported file can be sent to someone, so nothing sensitive may ever reach the store: no tokens or keys, no addresses, no
// coordinates, no names, no ids. The method is an allow-list first: an entry is rebuilt from known fields only, and the `data` object keeps only the keys named in
// DATA_KEYS with plain values. Free text (messages, stack traces, URLs) cannot be allow-listed, so it goes through redaction patterns and is cut short.

const MAX_TEXT = 200;
const MAX_STACK_FRAMES = 8;

/** The only keys a log entry's `data` may carry. `error_name` is the JavaScript error type (TypeError); `name` is deliberately not here (people, places, trips). */
export const DATA_KEYS = ['status', 'code', 'error_name', 'count', 'ms', 'attempt', 'online', 'visible', 'kind', 'route'];
/** Keys that are never accepted, in any nesting, whatever else changes. Checked as a second line behind the allow-list. */
export const DENY_KEY = /token|key|secret|auth|password|passwd|email|lat|lng|lon|coord|position|steam|name|trip|poi|home|address|session|cookie|url|jwt/i;
const ROUTES = new Set(['map', 'search', 'panel', 'markers', 'trips', 'friends', 'sessions', 'account', 'privacy', 'sync', 'weather', 'progression', 'steam', 'ai', 'live', 'party', 'other']);
const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const REDACTED = '[redacted]';
const URL_RE = /\b(?:https?|wss?|file|blob):\/\/[^\s"'<>)\]]+/gi;
const PATTERNS = [
  [/eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, REDACTED], // JWT
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ' + REDACTED],
  [/\bsb_(?:publishable|secret)_[\w-]+/gi, REDACTED], // Supabase keys
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, REDACTED], // e-mail
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, REDACTED], // uuid (user, trip, session ids)
  [/\b\d{17}\b/g, REDACTED], // Steam id
  [/\b(lat(?:itude)?|lng|lon(?:gitude)?|token|api[_-]?key|key|secret|password|passwd|auth(?:orization)?|state|position|coords?)\s*[=:]\s*(?:\[redacted\]|[^\s,;&"')\]}]+)/gi, '$1=' + REDACTED], // the [redacted] alternative keeps a second pass from growing the marker
  [/-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/g, REDACTED], // a coordinate pair
  [/-?\d{1,3}\.\d{4,}/g, REDACTED], // a lone decimal with the precision of a position
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, REDACTED], // long opaque run (key, hash, base64)
];

/** A URL reduced to origin and path: no query, no hash, no credentials, and ids in the path are redacted by the text patterns afterwards. */
export function scrubUrl(u) {
  const s = String(u);
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@\s]*@)?([^/?#\s]*)([^?#\s]*)/i.exec(s);
  return m ? m[1] + m[2] + m[3] : s.split(/[?#]/)[0];
}

/** Free text: URLs trimmed, then the redaction patterns, then cut to `max` characters. Never throws. */
export function scrubText(value, max = MAX_TEXT) {
  let s;
  try { s = typeof value === 'string' ? value : value == null ? '' : String(value); } catch { return ''; }
  s = s.replace(URL_RE, (u) => scrubUrl(u));
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** A stack trace: at most 8 frames, each file path cut to its basename (and line:column), then the same redaction as text. */
export function scrubStack(stack) {
  if (typeof stack !== 'string' || !stack) return '';
  const frames = stack.split('\n').slice(0, MAX_STACK_FRAMES + 1).map((line) =>
    scrubText(line.replace(/(?:https?:\/\/|file:\/\/\/?|blob:)[^\s()]*?\/([^/\s():?#]+)(?:\?[^\s():]*)?((?::\d+){1,2})/g, '$1$2'), 160));
  return frames.filter(Boolean).join('\n');
}

/** A route is one of a fixed set of identifiers, optionally followed by template segments (`trips/:id`), never a raw path, query or id. */
export function safeRoute(r) {
  if (typeof r !== 'string') return 'other';
  const parts = r.split('/');
  if (!ROUTES.has(parts[0])) return 'other';
  for (const p of parts.slice(1)) if (!/^:[a-z]{1,12}$/.test(p)) return 'other';
  return parts.slice(0, 3).join('/');
}

/** The `data` object of an entry: only the allow-listed keys, only plain values. Nested objects and arrays are dropped, not searched. */
export function scrubData(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const k of DATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
    if (k !== 'error_name' && DENY_KEY.test(k)) continue; // belt and braces behind the allow-list; 'error_name' is the one reviewed exception ('name' is denied)
    const v = data[k];
    if (k === 'route') out.route = safeRoute(v);
    else if (k === 'error_name') out.error_name = typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_$]{0,40}$/.test(v) ? v : 'Error';
    else if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = scrubText(v, 60);
  }
  return out;
}

const SRC_RE = /^[a-z][a-z0-9._-]{0,30}$/i;

/** An entry rebuilt from known fields only. Idempotent (scrubbing twice changes nothing), so the store and the export can both call it. */
export function scrubEntry(e) {
  const x = e && typeof e === 'object' ? e : {};
  const out = {
    id: Number.isFinite(x.id) ? x.id : 0,
    t: Number.isFinite(x.t) ? x.t : 0,
    level: LEVELS.has(x.level) ? x.level : 'error',
    src: typeof x.src === 'string' && SRC_RE.test(x.src) ? x.src : 'app',
    msg: scrubText(x.msg),
    data: scrubData(x.data),
    count: Number.isFinite(x.count) && x.count > 0 ? Math.min(Math.floor(x.count), 1e6) : 1,
  };
  if (Number.isFinite(x.last) && x.last > out.t) out.last = x.last;
  const stack = scrubStack(x.stack);
  if (stack) out.stack = stack;
  return out;
}
