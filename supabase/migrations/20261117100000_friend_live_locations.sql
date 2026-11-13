-- Live locations for friends, and an online count for each shared trip (automatic location sharing).
--
-- 1. A person may share their position with all their accepted friends (one row per person, latest position only, no history), the same way they share it with the
--    party of a trip. The rules match the trip positions: at most one position every 2 s from the device that holds the row, a new device takes over with p_claim,
--    a position older than 2 minutes is not shown and one older than 10 minutes is deleted. A friend is shown only while the friendship is accepted when the
--    positions are read, so removing or blocking a friend hides the person at once.
--    Security: row-level security is on and there is no policy; everything goes through the functions below (security definer, search_path empty, authenticated only).
--    Nothing returned carries a user id: a friend is named by the friendship id from list_friends, which is also what list_progression takes (kind 'friend').
--    A friend who is also a joined member of one of the caller's trips and is sharing there is left out here, because the app shows that person as party.
-- 2. list_my_trips gains online_others: how many other joined members of the trip are online now (seen within 75 s; only counted when both sides show their
--    online status, the rule of list_trip_members). The app uses it to decide when to start sharing automatically.
-- 3. stop_all_sharing also removes the caller's friend position (for this device). delete_profile removes it. delete_account removes it through the
--    foreign key (on delete cascade).

create table public.friend_live_locations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  accuracy real check (accuracy is null or (accuracy >= 0 and accuracy <= 100000)),
  device text check (device is null or char_length(device) between 1 and 64),
  updated_at timestamptz not null default now()
);
create index friend_live_locations_updated on public.friend_live_locations (updated_at);
comment on table public.friend_live_locations is 'The latest position of a person who is sharing their location with their friends; one row per person, deleted when sharing stops.';
alter table public.friend_live_locations enable row level security;
revoke all on public.friend_live_locations from anon, authenticated;

-- Sends the caller's position to their friends. Returns { status: 'ok' | 'slow' | 'moved' | 'nofriends' }.
create function public.share_location_friends(p_lat double precision, p_lon double precision, p_accuracy double precision default null, p_device text default null, p_claim boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  last_at timestamptz;
  holder text;
  has_row boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -90 and 90) or not (p_lon between -180 and 180) then raise exception 'that is not a position'; end if;
  if p_accuracy is not null and not (p_accuracy between 0 and 100000) then p_accuracy := null; end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then raise exception 'that is not a device'; end if;
  if not exists (select 1 from public.friendships f where f.status = 'accepted' and uid in (f.requester, f.addressee)) then
    delete from public.friend_live_locations where user_id = uid;
    return jsonb_build_object('status', 'nofriends');
  end if;
  select updated_at, device, true into last_at, holder, has_row from public.friend_live_locations where user_id = uid;
  if coalesce(has_row, false) and p_device is not null and holder is not null and holder <> p_device and not coalesce(p_claim, false) then
    return jsonb_build_object('status', 'moved');
  end if;
  if last_at is not null and last_at > now() - interval '2 seconds' and (p_device is null or holder is null or holder = p_device) then return jsonb_build_object('status', 'slow'); end if;
  insert into public.friend_live_locations (user_id, lat, lon, accuracy, device, updated_at) values (uid, p_lat, p_lon, p_accuracy, p_device, now())
    on conflict (user_id) do update set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, device = excluded.device, updated_at = excluded.updated_at;
  if exists (select 1 from public.friend_live_locations where updated_at < now() - interval '10 minutes') then
    delete from public.friend_live_locations where updated_at < now() - interval '10 minutes';
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Stops sharing with friends (deletes the caller's position), unless another device holds it.
create function public.stop_sharing_friends(p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.friend_live_locations where user_id = uid and (p_device is null or device is null or device = p_device);
  return jsonb_build_object('status', 'stopped');
end;
$$;

-- The positions of the caller's accepted friends who are sharing, updated within the last 2 minutes. member_id is the friendship id.
create function public.list_friend_live_locations()
returns table (member_id uuid, display_name text, lat double precision, lon double precision, accuracy real, updated_at timestamptz, age_seconds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select f.id, coalesce(p.display_name, 'Someone'), l.lat, l.lon, l.accuracy, l.updated_at, floor(extract(epoch from (now() - l.updated_at)))::int
      from public.friendships f
      join public.friend_live_locations l on l.user_id = case when f.requester = uid then f.addressee else f.requester end
      left join public.profiles p on p.user_id = l.user_id
     where f.status = 'accepted' and uid in (f.requester, f.addressee)
       and l.updated_at > now() - interval '2 minutes'
       and not exists (
         select 1 from public.live_locations pl
           join public.trip_members pm on pm.trip_id = pl.trip_id and pm.user_id = pl.user_id and pm.status = 'joined'
           join public.trip_members me on me.trip_id = pl.trip_id and me.user_id = uid and me.status = 'joined'
          where pl.user_id = l.user_id and pl.updated_at > now() - interval '2 minutes')
     order by lower(coalesce(p.display_name, '')), f.id;
end;
$$;

-- Stopping everything for this device also stops the friend position.
create or replace function public.stop_all_sharing(p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.live_locations where user_id = uid and (p_device is null or device is null or device = p_device);
  delete from public.friend_live_locations where user_id = uid and (p_device is null or device is null or device = p_device);
  return jsonb_build_object('status', 'stopped');
end;
$$;

-- list_my_trips with online_others (the rest is as in 20261115100000).
drop function public.list_my_trips();
create function public.list_my_trips()
returns table (id uuid, name text, role text, status text, owner_name text, rev bigint, members_rev bigint, markers integer, start_date text, end_date text, members integer, updated_at timestamptz, live_active integer, online_others integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mine boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select coalesce((select show_online from public.profiles where user_id = uid), true) into mine;
  return query
    select t.id, t.name, m.role, m.status, coalesce(p.display_name, 'Someone'), t.rev, t.members_rev, t.markers,
           t.start_date, t.end_date,
           (select count(*)::int from public.trip_members x where x.trip_id = t.id and x.status = 'joined'), t.updated_at,
           case when m.status = 'joined' then
             (select count(*)::int from public.live_locations l
                join public.trip_members lm on lm.trip_id = l.trip_id and lm.user_id = l.user_id and lm.status = 'joined'
               where l.trip_id = t.id and l.user_id <> uid and l.updated_at > now() - interval '2 minutes')
           else 0 end,
           case when m.status = 'joined' and mine then
             (select count(*)::int from public.trip_members x
                join public.profiles xp on xp.user_id = x.user_id
               where x.trip_id = t.id and x.status = 'joined' and x.user_id <> uid and xp.show_online and xp.last_seen > now() - interval '75 seconds')
           else 0 end
      from public.trip_members m
      join public.shared_trips t on t.id = m.trip_id
      left join public.profiles p on p.user_id = t.owner
     where m.user_id = uid
     order by m.status desc, t.updated_at desc, t.id;
end;
$$;

-- Deleting the profile (the account stays) removes the friend position too (otherwise as in 20261116120000).
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
  delete from public.session_rsvps where user_id = uid;
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

revoke all on function public.share_location_friends(double precision, double precision, double precision, text, boolean) from public, anon;
revoke all on function public.stop_sharing_friends(text) from public, anon;
revoke all on function public.list_friend_live_locations() from public, anon;
revoke all on function public.list_my_trips() from public, anon;
grant execute on function public.share_location_friends(double precision, double precision, double precision, text, boolean) to authenticated;
grant execute on function public.stop_sharing_friends(text) to authenticated;
grant execute on function public.list_friend_live_locations() to authenticated;
grant execute on function public.list_my_trips() to authenticated;
