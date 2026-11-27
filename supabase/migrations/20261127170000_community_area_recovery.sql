-- Community Flying Areas: recovery of a contributor's own submissions on another device, and two moderation guards.
--
--   1. get_my_community_revision(p_revision_id): the full content of ONE revision, only for the account that submitted it (area.owner_id and revision.contributor_id both equal
--      the caller). Anyone else, a guest, an unknown id and an anonymised revision all get null, so the call never says whether another person's revision exists. Together with
--      list_my_community_areas (unchanged) it lets a signed-in contributor rebuild an editable local draft. Read-only: no row, audit event or XP changes.
--   2. Identical resubmission after a rejection is refused ('identical_to_rejected'): a BEFORE INSERT trigger compares the new revision's content with the same contributor's
--      rejected revisions (same name, description, draw kind, outline and setup spots, for the same area or, for a new area, any area). A replay of an idempotency key never inserts,
--      so it is unaffected; a withdrawn revision is not "rejected" and may be sent again; changing anything at all lets it through.
--   3. review_community_area gains p_republish (default false). Approving a revision of an area that an administrator UNPUBLISHED (published_revision_id is null and unpublished_at
--      is set) would put it back on the public map as a side effect, so it is refused ('area_unpublished') unless the administrator passes p_republish = true, which is audited
--      (area.approve metadata `republished`). Rejecting needs no confirmation. Every other behaviour, argument and result is unchanged; five-argument calls still work.
-- Errors: identical_to_rejected, area_unpublished (P0001).

create function public.get_my_community_revision(p_revision_id uuid)
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
    'name', r.name, 'description', r.description, 'draw_kind', r.draw_kind, 'geometry', r.geometry, 'spots', r.spots, 'area_m2', r.area_m2,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_reason', r.review_reason,
    'published', a.published_revision_id = r.id and a.unpublished_at is null,
    'area_published', a.published_revision_id is not null and a.unpublished_at is null,
    'area_unpublished', a.unpublished_at is not null);
end;
$$;

revoke all on function public.get_my_community_revision(uuid) from public, anon, authenticated;
grant execute on function public.get_my_community_revision(uuid) to authenticated;

-- ---- 2. identical resubmission after a rejection
create function public.community_revision_no_repeat()
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
       and o.name = new.name and o.description = new.description and o.draw_kind = new.draw_kind and o.geometry = new.geometry and o.spots = new.spots) then
    raise exception 'identical_to_rejected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger community_revision_no_repeat before insert on public.community_area_revisions
  for each row execute function public.community_revision_no_repeat();
revoke all on function public.community_revision_no_repeat() from public, anon, authenticated;

-- ---- 3. approval of a revision of an unpublished area needs an explicit decision
drop function public.review_community_area(uuid, text, text, boolean, integer);
create function public.review_community_area(p_revision_id uuid, p_decision text, p_reason text default null, p_award_xp boolean default false, p_xp_amount integer default null, p_republish boolean default false)
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
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_revision_id is null or p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'invalid_decision' using errcode = 'P0001'; end if;
  target := case p_decision when 'approve' then 'approved' else 'rejected' end;

  why := public.community_area_text(to_jsonb(p_reason), true);
  if why is null or char_length(why) > 500 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_decision = 'reject' and why = '' then raise exception 'reason_required' using errcode = 'P0001'; end if;
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

  update public.community_area_revisions
     set status = target, reviewed_at = now(), reviewed_by = uid, review_reason = nullif(why, '')
   where id = r.id;

  if p_decision = 'approve' then
    update public.community_areas set published_revision_id = r.id, unpublished_at = null, unpublished_reason = null, unpublished_by = null where id = r.area_id;
    if amt is not null then
      applied := public.award_xp(r.contributor_id, amt, 'community_area', 'area-revision:' || r.id::text, null, uid,
                                 jsonb_build_object('revision_no', r.revision_no));
      if applied is null then raise exception 'already_awarded' using errcode = 'P0001'; end if;
    end if;
    perform public.audit_log('area.approve', uid, r.contributor_id, r.id::text,
      jsonb_build_object('revision_no', r.revision_no, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0), 'self', r.contributor_id is not distinct from uid, 'republished', again));
  else
    perform public.audit_log('area.reject', uid, r.contributor_id, r.id::text, jsonb_build_object('revision_no', r.revision_no));
  end if;
  return jsonb_build_object('revision_id', r.id, 'area_id', r.area_id, 'status', target, 'changed', true, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0));
end;
$$;

revoke all on function public.review_community_area(uuid, text, text, boolean, integer, boolean) from public, anon;
grant execute on function public.review_community_area(uuid, text, text, boolean, integer, boolean) to authenticated;
