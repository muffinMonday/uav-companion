// Steam playtime (supabase/migrations/20261114140000_steam.sql, 20261116100000_steam_existing_hours.sql): linking (hours played before linking count), the stored totals, turning minutes into hours of XP, the safeguards, the manual cooldown, the daily list,
// unlinking, and who can call what. Tested on a real Postgres (PGlite). No browser, no network, no Steam: the edge functions' part is tested in steam-unit.mjs.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const fails = async (q, params = []) => { try { await db.query(q, params); return null; } catch (e) { return String(e.message || e); } };
const J = (o) => JSON.stringify(o);
// the service role, as the edge functions use it
async function svc(q, params = []) { await db.exec('set role service_role'); try { return (await db.query(q, params)).rows; } finally { await db.exec('reset role'); } }
const link = (u, id, totals) => svc('select public.steam_link($1, $2, $3::jsonb) as r', [u, id, J(totals)]).then((r) => r[0].r);
const apply = (u, totals, status = 'ok') => svc('select public.apply_steam_playtime($1, $2::jsonb, $3) as r', [u, J(totals), status]).then((r) => r[0].r);
const total = async (u) => (await sql('select total from public.user_xp where user_id = $1', [u]))[0]?.total ?? 0;
const hoursRows = async (u) => (await sql(`select ref, amount from public.xp_ledger where user_id = $1 and source = 'sim' order by id`, [u]));
const unlocked = async (u) => (await sql('select achievement_key as k from public.user_achievements where user_id = $1', [u])).map((r) => r.k);
const state = async (u) => Object.fromEntries((await sql('select app_id, last_total_minutes as m from public.steam_app_state where user_id = $1', [u])).map((r) => [String(r.app_id), r.m]));
const lrow = async (u) => (await sql('select * from public.steam_links where user_id = $1', [u]))[0];

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
const ID_A = '76561198000000001', ID_B = '76561198000000002', ID_C = '76561198000000003';
const LIFT = 410340, DRL = 641780;

// ---------- the approved list, and nobody reaches the tables or the internal functions
const apps = await as(db, A, 'select * from public.list_steam_apps()');
ok(apps.length === 6 && J(apps.map((a) => Number(a.app_id)).sort((x, y) => x - y)) === J([LIFT, 641780, 1432320, 1682970, 1881200, 2398030].sort((x, y) => x - y)), 'six approved simulators with the approved Steam App IDs');
ok(/FPV LOGIC/.test(J(apps)) && /Micro Drones/.test(J(apps)) && /Uncrashed/.test(J(apps)) && /TRYP/.test(J(apps)) && /Drone Racing League/.test(J(apps)), 'and their names');
ok(/permission denied/.test(await refused(db, null, 'select * from public.list_steam_apps()')), 'a visitor cannot list them');
for (const t of ['steam_apps', 'steam_links', 'steam_app_state', 'steam_credited']) ok(/permission denied/.test(await refused(db, A, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' cannot be read directly');
const internal = [`public.steam_link('${A}', '${ID_A}', '{}')`, `public.apply_steam_playtime('${A}', '{}')`, `public.claim_manual_sync('${A}')`, `public.release_manual_sync('${A}', null)`, 'public.list_steam_due(10)', `public.steam_totals_clean('{}')`];
for (const f of internal) ok(/permission denied/.test(await refused(db, A, `select ${f}`)) && /permission denied/.test(await refused(db, null, `select ${f}`)), f.split('(')[0] + ' is closed to users and visitors');
ok((await svc(`select public.steam_totals_clean('{"410340": 5}') as r`)).length === 1, 'and open to the service role');
ok(/permission denied/.test(await refused(db, A, `select public.my_steam()`)) === false && (await one(A, 'public.my_steam()')).enabled === false, 'my_steam is the user\'s own view, and says the feature is not switched on yet');
ok(/not enabled/.test(await fails(`select public.steam_link('${A}', '${ID_A}', '{}')`) ?? ''), 'until the feature is switched on, nothing can be linked');
await db.exec(`update public.progression_settings set value = 1 where key = 'steam_enabled'`);
ok((await one(A, 'public.my_steam()')).enabled === true, 'switched on');

// ---------- linking: the approved games are stored (here with no playtime yet), and First Connection
let r = await link(A, ID_A, { [LIFT]: 0, 999999: 500 });
ok(r.status === 'linked' && J(await state(A)) === J({ [LIFT]: 0 }) && await total(A) === 0, 'linking stores the approved games only (999999 is not approved); with no playtime there is no XP');
ok((await unlocked(A)).includes('first-connection') && !(await unlocked(A)).includes('first-flight'), 'First Connection unlocks on linking');
let my = await one(A, 'public.my_steam()');
ok(my.linked === true && my.ever_linked === true && my.hours === 0 && my.minutes_to_next === 0 && my.last_status === 'ok' && my.xp_per_hour === 10 && my.manual_available_at === null, 'my_steam: linked, 0 hours, nothing towards the next one');
ok(!J(my).includes(ID_A) && !J(my).includes('76561198'), 'and it never shows the Steam id');
ok(/already linked to another account/.test(await fails(`select public.steam_link('${B}', '${ID_A}', '{}')`) ?? ''), 'a Steam account cannot be linked to two people');
ok(!(await lrow(B)) && (await one(B, 'public.my_steam()')).linked === false && (await one(B, 'public.my_steam()')).ever_linked === false, 'and the second person stays unlinked');
const badLinks = [[A, 'abc', {}], [A, '1234567890123456', {}], [A, null, {}], [null, ID_A, {}]];
for (const [u, id, t] of badLinks) ok(/invalid steam link/.test(await fails('select public.steam_link($1, $2, $3::jsonb)', [u, id, J(t)]) ?? ''), 'refused link: ' + J([u && 'user', id]));
const badTotals = [[], 'x', null, { 'x': 5 }, { [LIFT]: -1 }, { [LIFT]: '30' }, { [LIFT]: 1.5 }, { [LIFT]: 10000001 }, { [LIFT]: null }, { '1234567890123': 5 }];
for (const t of badTotals) ok(/invalid playtime/.test(await fails('select public.steam_link($1, $2, $3::jsonb)', [B, ID_B, J(t)]) ?? ''), 'refused playtime: ' + J(t));
ok(!(await lrow(B)), '(nothing was linked by those)');

// ---------- minutes become hours of XP, once
r = await apply(A, { [LIFT]: 30 });
my = await one(A, 'public.my_steam()');
ok(r.status === 'ok' && r.credited_minutes === 30 && r.hours_added === 0 && my.hours === 0 && my.minutes_to_next === 30 && await total(A) === 0, '30 new minutes: no XP yet, 30 towards the hour (fractions are kept)');
r = await apply(A, { [LIFT]: 90 });
ok(r.credited_minutes === 60 && r.hours_added === 1 && r.hours === 1 && await total(A) === 10, 'the next 60 minutes complete an hour: 10 XP');
const hr1 = await hoursRows(A);
ok(hr1.length === 1 && hr1[0].ref === 'hour:1' && hr1[0].amount === 10 && (await one(A, 'public.my_steam()')).minutes_to_next === 30, 'one ledger row (hour:1) and 30 minutes carried');
ok((await unlocked(A)).includes('first-flight'), 'First Flight unlocked by the first hour');
r = await apply(A, { [LIFT]: 90 });
ok(r.credited_minutes === 0 && r.hours_added === 0 && await total(A) === 10 && (await hoursRows(A)).length === 1, 'the same totals again change nothing');
r = await apply(A, { [LIFT]: 40 });
ok(r.credited_minutes === 0 && await total(A) === 10, 'a total that falls (Steam reset) is never negative and credits nothing');
r = await apply(A, { [LIFT]: 100 });
ok(r.credited_minutes === 60 && r.hours === 2 && await total(A) === 20, 'and counting continues from the lower total (60 more minutes: hour 2)');
r = await apply(A, { [LIFT]: 100, 999999: 99999 });
ok(r.credited_minutes === 0 && !('999999' in await state(A)), 'a game that is not approved is ignored');
r = await apply(A, { [LIFT]: 100, [DRL]: 150 });
my = await one(A, 'public.my_steam()');
ok(r.credited_minutes === 150 && r.hours === 5 && await total(A) === 50 && my.minutes_to_next === 0, 'an approved game first seen after linking counts in full (150 minutes; 30 + 150 more completes hours 3 to 5, 300 minutes in all)');
ok(J((await hoursRows(A)).map((x) => x.ref)) === J(['hour:1', 'hour:2', 'hour:3', 'hour:4', 'hour:5']), 'the hours are numbered in order');
await Promise.all([1, 2, 3].map(() => apply(A, { [LIFT]: 220, [DRL]: 150 })));
ok((await hoursRows(A)).length === 7 && (await lrow(A)).hours_awarded === 7 && await total(A) === 70, 'three syncs at once with the same totals add the new 120 minutes once (hours 6 and 7, no duplicates)');
ok((await lrow(A)).sim_minutes === 420, 'and the minutes total is exactly what was played (420)');
ok((await apply(C, { [LIFT]: 60 })).status === 'not_linked' && await total(C) === 0, 'syncing someone who has not linked does nothing');
for (const t of [null, [], 'x', { [LIFT]: -5 }, { [LIFT]: 'a' }]) ok(/invalid playtime/.test(await fails('select public.apply_steam_playtime($1, $2::jsonb)', [A, J(t)]) ?? ''), 'refused playtime: ' + J(t));
ok(/invalid status/.test(await fails(`select public.apply_steam_playtime('${A}', '{}', 'weird')`) ?? '') && /invalid status/.test(await fails(`select public.apply_steam_playtime('${A}', '{}', null)`) ?? ''), 'and a status other than ok, private or error');
const before = (await lrow(A)).sim_minutes;
r = await apply(A, { [LIFT]: 9999 }, 'private');
ok(r.status === 'private' && (await lrow(A)).last_status === 'private' && (await lrow(A)).sim_minutes === before && await total(A) === 70, 'a private-profile answer is recorded and credits nothing');
r = await apply(A, {}, 'error');
ok((await lrow(A)).last_status === 'error' && (await one(A, 'public.my_steam()')).last_status === 'error', 'so is a Steam error');
await apply(A, { [LIFT]: 220, [DRL]: 150 });
ok((await lrow(A)).last_status === 'ok', 'and the next good sync clears it');

// ---------- a very long gap is credited over several syncs, not lost
await link(C, ID_C, { [LIFT]: 0 });
r = await apply(C, { [LIFT]: 40000 });
ok(r.hours_added === 500 && r.hours === 500 && await total(C) === 5000, 'at most 500 hours are credited in one sync');
r = await apply(C, { [LIFT]: 40000 });
ok(r.hours === 666 && r.credited_minutes === 0 && await total(C) === 6660 && (await lrow(C)).sim_minutes === 40000, 'the next sync credits the rest (666 hours in all) without counting the minutes twice');
r = await apply(C, { [LIFT]: 40000 });
ok(r.hours_added === 0 && await total(C) === 6660, 'and then nothing more');
ok((await unlocked(C)).includes('sim-veteran') && (await unlocked(C)).includes('ace-pilot'), 'the hours unlocked Sim Veteran and, through the XP, Ace Pilot');

// ---------- the manual cooldown
let c1 = await svc('select public.claim_manual_sync($1) as r', [A]).then((x) => x[0].r);
ok(c1.allowed === true && c1.previous === null && (await lrow(A)).last_manual_sync_at, 'the first manual sync is allowed and the time is stamped at once');
let c2 = await svc('select public.claim_manual_sync($1) as r', [A]).then((x) => x[0].r);
ok(c2.allowed === false && c2.reason === 'cooldown' && c2.retry_after_seconds > 3500 && c2.retry_after_seconds <= 3600, 'a second one within the hour is refused, with how long to wait: ' + c2.retry_after_seconds + ' s');
my = await one(A, 'public.my_steam()');
ok(my.manual_available_at && new Date(my.manual_available_at) > new Date(), 'my_steam says when the next manual sync is available');
const both = await Promise.all([svc('select public.claim_manual_sync($1) as r', [A]), svc('select public.claim_manual_sync($1) as r', [A])]);
ok(both.every((x) => x[0].r.allowed === false), 'two tabs cannot both pass');
await svc('select public.release_manual_sync($1, $2)', [A, c1.previous]);
ok((await svc('select public.claim_manual_sync($1) as r', [A]))[0].r.allowed === true, 'if Steam failed the cooldown is given back, so the person can try again');
const stamp = (await lrow(A)).last_manual_sync_at;
await apply(A, { [LIFT]: 240, [DRL]: 150 });
ok(+(await lrow(A)).last_manual_sync_at === +stamp, 'a scheduled sync (apply) neither reads nor changes the manual cooldown');
await db.exec(`update public.steam_links set last_manual_sync_at = now() - interval '61 minutes' where user_id = '${A}'`);
ok((await svc('select public.claim_manual_sync($1) as r', [A]))[0].r.allowed === true, 'after 61 minutes a manual sync is allowed again');
await db.exec(`update public.progression_settings set value = 5 where key = 'steam_manual_cooldown_minutes'`);
await db.exec(`update public.steam_links set last_manual_sync_at = now() - interval '6 minutes' where user_id = '${A}'`);
ok((await svc('select public.claim_manual_sync($1) as r', [A]))[0].r.allowed === true, 'the cooldown is a setting (5 minutes here)');
await db.exec(`update public.progression_settings set value = 60 where key = 'steam_manual_cooldown_minutes'`);
ok((await svc('select public.claim_manual_sync($1) as r', [B]))[0].r.reason === 'not_linked', 'someone who has not linked cannot claim a sync');

// ---------- the daily list
await db.exec(`update public.steam_links set last_synced_at = now() - interval '25 hours' where user_id = '${A}'`);
await db.exec(`update public.steam_links set last_synced_at = null where user_id = '${C}'`);
let due = await svc('select * from public.list_steam_due(10)');
ok(due.length === 2 && due[0].user_id === C && due[1].user_id === A && due[0].steam_id === ID_C, 'the daily list holds linked people synced more than 20 hours ago, never-synced first');
await apply(A, { [LIFT]: 240 });
ok((await svc('select * from public.list_steam_due(10)')).length === 1, 'a person just synced is not due');
ok((await svc('select * from public.list_steam_due(1)')).length === 1, 'the list is limited');
await db.exec(`update public.progression_settings set value = 0 where key = 'steam_enabled'`);
ok((await svc('select * from public.list_steam_due(10)')).length === 0 && (await svc('select public.claim_manual_sync($1) as r', [A]))[0].r.reason === 'disabled', 'switched off: nobody is due and no manual sync is allowed');
await db.exec(`update public.progression_settings set value = 1 where key = 'steam_enabled'`);

// ---------- hours played before linking count, and unlinking keeps the stored totals
const ID_D = '76561198000000004', ID_D2 = '76561198000000005';
r = await link(D, ID_D, { [LIFT]: 1000, [DRL]: 200, 999999: 500 });
my = await one(D, 'public.my_steam()');
ok(r.status === 'linked' && my.hours === 20 && my.minutes_to_next === 0 && await total(D) === 200 && (await lrow(D)).sim_minutes === 1200 && J(await state(D)) === J({ [LIFT]: 1000, [DRL]: 200 }), 'linking credits the playtime from before (1,200 minutes in approved games = 20 hours = 200 XP); the unapproved game counts for nothing');
ok(J((await hoursRows(D)).map((x) => x.ref)) === J(Array.from({ length: 20 }, (_, i) => 'hour:' + (i + 1))) && (await unlocked(D)).includes('first-flight') && (await unlocked(D)).includes('first-connection'), 'as hours 1 to 20 in the ledger, unlocking First Flight and First Connection');
await one(D, 'public.unlink_steam()');
ok((await lrow(D)).steam_id === null && (await lrow(D)).state_steam_id === ID_D && J(await state(D)) === J({ [LIFT]: 1000, [DRL]: 200 }) && await total(D) === 200, 'unlinking keeps the stored totals and the XP');
r = await link(D, ID_D, { [LIFT]: 1000, [DRL]: 200 });
ok(r.status === 'linked' && await total(D) === 200 && (await lrow(D)).hours_awarded === 20 && (await hoursRows(D)).length === 20, 'relinking the same Steam account does not credit the history a second time');
r = await apply(D, { [LIFT]: 1060, [DRL]: 200 });
ok(r.credited_minutes === 60 && r.hours === 21 && await total(D) === 210, 'only the minutes since count (60 more: hour 21)');
await one(D, 'public.unlink_steam()');
r = await link(D, ID_D2, { [LIFT]: 120 });
ok((await lrow(D)).state_steam_id === ID_D2 && J(await state(D)) === J({ [LIFT]: 120 }) && (await lrow(D)).sim_minutes === 1380 && (await lrow(D)).hours_awarded === 23 && await total(D) === 230, 'a different Steam account is credited in full on its own (120 minutes: 1,380 in all, 23 hours), and its totals replace the old ones');
// the same Steam account is paid out once, whoever links it
r = await link(B, ID_D, { [LIFT]: 1100, [DRL]: 200 });
ok((await lrow(B)).sim_minutes === 40 && (await lrow(B)).hours_awarded === 0 && await total(B) === 0 && J(await state(B)) === J({ [LIFT]: 1100, [DRL]: 200 }), 'another person linking a Steam account that was already credited gets only what was played since (40 of the 1,100 minutes), not its history again');
await one(B, 'public.unlink_steam()');
r = await link(D, ID_D, { [LIFT]: 1100, [DRL]: 200 });
ok((await lrow(D)).state_steam_id === ID_D && (await lrow(D)).sim_minutes === 1380 && (await lrow(D)).hours_awarded === 23 && await total(D) === 230, 'and going back to the first Steam account after another one credits nothing for hours already counted (by anyone)');
await one(D, 'public.unlink_steam()');
ok((await sql('select count(*)::int as n from public.steam_credited where steam_id = $1', [ID_D]))[0].n === 2 && (await sql('select minutes from public.steam_credited where steam_id = $1 and app_id = $2', [ID_D, LIFT]))[0].minutes === 1100, 'the credited total for a Steam account only goes up (1,100 minutes of Liftoff; two games)');

// ---------- deleting a profile wipes the Steam link and the XP, but a Steam account's history is still paid out once
await link(D, ID_D, { [LIFT]: 1100, [DRL]: 200 });
ok(await total(D) === 230 && (await lrow(D)), 'before deleting the profile Dee has the XP and a link');
await one(D, 'public.delete_profile()');
ok(!(await lrow(D)) && Object.keys(await state(D)).length === 0 && await total(D) === 0 && (await hoursRows(D)).length === 0 && (await unlocked(D)).length === 0, 'deleting the profile removes the Steam link, the stored totals, the XP and the achievements');
ok((await sql('select count(*)::int as n from public.steam_credited where steam_id = $1', [ID_D]))[0].n === 2, 'but what was counted for that Steam account stays');
await one(D, 'public.ensure_profile($1)', ['Dee']);
r = await link(D, ID_D, { [LIFT]: 1100, [DRL]: 200 });
ok(r.status === 'linked' && await total(D) === 0 && (await lrow(D)).sim_minutes === 0, 'linking the same Steam account again as a new profile credits only new play (nothing here)');
await one(D, 'public.unlink_steam()');

// ---------- unlinking keeps what was earned, and relinking the same account counts only new play
const awardedBefore = (await lrow(A)).hours_awarded, xpBefore = await total(A), minsBefore = (await lrow(A)).sim_minutes;
ok((await one(A, 'public.unlink_steam()')).status === 'unlinked', 'a person unlinks');
my = await one(A, 'public.my_steam()');
ok(my.linked === false && my.ever_linked === true && my.hours === awardedBefore && (await lrow(A)).steam_id === null && J(await state(A)) === J({ [LIFT]: 240, [DRL]: 150 }), 'they show as not linked, but the hours stay and so do the stored totals');
ok(await total(A) === xpBefore && (await unlocked(A)).includes('first-connection'), 'XP and First Connection are kept');
ok((await apply(A, { [LIFT]: 9000 })).status === 'not_linked' && await total(A) === xpBefore, 'while unlinked, syncing credits nothing');
ok((await link(B, ID_A, { [LIFT]: 50 })).status === 'linked', 'the freed Steam account can be linked by someone else (its history was already counted for Alex, so nothing is credited)');
ok(/already linked to another account/.test(await fails(`select public.steam_link('${A}', '${ID_A}', '{}')`) ?? ''), 'and then not by the first person');
await one(B, 'public.unlink_steam()');
await link(A, ID_A, { [LIFT]: 240 });
r = await apply(A, { [LIFT]: 240 });
ok(r.credited_minutes === 0 && (await lrow(A)).hours_awarded === awardedBefore && (await lrow(A)).sim_minutes === minsBefore, 'relinking the same Steam account keeps the stored totals: nothing is awarded twice');
r = await apply(A, { [LIFT]: 300 });
ok(r.hours_added === 1 && r.hours === awardedBefore + 1 && (await hoursRows(A)).at(-1).ref === 'hour:' + (awardedBefore + 1), 'the next hour continues the numbering (hour:' + (awardedBefore + 1) + ')');
ok(J((await hoursRows(A)).map((x) => x.ref)) === J(Array.from({ length: awardedBefore + 1 }, (_, i) => 'hour:' + (i + 1))), 'with no gaps or repeats in the ledger');
const m0 = (await lrow(A)).sim_minutes;
await link(A, '76561198000000009', { [LIFT]: 123 });
ok((await lrow(A)).steam_id === '76561198000000009' && (await state(A))[LIFT] === 123 && (await lrow(A)).sim_minutes === m0 + 123 && (await lrow(A)).hours_awarded === Math.floor((m0 + 123) / 60), 'linking a different Steam account replaces the link and the stored totals, credits that account in full, and keeps the hours');

// ---------- the daily list goes by the last attempt, so people whose sync keeps failing cannot take every place (steam_queue)
{
  const ids = (await sql('select user_id from public.steam_links where steam_id is not null order by user_id')).map((x) => x.user_id);
  ok(ids.length >= 2, 'at least two people are linked for this check (' + ids.length + ')');
  await db.exec("update public.steam_links set last_synced_at = now() - interval '2 days', last_attempt_at = null");
  const due = async (n = 10) => (await svc('select * from public.list_steam_due($1)', [n])).map((x) => x.user_id);
  const first = (await due())[0];
  await apply(first, {}, 'private');
  ok((await lrow(first)).last_attempt_at !== null && (await lrow(first)).last_status === 'private', 'a failed attempt is stamped');
  ok((await due(1))[0] !== first && (await due()).at(-1) === first, 'and the person who failed goes to the back of the line, so the others are served first');
  await db.exec(`update public.steam_links set last_attempt_at = now() - interval '3 days' where user_id = '${first}'`);
  ok((await due(1))[0] === first, 'the one who has waited longest since an attempt is first again');
  await apply(first, { [LIFT]: 0 }, 'ok');
  ok(!(await due()).includes(first), 'a successful sync takes them off the list for 20 hours');
  await db.exec("update public.steam_links set last_synced_at = now()");
}

// ---------- deleting an account removes it all
await db.exec(`delete from auth.users where id = '${C}'`);
ok(!(await lrow(C)) && Object.keys(await state(C)).length === 0, 'deleting an account removes its Steam link and baseline');
