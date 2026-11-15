-- Flight Sessions: host reward. When a session is closed, its host earns 50 XP plus 10 XP for each distinct, verified, non-host attendee whose attendance is not revoked;
-- nothing when there is no such attendee (RSVPs alone never count). Additive; no new tables.
--
-- Kept apart from attendance: the reward is written to xp_ledger with source 'hosting', so user_metric('attendance_verified_count') (source 'attendance') and the
-- attendance achievements never see it, and attendee XP (source 'attendance') is unchanged.
-- Ledger keys: the payout is (host, 'hosting', 'session:<id>'), once per session (close_session runs once and the key is unique). If an administrator revokes attendance
-- after the close, the reward is recomputed from the numbers recorded in the payout row and a negative adjustment (host, 'hosting', 'session:<id>:adj:<n>') is appended,
-- so a late revocation lowers the reward by 10 per attendee and by the 50 base when the last eligible attendee goes. Nothing is deleted; the reward never goes up after a close.
-- Verified: every session_attendance row was verified by an organiser or administrator (never the person themselves) or by the server (source 'auto'); revoked rows are excluded.
-- Not adjusted: an attendee who deletes their profile (their attendance rows are wiped with it). Sessions closed before this migration, and sessions closed because their host
-- deleted the account, pay nothing, and a later revocation on them adjusts nothing.

insert into public.progression_settings (key, value) values ('host_base_xp', 50), ('host_per_attendee_xp', 10) on conflict (key) do nothing;

alter table public.xp_ledger drop constraint xp_ledger_source_check;
alter table public.xp_ledger add constraint xp_ledger_source_check check (source in ('sim', 'attendance', 'admin', 'hosting'));

-- The earlier body, with 'hosting' as a source and the host adjustment as the one other way XP can go down.
create or replace function public.award_xp(p_user uuid, p_amount integer, p_source text, p_ref text, p_reason text default null, p_actor uuid default null, p_meta jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur integer;
  eff integer;
  new_id bigint;
begin
  if p_user is null or p_amount is null or p_ref is null or char_length(p_ref) not between 1 and 100 then raise exception 'invalid award'; end if;
  if p_source is null or p_source not in ('sim', 'attendance', 'admin', 'hosting') then raise exception 'invalid award source'; end if;
  if abs(p_amount) > 100000 then raise exception 'amount too large'; end if;
  if p_amount <= 0 and not (p_source = 'admin'
                            or (p_source = 'attendance' and p_ref like 'session:%:rev')
                            or (p_source = 'hosting' and p_ref like 'session:%:adj:%')) then
    raise exception 'only an administrator adjustment can lower XP';
  end if;
  if p_amount = 0 then raise exception 'invalid award'; end if;
  insert into public.user_xp (user_id, total, peak_tier) values (p_user, 0, 1) on conflict (user_id) do nothing;
  select total into cur from public.user_xp where user_id = p_user for update;
  eff := greatest(p_amount, -cur);
  insert into public.xp_ledger (user_id, amount, source, ref, reason, actor, meta)
    values (p_user, eff, p_source, p_ref, p_reason, p_actor,
            coalesce(p_meta, '{}'::jsonb) || case when eff <> p_amount then jsonb_build_object('requested', p_amount) else '{}'::jsonb end)
    on conflict (user_id, source, ref) do nothing
    returning id into new_id;
  if new_id is null then return null; end if;
  perform public.evaluate_achievements(p_user);
  return eff;
end;
$$;

-- Attendance can only be added while the session is open, and the row lock makes it wait for a close in progress. mark_attended already checks the status under a share
-- lock; this also covers the automatic path, so no attendance can appear after the host reward was counted.
create function public.session_attendance_open_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare st text;
begin
  select status into st from public.flight_sessions where id = new.session_id for share;
  if st is distinct from 'scheduled' then raise exception 'the session is %', coalesce(st, 'not found'); end if;
  return new;
end;
$$;
create trigger session_attendance_open before insert on public.session_attendance
  for each row execute function public.session_attendance_open_guard();

-- Internal. p_initial = true (from close_session): pay the reward once. false (from a revocation): lower an existing reward to match the attendance that is left.
-- Returns the XP applied (negative for an adjustment) or null. The session row is locked first, so a close and a revocation cannot interleave.
create function public.session_host_reward(p_session uuid, p_initial boolean, p_actor uuid default null, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.flight_sessions%rowtype;
  n integer;
  base integer;
  per integer;
  init public.xp_ledger%rowtype;
  intended integer;
  adjn integer;
  delta integer;
begin
  select * into s from public.flight_sessions where id = p_session for update;
  if not found or s.status <> 'closed' or s.created_by is null then return null; end if;
  select count(*)::integer into n from public.session_attendance a where a.session_id = s.id and a.user_id <> s.created_by and a.revoked_at is null;
  if p_initial then
    base := round(coalesce(public.setting_num('host_base_xp'), 0))::integer;
    per := round(coalesce(public.setting_num('host_per_attendee_xp'), 0))::integer;
    if n < 1 or base + per * n <= 0 then return null; end if;
    return public.award_xp(s.created_by, base + per * n, 'hosting', 'session:' || s.id::text, null, null, jsonb_build_object('base', base, 'per', per, 'attendees', n));
  end if;
  select * into init from public.xp_ledger where user_id = s.created_by and source = 'hosting' and ref = 'session:' || s.id::text;
  if not found then return null; end if;
  select count(*)::integer, coalesce(sum(coalesce((l.meta ->> 'requested')::integer, l.amount)), 0)::integer into adjn, intended
    from public.xp_ledger l where l.user_id = s.created_by and l.source = 'hosting' and l.ref like 'session:' || s.id::text || ':adj:%';
  intended := init.amount + intended;
  delta := case when n >= 1 then (init.meta ->> 'base')::integer + (init.meta ->> 'per')::integer * n else 0 end - intended;
  if delta >= 0 then return null; end if;
  -- a host with no XP left has nothing to lower (the ledger refuses a zero row); the next revocation recomputes from the recorded numbers
  if coalesce((select total from public.user_xp where user_id = s.created_by), 0) <= 0 then return null; end if;
  return public.award_xp(s.created_by, delta, 'hosting', 'session:' || s.id::text || ':adj:' || (adjn + 1)::text, p_reason, p_actor, jsonb_build_object('attendees', n));
end;
$$;

-- Ends a session (earlier body) and pays the host reward in the same transaction.
create or replace function public.close_session(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  st text;
  hx integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select status into st from public.flight_sessions where id = p_id for update;
  if not found or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  if st <> 'scheduled' then raise exception 'the session is already %', st; end if;
  update public.flight_sessions set status = 'closed', closed_at = now() where id = p_id;
  hx := public.session_host_reward(p_id, true);
  return jsonb_build_object('status', 'closed', 'host_xp', coalesce(hx, 0));
end;
$$;

-- Earlier body (20261116120000) plus the host adjustment.
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
  perform public.session_host_reward(p_session, false, uid, why);
  perform public.audit_log('attendance.revoke', uid, a.user_id, p_session::text,
    jsonb_build_object('reason', public.audit_reason_code(why), 'had_xp', coalesce(orig, 0) > 0, 'amount', greatest(coalesce(orig, 0), 0)));
  return jsonb_build_object('status', 'revoked');
end;
$$;

-- Earlier body (20261119110000) plus the host adjustment for every session touched.
create or replace function public.admin_bulk_revoke_auto_attendance(p_from timestamptz, p_to timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  why text := nullif(public.clean_text(p_reason), '');
  r record; orig integer; n integer := 0; xp integer := 0;
  touched uuid[] := '{}';
  sid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if why is null or char_length(why) > 200 then raise exception 'a reason of 1 to 200 characters is required'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'a time range of at most 400 days is required'; end if;
  for r in select a.session_id, a.user_id from public.session_attendance a
            where a.source = 'auto' and a.revoked_at is null and a.verified_at >= p_from and a.verified_at < p_to order by a.verified_at for update loop
    update public.session_attendance set revoked_at = now(), revoked_by = uid where session_id = r.session_id and user_id = r.user_id;
    select amount into orig from public.xp_ledger where user_id = r.user_id and source = 'attendance' and ref = 'session:' || r.session_id::text;
    if orig is not null and orig > 0 then
      perform public.award_xp(r.user_id, -orig, 'attendance', 'session:' || r.session_id::text || ':rev', why, uid);
      xp := xp + orig;
    end if;
    n := n + 1;
    if not r.session_id = any (touched) then touched := touched || r.session_id; end if;
  end loop;
  foreach sid in array touched loop
    perform public.session_host_reward(sid, false, uid, why);
  end loop;
  perform public.audit_log('attendance.bulk_revoke', uid, null, null, jsonb_build_object('reason', public.audit_reason_code(why), 'count', n, 'xp', xp));
  return jsonb_build_object('status', 'revoked', 'count', n, 'xp', xp);
end;
$$;

revoke all on function public.session_attendance_open_guard() from public, anon, authenticated;
revoke all on function public.session_host_reward(uuid, boolean, uuid, text) from public, anon, authenticated;
