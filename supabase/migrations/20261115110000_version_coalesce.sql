-- Fewer earlier versions: a burst of autosaves is kept as one version.
--
-- Both documents are saved a couple of seconds after every edit, and every save used to copy the replaced document into the versions table, so ten edits in
-- a minute wrote ten full copies (up to 2 MB or 1 MB each) and pushed the useful older versions out of the "last 20".
--
-- Now the replaced document is kept as an earlier version unless it was itself saved, by the same device (cloud copy) or person (shared trip), less than
-- 2 minutes ago: that is only a step of the same editing session. A forced overwrite of the cloud copy always keeps what it replaces. Documents that lived
-- for 2 minutes or more, and documents someone else saved, are kept as before (still the last 20 revisions, 30 days).
--
-- Nothing else changes: same signatures, same results, same grants.

create or replace function public.save_user_data(p_doc jsonb, p_base_rev bigint default null, p_device text default '', p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cur public.user_data%rowtype;
  new_rev bigint;
  dev text := left(coalesce(p_device, ''), 80);
  n_markers integer;
  n_trips integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'the document must be an object' using errcode = '22023'; end if;
  if coalesce(p_doc ->> 'v', '') <> '1' then raise exception 'unsupported document version' using errcode = '22023'; end if;
  if pg_column_size(p_doc) > 2000000 then raise exception 'the document is too large' using errcode = '54000'; end if;

  n_markers := case when jsonb_typeof(p_doc -> 'items') = 'array' then jsonb_array_length(p_doc -> 'items') else 0 end;
  n_trips := case when jsonb_typeof(p_doc -> 'trips') = 'array' then jsonb_array_length(p_doc -> 'trips') else 0 end;

  select * into cur from public.user_data where user_id = uid for update;

  if not found then
    insert into public.user_data (user_id, doc, rev, device, markers, trips) values (uid, p_doc, 1, dev, n_markers, n_trips);
    return jsonb_build_object('status', 'ok', 'rev', 1, 'updated_at', now(), 'device', dev, 'markers', n_markers, 'trips', n_trips);
  end if;

  if not p_force and p_base_rev is distinct from cur.rev then
    return jsonb_build_object('status', 'conflict', 'rev', cur.rev, 'updated_at', cur.updated_at, 'device', cur.device, 'markers', cur.markers, 'trips', cur.trips);
  end if;

  new_rev := cur.rev + 1;
  if p_force or cur.device is distinct from dev or cur.updated_at <= now() - interval '2 minutes' then
    insert into public.user_data_versions (user_id, rev, doc, updated_at, device, markers, trips)
      values (uid, cur.rev, cur.doc, cur.updated_at, cur.device, cur.markers, cur.trips);
  end if;
  update public.user_data
    set doc = p_doc, rev = new_rev, updated_at = now(), device = dev, markers = n_markers, trips = n_trips
    where user_id = uid;
  delete from public.user_data_versions
    where user_id = uid and (rev <= new_rev - 20 or updated_at < now() - interval '30 days');
  return jsonb_build_object('status', 'ok', 'rev', new_rev, 'updated_at', now(), 'device', dev, 'markers', n_markers, 'trips', n_trips);
end;
$$;

create or replace function public.save_shared_trip(p_trip uuid, p_doc jsonb, p_base_rev bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t public.shared_trips%rowtype;
  me text;
  new_rev bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.is_party_member(p_trip) then raise exception 'trip not found'; end if;
  perform public.check_trip_doc(p_doc, p_trip);
  select * into t from public.shared_trips where id = p_trip for update;
  select display_name into me from public.profiles where user_id = uid;
  if p_base_rev is distinct from t.rev then
    return jsonb_build_object('status', 'conflict', 'rev', t.rev, 'updated_at', t.updated_at,
                              'updated_by_name', coalesce((select display_name from public.profiles where user_id = t.updated_by), 'Someone'));
  end if;
  if t.updated_by is distinct from uid or t.updated_at <= now() - interval '2 minutes' then
    insert into public.shared_trip_versions (trip_id, rev, doc, updated_at, updated_by, markers) values (t.id, t.rev, t.doc, t.updated_at, t.updated_by, t.markers);
  end if;
  new_rev := t.rev + 1;
  update public.shared_trips
     set doc = p_doc, rev = new_rev, name = p_doc->'trip'->>'name', markers = jsonb_array_length(coalesce(p_doc->'items', '[]'::jsonb)),
         start_date = p_doc->'trip'->>'startDate', end_date = p_doc->'trip'->>'endDate', updated_at = now(), updated_by = uid
   where id = t.id;
  delete from public.shared_trip_versions where trip_id = t.id and (updated_at < now() - interval '30 days' or rev <= new_rev - 20);
  return jsonb_build_object('status', 'ok', 'rev', new_rev, 'updated_at', now(), 'updated_by_name', coalesce(me, 'Someone'));
end;
$$;
