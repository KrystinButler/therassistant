begin;

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

revoke all on function private.record_client_checkin_impl(uuid, text, jsonb) from public, anon;
grant execute on function private.record_client_checkin_impl(uuid, text, jsonb) to authenticated;

create or replace function private.portal_save_previsit_checkin_impl(
  p_appointment_id uuid,
  p_update jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_now timestamptz := now();
  v_scalar_patch jsonb := '{}'::jsonb;
  v_insert_previsit jsonb := '{}'::jsonb;
  v_insert_responses jsonb := '{}'::jsonb;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found
     or not private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id) then
    raise exception 'Appointment is unavailable';
  end if;

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

  if p_update is null or jsonb_typeof(p_update) <> 'object' then
    raise exception 'Pre-visit update must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_update) as supplied(key)
    where supplied.key not in (
      'demographics_confirmed',
      'insurance_confirmed',
      'visit_questions',
      'consents',
      'submitted'
    )
  ) then
    raise exception 'Unsupported pre-visit field';
  end if;

  v_scalar_patch := jsonb_build_object('updated_at', v_now);

  if p_update ? 'demographics_confirmed' then
    if jsonb_typeof(p_update -> 'demographics_confirmed') <> 'boolean' then
      raise exception 'Demographics confirmation must be boolean';
    end if;
    v_scalar_patch := v_scalar_patch || jsonb_build_object(
      'demographics_confirmed',
      (p_update ->> 'demographics_confirmed')::boolean
    );
  end if;

  if p_update ? 'insurance_confirmed' then
    if jsonb_typeof(p_update -> 'insurance_confirmed') <> 'boolean' then
      raise exception 'Insurance confirmation must be boolean';
    end if;
    v_scalar_patch := v_scalar_patch || jsonb_build_object(
      'insurance_confirmed',
      (p_update ->> 'insurance_confirmed')::boolean
    );
  end if;

  if p_update ? 'visit_questions'
     and jsonb_typeof(p_update -> 'visit_questions') <> 'object' then
    raise exception 'Visit questions must be an object';
  end if;

  if p_update ? 'consents'
     and jsonb_typeof(p_update -> 'consents') <> 'object' then
    raise exception 'Consents must be an object';
  end if;

  if p_update ? 'submitted' then
    if jsonb_typeof(p_update -> 'submitted') <> 'boolean' then
      raise exception 'Submitted must be boolean';
    end if;
    if (p_update ->> 'submitted')::boolean then
      v_scalar_patch := v_scalar_patch || jsonb_build_object('submitted_at', v_now);
    end if;
  end if;

  v_insert_previsit := v_scalar_patch;

  if p_update ? 'visit_questions' then
    v_insert_previsit := v_insert_previsit || jsonb_build_object(
      'visit_questions', p_update -> 'visit_questions'
    );
  end if;

  if p_update ? 'consents' then
    v_insert_previsit := v_insert_previsit || jsonb_build_object(
      'consents', p_update -> 'consents'
    );
  end if;

  v_insert_responses := jsonb_build_object('pre_visit', v_insert_previsit);

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id, responses
  )
  values (
    v_appt.tenant_id, v_appt.id, v_appt.client_id, v_insert_responses
  )
  on conflict (appointment_id)
  do update set
    responses =
      coalesce(public.client_checkins.responses, '{}'::jsonb)
      || jsonb_build_object(
        'pre_visit',
        (
          case
            when jsonb_typeof(public.client_checkins.responses -> 'pre_visit') = 'object'
              then public.client_checkins.responses -> 'pre_visit'
            else '{}'::jsonb
          end
        )
        || v_scalar_patch
        || case
          when p_update ? 'visit_questions' then jsonb_build_object(
            'visit_questions',
            (
              case
                when jsonb_typeof(
                  public.client_checkins.responses -> 'pre_visit' -> 'visit_questions'
                ) = 'object'
                  then public.client_checkins.responses -> 'pre_visit' -> 'visit_questions'
                else '{}'::jsonb
              end
            )
            || (p_update -> 'visit_questions')
          )
          else '{}'::jsonb
        end
        || case
          when p_update ? 'consents' then jsonb_build_object(
            'consents',
            (
              case
                when jsonb_typeof(
                  public.client_checkins.responses -> 'pre_visit' -> 'consents'
                ) = 'object'
                  then public.client_checkins.responses -> 'pre_visit' -> 'consents'
                else '{}'::jsonb
              end
            )
            || (p_update -> 'consents')
          )
          else '{}'::jsonb
        end
      ),
    updated_at = v_now
  returning * into v_checkin;

  return to_jsonb(v_checkin);
end;
$$;

revoke all on function private.portal_save_previsit_checkin_impl(uuid, jsonb) from public, anon;
grant execute on function private.portal_save_previsit_checkin_impl(uuid, jsonb) to authenticated;

commit;
