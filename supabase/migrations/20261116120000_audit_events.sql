-- The audit trail: a small append-only record of the business events that leave no other trace (owner-approved design, logging and audit milestone).
--
-- What is recorded (each row is written by the same function, in the same transaction, as the change itself, so a rollback removes both):
--   role.grant, role.revoke     grant_role / revoke_role (a revoked role used to leave nothing behind; a grant that changed nothing is not recorded)
--   attendance.revoke           revoke_attendance, with a CONTROLLED reason code (mistaken_mark, no_show, duplicate, abuse, other), never the free text
--   steam.link, steam.unlink    steam_link / unlink_steam; never the Steam id
--   steam.status                apply_steam_playtime, only when the last sync status CHANGES to private or error (not every daily sync)
--   setting.change              any insert, update or delete of progression_settings (also from the dashboard SQL editor)
--   profile.delete              delete_profile: a tombstone with no actor, no subject and no id of any kind, written only if a profile existed
-- Not recorded here: XP adjustments (xp_ledger already holds actor, reason and time), denied attempts (the exception rolls the transaction back), cron outcomes.
-- The action names area.* are reserved for community-area moderation, which does not exist yet.
--
-- Immutability: rows are never deleted (not even by delete_profile) and TRUNCATE is refused. The only permitted UPDATE is delete_profile setting a historical `actor`
-- or `subject` that names the person being deleted to NULL (the wipe marker uavzones.wipe_user, honoured only when the calling role is not one a client can be);
-- every other column must stay identical. There are no foreign keys, so deleting an auth user neither blocks nor cascades.

create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (
    action in ('role.grant', 'role.revoke', 'attendance.revoke', 'steam.link', 'steam.unlink', 'steam.status', 'setting.change', 'profile.delete')
    or action ~ '^area\.[a-z_]{1,30}$'),
  actor uuid,
  subject uuid,
  ref text check (ref is null or char_length(ref) between 1 and 80),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 1024)
);
create index audit_events_at on public.audit_events (at desc);
create index audit_events_action on public.audit_events (action, at desc);
comment on table public.audit_events is 'Append-only record of administrative, attendance, Steam, settings and deletion events. Written only by security-definer functions in the same transaction as the change; read only through admin_audit_events. Holds no free text, no Steam ids and no personal data; references to a deleted person are set to NULL.';
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;

create function public.audit_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare marker text := coalesce(current_setting('uavzones.wipe_user', true), '');
begin
  if tg_op = 'UPDATE' and marker <> '' and current_user not in ('anon', 'authenticated', 'service_role')
     and (new.id, new.at, new.action, new.ref, new.meta) is not distinct from (old.id, old.at, old.action, old.ref, old.meta)
     and (new.actor is not distinct from old.actor or (new.actor is null and old.actor::text = marker))
     and (new.subject is not distinct from old.subject or (new.subject is null and old.subject::text = marker)) then
    return new; -- only: a reference to the person being wiped becomes NULL
  end if;
  raise exception 'the audit trail is append-only';
end;
$$;
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.audit_events_guard();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.audit_events_guard();

-- The one way a row is written. Called only from other security-definer functions (not executable by clients).
create function public.audit_log(p_action text, p_actor uuid, p_subject uuid, p_ref text, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (action, actor, subject, ref, meta) values (p_action, p_actor, p_subject, p_ref, coalesce(p_meta, '{}'::jsonb));
$$;

-- An administrator's free-text reason becomes one of a fixed set of codes (matched by the start of the text), so the audit row never holds free text.
create function public.audit_reason_code(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(mistake|mistaken|wrong|by mistake)' then 'mistaken_mark'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^no[ _-]?show' then 'no_show'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(duplicate|dupe|dup)' then 'duplicate'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(abuse|cheat|fraud|fake)' then 'abuse'
    else 'other' end;
$$;

-- Administrators only: the newest events first (at most 200), the people named by friend code (NULL once their profile is gone), never by id.
create function public.admin_audit_events(p_limit integer default 50, p_action text default null)
returns table (id bigint, at timestamptz, action text, actor_code text, subject_code text, ref text, meta jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select e.id, e.at, e.action, pa.friend_code, ps.friend_code, e.ref, e.meta
      from public.audit_events e
      left join public.profiles pa on pa.user_id = e.actor
      left join public.profiles ps on ps.user_id = e.subject
     where p_action is null or e.action = p_action
     order by e.at desc, e.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ---------- the recorded operations: each body is the latest one, with one audit_log call added

create or replace function public.grant_role(p_friend_code text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
  n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'organiser') then raise exception 'unknown role'; end if;
  select user_id into target from public.profiles where friend_code = lower(btrim(coalesce(p_friend_code, '')));
  if not found then raise exception 'not found'; end if;
  insert into public.app_roles (user_id, role, granted_by) values (target, p_role, uid) on conflict (user_id, role) do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform public.audit_log('role.grant', uid, target, p_role, jsonb_build_object('role', p_role)); end if;
  return jsonb_build_object('status', 'granted');
end;
$$;

create or replace function public.revoke_role(p_friend_code text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
  n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'organiser') then raise exception 'unknown role'; end if;
  select user_id into target from public.profiles where friend_code = lower(btrim(coalesce(p_friend_code, '')));
  if not found then raise exception 'not found'; end if;
  if p_role = 'admin' then
    perform 1 from public.app_roles where role = 'admin' for update;
    if (select count(*) from public.app_roles where role = 'admin') <= 1
       and exists (select 1 from public.app_roles where role = 'admin' and user_id = target) then
      raise exception 'cannot remove the last administrator';
    end if;
  end if;
  delete from public.app_roles where user_id = target and role = p_role;
  get diagnostics n = row_count;
  if n > 0 then perform public.audit_log('role.revoke', uid, target, p_role, jsonb_build_object('role', p_role)); end if;
  return jsonb_build_object('status', 'revoked');
end;
$$;

create or replace function public.revoke_attendance(p_session uuid, p_attendance uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  why text := nullif(public.clean_text(p_reason), '');
  a public.session_attendance%rowtype;
  orig integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if why is null or char_length(why) > 200 then raise exception 'a reason of 1 to 200 characters is required'; end if;
  select * into a from public.session_attendance where id = p_attendance and session_id = p_session for update;
  if not found then raise exception 'not found'; end if;
  if a.revoked_at is not null then return jsonb_build_object('status', 'already_revoked'); end if;
  update public.session_attendance set revoked_at = now(), revoked_by = uid where session_id = a.session_id and user_id = a.user_id;
  select amount into orig from public.xp_ledger where user_id = a.user_id and source = 'attendance' and ref = 'session:' || p_session::text;
  if orig is not null and orig > 0 then
    perform public.award_xp(a.user_id, -orig, 'attendance', 'session:' || p_session::text || ':rev', why, uid);
  end if;
  perform public.audit_log('attendance.revoke', uid, a.user_id, p_session::text,
    jsonb_build_object('reason', public.audit_reason_code(why), 'had_xp', coalesce(orig, 0) > 0, 'amount', greatest(coalesce(orig, 0), 0)));
  return jsonb_build_object('status', 'revoked');
end;
$$;

create or replace function public.apply_steam_playtime(p_user uuid, p_totals jsonb, p_status text default 'ok')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.steam_links%rowtype;
  r record;
  prev integer;
  added bigint := 0;
  newmin bigint;
  target integer;
  xp integer := round(public.setting_num('sim_xp_per_hour'))::integer;
begin
  if p_status is null or p_status not in ('ok', 'private', 'error') then raise exception 'invalid status'; end if;
  select * into l from public.steam_links where user_id = p_user for update;
  if not found or l.steam_id is null then return jsonb_build_object('status', 'not_linked'); end if;
  if p_status <> 'ok' then
    update public.steam_links set last_status = p_status, last_attempt_at = now(), updated_at = now() where user_id = p_user;
    if l.last_status is distinct from p_status then perform public.audit_log('steam.status', null, p_user, null, jsonb_build_object('status', p_status)); end if;
    return jsonb_build_object('status', p_status);
  end if;
  for r in select * from public.steam_totals_clean(p_totals) loop
    select last_total_minutes into prev from public.steam_app_state where user_id = p_user and app_id = r.app_id;
    added := added + case when found then greatest(r.minutes - prev, 0) else r.minutes end;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes) values (p_user, r.app_id, r.minutes)
      on conflict (user_id, app_id) do update set last_total_minutes = excluded.last_total_minutes;
    insert into public.steam_credited (steam_id, app_id, minutes) values (l.steam_id, r.app_id, r.minutes)
      on conflict (steam_id, app_id) do update set minutes = greatest(public.steam_credited.minutes, excluded.minutes);
  end loop;
  newmin := l.sim_minutes + added;
  if newmin > 2000000000 then raise exception 'invalid playtime'; end if;
  target := least(newmin / 60, l.hours_awarded + 500)::integer;
  if target > l.hours_awarded then
    if xp is null or xp <= 0 then raise exception 'invalid award'; end if;
    -- what award_xp does for each hour, once for all of them: make sure the total exists, hold its row, write the ledger rows, check the achievements
    insert into public.user_xp (user_id, total, peak_tier) values (p_user, 0, 1) on conflict (user_id) do nothing;
    perform 1 from public.user_xp where user_id = p_user for update;
    insert into public.xp_ledger (user_id, amount, source, ref)
      select p_user, xp, 'sim', 'hour:' || g::text from generate_series(l.hours_awarded + 1, target) g
      on conflict (user_id, source, ref) do nothing;
    perform public.evaluate_achievements(p_user);
  end if;
  update public.steam_links set sim_minutes = newmin, hours_awarded = greatest(l.hours_awarded, target), last_synced_at = now(), last_attempt_at = now(), last_status = 'ok', updated_at = now() where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'credited_minutes', added, 'hours_added', greatest(target - l.hours_awarded, 0), 'hours', greatest(l.hours_awarded, target));
end;
$$;

create or replace function public.steam_link(p_user uuid, p_steam_id text, p_totals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.steam_links%rowtype;
  had boolean;
begin
  if public.setting_num('steam_enabled') is distinct from 1 then raise exception 'steam is not enabled'; end if;
  if p_user is null or p_steam_id is null or p_steam_id !~ '^[0-9]{17}$' then raise exception 'invalid steam link'; end if;
  if exists (select 1 from public.steam_links where steam_id = p_steam_id and user_id <> p_user) then raise exception 'this Steam account is already linked to another account'; end if;
  select * into l from public.steam_links where user_id = p_user for update;
  had := found;
  insert into public.steam_links (user_id, steam_id, state_steam_id) values (p_user, p_steam_id, p_steam_id)
    on conflict (user_id) do update set steam_id = excluded.steam_id, state_steam_id = excluded.state_steam_id, linked_at = now(), updated_at = now();
  if had and l.state_steam_id is not distinct from p_steam_id then
    null; -- the same Steam account again: the stored totals stay, only new minutes count
  elsif had and l.state_steam_id is null and (l.sim_minutes > 0 or l.hours_awarded > 0) then
    -- unlinked before this change (its totals were deleted): take a plain baseline so nothing is credited twice
    delete from public.steam_app_state where user_id = p_user;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes) select p_user, c.app_id, c.minutes from public.steam_totals_clean(p_totals) c;
  else
    -- a Steam account not stored for this person: what was ever counted for it (anybody) is the baseline, the rest counts
    delete from public.steam_app_state where user_id = p_user;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes)
      select p_user, c.app_id, least(c.minutes, sc.minutes)
      from public.steam_totals_clean(p_totals) c join public.steam_credited sc on sc.steam_id = p_steam_id and sc.app_id = c.app_id;
  end if;
  perform public.apply_steam_playtime(p_user, p_totals, 'ok');
  perform public.evaluate_achievements(p_user);
  perform public.audit_log('steam.link', p_user, null, null, jsonb_build_object('relink', had));
  return jsonb_build_object('status', 'linked');
end;
$$;

create or replace function public.unlink_steam()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  was boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  was := exists (select 1 from public.steam_links where user_id = uid and steam_id is not null);
  update public.steam_links set steam_id = null, updated_at = now() where user_id = uid; -- the stored totals and state_steam_id stay
  if was then perform public.audit_log('steam.unlink', uid, null, null, '{}'::jsonb); end if;
  return jsonb_build_object('status', 'unlinked');
end;
$$;

-- Settings: every insert, update or delete is recorded (the dashboard SQL editor included: auth.uid() is NULL there, so the actor is NULL).
create function public.progression_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit_log('setting.change', (select auth.uid()), null, old.key, jsonb_build_object('key', old.key, 'old', old.value, 'new', null));
  elsif tg_op = 'INSERT' then
    perform public.audit_log('setting.change', (select auth.uid()), null, new.key, jsonb_build_object('key', new.key, 'old', null, 'new', new.value));
  elsif new.value is distinct from old.value or new.key is distinct from old.key then
    perform public.audit_log('setting.change', (select auth.uid()), null, new.key, jsonb_build_object('key', new.key, 'old', old.value, 'new', new.value));
  end if;
  return null;
end;
$$;
create trigger progression_settings_audit after insert or update or delete on public.progression_settings
  for each row execute function public.progression_settings_audit();

-- Deleting a profile (and so an account: delete_account calls this): the wipe is as before. New: audit rows that name the person as actor or subject forget them
-- (set to NULL, nothing else changes), and one tombstone row records that a deletion happened, with no actor, subject, or id of any kind. A repeated call (after a
-- partial failure) finds no profile and adds no second tombstone.
create or replace function public.delete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  had boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  had := exists (select 1 from public.profiles where user_id = uid);
  perform public.leave_all_trips(uid);
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  delete from public.session_rsvps where user_id = uid;
  perform set_config('uavzones.wipe_user', uid::text, true);
  delete from public.xp_ledger where user_id = uid;
  delete from public.user_achievements where user_id = uid;
  update public.audit_events
     set actor = case when actor = uid then null else actor end,
         subject = case when subject = uid then null else subject end
   where actor = uid or subject = uid;
  perform set_config('uavzones.wipe_user', '', true);
  delete from public.user_xp where user_id = uid;
  delete from public.featured_achievements where user_id = uid;
  delete from public.user_counters where user_id = uid;
  delete from public.session_attendance where user_id = uid;
  delete from public.steam_app_state where user_id = uid;
  delete from public.steam_links where user_id = uid;
  delete from public.profiles where user_id = uid;
  if had then perform public.audit_log('profile.delete', null, null, null, '{}'::jsonb); end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function public.audit_events_guard() from public, anon, authenticated;
revoke all on function public.audit_log(text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.audit_reason_code(text) from public, anon, authenticated;
revoke all on function public.progression_settings_audit() from public, anon, authenticated;
revoke all on function public.admin_audit_events(integer, text) from public, anon;
grant execute on function public.admin_audit_events(integer, text) to authenticated;
