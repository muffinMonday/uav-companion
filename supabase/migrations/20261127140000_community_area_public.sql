-- Community Flying Areas, Phase 4: public discovery (read-only) and the optional contributor-attribution preference.
--
--   * profiles.community_attribution boolean not null default false: "Show my name and avatar on approved community areas". Separate from share_profile and show_online,
--     OFF for every existing and new account. It is part of the owner's own profile (ensure_profile / update_profile); nobody else's lists carry it.
--   * list_public_areas(bounds, cursor, limit) and get_public_area(area_id): the ONLY public reads. Callable by anon and authenticated. They return an area only while its
--     CURRENT published revision (community_areas.published_revision_id, same area, status approved) is live (unpublished_at is null). The record is built on the server from that
--     pointer; no client value chooses a revision. No owner, contributor, reviewer, moderation or XP value is ever returned. `attribution` is null unless the contributor of that
--     revision has community_attribution = true, and then it is only { display_name, avatar }.
--   * Bounds: { west, south, east, north } in degrees; west > east means the box crosses the antimeridian (areas never do, see core.js). Rows are matched on the server-derived
--     bounding box (community_areas.bbox_*, index community_areas_bbox), so a polygon whose box meets the viewport but whose outline does not is returned (documented false
--     positive; the client filters exactly). A box wider or taller than 12 degrees is refused (bounds_too_large): the app does not ask for a country-wide view.
--   * Paging: keyset on the area id, 50 rows by default, at most 100 (a larger limit is cut to 100). The cursor is the last area id of the previous page; next_cursor is null on the last page.
-- Errors: invalid_bounds, bounds_too_large, invalid_cursor, invalid_limit, invalid_area_id (22023).

alter table public.profiles add column community_attribution boolean not null default false;

-- Your own profile now carries community_attribution (the previous body is 20261113110000_profile_named.sql).

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
        insert into public.profiles (user_id, display_name, friend_code, named)
        values (uid, coalesce(nullif(name, ''), 'Pilot'), code, nullif(name, '') is not null)
        returning * into prof;
        exit;
      exception when unique_violation then
        tries := tries + 1;
        if tries > 10 then raise exception 'could not create a friend code, try again'; end if;
      end;
    end loop;
  elsif p_display_name is not null then
    update public.profiles set display_name = name, named = true, updated_at = now() where user_id = uid returning * into prof;
  end if;
  return jsonb_build_object('display_name', prof.display_name, 'friend_code', prof.friend_code, 'accepts_requests', prof.accepts_requests, 'show_online', prof.show_online,
                            'avatar', prof.avatar, 'bio', prof.bio, 'location', prof.location, 'interests', to_jsonb(prof.interests), 'share_profile', prof.share_profile,
                            'named', prof.named, 'community_attribution', prof.community_attribution);
end;
$$;

create or replace function public.update_profile(p_patch jsonb)
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
  nm text; av text; bi text; lo text; it text[]; sh boolean; ca boolean;
  has_nm boolean := false; has_av boolean := false; has_bi boolean := false; has_lo boolean := false; has_it boolean := false; has_sh boolean := false; has_ca boolean := false;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'a profile change must be an object'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('display_name', 'avatar', 'bio', 'location', 'interests', 'share_profile', 'community_attribution') then raise exception 'unknown profile field: %', left(k, 40); end if;
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

  if p_patch ? 'community_attribution' then
    v := p_patch->'community_attribution';
    if jsonb_typeof(v) <> 'boolean' then raise exception 'community_attribution must be true or false'; end if;
    ca := (v #>> '{}')::boolean; has_ca := true;
  end if;

  perform public.ensure_profile();
  update public.profiles set
    display_name = case when has_nm then nm else display_name end,
    avatar = case when has_av then av else avatar end,
    bio = case when has_bi then bi else bio end,
    location = case when has_lo then lo else location end,
    interests = case when has_it then it else interests end,
    share_profile = case when has_sh then sh else share_profile end,
    community_attribution = case when has_ca then ca else community_attribution end,
    updated_at = now()
  where user_id = uid;
  return public.ensure_profile();
end;
$$;

-- One public record, or null when the area is not currently approved AND published. Internal: no client role may call it.
create function public.community_area_public_item(p_area_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'area_id', a.id, 'revision_id', r.id, 'status', 'approved', 'published', true,
    'name', r.name, 'description', r.description, 'geometry', r.geometry, 'spots', r.spots, 'area_m2', r.area_m2,
    'approved_at', r.reviewed_at,
    'attribution', case when p.user_id is not null and p.community_attribution then jsonb_build_object('display_name', p.display_name, 'avatar', p.avatar) else null end)
  from public.community_areas a
  join public.community_area_revisions r on r.id = a.published_revision_id and r.area_id = a.id and r.status = 'approved'
  left join public.profiles p on p.user_id = r.contributor_id
  where a.id = p_area_id and a.published_revision_id is not null and a.unpublished_at is null
    and jsonb_typeof(r.geometry) = 'object' and r.geometry ->> 'type' = 'Polygon' and r.reviewed_at is not null;
$$;

create function public.get_public_area(p_area_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_area_id is null then raise exception 'invalid_area_id' using errcode = '22023'; end if;
  return public.community_area_public_item(p_area_id);
end;
$$;

create function public.list_public_areas(p_bounds jsonb, p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w double precision; s double precision; e double precision; n double precision;
  cur uuid := null;
  lim integer;
  ids uuid[];
  more boolean;
  items jsonb;
begin
  if p_bounds is null or jsonb_typeof(p_bounds) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_bounds) k where k not in ('west', 'south', 'east', 'north'))
     or coalesce(jsonb_typeof(p_bounds -> 'west'), '') <> 'number' or coalesce(jsonb_typeof(p_bounds -> 'south'), '') <> 'number'
     or coalesce(jsonb_typeof(p_bounds -> 'east'), '') <> 'number' or coalesce(jsonb_typeof(p_bounds -> 'north'), '') <> 'number' then
    raise exception 'invalid_bounds' using errcode = '22023';
  end if;
  w := (p_bounds ->> 'west')::double precision; s := (p_bounds ->> 'south')::double precision;
  e := (p_bounds ->> 'east')::double precision; n := (p_bounds ->> 'north')::double precision;
  if w not between -180 and 180 or e not between -180 and 180 or s not between -90 and 90 or n not between -90 and 90 or s > n then
    raise exception 'invalid_bounds' using errcode = '22023';
  end if;
  if n - s > 12 or (case when w <= e then e - w else e - w + 360 end) > 12 then raise exception 'bounds_too_large' using errcode = '22023'; end if;
  if p_cursor is not null then
    if p_cursor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_cursor' using errcode = '22023'; end if;
    cur := p_cursor::uuid;
  end if;
  if p_limit is null then lim := 50;
  elsif p_limit < 1 then raise exception 'invalid_limit' using errcode = '22023';
  else lim := least(p_limit, 100); end if;

  select array_agg(id order by id) into ids from (
    select a.id from public.community_areas a
    join public.community_area_revisions r on r.id = a.published_revision_id and r.area_id = a.id and r.status = 'approved'
    where a.published_revision_id is not null and a.unpublished_at is null
      and a.bbox_north >= s and a.bbox_south <= n
      and (case when w <= e then a.bbox_east >= w and a.bbox_west <= e else a.bbox_east >= w or a.bbox_west <= e end)
      and (cur is null or a.id > cur)
    order by a.id
    limit lim + 1) q;
  ids := coalesce(ids, '{}');
  more := cardinality(ids) > lim;
  if more then ids := ids[1:lim]; end if;
  select coalesce(jsonb_agg(i order by (i ->> 'area_id')), '[]'::jsonb) into items
    from (select public.community_area_public_item(x) as i from unnest(ids) x) t where i is not null;
  return jsonb_build_object('areas', items, 'next_cursor', case when more then ids[cardinality(ids)]::text else null end);
end;
$$;

revoke all on function public.community_area_public_item(uuid) from public, anon, authenticated;
revoke all on function public.get_public_area(uuid) from public, anon, authenticated;
revoke all on function public.list_public_areas(jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.get_public_area(uuid) to anon, authenticated;
grant execute on function public.list_public_areas(jsonb, text, integer) to anon, authenticated;
