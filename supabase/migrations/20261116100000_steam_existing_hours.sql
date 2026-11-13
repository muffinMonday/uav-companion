-- Steam: hours played before linking now count, once per Steam account. (Owner decision 2026-11-13; before this, linking recorded a baseline and only later minutes earned XP.)
-- 1. steam_credited remembers, per Steam account and approved game, the highest total playtime already counted for anybody. It is never deleted (not even with an account),
--    so a Steam account's history is paid out once: unlinking and linking it to another app account, or deleting an account and starting again, credits only new play.
-- 2. steam_link no longer takes a plain baseline: it stores, for each game, the lower of Steam's total and what steam_credited already holds, then applies the totals through
--    apply_steam_playtime (10 XP per completed hour, at most 500 hours per sync). A Steam account never seen before is therefore credited in full.
-- 3. Unlinking keeps the person's stored per-game totals, so relinking the same Steam account credits only what was played since.
--    steam_links.state_steam_id records which Steam account those totals belong to; linking a different one starts from steam_credited.
-- 4. Links made before this change: their stored totals count as already credited (steam_credited is filled from them). People who had earned nothing yet have their
--    totals removed, so their next sync credits everything.

alter table public.steam_links add column state_steam_id text;

create table public.steam_credited (
  steam_id text not null check (steam_id ~ '^[0-9]{17}$'),
  app_id bigint not null check (app_id > 0),
  minutes integer not null check (minutes >= 0),
  primary key (steam_id, app_id)
);
comment on table public.steam_credited is 'Highest total playtime per Steam account and approved game that has ever been counted, so the same hours are never paid out twice. Never readable by the app; not removed with an account.';
alter table public.steam_credited enable row level security;
revoke all on public.steam_credited from anon, authenticated;

insert into public.steam_credited (steam_id, app_id, minutes)
  select l.steam_id, s.app_id, s.last_total_minutes
  from public.steam_links l join public.steam_app_state s on s.user_id = l.user_id
  where l.steam_id is not null and (l.sim_minutes > 0 or l.hours_awarded > 0)
  on conflict (steam_id, app_id) do update set minutes = greatest(public.steam_credited.minutes, excluded.minutes);

update public.steam_links set state_steam_id = steam_id where steam_id is not null;
delete from public.steam_app_state s using public.steam_links l
  where l.user_id = s.user_id and l.steam_id is not null and l.sim_minutes = 0 and l.hours_awarded = 0;

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
    insert into public.steam_credited (steam_id, app_id, minutes) values (l.steam_id, r.app_id, r.minutes)
      on conflict (steam_id, app_id) do update set minutes = greatest(public.steam_credited.minutes, excluded.minutes);
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

create or replace function public.steam_link(p_user uuid, p_steam_id text, p_totals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.steam_links%rowtype;
  had boolean;
begin
  if public.setting_num('steam_enabled') is distinct from 1 then raise exception 'steam is not enabled'; end if;
  if p_user is null or p_steam_id is null or p_steam_id !~ '^[0-9]{17}$' then raise exception 'invalid steam link'; end if;
  if exists (select 1 from public.steam_links where steam_id = p_steam_id and user_id <> p_user) then raise exception 'this Steam account is already linked to another account'; end if;
  select * into l from public.steam_links where user_id = p_user for update;
  had := found;
  insert into public.steam_links (user_id, steam_id, state_steam_id) values (p_user, p_steam_id, p_steam_id)
    on conflict (user_id) do update set steam_id = excluded.steam_id, state_steam_id = excluded.state_steam_id, linked_at = now(), updated_at = now();
  if had and l.state_steam_id is not distinct from p_steam_id then
    null; -- the same Steam account again: the stored totals stay, only new minutes count
  elsif had and l.state_steam_id is null and (l.sim_minutes > 0 or l.hours_awarded > 0) then
    -- unlinked before this change (its totals were deleted): take a plain baseline so nothing is credited twice
    delete from public.steam_app_state where user_id = p_user;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes) select p_user, c.app_id, c.minutes from public.steam_totals_clean(p_totals) c;
  else
    -- a Steam account not stored for this person: what was ever counted for it (anybody) is the baseline, the rest counts
    delete from public.steam_app_state where user_id = p_user;
    insert into public.steam_app_state (user_id, app_id, last_total_minutes)
      select p_user, c.app_id, least(c.minutes, sc.minutes)
      from public.steam_totals_clean(p_totals) c join public.steam_credited sc on sc.steam_id = p_steam_id and sc.app_id = c.app_id;
  end if;
  perform public.apply_steam_playtime(p_user, p_totals, 'ok');
  perform public.evaluate_achievements(p_user);
  return jsonb_build_object('status', 'linked');
end;
$$;

create or replace function public.unlink_steam()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.steam_links set steam_id = null, updated_at = now() where user_id = uid; -- the stored totals and state_steam_id stay
  return jsonb_build_object('status', 'unlinked');
end;
$$;
