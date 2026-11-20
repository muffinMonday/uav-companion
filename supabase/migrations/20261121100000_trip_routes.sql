-- Driving routes for shared trips: a normalized cache, kept out of shared_trips.doc (a route is up to tens of kilobytes; the document has a 1 MB cap and is merged
-- by every save), plus a small budget counter for the provider calls.
--
-- Who can do what:
--   * A joined member of a trip reads that trip's cached routes through get_trip_routes(). Nobody else can (an invited person, a stranger, a signed-out visitor).
--   * Routes are created only by the route-leg edge function, which calls route_begin() and route_store() with the service role and passes the verified caller.
--     Both check that the caller is a joined member of the trip and that the two end points are markers of that trip's document (never a Home marker, never an
--     arbitrary coordinate), BEFORE any coordinate is sent to the provider. The two functions cannot be called by the API roles.
--   * The tables have row-level security on and no policy, and no direct privilege for anon or authenticated.
-- A cached route belongs to (trip, leg_key); leg_key carries the marker ids, their coordinates to 5 decimals, the profile and the schema version, so a moved end
-- point is a different key. When a trip is saved, routes whose markers were deleted or moved are removed (trigger below); the other legs are left alone.

create table public.trip_routes (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  leg_key text not null check (char_length(leg_key) between 20 and 300),
  from_marker text not null check (char_length(from_marker) between 1 and 80),
  to_marker text not null check (char_length(to_marker) between 1 and 80),
  from_lat double precision not null check (from_lat between -90 and 90),
  from_lon double precision not null check (from_lon between -180 and 180),
  to_lat double precision not null check (to_lat between -90 and 90),
  to_lon double precision not null check (to_lon between -180 and 180),
  profile text not null check (profile = 'driving-car'),
  schema_version integer not null check (schema_version >= 1),
  geometry text not null check (char_length(geometry) between 4 and 60000 and geometry ~ '^[?-~]+$'),
  points integer not null check (points between 2 and 3000),
  distance_m double precision not null check (distance_m > 0 and distance_m <= 6000000),
  duration_s double precision not null check (duration_s >= 0 and duration_s <= 1209600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, leg_key)
);
create index trip_routes_trip_markers on public.trip_routes (trip_id, from_marker, to_marker);
comment on table public.trip_routes is 'Cached driving routes of shared trips (encoded polyline, distance, duration). One row per trip and leg key; written only by route_store().';

create table public.route_budget (
  bucket text primary key check (char_length(bucket) <= 80),
  n integer not null default 0 check (n >= 0),
  expires_at timestamptz not null
);
comment on table public.route_budget is 'Counters for provider calls: per user per day, all users per day, all users per minute. Written only by route_begin().';

alter table public.trip_routes enable row level security;
alter table public.route_budget enable row level security;
revoke all on public.trip_routes from anon, authenticated;
revoke all on public.route_budget from anon, authenticated;

-- Is p_user a joined member of the trip? Internal.
create function public.route_is_member(p_user uuid, p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select p_user is not null and exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_user and status = 'joined') $$;
revoke all on function public.route_is_member(uuid, uuid) from public, anon, authenticated;

-- Is this marker in the trip's document at these coordinates (to 5 decimals), and not a Home marker? Internal.
create function public.route_marker_ok(p_trip uuid, p_id text, p_lat double precision, p_lon double precision)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_trips t, jsonb_array_elements(coalesce(t.doc->'items', '[]'::jsonb)) e
     where t.id = p_trip
       and e->>'id' = p_id
       and coalesce(e->>'type', '') <> 'residence'
       and jsonb_typeof(e->'lat') = 'number' and jsonb_typeof(e->'lon') = 'number'
       and round((e->>'lat')::numeric, 5) = round(p_lat::numeric, 5)
       and round((e->>'lon')::numeric, 5) = round(p_lon::numeric, 5)
  )
$$;
revoke all on function public.route_marker_ok(uuid, text, double precision, double precision) from public, anon, authenticated;

-- The cached routes of a trip, for a joined member: [{ key, from, to, geometry, points, distance_m, duration_s }].
create function public.get_trip_routes(p_trip uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.route_is_member(uid, p_trip) then raise exception 'trip not found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', r.leg_key, 'from', r.from_marker, 'to', r.to_marker, 'geometry', r.geometry, 'points', r.points,
                                        'distance_m', r.distance_m, 'duration_s', r.duration_s) order by r.leg_key)
      from (select * from public.trip_routes where trip_id = p_trip order by updated_at desc, leg_key limit 600) r
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_trip_routes(uuid) from public, anon;
grant execute on function public.get_trip_routes(uuid) to authenticated;

-- Counts one provider call against a bucket; false when the bucket is full. Internal.
create function public.route_take(p_bucket text, p_limit integer, p_expires timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare got integer;
begin
  delete from public.route_budget where expires_at < now();
  insert into public.route_budget (bucket, n, expires_at) values (p_bucket, 1, p_expires)
  on conflict (bucket) do update set n = public.route_budget.n + 1 where public.route_budget.n < p_limit
  returning n into got;
  return got is not null;
end;
$$;
revoke all on function public.route_take(text, integer, timestamptz) from public, anon, authenticated;

-- The first step of a route request, for the edge function (service role). p_user is the caller the function verified from the session.
-- With a trip: the caller must be a joined member and both end points must be that trip's markers at those coordinates; a cached route for the key is
-- returned and costs no budget. Without a trip (a private trip: nothing is shared or cached on the server) only the budget applies.
-- On a miss one provider call is counted against three buckets (this user today, everyone today, everyone this minute); a full bucket raises 'budget'.
-- Returns { hit: true, route: {...} } or { hit: false }.
create function public.route_begin(
  p_user uuid, p_trip uuid, p_key text,
  p_from_id text, p_from_lat double precision, p_from_lon double precision,
  p_to_id text, p_to_lat double precision, p_to_lon double precision,
  p_user_day integer default 150, p_all_day integer default 1500, p_all_minute integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.trip_routes%rowtype;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_trip is not null then
    if not public.route_is_member(p_user, p_trip) then raise exception 'trip not found'; end if;
    if not public.route_marker_ok(p_trip, p_from_id, p_from_lat, p_from_lon) or not public.route_marker_ok(p_trip, p_to_id, p_to_lat, p_to_lon) then
      raise exception 'those points are not in this trip';
    end if;
    select * into r from public.trip_routes where trip_id = p_trip and leg_key = p_key;
    if found then
      return jsonb_build_object('hit', true, 'route', jsonb_build_object('key', r.leg_key, 'from', r.from_marker, 'to', r.to_marker, 'geometry', r.geometry,
                                'points', r.points, 'distance_m', r.distance_m, 'duration_s', r.duration_s));
    end if;
  end if;
  if not public.route_take('d:' || current_date::text || ':u:' || p_user::text, p_user_day, date_trunc('day', now()) + interval '2 days')
     or not public.route_take('d:' || current_date::text || ':all', p_all_day, date_trunc('day', now()) + interval '2 days')
     or not public.route_take('m:' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI') || ':all', p_all_minute, date_trunc('minute', now()) + interval '5 minutes') then
    raise exception 'budget' using errcode = 'P0429';
  end if;
  return jsonb_build_object('hit', false);
end;
$$;
revoke all on function public.route_begin(uuid, uuid, text, text, double precision, double precision, text, double precision, double precision, integer, integer, integer) from public, anon, authenticated;

-- Stores a route the provider returned, for the edge function (service role). The same checks as route_begin, then the shape of the route. A concurrent
-- duplicate is one row (upsert on the primary key). Routes of the same two markers under an older key (an end point moved) are replaced. A trip keeps at most 600.
create function public.route_store(
  p_user uuid, p_trip uuid, p_key text,
  p_from_id text, p_from_lat double precision, p_from_lon double precision,
  p_to_id text, p_to_lat double precision, p_to_lon double precision,
  p_profile text, p_schema integer, p_geometry text, p_points integer, p_distance double precision, p_duration double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_trip is null or not public.route_is_member(p_user, p_trip) then raise exception 'trip not found'; end if;
  if not public.route_marker_ok(p_trip, p_from_id, p_from_lat, p_from_lon) or not public.route_marker_ok(p_trip, p_to_id, p_to_lat, p_to_lon) then
    raise exception 'those points are not in this trip';
  end if;
  insert into public.trip_routes (trip_id, leg_key, from_marker, to_marker, from_lat, from_lon, to_lat, to_lon, profile, schema_version, geometry, points, distance_m, duration_s)
  values (p_trip, p_key, p_from_id, p_to_id, p_from_lat, p_from_lon, p_to_lat, p_to_lon, p_profile, p_schema, p_geometry, p_points, p_distance, p_duration)
  on conflict (trip_id, leg_key) do update
    set geometry = excluded.geometry, points = excluded.points, distance_m = excluded.distance_m, duration_s = excluded.duration_s, updated_at = now();
  delete from public.trip_routes where trip_id = p_trip and from_marker = p_from_id and to_marker = p_to_id and leg_key <> p_key;
  delete from public.trip_routes where trip_id = p_trip and leg_key in (
    select leg_key from public.trip_routes where trip_id = p_trip order by updated_at desc, leg_key offset 600);
  return jsonb_build_object('status', 'stored');
end;
$$;
revoke all on function public.route_store(uuid, uuid, text, text, double precision, double precision, text, double precision, double precision, text, integer, text, integer, double precision, double precision) from public, anon, authenticated;

-- When a shared trip's document is saved, routes whose markers were deleted, became a Home marker or moved are removed; every other route stays.
create function public.prune_trip_routes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.doc is not distinct from old.doc then return new; end if;
  delete from public.trip_routes r
   where r.trip_id = new.id
     and not (public.route_marker_ok(new.id, r.from_marker, r.from_lat, r.from_lon) and public.route_marker_ok(new.id, r.to_marker, r.to_lat, r.to_lon));
  return new;
end;
$$;
revoke all on function public.prune_trip_routes() from public, anon, authenticated;
create trigger shared_trips_prune_routes after update of doc on public.shared_trips for each row execute function public.prune_trip_routes();
