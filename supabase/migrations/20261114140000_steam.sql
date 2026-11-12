-- Steam simulator playtime (progression milestone, phase 6): linking a Steam account and turning playtime in approved simulators into XP, 10 XP per completed hour.
--
-- Where the minutes come from: only the edge functions (supabase/functions/steam-link, steam-sync, steam-sync-all) talk to Steam, with the project's Web API key as a function secret,
-- and they call the service-role-only functions below. The app never sends minutes, and no signed-in user can call steam_link or apply_steam_playtime.
-- No retroactive XP: linking records each approved game's playtime as a baseline (steam_app_state); only minutes played after that count. Relinking records a new baseline.
-- Steam reports total minutes per game. Each sync adds max(new total - last total, 0) per approved game (a total that falls is never negative), adds it to sim_minutes, and
-- awards one ledger row per completed hour (ref 'hour:<n>', so a repeat or a concurrent sync cannot award an hour twice). The part of an hour that is not complete stays in
-- sim_minutes. At most 500 hours are credited per sync; the rest is credited by the next syncs, so nothing is lost.
-- The link and its counters (steam_links) are kept when someone unlinks, so hours already awarded are never awarded again and the First Connection achievement stays.
-- Manual syncs have a cooldown (a setting, 60 minutes) that is claimed atomically and given back if Steam fails; the daily scheduled sync does not use it.
-- Nobody but the owner of a link learns anything about it, and the Steam id is never returned by any function the app can call.
-- steam_enabled (a setting, 0 for now) switches the feature on once the project's Steam key is in place.

insert into public.progression_settings (key, value) values ('steam_enabled', 0);

create table public.steam_apps (
  app_id bigint primary key check (app_id > 0),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true
);
comment on table public.steam_apps is 'The approved simulators: only playtime in these Steam apps earns XP. Read only by functions; changed only by a migration.';
insert into public.steam_apps (app_id, name) values
  (410340, 'Liftoff®: FPV Drone Racing'),
  (1432320, 'Liftoff®: Micro Drones'),
  (2398030, 'FPV LOGIC'),
  (1682970, 'Uncrashed : FPV Drone Simulator'),
  (641780, 'The Drone Racing League Simulator'),
  (1881200, 'TRYP FPV: Drone Racer Simulator');

create table public.steam_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  steam_id text unique check (steam_id is null or steam_id ~ '^[0-9]{17}$'),
  linked_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_manual_sync_at timestamptz,
  sim_minutes integer not null default 0 check (sim_minutes >= 0),
  hours_awarded integer not null default 0 check (hours_awarded >= 0),
  last_status text check (last_status in ('ok', 'private', 'error')),
  updated_at timestamptz not null default now()
);
comment on table public.steam_links is 'A person''s Steam link and playtime counters. steam_id is null after unlinking; the counters stay. Never readable by the app.';

create table public.steam_app_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  app_id bigint not null,
  last_total_minutes integer not null check (last_total_minutes >= 0),
  primary key (user_id, app_id)
);

alter table public.steam_apps enable row level security;
alter table public.steam_links enable row level security;
alter table public.steam_app_state enable row level security;
revoke all on public.steam_apps, public.steam_links, public.steam_app_state from anon, authenticated;

-- First Connection needs a source: a person who has ever linked a Steam account. The row is never deleted (except with the account), so it only ever goes up.
create or replace function public.user_metric(p_user uuid, p_metric text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return case p_metric
    when 'sim_hours' then (select count(*)::integer from public.xp_ledger where user_id = p_user and source = 'sim' and amount > 0)
    when 'attendance_verified_count' then (select count(*)::integer from public.xp_ledger where user_id = p_user and source = 'attendance' and amount > 0)
    when 'peak_tier' then coalesce((select peak_tier from public.user_xp where user_id = p_user), 1)
    when 'shared_trips_created' then coalesce((select value from public.user_counters where user_id = p_user and key = 'shared_trips_created'), 0)
    when 'steam_linked_ever' then (select count(*)::integer from public.steam_links where user_id = p_user)
    else 0
  end;
end;
$$;

-- { "410340": 1234, ... } as rows, keeping only the approved games. A value that is not a whole number of minutes (0 to 10 million) refuses the whole object.
create function public.steam_totals_clean(p jsonb)
returns table (app_id bigint, minutes integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid playtime'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[0-9]{1,12}$' or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,8}$' or (v #>> '{}')::bigint > 10000000 then raise exception 'invalid playtime'; end if;
    if exists (select 1 from public.steam_apps a where a.app_id = k::bigint and a.active) then
      app_id := k::bigint; minutes := (v #>> '{}')::integer; return next;
    end if;
  end loop;
end;
$$;

-- Service role only (the edge function after Steam has confirmed the person owns this Steam account). Links, takes the baseline, and unlocks First Connection.
create function public.steam_link(p_user uuid, p_steam_id text, p_totals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.setting_num('steam_enabled') is distinct from 1 then raise exception 'steam is not enabled'; end if;
  if p_user is null or p_steam_id is null or p_steam_id !~ '^[0-9]{17}$' then raise exception 'invalid steam link'; end if;
  if exists (select 1 from public.steam_links where steam_id = p_steam_id and user_id <> p_user) then raise exception 'this Steam account is already linked to another account'; end if;
  insert into public.steam_links (user_id, steam_id) values (p_user, p_steam_id)
    on conflict (user_id) do update set steam_id = excluded.steam_id, linked_at = now(), updated_at = now();
  delete from public.steam_app_state where user_id = p_user;
  insert into public.steam_app_state (user_id, app_id, last_total_minutes) select p_user, c.app_id, c.minutes from public.steam_totals_clean(p_totals) c;
  update public.steam_links set last_synced_at = now(), last_status = 'ok', updated_at = now() where user_id = p_user;
  perform public.evaluate_achievements(p_user);
  return jsonb_build_object('status', 'linked');
end;
$$;

-- Service role only. p_status 'ok' with the totals Steam gave, or 'private' / 'error' (recorded, nothing credited). Under a lock on the person's row, so two syncs at once
-- are applied one after the other, and the ledger's unique key stops an hour being awarded twice.
create function public.apply_steam_playtime(p_user uuid, p_totals jsonb, p_status text default 'ok')
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
  h integer;
  xp integer := round(public.setting_num('sim_xp_per_hour'))::integer;
begin
  if p_status is null or p_status not in ('ok', 'private', 'error') then raise exception 'invalid status'; end if;
  select * into l from public.steam_links where user_id = p_user for update;
  if not found or l.steam_id is null then return jsonb_build_object('status', 'not_linked'); end if;
  if p_status <> 'ok' then
    update public.steam_links set last_status = p_status, updated_at = now() where user_id = p_user;
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
  for h in l.hours_awarded + 1 .. target loop
    perform public.award_xp(p_user, xp, 'sim', 'hour:' || h::text, null, null);
  end loop;
  update public.steam_links set sim_minutes = newmin, hours_awarded = greatest(l.hours_awarded, target), last_synced_at = now(), last_status = 'ok', updated_at = now() where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'credited_minutes', added, 'hours_added', greatest(target - l.hours_awarded, 0), 'hours', greatest(l.hours_awarded, target));
end;
$$;

-- Service role only. Claims a manual sync: refused inside the cooldown, otherwise the time is stamped at once (so two tabs cannot both pass) and the previous stamp returned.
create function public.claim_manual_sync(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.steam_links%rowtype;
  cool interval := make_interval(mins => round(public.setting_num('steam_manual_cooldown_minutes'))::integer);
begin
  if public.setting_num('steam_enabled') is distinct from 1 then return jsonb_build_object('allowed', false, 'reason', 'disabled'); end if;
  select * into l from public.steam_links where user_id = p_user and steam_id is not null for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_linked'); end if;
  if l.last_manual_sync_at is not null and now() < l.last_manual_sync_at + cool then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown', 'retry_after_seconds', ceil(extract(epoch from (l.last_manual_sync_at + cool - now())))::integer);
  end if;
  update public.steam_links set last_manual_sync_at = now() where user_id = p_user;
  return jsonb_build_object('allowed', true, 'previous', l.last_manual_sync_at);
end;
$$;

-- Service role only. Gives the cooldown back when Steam did not answer, so a failure does not cost the person their sync.
create function public.release_manual_sync(p_user uuid, p_previous timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.steam_links set last_manual_sync_at = p_previous where user_id = p_user;
$$;

-- Service role only: the linked people whose last sync is more than 20 hours ago (never synced first), for the daily scheduled run.
create function public.list_steam_due(p_limit integer default 200)
returns table (user_id uuid, steam_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id, l.steam_id from public.steam_links l
   where l.steam_id is not null and public.setting_num('steam_enabled') = 1
     and (l.last_synced_at is null or l.last_synced_at < now() - interval '20 hours')
   order by l.last_synced_at nulls first, l.user_id
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- The caller's own Steam state, for the app. Never the Steam id.
create function public.my_steam()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  l public.steam_links%rowtype;
  cool interval := make_interval(mins => round(public.setting_num('steam_manual_cooldown_minutes'))::integer);
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into l from public.steam_links where user_id = uid;
  return jsonb_build_object(
    'enabled', public.setting_num('steam_enabled') = 1,
    'linked', found and l.steam_id is not null,
    'ever_linked', found,
    'hours', coalesce(l.hours_awarded, 0),
    'minutes_to_next', case when found then greatest(l.sim_minutes - l.hours_awarded * 60, 0) else 0 end,
    'last_synced_at', l.last_synced_at,
    'last_status', l.last_status,
    'manual_available_at', case when found and l.last_manual_sync_at is not null and now() < l.last_manual_sync_at + cool then l.last_manual_sync_at + cool else null end,
    'xp_per_hour', round(public.setting_num('sim_xp_per_hour'))::integer);
end;
$$;

-- Ends the link (the counters and what was earned stay). The Steam account is then free to be linked by someone else, who starts from a new baseline.
create function public.unlink_steam()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.steam_links set steam_id = null, updated_at = now() where user_id = uid;
  delete from public.steam_app_state where user_id = uid;
  return jsonb_build_object('status', 'unlinked');
end;
$$;

-- The approved simulators, for the screen that explains what counts.
create function public.list_steam_apps()
returns table (app_id bigint, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query select a.app_id, a.name from public.steam_apps a where a.active order by lower(a.name), a.app_id;
end;
$$;

revoke all on function public.user_metric(uuid, text) from public, anon, authenticated;
revoke all on function public.steam_totals_clean(jsonb) from public, anon, authenticated;
revoke all on function public.steam_link(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_steam_playtime(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_manual_sync(uuid) from public, anon, authenticated;
revoke all on function public.release_manual_sync(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.list_steam_due(integer) from public, anon, authenticated;
revoke all on function public.my_steam() from public, anon;
revoke all on function public.unlink_steam() from public, anon;
revoke all on function public.list_steam_apps() from public, anon;
grant execute on function public.my_steam() to authenticated;
grant execute on function public.unlink_steam() to authenticated;
grant execute on function public.list_steam_apps() to authenticated;
