-- Shared trips (phase 1 of trips with friends).
--
-- A trip can be shared with friends. The shared trip is one document ({ v: 1, trip, items }: the trip and the markers tagged with it) kept on the
-- server with a revision number, the same way the personal cloud copy is. The owner invites accepted friends; a friend who accepts becomes a party
-- member and can edit the trip and its markers (add, change, reorder, remove). Only the owner can delete the trip or manage who is in it.
-- Every save is kept as an earlier version for 30 days (at most 20), so a mistaken change can be undone.
--
-- Security: row-level security is on for every table and there is no policy, so the tables cannot be read or written directly; everything goes
-- through the functions below, which read the caller from auth.uid() and check membership and role. Members are named by their own random ids; no
-- function returns another person's user id. A document with a Home marker or a check-in is refused, so a person's home and where they have
-- been are never shared by accident.

create table public.shared_trips (
  id uuid primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  doc jsonb not null,
  rev bigint not null default 1 check (rev >= 1),
  members_rev bigint not null default 1,
  name text not null check (char_length(name) between 1 and 80),
  markers integer not null default 0 check (markers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint shared_trips_doc_shape check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) <= 1000000)
);
create index shared_trips_owner on public.shared_trips (owner);
comment on table public.shared_trips is 'One document per shared trip (the trip and its markers) with a revision for conflict detection.';

create table public.shared_trip_versions (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  rev bigint not null,
  doc jsonb not null,
  updated_at timestamptz not null,
  updated_by uuid references auth.users (id) on delete set null,
  markers integer not null default 0,
  primary key (trip_id, rev)
);
comment on table public.shared_trip_versions is 'Earlier versions of a shared trip, kept for 30 days (at most 20).';

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  status text not null check (status in ('invited', 'joined')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (trip_id, user_id)
);
create index trip_members_user on public.trip_members (user_id);
comment on table public.trip_members is 'Who is in a shared trip: the owner, invited friends and party members who joined.';

alter table public.shared_trips enable row level security;
alter table public.shared_trip_versions enable row level security;
alter table public.trip_members enable row level security;
revoke all on public.shared_trips from anon, authenticated;
revoke all on public.shared_trip_versions from anon, authenticated;
revoke all on public.trip_members from anon, authenticated;

-- Checks a shared-trip document. Raises an error naming the problem.
create function public.check_trip_doc(p_doc jsonb, p_trip uuid)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_doc) is distinct from 'object' then raise exception 'the trip must be an object'; end if;
  if p_doc->>'v' is distinct from '1' then raise exception 'unsupported trip version'; end if;
  if jsonb_typeof(p_doc->'trip') is distinct from 'object' or p_doc->'trip'->>'id' is distinct from p_trip::text then raise exception 'the trip does not match'; end if;
  if char_length(coalesce(p_doc->'trip'->>'name', '')) not between 1 and 80 then raise exception 'a trip needs a name of 1 to 80 characters'; end if;
  if jsonb_typeof(coalesce(p_doc->'items', '[]'::jsonb)) is distinct from 'array' then raise exception 'the markers must be a list'; end if;
  if jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)) > 500 then raise exception 'a shared trip holds at most 500 markers'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_doc->'items', '[]'::jsonb)) e
              where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'id') is distinct from 'string') then
    raise exception 'every marker needs an id';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_doc->'items', '[]'::jsonb)) e where e->>'type' = 'residence') then
    raise exception 'a Home marker cannot be shared';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_doc->'items', '[]'::jsonb)) e where e ? 'checkin') then
    raise exception 'check-ins are personal and cannot be shared';
  end if;
  if pg_column_size(p_doc) > 1000000 then raise exception 'the trip is too large'; end if;
end;
$$;

-- Is the caller a joined member (any role) of the trip? Internal.
create function public.is_party_member(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.trip_members where trip_id = p_trip and user_id = (select auth.uid()) and status = 'joined') $$;

-- Starts sharing a trip: the caller becomes its owner. The document's trip id becomes the shared trip's id. Returns { id, rev }.
create function public.share_trip(p_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  begin
    tid := (p_doc->'trip'->>'id')::uuid;
  exception when others then
    raise exception 'this trip cannot be shared (its id is not valid)';
  end;
  perform public.check_trip_doc(p_doc, tid);
  if (select count(*) from public.shared_trips where owner = uid) >= 20 then raise exception 'you share the most trips you can (20)'; end if;
  if exists (select 1 from public.shared_trips where id = tid) then raise exception 'this trip is already shared'; end if;
  insert into public.shared_trips (id, owner, doc, name, markers, updated_by)
  values (tid, uid, p_doc, p_doc->'trip'->>'name', jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)), uid);
  insert into public.trip_members (trip_id, user_id, role, status, joined_at) values (tid, uid, 'owner', 'joined', now());
  return jsonb_build_object('id', tid, 'rev', 1);
end;
$$;

-- Invites a friend (by the friendship's id from list_friends) to a trip the caller owns.
create function public.invite_to_trip(p_trip uuid, p_friendship uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  fr public.friendships%rowtype;
  other uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.shared_trips where id = p_trip and owner = uid) then raise exception 'trip not found'; end if;
  select * into fr from public.friendships where id = p_friendship and status = 'accepted' and uid in (requester, addressee);
  if not found then raise exception 'you can only invite friends'; end if;
  other := case when fr.requester = uid then fr.addressee else fr.requester end;
  if exists (select 1 from public.trip_members where trip_id = p_trip and user_id = other) then raise exception 'already invited or in the trip'; end if;
  if (select count(*) from public.trip_members where trip_id = p_trip) >= 10 then raise exception 'a trip holds at most 10 people'; end if;
  insert into public.trip_members (trip_id, user_id, role, status, invited_by) values (p_trip, other, 'editor', 'invited', uid);
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'invited');
end;
$$;

-- Accepts or declines an invitation the caller received.
create function public.respond_trip_invite(p_trip uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = uid and status = 'invited') then raise exception 'invitation not found'; end if;
  if p_accept then
    update public.trip_members set status = 'joined', joined_at = now() where trip_id = p_trip and user_id = uid;
    update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
    return jsonb_build_object('status', 'joined');
  end if;
  delete from public.trip_members where trip_id = p_trip and user_id = uid;
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'declined');
end;
$$;

-- A party member leaves (or an invited person withdraws). The owner cannot leave; they delete the trip instead.
create function public.leave_trip(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.trip_members where trip_id = p_trip and user_id = uid and role <> 'owner';
  if not found then raise exception 'not found'; end if;
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'left');
end;
$$;

-- The owner removes someone (the member's id comes from list_trip_members) or cancels an invitation.
create function public.remove_member(p_trip uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.shared_trips where id = p_trip and owner = uid) then raise exception 'trip not found'; end if;
  delete from public.trip_members where id = p_member and trip_id = p_trip and role <> 'owner';
  if not found then raise exception 'not found'; end if;
  update public.shared_trips set members_rev = members_rev + 1 where id = p_trip;
  return jsonb_build_object('status', 'removed');
end;
$$;

-- Deletes a shared trip for everyone, with its versions. Only the owner. (Each person's own copy stays on their device as a private trip.)
create function public.delete_shared_trip(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.shared_trips where id = p_trip and owner = uid;
  if not found then raise exception 'trip not found'; end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

-- The caller's shared trips and invitations. No document is returned here (see get_shared_trip), so an invited person sees only the name, the dates and who invited them.
create function public.list_my_trips()
returns table (id uuid, name text, role text, status text, owner_name text, rev bigint, members_rev bigint, markers integer, start_date text, end_date text, members integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select t.id, t.name, m.role, m.status, coalesce(p.display_name, 'Someone'), t.rev, t.members_rev, t.markers,
           t.doc->'trip'->>'startDate', t.doc->'trip'->>'endDate',
           (select count(*)::int from public.trip_members x where x.trip_id = t.id and x.status = 'joined'), t.updated_at
      from public.trip_members m
      join public.shared_trips t on t.id = m.trip_id
      left join public.profiles p on p.user_id = t.owner
     where m.user_id = uid
     order by m.status desc, t.updated_at desc, t.id;
end;
$$;

-- Who is in a trip (joined members and pending invitations), for a joined member. member_id is for remove_member; is_me marks the caller.
create function public.list_trip_members(p_trip uuid)
returns table (member_id uuid, display_name text, role text, status text, is_me boolean, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  return query
    select m.id, coalesce(p.display_name, 'Someone'), m.role, m.status, m.user_id = uid, coalesce(m.joined_at, m.created_at)
      from public.trip_members m left join public.profiles p on p.user_id = m.user_id
     where m.trip_id = p_trip
     order by case m.role when 'owner' then 0 else 1 end, case m.status when 'joined' then 0 else 1 end, lower(coalesce(p.display_name, '')), m.id;
end;
$$;

-- The shared trip's document, for a joined member. Returns { doc, rev, updated_at, updated_by_name, role }.
create function public.get_shared_trip(p_trip uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t public.shared_trips%rowtype;
  who text;
  r text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  select * into t from public.shared_trips where id = p_trip;
  select display_name into who from public.profiles where user_id = t.updated_by;
  select role into r from public.trip_members where trip_id = p_trip and user_id = uid;
  return jsonb_build_object('doc', t.doc, 'rev', t.rev, 'updated_at', t.updated_at, 'updated_by_name', coalesce(who, 'Someone'), 'role', r);
end;
$$;

-- Saves the document (any joined member). Returns { status: 'ok' | 'conflict', rev, updated_at, updated_by_name }. A save from an older revision than the
-- server's is a conflict: the app fetches the newer version, merges the two and saves again. The replaced version is kept for 30 days (at most 20).
create function public.save_shared_trip(p_trip uuid, p_doc jsonb, p_base_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t public.shared_trips%rowtype;
  me text;
  new_rev bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  perform public.check_trip_doc(p_doc, p_trip);
  select * into t from public.shared_trips where id = p_trip for update;
  select display_name into me from public.profiles where user_id = uid;
  if p_base_rev is distinct from t.rev then
    return jsonb_build_object('status', 'conflict', 'rev', t.rev, 'updated_at', t.updated_at,
                              'updated_by_name', coalesce((select display_name from public.profiles where user_id = t.updated_by), 'Someone'));
  end if;
  insert into public.shared_trip_versions (trip_id, rev, doc, updated_at, updated_by, markers) values (t.id, t.rev, t.doc, t.updated_at, t.updated_by, t.markers);
  new_rev := t.rev + 1;
  update public.shared_trips
     set doc = p_doc, rev = new_rev, name = p_doc->'trip'->>'name', markers = jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)), updated_at = now(), updated_by = uid
   where id = t.id;
  delete from public.shared_trip_versions where trip_id = t.id and (updated_at < now() - interval '30 days' or rev <= new_rev - 20);
  return jsonb_build_object('status', 'ok', 'rev', new_rev, 'updated_at', now(), 'updated_by_name', coalesce(me, 'Someone'));
end;
$$;

-- The earlier versions of a shared trip, newest first, for a joined member.
create function public.list_shared_trip_versions(p_trip uuid)
returns table (rev bigint, updated_at timestamptz, updated_by_name text, markers integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  return query
    select v.rev, v.updated_at, coalesce(p.display_name, 'Someone'), v.markers
      from public.shared_trip_versions v left join public.profiles p on p.user_id = v.updated_by
     where v.trip_id = p_trip order by v.rev desc;
end;
$$;

-- Makes an earlier version the current one (as a new revision, so the restore can itself be undone). Any joined member.
create function public.restore_shared_trip_version(p_trip uuid, p_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_trip_versions%rowtype;
  cur bigint;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  select * into v from public.shared_trip_versions where trip_id = p_trip and rev = p_rev;
  if not found then raise exception 'that version no longer exists'; end if;
  select rev into cur from public.shared_trips where id = p_trip;
  return public.save_shared_trip(p_trip, v.doc, cur);
end;
$$;

-- The owner's friends who are not yet in the trip (and have no invitation): friendship_id is what invite_to_trip takes.
create function public.list_invitable_friends(p_trip uuid)
returns table (friendship_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.shared_trips where id = p_trip and owner = uid) then raise exception 'trip not found'; end if;
  return query
    select f.id, p.display_name
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = uid then f.addressee else f.requester end
     where f.status = 'accepted' and uid in (f.requester, f.addressee)
       and not exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = p.user_id)
     order by lower(p.display_name), f.id;
end;
$$;

-- Only signed-in users may call the public ones; the helpers are internal.
revoke all on function public.check_trip_doc(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.is_party_member(uuid) from public, anon, authenticated;
revoke all on function public.share_trip(jsonb) from public, anon;
revoke all on function public.invite_to_trip(uuid, uuid) from public, anon;
revoke all on function public.respond_trip_invite(uuid, boolean) from public, anon;
revoke all on function public.leave_trip(uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.delete_shared_trip(uuid) from public, anon;
revoke all on function public.list_my_trips() from public, anon;
revoke all on function public.list_trip_members(uuid) from public, anon;
revoke all on function public.get_shared_trip(uuid) from public, anon;
revoke all on function public.save_shared_trip(uuid, jsonb, bigint) from public, anon;
revoke all on function public.list_shared_trip_versions(uuid) from public, anon;
revoke all on function public.restore_shared_trip_version(uuid, bigint) from public, anon;
revoke all on function public.list_invitable_friends(uuid) from public, anon;
grant execute on function public.share_trip(jsonb) to authenticated;
grant execute on function public.invite_to_trip(uuid, uuid) to authenticated;
grant execute on function public.respond_trip_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_trip(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.delete_shared_trip(uuid) to authenticated;
grant execute on function public.list_my_trips() to authenticated;
grant execute on function public.list_trip_members(uuid) to authenticated;
grant execute on function public.get_shared_trip(uuid) to authenticated;
grant execute on function public.save_shared_trip(uuid, jsonb, bigint) to authenticated;
grant execute on function public.list_shared_trip_versions(uuid) to authenticated;
grant execute on function public.restore_shared_trip_version(uuid, bigint) to authenticated;
grant execute on function public.list_invitable_friends(uuid) to authenticated;
