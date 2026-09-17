create or replace function public.assert_tenant_access(p_tenant_id uuid)
returns void
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required';
  end if;

  if not exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
  ) then
    raise exception 'User does not have access to tenant %', p_tenant_id;
  end if;
end;
$$;

create or replace function public.create_workqueue_item(
  p_tenant_id uuid,
  p_workqueue_type public.workqueue_type_enum,
  p_source_object_type public.workqueue_source_object_type_enum,
  p_source_object_id uuid,
  p_title text,
  p_description text default null,
  p_priority public.workqueue_priority_enum default 'normal'::public.workqueue_priority_enum,
  p_due_date date default null,
  p_assigned_user_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_workqueue_item_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  insert into public.workqueue_items (
    tenant_id,
    workqueue_type,
    source_object_type,
    source_object_id,
    title,
    description,
    priority,
    due_date,
    assigned_user_id,
    created_by
  ) values (
    p_tenant_id,
    p_workqueue_type,
    p_source_object_type,
    p_source_object_id,
    nullif(trim(p_title), ''),
    nullif(trim(p_description), ''),
    coalesce(p_priority, 'normal'::public.workqueue_priority_enum),
    p_due_date,
    p_assigned_user_id,
    auth.uid()
  )
  returning id into v_workqueue_item_id;

  return v_workqueue_item_id;
end;
$$;

create or replace function public.create_charge_from_appointment(
  p_appointment_id uuid,
  p_charge_amount_cents integer default null,
  p_cpt_code text default null,
  p_diagnosis_code text default null,
  p_place_of_service text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_note_id uuid;
  v_note_status public.clinical_note_status_enum;
  v_payer_id uuid;
  v_cpt_code text;
  v_diagnosis_code text;
  v_charge_status public.charge_status_enum := 'captured'::public.charge_status_enum;
  v_block_reason text;
  v_charge_id uuid;
begin
  select * into v_appointment
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception 'Appointment % was not found or is not visible to the current user', p_appointment_id;
  end if;

  perform public.assert_tenant_access(v_appointment.tenant_id);

  v_cpt_code := coalesce(nullif(trim(p_cpt_code), ''), nullif(trim(v_appointment.cpt_code), ''));

  if v_cpt_code is null then
    raise exception 'Cannot create charge: CPT code is required';
  end if;

  select cn.id, cn.note_status, cn.diagnosis_code
    into v_note_id, v_note_status, v_diagnosis_code
  from public.clinical_notes cn
  where cn.appointment_id = v_appointment.id
  order by cn.created_at desc
  limit 1;

  v_diagnosis_code := coalesce(
    nullif(trim(p_diagnosis_code), ''),
    nullif(trim(v_diagnosis_code), '')
  );

  if v_diagnosis_code is null then
    select cd.diagnosis_code into v_diagnosis_code
    from public.client_diagnoses cd
    where cd.client_id = v_appointment.client_id
      and cd.diagnosis_status = 'active'::public.diagnosis_status_enum
    order by cd.created_at desc
    limit 1;
  end if;

  select cip.payer_id into v_payer_id
  from public.client_insurance_policies cip
  where cip.client_id = v_appointment.client_id
    and cip.status = 'active'::public.insurance_policy_status_enum
  order by case cip.insurance_order
    when 'primary'::public.insurance_order_enum then 1
    when 'secondary'::public.insurance_order_enum then 2
    when 'tertiary'::public.insurance_order_enum then 3
    else 4
  end, cip.created_at desc
  limit 1;

  if v_payer_id is null then
    v_charge_status := 'blocked'::public.charge_status_enum;
    v_block_reason := 'missing_insurance';
  elsif v_diagnosis_code is null then
    v_charge_status := 'blocked'::public.charge_status_enum;
    v_block_reason := 'missing_diagnosis';
  elsif v_note_id is null or v_note_status not in ('signed'::public.clinical_note_status_enum, 'locked'::public.clinical_note_status_enum, 'amended'::public.clinical_note_status_enum) then
    v_charge_status := 'blocked'::public.charge_status_enum;
    v_block_reason := 'missing_signed_note';
  else
    v_charge_status := 'ready_for_claim'::public.charge_status_enum;
  end if;

  insert into public.charge_capture_items (
    tenant_id,
    appointment_id,
    client_id,
    provider_id,
    clinical_note_id,
    payer_id,
    service_date,
    cpt_code,
    diagnosis_code,
    place_of_service,
    charge_amount_cents,
    charge_status,
    block_reason
  ) values (
    v_appointment.tenant_id,
    v_appointment.id,
    v_appointment.client_id,
    v_appointment.provider_id,
    v_note_id,
    v_payer_id,
    coalesce(v_appointment.starts_at::date, current_date),
    v_cpt_code,
    v_diagnosis_code,
    nullif(trim(p_place_of_service), ''),
    coalesce(p_charge_amount_cents, 0),
    v_charge_status,
    v_block_reason
  )
  returning id into v_charge_id;

  if v_charge_status = 'blocked'::public.charge_status_enum then
    perform public.create_workqueue_item(
      v_appointment.tenant_id,
      case v_block_reason
        when 'missing_insurance' then 'eligibility_issue'::public.workqueue_type_enum
        when 'missing_diagnosis' then 'charge_validation'::public.workqueue_type_enum
        when 'missing_signed_note' then 'missing_documentation'::public.workqueue_type_enum
        else 'charge_validation'::public.workqueue_type_enum
      end,
      'charge'::public.workqueue_source_object_type_enum,
      v_charge_id,
      'Charge blocked: ' || v_block_reason,
      'Charge cannot move to claim creation until this issue is resolved.',
      'high'::public.workqueue_priority_enum,
      current_date + 1,
      null
    );
  end if;

  return v_charge_id;
end;
$$;

create or replace function public.validate_charge(p_charge_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.charge_capture_items%rowtype;
  v_issues text[] := array[]::text[];
  v_new_status public.charge_status_enum;
  v_block_reason text;
begin
  select * into v_charge
  from public.charge_capture_items
  where id = p_charge_id;

  if not found then
    raise exception 'Charge % was not found or is not visible to the current user', p_charge_id;
  end if;

  perform public.assert_tenant_access(v_charge.tenant_id);

  if nullif(trim(v_charge.cpt_code), '') is null then
    v_issues := array_append(v_issues, 'missing_cpt_code');
  end if;

  if v_charge.charge_amount_cents < 0 then
    v_issues := array_append(v_issues, 'negative_charge_amount');
  end if;

  if v_charge.client_id is null then
    v_issues := array_append(v_issues, 'missing_client');
  end if;

  if v_charge.provider_id is null then
    v_issues := array_append(v_issues, 'missing_provider');
  end if;

  if v_charge.payer_id is null then
    v_issues := array_append(v_issues, 'missing_payer');
  end if;

  if nullif(trim(v_charge.diagnosis_code), '') is null then
    v_issues := array_append(v_issues, 'missing_diagnosis');
  end if;

  if v_charge.clinical_note_id is null then
    v_issues := array_append(v_issues, 'missing_signed_note');
  elsif not exists (
    select 1
    from public.clinical_notes cn
    where cn.id = v_charge.clinical_note_id
      and cn.note_status in ('signed'::public.clinical_note_status_enum, 'locked'::public.clinical_note_status_enum, 'amended'::public.clinical_note_status_enum)
  ) then
    v_issues := array_append(v_issues, 'note_not_signed');
  end if;

  if coalesce(array_length(v_issues, 1), 0) = 0 then
    v_new_status := 'ready_for_claim'::public.charge_status_enum;
    v_block_reason := null;
  else
    v_new_status := 'blocked'::public.charge_status_enum;
    v_block_reason := array_to_string(v_issues, ',');
  end if;

  update public.charge_capture_items
  set charge_status = v_new_status,
      block_reason = v_block_reason,
      updated_at = now()
  where id = p_charge_id;

  if v_new_status = 'blocked'::public.charge_status_enum
     and not exists (
       select 1
       from public.workqueue_items wq
       where wq.tenant_id = v_charge.tenant_id
         and wq.source_object_type = 'charge'::public.workqueue_source_object_type_enum
         and wq.source_object_id = v_charge.id
         and wq.workqueue_status in ('open'::public.workqueue_status_enum, 'in_progress'::public.workqueue_status_enum, 'pending'::public.workqueue_status_enum)
     ) then
    perform public.create_workqueue_item(
      v_charge.tenant_id,
      'charge_validation'::public.workqueue_type_enum,
      'charge'::public.workqueue_source_object_type_enum,
      v_charge.id,
      'Charge validation failed',
      array_to_string(v_issues, ', '),
      'high'::public.workqueue_priority_enum,
      current_date + 1,
      null
    );
  end if;

  return jsonb_build_object(
    'charge_id', p_charge_id,
    'valid', coalesce(array_length(v_issues, 1), 0) = 0,
    'status', v_new_status,
    'issues', to_jsonb(v_issues)
  );
end;
$$;

create or replace function public.create_claim_from_charge(p_charge_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_charge public.charge_capture_items%rowtype;
  v_validation jsonb;
  v_claim_id uuid;
begin
  v_validation := public.validate_charge(p_charge_id);

  if coalesce((v_validation ->> 'valid')::boolean, false) is false then
    raise exception 'Charge % is not ready for claim creation: %', p_charge_id, v_validation -> 'issues';
  end if;

  select * into v_charge
  from public.charge_capture_items
  where id = p_charge_id;

  perform public.assert_tenant_access(v_charge.tenant_id);

  select id into v_claim_id
  from public.professional_claims
  where charge_id = p_charge_id
    and claim_status <> 'voided'::public.claim_status_enum
  order by created_at desc
  limit 1;

  if v_claim_id is not null then
    return v_claim_id;
  end if;

  insert into public.professional_claims (
    tenant_id,
    charge_id,
    client_id,
    payer_id,
    rendering_provider_id,
    billing_provider_id,
    service_date_from,
    service_date_to,
    total_charge_cents,
    patient_control_number,
    claim_status
  ) values (
    v_charge.tenant_id,
    v_charge.id,
    v_charge.client_id,
    v_charge.payer_id,
    v_charge.provider_id,
    v_charge.provider_id,
    v_charge.service_date,
    v_charge.service_date,
    v_charge.charge_amount_cents,
    'TA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    'ready_for_validation'::public.claim_status_enum
  ) returning id into v_claim_id;

  insert into public.professional_claim_lines (
    tenant_id,
    claim_id,
    service_date,
    cpt_code,
    modifier1,
    modifier2,
    diagnosis_pointer,
    units,
    charge_amount_cents
  ) values (
    v_charge.tenant_id,
    v_claim_id,
    v_charge.service_date,
    v_charge.cpt_code,
    v_charge.modifier1,
    v_charge.modifier2,
    case when v_charge.diagnosis_code is not null then '1' else null end,
    1,
    v_charge.charge_amount_cents
  );

  if v_charge.diagnosis_code is not null then
    insert into public.claim_diagnoses (tenant_id, claim_id, diagnosis_code, pointer_order)
    values (v_charge.tenant_id, v_claim_id, v_charge.diagnosis_code, 1);
  end if;

  insert into public.claim_status_history (tenant_id, claim_id, old_status, new_status, changed_by, reason)
  values (v_charge.tenant_id, v_claim_id, null, 'ready_for_validation'::public.claim_status_enum, auth.uid(), 'Claim created from charge');

  update public.charge_capture_items
  set charge_status = 'claim_created'::public.charge_status_enum,
      updated_at = now()
  where id = v_charge.id;

  return v_claim_id;
end;
$$;

create or replace function public.validate_claim(p_claim_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_issues text[] := array[]::text[];
  v_new_status public.claim_status_enum;
begin
  select * into v_claim
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
  end if;

  perform public.assert_tenant_access(v_claim.tenant_id);

  if v_claim.client_id is null then
    v_issues := array_append(v_issues, 'missing_client');
  end if;

  if v_claim.payer_id is null then
    v_issues := array_append(v_issues, 'missing_payer');
  end if;

  if v_claim.rendering_provider_id is null then
    v_issues := array_append(v_issues, 'missing_rendering_provider');
  end if;

  if v_claim.billing_provider_id is null then
    v_issues := array_append(v_issues, 'missing_billing_provider');
  end if;

  if v_claim.service_date_from is null or v_claim.service_date_to is null then
    v_issues := array_append(v_issues, 'missing_service_dates');
  end if;

  if v_claim.total_charge_cents <= 0 then
    v_issues := array_append(v_issues, 'missing_or_zero_charge_amount');
  end if;

  if not exists (select 1 from public.professional_claim_lines pcl where pcl.claim_id = v_claim.id) then
    v_issues := array_append(v_issues, 'missing_claim_lines');
  end if;

  if not exists (select 1 from public.claim_diagnoses cd where cd.claim_id = v_claim.id) then
    v_issues := array_append(v_issues, 'missing_diagnosis');
  end if;

  if coalesce(array_length(v_issues, 1), 0) = 0 then
    v_new_status := 'ready_for_batch'::public.claim_status_enum;
  else
    v_new_status := 'validation_failed'::public.claim_status_enum;
  end if;

  update public.professional_claims
  set claim_status = v_new_status,
      updated_at = now()
  where id = v_claim.id;

  if v_claim.claim_status is distinct from v_new_status then
    insert into public.claim_status_history (tenant_id, claim_id, old_status, new_status, changed_by, reason)
    values (v_claim.tenant_id, v_claim.id, v_claim.claim_status, v_new_status, auth.uid(), 'Claim validation');
  end if;

  if v_new_status = 'validation_failed'::public.claim_status_enum
     and not exists (
       select 1
       from public.workqueue_items wq
       where wq.tenant_id = v_claim.tenant_id
         and wq.source_object_type = 'claim'::public.workqueue_source_object_type_enum
         and wq.source_object_id = v_claim.id
         and wq.workqueue_status in ('open'::public.workqueue_status_enum, 'in_progress'::public.workqueue_status_enum, 'pending'::public.workqueue_status_enum)
     ) then
    perform public.create_workqueue_item(
      v_claim.tenant_id,
      'claim_validation'::public.workqueue_type_enum,
      'claim'::public.workqueue_source_object_type_enum,
      v_claim.id,
      'Claim validation failed',
      array_to_string(v_issues, ', '),
      'high'::public.workqueue_priority_enum,
      current_date + 1,
      null
    );
  end if;

  return jsonb_build_object(
    'claim_id', p_claim_id,
    'valid', coalesce(array_length(v_issues, 1), 0) = 0,
    'status', v_new_status,
    'issues', to_jsonb(v_issues)
  );
end;
$$;

create or replace function public.create_claim_batch(
  p_tenant_id uuid,
  p_batch_name text default null,
  p_limit integer default 100
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim_ids uuid[];
  v_batch_id uuid;
  v_claim_count integer;
  v_total_charge_cents integer;
begin
  perform public.assert_tenant_access(p_tenant_id);

  select array_agg(id), count(*), coalesce(sum(total_charge_cents), 0)::integer
    into v_claim_ids, v_claim_count, v_total_charge_cents
  from (
    select id, total_charge_cents
    from public.professional_claims
    where tenant_id = p_tenant_id
      and claim_status = 'ready_for_batch'::public.claim_status_enum
    order by created_at asc
    limit greatest(coalesce(p_limit, 100), 1)
  ) selected;

  if coalesce(v_claim_count, 0) = 0 then
    raise exception 'No claims are ready for batch for tenant %', p_tenant_id;
  end if;

  insert into public.claim_batches (
    tenant_id,
    batch_name,
    batch_status,
    claim_count,
    total_charge_cents,
    created_by
  ) values (
    p_tenant_id,
    coalesce(nullif(trim(p_batch_name), ''), 'Claim batch ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    'created'::public.claim_batch_status_enum,
    v_claim_count,
    v_total_charge_cents,
    auth.uid()
  ) returning id into v_batch_id;

  insert into public.claim_batch_items (tenant_id, batch_id, claim_id)
  select p_tenant_id, v_batch_id, unnest(v_claim_ids);

  update public.professional_claims pc
  set claim_status = 'batched'::public.claim_status_enum,
      updated_at = now()
  where pc.id = any(v_claim_ids);

  insert into public.claim_status_history (tenant_id, claim_id, old_status, new_status, changed_by, reason)
  select p_tenant_id, claim_id, 'ready_for_batch'::public.claim_status_enum, 'batched'::public.claim_status_enum, auth.uid(), 'Added to claim batch'
  from unnest(v_claim_ids) as claim_id;

  return v_batch_id;
end;
$$;

create or replace function public.classify_denial_from_carc(p_carc_code text)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(regexp_replace(coalesce(p_carc_code, ''), '[^0-9A-Za-z]', '', 'g'), '');
  v_category public.denial_category_enum := 'other'::public.denial_category_enum;
  v_workability public.denial_workability_enum := 'needs_review'::public.denial_workability_enum;
  v_status public.denial_status_enum := 'new'::public.denial_status_enum;
begin
  if v_code in ('147','170','171','172','206','207','208','242','243','279') then
    v_category := 'credentialing'::public.denial_category_enum;
    v_workability := 'auto_writeoff'::public.denial_workability_enum;
    v_status := 'non_workable'::public.denial_status_enum;
  elsif v_code in ('197','198') then
    v_category := 'authorization'::public.denial_category_enum;
    v_workability := 'workable'::public.denial_workability_enum;
  elsif v_code in ('16','125') then
    v_category := 'documentation'::public.denial_category_enum;
    v_workability := 'workable'::public.denial_workability_enum;
  elsif v_code in ('18') then
    v_category := 'duplicate'::public.denial_category_enum;
    v_workability := 'needs_review'::public.denial_workability_enum;
  elsif v_code in ('29') then
    v_category := 'timely_filing'::public.denial_category_enum;
    v_workability := 'needs_review'::public.denial_workability_enum;
  elsif v_code in ('31','27','26') then
    v_category := 'eligibility'::public.denial_category_enum;
    v_workability := 'workable'::public.denial_workability_enum;
  elsif v_code in ('50','96','119','151') then
    v_category := 'medical_necessity'::public.denial_category_enum;
    v_workability := 'workable'::public.denial_workability_enum;
  elsif v_code in ('97','45') then
    v_category := 'contracting'::public.denial_category_enum;
    v_workability := 'needs_review'::public.denial_workability_enum;
  end if;

  return jsonb_build_object(
    'carc_code', v_code,
    'denial_category', v_category,
    'workability', v_workability,
    'denial_status', v_status
  );
end;
$$;

create or replace function public.create_denial_from_claim(
  p_claim_id uuid,
  p_carc_code text default null,
  p_rarc_code text default null,
  p_amount_cents integer default null,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_classification jsonb;
  v_denial_id uuid;
  v_category public.denial_category_enum;
  v_workability public.denial_workability_enum;
  v_status public.denial_status_enum;
begin
  select * into v_claim
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
  end if;

  perform public.assert_tenant_access(v_claim.tenant_id);

  v_classification := public.classify_denial_from_carc(p_carc_code);
  v_category := (v_classification ->> 'denial_category')::public.denial_category_enum;
  v_workability := (v_classification ->> 'workability')::public.denial_workability_enum;
  v_status := (v_classification ->> 'denial_status')::public.denial_status_enum;

  insert into public.denials (
    tenant_id,
    claim_id,
    client_id,
    payer_id,
    denial_date,
    denial_category,
    denial_status,
    workability,
    carc_code,
    rarc_code,
    amount_cents,
    reason
  ) values (
    v_claim.tenant_id,
    v_claim.id,
    v_claim.client_id,
    v_claim.payer_id,
    current_date,
    v_category,
    v_status,
    v_workability,
    nullif(trim(p_carc_code), ''),
    nullif(trim(p_rarc_code), ''),
    p_amount_cents,
    nullif(trim(p_reason), '')
  ) returning id into v_denial_id;

  update public.professional_claims
  set claim_status = 'denied'::public.claim_status_enum,
      updated_at = now()
  where id = v_claim.id;

  insert into public.claim_status_history (tenant_id, claim_id, old_status, new_status, changed_by, reason)
  values (v_claim.tenant_id, v_claim.id, v_claim.claim_status, 'denied'::public.claim_status_enum, auth.uid(), 'Denial recorded');

  perform public.create_workqueue_item(
    v_claim.tenant_id,
    case when v_workability = 'auto_writeoff'::public.denial_workability_enum then 'credentialing_issue'::public.workqueue_type_enum else 'denial_followup'::public.workqueue_type_enum end,
    'denial'::public.workqueue_source_object_type_enum,
    v_denial_id,
    'Denial follow-up: CARC ' || coalesce(nullif(trim(p_carc_code), ''), 'unknown'),
    coalesce(nullif(trim(p_reason), ''), 'Review denial and determine next action.'),
    case when v_workability = 'workable'::public.denial_workability_enum then 'high'::public.workqueue_priority_enum else 'normal'::public.workqueue_priority_enum end,
    current_date + 7,
    null
  );

  return v_denial_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'assert_tenant_access',
        'create_workqueue_item',
        'create_charge_from_appointment',
        'validate_charge',
        'create_claim_from_charge',
        'validate_claim',
        'create_claim_batch',
        'classify_denial_from_carc',
        'create_denial_from_claim'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon', r.nspname, r.proname, r.args);
    execute format('grant execute on function %I.%I(%s) to authenticated', r.nspname, r.proname, r.args);
  end loop;
end $$;
