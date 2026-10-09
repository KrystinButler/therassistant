-- SPEC-1 automated participation verification engine.
-- Automated verification history is separate from the existing manual
-- participation_verifications table and has no claim workflow authority.

CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pgmq.list_queues()
    WHERE queue_name = 'credentialing_participation_verification'
  ) THEN
    PERFORM pgmq.create('credentialing_participation_verification');
  END IF;
END
$$;

REVOKE USAGE ON SCHEMA pgmq FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.participation_verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES public.practice_entities(id) ON DELETE RESTRICT,
  practice_location_id uuid REFERENCES public.practice_locations(id) ON DELETE RESTRICT,
  payer_id uuid NOT NULL REFERENCES public.payers(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.payer_plans(id) ON DELETE RESTRICT,
  network_id uuid REFERENCES public.payer_networks(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'IN_PROGRESS',
  confidence text,
  source_type text,
  source_reference text,
  source_updated_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  verified_at timestamptz,
  adapter_version text,
  matching_algorithm_version text,
  failure_code text,
  failure_detail text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participation_verification_runs_status_check
    CHECK (status IN ('IN_PROGRESS', 'PARTICIPATING', 'NOT_FOUND', 'UNABLE_TO_VERIFY')),
  CONSTRAINT participation_verification_runs_confidence_check
    CHECK (confidence IS NULL OR confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  CONSTRAINT participation_verification_runs_completion_check
    CHECK (
      (status = 'IN_PROGRESS' AND completed_at IS NULL)
      OR
      (status <> 'IN_PROGRESS' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS participation_verification_runs_tenant_provider_idx
  ON public.participation_verification_runs(tenant_id, provider_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS participation_verification_runs_catalog_idx
  ON public.participation_verification_runs(payer_id, plan_id, network_id);
CREATE INDEX IF NOT EXISTS participation_verification_runs_status_idx
  ON public.participation_verification_runs(status, requested_at);

CREATE TABLE IF NOT EXISTS public.participation_verification_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  verification_id uuid NOT NULL REFERENCES public.participation_verification_runs(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_type text NOT NULL,
  source_reference text,
  source_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  content_hash text,
  content_type text,
  adapter_version text NOT NULL,
  normalized_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participation_verification_evidence_run_idx
  ON public.participation_verification_evidence(verification_id, retrieved_at);

CREATE TABLE IF NOT EXISTS public.participation_verification_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  verification_id uuid NOT NULL REFERENCES public.participation_verification_runs(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES public.participation_verification_evidence(id) ON DELETE SET NULL,
  match_type text NOT NULL,
  expected_value text,
  observed_value text,
  matched boolean NOT NULL,
  score numeric(6,5),
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participation_verification_matches_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 1))
);

CREATE INDEX IF NOT EXISTS participation_verification_matches_run_idx
  ON public.participation_verification_matches(verification_id, match_type);

CREATE TABLE IF NOT EXISTS public.payer_adapter_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid REFERENCES public.payers(id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  source_updated_at timestamptz,
  response_time_ms integer,
  failure_code text,
  failure_detail text,
  adapter_version text NOT NULL,
  freshness_threshold_hours integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_adapter_health_status_check
    CHECK (status IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'MISCONFIGURED')),
  CONSTRAINT payer_adapter_health_response_time_check
    CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  CONSTRAINT payer_adapter_health_freshness_check
    CHECK (freshness_threshold_hours IS NULL OR freshness_threshold_hours > 0)
);

CREATE INDEX IF NOT EXISTS payer_adapter_health_source_idx
  ON public.payer_adapter_health(source_key, checked_at DESC);
CREATE INDEX IF NOT EXISTS payer_adapter_health_payer_idx
  ON public.payer_adapter_health(payer_id, checked_at DESC);

-- Reject cross-tenant foreign-key substitution even when inserts are performed
-- by a privileged server role. This function is invoker-safe and only validates
-- existing ownership/reference relationships.
CREATE OR REPLACE FUNCTION private.validate_participation_verification_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = NEW.provider_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Provider is outside verification tenant';
  END IF;

  IF NEW.organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.practice_entities e
    WHERE e.id = NEW.organization_id AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Organization is outside verification tenant';
  END IF;

  IF NEW.practice_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.practice_locations l
    WHERE l.id = NEW.practice_location_id AND l.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Location is outside verification tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payer_plans pp
    WHERE pp.id = NEW.plan_id AND pp.payer_id = NEW.payer_id
  ) THEN
    RAISE EXCEPTION 'Plan does not belong to selected payer';
  END IF;

  IF NEW.network_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payer_networks pn
    WHERE pn.id = NEW.network_id AND pn.plan_id = NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'Network does not belong to selected plan';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participation_verification_runs_scope_guard
  ON public.participation_verification_runs;
CREATE TRIGGER participation_verification_runs_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, provider_id, organization_id,
  practice_location_id, payer_id, plan_id, network_id
ON public.participation_verification_runs
FOR EACH ROW
EXECUTE FUNCTION private.validate_participation_verification_scope();

CREATE OR REPLACE FUNCTION private.validate_participation_evidence_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.participation_verification_runs r
    WHERE r.id = NEW.verification_id AND r.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Verification evidence is outside verification tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participation_verification_evidence_scope_guard
  ON public.participation_verification_evidence;
CREATE TRIGGER participation_verification_evidence_scope_guard
BEFORE INSERT ON public.participation_verification_evidence
FOR EACH ROW
EXECUTE FUNCTION private.validate_participation_evidence_scope();

CREATE OR REPLACE FUNCTION private.validate_participation_match_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.participation_verification_runs r
    WHERE r.id = NEW.verification_id AND r.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Verification match is outside verification tenant';
  END IF;

  IF NEW.evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.participation_verification_evidence e
    WHERE e.id = NEW.evidence_id
      AND e.verification_id = NEW.verification_id
      AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Verification match evidence is outside verification run';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participation_verification_matches_scope_guard
  ON public.participation_verification_matches;
CREATE TRIGGER participation_verification_matches_scope_guard
BEFORE INSERT ON public.participation_verification_matches
FOR EACH ROW
EXECUTE FUNCTION private.validate_participation_match_scope();

ALTER TABLE public.participation_verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participation_verification_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participation_verification_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payer_adapter_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "participation verification runs tenant select" ON public.participation_verification_runs;
CREATE POLICY "participation verification runs tenant select"
ON public.participation_verification_runs
FOR SELECT
TO authenticated
USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS "participation verification evidence tenant select" ON public.participation_verification_evidence;
CREATE POLICY "participation verification evidence tenant select"
ON public.participation_verification_evidence
FOR SELECT
TO authenticated
USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS "participation verification matches tenant select" ON public.participation_verification_matches;
CREATE POLICY "participation verification matches tenant select"
ON public.participation_verification_matches
FOR SELECT
TO authenticated
USING (private.has_tenant_read_access(tenant_id));

DROP POLICY IF EXISTS "authenticated can read payer adapter health" ON public.payer_adapter_health;
CREATE POLICY "authenticated can read payer adapter health"
ON public.payer_adapter_health
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON public.participation_verification_runs FROM anon, authenticated;
REVOKE ALL ON public.participation_verification_evidence FROM anon, authenticated;
REVOKE ALL ON public.participation_verification_matches FROM anon, authenticated;
REVOKE ALL ON public.payer_adapter_health FROM anon, authenticated;

GRANT SELECT ON public.participation_verification_runs TO authenticated;
GRANT SELECT ON public.participation_verification_evidence TO authenticated;
GRANT SELECT ON public.participation_verification_matches TO authenticated;
GRANT SELECT ON public.payer_adapter_health TO authenticated;

COMMENT ON TABLE public.participation_verification_runs IS
  'Immutable-history automated provider participation checks. Credentialing only; no claim workflow authority.';
COMMENT ON TABLE public.participation_verification_evidence IS
  'Source provenance and normalized evidence for automated provider participation checks.';
COMMENT ON TABLE public.participation_verification_matches IS
  'Deterministic matching facts supporting an automated participation decision.';
COMMENT ON TABLE public.payer_adapter_health IS
  'Append-oriented health and freshness observations for credentialing source adapters.';
