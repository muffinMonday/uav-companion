-- Flight Sessions: automatic attendance (backlog FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG, wave C). Additive. Ships OFF: auto_attendance_enabled = 0.
--
-- A signed-in person who joined a session and consented can send a position sample; the SERVER measures the distance, throws the coordinates away and keeps only
-- server timestamps and a count per (session, person). When enough samples span enough server time, and at least two different non-host people qualify at that
-- occurrence, the server records attendance (source 'auto') and awards XP through award_xp with the same ledger key as a manual mark. Nothing the client says about
-- time or arrival is trusted. Every number below is a progression_settings row, tunable without a migration. GPS can be spoofed; the caps bound the damage, they do not stop a ring.

-- ---------- settings (all new rows; the flag stays 0)

insert into public.progression_settings (key, value) values
  ('auto_attendance_enabled', 0),
  ('auto_radius_m', 100), ('auto_accuracy_m', 50),
  ('auto_min_probes', 3), ('auto_min_span_s', 120), ('auto_min_spacing_s', 30), ('auto_gap_restart_s', 600),
  ('auto_min_attendees', 2), ('auto_attendee_min_age_h', 24), ('auto_host_min_age_d', 7),
  ('auto_cap_day', 1), ('auto_cap_week', 5), ('auto_probe_keep_h', 24)
on conflict (key) do nothing;

-- ---------- attendance source 'auto', audit actions

alter table public.session_attendance drop constraint session_attendance_source_check;
alter table public.session_attendance add constraint session_attendance_source_check check (source in ('rsvp', 'walk_in', 'auto'));

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in ('role.grant', 'role.revoke', 'attendance.revoke', 'steam.link', 'steam.unlink', 'steam.status', 'setting.change', 'profile.delete', 'session.unpublish', 'session.republish', 'session.report_review',
             'attendance.auto', 'attendance.bulk_revoke', 'attendance.consent')
  or action ~ '^area\.[a-z_]{1,30}$');

-- A controlled set of reason codes (never free text in the trail): adds 'spoofing' to the existing set.
create or replace function public.audit_reason_code(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(mistake|mistaken|wrong|by mistake)' then 'mistaken_mark'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^no[ _-]?show' then 'no_show'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(duplicate|dupe|dup)' then 'duplicate'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(spoof|gps|mock|location)' then 'spoofing'
    when lower(btrim(coalesce(p_reason, ''))) ~ '^(abuse|cheat|fraud|fake)' then 'abuse'
    else 'other' end;
$$;

-- ---------- consent and probes (no coordinates anywhere)

create table public.session_arrival_consent (
  user_id uuid primary key references auth.users (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  notice_version integer not null default 1 check (notice_version between 1 and 1000)
);
comment on table public.session_arrival_consent is 'Server evidence that a person agreed to send position samples for automatic attendance. The sampler refuses without it; withdrawing deletes it and the probes.';
alter table public.session_arrival_consent enable row level security;
revoke all on public.session_arrival_consent from anon, authenticated;

create table public.session_arrival_probes (
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  first_at timestamptz not null,
  last_at timestamptz not null,
  qualifying integer not null check (qualifying >= 1),
  primary key (session_id, user_id)
);
comment on table public.session_arrival_probes is 'Server timestamps and a count of qualifying position samples. No coordinates, no accuracy. Deleted on award, 24 h after the session, on consent withdrawal and on profile deletion.';
create index session_arrival_probes_user on public.session_arrival_probes (user_id);
alter table public.session_arrival_probes enable row level security;
revoke all on public.session_arrival_probes from anon, authenticated;

-- ---------- frozen location and times once a session starts; probes reset on any edit before

create function public.flight_sessions_arrival_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.latitude, new.longitude, new.starts_at, new.ends_at) is distinct from (old.latitude, old.longitude, old.starts_at, old.ends_at) then
    if new.created_by is not null and old.starts_at <= now() and old.status = 'scheduled' then
      raise exception 'the place and times are fixed once a session has started';
    end if;
    delete from public.session_arrival_probes where session_id = old.id;
  end if;
  return new;
end;
$$;
create trigger flight_sessions_arrival_guard before update on public.flight_sessions
  for each row execute function public.flight_sessions_arrival_guard();

-- ---------- consent

create function public.record_arrival_consent(p_version integer default 1)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.session_arrival_consent (user_id, notice_version) values (uid, least(greatest(coalesce(p_version, 1), 1), 1000))
    on conflict (user_id) do update set accepted_at = now(), notice_version = excluded.notice_version;
  perform public.audit_log('attendance.consent', uid, uid, null, jsonb_build_object('on', true));
  return jsonb_build_object('accepted', true);
end;
$$;

create function public.withdraw_arrival_consent()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.session_arrival_probes where user_id = uid;
  delete from public.session_arrival_consent where user_id = uid;
  perform public.audit_log('attendance.consent', uid, uid, null, jsonb_build_object('on', false));
  return jsonb_build_object('accepted', false);
end;
$$;

-- What the app needs to decide whether to sample at all: the switch, the consent, and the sampling interval.
create function public.arrival_config()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('enabled', coalesce(public.setting_num('auto_attendance_enabled'), 0) >= 1,
                            'consented', exists (select 1 from public.session_arrival_consent where user_id = uid),
                            'accuracy_m', round(coalesce(public.setting_num('auto_accuracy_m'), 50))::integer,
                            'spacing_s', round(coalesce(public.setting_num('auto_min_spacing_s'), 30))::integer);
end;
$$;

-- ---------- the sample

-- Statuses: unavailable (switch off), no_consent, not_eligible (also: not joined, you host it, too new an account, no host), too_early, ended, poor_accuracy, too_far,
-- tracking (counted, more samples needed), waiting (you qualify, not enough other people yet), capped (daily or weekly limit), already_attended, revoked, awarded, attended (recorded, no XP set).
create function public.submit_session_arrival(p_session uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  me public.profiles%rowtype;
  host public.profiles%rowtype;
  prev public.session_attendance%rowtype;
  pr public.session_arrival_probes%rowtype;
  amt integer := round(coalesce(public.setting_num('attendance_xp'), 0))::integer;
  spacing numeric := coalesce(public.setting_num('auto_min_spacing_s'), 30);
  gap numeric := coalesce(public.setting_num('auto_gap_restart_s'), 600);
  min_probes integer := round(coalesce(public.setting_num('auto_min_probes'), 3))::integer;
  min_span numeric := coalesce(public.setting_num('auto_min_span_s'), 120);
  need integer := round(coalesce(public.setting_num('auto_min_attendees'), 2))::integer;
  met integer;
  applied integer;
  inserted integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if coalesce(public.setting_num('auto_attendance_enabled'), 0) < 1 then return jsonb_build_object('status', 'unavailable'); end if;
  perform public.people_list_throttle(uid);
  if p_lat is null or p_lng is null or p_accuracy is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy < 0 or p_accuracy > 100000 then
    raise exception 'invalid position';
  end if;
  if not exists (select 1 from public.session_arrival_consent where user_id = uid) then return jsonb_build_object('status', 'no_consent'); end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_session::text, 0));
  -- housekeeping: samples of sessions that ended a while ago
  delete from public.session_arrival_probes x using public.flight_sessions fs
   where fs.id = x.session_id and fs.ends_at < now() - make_interval(hours => round(coalesce(public.setting_num('auto_probe_keep_h'), 24))::integer);

  select * into s from public.flight_sessions where id = p_session;
  select * into me from public.profiles where user_id = uid;
  if not found or s.id is null or s.created_by is null or s.created_by = uid or s.publication <> 'published' or s.status <> 'scheduled'
     or not exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)
     or public.session_blocked(uid, s.created_by) then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  select * into host from public.profiles where user_id = s.created_by;
  if not found or host.created_at > now() - make_interval(days => round(coalesce(public.setting_num('auto_host_min_age_d'), 7))::integer)
     or me.created_at > now() - make_interval(hours => round(coalesce(public.setting_num('auto_attendee_min_age_h'), 24))::integer) then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  if now() < s.starts_at then return jsonb_build_object('status', 'too_early'); end if;
  if now() > s.ends_at then return jsonb_build_object('status', 'ended'); end if;
  select * into prev from public.session_attendance where session_id = s.id and user_id = uid;
  if found then return jsonb_build_object('status', case when prev.revoked_at is null then 'already_attended' else 'revoked' end); end if;
  if (select count(*) from public.session_attendance a where a.user_id = uid and a.source = 'auto' and a.revoked_at is null and a.verified_at > now() - interval '1 day') >= round(coalesce(public.setting_num('auto_cap_day'), 1))
     or (select count(*) from public.session_attendance a where a.user_id = uid and a.source = 'auto' and a.revoked_at is null and a.verified_at > now() - interval '7 days') >= round(coalesce(public.setting_num('auto_cap_week'), 5)) then
    return jsonb_build_object('status', 'capped');
  end if;
  -- the coordinates are used here and nowhere else
  if p_accuracy > coalesce(public.setting_num('auto_accuracy_m'), 50) then return jsonb_build_object('status', 'poor_accuracy'); end if;
  if public.session_distance_m(p_lat, p_lng, s.latitude, s.longitude) > coalesce(public.setting_num('auto_radius_m'), 100) then return jsonb_build_object('status', 'too_far'); end if;

  select * into pr from public.session_arrival_probes where session_id = s.id and user_id = uid for update;
  if not found or pr.last_at < now() - make_interval(secs => gap::double precision) then
    insert into public.session_arrival_probes (session_id, user_id, first_at, last_at, qualifying) values (s.id, uid, now(), now(), 1)
      on conflict (session_id, user_id) do update set first_at = now(), last_at = now(), qualifying = 1;
  elsif pr.last_at <= now() - make_interval(secs => spacing::double precision) then
    update public.session_arrival_probes set last_at = now(), qualifying = qualifying + 1 where session_id = s.id and user_id = uid;
  end if;
  select * into pr from public.session_arrival_probes where session_id = s.id and user_id = uid;
  if pr.qualifying < min_probes or extract(epoch from pr.last_at - pr.first_at) < min_span then return jsonb_build_object('status', 'tracking', 'count', pr.qualifying); end if;

  -- enough of my own samples: are enough different people (not the host) there too?
  select count(*) into met from (
    select x.user_id from public.session_arrival_probes x
     where x.session_id = s.id and x.user_id <> s.created_by and x.qualifying >= min_probes
       and extract(epoch from x.last_at - x.first_at) >= min_span and x.last_at >= now() - make_interval(secs => gap::double precision)
    union
    select a.user_id from public.session_attendance a where a.session_id = s.id and a.source = 'auto' and a.revoked_at is null
  ) q;
  if met < need then return jsonb_build_object('status', 'waiting'); end if;

  insert into public.session_attendance (session_id, user_id, verified_by, source) values (s.id, uid, null, 'auto') on conflict (session_id, user_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('status', 'already_attended'); end if;
  delete from public.session_arrival_probes where session_id = s.id and user_id = uid;
  if amt <= 0 then return jsonb_build_object('status', 'attended', 'xp', 0); end if;
  applied := public.award_xp(uid, amt, 'attendance', 'session:' || s.id::text, null, null, jsonb_build_object('auto', true));
  perform public.audit_log('attendance.auto', uid, uid, s.id::text, jsonb_build_object('xp', coalesce(applied, 0)));
  if applied is null then return jsonb_build_object('status', 'already_attended'); end if;
  return jsonb_build_object('status', 'awarded', 'xp', applied);
end;
$$;

-- ---------- rollback: revoke automatic attendance by time range (the per-row revoke_attendance still works)

create function public.admin_bulk_revoke_auto_attendance(p_from timestamptz, p_to timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  why text := nullif(public.clean_text(p_reason), '');
  r record; orig integer; n integer := 0; xp integer := 0;
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
  end loop;
  perform public.audit_log('attendance.bulk_revoke', uid, null, null, jsonb_build_object('reason', public.audit_reason_code(why), 'count', n, 'xp', xp));
  return jsonb_build_object('status', 'revoked', 'count', n, 'xp', xp);
end;
$$;

-- ---------- account deletion also drops consent and samples

create or replace function public.purge_user_sessions(p_uid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select s.id from public.flight_sessions s where s.created_by = p_uid and s.status = 'scheduled' loop
    if exists (select 1 from public.session_attendance where session_id = r.id) then
      update public.flight_sessions set status = 'closed', closed_at = now() where id = r.id;
    else
      update public.flight_sessions set status = 'cancelled', closed_at = now() where id = r.id;
      perform public.session_notify(r.id, 'cancelled', p_uid);
    end if;
  end loop;
  delete from public.session_links where created_by = p_uid;
  delete from public.session_invitations where invitee = p_uid or invited_by = p_uid;
  delete from public.session_reports where reporter = p_uid;
  update public.flight_sessions set visibility = 'private', latitude = null, longitude = null, location = null, created_by = null where created_by = p_uid;
  update public.flight_session_series set created_by = null where created_by = p_uid;
  delete from public.session_rsvps where user_id = p_uid;
  delete from public.session_notices where user_id = p_uid;
  delete from public.session_removals where user_id = p_uid;
  delete from public.session_participant_handles where user_id = p_uid;
  delete from public.people_list_rate where user_id = p_uid;
  delete from public.session_arrival_probes where user_id = p_uid;
  delete from public.session_arrival_consent where user_id = p_uid;
end;
$$;

-- ---------- grants: clients reach only these functions, never the tables and never award_xp

revoke all on function public.flight_sessions_arrival_guard() from public, anon, authenticated;
revoke all on function public.purge_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.record_arrival_consent(integer) from public, anon;
revoke all on function public.withdraw_arrival_consent() from public, anon;
revoke all on function public.arrival_config() from public, anon;
revoke all on function public.submit_session_arrival(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.admin_bulk_revoke_auto_attendance(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.record_arrival_consent(integer) to authenticated;
grant execute on function public.withdraw_arrival_consent() to authenticated;
grant execute on function public.arrival_config() to authenticated;
grant execute on function public.submit_session_arrival(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.admin_bulk_revoke_auto_attendance(timestamptz, timestamptz, text) to authenticated;
