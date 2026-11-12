-- Achievements (progression milestone, phase 2): the definitions, the unlocks, the featured three, and the engine that unlocks them.
--
-- A definition is a row: a name, description, icon, rarity (fixed: common, rare, epic or legendary) and one rule, a metric and a threshold ("sim_hours at least 10").
-- Adding an achievement, including a seasonal one (season, starts_at, ends_at), is a new row; a new kind of rule is one new branch in user_metric.
-- Every metric only ever goes up, so an achievement is a historical milestone: user_achievements rows are never removed or changed, the first unlock time is kept, and a
-- later XP deduction cannot take an achievement away. The rank metric is peak_tier (the highest tier ever reached), not the current tier.
-- Metrics come only from data the server holds: the ledger (simulator hours and attendance are counted from their ledger rows, which are never deleted), user_xp
-- (peak tier) and a counter for shared trips created. A person who deletes a shared trip does not lose the achievement or the count.
--
-- evaluate_achievements runs inside the same transaction as the change that might unlock something (award_xp, a shared trip being created), and can be run again at any
-- time: it only adds what is earned and not yet unlocked. Nothing here is callable by a signed-in user except set_featured, which only chooses among the caller's own unlocks.

create table public.achievements (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  category text not null check (category ~ '^[a-z][a-z-]*$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null check (char_length(description) between 1 and 200),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  icon text not null check (icon ~ '^[a-z][a-z0-9-]*$'),
  metric text not null check (metric ~ '^[a-z][a-z_]*$'),
  threshold integer not null check (threshold >= 1),
  sort integer not null default 0,
  active boolean not null default true,
  season text check (season is null or char_length(season) between 1 and 40),
  starts_at timestamptz,
  ends_at timestamptz,
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);
comment on table public.achievements is 'Achievement definitions: data, not code. Rarity is fixed by difficulty. Read only by functions; changed only by a migration.';

create table public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_key text not null references public.achievements (key),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_key)
);
create index user_achievements_key on public.user_achievements (achievement_key);
comment on table public.user_achievements is 'What each person has unlocked, and when the first time was. Never changed or removed (an account deletion takes its rows with it).';

-- Up to three, in order, and only among what the person has unlocked (the composite key enforces that).
create table public.featured_achievements (
  user_id uuid not null,
  position integer not null check (position between 1 and 3),
  achievement_key text not null,
  primary key (user_id, position),
  unique (user_id, achievement_key),
  foreign key (user_id, achievement_key) references public.user_achievements (user_id, achievement_key) on delete cascade
);
comment on table public.featured_achievements is 'The up to three achievements a person shows on their profile.';

-- Counters for things that happen and cannot be recounted afterwards (a deleted shared trip is still a trip that was created).
create table public.user_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z_]*$'),
  value integer not null default 0 check (value >= 0),
  primary key (user_id, key)
);
comment on table public.user_counters is 'Monotonic event counters used as achievement metrics. Written only by internal functions and triggers.';

alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.featured_achievements enable row level security;
alter table public.user_counters enable row level security;
revoke all on public.achievements, public.user_achievements, public.featured_achievements, public.user_counters from anon, authenticated;

-- Fixes a gap in the phase 1 guard: deleting an administrator's account sets the actor of the adjustments they made to null (foreign key), which the append-only guard
-- refused, so that account could not be deleted. That one change (actor to null, because the actor's sign-in record is gone, nothing else different) is now allowed.
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
    return new;
  end if;
  raise exception 'the XP ledger is append-only';
end;
$$;

-- Unlocks are permanent: no change, no removal, except the cascade that removes a deleted account's rows.
create function public.user_achievements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  raise exception 'achievements are permanent';
end;
$$;
create trigger user_achievements_permanent before update or delete on public.user_achievements
  for each row execute function public.user_achievements_guard();
create trigger user_achievements_no_truncate before truncate on public.user_achievements
  for each statement execute function public.user_achievements_guard();

-- The value of a metric for a person. Every metric is monotonic. An unknown metric is 0, so a definition whose rule is not built yet simply never unlocks.
create function public.user_metric(p_user uuid, p_metric text)
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
    else 0
  end;
end;
$$;

-- Unlocks everything the person has earned and not yet unlocked. Safe to run any number of times; an existing unlock (and its time) is never touched.
create function public.evaluate_achievements(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  n integer := 0;
  got integer;
begin
  for a in
    select d.key, d.metric, d.threshold from public.achievements d
     where d.active
       and (d.starts_at is null or d.starts_at <= now()) and (d.ends_at is null or d.ends_at >= now())
       and not exists (select 1 from public.user_achievements u where u.user_id = p_user and u.achievement_key = d.key)
     order by d.sort, d.key
  loop
    if public.user_metric(p_user, a.metric) >= a.threshold then
      insert into public.user_achievements (user_id, achievement_key) values (p_user, a.key) on conflict do nothing;
      get diagnostics got = row_count;
      n := n + got;
    end if;
  end loop;
  return n;
end;
$$;

-- A counter that only goes up, then a check for new unlocks.
create function public.bump_counter(p_user uuid, p_key text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v integer;
begin
  insert into public.user_counters (user_id, key, value) values (p_user, p_key, 1)
    on conflict (user_id, key) do update set value = public.user_counters.value + 1
    returning value into v;
  perform public.evaluate_achievements(p_user);
  return v;
end;
$$;

-- Creating a shared trip counts, however the row got there. Deleting it later does not take the count back.
create function public.shared_trip_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bump_counter(new.owner, 'shared_trips_created');
  return new;
end;
$$;
create trigger shared_trips_count_created after insert on public.shared_trips
  for each row execute function public.shared_trip_created();

-- XP changed: record it as before, then unlock whatever the new total (or peak tier) has earned. A duplicate award changes nothing and unlocks nothing.
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
  if p_source is null or p_source not in ('sim', 'attendance', 'admin') then raise exception 'invalid award source'; end if;
  if abs(p_amount) > 100000 then raise exception 'amount too large'; end if;
  if p_source <> 'admin' and p_amount <= 0 then raise exception 'only an administrator adjustment can lower XP'; end if;
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

-- Chooses the caller's featured achievements: a list of up to three distinct keys, in order, all unlocked by the caller. Replaces the previous choice; an empty list clears it.
create function public.set_featured(p_keys jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ks text[];
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then raise exception 'featured must be a list'; end if;
  if jsonb_array_length(p_keys) > 3 then raise exception 'feature up to 3 achievements'; end if;
  if exists (select 1 from jsonb_array_elements(p_keys) e where jsonb_typeof(e) <> 'string') then raise exception 'featured must be a list of achievement keys'; end if;
  ks := array(select e #>> '{}' from jsonb_array_elements(p_keys) with ordinality t(e, i) order by i);
  if (select count(distinct x) from unnest(ks) x) <> coalesce(array_length(ks, 1), 0) then raise exception 'each achievement can be featured once'; end if;
  if exists (select 1 from unnest(ks) x where not exists (select 1 from public.user_achievements u where u.user_id = uid and u.achievement_key = x)) then
    raise exception 'you can only feature achievements you have unlocked';
  end if;
  delete from public.featured_achievements where user_id = uid;
  insert into public.featured_achievements (user_id, position, achievement_key) select uid, i, x from unnest(ks) with ordinality t(x, i);
  return jsonb_build_object('status', 'saved', 'featured', to_jsonb(ks));
end;
$$;

-- The launch set (16). Rarity reflects difficulty and does not change with how many people unlock it. Real-world flying achievements are not here: nothing records a flight yet.
-- steam_linked_ever has no source until the Steam phase, so First Connection stays locked until then.
insert into public.achievements (key, category, name, description, rarity, icon, metric, threshold, sort) values
  ('first-flight', 'simulator', 'First Flight', 'Complete 1 hour in an approved simulator.', 'common', 'takeoff', 'sim_hours', 1, 10),
  ('getting-comfortable', 'simulator', 'Getting Comfortable', 'Complete 10 hours in approved simulators.', 'common', 'gamepad', 'sim_hours', 10, 11),
  ('simulator-regular', 'simulator', 'Simulator Regular', 'Complete 50 hours in approved simulators.', 'rare', 'headset', 'sim_hours', 50, 12),
  ('sim-veteran', 'simulator', 'Sim Veteran', 'Complete 100 hours in approved simulators.', 'epic', 'medal', 'sim_hours', 100, 13),
  ('first-meetup', 'community', 'First Meetup', 'Attend 1 offline flight session.', 'common', 'handshake', 'attendance_verified_count', 1, 20),
  ('regular-flyer', 'community', 'Regular Flyer', 'Attend 5 offline flight sessions.', 'rare', 'calendar', 'attendance_verified_count', 5, 21),
  ('community-regular', 'community', 'Community Regular', 'Attend 10 offline flight sessions.', 'rare', 'group', 'attendance_verified_count', 10, 22),
  ('dedicated-member', 'community', 'Dedicated Member', 'Attend 25 offline flight sessions.', 'epic', 'badge', 'attendance_verified_count', 25, 23),
  ('familiar-face', 'community', 'Familiar Face', 'Attend 50 offline flight sessions.', 'legendary', 'star', 'attendance_verified_count', 50, 24),
  ('moving-up', 'progression', 'Moving Up', 'Reach the Cadet rank.', 'common', 'chevron-up', 'peak_tier', 3, 30),
  ('finding-your-wings', 'progression', 'Finding Your Wings', 'Reach the Pilot rank.', 'rare', 'wings', 'peak_tier', 5, 31),
  ('experienced-pilot', 'progression', 'Experienced Pilot', 'Reach the Advanced Pilot rank.', 'rare', 'compass', 'peak_tier', 7, 32),
  ('elite-aviator', 'progression', 'Elite Aviator', 'Reach the Veteran Pilot rank.', 'epic', 'shield', 'peak_tier', 9, 33),
  ('ace-pilot', 'progression', 'Ace Pilot', 'Reach the Ace rank.', 'legendary', 'crown', 'peak_tier', 10, 34),
  ('first-connection', 'platform', 'First Connection', 'Link a Steam account.', 'common', 'link', 'steam_linked_ever', 1, 40),
  ('planner', 'platform', 'Planner', 'Create your first shared flight trip.', 'common', 'map', 'shared_trips_created', 1, 41);

-- People who already share trips: the count and the unlock are real history (the trip's creation time), so they are kept; nothing else has history to restore.
insert into public.user_counters (user_id, key, value)
  select owner, 'shared_trips_created', count(*)::integer from public.shared_trips group by owner on conflict (user_id, key) do nothing;
insert into public.user_achievements (user_id, achievement_key, unlocked_at)
  select owner, 'planner', min(created_at) from public.shared_trips group by owner on conflict do nothing;
select public.evaluate_achievements(user_id) from public.user_xp;

revoke all on function public.user_achievements_guard() from public, anon, authenticated;
revoke all on function public.user_metric(uuid, text) from public, anon, authenticated;
revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;
revoke all on function public.bump_counter(uuid, text) from public, anon, authenticated;
revoke all on function public.shared_trip_created() from public, anon, authenticated;
revoke all on function public.award_xp(uuid, integer, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_featured(jsonb) from public, anon;
grant execute on function public.set_featured(jsonb) to authenticated;
