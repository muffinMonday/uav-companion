-- Community Flying Areas, Stage 4: structured site attributes (COMMUNITY_FLYING_AREAS_PLAN.md section 13.1; owner-approved field set and "Other" values, 2026-11-27).
--
--   community_area_revisions.attributes jsonb not null default '{}': part of the immutable revision (the guard trigger now covers it), so geometry, spots and attributes are reviewed and published
--   together. {} means "not provided": every revision that existed before this migration, and any later one that omits a field, stays unknown; nothing is inferred.
--   Shape (only the keys that were set are stored; unknown keys are refused):
--     environment  one of open_field, park, beach, water, hill, woodland, urban, other, unknown                       REQUIRED on every new submission and revision
--     access       one of public, permission, restricted, unknown                                                      REQUIRED on every new submission and revision
--     activities   list of fpv, cinematic, cruising, long_range, fixed_wing, other (no repeats; empty is dropped)
--     surface      one of grass, paved, dirt, sand, rock, mixed, unknown
--     hazards      list of people, roads, power_lines, trees, water, wildlife, uneven, airspace, other, none_reported, unknown
--                  ('none_reported' and 'unknown' are exclusive: either alone, never with another hazard, and never both)
--     observed_on  'YYYY-MM-DD', a real date from 2000-01-01 up to tomorrow (UTC); never defaulted to the submission date
--   Values are normalised on the server: arrays sorted in the canonical order above. Attributes are community observations: nothing here confers permission or a safety rating, and nothing
--   reads them in a point check.
--   Replaced (create or replace, same signatures and grants): community_area_normalize (adds the attributes; now STABLE because of the date check), submit_community_area and
--   submit_community_revision (accept and store them; 'no_change' now also compares attributes), community_revision_guard and community_revision_no_repeat (cover attributes),
--   community_area_public_item (public contract gains `attributes`, always an object), community_area_admin_item (item and published version carry them), explore_public_areas and
--   get_my_community_revision (carry them).
-- Errors (22023): invalid_area: attributes, invalid_area: attributes-required (environment or access missing).

alter table public.community_area_revisions add column attributes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 2000);

-- Validates and normalises the attributes object. p_require: environment and access must be present (submissions).
create function public.community_area_attributes(p jsonb, p_require boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  out jsonb := '{}'::jsonb;
  k text; v text;
  envs constant text[] := array['open_field', 'park', 'beach', 'water', 'hill', 'woodland', 'urban', 'other', 'unknown'];
  accs constant text[] := array['public', 'permission', 'restricted', 'unknown'];
  acts constant text[] := array['fpv', 'cinematic', 'cruising', 'long_range', 'fixed_wing', 'other'];
  surfs constant text[] := array['grass', 'paved', 'dirt', 'sand', 'rock', 'mixed', 'unknown'];
  hazs constant text[] := array['people', 'roads', 'power_lines', 'trees', 'water', 'wildlife', 'uneven', 'airspace', 'other', 'none_reported', 'unknown'];
  chosen text[];
  d date;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    if p_require then raise exception 'invalid_area: attributes-required' using errcode = '22023'; end if;
    return out;
  end if;
  if jsonb_typeof(p) <> 'object' or octet_length(p::text) > 2000 then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('environment', 'access', 'activities', 'surface', 'hazards', 'observed_on') then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
  end loop;

  if p ? 'environment' and jsonb_typeof(p -> 'environment') <> 'null' then
    if jsonb_typeof(p -> 'environment') <> 'string' or not ((p ->> 'environment') = any (envs)) then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    out := out || jsonb_build_object('environment', p ->> 'environment');
  end if;
  if p ? 'access' and jsonb_typeof(p -> 'access') <> 'null' then
    if jsonb_typeof(p -> 'access') <> 'string' or not ((p ->> 'access') = any (accs)) then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    out := out || jsonb_build_object('access', p ->> 'access');
  end if;
  if p_require and (not out ? 'environment' or not out ? 'access') then raise exception 'invalid_area: attributes-required' using errcode = '22023'; end if;

  if p ? 'activities' and jsonb_typeof(p -> 'activities') <> 'null' then
    if jsonb_typeof(p -> 'activities') <> 'array' or jsonb_array_length(p -> 'activities') > 6 then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    chosen := '{}';
    for v in select jsonb_array_elements_text(p -> 'activities') loop
      if v is null or not (v = any (acts)) or v = any (chosen) then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
      chosen := chosen || v;
    end loop;
    if cardinality(chosen) > 0 then
      out := out || jsonb_build_object('activities', (select to_jsonb(array_agg(a order by array_position(acts, a))) from unnest(chosen) a));
    end if;
  end if;
  if p ? 'surface' and jsonb_typeof(p -> 'surface') <> 'null' then
    if jsonb_typeof(p -> 'surface') <> 'string' or not ((p ->> 'surface') = any (surfs)) then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    out := out || jsonb_build_object('surface', p ->> 'surface');
  end if;
  if p ? 'hazards' and jsonb_typeof(p -> 'hazards') <> 'null' then
    if jsonb_typeof(p -> 'hazards') <> 'array' or jsonb_array_length(p -> 'hazards') > 11 then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    chosen := '{}';
    for v in select jsonb_array_elements_text(p -> 'hazards') loop
      if v is null or not (v = any (hazs)) or v = any (chosen) then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
      chosen := chosen || v;
    end loop;
    if ('none_reported' = any (chosen) or 'unknown' = any (chosen)) and cardinality(chosen) > 1 then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    if cardinality(chosen) > 0 then
      out := out || jsonb_build_object('hazards', (select to_jsonb(array_agg(a order by array_position(hazs, a))) from unnest(chosen) a));
    end if;
  end if;
  if p ? 'observed_on' and jsonb_typeof(p -> 'observed_on') <> 'null' then
    if jsonb_typeof(p -> 'observed_on') <> 'string' or (p ->> 'observed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    begin d := (p ->> 'observed_on')::date; exception when others then raise exception 'invalid_area: attributes' using errcode = '22023'; end;
    if to_char(d, 'YYYY-MM-DD') <> (p ->> 'observed_on') or d < date '2000-01-01' or d > (now() at time zone 'utc')::date + 1 then raise exception 'invalid_area: attributes' using errcode = '22023'; end if;
    out := out || jsonb_build_object('observed_on', p ->> 'observed_on');
  end if;
  return out;
end;
$$;
revoke all on function public.community_area_attributes(jsonb, boolean) from public, anon, authenticated;

create or replace function public.community_revision_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.area_id, new.revision_no, new.name, new.description, new.draw_kind, new.geometry, new.spots, new.area_m2,
      new.bbox_west, new.bbox_south, new.bbox_east, new.bbox_north, new.submitted_at, new.attributes)
     is distinct from
     (old.id, old.area_id, old.revision_no, old.name, old.description, old.draw_kind, old.geometry, old.spots, old.area_m2,
      old.bbox_west, old.bbox_south, old.bbox_east, old.bbox_north, old.submitted_at, old.attributes) then
    raise exception 'a submitted revision cannot be changed';
  end if;
  if new.contributor_id is distinct from old.contributor_id and new.contributor_id is not null then raise exception 'a submitted revision cannot be changed'; end if;
  if new.idempotency_key is distinct from old.idempotency_key and new.idempotency_key is not null then raise exception 'a submitted revision cannot be changed'; end if;
  if new.payload_hash is distinct from old.payload_hash and new.payload_hash is not null then raise exception 'a submitted revision cannot be changed'; end if;
  if new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is not null and new.status = old.status then raise exception 'a submitted revision cannot be changed'; end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'only a pending revision can change state'; end if;
  elsif (new.reviewed_at, new.review_reason) is distinct from (old.reviewed_at, old.review_reason) then
    raise exception 'a submitted revision cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.community_area_normalize(p jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  nm text; ds text; kind text; g jsonb; coords jsonb; el jsonb; pos double precision[];
  xs double precision[] := '{}'; ys double precision[] := '{}';
  n integer; i integer; j integer; total integer;
  twice double precision := 0; s double precision := 0; area double precision;
  rx double precision[] := '{}'; ry double precision[] := '{}';
  spots jsonb := '[]'::jsonb; sp jsonb; st text; note text;
  earth constant double precision := 6371008.8;
  same_ constant double precision := 1e-7;
  ring jsonb := '[]'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_area: payload' using errcode = '22023'; end if;
  nm := public.community_area_text(p -> 'name', false);
  if nm is null or nm = '' or char_length(nm) > 80 then raise exception 'invalid_area: name' using errcode = '22023'; end if;
  ds := public.community_area_text(p -> 'description', true);
  if ds is null or char_length(ds) > 500 then raise exception 'invalid_area: description' using errcode = '22023'; end if;
  kind := coalesce(p ->> 'draw_kind', 'polygon');
  if jsonb_typeof(p -> 'draw_kind') not in ('string', 'null') and p ? 'draw_kind' then raise exception 'invalid_area: draw_kind' using errcode = '22023'; end if;
  if kind not in ('polygon', 'rectangle') then raise exception 'invalid_area: draw_kind' using errcode = '22023'; end if;

  g := p -> 'geometry';
  if g is null or jsonb_typeof(g) <> 'object' or g ->> 'type' is distinct from 'Polygon' or jsonb_typeof(g -> 'coordinates') <> 'array'
     or jsonb_array_length(g -> 'coordinates') < 1 or jsonb_typeof(g -> 'coordinates' -> 0) <> 'array' then
    raise exception 'invalid_area: geometry' using errcode = '22023';
  end if;
  coords := g -> 'coordinates';
  if jsonb_array_length(coords) <> 1 then raise exception 'invalid_area: holes' using errcode = '22023'; end if;
  coords := coords -> 0;
  total := jsonb_array_length(coords);
  if total > 101 then raise exception 'invalid_area: vertex-count' using errcode = '22023'; end if;
  for el in select value from jsonb_array_elements(coords) loop
    pos := public.community_area_pos(el);
    if pos is null then raise exception 'invalid_area: bad-coordinate' using errcode = '22023'; end if;
    xs := xs || pos[1]; ys := ys || pos[2];
  end loop;
  n := cardinality(xs);
  if n > 1 and abs(xs[1] - xs[n]) < same_ and abs(ys[1] - ys[n]) < same_ then xs := xs[1:n - 1]; ys := ys[1:n - 1]; n := n - 1; end if;
  if n > 100 or n < 3 then raise exception 'invalid_area: vertex-count' using errcode = '22023'; end if;
  for i in 1 .. n loop
    for j in i + 1 .. n loop
      if abs(xs[i] - xs[j]) < same_ and abs(ys[i] - ys[j]) < same_ then raise exception 'invalid_area: duplicate-vertex' using errcode = '22023'; end if;
    end loop;
  end loop;
  for i in 1 .. n loop
    if abs(xs[i % n + 1] - xs[i]) > 180 then raise exception 'invalid_area: antimeridian' using errcode = '22023'; end if;
  end loop;
  for i in 1 .. n loop
    s := s + ((xs[i % n + 1] - xs[i]) * pi() / 180) * (2 + sin(ys[i] * pi() / 180) + sin(ys[i % n + 1] * pi() / 180));
  end loop;
  area := abs(s * earth * earth / 2);
  if public.community_area_self_intersects(xs, ys) then raise exception 'invalid_area: self-intersection' using errcode = '22023'; end if;
  if area < 1 then raise exception 'invalid_area: degenerate' using errcode = '22023'; end if;
  if area > 25e6 then raise exception 'invalid_area: too-large' using errcode = '22023'; end if;

  for i in 1 .. n loop twice := twice + xs[i] * ys[i % n + 1] - xs[i % n + 1] * ys[i]; end loop;
  if twice < 0 then
    for i in reverse n .. 1 loop rx := rx || xs[i]; ry := ry || ys[i]; end loop;
    xs := rx; ys := ry;
  end if;
  for i in 1 .. n loop ring := ring || jsonb_build_array(jsonb_build_array(xs[i], ys[i])); end loop;
  ring := ring || jsonb_build_array(jsonb_build_array(xs[1], ys[1]));

  if p -> 'spots' is not null and jsonb_typeof(p -> 'spots') <> 'null' then
    if jsonb_typeof(p -> 'spots') <> 'array' then raise exception 'invalid_area: spots' using errcode = '22023'; end if;
    if jsonb_array_length(p -> 'spots') > 10 then raise exception 'invalid_area: too-many-spots' using errcode = '22023'; end if;
    for sp in select value from jsonb_array_elements(p -> 'spots') loop
      if jsonb_typeof(sp) <> 'object' then raise exception 'invalid_area: bad-spot' using errcode = '22023'; end if;
      pos := public.community_area_pos(sp -> 'coordinates');
      if pos is null then raise exception 'invalid_area: bad-coordinate' using errcode = '22023'; end if;
      st := case when jsonb_typeof(sp -> 'type') = 'string' then sp ->> 'type' end;
      if st is null or st not in ('shelter', 'seating', 'open', 'other') then raise exception 'invalid_area: bad-spot-type' using errcode = '22023'; end if;
      note := public.community_area_text(sp -> 'note', false);
      if note is null or char_length(note) > 120 then raise exception 'invalid_area: bad-note' using errcode = '22023'; end if;
      if not public.community_area_point_in(pos[1], pos[2], xs, ys) then raise exception 'invalid_area: spot-outside' using errcode = '22023'; end if;
      spots := spots || jsonb_build_array(jsonb_build_object('type', st, 'note', note, 'coordinates', jsonb_build_array(pos[1], pos[2])));
    end loop;
  end if;

  return jsonb_build_object('name', nm, 'description', ds, 'draw_kind', case when kind = 'rectangle' and n = 4 then 'rectangle' else 'polygon' end,
    'ring', ring, 'spots', spots, 'area_m2', round(area), 'vertices', n,
    'attributes', public.community_area_attributes(p -> 'attributes', true),
    'bbox', jsonb_build_array((select min(v) from unnest(xs) v), (select min(v) from unnest(ys) v), (select max(v) from unnest(xs) v), (select max(v) from unnest(ys) v)));
end;
$$;

create or replace function public.submit_community_area(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  k text;
  norm jsonb;
  h text;
  ex public.community_area_revisions%rowtype;
  aid uuid;
  rid uuid;
  at_ timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_area: payload' using errcode = '22023'; end if;
  if octet_length(p_payload::text) > 32768 then raise exception 'invalid_area: payload-size' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots', 'attributes')) then
    raise exception 'invalid_area: unknown-field' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'idempotency_key') is distinct from 'string' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  k := p_payload ->> 'idempotency_key';
  if k !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  norm := public.community_area_normalize(p_payload - 'idempotency_key');
  h := md5(norm::text);

  -- one submitter at a time per account: the key lookup, the five-pending count and the inserts cannot interleave with another request of the same account
  perform pg_advisory_xact_lock(hashtextextended('community_area:' || uid::text, 0));

  select * into ex from public.community_area_revisions where contributor_id = uid and idempotency_key = k;
  if found then
    if ex.payload_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('area_id', ex.area_id, 'revision_id', ex.id, 'revision_no', ex.revision_no, 'status', ex.status, 'submitted_at', ex.submitted_at, 'replayed', true);
  end if;

  if (select count(*) from public.community_area_revisions where contributor_id = uid and status = 'pending') >= 5 then
    raise exception 'pending_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.community_areas (owner_id) values (uid) returning id into aid;
  insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2,
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash, attributes)
  values (aid, 1, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h, norm -> 'attributes')
  returning id, submitted_at into rid, at_;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', 1, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots')));
  return jsonb_build_object('area_id', aid, 'revision_id', rid, 'revision_no', 1, 'status', 'pending', 'submitted_at', at_, 'replayed', false);
end;
$$;

create or replace function public.submit_community_revision(p_area_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  k text;
  norm jsonb;
  h text;
  ex public.community_area_revisions%rowtype;
  a public.community_areas%rowtype;
  pub public.community_area_revisions%rowtype;
  rid uuid;
  at_ timestamptz;
  no_ integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_area_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_area: payload' using errcode = '22023'; end if;
  if octet_length(p_payload::text) > 32768 then raise exception 'invalid_area: payload-size' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots', 'attributes')) then
    raise exception 'invalid_area: unknown-field' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'idempotency_key') is distinct from 'string' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  k := p_payload ->> 'idempotency_key';
  if k !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  norm := public.community_area_normalize(p_payload - 'idempotency_key');
  h := md5(norm::text || ':' || p_area_id::text); -- the target area is part of what a key stands for

  perform pg_advisory_xact_lock(hashtextextended('community_area:' || uid::text, 0));

  select * into ex from public.community_area_revisions where contributor_id = uid and idempotency_key = k;
  if found then
    if ex.payload_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('area_id', ex.area_id, 'revision_id', ex.id, 'revision_no', ex.revision_no, 'status', ex.status, 'submitted_at', ex.submitted_at, 'replayed', true);
  end if;

  -- the area row is locked: a concurrent review or unpublication of this area cannot interleave with the checks below
  select * into a from public.community_areas where id = p_area_id and owner_id = uid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.published_revision_id is null then raise exception 'not_published' using errcode = 'P0001'; end if;
  if exists (select 1 from public.community_area_revisions where area_id = a.id and status = 'pending') then raise exception 'revision_pending' using errcode = 'P0001'; end if;
  if (select count(*) from public.community_area_revisions where contributor_id = uid and status = 'pending') >= 5 then raise exception 'pending_limit_reached' using errcode = 'P0001'; end if;

  select * into pub from public.community_area_revisions where id = a.published_revision_id;
  if pub.name = norm ->> 'name' and pub.description = norm ->> 'description' and pub.draw_kind = norm ->> 'draw_kind'
     and pub.geometry = jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')) and pub.spots = norm -> 'spots'
     and pub.attributes = norm -> 'attributes' then
    raise exception 'no_change' using errcode = 'P0001';
  end if;

  select coalesce(max(revision_no), 0) + 1 into no_ from public.community_area_revisions where area_id = a.id;
  insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2,
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash, attributes)
  values (a.id, no_, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h, norm -> 'attributes')
  returning id, submitted_at into rid, at_;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', no_, 'revision', true, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots')));
  return jsonb_build_object('area_id', a.id, 'revision_id', rid, 'revision_no', no_, 'status', 'pending', 'submitted_at', at_, 'replayed', false);
end;
$$;

create or replace function public.community_revision_no_repeat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contributor_id is not null and exists (
    select 1 from public.community_area_revisions o
     where o.contributor_id = new.contributor_id and o.status = 'rejected'
       and (o.area_id = new.area_id or new.revision_no = 1)
       and o.name = new.name and o.description = new.description and o.draw_kind = new.draw_kind and o.geometry = new.geometry and o.spots = new.spots and o.attributes = new.attributes) then
    raise exception 'identical_to_rejected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.community_area_public_item(p_area_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'area_id', a.id, 'revision_id', r.id, 'status', 'approved', 'published', true,
    'name', r.name, 'description', r.description, 'geometry', r.geometry, 'spots', r.spots, 'area_m2', r.area_m2, 'attributes', r.attributes,
    'approved_at', r.reviewed_at,
    'attribution', case when p.user_id is not null and p.community_attribution then jsonb_build_object('display_name', p.display_name, 'avatar', p.avatar) else null end)
  from public.community_areas a
  join public.community_area_revisions r on r.id = a.published_revision_id and r.area_id = a.id and r.status = 'approved'
  left join public.profiles p on p.user_id = r.contributor_id
  where a.id = p_area_id and a.published_revision_id is not null and a.unpublished_at is null
    and jsonb_typeof(r.geometry) = 'object' and r.geometry ->> 'type' = 'Polygon' and r.reviewed_at is not null;
$$;

create or replace function public.community_area_admin_item(p_rev public.community_area_revisions, p_area public.community_areas, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'revision_id', p_rev.id, 'area_id', p_rev.area_id, 'revision_no', p_rev.revision_no, 'name', p_rev.name, 'description', p_rev.description,
    'draw_kind', p_rev.draw_kind, 'geometry', p_rev.geometry, 'spots', p_rev.spots, 'area_m2', p_rev.area_m2, 'attributes', p_rev.attributes,
    'bbox', jsonb_build_array(p_rev.bbox_west, p_rev.bbox_south, p_rev.bbox_east, p_rev.bbox_north),
    'status', p_rev.status, 'submitted_at', p_rev.submitted_at, 'reviewed_at', p_rev.reviewed_at,
    'contributor_name', (select pr.display_name from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'contributor_code', (select pr.friend_code from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'own', p_rev.contributor_id is not null and p_rev.contributor_id = p_uid,
    'has_published', p_area.published_revision_id is not null,
    'unpublished', p_area.unpublished_at is not null,
    'published', (select jsonb_build_object('revision_id', q.id, 'revision_no', q.revision_no, 'name', q.name, 'description', q.description, 'draw_kind', q.draw_kind,
                                            'geometry', q.geometry, 'spots', q.spots, 'area_m2', q.area_m2, 'attributes', q.attributes)
                    from public.community_area_revisions q
                   where q.id = p_area.published_revision_id and q.area_id = p_area.id and q.id <> p_rev.id));
$$;

create or replace function public.explore_public_areas(p_filter jsonb default '{}'::jsonb, p_limit integer default 20, p_offset integer default 0)
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
    select a.id, r.name, r.area_m2, r.reviewed_at, r.attributes,
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
      'area_id', p.id, 'name', p.name, 'area_m2', p.area_m2, 'spot_count', p.spot_count, 'approved_at', p.reviewed_at, 'attributes', p.attributes,
      'center', jsonb_build_object('lat', round(p.lat::numeric, 4), 'lng', round(p.lng::numeric, 4)),
      'distance_km', case when p.km is null then null else round(p.km::numeric, 1) end)
    order by (case when clat is null then null else p.km end) asc nulls last, p.reviewed_at desc, p.id) filter (where p.rn <= lim), '[]'::jsonb)
  into cnt, rows
  from (select page.*, row_number() over (order by (case when clat is null then null else page.km end) asc nulls last, page.reviewed_at desc, page.id) as rn from page) p;

  return jsonb_build_object('areas', rows, 'has_more', cnt > lim);
end;
$$;

create or replace function public.get_my_community_revision(p_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.community_area_revisions%rowtype;
  a public.community_areas%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_revision_id is null then return null; end if;
  select * into r from public.community_area_revisions where id = p_revision_id and contributor_id = uid;
  if not found then return null; end if;
  select * into a from public.community_areas where id = r.area_id and owner_id = uid;
  if not found then return null; end if;
  return jsonb_build_object(
    'area_id', r.area_id, 'revision_id', r.id, 'revision_no', r.revision_no, 'status', r.status,
    'name', r.name, 'description', r.description, 'draw_kind', r.draw_kind, 'geometry', r.geometry, 'spots', r.spots, 'area_m2', r.area_m2, 'attributes', r.attributes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_reason', r.review_reason,
    'published', a.published_revision_id = r.id and a.unpublished_at is null,
    'area_published', a.published_revision_id is not null and a.unpublished_at is null,
    'area_unpublished', a.unpublished_at is not null);
end;
$$;
