-- Repair the canonical claim-validation RPC after legacy workflow cleanup.
-- 20260923034500_remove_conflicting_workflows.sql intentionally removed
-- public.validate_claim(uuid), but rcm_validate_claim still delegated to it.
-- Keep one supported public entry point with the validation logic embedded here.

create or replace function public.rcm_validate_claim(p_claim_id uuid)
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

  if v_claim.claim_status not in (
    'ready_for_validation'::public.claim_status_enum,
    'validation_failed'::public.claim_status_enum,
    'corrected'::public.claim_status_enum
  ) then
    raise exception 'Claim cannot be validated from % status.', v_claim.claim_status;
  end if;

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

revoke execute on function public.rcm_validate_claim(uuid) from public;
revoke execute on function public.rcm_validate_claim(uuid) from anon;
grant execute on function public.rcm_validate_claim(uuid) to authenticated;
