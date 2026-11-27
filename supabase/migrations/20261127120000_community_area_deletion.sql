-- Community Flying Areas, Phase 2: account deletion. delete_profile (and so delete_account, which calls it) gains one step, community_areas_forget(uid):
--   * revisions that were never approved (pending, rejected, withdrawn) and belong to the person are deleted;
--   * an area left with no revision is deleted; an area that keeps an approved revision stays, with its owner, contributor, reviewer and idempotency data set to NULL
--     (the geometry is public content, the link to the person is not);
--   * safe to run again: a second run finds nothing.
-- Everything else in delete_profile is the previous body (20261118100000_sessions_v2_core.sql) unchanged; audit rows are never deleted, area.* audit references are
-- cleared by the existing audit wipe step.

create function public.community_areas_forget(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.community_area_revisions where contributor_id = p_uid and status <> 'approved';
  update public.community_area_revisions set contributor_id = null, idempotency_key = null, payload_hash = null where contributor_id = p_uid;
  update public.community_area_revisions set reviewed_by = null where reviewed_by = p_uid;
  delete from public.community_areas a where a.owner_id = p_uid and not exists (select 1 from public.community_area_revisions r where r.area_id = a.id);
  update public.community_areas set owner_id = null where owner_id = p_uid;
end;
$$;

create or replace function public.delete_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  had boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  had := exists (select 1 from public.profiles where user_id = uid);
  perform public.leave_all_trips(uid);
  delete from public.friend_live_locations where user_id = uid;
  delete from public.friendships where uid in (requester, addressee);
  delete from public.blocks where blocker = uid;
  perform public.purge_user_sessions(uid);
  perform public.community_areas_forget(uid);
  perform set_config('uavzones.wipe_user', uid::text, true);
  delete from public.xp_ledger where user_id = uid;
  delete from public.user_achievements where user_id = uid;
  update public.audit_events
     set actor = case when actor = uid then null else actor end,
         subject = case when subject = uid then null else subject end
   where actor = uid or subject = uid;
  perform set_config('uavzones.wipe_user', '', true);
  delete from public.user_xp where user_id = uid;
  delete from public.featured_achievements where user_id = uid;
  delete from public.user_counters where user_id = uid;
  delete from public.session_attendance where user_id = uid;
  delete from public.steam_app_state where user_id = uid;
  delete from public.steam_links where user_id = uid;
  delete from public.profiles where user_id = uid;
  if had then perform public.audit_log('profile.delete', null, null, null, '{}'::jsonb); end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function public.community_areas_forget(uuid) from public, anon, authenticated;
revoke all on function public.delete_profile() from public, anon;
grant execute on function public.delete_profile() to authenticated;
