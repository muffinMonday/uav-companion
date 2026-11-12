-- Profile fields (account and profile milestone, phase D, AC-7).
--
-- A profile gains a preset avatar (a key from a fixed list: no upload, no Storage), a short bio, a typed location (text only, never GPS), up to five interest
-- tags from a fixed list, and one switch, share_profile, that shows or hides bio, location and interests to the people the owner interacts with: accepted
-- friends and joined members of the same shared trip. The display name and the avatar are shown to those same people whatever the switch says; a pending
-- request shows a name only. Nobody else sees anything, and no function here returns an email address or a user id.
--
-- Writes go only through update_profile (one function, one JSON patch: a key that is present is changed, null clears it). Reads go through ensure_profile
-- (your own profile), list_friends, list_trip_members and list_shared_trip_versions.
-- The lists of avatars and tags live in profile_avatars() and profile_interests(); src/avatars.js holds the same keys and the pictures. Keep them in step.

create function public.profile_avatars()
returns text[] language sql immutable set search_path = ''
as $$ select array[
  'fpv-5in', 'fpv-7in', 'fpv-cinewhoop', 'fpv-tinywhoop', 'fpv-toothpick', 'fpv-racer', 'fpv-wing',
  'photo-folding', 'photo-pro', 'photo-mini', 'photo-hex',
  'travel-compass', 'travel-mountain', 'travel-camera', 'travel-tent', 'travel-pin', 'travel-sun', 'travel-wave', 'travel-leaf', 'travel-plane'
] $$;

create function public.profile_interests()
returns text[] language sql immutable set search_path = ''
as $$ select array[
  'drone-photography', 'hiking', 'city-trips', 'beaches', 'mountains', 'food', 'history', 'wildlife', 'road-trips', 'night-sky', 'cycling', 'camping',
  'fpv-freestyle', 'fpv-racing', 'fpv-cinematic', 'fpv-long-range', 'fpv-bando', 'fpv-micro'
] $$;

-- Free text on one line: control characters become spaces, runs of spaces collapse, the ends are trimmed.
create function public.clean_text(p text)
returns text language sql immutable set search_path = ''
as $$ select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')) $$;

alter table public.profiles add column avatar text check (avatar is null or avatar = any (public.profile_avatars()));
alter table public.profiles add column bio text check (bio is null or char_length(bio) between 1 and 160);
alter table public.profiles add column location text check (location is null or char_length(location) between 1 and 60);
alter table public.profiles add column interests text[] not null default '{}' check (cardinality(interests) <= 5 and interests <@ public.profile_interests());
alter table public.profiles add column share_profile boolean not null default true;

-- Your own profile, created on first use; a name may be given. Now with the new fields.
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
  return jsonb_build_object('display_name', prof.display_name, 'friend_code', prof.friend_code, 'accepts_requests', prof.accepts_requests, 'show_online', prof.show_online,
                            'avatar', prof.avatar, 'bio', prof.bio, 'location', prof.location, 'interests', to_jsonb(prof.interests), 'share_profile', prof.share_profile);
end;
$$;

-- Changes your profile. The patch is a JSON object; a key that is present is applied, null (or an empty string, or an empty list) clears it:
--   display_name (1 to 40), avatar (a key of profile_avatars), bio (up to 160), location (up to 60), interests (up to 5 keys of profile_interests), share_profile (true or false).
-- Anything else is refused, and so is a bad value: nothing is changed unless the whole patch is good. Returns your profile.
create function public.update_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  k text;
  v jsonb;
  s text;
  list text[];
  nm text; av text; bi text; lo text; it text[]; sh boolean;
  has_nm boolean := false; has_av boolean := false; has_bi boolean := false; has_lo boolean := false; has_it boolean := false; has_sh boolean := false;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'a profile change must be an object'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('display_name', 'avatar', 'bio', 'location', 'interests', 'share_profile') then raise exception 'unknown profile field: %', left(k, 40); end if;
  end loop;

  if p_patch ? 'display_name' then
    v := p_patch->'display_name';
    if jsonb_typeof(v) <> 'string' then raise exception 'a display name must be 1 to 40 characters'; end if;
    nm := public.clean_display_name(v #>> '{}');
    if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'a display name must be 1 to 40 characters'; end if;
    has_nm := true;
  end if;
  if p_patch ? 'avatar' then
    v := p_patch->'avatar';
    if jsonb_typeof(v) = 'string' then
      av := v #>> '{}';
      if not (av = any (public.profile_avatars())) then raise exception 'that avatar is not in the list'; end if;
    elsif jsonb_typeof(v) <> 'null' then raise exception 'that avatar is not in the list'; end if;
    has_av := true;
  end if;
  if p_patch ? 'bio' then
    v := p_patch->'bio';
    if jsonb_typeof(v) = 'string' then
      bi := nullif(public.clean_text(v #>> '{}'), '');
      if char_length(coalesce(bi, '')) > 160 then raise exception 'a bio can be at most 160 characters'; end if;
    elsif jsonb_typeof(v) <> 'null' then raise exception 'a bio must be text'; end if;
    has_bi := true;
  end if;
  if p_patch ? 'location' then
    v := p_patch->'location';
    if jsonb_typeof(v) = 'string' then
      lo := nullif(public.clean_text(v #>> '{}'), '');
      if char_length(coalesce(lo, '')) > 60 then raise exception 'a location can be at most 60 characters'; end if;
    elsif jsonb_typeof(v) <> 'null' then raise exception 'a location must be text'; end if;
    has_lo := true;
  end if;
  if p_patch ? 'interests' then
    v := p_patch->'interests';
    if jsonb_typeof(v) = 'array' then
      it := '{}';
      for s in select jsonb_array_elements(v) #>> '{}' loop
        if s is null or not (s = any (public.profile_interests())) then raise exception 'that interest is not in the list'; end if;
        if not (s = any (it)) then it := it || s; end if;
      end loop;
      if cardinality(it) > 5 then raise exception 'choose up to 5 interests'; end if;
    elsif jsonb_typeof(v) = 'null' then it := '{}';
    else raise exception 'interests must be a list'; end if;
    has_it := true;
  end if;
  if p_patch ? 'share_profile' then
    v := p_patch->'share_profile';
    if jsonb_typeof(v) <> 'boolean' then raise exception 'share_profile must be true or false'; end if;
    sh := (v #>> '{}')::boolean; has_sh := true;
  end if;

  perform public.ensure_profile();
  update public.profiles set
    display_name = case when has_nm then nm else display_name end,
    avatar = case when has_av then av else avatar end,
    bio = case when has_bi then bi else bio end,
    location = case when has_lo then lo else location end,
    interests = case when has_it then it else interests end,
    share_profile = case when has_sh then sh else share_profile end,
    updated_at = now()
  where user_id = uid;
  return public.ensure_profile();
end;
$$;

-- Friends and requests. The avatar, bio, location and interests of an accepted friend come with each row (bio, location and interests only when that friend shares them).
drop function public.list_friends();
create function public.list_friends()
returns table (id uuid, display_name text, status text, since timestamptz, online boolean, last_seen timestamptz, avatar text, bio text, location text, interests text[])
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
           case when f.status = 'accepted' and mine and p.show_online then p.last_seen else null end,
           case when f.status = 'accepted' then p.avatar else null end,
           case when f.status = 'accepted' and p.share_profile then p.bio else null end,
           case when f.status = 'accepted' and p.share_profile then p.location else null end,
           case when f.status = 'accepted' and p.share_profile then p.interests else '{}'::text[] end
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = uid then f.addressee else f.requester end
     where uid in (f.requester, f.addressee)
     order by case when f.status = 'accepted' then 2 when f.requester = uid then 1 else 0 end, lower(p.display_name), f.id;
end;
$$;

-- Who is in a trip. A joined member's avatar and, when they share it, bio, location and interests come with the row; your own row always has everything.
drop function public.list_trip_members(uuid);
create function public.list_trip_members(p_trip uuid)
returns table (member_id uuid, display_name text, role text, status text, is_me boolean, since timestamptz, online boolean, last_seen timestamptz, avatar text, bio text, location text, interests text[])
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
           case when m.status = 'joined' and (m.user_id = uid or (mine and p.show_online)) then p.last_seen else null end,
           case when m.status = 'joined' then p.avatar else null end,
           case when m.status = 'joined' and (m.user_id = uid or p.share_profile) then p.bio else null end,
           case when m.status = 'joined' and (m.user_id = uid or p.share_profile) then p.location else null end,
           case when m.status = 'joined' and (m.user_id = uid or p.share_profile) then coalesce(p.interests, '{}'::text[]) else '{}'::text[] end
      from public.trip_members m left join public.profiles p on p.user_id = m.user_id
     where m.trip_id = p_trip
     order by case m.role when 'owner' then 0 else 1 end, case m.status when 'joined' then 0 else 1 end, lower(coalesce(p.display_name, '')), m.id;
end;
$$;

-- The earlier versions of a shared trip, newest first, for a joined member, with the editor's avatar.
drop function public.list_shared_trip_versions(uuid);
create function public.list_shared_trip_versions(p_trip uuid)
returns table (rev bigint, updated_at timestamptz, updated_by_name text, markers integer, updated_by_avatar text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  return query
    select v.rev, v.updated_at, coalesce(p.display_name, 'Someone'), v.markers, p.avatar
      from public.shared_trip_versions v left join public.profiles p on p.user_id = v.updated_by
     where v.trip_id = p_trip order by v.rev desc;
end;
$$;

-- The internal helpers are not part of the API.
revoke all on function public.profile_avatars() from public, anon, authenticated;
revoke all on function public.profile_interests() from public, anon, authenticated;
revoke all on function public.clean_text(text) from public, anon, authenticated;
revoke all on function public.update_profile(jsonb) from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.list_trip_members(uuid) from public, anon;
revoke all on function public.list_shared_trip_versions(uuid) from public, anon;
grant execute on function public.update_profile(jsonb) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.list_trip_members(uuid) to authenticated;
grant execute on function public.list_shared_trip_versions(uuid) to authenticated;
