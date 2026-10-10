begin;

-- Keep patient arrival actions aligned with the portal UI through the Denver service date.
create or replace function private.record_client_checkin_impl(
  p_appointment_id uuid,
  p_status text,
  p_responses jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_new_status public.appointment_status_enum;
  v_staff_access boolean := false;
  v_patient_access boolean := false;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception 'Appointment is unavailable';
  end if;

  v_staff_access := coalesce(private.has_tenant_write_access(v_appt.tenant_id), false);
  v_patient_access := coalesce(
    private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id),
    false
  );

  if not v_staff_access and not v_patient_access then
    raise exception 'Appointment is unavailable';
  end if;

  if lower(coalesce(p_status, '')) not in ('on_my_way', 'arrived', 'checked_in') then
    raise exception 'Invalid check-in status';
  end if;

  if v_patient_access and not v_staff_access then
    if v_appt.appointment_status in (
      'in_session'::public.appointment_status_enum,
      'completed'::public.appointment_status_enum,
      'cancelled'::public.appointment_status_enum,
      'no_show'::public.appointment_status_enum,
      'late_cancel'::public.appointment_status_enum,
      'rescheduled'::public.appointment_status_enum
    ) then
      raise exception 'Appointment is unavailable';
    end if;

    if v_appt.starts_at is null then
      raise exception 'Appointment does not have a valid start time';
    end if;

    if lower(p_status) = 'on_my_way'
       and now() < v_appt.starts_at - interval '4 hours' then
      raise exception 'On My Way opens 4 hours before the appointment';
    end if;

    if lower(p_status) in ('arrived', 'checked_in')
       and now() < v_appt.starts_at - interval '1 hour' then
      raise exception 'Arrival check-in opens 1 hour before the appointment';
    end if;

    if (now() at time zone 'America/Denver')::date
       > (v_appt.starts_at at time zone 'America/Denver')::date then
      raise exception 'Appointment is unavailable';
    end if;

    if lower(p_status) = 'checked_in'
       and not exists (
         select 1
         from public.client_checkins existing_checkin
         where existing_checkin.appointment_id = v_appt.id
           and existing_checkin.arrived_at is not null
       ) then
      raise exception 'Mark arrival before completing check-in';
    end if;

    if coalesce(p_responses, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Patient check-in responses must use the pre-visit endpoint';
    end if;
  end if;

  insert into public.client_checkins (
    tenant_id,
    appointment_id,
    client_id,
    on_my_way_at,
    arrived_at,
    checked_in_at,
    responses
  )
  values (
    v_appt.tenant_id,
    v_appt.id,
    v_appt.client_id,
    case when lower(p_status) = 'on_my_way' then now() else null end,
    case when lower(p_status) = 'arrived' then now() else null end,
    case when lower(p_status) = 'checked_in' then now() else null end,
    case when v_staff_access then coalesce(p_responses, '{}'::jsonb) else '{}'::jsonb end
  )
  on conflict (appointment_id)
  do update set
    on_my_way_at = coalesce(public.client_checkins.on_my_way_at, excluded.on_my_way_at),
    arrived_at = coalesce(public.client_checkins.arrived_at, excluded.arrived_at),
    checked_in_at = coalesce(public.client_checkins.checked_in_at, excluded.checked_in_at),
    responses = case
      when v_staff_access
        then coalesce(public.client_checkins.responses, '{}'::jsonb)
          || coalesce(excluded.responses, '{}'::jsonb)
      else public.client_checkins.responses
    end,
    updated_at = now()
  returning * into v_checkin;

  v_new_status := case
    when v_appt.appointment_status in (
      'in_session'::public.appointment_status_enum,
      'completed'::public.appointment_status_enum,
      'cancelled'::public.appointment_status_enum,
      'no_show'::public.appointment_status_enum,
      'late_cancel'::public.appointment_status_enum,
      'rescheduled'::public.appointment_status_enum
    ) then v_appt.appointment_status
    when v_appt.appointment_status = 'checked_in'::public.appointment_status_enum
      or v_checkin.checked_in_at is not null
      then 'checked_in'::public.appointment_status_enum
    when v_appt.appointment_status = 'client_arrived'::public.appointment_status_enum
      or v_checkin.arrived_at is not null
      then 'client_arrived'::public.appointment_status_enum
    when v_appt.appointment_status = 'client_on_my_way'::public.appointment_status_enum
      or v_checkin.on_my_way_at is not null
      then 'client_on_my_way'::public.appointment_status_enum
    else v_appt.appointment_status
  end;

  if v_new_status is distinct from v_appt.appointment_status then
    update public.appointments
    set appointment_status = v_new_status,
        updated_at = now()
    where id = v_appt.id;

    insert into public.status_history (
      tenant_id,
      target_type,
      target_id,
      old_status,
      new_status,
      changed_by,
      reason
    )
    values (
      v_appt.tenant_id,
      'appointment',
      v_appt.id,
      v_appt.appointment_status::text,
      v_new_status::text,
      (select auth.uid()),
      'Client check-in update'
    );
  end if;

  return v_checkin.id;
end;
$$;

commit;
