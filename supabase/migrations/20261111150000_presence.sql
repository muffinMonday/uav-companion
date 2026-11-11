-- Online status (phase 2 of trips with friends).
--
-- A signed-in app tells the server every 30 s or so that it is open (touch_presence). A friend, or someone in the same shared trip, sees "online" when that
-- was within the last 75 seconds, and otherwise "last seen" with the time. Each person can switch it off (set_show_online): then nothing about them is recorded
-- or shown, and they cannot see anyone else's status either, so hiding yours is never a one-way mirror.
--
-- Who sees whom: a friend (accepted friendship) in list_friends, and a joined party member of a shared trip in list_trip_members. Someone with only a pending
-- friend request or an invitation sees nothing. A person always sees their own status. Nothing here returns a user id.

alter table public.profiles add column last_seen timestamptz;
alter table public.profiles add column show_online boolean not null default true;

-- The profile now also says whether the caller shows their status.
create or replace function public.ensure_profile(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  name text := public.clean_display_name(p_display_name);
  prof public.profiles%rowtype;
  code text;
  tries int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_display_name is not null and (char_length(name) < 1 or char_length(name) > 40) then
    raise exception 'a display name must be 1 to 40 characters';
  end if;
  select * into prof from public.profiles where user_id = uid;
  if not found then
    loop
      code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      begin
        insert into public.profiles (user_id, display_name, friend_code)
        values (uid, coalesce(nullif(name, ''), 'Pilot'), code)
        returning * into prof;
        exit;
      exception when unique_violation then
        tries := tries + 1;
        if tries > 10 then raise exception 'could not create a friend code, try again'; end if;
      end;
    end loop;
  elsif p_display_name is not null then
    update public.profiles set display_name = name, updated_at = now() where user_id = uid returning * into prof;
  end if;
  return jsonb_build_object('display_name', prof.display_name, 'friend_code', prof.friend_code, 'accepts_requests', prof.accepts_requests, 'show_online', prof.show_online);
end;
$$;

-- "I am here": records the time (at most every 15 s). Does nothing for someone who has no profile yet or who hides their status.
create function public.touch_presence()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  shown boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select show_online into shown from public.profiles where user_id = uid;
  if not found then return jsonb_build_object('status', 'no profile'); end if;
  if not shown then return jsonb_build_object('status', 'hidden'); end if;
  update public.profiles set last_seen = now() where user_id = uid and (last_seen is null or last_seen < now() - interval '15 seconds');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Shows or hides the caller's status. Hiding forgets the last time; showing starts with now. Returns the profile.
create function public.set_show_online(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_profile();
  update public.profiles set show_online = coalesce(p_on, true), last_seen = case when coalesce(p_on, true) then now() else null end, updated_at = now() where user_id = uid;
  return public.ensure_profile();
end;
$$;

-- Friends and requests with each friend's status (online and last_seen are null for requests, for a friend who hides theirs, and for everyone when the caller hides theirs).
drop function public.list_friends();
create function public.list_friends()
returns table (id uuid, display_name text, status text, since timestamptz, online boolean, last_seen timestamptz)
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
    select f.id, p.display_name,
           case when f.status = 'accepted' then 'friends' when f.requester = uid then 'outgoing' else 'incoming' end,
           coalesce(f.responded_at, f.created_at),
           case when f.status = 'accepted' and mine and p.show_online then coalesce(p.last_seen > now() - interval '75 seconds', false) else null end,
           case when f.status = 'accepted' and mine and p.show_online then p.last_seen else null end
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = uid then f.addressee else f.requester end
     where uid in (f.requester, f.addressee)
     order by case when f.status = 'accepted' then 2 when f.requester = uid then 1 else 0 end, lower(p.display_name), f.id;
end;
$$;

-- Who is in a trip, with each joined member's status (the caller's own is always shown; others only when both sides show theirs).
drop function public.list_trip_members(uuid);
create function public.list_trip_members(p_trip uuid)
returns table (member_id uuid, display_name text, role text, status text, is_me boolean, since timestamptz, online boolean, last_seen timestamptz)
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
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  select coalesce((select show_online from public.profiles where user_id = uid), true) into mine;
  return query
    select m.id, coalesce(p.display_name, 'Someone'), m.role, m.status, m.user_id = uid, coalesce(m.joined_at, m.created_at),
           case when m.status = 'joined' and (m.user_id = uid or (mine and p.show_online)) then coalesce(p.last_seen > now() - interval '75 seconds', false) else null end,
           case when m.status = 'joined' and (m.user_id = uid or (mine and p.show_online)) then p.last_seen else null end
      from public.trip_members m left join public.profiles p on p.user_id = m.user_id
     where m.trip_id = p_trip
     order by case m.role when 'owner' then 0 else 1 end, case m.status when 'joined' then 0 else 1 end, lower(coalesce(p.display_name, '')), m.id;
end;
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.set_show_online(boolean) from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.list_trip_members(uuid) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_show_online(boolean) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.list_trip_members(uuid) to authenticated;
