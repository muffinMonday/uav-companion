-- Flight Sessions: Discover, people and XP badge (backlog FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG, wave B2). Additive.
--   1. xp_reward on the session lists: the XP a person could earn by attending, or NULL when none is possible. Never a constant in the app.
--   2. A participant list (list_session_participants) with session-scoped opaque handles and Add friend (request_friend_from_session).
--      This deliberately reverses two earlier decisions: RSVP names were managers-only, and no function returned anyone's identity but by friend code.
--      Safeguards: opt-out profiles.show_in_attendee_lists (default on), private sessions list people to joined people only, blocked pairs hidden both ways,
--      page and size caps, a per-person rate limit. A handle is random, per (session, person), and is neither the RSVP id nor a user id.

-- ---------- opt-out and handles

alter table public.profiles add column show_in_attendee_lists boolean not null default true;

create table public.session_participant_handles (
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  handle uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
comment on table public.session_participant_handles is 'Opaque per-session names for people in the attendee list. Not the RSVP id; resolved to a person only inside functions.';
alter table public.session_participant_handles enable row level security;
revoke all on public.session_participant_handles from anon, authenticated;

create table public.people_list_rate (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  calls integer not null default 0
);
alter table public.people_list_rate enable row level security;
revoke all on public.people_list_rate from anon, authenticated;

create function public.get_show_in_attendee_lists()
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); v boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select show_in_attendee_lists into v from public.profiles where user_id = uid;
  return coalesce(v, true);
end;
$$;

create function public.set_show_in_attendee_lists(p_show boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.profiles set show_in_attendee_lists = coalesce(p_show, true), updated_at = now() where user_id = uid;
  if not found then raise exception 'create your profile first'; end if;
  return coalesce(p_show, true);
end;
$$;

-- ---------- the XP a session can pay

-- An administrator or an organiser who hosts the session can verify attendance (can_verify_session); with automatic attendance on, any host's session can pay. NULL = none possible.
create function public.session_xp_reward(p_session uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select case when amt > 0 and (public.has_role(s.created_by, 'admin') or public.has_role(s.created_by, 'organiser') or coalesce(public.setting_num('auto_attendance_enabled'), 0) >= 1) then amt end
    from public.flight_sessions s, (select round(coalesce(public.setting_num('attendance_xp'), 0))::integer as amt) a
   where s.id = p_session and s.created_by is not null
$$;

-- list_public_sessions, get_public_session, list_sessions and list_my_session_invitations gain xp_reward (an old client ignores the extra column).
drop function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer);
create function public.list_public_sessions(p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default null,
                                            p_from timestamptz default null, p_until timestamptz default null, p_query text default null,
                                            p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               capacity integer, rsvp_count integer, host_name text, host_avatar text, distance_km double precision, series_ordinal integer, series_count integer, xp_reward integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  q text := nullif(public.clean_text(p_query), '');
begin
  if coalesce(public.setting_num('public_sessions_enabled'), 0) < 1 then return; end if;
  if (p_lat is null) <> (p_lng is null) or (p_radius_km is not null and p_lat is null) then raise exception 'a radius needs a centre'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'invalid centre'; end if;
  if p_radius_km is not null and (p_radius_km <= 0 or p_radius_km > 500) then raise exception 'the radius is between 0 and 500 km'; end if;
  if q is not null then q := left(q, 60); end if;
  return query
    select s.id, s.title, s.description, s.location, s.latitude, s.longitude, s.starts_at, s.ends_at, s.timezone, s.capacity,
           (select count(*)::integer from public.session_rsvps r where r.session_id = s.id),
           coalesce(h.display_name, 'Someone'), h.avatar,
           case when p_lat is null then null else public.session_distance_m(p_lat, p_lng, s.latitude, s.longitude) / 1000 end,
           s.series_ordinal, sr.occurrences, public.session_xp_reward(s.id)
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
      left join public.flight_session_series sr on sr.id = s.series_id
     where s.visibility = 'public' and s.publication = 'published' and s.status = 'scheduled' and s.ends_at > now()
       and (uid is null or not public.session_blocked(uid, s.created_by))
       and (p_radius_km is null or public.session_distance_m(p_lat, p_lng, s.latitude, s.longitude) <= p_radius_km * 1000)
       and (p_from is null or s.ends_at >= p_from) and (p_until is null or s.starts_at <= p_until)
       and (q is null or position(lower(q) in lower(s.title || ' ' || coalesce(s.location, ''))) > 0)
     order by s.starts_at, s.id
     limit least(greatest(coalesce(p_limit, 30), 1), 50) offset least(greatest(coalesce(p_offset, 0), 0), 1000);
end;
$$;

drop function public.get_public_session(uuid);
create function public.get_public_session(p_id uuid)
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               capacity integer, rsvp_count integer, host_name text, host_avatar text, xp_reward integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if coalesce(public.setting_num('public_sessions_enabled'), 0) < 1 then return; end if;
  return query
    select s.id, s.title, s.description, s.location, s.latitude, s.longitude, s.starts_at, s.ends_at, s.timezone, s.capacity,
           (select count(*)::integer from public.session_rsvps r where r.session_id = s.id), coalesce(h.display_name, 'Someone'), h.avatar, public.session_xp_reward(s.id)
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
     where s.id = p_id and s.visibility = 'public' and s.publication = 'published' and s.status = 'scheduled' and s.ends_at > now()
       and (uid is null or not public.session_blocked(uid, s.created_by));
end;
$$;

drop function public.list_sessions();
create function public.list_sessions()
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               status text, visibility text, capacity integer, rsvp_count integer, i_rsvped boolean, my_attended boolean, can_manage boolean, can_verify boolean, is_host boolean,
               host_name text, host_avatar text, series_id uuid, series_ordinal integer, series_count integer, invited boolean, xp_reward integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select s.id, s.title, s.description, s.location, s.latitude, s.longitude, s.starts_at, s.ends_at, s.timezone, s.status, s.visibility, s.capacity,
           (select count(*)::integer from public.session_rsvps r where r.session_id = s.id),
           exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid),
           exists (select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = uid and a.revoked_at is null),
           public.can_manage_session(uid, s.id), public.can_verify_session(uid, s.id), s.created_by = uid,
           coalesce(h.display_name, 'Someone'), h.avatar, s.series_id, s.series_ordinal, sr.occurrences, public.session_invited(uid, s.id), public.session_xp_reward(s.id)
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
      left join public.flight_session_series sr on sr.id = s.series_id
     where (s.status = 'scheduled'
            and (s.created_by = uid
                 or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)
                 or (public.session_invited(uid, s.id) and not public.session_blocked(uid, s.created_by))
                 or (s.visibility = 'public' and s.publication = 'published' and s.ends_at > now() and not public.session_blocked(uid, s.created_by))))
        or (s.starts_at > now() - interval '90 days'
            and (s.created_by = uid
                 or exists (select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = uid)
                 or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)))
     order by s.starts_at, s.id
     limit 300;
end;
$$;

drop function public.list_my_session_invitations();
create function public.list_my_session_invitations()
returns table (invitation_id uuid, session_id uuid, scope text, via text, invited_at timestamptz, title text, starts_at timestamptz, ends_at timestamptz, location text, latitude double precision, longitude double precision,
               timezone text, host_name text, series_ordinal integer, i_rsvped boolean, xp_reward integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select i.id, s.id, case when i.series_id is not null then 'series' else 'occurrence' end, i.via, i.created_at, s.title, s.starts_at, s.ends_at, s.location, s.latitude, s.longitude, s.timezone,
           coalesce(h.display_name, 'Someone'), s.series_ordinal, exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid), public.session_xp_reward(s.id)
      from public.session_invitations i
      join public.flight_sessions s on (s.id = i.session_id or s.series_id = i.series_id) and s.status = 'scheduled' and s.ends_at > now()
      left join public.profiles h on h.user_id = s.created_by
     where i.invitee = uid and i.revoked_at is null and s.created_by is distinct from uid and not public.session_blocked(uid, s.created_by)
     order by s.starts_at, s.id limit 200;
end;
$$;

-- ---------- the participant list

-- One call limit per person (guests have no identity: they are held by the page cap and the 50-row maximum).
create function public.people_list_throttle(p_uid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.people_list_rate%rowtype;
begin
  if p_uid is null then return; end if;
  insert into public.people_list_rate (user_id) values (p_uid) on conflict (user_id) do nothing;
  select * into r from public.people_list_rate where user_id = p_uid for update;
  if r.window_start < now() - interval '1 minute' then
    update public.people_list_rate set window_start = now(), calls = 1 where user_id = p_uid;
  elsif r.calls >= 60 then
    raise exception 'too many requests; try again in a minute' using errcode = '54000';
  else
    update public.people_list_rate set calls = calls + 1 where user_id = p_uid;
  end if;
end;
$$;

-- May this viewer (NULL = guest) see who is in this session? Public, open sessions: anyone. Private ones: the host, people who joined, and administrators.
create function public.session_people_visible(p_viewer uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.flight_sessions s
     where s.id = p_session and s.publication = 'published' and s.status = 'scheduled' and s.ends_at > now()
       and (p_viewer is null or not public.session_blocked(p_viewer, s.created_by))
       and ((s.visibility = 'public' and coalesce(public.setting_num('public_sessions_enabled'), 0) >= 1)
            or (p_viewer is not null and (s.created_by = p_viewer or public.has_role(p_viewer, 'admin')
                or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = p_viewer)))))
$$;

-- Who is in a session: the host first, then the people who said they will come (newest handle order is not shown; alphabetical).
-- relation: self | friend | pending | none. friendship_id is the viewer's own friendship row (their own friends list already holds it) and only for friends.
create function public.list_session_participants(p_session uuid, p_limit integer default 30, p_offset integer default 0)
returns table (handle uuid, display_name text, avatar text, relation text, is_host boolean, friendship_id uuid, total integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  off integer := least(greatest(coalesce(p_offset, 0), 0), 500);
begin
  perform public.people_list_throttle(uid);
  if not public.session_people_visible(uid, p_session) then return; end if;
  insert into public.session_participant_handles (session_id, user_id)
    select p_session, x.user_id from (
      select s.created_by as user_id from public.flight_sessions s where s.id = p_session and s.created_by is not null
      union select r.user_id from public.session_rsvps r where r.session_id = p_session) x
    on conflict do nothing;
  return query
    with people as (
      select pr.user_id, pr.display_name as nm, pr.avatar as av, (pr.user_id = s.created_by) as host
        from public.flight_sessions s
        join public.profiles pr on pr.user_id = s.created_by or pr.user_id in (select r.user_id from public.session_rsvps r where r.session_id = s.id)
       where s.id = p_session
         and (pr.user_id = s.created_by or pr.show_in_attendee_lists or pr.user_id = uid)
         and (uid is null or pr.user_id = uid or not public.session_blocked(uid, pr.user_id))
    )
    select h.handle, p.nm, p.av,
           case when uid is null then 'none' when p.user_id = uid then 'self'
                when f.status = 'accepted' then 'friend' when f.id is not null then 'pending' else 'none' end,
           p.host, case when f.status = 'accepted' and p.user_id <> uid then f.id end,
           (select count(*)::integer from people)
      from people p
      join public.session_participant_handles h on h.session_id = p_session and h.user_id = p.user_id
      left join public.friendships f on uid is not null and p.user_id <> uid
           and least(f.requester, f.addressee) = least(uid, p.user_id) and greatest(f.requester, f.addressee) = greatest(uid, p.user_id)
     order by p.host desc, lower(p.nm), h.handle
     limit lim offset off;
end;
$$;

-- Add friend from a session's list. One answer whatever the other person's settings: 'friends' when you already are, otherwise 'pending'
-- (also when they do not take requests or a block exists, so the answer reveals nothing). The target is named only by the handle.
create function public.request_friend_from_session(p_session uuid, p_handle uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target public.profiles%rowtype;
  fr public.friendships%rowtype;
  res jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.people_list_throttle(uid);
  perform public.ensure_profile();
  if not public.session_people_visible(uid, p_session) then raise exception 'not found'; end if;
  select pr.* into target from public.session_participant_handles h join public.profiles pr on pr.user_id = h.user_id
   where h.session_id = p_session and h.handle = p_handle
     and (pr.show_in_attendee_lists or pr.user_id = (select s.created_by from public.flight_sessions s where s.id = p_session));
  if not found or target.user_id = uid then raise exception 'not found'; end if;
  select * into fr from public.friendships
   where least(requester, addressee) = least(uid, target.user_id) and greatest(requester, addressee) = greatest(uid, target.user_id);
  if found and fr.status = 'accepted' then return jsonb_build_object('status', 'friends'); end if;
  if not target.accepts_requests or public.session_blocked(uid, target.user_id) then return jsonb_build_object('status', 'pending'); end if;
  res := public.request_friend(target.friend_code);
  return jsonb_build_object('status', case when res->>'status' = 'friends' then 'friends' else 'pending' end);
end;
$$;

-- ---------- account deletion also drops the handles

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
end;
$$;

-- ---------- grants

revoke all on function public.session_xp_reward(uuid) from public, anon, authenticated;
revoke all on function public.people_list_throttle(uuid) from public, anon, authenticated;
revoke all on function public.session_people_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.get_show_in_attendee_lists() from public, anon;
revoke all on function public.set_show_in_attendee_lists(boolean) from public, anon;
revoke all on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) from public;
revoke all on function public.get_public_session(uuid) from public;
revoke all on function public.list_sessions() from public, anon;
revoke all on function public.list_my_session_invitations() from public, anon;
revoke all on function public.list_session_participants(uuid, integer, integer) from public;
revoke all on function public.request_friend_from_session(uuid, uuid) from public, anon;
grant execute on function public.get_show_in_attendee_lists() to authenticated;
grant execute on function public.set_show_in_attendee_lists(boolean) to authenticated;
grant execute on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) to anon, authenticated;
grant execute on function public.get_public_session(uuid) to anon, authenticated;
grant execute on function public.list_sessions() to authenticated;
grant execute on function public.list_my_session_invitations() to authenticated;
grant execute on function public.list_session_participants(uuid, integer, integer) to anon, authenticated;
grant execute on function public.request_friend_from_session(uuid, uuid) to authenticated;
