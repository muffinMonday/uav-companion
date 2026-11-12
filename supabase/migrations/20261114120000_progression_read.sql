-- Reading progression (progression milestone, phase 3): what a person's rank, XP and achievements look like to themselves and to others.
--
-- One internal function, progression_viewable, decides whether the caller may see someone's progression, and every read goes through it. The person is named the way the
-- app already knows them, never by user id: ('friend', the friendship id from list_friends) or ('member', the member id from list_trip_members or a live pin).
-- The caller may see it when ALL of these hold: the person is an accepted friend, or a joined member of a trip the caller has joined (or it is the caller); their
-- share_profile switch is on; and neither has blocked the other. Hidden, blocked, pending, not reachable and not found all give the same answer, { "visible": false },
-- so nothing can be learned from it (a block is never revealed). Your own is always visible.
--
-- What others see: rank, tier, exact XP, progress to the next rank, how many achievements are unlocked, the featured three, and every achievement with whether it is
-- unlocked (no unlock times). What only you see: unlock times and your XP history (my_xp_history: amount, kind, time, and the reason for an administrator adjustment).
-- Never returned to anyone: a user id, a Steam id, a ledger reference, who an administrator was.
-- The existing list_friends, list_trip_members and list_live_locations are unchanged; the app asks list_progression for the ids it is showing.

-- The person behind a handle, or null when the caller may not see their progression.
create function public.progression_viewable(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind = 'friend' then
    select case when f.requester = uid then f.addressee else f.requester end into t
      from public.friendships f where f.id = p_id and f.status = 'accepted' and uid in (f.requester, f.addressee);
  elsif p_kind = 'member' then
    select m.user_id into t
      from public.trip_members m
     where m.id = p_id and m.status = 'joined'
       and exists (select 1 from public.trip_members me where me.trip_id = m.trip_id and me.user_id = uid and me.status = 'joined');
  else
    raise exception 'invalid kind';
  end if;
  if t is null then return null; end if;
  if t = uid then return t; end if;
  if not exists (select 1 from public.profiles where user_id = t and share_profile) then return null; end if;
  if exists (select 1 from public.blocks where (blocker = uid and blocked = t) or (blocker = t and blocked = uid)) then return null; end if;
  return t;
end;
$$;

-- The progression of one person as json. p_full adds every achievement; p_times adds unlock times (for the person themselves only).
create function public.progression_payload(p_user uuid, p_full boolean, p_times boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  xp integer := coalesce((select total from public.user_xp where user_id = p_user), 0);
  t integer := public.rank_for(coalesce((select total from public.user_xp where user_id = p_user), 0));
  cur record;
  nxt record;
  res jsonb;
begin
  select key, name, min_xp into cur from public.progression_ranks where tier = t;
  select tier, name, min_xp into nxt from public.progression_ranks where tier > t order by tier limit 1;
  res := jsonb_build_object(
    'visible', true, 'xp', xp, 'tier', t, 'rank_key', cur.key, 'rank_name', cur.name, 'tier_min_xp', cur.min_xp,
    'next_min_xp', nxt.min_xp, 'next_name', nxt.name, 'max', nxt.min_xp is null,
    'unlocked_count', (select count(*)::integer from public.user_achievements where user_id = p_user),
    'featured', coalesce((select jsonb_agg(f.achievement_key order by f.position) from public.featured_achievements f where f.user_id = p_user), '[]'::jsonb));
  if p_full then
    res := res || jsonb_build_object('achievements', coalesce((
      select jsonb_agg(
               jsonb_build_object('key', d.key, 'category', d.category, 'name', d.name, 'description', d.description, 'rarity', d.rarity, 'icon', d.icon,
                                  'unlocked', u.user_id is not null)
               || case when p_times and u.user_id is not null then jsonb_build_object('unlocked_at', u.unlocked_at) else '{}'::jsonb end
               order by d.sort, d.key)
        from public.achievements d
        left join public.user_achievements u on u.achievement_key = d.key and u.user_id = p_user
       where u.user_id is not null
          or (d.active and (d.starts_at is null or d.starts_at <= now()) and (d.ends_at is null or d.ends_at >= now()))), '[]'::jsonb));
  end if;
  return res;
end;
$$;

-- One person, in full: rank, XP, progress and the whole achievement collection.
create function public.get_progression(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  t := public.progression_viewable(p_kind, p_id);
  if t is null then return jsonb_build_object('visible', false); end if;
  return public.progression_payload(t, true, t = uid);
end;
$$;

-- Many people, briefly (rank, XP, progress, featured keys), for the ids a list is showing. Each item carries the id it was asked for. At most 100 ids.
create function public.list_progression(p_kind text, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  i uuid;
  t uuid;
  res jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind is null or p_kind not in ('friend', 'member') then raise exception 'invalid kind'; end if;
  if p_ids is null then return res; end if;
  if cardinality(p_ids) > 100 then raise exception 'ask for at most 100 at a time'; end if;
  for i in select distinct x from unnest(p_ids) x loop
    t := public.progression_viewable(p_kind, i);
    res := res || jsonb_build_array(jsonb_build_object('id', i) || case when t is null then jsonb_build_object('visible', false) else public.progression_payload(t, false, false) end);
  end loop;
  return res;
end;
$$;

-- The caller's own progression, with unlock times.
create function public.my_progression()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return public.progression_payload(uid, true, true);
end;
$$;

-- The caller's own XP history, newest first: { items: [{ id, amount, source, reason, created_at }], next }. Pass the last id as p_before for the next page.
-- source is 'sim', 'attendance' or 'admin'; reason is only ever set for an administrator adjustment. Nothing about who made it or what it refers to.
create function public.my_xp_history(p_before bigint default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  n integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  items jsonb;
  last_id bigint;
  got integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'amount', q.amount, 'source', q.source, 'reason', q.reason, 'created_at', q.created_at) order by q.id desc), '[]'::jsonb),
         min(q.id), count(*)::integer
    into items, last_id, got
    from (select l.id, l.amount, l.source, case when l.source = 'admin' then l.reason else null end as reason, l.created_at
            from public.xp_ledger l
           where l.user_id = uid and (p_before is null or l.id < p_before)
           order by l.id desc limit n) q;
  return jsonb_build_object('items', items, 'next', case when got = n and exists (select 1 from public.xp_ledger where user_id = uid and id < last_id) then last_id else null end);
end;
$$;

revoke all on function public.progression_viewable(text, uuid) from public, anon, authenticated;
revoke all on function public.progression_payload(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_progression(text, uuid) from public, anon;
revoke all on function public.list_progression(text, uuid[]) from public, anon;
revoke all on function public.my_progression() from public, anon;
revoke all on function public.my_xp_history(bigint, integer) from public, anon;
grant execute on function public.get_progression(text, uuid) to authenticated;
grant execute on function public.list_progression(text, uuid[]) to authenticated;
grant execute on function public.my_progression() to authenticated;
grant execute on function public.my_xp_history(bigint, integer) to authenticated;
