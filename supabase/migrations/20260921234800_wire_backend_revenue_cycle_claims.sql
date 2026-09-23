
create or replace function public.rcm_create_claim_from_charges(
  p_tenant_id uuid,
  p_charge_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_charge_count integer := 0;
  v_first public.charge_capture_items%rowtype;
  v_charge public.charge_capture_items%rowtype;
  v_claim_id uuid;
  v_patient_control_number text;
  v_total_charge_cents bigint := 0;
  v_service_date_from date;
  v_service_date_to date;
  v_diagnoses text[];
  v_line_count integer := 0;
  v_diagnosis_count integer := 0;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_charge_ids is null or cardinality(p_charge_ids) = 0 then
    raise exception 'Select at least one ready charge to create a claim.';
  end if;

  if cardinality(p_charge_ids) <> (
    select count(distinct id)
    from public.charge_capture_items
    where tenant_id = p_tenant_id
      and id = any(p_charge_ids)
  ) then
    raise exception 'One or more selected charges were not found in this tenant.';
  end if;

  perform 1
  from public.charge_capture_items
  where tenant_id = p_tenant_id
    and id = any(p_charge_ids)
  for update;

  select count(*)
    into v_charge_count
  from public.charge_capture_items
  where tenant_id = p_tenant_id
    and id = any(p_charge_ids)
    and charge_status <> 'ready_for_claim'::public.charge_status_enum;

  if v_charge_count > 0 then
    raise exception 'Every selected charge must be ready for claim creation.';
  end if;

  select *
    into v_first
  from public.charge_capture_items
  where tenant_id = p_tenant_id
    and id = any(p_charge_ids)
  order by service_date, created_at, id
  limit 1;

  if exists (
    select 1
    from public.charge_capture_items c
    where c.tenant_id = p_tenant_id
      and c.id = any(p_charge_ids)
      and (
        c.encounter_id is distinct from v_first.encounter_id
        or c.client_id is distinct from v_first.client_id
        or c.provider_id is distinct from v_first.provider_id
        or c.payer_id is distinct from v_first.payer_id
      )
  ) then
    raise exception 'Selected charges must belong to the same encounter, patient, provider, and payer.';
  end if;

  if v_first.payer_id is null then
    raise exception 'Payer is required for an insurance claim.';
  end if;

  select
    coalesce(sum(c.charge_amount_cents), 0),
    min(c.service_date),
    max(c.service_date),
    array_agg(distinct upper(trim(c.diagnosis_code)) order by upper(trim(c.diagnosis_code)))
      filter (where nullif(trim(c.diagnosis_code), '') is not null)
  into
    v_total_charge_cents,
    v_service_date_from,
    v_service_date_to,
    v_diagnoses
  from public.charge_capture_items c
  where c.tenant_id = p_tenant_id
    and c.id = any(p_charge_ids);

  if v_total_charge_cents <= 0 then
    raise exception 'Claim charge must be greater than zero.';
  end if;

  if coalesce(cardinality(v_diagnoses), 0) = 0 then
    raise exception 'At least one diagnosis is required to create a claim.';
  end if;

  v_patient_control_number :=
    'TH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  insert into public.professional_claims (
    tenant_id,
    charge_id,
    client_id,
    rendering_provider_id,
    billing_provider_id,
    payer_id,
    claim_status,
    service_date_from,
    service_date_to,
    total_charge_cents,
    patient_control_number,
    source_encounter_id,
    metadata
  ) values (
    p_tenant_id,
    v_first.id,
    v_first.client_id,
    v_first.provider_id,
    v_first.provider_id,
    v_first.payer_id,
    'ready_for_validation'::public.claim_status_enum,
    v_service_date_from,
    v_service_date_to,
    v_total_charge_cents,
    v_patient_control_number,
    v_first.encounter_id,
    jsonb_build_object(
      'source', 'encounter_charge',
      'charge_ids', to_jsonb(p_charge_ids),
      'created_by_rpc', 'rcm_create_claim_from_charges'
    )
  )
  returning id into v_claim_id;

  for v_charge in
    select *
    from public.charge_capture_items
    where tenant_id = p_tenant_id
      and id = any(p_charge_ids)
    order by service_date, created_at, id
  loop
    insert into public.professional_claim_lines (
      tenant_id,
      claim_id,
      service_date,
      cpt_code,
      modifier1,
      modifier2,
      diagnosis_pointer,
      place_of_service,
      units,
      charge_amount_cents
    ) values (
      p_tenant_id,
      v_claim_id,
      v_charge.service_date,
      v_charge.cpt_code,
      v_charge.modifier1,
      v_charge.modifier2,
      array_position(v_diagnoses, upper(trim(v_charge.diagnosis_code)))::text,
      v_charge.place_of_service,
      coalesce(v_charge.units, 1),
      v_charge.charge_amount_cents
    );
    v_line_count := v_line_count + 1;
  end loop;

  insert into public.claim_diagnoses (
    tenant_id,
    claim_id,
    diagnosis_code,
    pointer_order
  )
  select
    p_tenant_id,
    v_claim_id,
    v_diagnoses[i],
    i
  from generate_subscripts(v_diagnoses, 1) g(i);

  get diagnostics v_diagnosis_count = row_count;

  insert into public.claim_status_history (
    tenant_id,
    claim_id,
    old_status,
    new_status,
    changed_by,
    reason
  ) values (
    p_tenant_id,
    v_claim_id,
    null,
    'ready_for_validation'::public.claim_status_enum,
    auth.uid(),
    'Claim created transactionally from ready charges'
  );

  update public.charge_capture_items
  set charge_status = 'claim_created'::public.charge_status_enum,
      block_reason = null,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = any(p_charge_ids);

  if v_first.encounter_id is not null then
    update public.encounters
    set billing_status = 'claimed',
        updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_first.encounter_id;
  end if;

  perform public.post_claim_charge_to_ledger(v_claim_id);
  perform public.recalculate_claim_balance_summary(v_claim_id);
  perform public.recalculate_client_balance_summary(v_first.client_id);

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'patient_control_number', v_patient_control_number,
    'line_count', v_line_count,
    'diagnosis_count', v_diagnosis_count,
    'total_charge_cents', v_total_charge_cents
  );
end;
$function$;

create or replace function public.validate_claim(p_claim_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_claim public.professional_claims%rowtype;
  v_issues text[] := array[]::text[];
  v_new_status public.claim_status_enum;
  v_enrollment_status text;
  v_encounter_billing_status text;
begin
  select *
    into v_claim
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
  end if;

  perform public.assert_tenant_access(v_claim.tenant_id);

  if v_claim.client_id is null then
    v_issues := array_append(v_issues, 'Patient is missing.');
  end if;
  if v_claim.payer_id is null then
    v_issues := array_append(v_issues, 'Payer is missing.');
  end if;
  if v_claim.rendering_provider_id is null then
    v_issues := array_append(v_issues, 'Rendering provider is missing.');
  end if;
  if v_claim.billing_provider_id is null then
    v_issues := array_append(v_issues, 'Billing provider is missing.');
  end if;
  if v_claim.service_date_from is null or v_claim.service_date_to is null then
    v_issues := array_append(v_issues, 'Service date is missing.');
  end if;
  if v_claim.total_charge_cents <= 0 then
    v_issues := array_append(v_issues, 'Claim charge must be greater than zero.');
  end if;

  if not exists (
    select 1
    from public.professional_claim_lines l
    where l.tenant_id = v_claim.tenant_id
      and l.claim_id = v_claim.id
  ) then
    v_issues := array_append(v_issues, 'At least one claim line is required.');
  end if;

  if not exists (
    select 1
    from public.claim_diagnoses d
    where d.tenant_id = v_claim.tenant_id
      and d.claim_id = v_claim.id
  ) then
    v_issues := array_append(v_issues, 'At least one diagnosis is required.');
  end if;

  if exists (
    select 1
    from public.professional_claim_lines l
    where l.tenant_id = v_claim.tenant_id
      and l.claim_id = v_claim.id
      and (
        l.service_date is null
        or nullif(trim(l.cpt_code), '') is null
        or coalesce(l.units, 0) <= 0
        or coalesce(l.charge_amount_cents, 0) <= 0
        or nullif(trim(l.diagnosis_pointer), '') is null
        or coalesce(l.place_of_service, '') !~ '^[0-9]{2}$'
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Claim lines require service date, CPT/HCPCS, positive units and charge, diagnosis pointer, and two-digit place of service.'
    );
  end if;

  if v_claim.rendering_provider_id is not null and v_claim.payer_id is not null then
    select ppe.enrollment_status::text
      into v_enrollment_status
    from public.provider_payer_enrollments ppe
    where ppe.tenant_id = v_claim.tenant_id
      and ppe.provider_id = v_claim.rendering_provider_id
      and ppe.payer_id = v_claim.payer_id
    order by ppe.created_at desc
    limit 1;

    if coalesce(v_enrollment_status, 'unknown') <> 'approved' then
      v_issues := array_append(v_issues, 'Rendering provider is not approved with the payer.');
    end if;
  end if;

  if v_claim.source_encounter_id is not null then
    select e.billing_status
      into v_encounter_billing_status
    from public.encounters e
    where e.tenant_id = v_claim.tenant_id
      and e.id = v_claim.source_encounter_id;

    if coalesce(v_encounter_billing_status, '') not in ('charged', 'claimed') then
      v_issues := array_append(
        v_issues,
        'Source encounter has not completed billing readiness and charge creation.'
      );
    end if;
  end if;

  if coalesce(array_length(v_issues, 1), 0) = 0 then
    v_new_status := 'ready_for_batch'::public.claim_status_enum;
  else
    v_new_status := 'validation_failed'::public.claim_status_enum;
  end if;

  if v_claim.claim_status is distinct from v_new_status then
    update public.professional_claims
    set claim_status = v_new_status,
        updated_at = now()
    where id = v_claim.id
      and tenant_id = v_claim.tenant_id;

    insert into public.claim_status_history (
      tenant_id,
      claim_id,
      old_status,
      new_status,
      changed_by,
      reason
    ) values (
      v_claim.tenant_id,
      v_claim.id,
      v_claim.claim_status,
      v_new_status,
      auth.uid(),
      case
        when v_new_status = 'ready_for_batch'::public.claim_status_enum
          then 'Claim scrub passed'
        else 'Claim scrub failed'
      end
    );
  end if;

  if v_new_status = 'validation_failed'::public.claim_status_enum then
    if not exists (
      select 1
      from public.workqueue_items wq
      where wq.tenant_id = v_claim.tenant_id
        and wq.source_object_type = 'claim'::public.workqueue_source_object_type_enum
        and wq.source_object_id = v_claim.id
        and wq.workqueue_type = 'claim_validation'::public.workqueue_type_enum
        and wq.workqueue_status in (
          'open'::public.workqueue_status_enum,
          'in_progress'::public.workqueue_status_enum,
          'pending'::public.workqueue_status_enum,
          'snoozed'::public.workqueue_status_enum,
          'reopened'::public.workqueue_status_enum
        )
    ) then
      perform public.create_workqueue_item(
        v_claim.tenant_id,
        'claim_validation'::public.workqueue_type_enum,
        'claim'::public.workqueue_source_object_type_enum,
        v_claim.id,
        'Claim validation failed',
        array_to_string(v_issues, ' '),
        'high'::public.workqueue_priority_enum,
        current_date + 1,
        null
      );
    end if;
  else
    update public.workqueue_items
    set workqueue_status = 'completed'::public.workqueue_status_enum,
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where tenant_id = v_claim.tenant_id
      and source_object_type = 'claim'::public.workqueue_source_object_type_enum
      and source_object_id = v_claim.id
      and workqueue_type = 'claim_validation'::public.workqueue_type_enum
      and workqueue_status in (
        'open'::public.workqueue_status_enum,
        'in_progress'::public.workqueue_status_enum,
        'pending'::public.workqueue_status_enum,
        'snoozed'::public.workqueue_status_enum,
        'reopened'::public.workqueue_status_enum
      );
  end if;

  return jsonb_build_object(
    'claim_id', p_claim_id,
    'valid', coalesce(array_length(v_issues, 1), 0) = 0,
    'status', v_new_status,
    'issues', to_jsonb(v_issues)
  );
end;
$function$;

create or replace function public.rcm_create_claim_batch(
  p_tenant_id uuid,
  p_claim_ids uuid[],
  p_batch_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_claim_count integer;
  v_total_charge_cents bigint;
  v_batch_id uuid;
  v_payer_count integer;
  v_payer_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    raise exception 'Select at least one claim for the batch.';
  end if;

  perform 1
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids)
  for update;

  select
    count(distinct id),
    count(distinct payer_id),
    min(payer_id),
    coalesce(sum(total_charge_cents), 0)
  into
    v_claim_count,
    v_payer_count,
    v_payer_id,
    v_total_charge_cents
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  if v_claim_count <> cardinality(p_claim_ids) then
    raise exception 'One or more selected claims were not found in this tenant.';
  end if;

  if exists (
    select 1
    from public.professional_claims
    where tenant_id = p_tenant_id
      and id = any(p_claim_ids)
      and claim_status <> 'ready_for_batch'::public.claim_status_enum
  ) then
    raise exception 'All claims must pass validation before batching.';
  end if;

  if v_payer_count <> 1 or v_payer_id is null then
    raise exception 'A claim batch must contain claims for exactly one payer.';
  end if;

  if exists (
    select 1
    from public.claim_batch_items cbi
    join public.claim_batches cb
      on cb.id = cbi.batch_id
     and cb.tenant_id = cbi.tenant_id
    where cbi.tenant_id = p_tenant_id
      and cbi.claim_id = any(p_claim_ids)
      and cb.batch_status <> 'voided'::public.claim_batch_status_enum
  ) then
    raise exception 'One or more selected claims already belong to an active batch.';
  end if;

  insert into public.claim_batches (
    tenant_id,
    batch_status,
    batch_name,
    claim_count,
    total_charge_cents,
    created_by
  ) values (
    p_tenant_id,
    'ready'::public.claim_batch_status_enum,
    coalesce(nullif(trim(p_batch_name), ''), '837P ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_claim_count,
    v_total_charge_cents,
    auth.uid()
  )
  returning id into v_batch_id;

  insert into public.claim_batch_items (
    tenant_id,
    batch_id,
    claim_id
  )
  select p_tenant_id, v_batch_id, id
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  update public.professional_claims
  set claim_status = 'batched'::public.claim_status_enum,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  insert into public.claim_status_history (
    tenant_id,
    claim_id,
    old_status,
    new_status,
    changed_by,
    reason
  )
  select
    p_tenant_id,
    id,
    'ready_for_batch'::public.claim_status_enum,
    'batched'::public.claim_status_enum,
    auth.uid(),
    'Added to payer claim batch'
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'claim_count', v_claim_count,
    'payer_id', v_payer_id,
    'total_charge_cents', v_total_charge_cents
  );
end;
$function$;

create or replace function public.rcm_record_external_submission(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_external_reference text,
  p_submission_method text default 'external_837p'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_batch public.claim_batches%rowtype;
  v_submission_id uuid;
  v_claim_count integer;
  v_submitted_at timestamptz := now();
begin
  perform public.assert_tenant_access(p_tenant_id);

  if nullif(trim(p_external_reference), '') is null then
    raise exception 'External submission reference is required.';
  end if;

  select *
    into v_batch
  from public.claim_batches
  where tenant_id = p_tenant_id
    and id = p_batch_id
  for update;

  if not found then
    raise exception 'Claim batch not found.';
  end if;

  if v_batch.batch_status not in (
    'ready'::public.claim_batch_status_enum,
    'created'::public.claim_batch_status_enum
  ) then
    raise exception 'Batch cannot be submitted from status %.', v_batch.batch_status;
  end if;

  select count(*)
    into v_claim_count
  from public.claim_batch_items cbi
  join public.professional_claims pc
    on pc.id = cbi.claim_id
   and pc.tenant_id = cbi.tenant_id
  where cbi.tenant_id = p_tenant_id
    and cbi.batch_id = p_batch_id;

  if v_claim_count = 0 then
    raise exception 'Batch has no claims to submit.';
  end if;

  if exists (
    select 1
    from public.claim_batch_items cbi
    join public.professional_claims pc
      on pc.id = cbi.claim_id
     and pc.tenant_id = cbi.tenant_id
    where cbi.tenant_id = p_tenant_id
      and cbi.batch_id = p_batch_id
      and pc.claim_status <> 'batched'::public.claim_status_enum
  ) then
    raise exception 'Every claim in the batch must be batched before submission.';
  end if;

  insert into public.claim_submissions (
    tenant_id,
    batch_id,
    submission_status,
    submission_method,
    submitted_at,
    response_payload
  ) values (
    p_tenant_id,
    p_batch_id,
    'submitted'::public.submission_status_enum,
    coalesce(nullif(trim(p_submission_method), ''), 'external_837p'),
    v_submitted_at,
    jsonb_build_object(
      'external_reference', trim(p_external_reference),
      'recorded_source', 'user_confirmed_external_submission'
    )
  )
  returning id into v_submission_id;

  update public.claim_batches
  set batch_status = 'submitted'::public.claim_batch_status_enum,
      submitted_at = v_submitted_at,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_batch_id;

  insert into public.claim_status_history (
    tenant_id,
    claim_id,
    old_status,
    new_status,
    changed_by,
    reason
  )
  select
    p_tenant_id,
    pc.id,
    pc.claim_status,
    'submitted'::public.claim_status_enum,
    auth.uid(),
    'External 837P submission recorded. Reference: ' || trim(p_external_reference)
  from public.claim_batch_items cbi
  join public.professional_claims pc
    on pc.id = cbi.claim_id
   and pc.tenant_id = cbi.tenant_id
  where cbi.tenant_id = p_tenant_id
    and cbi.batch_id = p_batch_id;

  update public.professional_claims pc
  set claim_status = 'submitted'::public.claim_status_enum,
      submitted_at = v_submitted_at,
      updated_at = now()
  from public.claim_batch_items cbi
  where cbi.tenant_id = p_tenant_id
    and cbi.batch_id = p_batch_id
    and pc.tenant_id = cbi.tenant_id
    and pc.id = cbi.claim_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'submission_id', v_submission_id,
    'claim_count', v_claim_count,
    'submitted_at', v_submitted_at
  );
end;
$function$;

revoke execute on function public.rcm_create_claim_from_charges(uuid, uuid[]) from anon;
revoke execute on function public.rcm_create_claim_batch(uuid, uuid[], text) from anon;
revoke execute on function public.rcm_record_external_submission(uuid, uuid, text, text) from anon;
grant execute on function public.rcm_create_claim_from_charges(uuid, uuid[]) to authenticated;
grant execute on function public.rcm_create_claim_batch(uuid, uuid[], text) to authenticated;
grant execute on function public.rcm_record_external_submission(uuid, uuid, text, text) to authenticated;
