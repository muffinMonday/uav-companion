-- Efficiency: cheaper polling calls and the missing indexes (from the efficiency review).
--
-- 1. A trip's start and end dates become columns of shared_trips. list_my_trips (polled every 10 s by every signed-in client) and share_location (every position
--    sent) used to read them from inside the trip document (up to 1 MB), which meant unpacking the whole document each time. They now read the columns.
--    The columns are set by share_trip and save_shared_trip, and filled in here for the trips that exist.
-- 2. list_my_trips also says, per trip, how many other party members are sharing their location now (live_active). The app looks for live positions only
--    while that is above zero, instead of every 5 s all the time. The count follows the same rule as list_live_locations (other joined members, within 2 minutes).
-- 3. share_location no longer scans the positions table on every call: the 10-minute clean-up runs only when there is something to delete, found through
--    an index on updated_at.
-- 4. Indexes for places that were scanned: positions by age, RSVPs and attendance by person, and the foreign keys that are
--    followed when an account is deleted.
--
-- No policy or grant changes. The functions keep their signatures except list_my_trips, which gains one column (dropped and created again, grants repeated).

alter table public.shared_trips add column start_date text, add column end_date text;
update public.shared_trips set start_date = doc->'trip'->>'startDate', end_date = doc->'trip'->>'endDate';

-- Starts sharing a trip (as before, plus the two dates).
create or replace function public.share_trip(p_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  begin
    tid := (p_doc->'trip'->>'id')::uuid;
  exception when others then
    raise exception 'this trip cannot be shared (its id is not valid)';
  end;
  perform public.check_trip_doc(p_doc, tid);
  if (select count(*) from public.shared_trips where owner = uid) >= 20 then raise exception 'you share the most trips you can (20)'; end if;
  if exists (select 1 from public.shared_trips where id = tid) then raise exception 'this trip is already shared'; end if;
  insert into public.shared_trips (id, owner, doc, name, markers, start_date, end_date, updated_by)
  values (tid, uid, p_doc, p_doc->'trip'->>'name', jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)), p_doc->'trip'->>'startDate', p_doc->'trip'->>'endDate', uid);
  insert into public.trip_members (trip_id, user_id, role, status, joined_at) values (tid, uid, 'owner', 'joined', now());
  return jsonb_build_object('id', tid, 'rev', 1);
end;
$$;

-- Saves the document (as before, plus the two dates).
create or replace function public.save_shared_trip(p_trip uuid, p_doc jsonb, p_base_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t public.shared_trips%rowtype;
  me text;
  new_rev bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  perform public.check_trip_doc(p_doc, p_trip);
  select * into t from public.shared_trips where id = p_trip for update;
  select display_name into me from public.profiles where user_id = uid;
  if p_base_rev is distinct from t.rev then
    return jsonb_build_object('status', 'conflict', 'rev', t.rev, 'updated_at', t.updated_at,
                              'updated_by_name', coalesce((select display_name from public.profiles where user_id = t.updated_by), 'Someone'));
  end if;
  insert into public.shared_trip_versions (trip_id, rev, doc, updated_at, updated_by, markers) values (t.id, t.rev, t.doc, t.updated_at, t.updated_by, t.markers);
  new_rev := t.rev + 1;
  update public.shared_trips
     set doc = p_doc, rev = new_rev, name = p_doc->'trip'->>'name', markers = jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)),
         start_date = p_doc->'trip'->>'startDate', end_date = p_doc->'trip'->>'endDate', updated_at = now(), updated_by = uid
   where id = t.id;
  delete from public.shared_trip_versions where trip_id = t.id and (updated_at < now() - interval '30 days' or rev <= new_rev - 20);
  return jsonb_build_object('status', 'ok', 'rev', new_rev, 'updated_at', now(), 'updated_by_name', coalesce(me, 'Someone'));
end;
$$;

-- The caller's shared trips and invitations: no document is read any more, and live_active says how many others are sharing their location in the trip now.
drop function public.list_my_trips();
create function public.list_my_trips()
returns table (id uuid, name text, role text, status text, owner_name text, rev bigint, members_rev bigint, markers integer, start_date text, end_date text, members integer, updated_at timestamptz, live_active integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select t.id, t.name, m.role, m.status, coalesce(p.display_name, 'Someone'), t.rev, t.members_rev, t.markers,
           t.start_date, t.end_date,
           (select count(*)::int from public.trip_members x where x.trip_id = t.id and x.status = 'joined'), t.updated_at,
           case when m.status = 'joined' then
             (select count(*)::int from public.live_locations l
                join public.trip_members lm on lm.trip_id = l.trip_id and lm.user_id = l.user_id and lm.status = 'joined'
               where l.trip_id = t.id and l.user_id <> uid and l.updated_at > now() - interval '2 minutes')
           else 0 end
      from public.trip_members m
      join public.shared_trips t on t.id = m.trip_id
      left join public.profiles p on p.user_id = t.owner
     where m.user_id = uid
     order by m.status desc, t.updated_at desc, t.id;
end;
$$;
revoke all on function public.list_my_trips() from public, anon;
grant execute on function public.list_my_trips() to authenticated;

-- Sending a position: the end date comes from the column, and the clean-up of old positions only runs when there are some (an index lookup finds out).
create or replace function public.share_location(p_trip uuid, p_lat double precision, p_lon double precision, p_accuracy double precision default null, p_device text default null, p_claim boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  endd text;
  last_at timestamptz;
  holder text;
  has_row boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -90 and 90) or not (p_lon between -180 and 180) then raise exception 'that is not a position'; end if;
  if p_accuracy is not null and not (p_accuracy between 0 and 100000) then p_accuracy := null; end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then raise exception 'that is not a device'; end if;
  select end_date into endd from public.shared_trips where id = p_trip;
  begin
    if endd ~ '^\d{4}-\d{2}-\d{2}$' and endd::date + 1 < (now() at time zone 'utc')::date then
      delete from public.live_locations where trip_id = p_trip and user_id = uid;
      return jsonb_build_object('status', 'ended');
    end if;
  exception when others then null; -- a date that cannot be read does not end anything
  end;
  select updated_at, device, true into last_at, holder, has_row from public.live_locations where trip_id = p_trip and user_id = uid;
  -- another device holds the row: only a device that has just started sharing may take it over
  if coalesce(has_row, false) and p_device is not null and holder is not null and holder <> p_device and not coalesce(p_claim, false) then
    return jsonb_build_object('status', 'moved');
  end if;
  -- the 2 s limit applies to the device that holds the row; a device taking over is not held back by the one it replaces
  if last_at is not null and last_at > now() - interval '2 seconds' and (p_device is null or holder is null or holder = p_device) then return jsonb_build_object('status', 'slow'); end if;
  insert into public.live_locations (trip_id, user_id, lat, lon, accuracy, updated_at, device) values (p_trip, uid, p_lat, p_lon, p_accuracy, now(), p_device)
    on conflict (trip_id, user_id) do update set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, updated_at = excluded.updated_at, device = excluded.device;
  if exists (select 1 from public.live_locations where updated_at < now() - interval '10 minutes') then
    delete from public.live_locations where updated_at < now() - interval '10 minutes';
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Indexes
create index live_locations_updated on public.live_locations (updated_at);
-- (the Steam queue index is in 20261115120000_steam_queue.sql)
create index session_rsvps_user on public.session_rsvps (user_id);
create index session_attendance_user on public.session_attendance (user_id);
-- foreign keys that are followed (set null) when an account is deleted
create index xp_ledger_actor on public.xp_ledger (actor) where actor is not null;
create index trip_members_invited_by on public.trip_members (invited_by) where invited_by is not null;
create index shared_trips_updated_by on public.shared_trips (updated_by) where updated_by is not null;
create index shared_trip_versions_updated_by on public.shared_trip_versions (updated_by) where updated_by is not null;
create index flight_sessions_created_by on public.flight_sessions (created_by) where created_by is not null;
create index session_attendance_verified_by on public.session_attendance (verified_by) where verified_by is not null;
create index session_attendance_revoked_by on public.session_attendance (revoked_by) where revoked_by is not null;
