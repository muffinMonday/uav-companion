-- Flight Sessions 2.0, phase 1: any signed-in person can host; public/private visibility; exact coordinates; capacity; host quota and conflict rules; in-app notices.
--
-- Additive. Existing sessions keep their ids, RSVPs, attendance and XP; they become private (the column default) with no coordinates. The old `location` text is the label.
-- Hosting is separate from XP authority: only an administrator, or an organiser who hosts the session, can mark attendance (can_verify_session). An ordinary host
-- manages the session (edit, cancel, close, see the RSVP list, remove a person) but cannot award XP.
-- Public sessions are switched off (progression_settings.public_sessions_enabled = 0) until the moderation package is in place (phase 6).
-- Nothing here is readable by a table grant; every write goes through a function.

insert into public.progression_settings (key, value) values ('public_sessions_enabled', 0) on conflict (key) do nothing;

alter table public.flight_sessions
  add column visibility text not null default 'private' check (visibility in ('private', 'public')),
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add column timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  add column capacity integer check (capacity is null or capacity between 1 and 500),
  add column publication text not null default 'published' check (publication in ('published', 'unpublished')),
  add column unpublished_at timestamptz,
  add column unpublished_reason text check (unpublished_reason is null or char_length(unpublished_reason) <= 200),
  add constraint flight_sessions_point check ((latitude is null) = (longitude is null)),
  add constraint flight_sessions_public_point check (visibility <> 'public' or latitude is not null);
create index flight_sessions_public on public.flight_sessions (starts_at) where visibility = 'public' and status = 'scheduled';
create index flight_sessions_host on public.flight_sessions (created_by, starts_at) where status = 'scheduled';

-- A person a host removed cannot join that session again.
create table public.session_removals (
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- In-app notices: something changed in a session the person had said they would attend. No text from users, only a kind and the session title as it was.
create table public.session_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.flight_sessions (id) on delete cascade,
  kind text not null check (kind in ('cancelled', 'changed', 'unpublished', 'removed', 'visibility')),
  session_title text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index session_notices_user on public.session_notices (user_id, created_at desc);

alter table public.session_removals enable row level security;
alter table public.session_notices enable row level security;
revoke all on public.session_removals, public.session_notices from anon, authenticated;

-- ---------- internal helpers (no one calls these directly)

create function public.session_distance_m(a double precision, b double precision, c double precision, d double precision)
returns double precision language sql immutable set search_path = ''
as $$ select 2 * 6371000 * asin(least(1, sqrt(power(sin(radians(c - a) / 2), 2) + cos(radians(a)) * cos(radians(c)) * power(sin(radians(d - b) / 2), 2)))) $$;

-- Did either person block the other?
create function public.session_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select p_a is not null and p_b is not null and exists (select 1 from public.blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a)) $$;

-- Is the person invited to the session? Invitations arrive in phase 3, which replaces this body.
create function public.session_invited(p_uid uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select false $$;

-- The host manages a session (edit, cancel, close, see the people); so does an administrator.
create or replace function public.can_manage_session(p_uid uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_role(p_uid, 'admin') or exists (select 1 from public.flight_sessions s where s.id = p_session and s.created_by = p_uid) $$;

-- Only this may award attendance XP: an administrator, or an organiser who hosts the session. Hosting alone is not enough.
create function public.can_verify_session(p_uid uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_role(p_uid, 'admin') or (public.has_role(p_uid, 'organiser') and exists (select 1 from public.flight_sessions s where s.id = p_session and s.created_by = p_uid)) $$;

create function public.session_notify(p_session uuid, p_kind text, p_except uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.session_notices where created_at < now() - interval '60 days';
  insert into public.session_notices (user_id, session_id, kind, session_title)
    select r.user_id, s.id, p_kind, s.title from public.session_rsvps r join public.flight_sessions s on s.id = r.session_id
     where r.session_id = p_session and r.user_id is distinct from p_except;
end;
$$;

-- Host rules shared by create and update: serialised per host so two requests cannot both pass. Raises when refused.
create function public.session_check_host(p_host uuid, p_exclude uuid, p_lat double precision, p_lng double precision, p_start timestamptz, p_end timestamptz, p_count_quota boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('session_host:' || p_host::text, 0));
  if p_count_quota and (select count(*) from public.flight_sessions s where s.created_by = p_host and s.status = 'scheduled' and s.ends_at > now()) >= 5 then
    raise exception 'you can host at most 5 active sessions: cancel or finish one first';
  end if;
  if p_lat is not null and exists (
       select 1 from public.flight_sessions s
        where s.created_by = p_host and s.status = 'scheduled' and s.id is distinct from p_exclude and s.latitude is not null
          and s.starts_at < p_end and s.ends_at > p_start and public.session_distance_m(s.latitude, s.longitude, p_lat, p_lng) < 300) then
    raise exception 'you already host a session within 300 m at an overlapping time';
  end if;
end;
$$;

-- Public sessions by other hosts that overlap in time and place: ids only, public data.
create function public.session_public_overlaps(p_host uuid, p_exclude uuid, p_lat double precision, p_lng double precision, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(s.id order by s.starts_at), '[]'::jsonb) from public.flight_sessions s
   where s.visibility = 'public' and s.publication = 'published' and s.status = 'scheduled' and s.created_by is distinct from p_host and s.id is distinct from p_exclude
     and s.starts_at < p_end and s.ends_at > p_start and public.session_distance_m(s.latitude, s.longitude, p_lat, p_lng) < 300
$$;

-- Validation of the common fields; returns nothing, raises on a bad value.
create function public.session_check_fields(p_title text, p_desc text, p_loc text, p_lat double precision, p_lng double precision, p_start timestamptz, p_end timestamptz, p_tz text, p_vis text, p_cap integer, p_check_time boolean, p_publicize boolean)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if char_length(p_title) not between 1 and 80 then raise exception 'a title of 1 to 80 characters is required'; end if;
  if p_desc is not null and char_length(p_desc) > 500 then raise exception 'the description is at most 500 characters'; end if;
  if p_loc is not null and char_length(p_loc) > 120 then raise exception 'the location is at most 120 characters'; end if;
  if (p_lat is null and (p_check_time or p_publicize)) or (p_lat is not null and (p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180)) then raise exception 'a map point is required'; end if;
  if p_start is null or p_end is null then raise exception 'start and end times are required'; end if;
  if p_end <= p_start or p_end > p_start + interval '48 hours' then raise exception 'a session ends after it starts and lasts at most 48 hours'; end if;
  if p_check_time and (p_start < now() - interval '30 days' or p_start > now() + interval '1 year') then raise exception 'the start must be within the last 30 days and the next year'; end if;
  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then raise exception 'unknown time zone'; end if;
  if p_vis not in ('private', 'public') then raise exception 'visibility is private or public'; end if;
  if p_cap is not null and p_cap not between 1 and 500 then raise exception 'capacity is between 1 and 500 people, or no limit'; end if;
  if p_publicize then
    if coalesce(public.setting_num('public_sessions_enabled'), 0) < 1 then raise exception 'public sessions are not open yet'; end if;
    if p_start < now() - interval '5 minutes' then raise exception 'a public session must start in the future'; end if;
  end if;
end;
$$;

-- ---------- create

drop function public.create_session(text, text, text, timestamptz, timestamptz);

create function public.create_session(p_title text, p_description text, p_location text, p_lat double precision, p_lng double precision, p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text default 'UTC', p_visibility text default 'private', p_capacity integer default null)
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
  warn jsonb := '[]'::jsonb;
  over jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then raise exception 'create your profile first'; end if;
  perform public.session_check_fields(t, d, l, p_lat, p_lng, p_starts_at, p_ends_at, p_timezone, p_visibility, p_capacity, true, p_visibility = 'public');
  perform public.session_check_host(uid, null, p_lat, p_lng, p_starts_at, p_ends_at, true);
  if (select count(*) from public.flight_sessions where created_by = uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'you have created too many sessions today: try again tomorrow'; end if;
  insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, timezone, visibility, capacity, created_by)
    values (t, d, l, p_lat, p_lng, p_starts_at, p_ends_at, p_timezone, p_visibility, p_capacity, uid) returning id into sid;
  if p_visibility = 'public' then
    over := public.session_public_overlaps(uid, sid, p_lat, p_lng, p_starts_at, p_ends_at);
    if jsonb_array_length(over) > 0 then warn := jsonb_build_array(jsonb_build_object('code', 'public_overlap', 'session_ids', over)); end if;
  end if;
  return jsonb_build_object('id', sid, 'warnings', warn);
end;
$$;

-- ---------- update

-- Changes a scheduled session. Fields: title, description, location, latitude + longitude (together), starts_at, ends_at, timezone, capacity, visibility.
-- null clears description, location or capacity. Public to private is refused once the session has started and anyone has said they will come.
create or replace function public.update_session(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  k text;
  t text; d text; l text; lat double precision; lng double precision; st timestamptz; en timestamptz; tz text; vis text; cap integer;
  rsvps integer;
  moved boolean;
  warn jsonb := '[]'::jsonb;
  over jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'the patch must be an object'; end if;
  select * into s from public.flight_sessions where id = p_id for update;
  if not found or not public.can_manage_session(uid, p_id) then raise exception 'session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'only a scheduled session can be changed'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'description', 'location', 'latitude', 'longitude', 'starts_at', 'ends_at', 'timezone', 'capacity', 'visibility') then raise exception 'unknown session field: %', left(k, 40); end if;
  end loop;
  if (p_patch ? 'latitude') <> (p_patch ? 'longitude') then raise exception 'a map point needs both latitude and longitude'; end if;
  t := s.title; d := s.description; l := s.location; lat := s.latitude; lng := s.longitude; st := s.starts_at; en := s.ends_at; tz := s.timezone; vis := s.visibility; cap := s.capacity;
  begin
    if p_patch ? 'title' then t := public.clean_text(p_patch->>'title'); end if;
    if p_patch ? 'description' then d := nullif(public.clean_text(p_patch->>'description'), ''); end if;
    if p_patch ? 'location' then l := nullif(public.clean_text(p_patch->>'location'), ''); end if;
    if p_patch ? 'latitude' then lat := (p_patch->>'latitude')::double precision; lng := (p_patch->>'longitude')::double precision; end if;
    if p_patch ? 'starts_at' then st := (p_patch->>'starts_at')::timestamptz; end if;
    if p_patch ? 'ends_at' then en := (p_patch->>'ends_at')::timestamptz; end if;
    if p_patch ? 'timezone' then tz := p_patch->>'timezone'; end if;
    if p_patch ? 'visibility' then vis := p_patch->>'visibility'; end if;
    if p_patch ? 'capacity' then cap := (p_patch->>'capacity')::integer; end if;
  exception when others then raise exception 'a field has the wrong type';
  end;
  select count(*)::integer into rsvps from public.session_rsvps where session_id = p_id;
  if vis = 'private' and s.visibility = 'public' and now() >= s.starts_at and rsvps > 0 then raise exception 'a public session that has started and has RSVPs cannot be made private'; end if;
  if cap is not null and cap < rsvps then raise exception 'the capacity cannot be lower than the % people who said they will come', rsvps; end if;
  -- the common checks: start bounds only when a time changed, the public rules only when the session becomes public now
  perform public.session_check_fields(t, d, l, lat, lng, st, en, tz, vis, cap, (p_patch ? 'starts_at') or (p_patch ? 'ends_at'), vis = 'public' and s.visibility = 'private');
  perform public.session_check_host(s.created_by, p_id, lat, lng, st, en, false);
  moved := st <> s.starts_at or en <> s.ends_at or l is distinct from s.location or lat is distinct from s.latitude or lng is distinct from s.longitude;
  update public.flight_sessions set title = t, description = d, location = l, latitude = lat, longitude = lng, starts_at = st, ends_at = en, timezone = tz, visibility = vis, capacity = cap where id = p_id;
  if moved then perform public.session_notify(p_id, 'changed', uid); end if;
  if vis <> s.visibility then perform public.session_notify(p_id, 'visibility', uid); end if;
  if vis = 'public' then
    over := public.session_public_overlaps(s.created_by, p_id, lat, lng, st, en);
    if jsonb_array_length(over) > 0 then warn := jsonb_build_array(jsonb_build_object('code', 'public_overlap', 'session_ids', over)); end if;
  end if;
  return jsonb_build_object('status', 'updated', 'warnings', warn);
end;
$$;

-- ---------- cancel and close (same rules; cancelling now tells the people who said they would come)

create or replace function public.cancel_session(p_id uuid)
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
  perform public.session_notify(p_id, 'cancelled', uid);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- ---------- RSVP: capacity is enforced under the session row lock, so two requests cannot both take the last place

create or replace function public.rsvp_session(p_id uuid)
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
  select * into s from public.flight_sessions where id = p_id for update;
  if not found or s.status <> 'scheduled' then raise exception 'session not found'; end if;
  if exists (select 1 from public.session_rsvps where session_id = p_id and user_id = uid) then return jsonb_build_object('status', 'rsvped'); end if;
  if s.created_by is distinct from uid and (
       public.session_blocked(uid, s.created_by)
       or not ((s.visibility = 'public' and s.publication = 'published') or public.session_invited(uid, p_id))) then raise exception 'session not found'; end if;
  if exists (select 1 from public.session_removals where session_id = p_id and user_id = uid) then raise exception 'you cannot join this session'; end if;
  if now() > s.ends_at then raise exception 'the session is over'; end if;
  if s.capacity is not null and (select count(*) from public.session_rsvps where session_id = p_id) >= s.capacity then raise exception 'the session is full'; end if;
  insert into public.session_rsvps (session_id, user_id) values (p_id, uid);
  return jsonb_build_object('status', 'rsvped');
end;
$$;

-- A host removes a person who said they would come (not someone already marked present). That person cannot join this session again.
create function public.remove_session_participant(p_session uuid, p_rsvp uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
  title text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select s.title into title from public.flight_sessions s where s.id = p_session for update;
  if not found or not public.can_manage_session(uid, p_session) then raise exception 'session not found'; end if;
  select user_id into target from public.session_rsvps where id = p_rsvp and session_id = p_session;
  if target is null then raise exception 'not found'; end if;
  if target = uid then raise exception 'you cannot remove yourself'; end if;
  if exists (select 1 from public.session_attendance where session_id = p_session and user_id = target) then raise exception 'this person was already marked present'; end if;
  delete from public.session_rsvps where id = p_rsvp;
  insert into public.session_removals (session_id, user_id) values (p_session, target) on conflict do nothing;
  insert into public.session_notices (user_id, session_id, kind, session_title) values (target, p_session, 'removed', title);
  return jsonb_build_object('status', 'removed');
end;
$$;

-- ---------- reads

-- What the caller may see: sessions they host, joined or attended; scheduled public sessions (not by someone who blocked them or whom they blocked).
-- Closed or cancelled ones only when they host, attended or had said they would come (last 90 days). A count of RSVPs, never who.
drop function public.list_sessions();
create function public.list_sessions()
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               status text, visibility text, capacity integer, rsvp_count integer, i_rsvped boolean, my_attended boolean, can_manage boolean, can_verify boolean, is_host boolean,
               host_name text, host_avatar text)
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
           coalesce(h.display_name, 'Someone'), h.avatar
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
     where (s.status = 'scheduled'
            and (s.created_by = uid
                 or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)
                 or public.session_invited(uid, s.id)
                 or (s.visibility = 'public' and s.publication = 'published' and s.ends_at > now() and not public.session_blocked(uid, s.created_by))))
        or (s.starts_at > now() - interval '90 days'
            and (s.created_by = uid
                 or exists (select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = uid)
                 or exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)))
     order by s.starts_at, s.id
     limit 300;
end;
$$;

-- Guest-safe discovery. Public, published, scheduled sessions that have not ended; safe fields only (no user ids, no attendee names, no private data).
-- Optional filters: a centre and radius in km, a time window, a title/location word. Empty while public sessions are switched off.
create function public.list_public_sessions(p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default null,
                                            p_from timestamptz default null, p_until timestamptz default null, p_query text default null,
                                            p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               capacity integer, rsvp_count integer, host_name text, host_avatar text, distance_km double precision)
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
           case when p_lat is null then null else public.session_distance_m(p_lat, p_lng, s.latitude, s.longitude) / 1000 end
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
     where s.visibility = 'public' and s.publication = 'published' and s.status = 'scheduled' and s.ends_at > now()
       and (uid is null or not public.session_blocked(uid, s.created_by))
       and (p_radius_km is null or public.session_distance_m(p_lat, p_lng, s.latitude, s.longitude) <= p_radius_km * 1000)
       and (p_from is null or s.ends_at >= p_from) and (p_until is null or s.starts_at <= p_until)
       and (q is null or position(lower(q) in lower(s.title || ' ' || coalesce(s.location, ''))) > 0)
     order by s.starts_at, s.id
     limit least(greatest(coalesce(p_limit, 30), 1), 50) offset least(greatest(coalesce(p_offset, 0), 0), 1000);
end;
$$;

-- One public session by id (deep links). No row when it is private, unpublished, over, or public sessions are off.
create function public.get_public_session(p_id uuid)
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               capacity integer, rsvp_count integer, host_name text, host_avatar text)
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
           (select count(*)::integer from public.session_rsvps r where r.session_id = s.id), coalesce(h.display_name, 'Someone'), h.avatar
      from public.flight_sessions s
      left join public.profiles h on h.user_id = s.created_by
     where s.id = p_id and s.visibility = 'public' and s.publication = 'published' and s.status = 'scheduled' and s.ends_at > now()
       and (uid is null or not public.session_blocked(uid, s.created_by));
end;
$$;

-- The caller's unread notices, newest first (last 30 days).
create function public.list_my_session_notices()
returns table (id uuid, session_id uuid, kind text, session_title text, created_at timestamptz, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query select n.id, n.session_id, n.kind, n.session_title, n.created_at, n.read_at from public.session_notices n
                where n.user_id = uid and n.created_at > now() - interval '30 days' order by n.created_at desc limit 50;
end;
$$;

create function public.ack_session_notices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.session_notices set read_at = now() where user_id = uid and read_at is null;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- attendance XP stays with organisers and administrators: the body is the earlier one with can_verify_session in place of can_manage_session

create or replace function public.mark_attended(p_session uuid, p_kind text, p_ref text)
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
  if not public.can_verify_session(uid, p_session) then raise exception 'only an organiser or administrator can verify attendance' using errcode = '42501'; end if;
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

-- ---------- account deletion: sessions the person hosted are closed (attendance marked) or cancelled, lose their place and host, and the people who were coming are told.
-- Later phases add what they own to purge_user_sessions; delete_profile does not change again.

create function public.purge_user_sessions(p_uid uuid)
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
  update public.flight_sessions set visibility = 'private', latitude = null, longitude = null, location = null, created_by = null where created_by = p_uid;
  delete from public.session_rsvps where user_id = p_uid;
  delete from public.session_notices where user_id = p_uid;
  delete from public.session_removals where user_id = p_uid;
end;
$$;

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
  delete from public.friend_live_locations where user_id = uid;
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  perform public.purge_user_sessions(uid);
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

-- ---------- grants: internal helpers are closed to everyone; the rest to signed-in users; guest discovery to anon too

revoke all on function public.session_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.session_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.session_invited(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_manage_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_verify_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.session_notify(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.session_check_host(uuid, uuid, double precision, double precision, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.session_public_overlaps(uuid, uuid, double precision, double precision, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.session_check_fields(text, text, text, double precision, double precision, timestamptz, timestamptz, text, text, integer, boolean, boolean) from public, anon, authenticated;
revoke all on function public.purge_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.create_session(text, text, text, double precision, double precision, timestamptz, timestamptz, text, text, integer) from public, anon;
revoke all on function public.update_session(uuid, jsonb) from public, anon;
revoke all on function public.cancel_session(uuid) from public, anon;
revoke all on function public.rsvp_session(uuid) from public, anon;
revoke all on function public.remove_session_participant(uuid, uuid) from public, anon;
revoke all on function public.list_sessions() from public, anon;
revoke all on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) from public;
revoke all on function public.get_public_session(uuid) from public;
revoke all on function public.list_my_session_notices() from public, anon;
revoke all on function public.ack_session_notices() from public, anon;
revoke all on function public.mark_attended(uuid, text, text) from public, anon;
revoke all on function public.delete_profile() from public, anon;
grant execute on function public.create_session(text, text, text, double precision, double precision, timestamptz, timestamptz, text, text, integer) to authenticated;
grant execute on function public.update_session(uuid, jsonb) to authenticated;
grant execute on function public.cancel_session(uuid) to authenticated;
grant execute on function public.rsvp_session(uuid) to authenticated;
grant execute on function public.remove_session_participant(uuid, uuid) to authenticated;
grant execute on function public.list_sessions() to authenticated;
grant execute on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) to anon, authenticated;
grant execute on function public.get_public_session(uuid) to anon, authenticated;
grant execute on function public.list_my_session_notices() to authenticated;
grant execute on function public.ack_session_notices() to authenticated;
grant execute on function public.mark_attended(uuid, text, text) to authenticated;
grant execute on function public.delete_profile() to authenticated;
