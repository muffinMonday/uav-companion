// Recurrence preview for flight sessions (src/sessions-recurrence.js) and the creation form's request building (src/sessions-create.js, pure parts). Calendar dates only: no browser, no zone.
import { occurrenceDate, occurrenceDates, nextSaturday, previewSeries, MAX_COUNT } from '../src/sessions-recurrence.js';
import { durationMinutes, draftToRequest, blankDraft } from '../src/sessions-create.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the dates
ok(eq(occurrenceDates('2026-11-14', 'weekly', 4), ['2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05']), 'weekly: four Saturdays');
ok(eq(occurrenceDates('2026-11-14', 'biweekly', 3), ['2026-11-14', '2026-11-28', '2026-12-12']), 'every two weeks');
ok(eq(occurrenceDates('2026-12-26', 'weekly', 3), ['2026-12-26', '2027-01-02', '2027-01-09']), 'weekly crosses the year');
ok(eq(occurrenceDates('2026-10-30', 'weekly', 2), ['2026-10-30', '2026-11-06']), 'weekly crosses the month (dates only, no clock change involved)');
ok(eq(occurrenceDates('2026-01-15', 'monthly', 3), ['2026-01-15', '2026-02-15', '2026-03-15']), 'monthly keeps the day');
ok(eq(occurrenceDates('2026-01-31', 'monthly', 5), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']), 'monthly on the 31st clamps only the short months and returns to the 31st');
ok(occurrenceDate('2028-01-30', 'monthly', 1) === '2028-02-29', 'a leap February takes the 29th');
ok(occurrenceDate('2026-11-14', 'monthly', 12) === '2027-11-14', 'twelve months on is the next year');
ok(occurrenceDates('2026-11-14', 'weekly', 12).length === 12 && eq(occurrenceDates('2026-11-14', 'weekly', MAX_COUNT + 1), []) && eq(occurrenceDates('2026-11-14', 'weekly', 1), []), 'a series has 2 to 12 sessions');
for (const bad of ['', 'x', '2026-02-30', '2026-13-01', null]) ok(eq(occurrenceDates(bad, 'weekly', 4), []), 'refused date: ' + bad);
ok(eq(occurrenceDates('2026-11-14', 'daily', 4), []), 'an unknown repeat gives nothing');

// ---------- the Saturday preset
ok(nextSaturday('2026-11-14') === '2026-11-14', 'a Saturday stays');
ok(nextSaturday('2026-11-15') === '2026-11-21', 'Sunday moves to the next Saturday');
ok(nextSaturday('2026-11-13') === '2026-11-14', 'Friday moves to the next day');
ok(nextSaturday('2026-12-30') === '2027-01-02', 'across the year');

// ---------- the preview text
let p = previewSeries('2026-11-14', 'weekly', 4);
ok(p.total === 4 && p.lines.length === 3 && p.notes.length === 0 && /Sat/.test(p.lines[0]), 'preview: the total and the first three dates, no notes');
p = previewSeries('2026-01-31', 'monthly', 4);
ok(p.notes.length === 2 && /day 28/.test(p.notes[0]) && /day 30/.test(p.notes[1]), 'preview: a clamped monthly date is explained: ' + p.notes[0]);
ok(previewSeries('2026-11-14', 'weekly', 99).total === 0, 'preview: an invalid count gives an empty preview');

// ---------- duration and the request
ok(durationMinutes('10:00', '13:30') === 210 && durationMinutes('22:00', '01:00') === 180 && durationMinutes('10:00', '10:00') === 1440 && durationMinutes('', '10:00') === null, 'duration: same day, across midnight, equal times mean the next day, empty is refused');
const base = { ...blankDraft(new Date(2026, 10, 14, 9, 30)), title: ' Field day ', lat: 30.5, lng: 114.25 };
ok(base.date === '2026-11-15' && base.start === '10:00' && base.end === '13:00' && base.visibility === 'private' && base.repeat === 'none', 'a blank draft: tomorrow, the next full hour, three hours, private, no repeat');
let r = draftToRequest(base, 'Asia/Shanghai');
ok(!r.error && r.series === false && r.title === 'Field day' && r.visibility === 'private' && r.timezone === 'Asia/Shanghai' && r.capacity === null && Date.parse(r.endsAt) - Date.parse(r.startsAt) === 3 * 3600000, 'a one-off request: trimmed title, private, zone, no capacity, three hours');
ok(draftToRequest({ ...base, title: '  ' }).error && draftToRequest({ ...base, lat: null, lng: null }).error && draftToRequest({ ...base, date: '' }).error && draftToRequest({ ...base, start: '' }).error, 'a title, a date, times and a map point are required');
ok(/point/.test(draftToRequest({ ...base, lat: null, lng: null }).error), 'the missing point is named');
ok(draftToRequest({ ...base, visibility: 'public', ack: false }).error && !draftToRequest({ ...base, visibility: 'public', ack: true }).error, 'public needs the confirmation that the exact point is visible');
ok(draftToRequest({ ...base, capacity: '0' }).error && draftToRequest({ ...base, capacity: '501' }).error && draftToRequest({ ...base, capacity: '2.5' }).error && draftToRequest({ ...base, capacity: '12' }).capacity === 12 && draftToRequest({ ...base, capacity: '' }).capacity === null, 'capacity is 1 to 500 or empty');
r = draftToRequest({ ...base, repeat: 'weekly', count: 4, date: '2026-11-14' }, 'Asia/Shanghai');
ok(r.series === true && r.localStart === '2026-11-14T10:00:00' && r.durationMinutes === 180 && r.frequency === 'weekly' && r.count === 4 && !('startsAt' in r), 'a series request: the wall time, the duration, the repeat and the count');
ok(draftToRequest({ ...base, repeat: 'weekly', count: 13 }).error && draftToRequest({ ...base, repeat: 'weekly', count: 1 }).error, 'a series has 2 to 12 sessions in the request too');
