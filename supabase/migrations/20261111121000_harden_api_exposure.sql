-- Tidy up what the platform exposes through the API.
--
-- "Automatic RLS" (an option chosen when the project was created) installs an event trigger and a SECURITY DEFINER function,
-- public.rls_auto_enable(), that switches row-level security on for every new table. By default the anonymous and signed-in API roles may
-- execute it, which the security advisor reports: it returns event_trigger, so it cannot actually be run as a normal call, but nothing
-- outside the database has any reason to reach it. Firing the event trigger does not need the API roles to have this privilege.
-- (Guarded: the function does not exist in a plain database, such as the one the tests use.)
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
