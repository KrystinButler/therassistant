-- THERASSISTANT EHR patient data entry workflow layer
-- Adds RLS-safe RPCs and security-invoker views for patient/client entry.

create or replace function public.create_client_profile(
  p_tenant_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date default null,
  p_preferred_name text default null,
  p_middle_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_registration_status public.registration_status_enum default 'in_progress',
  p_client_status public.client_status_enum default 'intake',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
    raise exception 'Client first name and last name are required';
  end if;

  insert into public.clients (
    tenant_id,
    first_name,
    last_name,
    middle_name,
    preferred_name,
    date_of_birth,
    email,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    registration_status,
    client_status,
    metadata
  )
  values (
    p_tenant_id,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_middle_name, '')), ''),
    nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_date_of_birth,
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''),
    nullif(trim(coalesce(p_address_line1, '')), ''),
    nullif(trim(coalesce(p_address_line2, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(upper(trim(coalesce(p_state, ''))), ''),
    nullif(trim(coalesce(p_postal_code, '')), ''),
    p_registration_status,
    p_client_status,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_client_id;

  insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason)
  values (p_tenant_id, 'client', v_client_id, null, p_client_status::text, auth.uid(), 'Client profile created');

  return v_client_id;
end;
$$;

create or replace function public.update_client_profile(
  p_client_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_date_of_birth date default null,
  p_preferred_name text default null,
  p_middle_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_registration_status public.registration_status_enum default null,
  p_client_status public.client_status_enum default null,
  p_metadata_patch jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_old_status text;
  v_new_status text;
begin
  select tenant_id, client_status::text
    into v_tenant_id, v_old_status
  from public.clients
  where id = p_client_id;

  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;

  perform public.assert_tenant_access(v_tenant_id);

  update public.clients
  set
    first_name = coalesce(nullif(trim(coalesce(p_first_name, '')), ''), first_name),
    last_name = coalesce(nullif(trim(coalesce(p_last_name, '')), ''), last_name),
    middle_name = coalesce(nullif(trim(coalesce(p_middle_name, '')), ''), middle_name),
    preferred_name = coalesce(nullif(trim(coalesce(p_preferred_name, '')), ''), preferred_name),
    date_of_birth = coalesce(p_date_of_birth, date_of_birth),
    email = coalesce(nullif(lower(trim(coalesce(p_email, ''))), ''), email),
    phone = coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''), phone),
    address_line1 = coalesce(nullif(trim(coalesce(p_address_line1, '')), ''), address_line1),
    address_line2 = coalesce(nullif(trim(coalesce(p_address_line2, '')), ''), address_line2),
    city = coalesce(nullif(trim(coalesce(p_city, '')), ''), city),
    state = coalesce(nullif(upper(trim(coalesce(p_state, ''))), ''), state),
    postal_code = coalesce(nullif(trim(coalesce(p_postal_code, '')), ''), postal_code),
    registration_status = coalesce(p_registration_status, registration_status),
    client_status = coalesce(p_client_status, client_status),
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata_patch, '{}'::jsonb),
    updated_at = now()
  where id = p_client_id
  returning client_status::text into v_new_status;

  if p_client_status is not null and v_old_status is distinct from v_new_status then
    insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason)
    values (v_tenant_id, 'client', p_client_id, v_old_status, v_new_status, auth.uid(), 'Client status updated');
  end if;

  return p_client_id;
end;
$$;

create or replace function public.upsert_client_contact(
  p_client_id uuid,
  p_contact_name text,
  p_relationship text default null,
  p_phone text default null,
  p_email text default null,
  p_is_emergency_contact boolean default false,
  p_is_responsible_party boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_contact_id uuid;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  if nullif(trim(p_contact_name), '') is null then
    raise exception 'Contact name is required';
  end if;

  select id into v_contact_id
  from public.client_contacts
  where client_id = p_client_id
    and lower(contact_name) = lower(trim(p_contact_name))
    and coalesce(relationship, '') = coalesce(nullif(trim(coalesce(p_relationship, '')), ''), '')
  limit 1;

  if v_contact_id is null then
    insert into public.client_contacts (
      tenant_id, client_id, contact_name, relationship, phone, email, is_emergency_contact, is_responsible_party
    )
    values (
      v_tenant_id,
      p_client_id,
      trim(p_contact_name),
      nullif(trim(coalesce(p_relationship, '')), ''),
      nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''),
      nullif(lower(trim(coalesce(p_email, ''))), ''),
      coalesce(p_is_emergency_contact, false),
      coalesce(p_is_responsible_party, false)
    )
    returning id into v_contact_id;
  else
    update public.client_contacts
    set
      phone = coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''), phone),
      email = coalesce(nullif(lower(trim(coalesce(p_email, ''))), ''), email),
      is_emergency_contact = coalesce(p_is_emergency_contact, is_emergency_contact),
      is_responsible_party = coalesce(p_is_responsible_party, is_responsible_party),
      updated_at = now()
    where id = v_contact_id;
  end if;

  return v_contact_id;
end;
$$;

create or replace function public.resolve_payer_reference(
  p_payer_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payer_id uuid;
  v_name text := lower(regexp_replace(trim(coalesce(p_payer_name, '')), '\s+', ' ', 'g'));
begin
  if v_name = '' then
    raise exception 'Payer name is required';
  end if;

  select p.id into v_payer_id
  from public.payers p
  where p.normalized_name = v_name
  limit 1;

  if v_payer_id is null then
    select pa.payer_id into v_payer_id
    from public.payer_aliases pa
    where lower(regexp_replace(pa.alias, '\s+', ' ', 'g')) = v_name
    limit 1;
  end if;

  if v_payer_id is null then
    raise exception 'Payer reference not found: %', p_payer_name;
  end if;

  return v_payer_id;
end;
$$;

create or replace function public.upsert_client_insurance_policy(
  p_client_id uuid,
  p_payer_name text,
  p_member_id text,
  p_insurance_order public.insurance_order_enum default 'primary',
  p_payer_plan_name text default null,
  p_group_number text default null,
  p_subscriber_name text default null,
  p_subscriber_dob date default null,
  p_relationship_to_subscriber text default null,
  p_effective_date date default null,
  p_termination_date date default null,
  p_status public.insurance_policy_status_enum default 'pending_verification',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_payer_id uuid;
  v_plan_id uuid;
  v_policy_id uuid;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  if nullif(trim(coalesce(p_member_id, '')), '') is null then
    raise exception 'Member ID is required';
  end if;

  v_payer_id := public.resolve_payer_reference(p_payer_name);

  if p_payer_plan_name is not null then
    select id into v_plan_id
    from public.payer_plans
    where payer_id = v_payer_id
      and lower(name) = lower(trim(p_payer_plan_name))
    limit 1;
  end if;

  -- Only one active primary/secondary/tertiary policy per client/order at a time.
  update public.client_insurance_policies
  set status = 'inactive', updated_at = now()
  where client_id = p_client_id
    and insurance_order = p_insurance_order
    and status = 'active'
    and coalesce(termination_date, '9999-12-31'::date) >= coalesce(p_effective_date, current_date)
    and lower(member_id) <> lower(trim(p_member_id));

  select id into v_policy_id
  from public.client_insurance_policies
  where client_id = p_client_id
    and payer_id = v_payer_id
    and lower(member_id) = lower(trim(p_member_id))
  limit 1;

  if v_policy_id is null then
    insert into public.client_insurance_policies (
      tenant_id, client_id, payer_id, payer_plan_id, member_id, group_number,
      insurance_order, subscriber_name, subscriber_dob, relationship_to_subscriber,
      effective_date, termination_date, status, metadata
    )
    values (
      v_tenant_id, p_client_id, v_payer_id, v_plan_id, trim(p_member_id),
      nullif(trim(coalesce(p_group_number, '')), ''), p_insurance_order,
      nullif(trim(coalesce(p_subscriber_name, '')), ''), p_subscriber_dob,
      nullif(trim(coalesce(p_relationship_to_subscriber, '')), ''),
      p_effective_date, p_termination_date, p_status, coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_policy_id;
  else
    update public.client_insurance_policies
    set
      payer_plan_id = coalesce(v_plan_id, payer_plan_id),
      group_number = coalesce(nullif(trim(coalesce(p_group_number, '')), ''), group_number),
      insurance_order = coalesce(p_insurance_order, insurance_order),
      subscriber_name = coalesce(nullif(trim(coalesce(p_subscriber_name, '')), ''), subscriber_name),
      subscriber_dob = coalesce(p_subscriber_dob, subscriber_dob),
      relationship_to_subscriber = coalesce(nullif(trim(coalesce(p_relationship_to_subscriber, '')), ''), relationship_to_subscriber),
      effective_date = coalesce(p_effective_date, effective_date),
      termination_date = coalesce(p_termination_date, termination_date),
      status = coalesce(p_status, status),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = v_policy_id;
  end if;

  update public.clients
  set billing_readiness_status = case
        when billing_readiness_status = 'missing_insurance' then 'not_ready'::public.billing_readiness_status_enum
        else billing_readiness_status
      end,
      updated_at = now()
  where id = p_client_id;

  return v_policy_id;
end;
$$;

create or replace function public.record_eligibility_check(
  p_client_id uuid,
  p_service_date date,
  p_payer_name text default null,
  p_insurance_policy_id uuid default null,
  p_eligibility_status public.eligibility_status_enum default 'pending',
  p_response_source text default 'manual',
  p_notes text default null,
  p_raw_response jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_payer_id uuid;
  v_check_id uuid;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  if p_payer_name is not null then
    v_payer_id := public.resolve_payer_reference(p_payer_name);
  elsif p_insurance_policy_id is not null then
    select payer_id into v_payer_id from public.client_insurance_policies where id = p_insurance_policy_id and client_id = p_client_id;
  end if;

  insert into public.eligibility_checks (
    tenant_id, client_id, payer_id, insurance_policy_id, service_date,
    eligibility_status, response_source, notes, raw_response, checked_by
  )
  values (
    v_tenant_id, p_client_id, v_payer_id, p_insurance_policy_id, p_service_date,
    p_eligibility_status, nullif(trim(coalesce(p_response_source, 'manual')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), p_raw_response, auth.uid()
  )
  returning id into v_check_id;

  if p_eligibility_status in ('inactive', 'ineligible', 'coverage_terminated', 'unable_to_verify', 'error') then
    perform public.create_workqueue_item(
      p_tenant_id => v_tenant_id,
      p_workqueue_type => 'eligibility_issue',
      p_source_object_type => 'eligibility',
      p_source_object_id => v_check_id,
      p_title => 'Eligibility issue needs review',
      p_description => coalesce(p_notes, 'Eligibility status: ' || p_eligibility_status::text),
      p_priority => 'normal'
    );
  end if;

  return v_check_id;
end;
$$;

create or replace function public.record_eligibility_benefit(
  p_eligibility_check_id uuid,
  p_benefit_type text,
  p_cpt_code text default null,
  p_network_status text default null,
  p_copay_cents integer default null,
  p_coinsurance_percent numeric default null,
  p_deductible_remaining_cents integer default null,
  p_oop_remaining_cents integer default null,
  p_authorization_required boolean default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_benefit_id uuid;
begin
  select tenant_id into v_tenant_id from public.eligibility_checks where id = p_eligibility_check_id;
  if v_tenant_id is null then
    raise exception 'Eligibility check not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  insert into public.eligibility_benefits (
    tenant_id, eligibility_check_id, benefit_type, cpt_code, network_status,
    copay_cents, coinsurance_percent, deductible_remaining_cents, oop_remaining_cents,
    authorization_required, notes
  )
  values (
    v_tenant_id, p_eligibility_check_id, trim(p_benefit_type), nullif(trim(coalesce(p_cpt_code, '')), ''),
    nullif(trim(coalesce(p_network_status, '')), ''), p_copay_cents, p_coinsurance_percent,
    p_deductible_remaining_cents, p_oop_remaining_cents, p_authorization_required,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_benefit_id;

  return v_benefit_id;
end;
$$;

create or replace function public.upsert_client_diagnosis(
  p_client_id uuid,
  p_diagnosis_code text,
  p_description text default null,
  p_diagnosis_status public.diagnosis_status_enum default 'active',
  p_onset_date date default null,
  p_resolved_date date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_diagnosis_id uuid;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  select id into v_diagnosis_id
  from public.client_diagnoses
  where client_id = p_client_id
    and upper(diagnosis_code) = upper(trim(p_diagnosis_code))
    and diagnosis_status <> 'entered_in_error'
  order by created_at desc
  limit 1;

  if v_diagnosis_id is null then
    insert into public.client_diagnoses (
      tenant_id, client_id, diagnosis_code, description, diagnosis_status, onset_date, resolved_date
    )
    values (
      v_tenant_id, p_client_id, upper(trim(p_diagnosis_code)), nullif(trim(coalesce(p_description, '')), ''),
      p_diagnosis_status, p_onset_date, p_resolved_date
    )
    returning id into v_diagnosis_id;
  else
    update public.client_diagnoses
    set
      description = coalesce(nullif(trim(coalesce(p_description, '')), ''), description),
      diagnosis_status = coalesce(p_diagnosis_status, diagnosis_status),
      onset_date = coalesce(p_onset_date, onset_date),
      resolved_date = coalesce(p_resolved_date, resolved_date),
      updated_at = now()
    where id = v_diagnosis_id;
  end if;

  return v_diagnosis_id;
end;
$$;

create or replace function public.create_treatment_plan_with_goal(
  p_client_id uuid,
  p_provider_id uuid default null,
  p_effective_date date default current_date,
  p_review_due_date date default null,
  p_plan_text text default null,
  p_goal_text text default null,
  p_objective_text text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_plan_id uuid;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'Client not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  insert into public.treatment_plans (
    tenant_id, client_id, provider_id, effective_date, review_due_date, plan_text, status
  )
  values (
    v_tenant_id, p_client_id, p_provider_id, p_effective_date, p_review_due_date,
    nullif(trim(coalesce(p_plan_text, '')), ''), 'draft'
  )
  returning id into v_plan_id;

  if nullif(trim(coalesce(p_goal_text, '')), '') is not null then
    insert into public.treatment_plan_goals (
      tenant_id, treatment_plan_id, goal_text, objective_text, status
    )
    values (
      v_tenant_id, v_plan_id, trim(p_goal_text), nullif(trim(coalesce(p_objective_text, '')), ''), 'active'
    );
  end if;

  return v_plan_id;
end;
$$;

create or replace function public.create_client_appointment(
  p_tenant_id uuid,
  p_client_id uuid,
  p_provider_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_cpt_code text default null,
  p_service_type text default null,
  p_location_type public.appointment_location_type_enum default 'telehealth',
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_conflict_count integer;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_ends_at <= p_starts_at then
    raise exception 'Appointment end time must be after start time';
  end if;

  if not exists (select 1 from public.clients where id = p_client_id and tenant_id = p_tenant_id) then
    raise exception 'Client not found in tenant';
  end if;

  if p_provider_id is not null and not exists (select 1 from public.providers where id = p_provider_id and tenant_id = p_tenant_id) then
    raise exception 'Provider not found in tenant';
  end if;

  select count(*) into v_conflict_count
  from public.appointments a
  where a.tenant_id = p_tenant_id
    and a.provider_id = p_provider_id
    and a.appointment_status not in ('cancelled', 'no_show', 'late_cancel', 'rescheduled')
    and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if v_conflict_count > 0 then
    raise exception 'Provider has a scheduling conflict';
  end if;

  insert into public.appointments (
    tenant_id, client_id, provider_id, starts_at, ends_at, cpt_code, service_type, location_type, notes
  )
  values (
    p_tenant_id, p_client_id, p_provider_id, p_starts_at, p_ends_at,
    nullif(trim(coalesce(p_cpt_code, '')), ''), nullif(trim(coalesce(p_service_type, '')), ''),
    p_location_type, nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_appointment_id;

  insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason)
  values (p_tenant_id, 'appointment', v_appointment_id, null, 'scheduled', auth.uid(), 'Appointment created');

  return v_appointment_id;
end;
$$;

create or replace function public.record_client_checkin(
  p_appointment_id uuid,
  p_status text,
  p_responses jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_client_id uuid;
  v_checkin_id uuid;
  v_new_status public.appointment_status_enum;
begin
  select tenant_id, client_id into v_tenant_id, v_client_id
  from public.appointments
  where id = p_appointment_id;

  if v_tenant_id is null then
    raise exception 'Appointment not found';
  end if;
  perform public.assert_tenant_access(v_tenant_id);

  if lower(p_status) not in ('on_my_way', 'arrived', 'checked_in') then
    raise exception 'Invalid check-in status';
  end if;

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id, on_my_way_at, arrived_at, checked_in_at, responses
  )
  values (
    v_tenant_id,
    p_appointment_id,
    v_client_id,
    case when lower(p_status) = 'on_my_way' then now() else null end,
    case when lower(p_status) = 'arrived' then now() else null end,
    case when lower(p_status) = 'checked_in' then now() else null end,
    coalesce(p_responses, '{}'::jsonb)
  )
  on conflict (appointment_id)
  do update set
    on_my_way_at = coalesce(client_checkins.on_my_way_at, excluded.on_my_way_at),
    arrived_at = coalesce(client_checkins.arrived_at, excluded.arrived_at),
    checked_in_at = coalesce(client_checkins.checked_in_at, excluded.checked_in_at),
    responses = coalesce(client_checkins.responses, '{}'::jsonb) || coalesce(excluded.responses, '{}'::jsonb),
    updated_at = now()
  returning id into v_checkin_id;

  v_new_status := case lower(p_status)
    when 'on_my_way' then 'client_on_my_way'::public.appointment_status_enum
    when 'arrived' then 'client_arrived'::public.appointment_status_enum
    else 'checked_in'::public.appointment_status_enum
  end;

  update public.appointments
  set appointment_status = v_new_status,
      updated_at = now()
  where id = p_appointment_id;

  insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason)
  values (v_tenant_id, 'appointment', p_appointment_id, null, v_new_status::text, auth.uid(), 'Client check-in update');

  return v_checkin_id;
end;
$$;

create or replace function public.create_clinical_note_for_appointment(
  p_appointment_id uuid,
  p_note_type public.clinical_note_type_enum default 'psychotherapy',
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
security invoker
set search_path = public, pg_temp
as $$
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
    coalesce(nullif(trim(coalesce(p_diagnosis_code, '')), ''), nullif(trim(coalesce(v_appt.cpt_code, '')), '')),
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
$$;

create or replace function public.sign_clinical_note(
  p_clinical_note_id uuid,
  p_signature_text text default null,
  p_create_charge boolean default true,
  p_charge_amount_cents integer default 0,
  p_place_of_service text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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

  if v_note.note_type = 'psychotherapy' and nullif(trim(coalesce(v_note.goal_addressed, '')), '') is null then
    raise exception 'Psychotherapy note requires goal addressed';
  end if;

  if v_note.diagnosis_code is null then
    raise exception 'Clinical note requires diagnosis code before signing';
  end if;

  insert into public.clinical_note_signatures (
    tenant_id, clinical_note_id, signer_id, signature_text, signed_at
  )
  values (
    v_note.tenant_id, v_note.id, auth.uid(), nullif(trim(coalesce(p_signature_text, '')), ''), now()
  );

  update public.clinical_notes
  set note_status = 'signed', locked_at = now(), updated_at = now()
  where id = v_note.id;

  insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason)
  values (v_note.tenant_id, 'clinical_note', v_note.id, v_note.note_status::text, 'signed', auth.uid(), 'Clinical note signed and locked');

  update public.appointments
  set appointment_status = case when appointment_status not in ('cancelled', 'no_show', 'late_cancel') then 'completed' else appointment_status end,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = v_note.appointment_id;

  if coalesce(p_create_charge, true) and v_note.appointment_id is not null then
    v_charge_id := public.create_charge_from_appointment(
      p_appointment_id => v_note.appointment_id,
      p_charge_amount_cents => coalesce(p_charge_amount_cents, 0),
      p_cpt_code => v_note.cpt_code,
      p_diagnosis_code => v_note.diagnosis_code,
      p_place_of_service => p_place_of_service
    );
  end if;

  return v_charge_id;
end;
$$;

create or replace view public.v_client_profile_summary
with (security_invoker = true)
as
select
  c.tenant_id,
  c.id as client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  c.preferred_name,
  c.date_of_birth,
  c.client_status,
  c.registration_status,
  c.billing_readiness_status,
  c.email,
  c.phone,
  c.city,
  c.state,
  c.updated_at,
  count(distinct cip.id) filter (where cip.status = 'active') as active_policy_count,
  count(distinct cd.id) filter (where cd.diagnosis_status = 'active') as active_diagnosis_count,
  count(distinct tp.id) filter (where tp.status in ('active','signed')) as active_treatment_plan_count,
  coalesce(cbs.open_balance_cents, 0) as open_balance_cents,
  coalesce(cbs.credit_balance_cents, 0) as credit_balance_cents
from public.clients c
left join public.client_insurance_policies cip on cip.client_id = c.id
left join public.client_diagnoses cd on cd.client_id = c.id
left join public.treatment_plans tp on tp.client_id = c.id
left join public.client_balance_summaries cbs on cbs.client_id = c.id
group by c.id, cbs.open_balance_cents, cbs.credit_balance_cents;

create or replace view public.v_client_billing_readiness
with (security_invoker = true)
as
select
  c.tenant_id,
  c.id as client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  c.client_status,
  c.registration_status,
  exists (
    select 1 from public.client_insurance_policies cip
    where cip.client_id = c.id
      and cip.status = 'active'
      and cip.insurance_order = 'primary'
      and coalesce(cip.effective_date, '1900-01-01'::date) <= current_date
      and coalesce(cip.termination_date, '9999-12-31'::date) >= current_date
  ) as has_active_primary_insurance,
  exists (
    select 1 from public.client_diagnoses cd
    where cd.client_id = c.id and cd.diagnosis_status = 'active'
  ) as has_active_diagnosis,
  exists (
    select 1 from public.treatment_plans tp
    where tp.client_id = c.id and tp.status in ('active', 'signed')
  ) as has_active_treatment_plan,
  exists (
    select 1 from public.clinical_notes cn
    where cn.client_id = c.id and cn.note_status = 'signed'
  ) as has_signed_note,
  case
    when not exists (
      select 1 from public.client_insurance_policies cip
      where cip.client_id = c.id and cip.status = 'active' and cip.insurance_order = 'primary'
    ) then 'missing_insurance'
    when not exists (
      select 1 from public.client_diagnoses cd
      where cd.client_id = c.id and cd.diagnosis_status = 'active'
    ) then 'missing_diagnosis'
    when not exists (
      select 1 from public.treatment_plans tp
      where tp.client_id = c.id and tp.status in ('active', 'signed')
    ) then 'not_ready'
    else 'ready_for_charge'
  end::public.billing_readiness_status_enum as calculated_billing_readiness_status,
  c.billing_readiness_status as stored_billing_readiness_status,
  c.updated_at
from public.clients c;

create or replace view public.v_upcoming_appointments
with (security_invoker = true)
as
select
  a.tenant_id,
  a.id as appointment_id,
  a.starts_at,
  a.ends_at,
  a.appointment_status,
  a.location_type,
  a.cpt_code,
  a.service_type,
  a.client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  a.provider_id,
  trim(p.first_name || ' ' || p.last_name) as provider_name,
  ci.on_my_way_at,
  ci.arrived_at,
  ci.checked_in_at,
  exists (select 1 from public.clinical_notes cn where cn.appointment_id = a.id) as has_note,
  exists (select 1 from public.charge_capture_items ch where ch.appointment_id = a.id) as has_charge
from public.appointments a
join public.clients c on c.id = a.client_id
left join public.providers p on p.id = a.provider_id
left join public.client_checkins ci on ci.appointment_id = a.id
where a.starts_at >= (now() - interval '1 day')
  and a.appointment_status not in ('cancelled', 'rescheduled');

create or replace view public.v_unsigned_clinical_notes
with (security_invoker = true)
as
select
  cn.tenant_id,
  cn.id as clinical_note_id,
  cn.appointment_id,
  cn.client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  cn.provider_id,
  trim(p.first_name || ' ' || p.last_name) as provider_name,
  cn.service_date,
  cn.note_type,
  cn.note_status,
  cn.cpt_code,
  cn.diagnosis_code,
  cn.goal_addressed,
  cn.duration_minutes,
  cn.updated_at,
  case
    when cn.note_type = 'psychotherapy' and nullif(trim(coalesce(cn.goal_addressed, '')), '') is null then true
    when cn.diagnosis_code is null then true
    else false
  end as has_blocking_issue
from public.clinical_notes cn
join public.clients c on c.id = cn.client_id
left join public.providers p on p.id = cn.provider_id
where cn.note_status in ('draft', 'in_progress', 'ready_for_signature');

grant execute on function public.create_client_profile(uuid,text,text,date,text,text,text,text,text,text,text,text,text,public.registration_status_enum,public.client_status_enum,jsonb) to authenticated;
grant execute on function public.update_client_profile(uuid,text,text,date,text,text,text,text,text,text,text,text,text,public.registration_status_enum,public.client_status_enum,jsonb) to authenticated;
grant execute on function public.upsert_client_contact(uuid,text,text,text,text,boolean,boolean) to authenticated;
grant execute on function public.resolve_payer_reference(text) to authenticated;
grant execute on function public.upsert_client_insurance_policy(uuid,text,text,public.insurance_order_enum,text,text,text,date,text,date,date,public.insurance_policy_status_enum,jsonb) to authenticated;
grant execute on function public.record_eligibility_check(uuid,date,text,uuid,public.eligibility_status_enum,text,text,jsonb) to authenticated;
grant execute on function public.record_eligibility_benefit(uuid,text,text,text,integer,numeric,integer,integer,boolean,text) to authenticated;
grant execute on function public.upsert_client_diagnosis(uuid,text,text,public.diagnosis_status_enum,date,date) to authenticated;
grant execute on function public.create_treatment_plan_with_goal(uuid,uuid,date,date,text,text,text) to authenticated;
grant execute on function public.create_client_appointment(uuid,uuid,uuid,timestamptz,timestamptz,text,text,public.appointment_location_type_enum,text) to authenticated;
grant execute on function public.record_client_checkin(uuid,text,jsonb) to authenticated;
grant execute on function public.create_clinical_note_for_appointment(uuid,public.clinical_note_type_enum,text,text,text,uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.sign_clinical_note(uuid,text,boolean,integer,text) to authenticated;

revoke all on function public.create_client_profile(uuid,text,text,date,text,text,text,text,text,text,text,text,text,public.registration_status_enum,public.client_status_enum,jsonb) from anon;
revoke all on function public.update_client_profile(uuid,text,text,date,text,text,text,text,text,text,text,text,text,public.registration_status_enum,public.client_status_enum,jsonb) from anon;
revoke all on function public.upsert_client_contact(uuid,text,text,text,text,boolean,boolean) from anon;
revoke all on function public.resolve_payer_reference(text) from anon;
revoke all on function public.upsert_client_insurance_policy(uuid,text,text,public.insurance_order_enum,text,text,text,date,text,date,date,public.insurance_policy_status_enum,jsonb) from anon;
revoke all on function public.record_eligibility_check(uuid,date,text,uuid,public.eligibility_status_enum,text,text,jsonb) from anon;
revoke all on function public.record_eligibility_benefit(uuid,text,text,text,integer,numeric,integer,integer,boolean,text) from anon;
revoke all on function public.upsert_client_diagnosis(uuid,text,text,public.diagnosis_status_enum,date,date) from anon;
revoke all on function public.create_treatment_plan_with_goal(uuid,uuid,date,date,text,text,text) from anon;
revoke all on function public.create_client_appointment(uuid,uuid,uuid,timestamptz,timestamptz,text,text,public.appointment_location_type_enum,text) from anon;
revoke all on function public.record_client_checkin(uuid,text,jsonb) from anon;
revoke all on function public.create_clinical_note_for_appointment(uuid,public.clinical_note_type_enum,text,text,text,uuid,timestamptz,timestamptz,text) from anon;
revoke all on function public.sign_clinical_note(uuid,text,boolean,integer,text) from anon;
