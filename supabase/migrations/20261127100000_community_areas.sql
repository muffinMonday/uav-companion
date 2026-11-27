-- Community Flying Areas, Phase 2: the tables (COMMUNITY_FLYING_AREAS_PLAN.md section 5). Submission, moderation, public reads and deletion arrive in later migrations;
-- this file only holds data and the rules that keep it consistent. No client role can touch these tables: every read and write is a security-definer function.
--
--   community_areas             one row per area: internal owner (NULL after the owner deletes the account), the published revision (NULL until Phase 3 approves one),
--                               and the published bounding box (copied from that revision by a trigger, never client-supplied).
--   community_area_revisions    one row per submitted version. Content is immutable; only the review state may change, and only from 'pending'.
--
-- Circularity: revisions.area_id -> areas (cascade) is the real parent link. areas.published_revision_id points back through a composite foreign key
-- (id, published_revision_id) -> revisions (area_id, id): the revision must belong to that very area. It is NULL on insert, so no deferral is needed, and it
-- is "no action", so a published revision cannot be deleted from under its area. A trigger additionally requires the published revision to be approved.

create table public.community_areas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  unpublished_at timestamptz,
  bbox_west double precision,
  bbox_south double precision,
  bbox_east double precision,
  bbox_north double precision,
  check ((bbox_west is null) = (published_revision_id is null) and (bbox_south is null) = (published_revision_id is null)
     and (bbox_east is null) = (published_revision_id is null) and (bbox_north is null) = (published_revision_id is null))
);

create table public.community_area_revisions (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.community_areas (id) on delete cascade,
  revision_no integer not null check (revision_no >= 1),
  contributor_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  draw_kind text not null default 'polygon' check (draw_kind in ('polygon', 'rectangle')),
  geometry jsonb not null check (jsonb_typeof(geometry) = 'object' and geometry ->> 'type' = 'Polygon'),
  spots jsonb not null default '[]'::jsonb check (jsonb_typeof(spots) = 'array' and jsonb_array_length(spots) <= 10),
  area_m2 double precision not null check (area_m2 >= 1 and area_m2 <= 25000000.5),
  bbox_west double precision not null check (bbox_west between -180 and 180),
  bbox_south double precision not null check (bbox_south between -90 and 90),
  bbox_east double precision not null check (bbox_east between -180 and 180),
  bbox_north double precision not null check (bbox_north between -90 and 90),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_reason text check (review_reason is null or char_length(review_reason) <= 500),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{32}$'),
  unique (area_id, revision_no),
  unique (area_id, id)
);

alter table public.community_areas
  add constraint community_areas_published_fk foreign key (id, published_revision_id)
  references public.community_area_revisions (area_id, id) match simple;

-- one pending revision per area; one idempotency key per contributor (NULL contributor = anonymised, no key kept); the five-pending count and owner lists use these
create unique index community_area_one_pending on public.community_area_revisions (area_id) where status = 'pending';
create unique index community_area_idem on public.community_area_revisions (contributor_id, idempotency_key) where idempotency_key is not null;
create index community_area_pending_by_user on public.community_area_revisions (contributor_id) where status = 'pending';
create index community_areas_owner on public.community_areas (owner_id);
create index community_areas_bbox on public.community_areas (bbox_west, bbox_east, bbox_south, bbox_north) where published_revision_id is not null;

comment on table public.community_areas is 'Community flying areas: internal owner (NULL after account deletion) and the published revision pointer. Never readable by a client role; read through controlled functions only.';
comment on table public.community_area_revisions is 'Submitted versions of a community area. Content is immutable; the status moves only from pending to approved, rejected or withdrawn. Never readable by a client role.';

alter table public.community_areas enable row level security;
alter table public.community_area_revisions enable row level security;
revoke all on public.community_areas from anon, authenticated;
revoke all on public.community_area_revisions from anon, authenticated;

-- Revisions: content is frozen at submission. Allowed changes: a pending revision gets a review result (status, reviewed_at/by, reason), and account deletion
-- anonymises (contributor, reviewer, idempotency key and hash may become NULL). Nothing else, ever.
create function public.community_revision_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.area_id, new.revision_no, new.name, new.description, new.draw_kind, new.geometry, new.spots, new.area_m2,
      new.bbox_west, new.bbox_south, new.bbox_east, new.bbox_north, new.submitted_at)
     is distinct from
     (old.id, old.area_id, old.revision_no, old.name, old.description, old.draw_kind, old.geometry, old.spots, old.area_m2,
      old.bbox_west, old.bbox_south, old.bbox_east, old.bbox_north, old.submitted_at) then
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
create trigger community_revision_immutable before update on public.community_area_revisions
  for each row execute function public.community_revision_guard();

-- Areas: the published revision must belong to this area (the foreign key) and be approved; the published bounding box is copied from it here, so no caller can set it.
create function public.community_area_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r public.community_area_revisions%rowtype;
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then raise exception 'an area id cannot change'; end if;
  if new.published_revision_id is null then
    new.bbox_west := null; new.bbox_south := null; new.bbox_east := null; new.bbox_north := null;
  else
    select * into r from public.community_area_revisions where id = new.published_revision_id and area_id = new.id;
    if not found or r.status <> 'approved' then raise exception 'only an approved revision of this area can be published'; end if;
    new.bbox_west := r.bbox_west; new.bbox_south := r.bbox_south; new.bbox_east := r.bbox_east; new.bbox_north := r.bbox_north;
  end if;
  return new;
end;
$$;
create trigger community_area_published before insert or update on public.community_areas
  for each row execute function public.community_area_guard();

revoke all on function public.community_revision_guard() from public, anon, authenticated;
revoke all on function public.community_area_guard() from public, anon, authenticated;
