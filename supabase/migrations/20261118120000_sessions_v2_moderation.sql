-- Flight Sessions 2.0, phase 6 (backend): reporting, administrator moderation, audit.
--
-- Anyone signed in (with a profile) can report a PUBLIC, published session they can see: five reason codes, an optional short note, one open report per person
-- per session, ten reports a day. Enough distinct reporters (progression_settings.session_report_autohide, default 3) hide the session at once pending review.
-- An administrator lists reports, dismisses them or unpublishes the session (reason required, people with an RSVP are told in-app), and can republish.
-- Every administrator decision is in the audit trail. An unpublished session cannot be made public again by its host. Administration is function-only (no screen yet).

insert into public.progression_settings (key, value) values ('session_report_autohide', 3) on conflict (key) do nothing;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (
  action in ('role.grant', 'role.revoke', 'attendance.revoke', 'steam.link', 'steam.unlink', 'steam.status', 'setting.change', 'profile.delete', 'session.unpublish', 'session.republish', 'session.report_review')
  or action ~ '^area\.[a-z_]{1,30}$');

create table public.session_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  reporter uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'unsafe_location', 'harassment', 'illegal', 'other')),
  note text check (note is null or char_length(note) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create unique index session_reports_one_open on public.session_reports (session_id, reporter) where status = 'open';
create index session_reports_status on public.session_reports (status, created_at);
alter table public.session_reports enable row level security;
revoke all on public.session_reports from anon, authenticated;

-- A host cannot put an unpublished session back into discovery: private to public is refused while it is unpublished.
create function public.flight_sessions_moderation_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.publication = 'unpublished' and new.visibility = 'public' and old.visibility = 'private' then
    raise exception 'this session was unpublished by a moderator and cannot be made public';
  end if;
  return new;
end;
$$;
create trigger flight_sessions_moderation before update on public.flight_sessions
  for each row execute function public.flight_sessions_moderation_guard();

-- Hides a public session from discovery, tells the people who had said they would come.
create function public.session_unpublish_internal(p_session uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.flight_sessions set publication = 'unpublished', unpublished_at = now(), unpublished_reason = left(p_reason, 200) where id = p_session and publication = 'published';
  if found then perform public.session_notify(p_session, 'unpublished', null); end if;
end;
$$;

create function public.report_session(p_session uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  n text := nullif(public.clean_text(p_note), '');
  distinct_reporters integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then raise exception 'create your profile first'; end if;
  if p_reason is null or p_reason not in ('spam', 'unsafe_location', 'harassment', 'illegal', 'other') then raise exception 'choose a reason'; end if;
  if n is not null and char_length(n) > 200 then raise exception 'the note is at most 200 characters'; end if;
  select * into s from public.flight_sessions where id = p_session;
  if not found or s.visibility <> 'public' or s.publication <> 'published' or s.status <> 'scheduled' or s.created_by is not distinct from uid or public.session_blocked(uid, s.created_by) then
    raise exception 'session not found';
  end if;
  if exists (select 1 from public.session_reports where session_id = p_session and reporter = uid and status = 'open') then return jsonb_build_object('status', 'already_reported'); end if;
  if (select count(*) from public.session_reports where reporter = uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'you have sent too many reports today'; end if;
  insert into public.session_reports (session_id, reporter, reason, note) values (p_session, uid, p_reason, n);
  select count(distinct reporter)::integer into distinct_reporters from public.session_reports where session_id = p_session and status = 'open';
  if distinct_reporters >= greatest(round(coalesce(public.setting_num('session_report_autohide'), 3))::integer, 1) then
    perform public.session_unpublish_internal(p_session, 'hidden pending review after reports');
    return jsonb_build_object('status', 'reported', 'hidden', true);
  end if;
  return jsonb_build_object('status', 'reported');
end;
$$;

-- Administrators: reports (oldest first), the session as it is, who hosts it (friend code, never an id). status: open (default), dismissed, actioned or all.
create function public.admin_list_session_reports(p_status text default 'open', p_limit integer default 50)
returns table (report_id uuid, session_id uuid, reason text, note text, status text, reported_at timestamptz, reporter_code text, session_title text, session_location text,
               latitude double precision, longitude double precision, starts_at timestamptz, publication text, host_code text, host_name text, open_reports integer)
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
    select r.id, r.session_id, r.reason, r.note, r.status, r.created_at, pr.friend_code, s.title, s.location, s.latitude, s.longitude, s.starts_at, s.publication, ph.friend_code, ph.display_name,
           (select count(*)::integer from public.session_reports x where x.session_id = r.session_id and x.status = 'open')
      from public.session_reports r
      join public.flight_sessions s on s.id = r.session_id
      left join public.profiles pr on pr.user_id = r.reporter
      left join public.profiles ph on ph.user_id = s.created_by
     where p_status = 'all' or r.status = p_status
     order by r.created_at, r.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- action 'dismiss' closes the report; 'unpublish' hides the session and closes every open report on it as actioned.
create function public.admin_review_session_report(p_report uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.session_reports%rowtype;
  why text := nullif(public.clean_text(p_reason), '');
  host uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('dismiss', 'unpublish') then raise exception 'the action is dismiss or unpublish'; end if;
  if why is null or char_length(why) > 200 then raise exception 'a reason of 1 to 200 characters is required'; end if;
  select * into r from public.session_reports where id = p_report for update;
  if not found then raise exception 'not found'; end if;
  if r.status <> 'open' then return jsonb_build_object('status', 'already_reviewed'); end if;
  select created_by into host from public.flight_sessions where id = r.session_id;
  if p_action = 'dismiss' then
    update public.session_reports set status = 'dismissed', reviewed_by = uid, reviewed_at = now() where id = p_report;
  else
    perform public.session_unpublish_internal(r.session_id, why);
    update public.session_reports set status = 'actioned', reviewed_by = uid, reviewed_at = now() where session_id = r.session_id and status = 'open';
  end if;
  perform public.audit_log('session.report_review', uid, host, r.session_id::text, jsonb_build_object('action', p_action, 'reason', r.reason));
  return jsonb_build_object('status', case when p_action = 'dismiss' then 'dismissed' else 'unpublished' end);
end;
$$;

create function public.admin_unpublish_session(p_session uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  why text := nullif(public.clean_text(p_reason), '');
  host uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if why is null or char_length(why) > 200 then raise exception 'a reason of 1 to 200 characters is required'; end if;
  select created_by into host from public.flight_sessions where id = p_session and visibility = 'public' and publication = 'published';
  if not found then raise exception 'not found'; end if;
  perform public.session_unpublish_internal(p_session, why);
  update public.session_reports set status = 'actioned', reviewed_by = uid, reviewed_at = now() where session_id = p_session and status = 'open';
  perform public.audit_log('session.unpublish', uid, host, p_session::text, '{}'::jsonb);
  return jsonb_build_object('status', 'unpublished');
end;
$$;

create function public.admin_republish_session(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  host uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.flight_sessions set publication = 'published', unpublished_at = null, unpublished_reason = null where id = p_session and publication = 'unpublished' returning created_by into host;
  if not found then raise exception 'not found'; end if;
  perform public.audit_log('session.republish', uid, host, p_session::text, '{}'::jsonb);
  return jsonb_build_object('status', 'published');
end;
$$;

-- The host sees why their session is hidden: list_sessions already carries publication via this small read.
create function public.my_session_moderation()
returns table (session_id uuid, title text, publication text, unpublished_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query select s.id, s.title, s.publication, s.unpublished_at from public.flight_sessions s where s.created_by = uid and s.publication = 'unpublished' and s.status = 'scheduled' order by s.starts_at;
end;
$$;

-- account deletion: reports this person made go too (the rest is purge_user_sessions)
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
end;
$$;

revoke all on function public.flight_sessions_moderation_guard() from public, anon, authenticated;
revoke all on function public.session_unpublish_internal(uuid, text) from public, anon, authenticated;
revoke all on function public.purge_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.report_session(uuid, text, text) from public, anon;
revoke all on function public.admin_list_session_reports(text, integer) from public, anon;
revoke all on function public.admin_review_session_report(uuid, text, text) from public, anon;
revoke all on function public.admin_unpublish_session(uuid, text) from public, anon;
revoke all on function public.admin_republish_session(uuid) from public, anon;
revoke all on function public.my_session_moderation() from public, anon;
grant execute on function public.report_session(uuid, text, text) to authenticated;
grant execute on function public.admin_list_session_reports(text, integer) to authenticated;
grant execute on function public.admin_review_session_report(uuid, text, text) to authenticated;
grant execute on function public.admin_unpublish_session(uuid, text) to authenticated;
grant execute on function public.admin_republish_session(uuid) to authenticated;
grant execute on function public.my_session_moderation() to authenticated;
