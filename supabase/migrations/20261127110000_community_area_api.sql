-- Community Flying Areas, Phase 2: validation, submission, the owner's list and withdrawal.
--
-- The server is authoritative. community_area_normalize is a line-for-line port of src/areas/core.js (validateArea): the same limits, the same 7-decimal rounding,
-- the same spherical area (mean radius 6371008.8 m), the same planar self-intersection test with the same boundary behaviour (touching and doubling back are rejected),
-- the same closed counter-clockwise ring, the same inside-or-on-the-boundary rule for setup spots. A polygon Phase 1 accepts is accepted here (the only possible
-- difference is the last bit of sin() between the JavaScript and Postgres math libraries, which matters only for a polygon within about 1e-9 of 25 km2).
-- No PostGIS: nothing here needs more than that arithmetic.
--
-- Errors are short controlled messages, never SQL details: 'invalid_area: <code>' (sqlstate 22023), 'pending_limit_reached', 'idempotency_conflict', 'not_found',
-- 'not_withdrawable', 'not signed in' (28000).

create function public.community_area_cross(ox double precision, oy double precision, ax double precision, ay double precision, bx double precision, by double precision)
returns double precision language sql immutable set search_path = ''
as $$ select (ax - ox) * (by - oy) - (ay - oy) * (bx - ox) $$;

create function public.community_area_on_seg(ax double precision, ay double precision, bx double precision, by double precision, px double precision, py double precision)
returns boolean language sql immutable set search_path = ''
as $$ select least(ax, bx) <= px and px <= greatest(ax, bx) and least(ay, by) <= py and py <= greatest(ay, by) $$;

-- True when closed segments a-b and c-d share any point (a touch or a collinear overlap counts).
create function public.community_area_meet(ax double precision, ay double precision, bx double precision, by double precision, cx double precision, cy double precision, dx double precision, dy double precision)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  d1 double precision := public.community_area_cross(ax, ay, bx, by, cx, cy);
  d2 double precision := public.community_area_cross(ax, ay, bx, by, dx, dy);
  d3 double precision := public.community_area_cross(cx, cy, dx, dy, ax, ay);
  d4 double precision := public.community_area_cross(cx, cy, dx, dy, bx, by);
begin
  if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)) then return true; end if;
  return (d1 = 0 and public.community_area_on_seg(ax, ay, bx, by, cx, cy)) or (d2 = 0 and public.community_area_on_seg(ax, ay, bx, by, dx, dy))
      or (d3 = 0 and public.community_area_on_seg(cx, cy, dx, dy, ax, ay)) or (d4 = 0 and public.community_area_on_seg(cx, cy, dx, dy, bx, by));
end;
$$;

-- Open vertex list (xs, ys; at least 3, distinct): crosses or touches itself, or folds back along an edge.
create function public.community_area_self_intersects(xs double precision[], ys double precision[])
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare n integer := cardinality(xs); i integer; j integer; c integer;
begin
  for i in 0 .. n - 1 loop
    c := (i + 2) % n;
    if public.community_area_cross(xs[i + 1], ys[i + 1], xs[(i + 1) % n + 1], ys[(i + 1) % n + 1], xs[c + 1], ys[c + 1]) = 0
       and ((xs[c + 1] - xs[(i + 1) % n + 1]) * (xs[i + 1] - xs[(i + 1) % n + 1]) + (ys[c + 1] - ys[(i + 1) % n + 1]) * (ys[i + 1] - ys[(i + 1) % n + 1])) > 0 then
      return true;
    end if;
    for j in i + 2 .. n - 1 loop
      continue when i = 0 and j = n - 1;
      if public.community_area_meet(xs[i + 1], ys[i + 1], xs[(i + 1) % n + 1], ys[(i + 1) % n + 1], xs[j + 1], ys[j + 1], xs[(j + 1) % n + 1], ys[(j + 1) % n + 1]) then return true; end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- Point in polygon, boundary included. xs, ys: the open ring.
create function public.community_area_point_in(px double precision, py double precision, xs double precision[], ys double precision[])
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare n integer := cardinality(xs); i integer; j integer; inside boolean := false;
begin
  if n < 3 then return false; end if;
  for i in 0 .. n - 1 loop
    j := case when i = 0 then n - 1 else i - 1 end;
    if public.community_area_cross(xs[i + 1], ys[i + 1], xs[j + 1], ys[j + 1], px, py) = 0 and public.community_area_on_seg(xs[i + 1], ys[i + 1], xs[j + 1], ys[j + 1], px, py) then return true; end if;
    if (ys[i + 1] > py) <> (ys[j + 1] > py) and px < ((xs[j + 1] - xs[i + 1]) * (py - ys[i + 1])) / (ys[j + 1] - ys[i + 1]) + xs[i + 1] then inside := not inside; end if;
  end loop;
  return inside;
end;
$$;

-- Text as core.js cleanText: control characters out, whitespace tidied, length in characters. NULL when the value is not text.
create function public.community_area_text(p_value jsonb, p_multiline boolean)
returns text
language plpgsql immutable set search_path = ''
as $$
declare s text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return ''; end if;
  if jsonb_typeof(p_value) <> 'string' then return null; end if;
  s := replace(replace(p_value #>> '{}', E'\r\n', E'\n'), E'\r', E'\n');
  if p_multiline then
    s := regexp_replace(s, '[\u0001-\u0009\u000b-\u001f\u007f]', '', 'g');
    return regexp_replace(s, '^\s+|\s+$', '', 'g');
  end if;
  s := regexp_replace(s, '[\u0001-\u001f\u007f]+', ' ', 'g');
  return btrim(regexp_replace(s, '\s+', ' ', 'g'));
end;
$$;

-- A position [lng, lat] in range, rounded to 7 decimals as core.js cleanPosition; NULL when it is not one.
create function public.community_area_pos(p jsonb)
returns double precision[]
language plpgsql immutable set search_path = ''
as $$
declare lng numeric; lat numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) < 2 or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number' then return null; end if;
  lng := (p -> 0)::numeric; lat := (p -> 1)::numeric;
  if lng < -180 or lng > 180 or lat < -90 or lat > 90 then return null; end if;
  return array[floor(lng::double precision * 1e7 + 0.5) / 1e7, floor(lat::double precision * 1e7 + 0.5) / 1e7];
end;
$$;

-- Validates and normalises a submission payload (name, description, draw_kind, geometry, spots). Raises 'invalid_area: <code>'.
-- Returns { name, description, draw_kind, ring (closed, counter-clockwise), spots, area_m2, vertices, bbox }.
create function public.community_area_normalize(p jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
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
    'bbox', jsonb_build_array((select min(v) from unnest(xs) v), (select min(v) from unnest(ys) v), (select max(v) from unnest(xs) v), (select max(v) from unnest(ys) v)));
end;
$$;

-- Submit a new area for review. The owner and contributor are always auth.uid(); the payload may not name anyone.
-- payload: { idempotency_key (16 to 64 of A-Z a-z 0-9 _ -), name, description?, draw_kind?, geometry (Polygon), spots? }.
-- Returns { area_id, revision_id, revision_no, status, submitted_at, replayed }. The same key with an equivalent payload returns the existing submission
-- (replayed true); the same key with a different payload fails with 'idempotency_conflict'.
create function public.submit_community_area(p_payload jsonb)
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
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots')) then
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
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash)
  values (aid, 1, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h)
  returning id, submitted_at into rid, at_;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', 1, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots')));
  return jsonb_build_object('area_id', aid, 'revision_id', rid, 'revision_no', 1, 'status', 'pending', 'submitted_at', at_, 'replayed', false);
end;
$$;

-- The caller's own submissions, newest first (at most 200). No geometry, no identifiers of any person.
create function public.list_my_community_areas()
returns table (area_id uuid, revision_id uuid, revision_no integer, name text, status text, submitted_at timestamptz, reviewed_at timestamptz, review_reason text, published boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select r.area_id, r.id, r.revision_no, r.name, r.status, r.submitted_at, r.reviewed_at, r.review_reason,
           coalesce(a.published_revision_id = r.id and a.unpublished_at is null, false)
      from public.community_area_revisions r join public.community_areas a on a.id = r.area_id
     where a.owner_id = uid and r.contributor_id = uid
     order by r.submitted_at desc, r.id
     limit 200;
end;
$$;

-- Withdraw the caller's own pending revision. An approved, rejected or someone else's revision is never touched; an already withdrawn one is a no-op.
create function public.withdraw_community_revision(p_revision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.community_area_revisions%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community_area:' || uid::text, 0));
  select r2.* into r from public.community_area_revisions r2 join public.community_areas a on a.id = r2.area_id
   where r2.id = p_revision_id and r2.contributor_id = uid and a.owner_id = uid for update of r2;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status = 'withdrawn' then return jsonb_build_object('revision_id', r.id, 'status', 'withdrawn', 'changed', false); end if;
  if r.status <> 'pending' then raise exception 'not_withdrawable' using errcode = 'P0001'; end if;
  update public.community_area_revisions set status = 'withdrawn' where id = r.id;
  perform public.audit_log('area.withdraw', uid, null, r.id::text, jsonb_build_object('revision_no', r.revision_no));
  return jsonb_build_object('revision_id', r.id, 'status', 'withdrawn', 'changed', true);
end;
$$;

revoke all on function public.community_area_cross(double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.community_area_on_seg(double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.community_area_meet(double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.community_area_self_intersects(double precision[], double precision[]) from public, anon, authenticated;
revoke all on function public.community_area_point_in(double precision, double precision, double precision[], double precision[]) from public, anon, authenticated;
revoke all on function public.community_area_text(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.community_area_pos(jsonb) from public, anon, authenticated;
revoke all on function public.community_area_normalize(jsonb) from public, anon, authenticated;
revoke all on function public.submit_community_area(jsonb) from public, anon;
revoke all on function public.list_my_community_areas() from public, anon;
revoke all on function public.withdraw_community_revision(uuid) from public, anon;
grant execute on function public.submit_community_area(jsonb) to authenticated;
grant execute on function public.list_my_community_areas() to authenticated;
grant execute on function public.withdraw_community_revision(uuid) to authenticated;
