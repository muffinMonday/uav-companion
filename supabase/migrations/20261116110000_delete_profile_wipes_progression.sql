-- Deleting a profile now also wipes the person's progression (owner decision 2026-11-16): XP ledger and total, achievements, featured three, counters, verified attendance,
-- and the Steam link with its stored totals. Roles (app_roles) stay: they are granted by an administrator, not earned. steam_credited stays too, so a wiped person who
-- links the same Steam account again is not credited for hours that were already counted once.
--
-- The ledger and the unlocks are permanent (the ledger guard keeps the earlier allowance for forgetting a deleted administrator): their guards refused every delete unless the account was already gone. They now also allow a delete made by delete_profile, and only that:
-- delete_profile sets a transaction-local marker naming the person, and the guard accepts it only when the calling role is not one a client can be (a client's session
-- runs as anon / authenticated, so setting the marker from outside does nothing).

create or replace function public.xp_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if tg_op = 'UPDATE' and old.actor is not null and new.actor is null and not exists (select 1 from auth.users where id = old.actor)
     and (new.id, new.user_id, new.amount, new.source, new.ref, new.reason, new.meta, new.created_at)
         is not distinct from (old.id, old.user_id, old.amount, old.source, old.ref, old.reason, old.meta, old.created_at) then
    return new; -- from 20261114110000: deleting an administrator's account only forgets who made an adjustment
  end if;
  if tg_op = 'DELETE' and current_user not in ('anon', 'authenticated', 'service_role')
     and coalesce(current_setting('uavzones.wipe_user', true), '') = old.user_id::text then return old; end if;
  raise exception 'the XP ledger is append-only';
end;
$$;

create or replace function public.user_achievements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if tg_op = 'DELETE' and current_user not in ('anon', 'authenticated', 'service_role')
     and coalesce(current_setting('uavzones.wipe_user', true), '') = old.user_id::text then return old; end if;
  raise exception 'achievements are permanent';
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
  delete from public.session_rsvps where user_id = uid;
  perform set_config('uavzones.wipe_user', uid::text, true);
  delete from public.xp_ledger where user_id = uid;
  delete from public.user_achievements where user_id = uid;
  perform set_config('uavzones.wipe_user', '', true);
  delete from public.user_xp where user_id = uid;
  delete from public.featured_achievements where user_id = uid;
  delete from public.user_counters where user_id = uid;
  delete from public.session_attendance where user_id = uid;
  delete from public.steam_app_state where user_id = uid;
  delete from public.steam_links where user_id = uid;
  delete from public.profiles where user_id = uid;
  return jsonb_build_object('status', 'deleted');
end;
$$;
