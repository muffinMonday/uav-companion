-- Live locations of the party in a shared trip (phase 3 of trips with friends).
--
-- A party member who chooses to share their location (a switch per trip, off each time the app is opened) sends their position every few seconds; the rest of
-- the party sees it on the map. Only the latest position is kept (one row per person and trip, no history). A position older than 2 minutes is no longer shown
-- and one older than 10 minutes is deleted. Sharing stops by itself 24 hours after the trip's end date, and at once when the person leaves the trip, is removed,
-- or the trip is deleted.
--
-- Security: row-level security is on and there is no policy, so the table cannot be read or written directly; everything goes through the functions below.
-- Only joined party members can send a position for a trip or see the others' positions in it (someone only invited sees nothing). Positions are validated.
-- Nothing returned carries a user id.

create table public.live_locations (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  accuracy real check (accuracy is null or (accuracy >= 0 and accuracy <= 100000)),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index live_locations_user on public.live_locations (user_id);
comment on table public.live_locations is 'The latest position of a party member who is sharing their location; one row per person and trip, deleted when sharing stops.';
alter table public.live_locations enable row level security;
revoke all on public.live_locations from anon, authenticated;

-- Sends the caller's position for a trip (at most one every 2 s). Returns { status: 'ok' | 'slow' | 'ended' }.
create function public.share_location(p_trip uuid, p_lat double precision, p_lon double precision, p_accuracy double precision default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  endd text;
  last_at timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -90 and 90) or not (p_lon between -180 and 180) then raise exception 'that is not a position'; end if;
  if p_accuracy is not null and not (p_accuracy between 0 and 100000) then p_accuracy := null; end if;
  select doc->'trip'->>'endDate' into endd from public.shared_trips where id = p_trip;
  begin
    if endd ~ '^\d{4}-\d{2}-\d{2}$' and endd::date + 1 < (now() at time zone 'utc')::date then
      delete from public.live_locations where trip_id = p_trip and user_id = uid;
      return jsonb_build_object('status', 'ended');
    end if;
  exception when others then null; -- a date that cannot be read does not end anything
  end;
  select updated_at into last_at from public.live_locations where trip_id = p_trip and user_id = uid;
  if last_at is not null and last_at > now() - interval '2 seconds' then return jsonb_build_object('status', 'slow'); end if;
  insert into public.live_locations (trip_id, user_id, lat, lon, accuracy, updated_at) values (p_trip, uid, p_lat, p_lon, p_accuracy, now())
    on conflict (trip_id, user_id) do update set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, updated_at = excluded.updated_at;
  delete from public.live_locations where updated_at < now() - interval '10 minutes';
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Stops sharing in one trip (deletes the caller's position there).
create function public.stop_sharing_location(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.live_locations where trip_id = p_trip and user_id = uid;
  return jsonb_build_object('status', 'stopped');
end;
$$;

-- Stops sharing everywhere (signing out, closing the page).
create function public.stop_all_sharing()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.live_locations where user_id = uid;
  return jsonb_build_object('status', 'stopped');
end;
$$;

-- The positions the caller may see: other joined party members of the caller's own shared trips who are sharing, updated within the last 2 minutes.
-- member_id is the same id list_trip_members gives for that person in that trip.
create function public.list_live_locations()
returns table (trip_id uuid, member_id uuid, display_name text, lat double precision, lon double precision, accuracy real, updated_at timestamptz, age_seconds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select l.trip_id, m.id, coalesce(p.display_name, 'Someone'), l.lat, l.lon, l.accuracy, l.updated_at, floor(extract(epoch from (now() - l.updated_at)))::int
      from public.live_locations l
      join public.trip_members m on m.trip_id = l.trip_id and m.user_id = l.user_id and m.status = 'joined'
      left join public.profiles p on p.user_id = l.user_id
     where l.user_id <> uid
       and l.updated_at > now() - interval '2 minutes'
       and exists (select 1 from public.trip_members me where me.trip_id = l.trip_id and me.user_id = uid and me.status = 'joined')
     order by l.trip_id, lower(coalesce(p.display_name, '')), m.id;
end;
$$;

-- Leaving, or being removed, ends the sharing at once.
create or replace function public.leave_trip(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.trip_members where trip_id = p_trip and user_id = uid and role <> 'owner';
  if not found then raise exception 'not found'; end if;
  delete from public.live_locations where trip_id = p_trip and user_id = uid;
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'left');
end;
$$;

create or replace function public.remove_member(p_trip uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  victim uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.shared_trips where id = p_trip and owner = uid) then raise exception 'trip not found'; end if;
  select user_id into victim from public.trip_members where id = p_member and trip_id = p_trip and role <> 'owner';
  delete from public.trip_members where id = p_member and trip_id = p_trip and role <> 'owner';
  if not found then raise exception 'not found'; end if;
  delete from public.live_locations where trip_id = p_trip and user_id = victim;
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'removed');
end;
$$;

revoke all on function public.share_location(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.stop_sharing_location(uuid) from public, anon;
revoke all on function public.stop_all_sharing() from public, anon;
revoke all on function public.list_live_locations() from public, anon;
grant execute on function public.share_location(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.stop_sharing_location(uuid) to authenticated;
grant execute on function public.stop_all_sharing() to authenticated;
grant execute on function public.list_live_locations() to authenticated;
