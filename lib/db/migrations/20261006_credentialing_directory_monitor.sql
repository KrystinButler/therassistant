-- Credentialing directory monitoring is an independent operational domain.
-- Nothing in this migration may block, hold, route, or mutate a claim.

CREATE TABLE IF NOT EXISTS public.credentialing_directory_expectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  payer_id uuid REFERENCES public.payers(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  expected_participation boolean,
  expected_location_text text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_id, payer_id, source_key)
);

CREATE INDEX IF NOT EXISTS credentialing_directory_expectations_provider_idx
  ON public.credentialing_directory_expectations (tenant_id, provider_id, active);

CREATE TABLE IF NOT EXISTS public.credentialing_directory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  payer_id uuid REFERENCES public.payers(id) ON DELETE CASCADE,
  expectation_id uuid REFERENCES public.credentialing_directory_expectations(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  source_record_id text,
  directory_status text NOT NULL CHECK (
    directory_status IN ('found', 'not_found', 'multiple_matches', 'unable_to_verify', 'source_unavailable')
  ),
  provider_npi text,
  provider_name text,
  specialty_text text,
  location_text text,
  network_text text,
  source_updated_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credentialing_directory_snapshots_latest_idx
  ON public.credentialing_directory_snapshots
  (tenant_id, provider_id, source_key, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.credentialing_directory_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  payer_id uuid REFERENCES public.payers(id) ON DELETE CASCADE,
  expectation_id uuid REFERENCES public.credentialing_directory_expectations(id) ON DELETE SET NULL,
  snapshot_id uuid REFERENCES public.credentialing_directory_snapshots(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  discrepancy_type text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'reviewed', 'accepted_directory_update', 'kept_internal_record', 'resolved')
  ),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credentialing_directory_discrepancies_queue_idx
  ON public.credentialing_directory_discrepancies
  (tenant_id, status, last_detected_at DESC);

-- Public is an exposed Supabase schema. Credentialing monitoring records must
-- follow the same tenant isolation model as the existing provider tables.
ALTER TABLE public.credentialing_directory_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentialing_directory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentialing_directory_discrepancies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.credentialing_directory_expectations FROM anon;
REVOKE ALL ON public.credentialing_directory_snapshots FROM anon;
REVOKE ALL ON public.credentialing_directory_discrepancies FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentialing_directory_expectations TO authenticated;
GRANT SELECT ON public.credentialing_directory_snapshots TO authenticated;
GRANT SELECT, UPDATE ON public.credentialing_directory_discrepancies TO authenticated;

DROP POLICY IF EXISTS credentialing_directory_expectations_tenant_select ON public.credentialing_directory_expectations;
CREATE POLICY credentialing_directory_expectations_tenant_select
  ON public.credentialing_directory_expectations
  FOR SELECT TO authenticated
  USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_expectations_tenant_insert ON public.credentialing_directory_expectations;
CREATE POLICY credentialing_directory_expectations_tenant_insert
  ON public.credentialing_directory_expectations
  FOR INSERT TO authenticated
  WITH CHECK (private.has_tenant_write_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_expectations_tenant_update ON public.credentialing_directory_expectations;
CREATE POLICY credentialing_directory_expectations_tenant_update
  ON public.credentialing_directory_expectations
  FOR UPDATE TO authenticated
  USING (private.has_tenant_write_access(tenant_id))
  WITH CHECK (private.has_tenant_write_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_expectations_tenant_delete ON public.credentialing_directory_expectations;
CREATE POLICY credentialing_directory_expectations_tenant_delete
  ON public.credentialing_directory_expectations
  FOR DELETE TO authenticated
  USING (private.has_tenant_write_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_snapshots_tenant_select ON public.credentialing_directory_snapshots;
CREATE POLICY credentialing_directory_snapshots_tenant_select
  ON public.credentialing_directory_snapshots
  FOR SELECT TO authenticated
  USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_discrepancies_tenant_select ON public.credentialing_directory_discrepancies;
CREATE POLICY credentialing_directory_discrepancies_tenant_select
  ON public.credentialing_directory_discrepancies
  FOR SELECT TO authenticated
  USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS credentialing_directory_discrepancies_tenant_update ON public.credentialing_directory_discrepancies;
CREATE POLICY credentialing_directory_discrepancies_tenant_update
  ON public.credentialing_directory_discrepancies
  FOR UPDATE TO authenticated
  USING (private.has_tenant_write_access(tenant_id))
  WITH CHECK (private.has_tenant_write_access(tenant_id));

COMMENT ON TABLE public.credentialing_directory_expectations IS
  'Credentialing-only expected directory/network participation. Has no claim workflow authority.';
COMMENT ON TABLE public.credentialing_directory_snapshots IS
  'Immutable observations from public provider directories. Never mutates claims or manual enrollment records.';
COMMENT ON TABLE public.credentialing_directory_discrepancies IS
  'Credentialing reconciliation queue generated from directory observations. Never creates claim holds.';

-- Hard architectural guardrail: claim validation contains no credentialing/enrollment lookup.
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
  v_encounter_billing_status text;
BEGIN
  SELECT * INTO v_claim
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
    SELECT 1 FROM public.professional_claim_lines l
    WHERE l.tenant_id = v_claim.tenant_id AND l.claim_id = v_claim.id
  ) THEN
    v_issues := array_append(v_issues, 'At least one claim line is required.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.claim_diagnoses d
    WHERE d.tenant_id = v_claim.tenant_id AND d.claim_id = v_claim.id
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

  -- Encounter state may be surfaced as an operational warning. Credentialing is intentionally absent.
  IF v_claim.source_encounter_id IS NOT NULL THEN
    SELECT e.billing_status INTO v_encounter_billing_status
    FROM public.encounters e
    WHERE e.tenant_id = v_claim.tenant_id AND e.id = v_claim.source_encounter_id;

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
    SET claim_status = v_new_status, updated_at = now()
    WHERE id = v_claim.id AND tenant_id = v_claim.tenant_id;
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
