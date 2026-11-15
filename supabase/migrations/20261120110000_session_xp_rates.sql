-- The host reward amounts for the session screens: read-only, so the app states what close_session pays (never a copy in the code).
-- Signed-in people only: a guest does not host. security definer, because progression_settings is readable by no client role.

create function public.session_xp_rates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'host_base_xp', round(coalesce(public.setting_num('host_base_xp'), 0))::integer,
    'host_per_attendee_xp', round(coalesce(public.setting_num('host_per_attendee_xp'), 0))::integer)
$$;

revoke all on function public.session_xp_rates() from public, anon;
grant execute on function public.session_xp_rates() to authenticated;
