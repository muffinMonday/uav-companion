-- Community Flying Areas, Explorer: a paginated public list of approved, currently published areas for the Explore tab, beyond the map viewport.
--
--   explore_public_areas(p_filter, p_limit, p_offset): callable by anon and authenticated, read-only. Same eligibility as list_public_areas (the area's CURRENT published revision,
--   approved, not unpublished); nothing pending, rejected, withdrawn or unpublished is reachable. Returns only summary fields: area_id, name, area_m2, spot_count, approved_at, the
--   centre of the server-derived bounding box and, when a centre was given, the distance to it. No owner, contributor, reviewer, moderation, XP or attribution value is returned
--   (the full record, with optional attribution, is get_public_area).
--   p_filter (all keys optional, unknown keys refused): query (text, 1 to 60 characters, matched anywhere in the name, case-insensitive, wildcards escaped),
--   center { lat, lng } (distance and order by distance), radius_km (1 to 500, needs center).
--   Order: nearest first when a centre is given, else most recently approved first; ties by id so pages are stable.
--   Paging: p_limit 1 to 50 (default 20, a larger value is cut to 50), p_offset 0 to 500 (anything larger is refused: a person who has not found it in 550 results refines the search).
--   The result is { areas, has_more }.
-- Errors (22023): invalid_filter, invalid_query, invalid_center, invalid_radius, invalid_limit, invalid_offset.

create function public.explore_public_areas(p_filter jsonb default '{}'::jsonb, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  qtext text := null;
  pat text := null;
  clat double precision := null;
  clng double precision := null;
  rad double precision := null;
  lim integer;
  off integer;
  rows jsonb;
  cnt integer;
begin
  if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_object_keys(f) k where k not in ('query', 'center', 'radius_km')) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if f ? 'query' and jsonb_typeof(f -> 'query') <> 'null' then
    if jsonb_typeof(f -> 'query') <> 'string' then raise exception 'invalid_query' using errcode = '22023'; end if;
    qtext := btrim(f ->> 'query');
    if char_length(qtext) > 60 then raise exception 'invalid_query' using errcode = '22023'; end if;
    if qtext = '' then qtext := null; end if;
    if qtext is not null then pat := '%' || replace(replace(replace(qtext, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  end if;
  if f ? 'center' and jsonb_typeof(f -> 'center') <> 'null' then
    if jsonb_typeof(f -> 'center') <> 'object' or exists (select 1 from jsonb_object_keys(f -> 'center') k where k not in ('lat', 'lng'))
       or coalesce(jsonb_typeof(f -> 'center' -> 'lat'), '') <> 'number' or coalesce(jsonb_typeof(f -> 'center' -> 'lng'), '') <> 'number' then
      raise exception 'invalid_center' using errcode = '22023';
    end if;
    clat := (f -> 'center' ->> 'lat')::double precision; clng := (f -> 'center' ->> 'lng')::double precision;
    if clat not between -90 and 90 or clng not between -180 and 180 then raise exception 'invalid_center' using errcode = '22023'; end if;
  end if;
  if f ? 'radius_km' and jsonb_typeof(f -> 'radius_km') <> 'null' then
    if clat is null or jsonb_typeof(f -> 'radius_km') <> 'number' then raise exception 'invalid_radius' using errcode = '22023'; end if;
    rad := (f ->> 'radius_km')::double precision;
    if rad < 1 or rad > 500 then raise exception 'invalid_radius' using errcode = '22023'; end if;
  end if;
  if p_limit is null then lim := 20;
  elsif p_limit < 1 then raise exception 'invalid_limit' using errcode = '22023';
  else lim := least(p_limit, 50); end if;
  if p_offset is null then off := 0;
  elsif p_offset < 0 or p_offset > 500 then raise exception 'invalid_offset' using errcode = '22023';
  else off := p_offset; end if;

  with base as (
    select a.id, r.name, r.area_m2, r.reviewed_at,
           case when jsonb_typeof(r.spots) = 'array' then jsonb_array_length(r.spots) else 0 end as spot_count,
           (a.bbox_south + a.bbox_north) / 2 as lat, (a.bbox_west + a.bbox_east) / 2 as lng
    from public.community_areas a
    join public.community_area_revisions r on r.id = a.published_revision_id and r.area_id = a.id and r.status = 'approved'
    where a.published_revision_id is not null and a.unpublished_at is null and r.reviewed_at is not null
      and jsonb_typeof(r.geometry) = 'object' and r.geometry ->> 'type' = 'Polygon'
      and (pat is null or r.name ilike pat escape '\')
      and (rad is null or (a.bbox_north >= clat - rad / 111.2 and a.bbox_south <= clat + rad / 111.2))
  ), measured as (
    select b.*, case when clat is null then null else
      2 * 6371.0088 * asin(least(1, sqrt(power(sin(radians(b.lat - clat) / 2), 2) + cos(radians(clat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - clng) / 2), 2)))) end as km
    from base b
  ), page as (
    select * from measured m
    where rad is null or m.km <= rad
    order by (case when clat is null then null else m.km end) asc nulls last, m.reviewed_at desc, m.id
    limit lim + 1 offset off
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'area_id', p.id, 'name', p.name, 'area_m2', p.area_m2, 'spot_count', p.spot_count, 'approved_at', p.reviewed_at,
      'center', jsonb_build_object('lat', round(p.lat::numeric, 4), 'lng', round(p.lng::numeric, 4)),
      'distance_km', case when p.km is null then null else round(p.km::numeric, 1) end)
    order by (case when clat is null then null else p.km end) asc nulls last, p.reviewed_at desc, p.id) filter (where p.rn <= lim), '[]'::jsonb)
  into cnt, rows
  from (select page.*, row_number() over (order by (case when clat is null then null else page.km end) asc nulls last, page.reviewed_at desc, page.id) as rn from page) p;

  return jsonb_build_object('areas', rows, 'has_more', cnt > lim);
end;
$$;

revoke all on function public.explore_public_areas(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.explore_public_areas(jsonb, integer, integer) to anon, authenticated;
