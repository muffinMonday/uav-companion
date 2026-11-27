-- Community Flying Areas, Phase 5: revisions of a published area.
--
--   * submit_community_revision(area_id, payload): the original contributor (area.owner_id = auth.uid()) proposes a replacement for an area that is published right now. The new
--     revision is a normal pending revision (revision_no = highest + 1); the published revision keeps serving the public until an administrator approves the replacement
--     (review_community_area, unchanged: it switches published_revision_id in the same transaction) and keeps serving it while the replacement is pending, rejected or withdrawn.
--     Same validation (community_area_normalize), same idempotency, same five-pending limit and the same per-account lock as submit_community_area. submit_community_area itself is
--     untouched and still refuses any client-supplied area id.
--   * A revision identical in content to the published one is refused ('no_change'): it would only ask an administrator to look at nothing.
--   * community_area_admin_item gains `published`: the currently published version (name, description, geometry, spots, size, revision number) when the item is a different
--     revision of an area that has one, so the review screen can compare. Same signature as before; only administrators ever receive it.
-- Errors (in addition to the Phase 2 ones): 'not_found' (no such area for this account), 'not_published' (the area has no published revision: never approved or unpublished),
-- 'revision_pending' (the area already has a pending revision), 'no_change'.

create function public.submit_community_revision(p_area_id uuid, p_payload jsonb)
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
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots')) then
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
     and pub.geometry = jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')) and pub.spots = norm -> 'spots' then
    raise exception 'no_change' using errcode = 'P0001';
  end if;

  select coalesce(max(revision_no), 0) + 1 into no_ from public.community_area_revisions where area_id = a.id;
  insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2,
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash)
  values (a.id, no_, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h)
  returning id, submitted_at into rid, at_;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', no_, 'revision', true, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots')));
  return jsonb_build_object('area_id', a.id, 'revision_id', rid, 'revision_no', no_, 'status', 'pending', 'submitted_at', at_, 'replayed', false);
end;
$$;

revoke all on function public.submit_community_revision(uuid, jsonb) from public, anon;
grant execute on function public.submit_community_revision(uuid, jsonb) to authenticated;

-- The moderation item, now with the version it would replace.
create or replace function public.community_area_admin_item(p_rev public.community_area_revisions, p_area public.community_areas, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'revision_id', p_rev.id, 'area_id', p_rev.area_id, 'revision_no', p_rev.revision_no, 'name', p_rev.name, 'description', p_rev.description,
    'draw_kind', p_rev.draw_kind, 'geometry', p_rev.geometry, 'spots', p_rev.spots, 'area_m2', p_rev.area_m2,
    'bbox', jsonb_build_array(p_rev.bbox_west, p_rev.bbox_south, p_rev.bbox_east, p_rev.bbox_north),
    'status', p_rev.status, 'submitted_at', p_rev.submitted_at, 'reviewed_at', p_rev.reviewed_at,
    'contributor_name', (select pr.display_name from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'contributor_code', (select pr.friend_code from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'own', p_rev.contributor_id is not null and p_rev.contributor_id = p_uid,
    'has_published', p_area.published_revision_id is not null,
    'unpublished', p_area.unpublished_at is not null,
    'published', (select jsonb_build_object('revision_id', q.id, 'revision_no', q.revision_no, 'name', q.name, 'description', q.description, 'draw_kind', q.draw_kind,
                                            'geometry', q.geometry, 'spots', q.spots, 'area_m2', q.area_m2)
                    from public.community_area_revisions q
                   where q.id = p_area.published_revision_id and q.area_id = p_area.id and q.id <> p_rev.id));
$$;
revoke all on function public.community_area_admin_item(public.community_area_revisions, public.community_areas, uuid) from public, anon, authenticated;
