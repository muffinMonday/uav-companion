// Recurrence for flight sessions, the plain part: which dates a repeat gives, so the creation form can preview them. The database makes the real sessions with the same rule
// (session_occurrence_date in supabase/migrations/20261118110000_sessions_v2_series_invites.sql) and keeps the local wall time across daylight saving in the event's time zone;
// this works on calendar dates only ('YYYY-MM-DD'), so it never depends on the browser's zone or on DST.

export const FREQUENCIES = [
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every two weeks' },
  { id: 'monthly', label: 'Every month (same day)' },
];
export const MIN_COUNT = 2, MAX_COUNT = 12, DEFAULT_COUNT = 4;

const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; const [y, mo, d] = [+m[1], +m[2], +m[3]]; const t = new Date(Date.UTC(y, mo - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, mo, d } : null; };
const fmt = (t) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate(); // mo is 1 to 12

/** The date of occurrence `i` (0 = the first) of a series that starts on `start`. A monthly repeat on the 29th to 31st clamps only the short months and returns to the chosen day after. */
export function occurrenceDate(start, frequency, i) {
  const p = parse(start);
  if (!p || !Number.isInteger(i) || i < 0) return null;
  if (frequency === 'weekly' || frequency === 'biweekly') return fmt(new Date(Date.UTC(p.y, p.mo - 1, p.d + (frequency === 'weekly' ? 7 : 14) * i)));
  if (frequency !== 'monthly') return null;
  const months = p.mo - 1 + i, y = p.y + Math.floor(months / 12), mo = (months % 12) + 1;
  return `${y}-${pad(mo)}-${pad(Math.min(p.d, daysIn(y, mo)))}`;
}

/** All dates of the series, or [] when the start, the repeat or the count is not valid. */
export function occurrenceDates(start, frequency, count) {
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT || !parse(start)) return [];
  const out = [];
  for (let i = 0; i < count; i++) { const d = occurrenceDate(start, frequency, i); if (!d) return []; out.push(d); }
  return out;
}

/** The first Saturday on or after `from` ('YYYY-MM-DD'), the preferred weekly preset. */
export function nextSaturday(from) {
  const p = parse(from);
  if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  t.setUTCDate(t.getUTCDate() + ((6 - t.getUTCDay() + 7) % 7));
  return fmt(t);
}

/** Calendar date of a Date in the viewer's zone ('YYYY-MM-DD'). */
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'HH:MM' of a Date in the viewer's zone. */
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Sat 15 Nov 2026" for a 'YYYY-MM-DD' (no zone involved). */
export function dateLabel(s, locale = 'en-GB') {
  const p = parse(s);
  return p ? new Date(Date.UTC(p.y, p.mo - 1, p.d)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

/**
 * What the preview says: the first `show` dates and the total, plus notes for monthly dates that had to move (the 29th to 31st in a short month).
 * Resolves { dates, total, lines, notes } (empty when the input is not valid).
 */
export function previewSeries(start, frequency, count, { show = 3, locale = 'en-GB' } = {}) {
  const dates = occurrenceDates(start, frequency, count);
  if (!dates.length) return { dates: [], total: 0, lines: [], notes: [] };
  const want = parse(start).d;
  const notes = frequency !== 'monthly' ? [] : dates.map((d, i) => ({ d, i })).filter(({ d }) => +d.slice(8) !== want).map(({ d, i }) => `Session ${i + 1} (${dateLabel(d, locale)}) is on day ${+d.slice(8)} because that month has no day ${want}.`);
  return { dates, total: dates.length, lines: dates.slice(0, show).map((d) => dateLabel(d, locale)), notes };
}
