-- Keep legacy enrollment RPC safe for unscoped records and add a scoped credentialing RPC.

ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'provider_enrollment';

CREATE OR REPLACE FUNCTION public.upsert_provider_enrollment(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_payer_name text,
  p_enrollment_status public.provider_enrollment_status_enum DEFAULT 'not_started'::public.provider_enrollment_status_enum,
  p_payer_provider_id text DEFAULT NULL::text,
  p_effective_date date DEFAULT NULL::date,
  p_termination_date date DEFAULT NULL::date,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public','private','auth','pg_temp'
AS $function$
DECLARE
  v_payer_id uuid;
  v_enrollment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  IF NOT private.has_tenant_write_access(p_tenant_id) THEN
    RAISE EXCEPTION 'Write access required for tenant %', p_tenant_id;
  END IF;

  SELECT id INTO v_payer_id
  FROM public.payers
  WHERE lower(coalesce(normalized_name, name)) = lower(trim(p_payer_name))
     OR id IN (
       SELECT payer_id
       FROM public.payer_aliases
       WHERE lower(alias) = lower(trim(p_payer_name))
     )
  ORDER BY name
  LIMIT 1;

  IF v_payer_id IS NULL THEN
    RAISE EXCEPTION 'Payer reference not found: %', p_payer_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Provider is not available in this tenant';
  END IF;

  -- Legacy RPC now only touches the legacy/unscoped enrollment row.
  SELECT id INTO v_enrollment_id
  FROM public.provider_payer_enrollments
  WHERE tenant_id = p_tenant_id
    AND provider_id = p_provider_id
    AND payer_id = v_payer_id
    AND payer_plan_id IS NULL
    AND practice_entity_id IS NULL
    AND practice_location_id IS NULL
  LIMIT 1;

  IF v_enrollment_id IS NULL THEN
    INSERT INTO public.provider_payer_enrollments (
      tenant_id, provider_id, payer_id, enrollment_status, payer_provider_id,
      effective_date, termination_date, notes
    ) VALUES (
      p_tenant_id, p_provider_id, v_payer_id, p_enrollment_status,
      nullif(trim(p_payer_provider_id), ''), p_effective_date, p_termination_date,
      nullif(trim(p_notes), '')
    )
    RETURNING id INTO v_enrollment_id;
  ELSE
    UPDATE public.provider_payer_enrollments
    SET enrollment_status = p_enrollment_status,
        payer_provider_id = nullif(trim(p_payer_provider_id), ''),
        effective_date = p_effective_date,
        termination_date = p_termination_date,
        notes = nullif(trim(p_notes), ''),
        updated_at = now()
    WHERE id = v_enrollment_id
    RETURNING id INTO v_enrollment_id;
  END IF;

  RETURN v_enrollment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_scoped_provider_enrollment(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_payer_id uuid,
  p_payer_plan_id uuid DEFAULT NULL,
  p_practice_entity_id uuid DEFAULT NULL,
  p_practice_location_id uuid DEFAULT NULL,
  p_payer_contract_id uuid DEFAULT NULL,
  p_enrollment_status public.provider_enrollment_status_enum DEFAULT 'not_started'::public.provider_enrollment_status_enum,
  p_payer_provider_id text DEFAULT NULL,
  p_effective_date date DEFAULT NULL,
  p_termination_date date DEFAULT NULL,
  p_revalidation_due_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public','private','auth','pg_temp'
AS $function$
DECLARE
  v_enrollment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  IF NOT private.has_tenant_write_access(p_tenant_id) THEN
    RAISE EXCEPTION 'Write access required for tenant %', p_tenant_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = p_provider_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Provider is not available in this tenant';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payers WHERE id = p_payer_id) THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;

  IF p_payer_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payer_plans
    WHERE id = p_payer_plan_id AND payer_id = p_payer_id
  ) THEN
    RAISE EXCEPTION 'Payer plan does not belong to the selected payer';
  END IF;

  IF p_practice_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.practice_entities
    WHERE id = p_practice_entity_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Practice entity is not available in this tenant';
  END IF;

  IF p_practice_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.practice_locations
    WHERE id = p_practice_location_id
      AND tenant_id = p_tenant_id
      AND (p_practice_entity_id IS NULL OR practice_entity_id = p_practice_entity_id)
  ) THEN
    RAISE EXCEPTION 'Practice location is not available in the selected scope';
  END IF;

  IF p_payer_contract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payer_contracts
    WHERE id = p_payer_contract_id
      AND tenant_id = p_tenant_id
      AND payer_id = p_payer_id
      AND (p_practice_entity_id IS NULL OR practice_entity_id IS NULL OR practice_entity_id = p_practice_entity_id)
  ) THEN
    RAISE EXCEPTION 'Payer contract is not available in the selected scope';
  END IF;

  SELECT id INTO v_enrollment_id
  FROM public.provider_payer_enrollments
  WHERE tenant_id = p_tenant_id
    AND provider_id = p_provider_id
    AND payer_id = p_payer_id
    AND payer_plan_id IS NOT DISTINCT FROM p_payer_plan_id
    AND practice_entity_id IS NOT DISTINCT FROM p_practice_entity_id
    AND practice_location_id IS NOT DISTINCT FROM p_practice_location_id
  LIMIT 1;

  IF v_enrollment_id IS NULL THEN
    INSERT INTO public.provider_payer_enrollments (
      tenant_id, provider_id, payer_id, payer_plan_id, practice_entity_id,
      practice_location_id, payer_contract_id, enrollment_status, payer_provider_id,
      effective_date, termination_date, revalidation_due_date, notes
    ) VALUES (
      p_tenant_id, p_provider_id, p_payer_id, p_payer_plan_id, p_practice_entity_id,
      p_practice_location_id, p_payer_contract_id, p_enrollment_status,
      nullif(trim(p_payer_provider_id), ''), p_effective_date, p_termination_date,
      p_revalidation_due_date, nullif(trim(p_notes), '')
    )
    RETURNING id INTO v_enrollment_id;
  ELSE
    UPDATE public.provider_payer_enrollments
    SET payer_contract_id = p_payer_contract_id,
        enrollment_status = p_enrollment_status,
        payer_provider_id = nullif(trim(p_payer_provider_id), ''),
        effective_date = p_effective_date,
        termination_date = p_termination_date,
        revalidation_due_date = p_revalidation_due_date,
        notes = nullif(trim(p_notes), ''),
        updated_at = now()
    WHERE id = v_enrollment_id
    RETURNING id INTO v_enrollment_id;
  END IF;

  RETURN v_enrollment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_scoped_provider_enrollment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,public.provider_enrollment_status_enum,text,date,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_scoped_provider_enrollment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,public.provider_enrollment_status_enum,text,date,date,date,text) TO authenticated, service_role;

-- Make revalidation workqueue items enrollment-specific so separate products/locations cannot collapse into one task.
CREATE OR REPLACE FUNCTION public.sync_provider_revalidation_work(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','private','auth','pg_temp'
AS $function$
DECLARE
  v_created integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  IF NOT private.has_tenant_write_access(p_tenant_id) THEN
    RAISE EXCEPTION 'Write access required for tenant %', p_tenant_id;
  END IF;

  INSERT INTO public.workqueue_items (
    tenant_id, workqueue_type, workqueue_status, priority,
    source_object_type, source_object_id, title, description, due_date, created_by
  )
  SELECT
    ppe.tenant_id,
    'recredentialing'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    CASE WHEN ppe.revalidation_due_date < current_date
      THEN 'urgent'::public.workqueue_priority_enum
      ELSE 'high'::public.workqueue_priority_enum END,
    'provider_enrollment'::public.workqueue_source_object_type_enum,
    ppe.id,
    py.name ||
      COALESCE(' - ' || pp.name, '') ||
      COALESCE(' - ' || pl.name, '') ||
      ' revalidation ' ||
      CASE WHEN ppe.revalidation_due_date < current_date THEN 'overdue' ELSE 'due soon' END,
    'Provider revalidation is due ' || ppe.revalidation_due_date::text || '.',
    ppe.revalidation_due_date,
    auth.uid()
  FROM public.provider_payer_enrollments ppe
  JOIN public.payers py ON py.id = ppe.payer_id
  LEFT JOIN public.payer_plans pp ON pp.id = ppe.payer_plan_id
  LEFT JOIN public.practice_locations pl ON pl.id = ppe.practice_location_id
  WHERE ppe.tenant_id = p_tenant_id
    AND ppe.revalidation_due_date IS NOT NULL
    AND ppe.enrollment_status IN ('approved','needs_revalidation')
    AND ppe.revalidation_due_date <= current_date + 90
    AND NOT EXISTS (
      SELECT 1 FROM public.workqueue_items w
      WHERE w.tenant_id = ppe.tenant_id
        AND w.workqueue_type = 'recredentialing'::public.workqueue_type_enum
        AND w.source_object_type = 'provider_enrollment'::public.workqueue_source_object_type_enum
        AND w.source_object_id = ppe.id
        AND w.workqueue_status NOT IN ('completed','cancelled')
    );

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$function$;

-- Keep transition behavior, but make any newly generated revalidation task specific to the enrollment row.
CREATE OR REPLACE FUNCTION public.transition_provider_enrollment(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_enrollment_status public.provider_enrollment_status_enum,
  p_reason text DEFAULT 'Credentialing workflow update'::text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public','private','auth','pg_temp'
AS $function$
DECLARE
  v_before public.provider_payer_enrollments%rowtype;
  v_after public.provider_payer_enrollments%rowtype;
  v_payer_name text;
  v_plan_name text;
  v_location_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  IF NOT private.has_tenant_write_access(p_tenant_id) THEN
    RAISE EXCEPTION 'Write access required for tenant %', p_tenant_id;
  END IF;

  SELECT * INTO v_before
  FROM public.provider_payer_enrollments
  WHERE id = p_enrollment_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider enrollment not found';
  END IF;

  UPDATE public.provider_payer_enrollments
  SET enrollment_status = p_enrollment_status,
      updated_at = now()
  WHERE id = p_enrollment_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_after;

  IF v_before.enrollment_status IS DISTINCT FROM v_after.enrollment_status THEN
    INSERT INTO public.status_history (
      tenant_id, target_type, target_id, old_status, new_status, changed_by, reason
    ) VALUES (
      p_tenant_id, 'provider_payer_enrollment', p_enrollment_id,
      v_before.enrollment_status::text, v_after.enrollment_status::text,
      auth.uid(), nullif(trim(coalesce(p_reason, '')), '')
    );
  END IF;

  IF v_after.enrollment_status = 'needs_revalidation'
     OR (v_after.enrollment_status = 'approved'
       AND v_after.revalidation_due_date IS NOT NULL
       AND v_after.revalidation_due_date <= current_date + 90) THEN

    SELECT py.name, pp.name, pl.name
      INTO v_payer_name, v_plan_name, v_location_name
    FROM public.payers py
    LEFT JOIN public.payer_plans pp ON pp.id = v_after.payer_plan_id
    LEFT JOIN public.practice_locations pl ON pl.id = v_after.practice_location_id
    WHERE py.id = v_after.payer_id;

    INSERT INTO public.workqueue_items (
      tenant_id, workqueue_type, workqueue_status, priority,
      source_object_type, source_object_id, title, description, due_date, created_by
    )
    SELECT
      p_tenant_id,
      'recredentialing'::public.workqueue_type_enum,
      'open'::public.workqueue_status_enum,
      CASE WHEN v_after.revalidation_due_date IS NOT NULL AND v_after.revalidation_due_date < current_date
        THEN 'urgent'::public.workqueue_priority_enum
        ELSE 'high'::public.workqueue_priority_enum END,
      'provider_enrollment'::public.workqueue_source_object_type_enum,
      v_after.id,
      coalesce(v_payer_name, 'Payer') ||
        COALESCE(' - ' || v_plan_name, '') ||
        COALESCE(' - ' || v_location_name, '') ||
        ' revalidation ' ||
        CASE WHEN v_after.revalidation_due_date IS NOT NULL AND v_after.revalidation_due_date < current_date
          THEN 'overdue' ELSE 'due soon' END,
      CASE WHEN v_after.revalidation_due_date IS NULL
        THEN 'Provider revalidation requires action.'
        ELSE 'Provider revalidation is due ' || v_after.revalidation_due_date::text || '.' END,
      v_after.revalidation_due_date,
      auth.uid()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workqueue_items w
      WHERE w.tenant_id = p_tenant_id
        AND w.workqueue_type = 'recredentialing'::public.workqueue_type_enum
        AND w.source_object_type = 'provider_enrollment'::public.workqueue_source_object_type_enum
        AND w.source_object_id = v_after.id
        AND w.workqueue_status NOT IN ('completed','cancelled')
    );
  END IF;

  RETURN v_after.id;
END;
$function$;
