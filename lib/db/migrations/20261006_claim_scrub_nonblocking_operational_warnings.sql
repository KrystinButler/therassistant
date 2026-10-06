CREATE OR REPLACE FUNCTION public.rcm_validate_claim(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claim public.professional_claims%rowtype;
  v_issues text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_new_status public.claim_status_enum;
  v_enrollment_status text;
  v_encounter_billing_status text;
BEGIN
  SELECT *
    INTO v_claim
  FROM public.professional_claims
  WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim % was not found or is not visible to the current user', p_claim_id;
  END IF;

  PERFORM public.assert_tenant_access(v_claim.tenant_id);

  IF v_claim.claim_status NOT IN (
    'ready_for_validation'::public.claim_status_enum,
    'validation_failed'::public.claim_status_enum,
    'corrected'::public.claim_status_enum
  ) THEN
    RAISE EXCEPTION 'Claim cannot be scrubbed from % status.', v_claim.claim_status;
  END IF;

  IF v_claim.client_id IS NULL THEN
    v_issues := array_append(v_issues, 'Patient is missing.');
  END IF;
  IF v_claim.payer_id IS NULL THEN
    v_issues := array_append(v_issues, 'Payer is missing.');
  END IF;
  IF v_claim.rendering_provider_id IS NULL THEN
    v_issues := array_append(v_issues, 'Rendering provider is missing.');
  END IF;
  IF v_claim.billing_provider_id IS NULL THEN
    v_issues := array_append(v_issues, 'Billing provider is missing.');
  END IF;
  IF v_claim.service_date_from IS NULL OR v_claim.service_date_to IS NULL THEN
    v_issues := array_append(v_issues, 'Service date is missing.');
  END IF;
  IF v_claim.total_charge_cents <= 0 THEN
    v_issues := array_append(v_issues, 'Claim charge must be greater than zero.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.professional_claim_lines l
    WHERE l.tenant_id = v_claim.tenant_id
      AND l.claim_id = v_claim.id
  ) THEN
    v_issues := array_append(v_issues, 'At least one claim line is required.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.claim_diagnoses d
    WHERE d.tenant_id = v_claim.tenant_id
      AND d.claim_id = v_claim.id
  ) THEN
    v_issues := array_append(v_issues, 'At least one diagnosis is required.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.professional_claim_lines l
    WHERE l.tenant_id = v_claim.tenant_id
      AND l.claim_id = v_claim.id
      AND (
        l.service_date IS NULL
        OR nullif(trim(l.cpt_code), '') IS NULL
        OR coalesce(l.units, 0) <= 0
        OR coalesce(l.charge_amount_cents, 0) <= 0
        OR nullif(trim(l.diagnosis_pointer), '') IS NULL
        OR coalesce(l.place_of_service, '') !~ '^[0-9]{2}$'
      )
  ) THEN
    v_issues := array_append(
      v_issues,
      'Claim lines require service date, CPT/HCPCS, positive units and charge, diagnosis pointer, and two-digit place of service.'
    );
  END IF;

  -- Enrollment is operational context, not a billing hard stop.
  IF v_claim.rendering_provider_id IS NOT NULL AND v_claim.payer_id IS NOT NULL THEN
    SELECT ppe.enrollment_status::text
      INTO v_enrollment_status
    FROM public.provider_payer_enrollments ppe
    WHERE ppe.tenant_id = v_claim.tenant_id
      AND ppe.provider_id = v_claim.rendering_provider_id
      AND ppe.payer_id = v_claim.payer_id
    ORDER BY ppe.created_at DESC
    LIMIT 1;

    IF coalesce(v_enrollment_status, 'unknown') NOT IN ('approved', 'needs_revalidation') THEN
      v_warnings := array_append(v_warnings, 'Rendering provider is not approved with the payer.');
    END IF;
  END IF;

  -- Encounter workflow readiness is operational context, not a claim scrub failure.
  IF v_claim.source_encounter_id IS NOT NULL THEN
    SELECT e.billing_status
      INTO v_encounter_billing_status
    FROM public.encounters e
    WHERE e.tenant_id = v_claim.tenant_id
      AND e.id = v_claim.source_encounter_id;

    IF coalesce(v_encounter_billing_status, '') NOT IN ('charged', 'claimed') THEN
      v_warnings := array_append(
        v_warnings,
        'Source encounter has not completed billing readiness and charge creation.'
      );
    END IF;
  END IF;

  IF coalesce(array_length(v_issues, 1), 0) = 0 THEN
    v_new_status := 'ready_for_batch'::public.claim_status_enum;
  ELSE
    v_new_status := 'validation_failed'::public.claim_status_enum;
  END IF;

  IF v_claim.claim_status IS DISTINCT FROM v_new_status THEN
    UPDATE public.professional_claims
    SET claim_status = v_new_status,
        updated_at = now()
    WHERE id = v_claim.id
      AND tenant_id = v_claim.tenant_id;
  END IF;

  IF v_new_status = 'validation_failed'::public.claim_status_enum THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workqueue_items wq
      WHERE wq.tenant_id = v_claim.tenant_id
        AND wq.source_object_type = 'claim'::public.workqueue_source_object_type_enum
        AND wq.source_object_id = v_claim.id
        AND wq.workqueue_type = 'claim_validation'::public.workqueue_type_enum
        AND wq.workqueue_status IN (
          'open'::public.workqueue_status_enum,
          'in_progress'::public.workqueue_status_enum,
          'pending'::public.workqueue_status_enum,
          'snoozed'::public.workqueue_status_enum,
          'reopened'::public.workqueue_status_enum
        )
    ) THEN
      PERFORM public.create_workqueue_item(
        v_claim.tenant_id,
        'claim_validation'::public.workqueue_type_enum,
        'claim'::public.workqueue_source_object_type_enum,
        v_claim.id,
        'Claim scrub failed',
        array_to_string(v_issues, ' '),
        'high'::public.workqueue_priority_enum,
        current_date + 1,
        NULL
      );
    END IF;
  ELSE
    UPDATE public.workqueue_items
    SET workqueue_status = 'completed'::public.workqueue_status_enum,
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    WHERE tenant_id = v_claim.tenant_id
      AND source_object_type = 'claim'::public.workqueue_source_object_type_enum
      AND source_object_id = v_claim.id
      AND workqueue_type = 'claim_validation'::public.workqueue_type_enum
      AND workqueue_status IN (
        'open'::public.workqueue_status_enum,
        'in_progress'::public.workqueue_status_enum,
        'pending'::public.workqueue_status_enum,
        'snoozed'::public.workqueue_status_enum,
        'reopened'::public.workqueue_status_enum
      );
  END IF;

  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'valid', coalesce(array_length(v_issues, 1), 0) = 0,
    'status', v_new_status,
    'issues', to_jsonb(v_issues),
    'warnings', to_jsonb(v_warnings)
  );
END;
$function$;
