// The dashboard's rules: how it starts, what's new, the backup reminder. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const S = await load('src/dashstate.js');
const { WHATS_NEW } = await load('src/whatsnew.js');
const today = '2026-11-11';

// ---------- how it starts
ok(S.startState({ today }) === 'expanded', 'a returning visitor on a desktop: open');
ok(S.startState({ today, phone: true }) === 'peek', 'on a phone: the one-line strip');
ok(S.startState({ today, phone: true, firstRun: true }) === 'expanded', 'a first visit opens it even on a phone');
ok(S.startState({ today, hideUntil: today }) === 'peek', '"Do not show for today" drops it to the strip');
ok(S.startState({ today, hideUntil: '2026-11-10' }) === 'expanded', 'and it is back the next day');
ok(S.startState({ today, showOnStart: false }) === 'hidden', 'with the start switch off it is hidden behind the ^ tab');
ok(S.startState({ today, hideUntil: today, unseen: 1 }) === 'expanded' && S.startState({ today, phone: true, unseen: 1 }) === 'expanded', 'a waiting What\'s new entry opens it once, even for today\'s snooze and on a phone');
ok(S.startState({ today, showOnStart: false, unseen: 1 }) === 'expanded', 'even when it is switched off for start');
ok(S.startState({ today, shared: true, unseen: 1 }) === 'peek' && S.startState({ today, shared: true }) === 'peek', 'a share link has the attention: the strip');

// ---------- what's new
const list = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
ok(S.unseenEntries(list, null).map((e) => e.id).join() === 'c,b,a', 'a first-time visitor sees every entry');
ok(S.unseenEntries(list, 'b').map((e) => e.id).join() === 'c', 'only entries newer than the last one seen');
ok(S.unseenEntries(list, 'c').length === 0, 'none when the newest was seen');
ok(S.unseenEntries([{ id: 'e' }, { id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }], null).length === S.MAX_NEW, 'at most three at once');
ok(S.unseenEntries(list, 'gone').length === 3, 'an id that is no longer in the list counts as everything new');
ok(WHATS_NEW.length >= 1 && WHATS_NEW.every((e) => e.id && e.title && e.items.length), 'the shipped entries have an id, a title and items');
ok(new Set(WHATS_NEW.map((e) => e.id)).size === WHATS_NEW.length, 'entry ids are unique');

// ---------- backup reminder
const now = Date.parse('2026-11-11T12:00:00Z');
ok(S.backupDue(null, 0, now) === null && S.backupDue('2020-01-01T00:00:00Z', 0, now) === null, 'no markers: nothing to back up');
ok(S.backupDue(null, 3, now)?.never === true, 'markers and no backup yet: ask');
ok(S.backupDue('2026-11-01T00:00:00Z', 3, now) === null, 'a backup ten days old is fine');
ok(S.backupDue('2026-09-27T12:00:00Z', 3, now)?.days === 45, 'a backup 45 days old: ask, with the age');
ok(S.backupDue('garbage', 3, now)?.never === true, 'an unreadable date counts as never');

// ---------- stored choices
ok(JSON.stringify(S.sanitize(null)) === JSON.stringify({ showOnStart: true, hideUntil: null, seen: null, welcomed: false, account: null }), 'defaults: shown on start, nothing hidden, nothing seen');
const s = S.sanitize({ showOnStart: false, hideUntil: '2026-11-11', seen: 'x', welcomed: true });
ok(s.showOnStart === false && s.hideUntil === '2026-11-11' && s.seen === 'x' && s.welcomed === true, 'valid values are kept');
const bad = S.sanitize({ showOnStart: 'no', hideUntil: 'tomorrow', seen: 5, welcomed: 'yes' });
ok(S.sanitize({ account: 'guest' }).account === 'guest' && S.sanitize({ account: 'profile' }).account === 'profile' && S.sanitize({ account: 'admin' }).account === null && S.sanitize({ account: 7 }).account === null, 'the account answer keeps only guest or profile');
ok(bad.showOnStart === true && bad.hideUntil === null && bad.seen === null && bad.welcomed === false, 'damaged values fall back to the defaults');

// ---------- storage readout
{
  const { storageUse, sizeLabel, STORAGE_QUOTA } = await import('../src/dashstate.js');
  const fake = (o) => ({ get length() { return Object.keys(o).length; }, key: (i) => Object.keys(o)[i] ?? null, getItem: (k) => o[k] ?? null });
  const u = storageUse(fake({ 'uavzones.v1.pois': 'x'.repeat(1000), 'other.site.key': 'y'.repeat(9999) }));
  ok(u.chars === 'uavzones.v1.pois'.length + 1000, 'storage use counts only the app\'s own keys: ' + u.chars);
  ok(!u.warn && u.pct < 0.01, 'a small store raises no warning');
  ok(storageUse(fake({ 'uavzones.v1.pois': 'x'.repeat(STORAGE_QUOTA * 0.81) })).warn, 'past 80% of the quota it warns');
  ok(!storageUse(fake({ 'uavzones.v1.pois': 'x'.repeat(STORAGE_QUOTA * 0.79) })).warn, 'just under 80% it does not');
  ok(storageUse({ get length() { throw new Error('blocked'); } }) === null, 'blocked storage gives no readout instead of an error');
  ok(sizeLabel(62000) === '62 KB' && sizeLabel(10) === '1 KB' && sizeLabel(1400000) === '1.4 MB', 'size labels: ' + sizeLabel(62000) + ', ' + sizeLabel(1400000));
}

// ---------- the strip's text: route > trip > my next session > private invitations > nothing
{
  const now = new Date(2026, 10, 27, 10, 0, 0);
  const at = (dd, h, m = 0) => new Date(2026, 10, 27 + dd, h, m).toISOString();
  const next = (dd, h) => ({ title: 'Saturday FPV Meetup', startsAt: at(dd, h) });
  ok(S.sessionWhen(at(1, 9), now) === 'Tomorrow, 09:00' && S.sessionWhen(at(0, 15), now) === 'Today, 15:00', 'session time: Tomorrow / Today with 24 h clock');
  ok(/^Tue 1 Dec, 09:00$|^Tue, 1 Dec, 09:00$/.test(S.sessionWhen(at(4, 9), now)), 'a later session shows the weekday and date: ' + S.sessionWhen(at(4, 9), now));
  ok(S.sessionWhen(at(0, 9), now) === 'Now', 'a session that has started reads Now');
  const all = { routeStops: 3, tripText: 'Hubei · 8 days to go', sessions: { next: next(1, 9), invites: 2 }, now };
  ok(S.peekText(all) === 'Route · 3 stops' && S.peekText({ ...all, routeStops: 1 }) === 'Route · 1 stop', 'route is first');
  ok(S.peekText({ ...all, routeStops: 0 }) === 'Hubei · 8 days to go', 'a trip beats an imminent flight session');
  ok(S.peekText({ ...all, routeStops: 0, tripText: null }) === 'Saturday FPV Meetup · Tomorrow, 09:00', 'then my next flight session');
  ok(S.peekText({ ...all, routeStops: 0, tripText: null, sessions: { next: null, invites: 2 } }) === '2 private session invitations', 'then pending private invitations');
  ok(S.peekText({ sessions: { next: null, invites: 1 } }) === '1 private session invitation', 'one invitation is singular');
  ok(S.peekText({ sessions: { next: null, invites: 0, soon: null, nearby: { count: 5 } } }) === null && S.peekText({}) === null && S.peekText({ sessions: null }) === null, 'nearby public sessions and no data give nothing (the strip falls back to Dashboard)');
}
