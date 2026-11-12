-- Deleting a profile and deleting an account (account and profile milestone, phase E, AC-10).
--
-- delete_profile (the "Delete my profile and friends" button): removes the profile, friendships, blocks the caller made, live positions, and the caller's place in
-- shared trips. It leaves the cloud copy (user_data) alone: that has its own delete button.
-- delete_account (the "Delete my account" flow): the same, plus the cloud copy and its earlier versions. The sign-in record (auth.users) cannot be removed by a SQL
-- function the API can call; the delete-account edge function (supabase/functions/delete-account) calls this function as the user, then removes the sign-in
-- record with the service-role key. Both functions can be run again after a partial failure.
--
-- A trip the caller owns: if anyone else has joined, ownership passes to the member who joined first (they become the owner; the trip, its document and its
-- versions stay for the party); if nobody else has joined, the trip is deleted, and so are its pending invitations. In trips the caller only edits, they leave.
-- Every affected trip gets a new members_rev, so the others' apps notice.

create function public.leave_all_trips(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  successor uuid;
begin
  for t in select trip_id from public.trip_members where user_id = p_uid and role = 'owner' and status = 'joined' loop
    select user_id into successor from public.trip_members
     where trip_id = t.trip_id and status = 'joined' and user_id <> p_uid
     order by joined_at nulls last, created_at, id limit 1;
    if successor is null then
      delete from public.shared_trips where id = t.trip_id; -- members and versions go with it
    else
      update public.trip_members set role = 'owner' where trip_id = t.trip_id and user_id = successor;
      update public.shared_trips set owner = successor, members_rev = members_rev + 1 where id = t.trip_id;
      delete from public.trip_members where trip_id = t.trip_id and user_id = p_uid;
    end if;
  end loop;
  -- every other place in a trip (joined editor, pending invitation)
  update public.shared_trips set members_rev = members_rev + 1 where id in (select trip_id from public.trip_members where user_id = p_uid);
  delete from public.trip_members where user_id = p_uid;
  delete from public.live_locations where user_id = p_uid;
end;
$$;

create or replace function public.delete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.leave_all_trips(uid);
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  delete from public.profiles where user_id = uid;
  return jsonb_build_object('status', 'deleted');
end;
$$;

create function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.delete_profile();
  delete from public.user_data_versions where user_id = uid;
  delete from public.user_data where user_id = uid;
  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function public.leave_all_trips(uuid) from public, anon, authenticated;
revoke all on function public.delete_profile() from public, anon;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_profile() to authenticated;
grant execute on function public.delete_account() to authenticated;
