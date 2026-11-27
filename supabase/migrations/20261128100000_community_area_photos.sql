-- Community Flying Areas, Stage 4b: one optional location photo per revision (plan section 13.9; owner-approved design, 2026-11-28). BRANCH ONLY until the owner reviews it.
--
--   Private Supabase Storage: bucket 'area-photos' (public = false, 1 MB limit, JPEG/PNG/WebP). NO storage policy is created, so no client role can list, read or write it; only the Edge Functions
--   (service role) touch it. Object keys are random (staged/<uuid>.<ext>): no user id, no filename.
--   community_area_photos: one row per photo. Content (key, mime, size, hash, dimensions, caption) is immutable; the state moves staged -> attached (with its revision) -> rejected / removed -> deleted.
--     staged    uploaded by the caller, not yet part of a submission (deleted after 24 hours)
--     attached  part of a revision; PUBLIC only while that revision is the current published one of an area that is not unpublished
--     rejected  the revision was rejected or withdrawn, or an administrator approved the area without the photo (deleted after 7 days)
--     removed   an administrator removed it from a published area (deleted at once by the next cleanup, which an administrator can trigger immediately)
--     deleted   the object is gone (the row stays as a record without a reachable object)
--   A superseded or unpublished revision's photo is deleted 30 days after it stops being public. A row with state 'deleted' keeps its random key; an object is deleted only when no other live row
--   shares its key (a "kept" photo of a later revision is a second row on the same object).
--   Photo functions for the Edge Functions (service_role only): stage_area_photo, discard_staged_photo, area_photo_access, photos_due_for_deletion, mark_photo_deleted.
--   For people: get_my_area_photo (the photo a contributor's published revision shows, for "keep"), remove_area_photo (administrator: urgent removal), and the existing functions, replaced:
--     submit_community_area / submit_community_revision accept photo_id (a staged photo of the caller) or keep_photo (revisions: reuse the published revision's photo); neither means no photo (a revision
--       without one therefore removes the published photo when approved); the idempotency hash covers the choice; identical-after-rejection and no_change take the photo into account
--     review_community_area gains p_drop_photo: approve a valid area WITHOUT its photo, with a required reason (at most 400 characters) that is stored as the revision's review reason
--       ("Approved without the photo: ...", which the contributor sees) and audited (area.photo_reject)
--     community_area_public_item (public contract gains photo { id, width, height, caption } or null), community_area_admin_item, get_my_community_revision, community_areas_forget
--   Errors: invalid_area: photo, photo_not_found, no_photo_to_keep, no_photo, photo_reason_required, too_many_staged, daily_limit, invalid_photo.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('area-photos', 'area-photos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  end if;
end $$;

create table public.community_area_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  object_key text not null check (object_key ~ '^staged/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer not null check (bytes between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 200 and 2000),
  height integer not null check (height between 200 and 2000),
  caption text not null default '' check (char_length(caption) <= 120),
  state text not null default 'staged' check (state in ('staged', 'attached', 'rejected', 'removed', 'deleted')),
  revision_id uuid references public.community_area_revisions (id) on delete set null,
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  delete_after timestamptz,
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_reason text check (removed_reason is null or char_length(removed_reason) <= 500)
);
create unique index community_area_photo_one_per_revision on public.community_area_photos (revision_id) where revision_id is not null and state in ('attached', 'rejected', 'removed');
create index community_area_photos_owner on public.community_area_photos (owner_id, created_at);
create index community_area_photos_due on public.community_area_photos (delete_after) where state <> 'deleted';
create index community_area_photos_staged on public.community_area_photos (created_at) where state = 'staged';
create index community_area_photos_key on public.community_area_photos (object_key);
alter table public.community_area_photos enable row level security;
revoke all on public.community_area_photos from anon, authenticated;
comment on table public.community_area_photos is 'Location photos of community-area revisions. Never readable by a client role; the objects live in the private bucket area-photos and are served only by the area-photo Edge Function after an access check.';

-- content is immutable; only the lifecycle columns may change
create function public.community_photo_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.object_key, new.mime, new.bytes, new.sha256, new.width, new.height, new.caption, new.created_at)
     is distinct from (old.id, old.object_key, old.mime, old.bytes, old.sha256, old.width, old.height, old.caption, old.created_at) then
    raise exception 'a photo cannot be changed';
  end if;
  if new.owner_id is distinct from old.owner_id and new.owner_id is not null then raise exception 'a photo cannot be changed'; end if;
  if old.state = 'deleted' and new.state <> 'deleted' then raise exception 'a deleted photo cannot come back'; end if;
  if old.revision_id is not null and new.revision_id is distinct from old.revision_id and new.revision_id is not null then raise exception 'a photo cannot move to another revision'; end if;
  return new;
end;
$$;
create trigger community_photo_immutable before update on public.community_area_photos for each row execute function public.community_photo_guard();
revoke all on function public.community_photo_guard() from public, anon, authenticated;

-- a rejected or withdrawn revision: its photo is kept 7 days, then deleted
create function public.community_photo_on_revision_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('rejected', 'withdrawn') and old.status = 'pending' then
    update public.community_area_photos set state = 'rejected', delete_after = now() + interval '7 days', removed_reason = coalesce(removed_reason, 'revision ' || new.status)
     where revision_id = new.id and state = 'attached';
  end if;
  return new;
end;
$$;
create trigger community_photo_revision_status after update of status on public.community_area_revisions for each row execute function public.community_photo_on_revision_status();
revoke all on function public.community_photo_on_revision_status() from public, anon, authenticated;

-- a revision that stops being the published one (superseded or unpublished): its photo is deleted 30 days later
create function public.community_photo_on_publish_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.published_revision_id is not null and new.published_revision_id is distinct from old.published_revision_id then
    update public.community_area_photos set delete_after = coalesce(delete_after, now() + interval '30 days')
     where revision_id = old.published_revision_id and state = 'attached';
  end if;
  return new;
end;
$$;
create trigger community_photo_publish_change after update of published_revision_id on public.community_areas for each row execute function public.community_photo_on_publish_change();
revoke all on function public.community_photo_on_publish_change() from public, anon, authenticated;

-- the public face of a revision's photo (only meaningful for the current published revision)
create function public.community_area_photo_of(p_revision_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height, 'caption', ph.caption)
    from public.community_area_photos ph where ph.revision_id = p_revision_id and ph.state = 'attached' limit 1;
$$;
revoke all on function public.community_area_photo_of(uuid) from public, anon, authenticated;

-- ---- Edge Function surface (service_role only)
create function public.stage_area_photo(p_owner uuid, p_object_key text, p_mime text, p_bytes integer, p_sha256 text, p_width integer, p_height integer, p_caption text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cap text; pid uuid;
begin
  if p_owner is null or not exists (select 1 from auth.users where id = p_owner) then raise exception 'invalid_photo' using errcode = '22023'; end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') or p_bytes is null or p_bytes < 1 or p_bytes > 1048576
     or p_width is null or p_width not between 200 and 2000 or p_height is null or p_height not between 200 and 2000
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_object_key is null then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;
  cap := public.community_area_text(to_jsonb(coalesce(p_caption, '')), true);
  if cap is null or char_length(cap) > 120 then raise exception 'invalid_photo' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community_photo:' || p_owner::text, 0));
  if (select count(*) from public.community_area_photos where owner_id = p_owner and state = 'staged') >= 3 then raise exception 'too_many_staged' using errcode = 'P0001'; end if;
  if (select count(*) from public.community_area_photos where owner_id = p_owner and created_at > now() - interval '24 hours') >= 10 then raise exception 'daily_limit' using errcode = 'P0001'; end if;
  insert into public.community_area_photos (owner_id, object_key, mime, bytes, sha256, width, height, caption)
  values (p_owner, p_object_key, p_mime, p_bytes, p_sha256, p_width, p_height, cap) returning id into pid;
  return jsonb_build_object('photo_id', pid, 'width', p_width, 'height', p_height, 'caption', cap);
end;
$$;

-- the upload failed after the row was written: nothing was stored, the row is closed
create function public.discard_staged_photo(p_owner uuid, p_photo_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.community_area_photos set state = 'deleted' where id = p_photo_id and owner_id = p_owner and state = 'staged' and revision_id is null;
$$;

-- Who may fetch this photo, and what to fetch. null = no (never says why).
--   public: the photo of the CURRENT published revision of an area that is not unpublished
--   owner:  the person who uploaded it, while it is staged, attached or rejected
--   admin:  an administrator, for a photo that is attached or rejected (review)
create function public.area_photo_access(p_photo_id uuid, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ph public.community_area_photos%rowtype; why text := null;
begin
  select * into ph from public.community_area_photos where id = p_photo_id;
  if not found or ph.state in ('deleted', 'removed') then return null; end if;
  if ph.state = 'attached' and exists (select 1 from public.community_areas a where a.published_revision_id = ph.revision_id and a.unpublished_at is null) then why := 'public';
  elsif p_viewer is not null and ph.owner_id = p_viewer and ph.state in ('staged', 'attached', 'rejected') then why := 'owner';
  elsif p_viewer is not null and ph.state in ('attached', 'rejected') and public.has_role(p_viewer, 'admin') then why := 'admin';
  end if;
  if why is null then return null; end if;
  return jsonb_build_object('object_key', ph.object_key, 'mime', ph.mime, 'sha256', ph.sha256, 'bytes', ph.bytes, 'via', why);
end;
$$;

-- photos whose object should go: staged for 24 hours, or past delete_after (or removed); p_ids (an administrator's urgent purge) narrows it to those photos.
-- in_use: another live row shares the object, so only this row is closed, not the object.
create function public.photos_due_for_deletion(p_limit integer, p_ids uuid[] default null, p_admin uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_ids is not null and (p_admin is null or not public.has_role(p_admin, 'admin')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'object_key', d.object_key, 'in_use', d.in_use)) from (
    select ph.id, ph.object_key,
           exists (select 1 from public.community_area_photos o where o.object_key = ph.object_key and o.id <> ph.id and o.state <> 'deleted'
                     and not (o.delete_after is not null and o.delete_after <= now()) and not (o.state = 'staged' and o.created_at < now() - interval '24 hours') and o.state <> 'removed') as in_use
      from public.community_area_photos ph
     where ph.state <> 'deleted'
       and (ph.state = 'removed' or (ph.state = 'staged' and ph.created_at < now() - interval '24 hours') or (ph.delete_after is not null and ph.delete_after <= now()))
       and (p_ids is null or ph.id = any (p_ids))
     order by ph.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100)) d), '[]'::jsonb);
end;
$$;

create function public.mark_photo_deleted(p_photo_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.community_area_photos set state = 'deleted' where id = p_photo_id and state <> 'deleted';
$$;

-- ---- people
create function public.get_my_area_photo(p_area_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return (select jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height, 'caption', ph.caption)
            from public.community_areas a join public.community_area_photos ph on ph.revision_id = a.published_revision_id and ph.state = 'attached'
           where a.id = p_area_id and a.owner_id = uid and a.unpublished_at is null limit 1);
end;
$$;

-- Urgent removal of the photo of a published area (administrator). The photo stops being served at once (the access check reads the state on every request) and is due for deletion now;
-- the geometry and everything else stay. The contributor can propose a new revision.
create function public.remove_area_photo(p_area_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); a public.community_areas%rowtype; ph public.community_area_photos%rowtype; why text; rev public.community_area_revisions%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  why := public.community_area_text(to_jsonb(p_reason), true);
  if why is null or why = '' or char_length(why) > 500 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  select * into a from public.community_areas where id = p_area_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into ph from public.community_area_photos where revision_id = a.published_revision_id and state = 'attached' for update;
  if not found then raise exception 'no_photo' using errcode = 'P0001'; end if;
  update public.community_area_photos set state = 'removed', removed_at = now(), removed_by = uid, removed_reason = why, delete_after = now() where id = ph.id;
  select * into rev from public.community_area_revisions where id = ph.revision_id;
  perform public.audit_log('area.photo_remove', uid, rev.contributor_id, ph.id::text, jsonb_build_object('revision_no', rev.revision_no));
  return jsonb_build_object('area_id', a.id, 'photo_id', ph.id, 'removed', true);
end;
$$;

-- ---- replaced functions
create or replace function public.submit_community_area(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pid uuid := null; keep boolean := false; ph public.community_area_photos%rowtype; src public.community_area_photos%rowtype;
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
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots', 'attributes', 'photo_id', 'keep_photo')) then
    raise exception 'invalid_area: unknown-field' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'idempotency_key') is distinct from 'string' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  k := p_payload ->> 'idempotency_key';
  if k !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  if p_payload ? 'photo_id' and jsonb_typeof(p_payload -> 'photo_id') <> 'null' then
    if jsonb_typeof(p_payload -> 'photo_id') <> 'string' or (p_payload ->> 'photo_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
    pid := (p_payload ->> 'photo_id')::uuid;
  end if;
  if p_payload ? 'keep_photo' and jsonb_typeof(p_payload -> 'keep_photo') <> 'null' then
    if jsonb_typeof(p_payload -> 'keep_photo') <> 'boolean' then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
    keep := (p_payload ->> 'keep_photo')::boolean;
  end if;
  if pid is not null and keep then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
  if keep then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
  norm := public.community_area_normalize(p_payload - 'idempotency_key');
  h := md5(norm::text || case when pid is not null then ':photo:' || pid::text else '' end);

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

  if pid is not null then
    select * into ph from public.community_area_photos where id = pid and owner_id = uid and state = 'staged' and revision_id is null for update;
    if not found then raise exception 'photo_not_found' using errcode = 'P0002'; end if;
    perform set_config('app.community_photo', '1', true);
  end if;
  insert into public.community_areas (owner_id) values (uid) returning id into aid;
  insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2,
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash, attributes)
  values (aid, 1, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h, norm -> 'attributes')
  returning id, submitted_at into rid, at_;
  if pid is not null then
    update public.community_area_photos set state = 'attached', revision_id = rid, attached_at = now() where id = pid;
  elsif keep then
    insert into public.community_area_photos (owner_id, object_key, mime, bytes, sha256, width, height, caption, state, revision_id, attached_at)
    values (uid, src.object_key, src.mime, src.bytes, src.sha256, src.width, src.height, src.caption, 'attached', rid, now());
  end if;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', 1, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots'), 'photo', pid is not null));
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
  pid uuid := null; keep boolean := false; ph public.community_area_photos%rowtype; src public.community_area_photos%rowtype;
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
  if exists (select 1 from jsonb_object_keys(p_payload) x where x not in ('idempotency_key', 'name', 'description', 'draw_kind', 'geometry', 'spots', 'attributes', 'photo_id', 'keep_photo')) then
    raise exception 'invalid_area: unknown-field' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'idempotency_key') is distinct from 'string' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  k := p_payload ->> 'idempotency_key';
  if k !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid_area: idempotency-key' using errcode = '22023'; end if;
  if p_payload ? 'photo_id' and jsonb_typeof(p_payload -> 'photo_id') <> 'null' then
    if jsonb_typeof(p_payload -> 'photo_id') <> 'string' or (p_payload ->> 'photo_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
    pid := (p_payload ->> 'photo_id')::uuid;
  end if;
  if p_payload ? 'keep_photo' and jsonb_typeof(p_payload -> 'keep_photo') <> 'null' then
    if jsonb_typeof(p_payload -> 'keep_photo') <> 'boolean' then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
    keep := (p_payload ->> 'keep_photo')::boolean;
  end if;
  if pid is not null and keep then raise exception 'invalid_area: photo' using errcode = '22023'; end if;
  norm := public.community_area_normalize(p_payload - 'idempotency_key');
  h := md5(norm::text || ':' || p_area_id::text || case when pid is not null then ':photo:' || pid::text when keep then ':keep' else '' end); -- the target area and the photo choice are part of what a key stands for

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
     and pub.attributes = norm -> 'attributes'
     and pid is null and (keep or not exists (select 1 from public.community_area_photos pp where pp.revision_id = pub.id and pp.state = 'attached')) then
    raise exception 'no_change' using errcode = 'P0001';
  end if;

  if pid is not null then
    select * into ph from public.community_area_photos where id = pid and owner_id = uid and state = 'staged' and revision_id is null for update;
    if not found then raise exception 'photo_not_found' using errcode = 'P0002'; end if;
    perform set_config('app.community_photo', '1', true);
  end if;
  if keep then
    select * into src from public.community_area_photos where revision_id = a.published_revision_id and state = 'attached' limit 1;
    if not found then raise exception 'no_photo_to_keep' using errcode = 'P0001'; end if;
  end if;
  select coalesce(max(revision_no), 0) + 1 into no_ from public.community_area_revisions where area_id = a.id;
  insert into public.community_area_revisions (area_id, revision_no, contributor_id, name, description, draw_kind, geometry, spots, area_m2,
                                               bbox_west, bbox_south, bbox_east, bbox_north, idempotency_key, payload_hash, attributes)
  values (a.id, no_, uid, norm ->> 'name', norm ->> 'description', norm ->> 'draw_kind',
          jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(norm -> 'ring')), norm -> 'spots', (norm ->> 'area_m2')::double precision,
          (norm #>> '{bbox,0}')::double precision, (norm #>> '{bbox,1}')::double precision, (norm #>> '{bbox,2}')::double precision, (norm #>> '{bbox,3}')::double precision,
          k, h, norm -> 'attributes')
  returning id, submitted_at into rid, at_;
  if pid is not null then
    update public.community_area_photos set state = 'attached', revision_id = rid, attached_at = now() where id = pid;
  elsif keep then
    insert into public.community_area_photos (owner_id, object_key, mime, bytes, sha256, width, height, caption, state, revision_id, attached_at)
    values (uid, src.object_key, src.mime, src.bytes, src.sha256, src.width, src.height, src.caption, 'attached', rid, now());
  end if;
  perform public.audit_log('area.submit', uid, null, rid::text, jsonb_build_object('revision_no', no_, 'revision', true, 'vertices', (norm ->> 'vertices')::integer, 'spots', jsonb_array_length(norm -> 'spots'), 'photo', pid is not null or keep));
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
       and o.name = new.name and o.description = new.description and o.draw_kind = new.draw_kind and o.geometry = new.geometry and o.spots = new.spots and o.attributes = new.attributes
       and coalesce(current_setting('app.community_photo', true), '') <> '1' and not exists (select 1 from public.community_area_photos ph where ph.revision_id = o.id)) then
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
    'name', r.name, 'description', r.description, 'geometry', r.geometry, 'spots', r.spots, 'area_m2', r.area_m2, 'attributes', r.attributes, 'photo', public.community_area_photo_of(r.id),
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
    'photo', (select jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height, 'caption', ph.caption, 'state', ph.state, 'sha256', ph.sha256) from public.community_area_photos ph where ph.revision_id = p_rev.id and ph.state in ('attached', 'rejected', 'removed') limit 1),
    'bbox', jsonb_build_array(p_rev.bbox_west, p_rev.bbox_south, p_rev.bbox_east, p_rev.bbox_north),
    'status', p_rev.status, 'submitted_at', p_rev.submitted_at, 'reviewed_at', p_rev.reviewed_at,
    'contributor_name', (select pr.display_name from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'contributor_code', (select pr.friend_code from public.profiles pr where pr.user_id = p_rev.contributor_id),
    'own', p_rev.contributor_id is not null and p_rev.contributor_id = p_uid,
    'has_published', p_area.published_revision_id is not null,
    'unpublished', p_area.unpublished_at is not null,
    'published', (select jsonb_build_object('revision_id', q.id, 'revision_no', q.revision_no, 'name', q.name, 'description', q.description, 'draw_kind', q.draw_kind,
                                            'geometry', q.geometry, 'spots', q.spots, 'area_m2', q.area_m2, 'attributes', q.attributes,
                                            'photo', (select jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height, 'caption', ph.caption, 'state', ph.state, 'sha256', ph.sha256) from public.community_area_photos ph where ph.revision_id = q.id and ph.state in ('attached', 'rejected', 'removed') limit 1))
                    from public.community_area_revisions q
                   where q.id = p_area.published_revision_id and q.area_id = p_area.id and q.id <> p_rev.id));
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
    'photo', (select jsonb_build_object('id', ph.id, 'width', ph.width, 'height', ph.height, 'caption', ph.caption, 'state', ph.state, 'reason', ph.removed_reason) from public.community_area_photos ph where ph.revision_id = r.id and ph.state in ('attached', 'rejected', 'removed') limit 1),
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_reason', r.review_reason,
    'published', a.published_revision_id = r.id and a.unpublished_at is null,
    'area_published', a.published_revision_id is not null and a.unpublished_at is null,
    'area_unpublished', a.unpublished_at is not null);
end;
$$;

create or replace function public.community_areas_forget(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- photos that are not part of a revision that stays public are due for deletion now (the next cleanup run deletes the object); every photo then loses its owner
  update public.community_area_photos p set delete_after = now() where p.owner_id = p_uid and p.state <> 'deleted'
     and not (p.state = 'attached' and exists (select 1 from public.community_area_revisions r where r.id = p.revision_id and r.status = 'approved'));
  update public.community_area_photos set owner_id = null where owner_id = p_uid;
  delete from public.community_area_revisions where contributor_id = p_uid and status <> 'approved';
  update public.community_area_revisions set contributor_id = null, idempotency_key = null, payload_hash = null where contributor_id = p_uid;
  update public.community_area_revisions set reviewed_by = null where reviewed_by = p_uid;
  delete from public.community_areas a where a.owner_id = p_uid and not exists (select 1 from public.community_area_revisions r where r.area_id = a.id);
  update public.community_areas set owner_id = null where owner_id = p_uid;
  update public.community_areas set unpublished_by = null where unpublished_by = p_uid;
end;
$$;

drop function public.review_community_area(uuid, text, text, boolean, integer, boolean);
create function public.review_community_area(p_revision_id uuid, p_decision text, p_reason text default null, p_award_xp boolean default false, p_xp_amount integer default null, p_republish boolean default false, p_drop_photo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.community_area_revisions%rowtype;
  ar public.community_areas%rowtype;
  why text;
  amt integer := null;
  applied integer := null;
  target text;
  again boolean := false;
  ph public.community_area_photos%rowtype;
  note text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_revision_id is null or p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'invalid_decision' using errcode = 'P0001'; end if;
  target := case p_decision when 'approve' then 'approved' else 'rejected' end;

  why := public.community_area_text(to_jsonb(p_reason), true);
  if why is null or char_length(why) > 500 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_decision = 'reject' and why = '' then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if coalesce(p_drop_photo, false) and (p_decision <> 'approve' or why = '' or char_length(why) > 400) then raise exception 'photo_reason_required' using errcode = 'P0001'; end if;
  if coalesce(p_award_xp, false) then
    if p_decision <> 'approve' then raise exception 'invalid_decision' using errcode = 'P0001'; end if;
    if p_xp_amount is null or p_xp_amount not in (100, 200, 300, 400, 500) then raise exception 'invalid_xp_amount' using errcode = 'P0001'; end if;
    amt := p_xp_amount;
  elsif p_xp_amount is not null then
    raise exception 'invalid_xp_amount' using errcode = 'P0001';
  end if;

  select * into r from public.community_area_revisions where id = p_revision_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status = target and r.reviewed_by = uid then
    return jsonb_build_object('revision_id', r.id, 'area_id', r.area_id, 'status', r.status, 'changed', false, 'xp_awarded', false, 'xp', 0);
  end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;

  if amt is not null then
    if r.contributor_id is null then raise exception 'no_recipient' using errcode = 'P0001'; end if;
    if r.contributor_id = uid then raise exception 'self_award_not_allowed' using errcode = 'P0001'; end if;
  end if;

  if p_decision = 'approve' then
    select * into ar from public.community_areas where id = r.area_id for update;
    again := ar.unpublished_at is not null;
    if again and not coalesce(p_republish, false) then raise exception 'area_unpublished' using errcode = 'P0001'; end if;
  end if;

  note := nullif(why, '');
  if coalesce(p_drop_photo, false) then
    select * into ph from public.community_area_photos where revision_id = r.id and state = 'attached' for update;
    if not found then raise exception 'no_photo' using errcode = 'P0001'; end if;
    note := 'Approved without the photo: ' || why;
  end if;
  update public.community_area_revisions
     set status = target, reviewed_at = now(), reviewed_by = uid, review_reason = note
   where id = r.id;
  if coalesce(p_drop_photo, false) then
    update public.community_area_photos set state = 'rejected', removed_at = now(), removed_by = uid, removed_reason = why, delete_after = now() + interval '7 days' where id = ph.id;
    perform public.audit_log('area.photo_reject', uid, r.contributor_id, ph.id::text, jsonb_build_object('revision_no', r.revision_no));
  end if;

  if p_decision = 'approve' then
    update public.community_areas set published_revision_id = r.id, unpublished_at = null, unpublished_reason = null, unpublished_by = null where id = r.area_id;
    if amt is not null then
      applied := public.award_xp(r.contributor_id, amt, 'community_area', 'area-revision:' || r.id::text, null, uid,
                                 jsonb_build_object('revision_no', r.revision_no));
      if applied is null then raise exception 'already_awarded' using errcode = 'P0001'; end if;
    end if;
    perform public.audit_log('area.approve', uid, r.contributor_id, r.id::text,
      jsonb_build_object('revision_no', r.revision_no, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0), 'self', r.contributor_id is not distinct from uid, 'republished', again, 'photo_dropped', coalesce(p_drop_photo, false)));
  else
    perform public.audit_log('area.reject', uid, r.contributor_id, r.id::text, jsonb_build_object('revision_no', r.revision_no));
  end if;
  return jsonb_build_object('revision_id', r.id, 'area_id', r.area_id, 'status', target, 'changed', true, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0));
end;
$$;

revoke all on function public.review_community_area(uuid, text, text, boolean, integer, boolean, boolean) from public, anon;
grant execute on function public.review_community_area(uuid, text, text, boolean, integer, boolean, boolean) to authenticated;

-- grants: the photo functions are for the Edge Functions (service role) only; the people functions need a signed-in user
revoke all on function public.stage_area_photo(uuid, text, text, integer, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.discard_staged_photo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.area_photo_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.photos_due_for_deletion(integer, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.mark_photo_deleted(uuid) from public, anon, authenticated;
grant execute on function public.stage_area_photo(uuid, text, text, integer, text, integer, integer, text) to service_role;
grant execute on function public.discard_staged_photo(uuid, uuid) to service_role;
grant execute on function public.area_photo_access(uuid, uuid) to service_role;
grant execute on function public.photos_due_for_deletion(integer, uuid[], uuid) to service_role;
grant execute on function public.mark_photo_deleted(uuid) to service_role;
revoke all on function public.get_my_area_photo(uuid) from public, anon;
revoke all on function public.remove_area_photo(uuid, text) from public, anon;
grant execute on function public.get_my_area_photo(uuid) to authenticated;
grant execute on function public.remove_area_photo(uuid, text) to authenticated;
