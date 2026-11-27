-- Community Flying Areas, Phase 3: administrator moderation and the contribution XP reward.
--
--   * xp_ledger.source and award_xp gain 'community_area' (the previous body, 20261120100000_session_host_reward.sql, otherwise unchanged).
--   * list_pending_community_areas / list_published_community_areas (administrators only, oldest first, bounded pages), review_community_area (approve or reject),
--     unpublish_community_area. Every one checks public.has_role(auth.uid(), 'admin') itself; the client check is presentation only.
--   * Approval, the optional XP award (through award_xp, ledger key area-revision:<revision id>) and the area.approve audit event are one transaction.
--   * The unpublish reason is kept on the area row (community_areas.unpublished_reason); revision content and review records are never rewritten.
--
-- Errors: 'not signed in' (28000), 'not allowed' (42501), 'not_found' (P0002), 'not_pending', 'not_published', 'invalid_decision', 'reason_required', 'invalid_xp_amount',
-- 'self_award_not_allowed', 'no_recipient' (P0001).

alter table public.xp_ledger drop constraint xp_ledger_source_check;
alter table public.xp_ledger add constraint xp_ledger_source_check check (source in ('sim', 'attendance', 'admin', 'hosting', 'community_area'));

create or replace function public.award_xp(p_user uuid, p_amount integer, p_source text, p_ref text, p_reason text default null, p_actor uuid default null, p_meta jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur integer;
  eff integer;
  new_id bigint;
begin
  if p_user is null or p_amount is null or p_ref is null or char_length(p_ref) not between 1 and 100 then raise exception 'invalid award'; end if;
  if p_source is null or p_source not in ('sim', 'attendance', 'admin', 'hosting', 'community_area') then raise exception 'invalid award source'; end if;
  if abs(p_amount) > 100000 then raise exception 'amount too large'; end if;
  if p_amount <= 0 and not (p_source = 'admin'
                            or (p_source = 'attendance' and p_ref like 'session:%:rev')
                            or (p_source = 'hosting' and p_ref like 'session:%:adj:%')) then
    raise exception 'only an administrator adjustment can lower XP';
  end if;
  if p_amount = 0 then raise exception 'invalid award'; end if;
  insert into public.user_xp (user_id, total, peak_tier) values (p_user, 0, 1) on conflict (user_id) do nothing;
  select total into cur from public.user_xp where user_id = p_user for update;
  eff := greatest(p_amount, -cur);
  insert into public.xp_ledger (user_id, amount, source, ref, reason, actor, meta)
    values (p_user, eff, p_source, p_ref, p_reason, p_actor,
            coalesce(p_meta, '{}'::jsonb) || case when eff <> p_amount then jsonb_build_object('requested', p_amount) else '{}'::jsonb end)
    on conflict (user_id, source, ref) do nothing
    returning id into new_id;
  if new_id is null then return null; end if;
  perform public.evaluate_achievements(p_user);
  return eff;
end;
$$;
revoke all on function public.award_xp(uuid, integer, text, text, text, uuid, jsonb) from public, anon, authenticated;

alter table public.community_areas add column unpublished_reason text check (unpublished_reason is null or char_length(unpublished_reason) between 1 and 500);
alter table public.community_areas add column unpublished_by uuid references auth.users (id) on delete set null;

-- The deletion step also forgets the person as an unpublishing administrator.
create or replace function public.community_areas_forget(p_uid uuid)
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
  update public.community_areas set unpublished_by = null where unpublished_by = p_uid;
end;
$$;
revoke all on function public.community_areas_forget(uuid) from public, anon, authenticated;

-- Internal: one moderation item. Contributor identity (display name and friend code) is for administrators only and appears nowhere else.
create function public.community_area_admin_item(p_rev public.community_area_revisions, p_area public.community_areas, p_uid uuid)
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
    'unpublished', p_area.unpublished_at is not null);
$$;
revoke all on function public.community_area_admin_item(public.community_area_revisions, public.community_areas, uuid) from public, anon, authenticated;

-- Pending submissions, oldest first. p_cursor is the previous page's next_cursor ({ at, id }) or null. Returns { items, next_cursor }; at most 50 per page (default 20).
create function public.list_pending_community_areas(p_cursor jsonb default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  cat timestamptz; cid uuid; items jsonb; n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or jsonb_typeof(p_cursor -> 'at') is distinct from 'string' or jsonb_typeof(p_cursor -> 'id') is distinct from 'string' then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin cat := (p_cursor ->> 'at')::timestamptz; cid := (p_cursor ->> 'id')::uuid;
    exception when others then raise exception 'invalid cursor' using errcode = '22023'; end;
  end if;
  select coalesce(jsonb_agg(x.item order by x.submitted_at, x.id), '[]'::jsonb), count(*)::integer into items, n
    from (select r.id, r.submitted_at, public.community_area_admin_item(r, a, uid) as item
            from public.community_area_revisions r join public.community_areas a on a.id = r.area_id
           where r.status = 'pending' and (cat is null or (r.submitted_at, r.id) > (cat, cid))
           order by r.submitted_at, r.id
           limit lim + 1) x;
  if n > lim then
    return jsonb_build_object('items', items - lim, 'next_cursor', jsonb_build_object('at', items -> (lim - 1) ->> 'submitted_at', 'id', items -> (lim - 1) ->> 'revision_id'));
  end if;
  return jsonb_build_object('items', items, 'next_cursor', null);
end;
$$;

-- Currently published areas (the ones that can be unpublished), oldest publication first by revision submission. Same shape and paging.
create function public.list_published_community_areas(p_cursor jsonb default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  cat timestamptz; cid uuid; items jsonb; n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or jsonb_typeof(p_cursor -> 'at') is distinct from 'string' or jsonb_typeof(p_cursor -> 'id') is distinct from 'string' then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin cat := (p_cursor ->> 'at')::timestamptz; cid := (p_cursor ->> 'id')::uuid;
    exception when others then raise exception 'invalid cursor' using errcode = '22023'; end;
  end if;
  select coalesce(jsonb_agg(x.item order by x.submitted_at, x.id), '[]'::jsonb), count(*)::integer into items, n
    from (select r.id, r.submitted_at, public.community_area_admin_item(r, a, uid) as item
            from public.community_areas a join public.community_area_revisions r on r.id = a.published_revision_id and r.area_id = a.id
           where (cat is null or (r.submitted_at, r.id) > (cat, cid))
           order by r.submitted_at, r.id
           limit lim + 1) x;
  if n > lim then
    return jsonb_build_object('items', items - lim, 'next_cursor', jsonb_build_object('at', items -> (lim - 1) ->> 'submitted_at', 'id', items -> (lim - 1) ->> 'revision_id'));
  end if;
  return jsonb_build_object('items', items, 'next_cursor', null);
end;
$$;

-- Approve or reject one pending revision.
--   p_decision 'approve': publishes it (the area's published_revision_id; the bounding box is copied by the area trigger). p_reason is an optional note (500 characters).
--     p_award_xp true: p_xp_amount must be 100, 200, 300, 400 or 500; the recipient is the revision's contributor, never a caller-supplied id; the award uses award_xp with the
--     ledger key area-revision:<revision id>. Refused when the caller is the contributor (self-approval is allowed, self-reward is not).
--   p_decision 'reject': p_reason is required (1 to 500 characters), no XP.
-- The revision row is locked first, so two administrators cannot both finalise it. A stale request (the revision is no longer pending) fails with 'not_pending'; the same
-- decision by the same administrator repeated returns changed = false and does nothing.
create function public.review_community_area(p_revision_id uuid, p_decision text, p_reason text default null, p_award_xp boolean default false, p_xp_amount integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.community_area_revisions%rowtype;
  why text;
  amt integer := null;
  applied integer := null;
  target text;
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

  update public.community_area_revisions
     set status = target, reviewed_at = now(), reviewed_by = uid, review_reason = nullif(why, '')
   where id = r.id;

  if p_decision = 'approve' then
    perform 1 from public.community_areas where id = r.area_id for update;
    update public.community_areas set published_revision_id = r.id, unpublished_at = null, unpublished_reason = null, unpublished_by = null where id = r.area_id;
    if amt is not null then
      applied := public.award_xp(r.contributor_id, amt, 'community_area', 'area-revision:' || r.id::text, null, uid,
                                 jsonb_build_object('revision_no', r.revision_no));
      if applied is null then raise exception 'already_awarded' using errcode = 'P0001'; end if;
    end if;
    perform public.audit_log('area.approve', uid, r.contributor_id, r.id::text,
      jsonb_build_object('revision_no', r.revision_no, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0), 'self', r.contributor_id is not distinct from uid));
  else
    perform public.audit_log('area.reject', uid, r.contributor_id, r.id::text, jsonb_build_object('revision_no', r.revision_no));
  end if;
  return jsonb_build_object('revision_id', r.id, 'area_id', r.area_id, 'status', target, 'changed', true, 'xp_awarded', applied is not null, 'xp', coalesce(applied, 0));
end;
$$;

-- Take a published area off the public side. The revisions stay (approved) as history; the area is no longer eligible for any public read.
create function public.unpublish_community_area(p_area_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  a public.community_areas%rowtype;
  why text;
  rev public.community_area_revisions%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  why := public.community_area_text(to_jsonb(p_reason), true);
  if why is null or why = '' or char_length(why) > 500 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  select * into a from public.community_areas where id = p_area_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.published_revision_id is null then raise exception 'not_published' using errcode = 'P0001'; end if;
  select * into rev from public.community_area_revisions where id = a.published_revision_id;
  update public.community_areas set published_revision_id = null, unpublished_at = now(), unpublished_reason = why, unpublished_by = uid where id = a.id;
  perform public.audit_log('area.unpublish', uid, rev.contributor_id, a.id::text, jsonb_build_object('revision_no', rev.revision_no));
  return jsonb_build_object('area_id', a.id, 'status', 'unpublished', 'changed', true);
end;
$$;

revoke all on function public.list_pending_community_areas(jsonb, integer) from public, anon;
revoke all on function public.list_published_community_areas(jsonb, integer) from public, anon;
revoke all on function public.review_community_area(uuid, text, text, boolean, integer) from public, anon;
revoke all on function public.unpublish_community_area(uuid, text) from public, anon;
grant execute on function public.list_pending_community_areas(jsonb, integer) to authenticated;
grant execute on function public.list_published_community_areas(jsonb, integer) to authenticated;
grant execute on function public.review_community_area(uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.unpublish_community_area(uuid, text) to authenticated;
