create or replace function public.create_clinical_note_for_appointment(
  p_appointment_id uuid,
  p_note_type public.clinical_note_type_enum default 'psychotherapy'::public.clinical_note_type_enum,
  p_note_text text default null,
  p_diagnosis_code text default null,
  p_goal_addressed text default null,
  p_treatment_plan_id uuid default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_cpt_code text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_appt record;
  v_note_id uuid;
  v_duration integer;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if v_appt.id is null then
    raise exception 'Appointment not found';
  end if;
  perform public.assert_tenant_access(v_appt.tenant_id);

  if p_start_time is not null and p_end_time is not null then
    if p_end_time <= p_start_time then
      raise exception 'Note end time must be after start time';
    end if;
    v_duration := extract(epoch from (p_end_time - p_start_time))::integer / 60;
  else
    v_duration := extract(epoch from (v_appt.ends_at - v_appt.starts_at))::integer / 60;
  end if;

  insert into public.clinical_notes (
    tenant_id, appointment_id, client_id, provider_id, service_date, note_type,
    note_text, diagnosis_code, goal_addressed, treatment_plan_id, start_time, end_time,
    duration_minutes, cpt_code, note_status
  )
  values (
    v_appt.tenant_id, v_appt.id, v_appt.client_id, v_appt.provider_id,
    (v_appt.starts_at at time zone 'UTC')::date,
    p_note_type,
    nullif(trim(coalesce(p_note_text, '')), ''),
    nullif(trim(coalesce(p_diagnosis_code, '')), ''),
    nullif(trim(coalesce(p_goal_addressed, '')), ''),
    p_treatment_plan_id,
    coalesce(p_start_time, v_appt.starts_at),
    coalesce(p_end_time, v_appt.ends_at),
    v_duration,
    coalesce(nullif(trim(coalesce(p_cpt_code, '')), ''), v_appt.cpt_code),
    'draft'
  )
  returning id into v_note_id;

  return v_note_id;
end;
$function$;

create or replace function public.sign_clinical_note(
  p_clinical_note_id uuid,
  p_signature_text text default null,
  p_create_charge boolean default true,
  p_charge_amount_cents integer default 0,
  p_place_of_service text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_note record;
  v_charge_id uuid;
begin
  select * into v_note
  from public.clinical_notes
  where id = p_clinical_note_id;

  if v_note.id is null then
    raise exception 'Clinical note not found';
  end if;
  perform public.assert_tenant_access(v_note.tenant_id);

  if v_note.note_status in ('signed', 'locked', 'amended', 'voided') then
    raise exception 'Clinical note cannot be signed from current status: %', v_note.note_status;
  end if;

  if nullif(trim(coalesce(v_note.note_text, '')), '') is null then
    raise exception 'Clinical note text is required before signing';
  end if;

  if v_note.provider_id is null then
    raise exception 'Clinical note requires a signing provider identity';
  end if;

  if nullif(trim(coalesce(p_signature_text, '')), '') is null then
    raise exception 'Signature text is required before signing';
  end if;

  insert into public.clinical_note_signatures (
    tenant_id, clinical_note_id, signer_id, provider_id, signature_text, signed_at
  )
  values (
    v_note.tenant_id,
    v_note.id,
    auth.uid(),
    v_note.provider_id,
    trim(p_signature_text),
    now()
  );

  update public.clinical_notes
  set note_status = 'signed',
      locked_at = coalesce(locked_at, now()),
      updated_at = now()
  where id = v_note.id;

  insert into public.status_history (
    tenant_id, target_type, target_id, old_status, new_status, changed_by, reason
  )
  values (
    v_note.tenant_id,
    'clinical_note',
    v_note.id,
    v_note.note_status::text,
    'signed',
    auth.uid(),
    'Clinical note signed and locked'
  );

  update public.appointments
  set appointment_status = case
        when appointment_status not in ('cancelled', 'no_show', 'late_cancel', 'rescheduled')
          then 'completed'
        else appointment_status
      end,
      completed_at = case
        when appointment_status not in ('cancelled', 'no_show', 'late_cancel', 'rescheduled')
          then coalesce(completed_at, now())
        else completed_at
      end,
      updated_at = now()
  where id = v_note.appointment_id;

  if coalesce(p_create_charge, true)
     and v_note.appointment_id is not null
     and nullif(trim(coalesce(v_note.cpt_code, '')), '') is not null then
    begin
      v_charge_id := public.create_charge_from_appointment(
        p_appointment_id => v_note.appointment_id,
        p_charge_amount_cents => coalesce(p_charge_amount_cents, 0),
        p_cpt_code => v_note.cpt_code,
        p_diagnosis_code => v_note.diagnosis_code,
        p_place_of_service => p_place_of_service
      );
    exception
      when others then
        v_charge_id := null;
    end;
  end if;

  return v_charge_id;
end;
$function$;
