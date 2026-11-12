-- Flight sessions, RSVP and organiser-verified attendance (progression milestone, phase 5).
--
-- An organiser (or an administrator) creates a flight session. Anyone signed in can see the scheduled sessions and RSVP; an RSVP is a statement of intent and gives no XP.
-- Attendance XP (50 per session, a setting) is awarded only when an organiser or administrator of that session marks the person present, after the session has started
-- and while it is still open. The person is picked from the RSVP list, or by friend code for someone who came without an RSVP. Nobody can mark themselves. Each person
-- gets the XP once per session (the ledger's unique key), however many times they are marked. The attendance row keeps who verified it and when.
-- An organiser manages only the sessions they created; an administrator manages all. A mistaken mark is undone only by an administrator (revoke_attendance), which
-- appends a reversal to the ledger and keeps the attendance row (revoked_at); the person's achievements stay and re-marking them does not award XP again.
-- The RSVP list (names) is for the session's managers; everyone else sees only a count. Nobody can read these tables directly.

create table public.flight_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) between 1 and 500),
  location text check (location is null or char_length(location) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'closed', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (ends_at > starts_at and ends_at <= starts_at + interval '48 hours')
);
create index flight_sessions_starts on public.flight_sessions (starts_at desc);
comment on table public.flight_sessions is 'Offline flight sessions created by organisers. Reached only through functions.';

create table public.session_rsvps (
  id uuid not null default gen_random_uuid() unique,
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
comment on table public.session_rsvps is 'Who said they will come. No XP. The id is the opaque handle an organiser marks attendance with.';

create table public.session_attendance (
  id uuid not null default gen_random_uuid() unique,
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz not null default now(),
  source text not null check (source in ('rsvp', 'walk_in')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  primary key (session_id, user_id)
);
comment on table public.session_attendance is 'Attendance verified by an organiser: who, when, and whether an administrator later revoked it. The only thing that earns attendance XP.';

alter table public.flight_sessions enable row level security;
alter table public.session_rsvps enable row level security;
alter table public.session_attendance enable row level security;
revoke all on public.flight_sessions, public.session_rsvps, public.session_attendance from anon, authenticated;

-- Attendance reversal: the one other way XP can go down, for the 'attendance' source with a ref ending in ':rev' (written only by revoke_attendance below).
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
  if p_source is null or p_source not in ('sim', 'attendance', 'admin') then raise exception 'invalid award source'; end if;
  if abs(p_amount) > 100000 then raise exception 'amount too large'; end if;
  if p_amount <= 0 and not (p_source = 'admin' or (p_source = 'attendance' and p_ref like 'session:%:rev')) then raise exception 'only an administrator adjustment can lower XP'; end if;
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
-- a zero-amount row is only allowed for administrator adjustments (ledger check); a reversal that clamps to zero is skipped by revoke_attendance

-- May the caller manage this session? An administrator, or the organiser who created it.
create function public.can_manage_session(p_uid uuid, p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(p_uid, 'admin')
      or (public.has_role(p_uid, 'organiser') and exists (select 1 from public.flight_sessions s where s.id = p_session and s.created_by = p_uid));
$$;

create function public.create_session(p_title text, p_description text, p_location text, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t text := public.clean_text(p_title);
  d text := nullif(public.clean_text(p_description), '');
  l text := nullif(public.clean_text(p_location), '');
  sid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'organiser') then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(t) not between 1 and 80 then raise exception 'a title of 1 to 80 characters is required'; end if;
  if d is not null and char_length(d) > 500 then raise exception 'the description is at most 500 characters'; end if;
  if l is not null and char_length(l) > 120 then raise exception 'the location is at most 120 characters'; end if;
  if p_starts_at is null or p_ends_at is null then raise exception 'start and end times are required'; end if;
  if p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '48 hours' then raise exception 'a session ends after it starts and lasts at most 48 hours'; end if;
  if p_starts_at < now() - interval '30 days' or p_starts_at > now() + interval '1 year' then raise exception 'the start must be within the last 30 days and the next year'; end if;
  insert into public.flight_sessions (title, description, location, starts_at, ends_at, created_by) values (t, d, l, p_starts_at, p_ends_at, uid) returning id into sid;
  return jsonb_build_object('id', sid);
end;
$$;

-- Changes a scheduled session: any of title, description, location, starts_at, ends_at (null clears description or location).
create function public.update_session(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  k text;
  t text; d text; l text; st timestamptz; en timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'the patch must be an object'; end if;
  select * into s from public.flight_sessions where id = p_id for update;
  if not found or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'only a scheduled session can be changed'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'description', 'location', 'starts_at', 'ends_at') then raise exception 'unknown session field: %', left(k, 40); end if;
  end loop;
  t := s.title; d := s.description; l := s.location; st := s.starts_at; en := s.ends_at;
  if p_patch ? 'title' then t := public.clean_text(p_patch->>'title'); if char_length(t) not between 1 and 80 then raise exception 'a title of 1 to 80 characters is required'; end if; end if;
  if p_patch ? 'description' then d := nullif(public.clean_text(p_patch->>'description'), ''); if d is not null and char_length(d) > 500 then raise exception 'the description is at most 500 characters'; end if; end if;
  if p_patch ? 'location' then l := nullif(public.clean_text(p_patch->>'location'), ''); if l is not null and char_length(l) > 120 then raise exception 'the location is at most 120 characters'; end if; end if;
  begin
    if p_patch ? 'starts_at' then st := (p_patch->>'starts_at')::timestamptz; end if;
    if p_patch ? 'ends_at' then en := (p_patch->>'ends_at')::timestamptz; end if;
  exception when others then raise exception 'start and end must be times';
  end;
  if st is null or en is null or en <= st or en > st + interval '48 hours' then raise exception 'a session ends after it starts and lasts at most 48 hours'; end if;
  update public.flight_sessions set title = t, description = d, location = l, starts_at = st, ends_at = en where id = p_id;
  return jsonb_build_object('status', 'updated');
end;
$$;

-- Ends a session: marking is closed. Closing is final.
create function public.close_session(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  st text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select status into st from public.flight_sessions where id = p_id for update;
  if not found or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  if st <> 'scheduled' then raise exception 'the session is already %', st; end if;
  update public.flight_sessions set status = 'closed', closed_at = now() where id = p_id;
  return jsonb_build_object('status', 'closed');
end;
$$;

-- Cancels a session nobody has been marked present at (otherwise close it).
create function public.cancel_session(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  st text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select status into st from public.flight_sessions where id = p_id for update;
  if not found or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  if st <> 'scheduled' then raise exception 'the session is already %', st; end if;
  if exists (select 1 from public.session_attendance where session_id = p_id) then raise exception 'attendance has been marked: close the session instead'; end if;
  update public.flight_sessions set status = 'cancelled', closed_at = now() where id = p_id;
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- What the caller may see: scheduled sessions; closed or cancelled ones only if they manage it, attended it or had said they would come (last 90 days).
-- Only a count of RSVPs, never who.
create function public.list_sessions()
returns table (id uuid, title text, description text, location text, starts_at timestamptz, ends_at timestamptz, status text, rsvp_count integer, i_rsvped boolean, my_attended boolean, can_manage boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select s.id, s.title, s.description, s.location, s.starts_at, s.ends_at, s.status,
           (select count(*)::integer from public.session_rsvps r where r.session_id = s.id),
           exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid),
           exists (select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = uid and a.revoked_at is null),
           public.can_manage_session(uid, s.id)
      from public.flight_sessions s
     where s.status = 'scheduled'
        or (s.starts_at > now() - interval '90 days'
            and (public.can_manage_session(uid, s.id)
                 or exists (select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = uid)
                 or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)))
     order by s.starts_at, s.id;
end;
$$;

-- I will come. While the session is open (late RSVPs count). No XP.
create function public.rsvp_session(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then raise exception 'create your profile first'; end if;
  select * into s from public.flight_sessions where id = p_id;
  if not found or s.status <> 'scheduled' then raise exception 'session not found'; end if;
  if now() > s.ends_at then raise exception 'the session is over'; end if;
  insert into public.session_rsvps (session_id, user_id) values (p_id, uid) on conflict (session_id, user_id) do nothing;
  return jsonb_build_object('status', 'rsvped');
end;
$$;

-- I cannot come after all: only before the session starts.
create function public.withdraw_rsvp(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into s from public.flight_sessions where id = p_id;
  if not found then raise exception 'session not found'; end if;
  if s.status = 'scheduled' and now() >= s.starts_at then raise exception 'the session has started'; end if;
  delete from public.session_rsvps where session_id = p_id and user_id = uid;
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

-- The people for a session, for its managers: everyone who said they would come and everyone marked present (including walk-ins).
-- No user ids: rsvp_id is the handle to mark an RSVP present, attendance_id the handle to revoke a mark.
create function public.list_session_rsvps(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  res jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.flight_sessions where id = p_id) or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'rsvp_id', q.rsvp_id, 'attendance_id', q.attendance_id, 'display_name', q.name, 'rsvped', q.rsvp_id is not null,
           'attended', q.attendance_id is not null and q.revoked_at is null, 'revoked', q.revoked_at is not null, 'source', q.source)
         order by lower(q.name), coalesce(q.rsvp_id, q.attendance_id)), '[]'::jsonb)
    into res
    from (select r.id as rsvp_id, a.id as attendance_id, coalesce(p.display_name, 'Someone') as name, a.revoked_at, a.source
            from public.session_rsvps r
            left join public.session_attendance a on a.session_id = r.session_id and a.user_id = r.user_id
            left join public.profiles p on p.user_id = r.user_id
           where r.session_id = p_id
          union all
          select null::uuid, a.id, coalesce(p.display_name, 'Someone'), a.revoked_at, a.source
            from public.session_attendance a
            left join public.profiles p on p.user_id = a.user_id
           where a.session_id = p_id
             and not exists (select 1 from public.session_rsvps r where r.session_id = a.session_id and r.user_id = a.user_id)) q;
  return res;
end;
$$;

-- Marks someone present and awards the attendance XP, in one transaction. p_kind is 'rsvp' (p_ref is the rsvp_id from list_session_rsvps) or 'code' (p_ref is the
-- person's friend code, for someone who came without an RSVP). Managers only; not before the session starts; not once it is closed or cancelled; never yourself.
-- Marking the same person again is answered with 'already_attended' and changes nothing.
create function public.mark_attended(p_session uuid, p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  target uuid;
  src text;
  prev public.session_attendance%rowtype;
  amt integer := round(public.setting_num('attendance_xp'))::integer;
  applied integer;
  nm text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into s from public.flight_sessions where id = p_session for share;
  if not found or not public.can_manage_session(uid, p_session) then raise exception 'session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'the session is %', s.status; end if;
  if now() < s.starts_at then raise exception 'the session has not started'; end if;
  if p_kind = 'rsvp' then
    begin
      select user_id into target from public.session_rsvps where id = p_ref::uuid and session_id = p_session;
    exception when invalid_text_representation then target := null;
    end;
    src := 'rsvp';
  elsif p_kind = 'code' then
    select user_id into target from public.profiles where friend_code = lower(regexp_replace(coalesce(p_ref, ''), '[\s-]', '', 'g'));
    src := case when exists (select 1 from public.session_rsvps r where r.session_id = p_session and r.user_id = target) then 'rsvp' else 'walk_in' end;
  else
    raise exception 'invalid kind';
  end if;
  if target is null then raise exception 'not found'; end if;
  if target = uid then raise exception 'you cannot mark yourself present'; end if;
  select * into prev from public.session_attendance where session_id = p_session and user_id = target;
  select coalesce(display_name, 'Someone') into nm from public.profiles where user_id = target;
  if prev.session_id is not null then
    if prev.revoked_at is null then return jsonb_build_object('status', 'already_attended', 'display_name', nm); end if;
    raise exception 'this attendance was revoked by an administrator';
  end if;
  insert into public.session_attendance (session_id, user_id, verified_by, source) values (p_session, target, uid, src);
  applied := public.award_xp(target, amt, 'attendance', 'session:' || p_session::text, null, uid);
  return jsonb_build_object('status', 'marked', 'display_name', nm, 'xp', coalesce(applied, 0));
end;
$$;

-- Administrators only: undoes a mistaken mark. The attendance row stays (revoked_at, revoked_by), a reversal is appended to the ledger (never below zero), and
-- the person's achievements stay. Marking them again does not award XP a second time.
create function public.revoke_attendance(p_session uuid, p_attendance uuid, p_reason text)
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
  return jsonb_build_object('status', 'revoked');
end;
$$;

-- Deleting a profile also withdraws the person's RSVPs (their verified attendance stays: it is what their XP was earned from).
create or replace function public.delete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.leave_all_trips(uid);
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  delete from public.session_rsvps where user_id = uid;
  delete from public.profiles where user_id = uid;
  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function public.award_xp(uuid, integer, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.can_manage_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_session(text, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.update_session(uuid, jsonb) from public, anon;
revoke all on function public.close_session(uuid) from public, anon;
revoke all on function public.cancel_session(uuid) from public, anon;
revoke all on function public.list_sessions() from public, anon;
revoke all on function public.rsvp_session(uuid) from public, anon;
revoke all on function public.withdraw_rsvp(uuid) from public, anon;
revoke all on function public.list_session_rsvps(uuid) from public, anon;
revoke all on function public.mark_attended(uuid, text, text) from public, anon;
revoke all on function public.revoke_attendance(uuid, uuid, text) from public, anon;
revoke all on function public.delete_profile() from public, anon;
grant execute on function public.create_session(text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_session(uuid, jsonb) to authenticated;
grant execute on function public.close_session(uuid) to authenticated;
grant execute on function public.cancel_session(uuid) to authenticated;
grant execute on function public.list_sessions() to authenticated;
grant execute on function public.rsvp_session(uuid) to authenticated;
grant execute on function public.withdraw_rsvp(uuid) to authenticated;
grant execute on function public.list_session_rsvps(uuid) to authenticated;
grant execute on function public.mark_attended(uuid, text, text) to authenticated;
grant execute on function public.revoke_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.delete_profile() to authenticated;
