-- Profiles and friends (phase 2 of the backend).
--
-- A profile is a display name and a friend code. People find each other only through a friend code that its owner shares themselves: there is
-- no search and no public list of people. A friend request is accepted or declined by the person who received it; either side can end a
-- friendship; a person can block someone, which ends the friendship and stops further requests from them.
--
-- Security: row-level security is on for every table and there is no policy at all, so nobody can read or write a table directly (the API roles
-- have no table privileges). Everything goes through the functions below, which read the caller from auth.uid(). The functions never return
-- another person's user id (friendships and blocks are named by their own random ids), and a code that does not work gives the same answer
-- whatever the reason (no such code, your own code, requests switched off, blocked), so nothing can be learned by trying codes.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  friend_code text not null unique check (friend_code ~ '^[0-9a-f]{10}$'),
  accepts_requests boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'A display name and a friend code per person. Reached only through functions.';

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester <> addressee)
);
-- one row per pair of people, whichever of them asked
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_requester on public.friendships (requester);
create index friendships_addressee on public.friendships (addressee);
comment on table public.friendships is 'A request (pending) or a friendship (accepted) between two people.';

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker <> blocked),
  unique (blocker, blocked)
);
create index blocks_blocked on public.blocks (blocked);
comment on table public.blocks is 'Who a person has blocked. The blocked person is not told.';

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;

-- Whatever the platform grants by default, take it away. No policies: the tables are reached only through the functions.
revoke all on public.profiles from anon, authenticated;
revoke all on public.friendships from anon, authenticated;
revoke all on public.blocks from anon, authenticated;

-- A display name as stored: control characters removed, spaces tidied.
create function public.clean_display_name(p text)
returns text language sql immutable set search_path = ''
as $$ select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')) $$;

-- The caller's profile, created on first use. A name may be given (to create the profile with it, or to change it). Returns the profile.
create function public.ensure_profile(p_display_name text default null)
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
  return jsonb_build_object('display_name', prof.display_name, 'friend_code', prof.friend_code, 'accepts_requests', prof.accepts_requests);
end;
$$;

-- Switches whether people can send requests with the caller's code. Returns the profile.
create function public.set_accepts_requests(p_accepts boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_profile();
  update public.profiles set accepts_requests = coalesce(p_accepts, true), updated_at = now() where user_id = uid;
  return public.ensure_profile();
end;
$$;

-- A new friend code (the old one stops working). Requests already sent are not affected. Returns the profile.
create function public.regenerate_friend_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  code text;
  tries int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_profile();
  loop
    code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    begin
      update public.profiles set friend_code = code, updated_at = now() where user_id = uid;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 10 then raise exception 'could not create a friend code, try again'; end if;
    end;
  end loop;
  return public.ensure_profile();
end;
$$;

-- Sends a request to the owner of a friend code. Returns { status: 'pending' | 'friends', id }.
-- If that person had already asked the caller, the request is accepted instead. A code that does not work, for whatever reason, gives
-- one answer: 'that code was not found'.
create function public.request_friend(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  norm text := lower(regexp_replace(coalesce(p_code, ''), '[^0-9a-fA-F]', '', 'g'));
  target public.profiles%rowtype;
  fr public.friendships%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_profile();
  if length(norm) <> 10 then raise exception 'that code was not found'; end if;
  select * into target from public.profiles where friend_code = norm;
  if not found or target.user_id = uid or not target.accepts_requests
     or exists (select 1 from public.blocks where blocker = target.user_id and blocked = uid) then
    raise exception 'that code was not found';
  end if;
  if exists (select 1 from public.blocks where blocker = uid and blocked = target.user_id) then
    raise exception 'you have blocked this person; unblock them first';
  end if;

  select * into fr from public.friendships
   where least(requester, addressee) = least(uid, target.user_id) and greatest(requester, addressee) = greatest(uid, target.user_id);
  if found then
    if fr.status = 'accepted' then return jsonb_build_object('status', 'friends', 'id', fr.id); end if;
    if fr.requester = uid then return jsonb_build_object('status', 'pending', 'id', fr.id); end if;
    -- they asked first: accepting is what both want
    if (select count(*) from public.friendships where status = 'accepted' and uid in (requester, addressee)) >= 200 then
      raise exception 'you have reached the limit of 200 friends';
    end if;
    update public.friendships set status = 'accepted', responded_at = now() where id = fr.id;
    return jsonb_build_object('status', 'friends', 'id', fr.id);
  end if;

  if (select count(*) from public.friendships where requester = uid and status = 'pending') >= 50 then
    raise exception 'you have too many requests waiting; wait for answers or cancel some';
  end if;
  begin
    insert into public.friendships (requester, addressee, status) values (uid, target.user_id, 'pending') returning * into fr;
  exception when unique_violation then
    select * into fr from public.friendships
     where least(requester, addressee) = least(uid, target.user_id) and greatest(requester, addressee) = greatest(uid, target.user_id);
  end;
  return jsonb_build_object('status', case when fr.status = 'accepted' then 'friends' else 'pending' end, 'id', fr.id);
end;
$$;

-- Answers a request the caller received (the id comes from list_friends). Returns { status: 'friends' | 'declined' }.
create function public.respond_friend(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  fr public.friendships%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into fr from public.friendships where id = p_id and addressee = uid and status = 'pending';
  if not found then raise exception 'request not found'; end if;
  if p_accept then
    if (select count(*) from public.friendships where status = 'accepted' and uid in (requester, addressee)) >= 200 then
      raise exception 'you have reached the limit of 200 friends';
    end if;
    update public.friendships set status = 'accepted', responded_at = now() where id = fr.id;
    return jsonb_build_object('status', 'friends');
  end if;
  delete from public.friendships where id = fr.id;
  return jsonb_build_object('status', 'declined');
end;
$$;

-- Ends a friendship, cancels a request the caller sent, or (same thing) removes one they received. Either side may do it.
create function public.remove_friendship(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.friendships where id = p_id and uid in (requester, addressee);
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('status', 'removed');
end;
$$;

-- The caller's friends and requests: id (of the friendship), the other person's display name, status ('incoming', 'outgoing', 'friends'), since.
create function public.list_friends()
returns table (id uuid, display_name text, status text, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select f.id, p.display_name,
           case when f.status = 'accepted' then 'friends' when f.requester = uid then 'outgoing' else 'incoming' end,
           coalesce(f.responded_at, f.created_at)
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = uid then f.addressee else f.requester end
     where uid in (f.requester, f.addressee)
     order by case when f.status = 'accepted' then 2 when f.requester = uid then 1 else 0 end, lower(p.display_name), f.id;
end;
$$;

-- Blocks the other person in a friendship or request (by the friendship's id): it ends, and they cannot send another request.
create function public.block_user(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  fr public.friendships%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into fr from public.friendships where id = p_id and uid in (requester, addressee);
  if not found then raise exception 'not found'; end if;
  insert into public.blocks (blocker, blocked) values (uid, case when fr.requester = uid then fr.addressee else fr.requester end)
    on conflict (blocker, blocked) do nothing;
  delete from public.friendships where id = fr.id;
  return jsonb_build_object('status', 'blocked');
end;
$$;

create function public.list_blocked()
returns table (id uuid, display_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select b.id, coalesce(p.display_name, 'Someone'), b.created_at
      from public.blocks b left join public.profiles p on p.user_id = b.blocked
     where b.blocker = uid order by b.created_at desc, b.id;
end;
$$;

create function public.unblock(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.blocks where id = p_id and blocker = uid;
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('status', 'unblocked');
end;
$$;

-- Deletes the caller's profile, friendships and blocks (the cloud copy of markers and trips is separate: delete_user_data).
create function public.delete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  delete from public.profiles where user_id = uid;
  return jsonb_build_object('status', 'deleted');
end;
$$;

-- Only signed-in users may call them; the helper is internal.
revoke all on function public.clean_display_name(text) from public, anon, authenticated;
revoke all on function public.ensure_profile(text) from public, anon;
revoke all on function public.set_accepts_requests(boolean) from public, anon;
revoke all on function public.regenerate_friend_code() from public, anon;
revoke all on function public.request_friend(text) from public, anon;
revoke all on function public.respond_friend(uuid, boolean) from public, anon;
revoke all on function public.remove_friendship(uuid) from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.list_blocked() from public, anon;
revoke all on function public.unblock(uuid) from public, anon;
revoke all on function public.delete_profile() from public, anon;
grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.set_accepts_requests(boolean) to authenticated;
grant execute on function public.regenerate_friend_code() to authenticated;
grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.list_blocked() to authenticated;
grant execute on function public.unblock(uuid) to authenticated;
grant execute on function public.delete_profile() to authenticated;
