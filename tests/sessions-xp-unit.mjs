// The XP explanation in a session's details (src/sessions-xp.js xpExplainText) and the host reward rates read from the database (src/sessions.js cleanRates). Pure logic, no browser.
import { xpExplainText, xpBadgeInfo } from '../src/sessions-xp.js';
import { cleanRates } from '../src/sessions.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const RATES = { hostBase: 50, hostPerAttendee: 10 };
const base = { status: 'scheduled', isHost: false, xpReward: 50 };

// a participant: the session's own amount, and the RSVP sentence
ok(xpExplainText(base, RATES) === 'Earn 50 XP when your attendance is verified. RSVP alone earns no XP.', 'a participant is told the session amount and that RSVP alone earns nothing');
ok(xpExplainText({ ...base, xpReward: 75 }, null)?.startsWith('Earn 75 XP when'), 'the participant amount comes from the session, not a constant (75 shown as 75)');
ok(xpExplainText({ ...base, xpReward: null }, RATES) === null, 'no XP possible for this session (null): no note');
ok(xpExplainText({ ...base, xpReward: 0 }, RATES) === null && xpExplainText({ ...base, xpReward: 2.5 }, RATES) === null, 'a zero or fractional amount is not shown');
ok(xpExplainText({ ...base, status: 'closed' }, RATES) === null && xpExplainText({ ...base, status: 'cancelled', xpReward: 50 }, RATES) === null, 'a closed or cancelled session has no note');

// a host: the database host reward, with the close rule and the one-attendee rule
const host = { status: 'scheduled', isHost: true, xpReward: null };
ok(xpExplainText(host, RATES) === 'Earn 50 XP when the session closes, plus 10 XP for each verified attendee. At least one verified attendee is required for the host reward.', 'a host is told the close reward and the per-attendee amount');
ok(xpExplainText(host, { hostBase: 40, hostPerAttendee: 12 })?.startsWith('Earn 40 XP when the session closes, plus 12 XP'), 'the host amounts are the rates given, not fixed numbers');
ok(xpExplainText(host, null) === null, 'without the rates from the database the host gets no note (no guessed number)');
ok(xpExplainText(host, { hostBase: 0, hostPerAttendee: 0 }) === null, 'host rates of 0 mean no host note');
ok(xpExplainText({ ...host, status: 'closed' }, RATES) === null, 'a host of a closed session has no note');
ok(xpExplainText({ ...host, xpReward: 50 }, RATES)?.startsWith('Earn 50 XP when the session closes'), 'a host who is also an organiser gets the host rule, not the attendee rule');
ok(xpExplainText(null, RATES) === null && xpExplainText(undefined, RATES) === null, 'no session, no note');

// the badge still says the participant amount
ok(xpBadgeInfo({ xpReward: 50 })?.label === '+50 XP' && /RSVP alone earns none/.test(xpBadgeInfo({ xpReward: 50 }).title), 'the +50 XP badge stays the participant reward');

// the rates read from session_xp_rates
ok(JSON.stringify(cleanRates({ host_base_xp: 50, host_per_attendee_xp: 10 })) === JSON.stringify(RATES), 'rates are read as whole numbers');
ok(cleanRates({ host_base_xp: 50 }) === null && cleanRates(null) === null && cleanRates({ host_base_xp: '50', host_per_attendee_xp: 10 }) === null, 'missing, text or null rates are not used');
ok(cleanRates({ host_base_xp: -1, host_per_attendee_xp: 10 }) === null && cleanRates({ host_base_xp: 0, host_per_attendee_xp: 0 })?.hostBase === 0, 'negative rates are refused; zero is a real answer');
