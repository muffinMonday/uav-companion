-- Flight Sessions 2.0, phase 3 (backend): recurring series, occurrence overrides, named invitations and revocable private links.
--
-- A series is a bounded set of occurrences created together (2 to 12, weekly, biweekly or monthly), each an ordinary flight_sessions row with its own RSVPs,
-- capacity, attendance and XP. Local wall time is kept across daylight-saving changes in the event's time zone: a time that does not exist moves forward, an
-- ambiguous time takes the first occurrence. A monthly 29th to 31st is clamped for that month only; later months return to the preferred day.
-- A series counts as ONE of a host's five active slots. Editing one occurrence marks it overridden; a "this and following" edit skips overridden occurrences.
-- Invitations: named (by friend code) or by link; scope is one occurrence or the entire series. A link is a bearer token shown once and stored only as a hash;
-- redeeming needs sign-in, respects expiry, use limit and revocation, and gives an invitation. Revoking a link or invitation stops new access and leaves people who
-- already joined (the host can remove them).

create table public.flight_session_series (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  occurrences integer not null check (occurrences between 2 and 12),
  preferred_day integer not null check (preferred_day between 1 and 31),
  local_time time not null,
  duration_minutes integer not null check (duration_minutes between 1 and 2880),
  timezone text not null,
  created_at timestamptz not null default now()
);

alter table public.flight_sessions
  add column series_id uuid references public.flight_session_series (id) on delete set null,
  add column series_ordinal integer check (series_ordinal is null or series_ordinal between 1 and 12),
  add column overridden boolean not null default false,
  add constraint flight_sessions_series_pair check ((series_id is null) = (series_ordinal is null));
create unique index flight_sessions_series_ordinal on public.flight_sessions (series_id, series_ordinal) where series_id is not null;

create table public.session_invitations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.flight_sessions (id) on delete cascade,
  series_id uuid references public.flight_session_series (id) on delete cascade,
  invitee uuid not null references auth.users (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  via text not null check (via in ('name', 'link')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((session_id is null) <> (series_id is null))
);
create unique index session_invitations_one on public.session_invitations (invitee, coalesce(session_id, series_id));
create index session_invitations_session on public.session_invitations (session_id) where session_id is not null;
create index session_invitations_series on public.session_invitations (series_id) where series_id is not null;

create table public.session_links (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.flight_sessions (id) on delete cascade,
  series_id uuid references public.flight_session_series (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 500),
  uses integer not null default 0,
  revoked_at timestamptz,
  check ((session_id is null) <> (series_id is null))
);
create index session_links_session on public.session_links (session_id) where session_id is not null;
create index session_links_series on public.session_links (series_id) where series_id is not null;

alter table public.flight_session_series enable row level security;
alter table public.session_invitations enable row level security;
alter table public.session_links enable row level security;
revoke all on public.flight_session_series, public.session_invitations, public.session_links from anon, authenticated;

-- ---------- helpers

-- Invited to this occurrence, or to its whole series, and not revoked.
create or replace function public.session_invited(p_uid uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.session_invitations i
                  where i.invitee = p_uid and i.revoked_at is null
                    and (i.session_id = p_session or i.series_id = (select s.series_id from public.flight_sessions s where s.id = p_session)))
$$;

-- A series counts once toward the five slots. A creation is counted once however many occurrences it made.
create or replace function public.session_check_host(p_host uuid, p_exclude uuid, p_lat double precision, p_lng double precision, p_start timestamptz, p_end timestamptz, p_count_quota boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('session_host:' || p_host::text, 0));
  if p_count_quota and (select count(distinct coalesce(s.series_id, s.id)) from public.flight_sessions s where s.created_by = p_host and s.status = 'scheduled' and s.ends_at > now()) >= 5 then
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

-- The instant of a local wall-clock time: a time that does not exist moves forward (the database's own rule); an ambiguous time takes the first occurrence.
create function public.session_local_instant(p_local timestamp, p_tz text)
returns timestamptz language plpgsql stable set search_path = ''
as $$
declare c timestamptz := p_local at time zone p_tz; iv interval;
begin
  foreach iv in array array[interval '1 hour', interval '30 minutes'] loop
    if ((c - iv) at time zone p_tz) = p_local then return c - iv; end if;
  end loop;
  return c;
end;
$$;

-- Local date of occurrence i (0-based) for a series starting on d0.
create function public.session_occurrence_date(p_d0 date, p_frequency text, p_i integer)
returns date language sql immutable set search_path = ''
as $$
  select case p_frequency
    when 'weekly' then p_d0 + 7 * p_i
    when 'biweekly' then p_d0 + 14 * p_i
    else (select (m::date + (least(extract(day from p_d0)::integer, extract(day from (m + interval '1 month' - interval '1 day'))::integer) - 1))
            from (select date_trunc('month', p_d0::timestamp) + (p_i || ' months')::interval as m) x)
  end
$$;

-- ---------- create_session: the daily creation limit counts a series once

create or replace function public.create_session(p_title text, p_description text, p_location text, p_lat double precision, p_lng double precision, p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text default 'UTC', p_visibility text default 'private', p_capacity integer default null)
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
  if (select count(distinct coalesce(series_id, id)) from public.flight_sessions where created_by = uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'you have created too many sessions today: try again tomorrow'; end if;
  insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, timezone, visibility, capacity, created_by)
    values (t, d, l, p_lat, p_lng, p_starts_at, p_ends_at, p_timezone, p_visibility, p_capacity, uid) returning id into sid;
  if p_visibility = 'public' then
    over := public.session_public_overlaps(uid, sid, p_lat, p_lng, p_starts_at, p_ends_at);
    if jsonb_array_length(over) > 0 then warn := jsonb_build_array(jsonb_build_object('code', 'public_overlap', 'session_ids', over)); end if;
  end if;
  return jsonb_build_object('id', sid, 'warnings', warn);
end;
$$;

-- ---------- create a series

create function public.create_session_series(p_title text, p_description text, p_location text, p_lat double precision, p_lng double precision, p_local_start timestamp,
                                              p_duration_minutes integer, p_timezone text, p_visibility text, p_capacity integer, p_frequency text, p_count integer default 4)
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
  ids jsonb := '[]'::jsonb;
  warn_ids jsonb := '[]'::jsonb;
  i integer;
  st timestamptz; en timestamptz; one uuid; over jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then raise exception 'create your profile first'; end if;
  if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then raise exception 'repeat weekly, every two weeks or monthly'; end if;
  if p_count is null or p_count not between 2 and 12 then raise exception 'a series has 2 to 12 occurrences'; end if;
  if p_duration_minutes is null or p_duration_minutes not between 1 and 2880 then raise exception 'a session ends after it starts and lasts at most 48 hours'; end if;
  if p_local_start is null then raise exception 'start and end times are required'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'unknown time zone'; end if;
  st := public.session_local_instant(p_local_start, p_timezone);
  perform public.session_check_fields(t, d, l, p_lat, p_lng, st, st + make_interval(mins => p_duration_minutes), p_timezone, p_visibility, p_capacity, true, p_visibility = 'public');
  if (select count(distinct coalesce(series_id, id)) from public.flight_sessions where created_by = uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'you have created too many sessions today: try again tomorrow'; end if;
  insert into public.flight_session_series (created_by, frequency, occurrences, preferred_day, local_time, duration_minutes, timezone)
    values (uid, p_frequency, p_count, extract(day from p_local_start)::integer, p_local_start::time, p_duration_minutes, p_timezone) returning id into sid;
  for i in 0 .. p_count - 1 loop
    st := public.session_local_instant(public.session_occurrence_date(p_local_start::date, p_frequency, i) + p_local_start::time, p_timezone);
    en := st + make_interval(mins => p_duration_minutes);
    perform public.session_check_host(uid, null, p_lat, p_lng, st, en, i = 0);
    insert into public.flight_sessions (title, description, location, latitude, longitude, starts_at, ends_at, timezone, visibility, capacity, created_by, series_id, series_ordinal)
      values (t, d, l, p_lat, p_lng, st, en, p_timezone, p_visibility, p_capacity, uid, sid, i + 1) returning id into one;
    ids := ids || to_jsonb(one);
    if p_visibility = 'public' then warn_ids := warn_ids || public.session_public_overlaps(uid, one, p_lat, p_lng, st, en); end if;
  end loop;
  select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into over from jsonb_array_elements(warn_ids) e;
  return jsonb_build_object('series_id', sid, 'ids', ids,
    'warnings', case when jsonb_array_length(over) > 0 then jsonb_build_array(jsonb_build_object('code', 'public_overlap', 'session_ids', over)) else '[]'::jsonb end);
end;
$$;

-- ---------- edits: one occurrence (update_session) marks it overridden; this-and-following skips overridden ones

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
  perform public.session_check_fields(t, d, l, lat, lng, st, en, tz, vis, cap, (p_patch ? 'starts_at') or (p_patch ? 'ends_at'), vis = 'public' and s.visibility = 'private');
  perform public.session_check_host(s.created_by, p_id, lat, lng, st, en, false);
  moved := st <> s.starts_at or en <> s.ends_at or l is distinct from s.location or lat is distinct from s.latitude or lng is distinct from s.longitude;
  update public.flight_sessions set title = t, description = d, location = l, latitude = lat, longitude = lng, starts_at = st, ends_at = en, timezone = tz, visibility = vis, capacity = cap,
         overridden = overridden or s.series_id is not null where id = p_id;
  if moved then perform public.session_notify(p_id, 'changed', uid); end if;
  if vis <> s.visibility then perform public.session_notify(p_id, 'visibility', uid); end if;
  if vis = 'public' then
    over := public.session_public_overlaps(s.created_by, p_id, lat, lng, st, en);
    if jsonb_array_length(over) > 0 then warn := jsonb_build_array(jsonb_build_object('code', 'public_overlap', 'session_ids', over)); end if;
  end if;
  return jsonb_build_object('status', 'updated', 'warnings', warn);
end;
$$;

-- This occurrence and every later scheduled, not-overridden one of its series. Fields: title, description, location, latitude + longitude, capacity,
-- start_time ('HH:MI' local), duration_minutes. The first (chosen) occurrence is always changed, even if it was overridden. Returns how many were changed.
create function public.update_session_series(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  ser public.flight_session_series%rowtype;
  r public.flight_sessions%rowtype;
  k text;
  t text; d text; l text; lat double precision; lng double precision; cap integer; lt time; dur integer;
  st timestamptz; en timestamptz; n integer := 0;
  moved boolean; rsvps integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'the patch must be an object'; end if;
  select * into s from public.flight_sessions where id = p_id;
  if not found or not public.can_manage_session(uid, p_id) or s.series_id is null then raise exception 'session not found'; end if;
  select * into ser from public.flight_session_series where id = s.series_id for update;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'description', 'location', 'latitude', 'longitude', 'capacity', 'start_time', 'duration_minutes') then raise exception 'unknown series field: %', left(k, 40); end if;
  end loop;
  if (p_patch ? 'latitude') <> (p_patch ? 'longitude') then raise exception 'a map point needs both latitude and longitude'; end if;
  perform pg_advisory_xact_lock(hashtextextended('session_host:' || coalesce(s.created_by::text, ''), 0));
  for r in select * from public.flight_sessions x where x.series_id = s.series_id and x.series_ordinal >= s.series_ordinal and x.status = 'scheduled' and (x.id = p_id or not x.overridden)
            order by x.series_ordinal for update loop
    t := r.title; d := r.description; l := r.location; lat := r.latitude; lng := r.longitude; cap := r.capacity; st := r.starts_at; en := r.ends_at;
    begin
      if p_patch ? 'title' then t := public.clean_text(p_patch->>'title'); end if;
      if p_patch ? 'description' then d := nullif(public.clean_text(p_patch->>'description'), ''); end if;
      if p_patch ? 'location' then l := nullif(public.clean_text(p_patch->>'location'), ''); end if;
      if p_patch ? 'latitude' then lat := (p_patch->>'latitude')::double precision; lng := (p_patch->>'longitude')::double precision; end if;
      if p_patch ? 'capacity' then cap := (p_patch->>'capacity')::integer; end if;
      lt := coalesce((p_patch->>'start_time')::time, (r.starts_at at time zone r.timezone)::time);
      dur := coalesce((p_patch->>'duration_minutes')::integer, round(extract(epoch from (r.ends_at - r.starts_at)) / 60)::integer);
    exception when others then raise exception 'a field has the wrong type';
    end;
    if (p_patch ? 'start_time') or (p_patch ? 'duration_minutes') then
      st := public.session_local_instant((r.starts_at at time zone r.timezone)::date + lt, r.timezone);
      en := st + make_interval(mins => dur);
    end if;
    select count(*)::integer into rsvps from public.session_rsvps where session_id = r.id;
    if cap is not null and cap < rsvps then raise exception 'the capacity cannot be lower than the % people who said they will come', rsvps; end if;
    perform public.session_check_fields(t, d, l, lat, lng, st, en, r.timezone, r.visibility, cap, (p_patch ? 'start_time') or (p_patch ? 'duration_minutes'), false);
    perform public.session_check_host(r.created_by, r.id, lat, lng, st, en, false);
    moved := st <> r.starts_at or en <> r.ends_at or l is distinct from r.location or lat is distinct from r.latitude or lng is distinct from r.longitude;
    update public.flight_sessions set title = t, description = d, location = l, latitude = lat, longitude = lng, capacity = cap, starts_at = st, ends_at = en where id = r.id;
    if moved then perform public.session_notify(r.id, 'changed', uid); end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('status', 'updated', 'changed', n);
end;
$$;

-- Cancels this occurrence and every later one that has no attendance marked. Occurrences that already started are left.
create function public.cancel_session_series(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  r record;
  n integer := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into s from public.flight_sessions where id = p_id;
  if not found or not public.can_manage_session(uid, p_id) or s.series_id is null then raise exception 'session not found'; end if;
  for r in select x.id from public.flight_sessions x where x.series_id = s.series_id and x.series_ordinal >= s.series_ordinal and x.status = 'scheduled'
              and now() < x.starts_at and not exists (select 1 from public.session_attendance a where a.session_id = x.id) order by x.series_ordinal for update loop
    update public.flight_sessions set status = 'cancelled', closed_at = now() where id = r.id;
    perform public.session_notify(r.id, 'cancelled', uid);
    n := n + 1;
  end loop;
  return jsonb_build_object('status', 'cancelled', 'cancelled', n);
end;
$$;

-- ---------- invitations

create function public.session_invite_target(p_session uuid, p_scope text)
returns table (session_id uuid, series_id uuid) language plpgsql stable security definer set search_path = ''
as $$
declare s public.flight_sessions%rowtype;
begin
  select * into s from public.flight_sessions where id = p_session;
  if p_scope not in ('occurrence', 'series') then raise exception 'the scope is one occurrence or the entire series'; end if;
  if p_scope = 'series' and s.series_id is null then raise exception 'this session is not part of a series'; end if;
  return query select case when p_scope = 'occurrence' then s.id end, case when p_scope = 'series' then s.series_id end;
end;
$$;

-- Invites a person by friend code. They then see the session, and can RSVP to it (or to the whole series).
create function public.invite_to_session(p_session uuid, p_code text, p_scope text default 'occurrence')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  target uuid;
  tgt record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into s from public.flight_sessions where id = p_session;
  if not found or not public.can_manage_session(uid, p_session) then raise exception 'session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'only a scheduled session takes invitations'; end if;
  select user_id into target from public.profiles where friend_code = lower(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if target is null or target = uid or public.session_blocked(uid, target) then raise exception 'person not found'; end if;
  select * into tgt from public.session_invite_target(p_session, p_scope);
  if (select count(*) from public.session_invitations i where i.session_id = p_session or i.series_id = s.series_id) >= 100 then raise exception 'at most 100 invitations per session'; end if;
  insert into public.session_invitations (session_id, series_id, invitee, invited_by, via) values (tgt.session_id, tgt.series_id, target, uid, 'name')
    on conflict (invitee, coalesce(session_id, series_id)) do update set revoked_at = null, invited_by = uid where public.session_invitations.revoked_at is not null;
  return jsonb_build_object('status', 'invited');
end;
$$;

create function public.revoke_session_invitation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  i public.session_invitations%rowtype;
  sid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into i from public.session_invitations where id = p_id;
  sid := coalesce(i.session_id, (select min(id::text)::uuid from public.flight_sessions where series_id = i.series_id));
  if not found or not public.can_manage_session(uid, sid) then raise exception 'not found'; end if;
  update public.session_invitations set revoked_at = now() where id = p_id and revoked_at is null;
  return jsonb_build_object('status', 'revoked');
end;
$$;

-- A private link: the token is returned here once and stored only as a hash. Expiry 1 hour to 30 days (default 7 days), uses 1 to 500 (default 25).
create function public.create_session_link(p_session uuid, p_scope text default 'occurrence', p_expires_hours integer default 168, p_max_uses integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.flight_sessions%rowtype;
  tgt record;
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  lid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into s from public.flight_sessions where id = p_session;
  if not found or not public.can_manage_session(uid, p_session) then raise exception 'session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'only a scheduled session takes links'; end if;
  if p_expires_hours is null or p_expires_hours not between 1 and 720 then raise exception 'a link lasts 1 hour to 30 days'; end if;
  if p_max_uses is null or p_max_uses not between 1 and 500 then raise exception 'a link takes 1 to 500 uses'; end if;
  select * into tgt from public.session_invite_target(p_session, p_scope);
  if (select count(*) from public.session_links l where (l.session_id = p_session or l.series_id = s.series_id) and l.revoked_at is null and l.expires_at > now()) >= 10 then raise exception 'at most 10 active links per session'; end if;
  insert into public.session_links (session_id, series_id, token_hash, created_by, expires_at, max_uses)
    values (tgt.session_id, tgt.series_id, encode(sha256(convert_to(tok, 'utf8')), 'hex'), uid, now() + make_interval(hours => p_expires_hours), p_max_uses) returning id into lid;
  return jsonb_build_object('id', lid, 'token', tok);
end;
$$;

create function public.revoke_session_link(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  l public.session_links%rowtype;
  sid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into l from public.session_links where id = p_id;
  sid := coalesce(l.session_id, (select min(id::text)::uuid from public.flight_sessions where series_id = l.series_id));
  if not found or not public.can_manage_session(uid, sid) then raise exception 'not found'; end if;
  update public.session_links set revoked_at = now() where id = p_id and revoked_at is null;
  return jsonb_build_object('status', 'revoked');
end;
$$;

-- Redeems a link: sign-in required. Every failure gives the same message, so nothing says whether a token ever existed. Already invited: no use is spent.
create function public.redeem_session_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  l public.session_links%rowtype;
  host uuid;
  sid uuid;
  fresh integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_token is null or char_length(p_token) not between 32 and 100 then raise exception 'this link is not valid'; end if;
  select * into l from public.session_links where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') for update;
  if not found or l.revoked_at is not null or l.expires_at <= now() then raise exception 'this link is not valid'; end if;
  select s.id, s.created_by into sid, host from public.flight_sessions s where (s.id = l.session_id or s.series_id = l.series_id) and s.status = 'scheduled' order by s.starts_at limit 1;
  if sid is null or public.session_blocked(uid, host) then raise exception 'this link is not valid'; end if;
  if host is not distinct from uid then return jsonb_build_object('status', 'host', 'session_id', sid); end if;
  if exists (select 1 from public.session_invitations i where i.invitee = uid and i.revoked_at is null and (i.session_id = l.session_id or i.series_id = l.series_id)) then
    return jsonb_build_object('status', 'already_invited', 'session_id', sid);
  end if;
  if l.uses >= l.max_uses then raise exception 'this link is not valid'; end if;
  insert into public.session_invitations (session_id, series_id, invitee, invited_by, via) values (l.session_id, l.series_id, uid, l.created_by, 'link')
    on conflict (invitee, coalesce(session_id, series_id)) do update set revoked_at = null, via = 'link' where public.session_invitations.revoked_at is not null;
  get diagnostics fresh = row_count;
  update public.session_links set uses = uses + 1 where id = l.id;
  return jsonb_build_object('status', 'invited', 'session_id', sid);
end;
$$;

-- The host's view of a session's invitations and links (never the token).
create function public.list_session_invites(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sr uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select series_id into sr from public.flight_sessions where id = p_session;
  if not found or not public.can_manage_session(uid, p_session) then raise exception 'session not found'; end if;
  return jsonb_build_object(
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', coalesce(p.display_name, 'Someone'), 'scope', case when i.series_id is not null then 'series' else 'occurrence' end,
                                                                  'via', i.via, 'revoked', i.revoked_at is not null, 'created_at', i.created_at) order by i.created_at)
                               from public.session_invitations i left join public.profiles p on p.user_id = i.invitee where i.session_id = p_session or (sr is not null and (i.series_id = sr or i.session_id in (select x.id from public.flight_sessions x where x.series_id = sr)))), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'scope', case when k.series_id is not null then 'series' else 'occurrence' end, 'expires_at', k.expires_at,
                                                           'max_uses', k.max_uses, 'uses', k.uses, 'revoked', k.revoked_at is not null) order by k.created_at)
                       from public.session_links k where k.session_id = p_session or (sr is not null and (k.series_id = sr or k.session_id in (select x.id from public.flight_sessions x where x.series_id = sr)))), '[]'::jsonb));
end;
$$;

-- Sessions I am invited to (and not hosting), with who invited me: the "Invitations" list.
create function public.list_my_session_invitations()
returns table (invitation_id uuid, session_id uuid, scope text, via text, invited_at timestamptz, title text, starts_at timestamptz, ends_at timestamptz, location text, latitude double precision, longitude double precision,
               timezone text, host_name text, series_ordinal integer, i_rsvped boolean)
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
           coalesce(h.display_name, 'Someone'), s.series_ordinal, exists (select 1 from public.session_rsvps r where r.session_id = s.id and r.user_id = uid)
      from public.session_invitations i
      join public.flight_sessions s on (s.id = i.session_id or s.series_id = i.series_id) and s.status = 'scheduled' and s.ends_at > now()
      left join public.profiles h on h.user_id = s.created_by
     where i.invitee = uid and i.revoked_at is null and s.created_by is distinct from uid and not public.session_blocked(uid, s.created_by)
     order by s.starts_at, s.id limit 200;
end;
$$;

-- ---------- list_sessions and list_public_sessions gain the series columns (and invited)

drop function public.list_sessions();
create function public.list_sessions()
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               status text, visibility text, capacity integer, rsvp_count integer, i_rsvped boolean, my_attended boolean, can_manage boolean, can_verify boolean, is_host boolean,
               host_name text, host_avatar text, series_id uuid, series_ordinal integer, series_count integer, invited boolean)
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
           coalesce(h.display_name, 'Someone'), h.avatar, s.series_id, s.series_ordinal, sr.occurrences, public.session_invited(uid, s.id)
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

drop function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer);
create function public.list_public_sessions(p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default null,
                                            p_from timestamptz default null, p_until timestamptz default null, p_query text default null,
                                            p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, title text, description text, location text, latitude double precision, longitude double precision, starts_at timestamptz, ends_at timestamptz, timezone text,
               capacity integer, rsvp_count integer, host_name text, host_avatar text, distance_km double precision, series_ordinal integer, series_count integer)
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
           s.series_ordinal, sr.occurrences
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

-- ---------- account deletion: what this phase owns

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
  update public.flight_sessions set visibility = 'private', latitude = null, longitude = null, location = null, created_by = null where created_by = p_uid;
  update public.flight_session_series set created_by = null where created_by = p_uid;
  delete from public.session_rsvps where user_id = p_uid;
  delete from public.session_notices where user_id = p_uid;
  delete from public.session_removals where user_id = p_uid;
end;
$$;

-- ---------- grants

revoke all on function public.session_invited(uuid, uuid) from public, anon, authenticated;
revoke all on function public.session_check_host(uuid, uuid, double precision, double precision, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.session_local_instant(timestamp, text) from public, anon, authenticated;
revoke all on function public.session_occurrence_date(date, text, integer) from public, anon, authenticated;
revoke all on function public.session_invite_target(uuid, text) from public, anon, authenticated;
revoke all on function public.purge_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.create_session_series(text, text, text, double precision, double precision, timestamp, integer, text, text, integer, text, integer) from public, anon;
revoke all on function public.update_session(uuid, jsonb) from public, anon;
revoke all on function public.update_session_series(uuid, jsonb) from public, anon;
revoke all on function public.cancel_session_series(uuid) from public, anon;
revoke all on function public.invite_to_session(uuid, text, text) from public, anon;
revoke all on function public.revoke_session_invitation(uuid) from public, anon;
revoke all on function public.create_session_link(uuid, text, integer, integer) from public, anon;
revoke all on function public.revoke_session_link(uuid) from public, anon;
revoke all on function public.redeem_session_link(text) from public, anon;
revoke all on function public.list_session_invites(uuid) from public, anon;
revoke all on function public.list_my_session_invitations() from public, anon;
revoke all on function public.list_sessions() from public, anon;
revoke all on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) from public;
grant execute on function public.create_session_series(text, text, text, double precision, double precision, timestamp, integer, text, text, integer, text, integer) to authenticated;
grant execute on function public.update_session(uuid, jsonb) to authenticated;
grant execute on function public.update_session_series(uuid, jsonb) to authenticated;
grant execute on function public.cancel_session_series(uuid) to authenticated;
grant execute on function public.invite_to_session(uuid, text, text) to authenticated;
grant execute on function public.revoke_session_invitation(uuid) to authenticated;
grant execute on function public.create_session_link(uuid, text, integer, integer) to authenticated;
grant execute on function public.revoke_session_link(uuid) to authenticated;
grant execute on function public.redeem_session_link(text) to authenticated;
grant execute on function public.list_session_invites(uuid) to authenticated;
grant execute on function public.list_my_session_invitations() to authenticated;
grant execute on function public.list_sessions() to authenticated;
grant execute on function public.list_public_sessions(double precision, double precision, double precision, timestamptz, timestamptz, text, integer, integer) to anon, authenticated;
