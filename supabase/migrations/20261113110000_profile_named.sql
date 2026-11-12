-- Has this person chosen a display name yet? A new profile starts as "Pilot" with named = false, and the app asks for a name the first time the person signs in.
-- Existing profiles count as named. The flag turns true when a name is given (ensure_profile with a name), when the name changes (including through update_profile) or when choose_name is called
-- (what "Skip for now" uses, to keep the default name without being asked again). It is part of your own profile only: nobody else's lists carry it.
alter table public.profiles add column named boolean not null default false;
update public.profiles set named = true;

create function public.profile_named_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.named := true;
  return new;
end;
$$;

create trigger profiles_named_on_rename
before update on public.profiles
for each row when (new.display_name is distinct from old.display_name)
execute function public.profile_named_flag();

-- Your own profile, as before, now with `named`.
create or replace function public.ensure_profile(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  name text := public.clean_display_name(p_display_name);
  prof public.profiles%rowtype;
  code text;
  tries int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_display_name is not null and (char_length(name) < 1 or char_length(name) > 40) then
    raise exception 'a display name must be 1 to 40 characters';
  end if;
  select * into prof from public.profiles where user_id = uid;
  if not found then
    loop
      code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      begin
        insert into public.profiles (user_id, display_name, friend_code, named)
        values (uid, coalesce(nullif(name, ''), 'Pilot'), code, nullif(name, '') is not null)
        returning * into prof;
        exit;
      exception when unique_violation then
        tries := tries + 1;
        if tries > 10 then raise exception 'could not create a friend code, try again'; end if;
      end;
    end loop;
  elsif p_display_name is not null then
    update public.profiles set display_name = name, named = true, updated_at = now() where user_id = uid returning * into prof;
  end if;
  return jsonb_build_object('display_name', prof.display_name, 'friend_code', prof.friend_code, 'accepts_requests', prof.accepts_requests, 'show_online', prof.show_online,
                            'avatar', prof.avatar, 'bio', prof.bio, 'location', prof.location, 'interests', to_jsonb(prof.interests), 'share_profile', prof.share_profile,
                            'named', prof.named);
end;
$$;

-- The first-login answer: a name (1 to 40 characters) or null to keep the current one. Either way the person is not asked again. Returns your profile.
create function public.choose_name(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.ensure_profile(p_display_name);
  update public.profiles set named = true where user_id = uid and not named;
  return public.ensure_profile();
end;
$$;

revoke all on function public.profile_named_flag() from public, anon, authenticated;
revoke all on function public.choose_name(text) from public, anon;
grant execute on function public.choose_name(text) to authenticated;
