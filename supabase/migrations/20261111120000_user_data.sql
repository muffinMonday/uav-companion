-- Cloud copy of a signed-in user's data (phase 1 of the backend).
--
-- One document per user: the markers, the trips (with notes, checklists and check-ins) and a few settings, exactly as the app keeps them in the
-- browser. Every write bumps a revision number; a write that was made from an older revision than the server's is refused (a conflict) unless
-- the caller asks to overwrite. The previous versions are kept for 30 days (at most 20) so an overwrite can be undone.
--
-- Security: row-level security is on for both tables. A signed-in user can read their own row and nothing else; nobody can write to the
-- tables directly. All writes go through the functions below, which check who is calling (auth.uid()), the size and the shape of the
-- document, and the revision. The anonymous role has no access at all.

create table public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  doc jsonb not null,
  rev bigint not null default 1 check (rev >= 1),
  updated_at timestamptz not null default now(),
  device text not null default '' check (char_length(device) <= 80),
  markers integer not null default 0 check (markers >= 0),
  trips integer not null default 0 check (trips >= 0),
  constraint user_data_doc_shape check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) <= 2000000)
);
comment on table public.user_data is 'One document per user (markers, trips, a few settings) with a revision for conflict detection.';

create table public.user_data_versions (
  user_id uuid not null references auth.users (id) on delete cascade,
  rev bigint not null,
  doc jsonb not null,
  updated_at timestamptz not null,
  device text not null default '',
  markers integer not null default 0,
  trips integer not null default 0,
  primary key (user_id, rev)
);
comment on table public.user_data_versions is 'Earlier versions of user_data, kept for 30 days (at most 20) so an overwrite can be undone.';

alter table public.user_data enable row level security;
alter table public.user_data_versions enable row level security;

-- Read your own row. There is no policy for any other command and no policy at all on the versions table: it is reached only through functions.
create policy user_data_select_own on public.user_data
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Whatever the platform grants by default, take it away; give back only what is meant.
revoke all on public.user_data from anon, authenticated;
revoke all on public.user_data_versions from anon, authenticated;
grant select on public.user_data to authenticated;

-- Saves the document. Returns { status: 'ok' | 'conflict', rev, updated_at, device, markers, trips }.
--   p_base_rev  the revision this device last synced from (null for a device that never has)
--   p_force     overwrite even if the server has moved on (the previous version is kept)
create function public.save_user_data(p_doc jsonb, p_base_rev bigint default null, p_device text default '', p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cur public.user_data%rowtype;
  new_rev bigint;
  dev text := left(coalesce(p_device, ''), 80);
  n_markers integer;
  n_trips integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'the document must be an object' using errcode = '22023'; end if;
  if coalesce(p_doc ->> 'v', '') <> '1' then raise exception 'unsupported document version' using errcode = '22023'; end if;
  if pg_column_size(p_doc) > 2000000 then raise exception 'the document is too large' using errcode = '54000'; end if;

  n_markers := case when jsonb_typeof(p_doc -> 'items') = 'array' then jsonb_array_length(p_doc -> 'items') else 0 end;
  n_trips := case when jsonb_typeof(p_doc -> 'trips') = 'array' then jsonb_array_length(p_doc -> 'trips') else 0 end;

  select * into cur from public.user_data where user_id = uid for update;

  if not found then
    insert into public.user_data (user_id, doc, rev, device, markers, trips) values (uid, p_doc, 1, dev, n_markers, n_trips);
    return jsonb_build_object('status', 'ok', 'rev', 1, 'updated_at', now(), 'device', dev, 'markers', n_markers, 'trips', n_trips);
  end if;

  if not p_force and p_base_rev is distinct from cur.rev then
    return jsonb_build_object('status', 'conflict', 'rev', cur.rev, 'updated_at', cur.updated_at, 'device', cur.device, 'markers', cur.markers, 'trips', cur.trips);
  end if;

  new_rev := cur.rev + 1;
  insert into public.user_data_versions (user_id, rev, doc, updated_at, device, markers, trips)
    values (uid, cur.rev, cur.doc, cur.updated_at, cur.device, cur.markers, cur.trips);
  update public.user_data
    set doc = p_doc, rev = new_rev, updated_at = now(), device = dev, markers = n_markers, trips = n_trips
    where user_id = uid;
  delete from public.user_data_versions
    where user_id = uid and (rev <= new_rev - 20 or updated_at < now() - interval '30 days');
  return jsonb_build_object('status', 'ok', 'rev', new_rev, 'updated_at', now(), 'device', dev, 'markers', n_markers, 'trips', n_trips);
end;
$$;

-- The earlier versions of my document, newest first (without the documents themselves).
create function public.list_user_data_versions()
returns table (rev bigint, updated_at timestamptz, device text, markers integer, trips integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.rev, v.updated_at, v.device, v.markers, v.trips
  from public.user_data_versions v
  where v.user_id = (select auth.uid())
  order by v.rev desc;
$$;

-- Makes an earlier version the current one, as a new revision (so the restore can itself be undone).
create function public.restore_user_data_version(p_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  old public.user_data_versions%rowtype;
  cur_rev bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into old from public.user_data_versions where user_id = uid and rev = p_rev;
  if not found then raise exception 'that version no longer exists' using errcode = 'P0002'; end if;
  select rev into cur_rev from public.user_data where user_id = uid;
  return public.save_user_data(old.doc, cur_rev, 'restored from version ' || p_rev, true);
end;
$$;

-- Deletes everything I have stored here (the document and all earlier versions).
create function public.delete_user_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.user_data_versions where user_id = uid;
  delete from public.user_data where user_id = uid;
end;
$$;

-- Only signed-in users may call these (functions are executable by everyone unless that is taken away).
revoke all on function public.save_user_data(jsonb, bigint, text, boolean) from public, anon;
revoke all on function public.list_user_data_versions() from public, anon;
revoke all on function public.restore_user_data_version(bigint) from public, anon;
revoke all on function public.delete_user_data() from public, anon;
grant execute on function public.save_user_data(jsonb, bigint, text, boolean) to authenticated;
grant execute on function public.list_user_data_versions() to authenticated;
grant execute on function public.restore_user_data_version(bigint) to authenticated;
grant execute on function public.delete_user_data() to authenticated;
