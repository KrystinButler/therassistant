-- Credentialing directory monitoring belongs to the credentialing domain only.
-- These records are informational and must never block, hold, route, or mutate claims.

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
  CONSTRAINT credentialing_directory_expectations_identity_uniq
    UNIQUE NULLS NOT DISTINCT (tenant_id, provider_id, payer_id, source_key)
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
