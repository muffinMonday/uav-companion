// Calendar-date arithmetic on ISO dates ("2026-11-12"). Pure. Dates here have no time zone or time of day.

const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** An ISO date n days later (or earlier). */
export function addDays(iso, n) {
  const d = new Date(ms(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from date a to date b (negative if b is earlier). */
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 86400000);
