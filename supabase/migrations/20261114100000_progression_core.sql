-- Progression core (progression milestone, phase 1): the XP ledger, ranks, admin and organiser roles, and the administrator's XP adjustment.
--
-- XP is an append-only ledger (xp_ledger). Every award is one row, and a unique key on (user, source, ref) makes the same award impossible to record twice
-- (attendance: ref 'session:<id>'; simulator hours: ref 'hour:<n>'; administrator adjustments: a fresh id each). user_xp holds each person's running total and the
-- highest rank tier they have reached; it is kept up to date by a trigger in the same transaction as the ledger row, so the two cannot disagree.
-- A rank is never stored: rank_for(xp) works it out from the progression_ranks table, so changing XP changes the rank and nothing can edit a rank on its own.
-- The thresholds and earning rates are rows in progression_ranks and progression_settings, not constants in code.
--
-- Who can do what: nobody can read or write any of these tables directly (RLS on, no policy, no table privileges). The only inserter of XP is the internal function
-- award_xp, which no signed-in user can call. A signed-in administrator can change someone's XP through admin_adjust_xp, which needs a reason and is recorded with
-- the administrator's id. Administrators are rows in app_roles; the first one is added by the project owner with one SQL statement (see supabase/README.md).
-- Later phases add the achievements, the read functions and the earning sources (attendance, Steam) on top of award_xp.

create table public.progression_ranks (
  tier integer primary key check (tier >= 1),
  key text not null unique check (key ~ '^[a-z][a-z0-9-]*$'),
  name text not null check (char_length(name) between 1 and 40),
  min_xp integer not null unique check (min_xp >= 0),
  check (tier <> 1 or min_xp = 0)
);
comment on table public.progression_ranks is 'The rank ladder: cumulative XP needed for each tier. Read only by functions; changed only by a migration.';

create table public.progression_settings (
  key text primary key,
  value numeric not null
);
comment on table public.progression_settings is 'Earning rates and limits for progression. Read only by functions; changed only by a migration.';

-- XP must rise with the tier; checked on every change so a bad edit cannot leave a ladder that goes backwards.
create function public.progression_ranks_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.progression_ranks r
              where r.tier <> new.tier and r.tier <> coalesce(case when tg_op = 'UPDATE' then old.tier end, new.tier)
                and ((r.tier < new.tier and r.min_xp >= new.min_xp) or (r.tier > new.tier and r.min_xp <= new.min_xp))) then
    raise exception 'rank thresholds must rise with the tier';
  end if;
  return new;
end;
$$;
create trigger progression_ranks_order before insert or update on public.progression_ranks
  for each row execute function public.progression_ranks_check();

insert into public.progression_ranks (tier, key, name, min_xp) values
  (1, 'rookie', 'Rookie', 0),
  (2, 'trainee', 'Trainee', 100),
  (3, 'cadet', 'Cadet', 250),
  (4, 'novice', 'Novice', 450),
  (5, 'pilot', 'Pilot', 700),
  (6, 'skilled-pilot', 'Skilled Pilot', 1000),
  (7, 'advanced-pilot', 'Advanced Pilot', 1400),
  (8, 'expert-pilot', 'Expert Pilot', 1950),
  (9, 'veteran-pilot', 'Veteran Pilot', 2650),
  (10, 'ace', 'Ace', 3500);

insert into public.progression_settings (key, value) values
  ('sim_xp_per_hour', 10),
  ('attendance_xp', 50),
  ('steam_manual_cooldown_minutes', 60);

create table public.app_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'organiser')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.app_roles is 'Administrators and flight-session organisers. An administrator is also an organiser. The first administrator is added by the project owner.';

create table public.xp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount <> 0 or source = 'admin'),
  source text not null check (source in ('sim', 'attendance', 'admin')),
  ref text not null check (char_length(ref) between 1 and 100),
  reason text check (reason is null or char_length(reason) between 1 and 200),
  actor uuid references auth.users (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint xp_ledger_once unique (user_id, source, ref)
);
create index xp_ledger_user on public.xp_ledger (user_id, id desc);
comment on table public.xp_ledger is 'Every XP change, one row each, never edited or deleted (the rows of a deleted account go with it). The unique key stops a second award for the same thing.';

create table public.user_xp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  total integer not null default 0 check (total >= 0),
  peak_tier integer not null default 1 check (peak_tier >= 1),
  updated_at timestamptz not null default now()
);
comment on table public.user_xp is 'Running XP total and highest tier reached per person. Kept by the ledger trigger; never written by anything else.';

alter table public.progression_ranks enable row level security;
alter table public.progression_settings enable row level security;
alter table public.app_roles enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.user_xp enable row level security;
revoke all on public.progression_ranks, public.progression_settings, public.app_roles, public.xp_ledger, public.user_xp from anon, authenticated;

-- The tier a total of XP is worth: the highest tier whose threshold has been reached.
create function public.rank_for(p_xp integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(max(tier), 1) from public.progression_ranks where min_xp <= coalesce(p_xp, 0);
$$;

create function public.setting_num(p_key text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select value from public.progression_settings where key = p_key;
$$;

-- Does this person hold the role? An administrator counts as an organiser.
create function public.has_role(p_uid uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_roles where user_id = p_uid and (role = p_role or role = 'admin'));
$$;

-- The ledger is append-only. The one exception is the cascade that removes a deleted account's rows (the sign-in record is already gone by then).
create function public.xp_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  raise exception 'the XP ledger is append-only';
end;
$$;
create trigger xp_ledger_append_only before update or delete on public.xp_ledger
  for each row execute function public.xp_ledger_guard();
create trigger xp_ledger_no_truncate before truncate on public.xp_ledger
  for each statement execute function public.xp_ledger_guard();

-- Each ledger row moves the person's total and, if it reaches a higher tier than before, their peak tier (a high-water mark that a deduction never lowers).
create function public.xp_ledger_apply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.user_xp
     set total = total + new.amount,
         peak_tier = greatest(peak_tier, public.rank_for(total + new.amount)),
         updated_at = now()
   where user_id = new.user_id;
  if not found then
    insert into public.user_xp (user_id, total, peak_tier) values (new.user_id, new.amount, public.rank_for(new.amount));
  end if;
  return new;
end;
$$;
create trigger xp_ledger_totals after insert on public.xp_ledger
  for each row execute function public.xp_ledger_apply();

-- The only way XP is recorded. Returns the amount actually applied, or null when this exact award already exists (so repeating it changes nothing).
-- Lowering XP is for administrator adjustments only, and never takes a total below zero: the row records what was applied and, if less, what was asked for.
-- The person's user_xp row is locked first so two awards for one person at the same time are applied one after the other.
create function public.award_xp(p_user uuid, p_amount integer, p_source text, p_ref text, p_reason text default null, p_actor uuid default null, p_meta jsonb default '{}'::jsonb)
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
  return eff;
end;
$$;

-- The roles the caller holds, for the app to know which controls to show. Administrator implies organiser.
create function public.my_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('admin', exists (select 1 from public.app_roles where user_id = uid and role = 'admin'),
                            'organiser', public.has_role(uid, 'organiser'));
end;
$$;

-- Administrators only. The person is named by their friend code (the one handle people already share on purpose).
create function public.grant_role(p_friend_code text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'organiser') then raise exception 'unknown role'; end if;
  select user_id into target from public.profiles where friend_code = lower(btrim(coalesce(p_friend_code, '')));
  if not found then raise exception 'not found'; end if;
  insert into public.app_roles (user_id, role, granted_by) values (target, p_role, uid) on conflict (user_id, role) do nothing;
  return jsonb_build_object('status', 'granted');
end;
$$;

-- Administrators only. The last administrator cannot be removed, so the roles can always be managed.
create function public.revoke_role(p_friend_code text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'organiser') then raise exception 'unknown role'; end if;
  select user_id into target from public.profiles where friend_code = lower(btrim(coalesce(p_friend_code, '')));
  if not found then raise exception 'not found'; end if;
  if p_role = 'admin' then
    perform 1 from public.app_roles where role = 'admin' for update;
    if (select count(*) from public.app_roles where role = 'admin') <= 1
       and exists (select 1 from public.app_roles where role = 'admin' and user_id = target) then
      raise exception 'cannot remove the last administrator';
    end if;
  end if;
  delete from public.app_roles where user_id = target and role = p_role;
  return jsonb_build_object('status', 'revoked');
end;
$$;

-- Administrators only: add or remove XP for a person (by friend code), with a reason. The administrator, person, amount, reason and time are all in the ledger row.
-- An administrator cannot adjust their own XP. Rank and (in a later phase) achievements follow from the new total.
create function public.admin_adjust_xp(p_friend_code text, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  why text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  target uuid;
  applied integer;
  tot integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if why is null or char_length(why) > 200 then raise exception 'a reason of 1 to 200 characters is required'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then raise exception 'the amount must be a non-zero number up to 100000'; end if;
  select user_id into target from public.profiles where friend_code = lower(btrim(coalesce(p_friend_code, '')));
  if not found then raise exception 'not found'; end if;
  if target = uid then raise exception 'administrators cannot adjust their own XP'; end if;
  applied := public.award_xp(target, p_amount, 'admin', gen_random_uuid()::text, why, uid);
  select total into tot from public.user_xp where user_id = target;
  return jsonb_build_object('status', 'adjusted', 'applied', applied, 'xp', tot, 'tier', public.rank_for(tot));
end;
$$;

-- Administrators only: how many people have a total that differs from the sum of their ledger (should always be 0).
create function public.admin_verify_xp()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.has_role(uid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select count(*)::integer from (
    select coalesce(x.user_id, l.user_id) from public.user_xp x
      full join (select user_id, sum(amount) as s from public.xp_ledger group by user_id) l on l.user_id = x.user_id
     where coalesce(x.total, 0) <> coalesce(l.s, 0)) bad);
end;
$$;

revoke all on function public.progression_ranks_check() from public, anon, authenticated;
revoke all on function public.rank_for(integer) from public, anon, authenticated;
revoke all on function public.setting_num(text) from public, anon, authenticated;
revoke all on function public.has_role(uuid, text) from public, anon, authenticated;
revoke all on function public.xp_ledger_guard() from public, anon, authenticated;
revoke all on function public.xp_ledger_apply() from public, anon, authenticated;
revoke all on function public.award_xp(uuid, integer, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.my_roles() from public, anon;
revoke all on function public.grant_role(text, text) from public, anon;
revoke all on function public.revoke_role(text, text) from public, anon;
revoke all on function public.admin_adjust_xp(text, integer, text) from public, anon;
revoke all on function public.admin_verify_xp() from public, anon;
grant execute on function public.my_roles() to authenticated;
grant execute on function public.grant_role(text, text) to authenticated;
grant execute on function public.revoke_role(text, text) to authenticated;
grant execute on function public.admin_adjust_xp(text, integer, text) to authenticated;
grant execute on function public.admin_verify_xp() to authenticated;
