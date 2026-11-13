-- Steam: cheaper hour awards, and a daily run that cannot be blocked by people whose sync keeps failing (from the efficiency review).
--
-- 1. apply_steam_playtime awarded each new hour with its own award_xp call, and every call re-checked all the achievements: up to 500 hours meant 500 checks in
--    one transaction. The hours are now written to the ledger in one statement and the achievements are checked once. The result is the same: one ledger row
--    per hour ('hour:N', the unique key still stops an hour being paid twice), the same XP, the same achievements.
-- 2. list_steam_due put the people who had never synced successfully first, every day. Enough people with a private profile or a failing link took all 200
--    places of the daily run and nobody else was synced. Every attempt is now stamped (last_attempt_at) and the run takes the longest-waiting attempts first.
--
-- Same signatures and grants. Service role only, as before.

alter table public.steam_links add column last_attempt_at timestamptz;

create or replace function public.apply_steam_playtime(p_user uuid, p_totals jsonb, p_status text default 'ok')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.steam_links%rowtype;
  r record;
  prev integer;
  added bigint := 0;
  newmin bigint;
  target integer;
  xp integer := round(public.setting_num('sim_xp_per_hour'))::integer;
begin
  if p_status is null or p_status not in ('ok', 'private', 'error') then raise exception 'invalid status'; end if;
  select * into l from public.steam_links where user_id = p_user for update;
  if not found or l.steam_id is null then return jsonb_build_object('status', 'not_linked'); end if;
  if p_status <> 'ok' then
    update public.steam_links set last_status = p_status, last_attempt_at = now(), updated_at = now() where user_id = p_user;
    return jsonb_build_object('status', p_status);
  end if;
  for r in select * from public.steam_totals_clean(p_totals) loop
    select last_total_minutes into prev from public.steam_app_state where user_id = p_user and app_id = r.app_id;
    added := added + case when found then greatest(r.minutes - prev, 0) else r.minutes end;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes) values (p_user, r.app_id, r.minutes)
      on conflict (user_id, app_id) do update set last_total_minutes = excluded.last_total_minutes;
  end loop;
  newmin := l.sim_minutes + added;
  if newmin > 2000000000 then raise exception 'invalid playtime'; end if;
  target := least(newmin / 60, l.hours_awarded + 500)::integer;
  if target > l.hours_awarded then
    if xp is null or xp <= 0 then raise exception 'invalid award'; end if;
    -- what award_xp does for each hour, once for all of them: make sure the total exists, hold its row, write the ledger rows, check the achievements
    insert into public.user_xp (user_id, total, peak_tier) values (p_user, 0, 1) on conflict (user_id) do nothing;
    perform 1 from public.user_xp where user_id = p_user for update;
    insert into public.xp_ledger (user_id, amount, source, ref)
      select p_user, xp, 'sim', 'hour:' || g::text from generate_series(l.hours_awarded + 1, target) g
      on conflict (user_id, source, ref) do nothing;
    perform public.evaluate_achievements(p_user);
  end if;
  update public.steam_links set sim_minutes = newmin, hours_awarded = greatest(l.hours_awarded, target), last_synced_at = now(), last_attempt_at = now(), last_status = 'ok', updated_at = now() where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'credited_minutes', added, 'hours_added', greatest(target - l.hours_awarded, 0), 'hours', greatest(l.hours_awarded, target));
end;
$$;

-- The linked people whose last successful sync is more than 20 hours ago, the one waiting longest since an attempt first (never tried first).
create or replace function public.list_steam_due(p_limit integer default 200)
returns table (user_id uuid, steam_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id, l.steam_id from public.steam_links l
   where l.steam_id is not null and public.setting_num('steam_enabled') = 1
     and (l.last_synced_at is null or l.last_synced_at < now() - interval '20 hours')
   order by coalesce(l.last_attempt_at, l.last_synced_at) nulls first, l.user_id
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

create index steam_links_queue on public.steam_links ((coalesce(last_attempt_at, last_synced_at)) nulls first, user_id) where steam_id is not null;
