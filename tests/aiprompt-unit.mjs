import { buildTripPrompt, buildLinkPrompt, checkUrl, cleanTrip, LIMITS } from '../src/aiprompt.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++; };
const BASE = 'FORMAT: a GeoJSON FeatureCollection.\n\nRULES\n1. one Feature per place\n\nMY ITINERARY:\n';

const t = buildTripPrompt({ destination: '  Kyoto,\n Japan ', when: '5 days in April 2027', interests: 'temples, sunrise' }, BASE);
ok(t.includes('Destination: Kyoto, Japan') && t.includes('5 days in April 2027') && t.includes('temples, sunrise'), 'the trip prompt carries the request, whitespace tidied');
ok(t.includes('FORMAT: a GeoJSON FeatureCollection') && t.indexOf('RULES') < t.indexOf('Destination:'), 'and the format rules, with the request after them');
ok(t.startsWith('I have not written an itinerary yet'), 'the instruction comes first');
ok(buildTripPrompt({ destination: '   ' }, BASE) === '' && buildTripPrompt({}, BASE) === '', 'a trip prompt needs a destination');
ok(!buildTripPrompt({ destination: 'Paris' }, BASE).includes('When, or how many days') && !buildTripPrompt({ destination: 'Paris' }, BASE).includes('Interests:'), 'dates and interests are left out when empty');
const long = cleanTrip({ destination: 'x'.repeat(500), when: 'y'.repeat(500), interests: 'z'.repeat(900) });
ok(long.destination.length === LIMITS.destination && long.when.length === LIMITS.when && long.interests.length === LIMITS.interests, 'long input is cut to its limits');

ok(checkUrl('https://example.com/trip?id=3').ok && checkUrl('http://example.com').ok, 'http and https links are accepted');
for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///C:/x', 'ftp://example.com', 'example.com/trip', 'not a link', '', 'https://a.com/' + 'x'.repeat(600), 'https://a.com/ b']) ok(!checkUrl(bad).ok && checkUrl(bad).reason, 'refused: ' + bad.slice(0, 40));
const l = buildLinkPrompt({ url: ' https://example.com/trip ', note: 'only the first three days' }, BASE);
ok(l.includes('Link: https://example.com/trip') && l.includes('only the first three days') && l.includes('cannot open links') && l.includes('FORMAT: a GeoJSON'), 'the link prompt has the link, the note, the fallback and the rules');
ok(buildLinkPrompt({ url: 'javascript:alert(1)' }, BASE) === '' && buildLinkPrompt({}, BASE) === '', 'a bad link gives no prompt');

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('aiprompt-unit: all passed');
