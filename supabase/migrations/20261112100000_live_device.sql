-- One device at a time shares a person's live location in a trip.
--
-- Before: the position row is one per (person, trip), so two devices of the same account that were both sharing overwrote each other (the marker jumped between
-- the two places), shared one 2 s limit, and a stop or sign-out on one device deleted the row the other was still sending.
--
-- Now every call may carry a device id (a random string the browser makes once). The device that starts sharing most recently takes the row over (p_claim);
-- the previous device learns on its next position ({ status: 'moved' }) and stops. A stop from a device that does not hold the row does nothing. Calls
-- without a device id behave as before, so older app versions keep working.

alter table public.live_locations add column device text check (device is null or char_length(device) between 1 and 64);

drop function public.share_location(uuid, double precision, double precision, double precision);
drop function public.stop_sharing_location(uuid);
drop function public.stop_all_sharing();

-- Sends the caller's position for a trip (at most one every 2 s from the device that holds it). p_claim: this device has just started sharing and takes the
-- row over from another one. Returns { status: 'ok' | 'slow' | 'ended' | 'moved' }.
create function public.share_location(p_trip uuid, p_lat double precision, p_lon double precision, p_accuracy double precision default null, p_device text default null, p_claim boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  endd text;
  last_at timestamptz;
  holder text;
  has_row boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  if p_lat is null or p_lon is null or not (p_lat between -90 and 90) or not (p_lon between -180 and 180) then raise exception 'that is not a position'; end if;
  if p_accuracy is not null and not (p_accuracy between 0 and 100000) then p_accuracy := null; end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then raise exception 'that is not a device'; end if;
  select doc->'trip'->>'endDate' into endd from public.shared_trips where id = p_trip;
  begin
    if endd ~ '^\d{4}-\d{2}-\d{2}$' and endd::date + 1 < (now() at time zone 'utc')::date then
      delete from public.live_locations where trip_id = p_trip and user_id = uid;
      return jsonb_build_object('status', 'ended');
    end if;
  exception when others then null; -- a date that cannot be read does not end anything
  end;
  select updated_at, device, true into last_at, holder, has_row from public.live_locations where trip_id = p_trip and user_id = uid;
  -- another device holds the row: only a device that has just started sharing may take it over
  if coalesce(has_row, false) and p_device is not null and holder is not null and holder <> p_device and not coalesce(p_claim, false) then
    return jsonb_build_object('status', 'moved');
  end if;
  -- the 2 s limit applies to the device that holds the row; a device taking over is not held back by the one it replaces
  if last_at is not null and last_at > now() - interval '2 seconds' and (p_device is null or holder is null or holder = p_device) then return jsonb_build_object('status', 'slow'); end if;
  insert into public.live_locations (trip_id, user_id, lat, lon, accuracy, updated_at, device) values (p_trip, uid, p_lat, p_lon, p_accuracy, now(), p_device)
    on conflict (trip_id, user_id) do update set lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, updated_at = excluded.updated_at, device = excluded.device;
  delete from public.live_locations where updated_at < now() - interval '10 minutes';
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Stops sharing in one trip (deletes the caller's position there), unless another device holds it.
create function public.stop_sharing_location(p_trip uuid, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.live_locations where trip_id = p_trip and user_id = uid and (p_device is null or device is null or device = p_device);
  return jsonb_build_object('status', 'stopped');
end;
$$;

-- Stops sharing everywhere for this device (signing out, closing the page); positions held by the caller's other devices stay.
create function public.stop_all_sharing(p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.live_locations where user_id = uid and (p_device is null or device is null or device = p_device);
  return jsonb_build_object('status', 'stopped');
end;
$$;

revoke all on function public.share_location(uuid, double precision, double precision, double precision, text, boolean) from public, anon;
revoke all on function public.stop_sharing_location(uuid, text) from public, anon;
revoke all on function public.stop_all_sharing(text) from public, anon;
grant execute on function public.share_location(uuid, double precision, double precision, double precision, text, boolean) to authenticated;
grant execute on function public.stop_sharing_location(uuid, text) to authenticated;
grant execute on function public.stop_all_sharing(text) to authenticated;
