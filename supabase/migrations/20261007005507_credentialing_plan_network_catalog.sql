-- SPEC-1 credentialing payer/plan/network catalog.
-- Shared reference data is effective-dated and never physically deleted merely
-- because a source no longer returns it.

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS adapter_key text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

ALTER TABLE public.payer_plans
  ADD COLUMN IF NOT EXISTS external_plan_id text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS market_segment text,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'CO',
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.payer_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.payer_plans(id) ON DELETE RESTRICT,
  external_network_id text,
  name text NOT NULL,
  effective_from date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_networks_effective_dates_check
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS payer_networks_plan_id_idx
  ON public.payer_networks(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS payer_networks_external_id_uniq
  ON public.payer_networks(plan_id, external_network_id)
  WHERE external_network_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payer_coverage_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES public.payers(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES public.payer_plans(id) ON DELETE RESTRICT,
  network_id uuid REFERENCES public.payer_networks(id) ON DELETE RESTRICT,
  area_type text NOT NULL,
  area_code text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'CO',
  effective_from date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_coverage_areas_effective_dates_check
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS payer_coverage_areas_payer_id_idx
  ON public.payer_coverage_areas(payer_id);
CREATE INDEX IF NOT EXISTS payer_coverage_areas_plan_id_idx
  ON public.payer_coverage_areas(plan_id);
CREATE INDEX IF NOT EXISTS payer_coverage_areas_network_id_idx
  ON public.payer_coverage_areas(network_id);
CREATE UNIQUE INDEX IF NOT EXISTS payer_coverage_areas_effective_key_uniq
  ON public.payer_coverage_areas(payer_id, area_type, area_code, effective_from);

CREATE TABLE IF NOT EXISTS public.payer_catalog_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES public.payers(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  records_added integer NOT NULL DEFAULT 0,
  records_changed integer NOT NULL DEFAULT 0,
  records_deactivated integer NOT NULL DEFAULT 0,
  source_version text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_catalog_syncs_status_check
    CHECK (status IN ('in_progress', 'completed', 'failed')),
  CONSTRAINT payer_catalog_syncs_counts_check
    CHECK (records_added >= 0 AND records_changed >= 0 AND records_deactivated >= 0)
);

CREATE INDEX IF NOT EXISTS payer_catalog_syncs_payer_id_idx
  ON public.payer_catalog_syncs(payer_id);
CREATE INDEX IF NOT EXISTS payer_catalog_syncs_started_at_idx
  ON public.payer_catalog_syncs(started_at DESC);

COMMENT ON TABLE public.payer_networks IS
  'Shared effective-dated payer network catalog used by credentialing participation verification.';
COMMENT ON TABLE public.payer_coverage_areas IS
  'Shared effective-dated payer coverage/regional relationships. Colorado ACC regions are data, not a permanent enum.';
COMMENT ON TABLE public.payer_catalog_syncs IS
  'Append-oriented history for payer/plan/network catalog synchronization runs.';

-- Configure adapter ownership without hard-coding payer UUIDs.
UPDATE public.payers
SET adapter_key = CASE lower(trim(name))
  WHEN 'medicare' THEN 'cms_medicare'
  WHEN 'health first colorado' THEN 'health_first_colorado'
  WHEN 'rocky mountain health plans' THEN 'rae_rmhp'
  WHEN 'northeast health partners' THEN 'rae_northeast_health_partners'
  WHEN 'colorado community health alliance' THEN 'rae_ccha'
  WHEN 'colorado access' THEN 'rae_colorado_access'
  WHEN 'aetna' THEN 'aetna'
  WHEN 'anthem blue cross blue shield' THEN 'anthem'
  WHEN 'cigna' THEN 'cigna'
  WHEN 'unitedhealthcare' THEN 'uhc'
  WHEN 'tricare west' THEN 'tricare_west'
  ELSE adapter_key
END
WHERE lower(trim(name)) IN (
  'medicare',
  'health first colorado',
  'rocky mountain health plans',
  'northeast health partners',
  'colorado community health alliance',
  'colorado access',
  'aetna',
  'anthem blue cross blue shield',
  'cigna',
  'unitedhealthcare',
  'tricare west'
);

-- Colorado ACC Phase III became effective 2025-07-01. Relationships are
-- loaded by payer name so the migration never depends on environment UUIDs.
WITH region_seed(region_name, area_code, payer_name) AS (
  VALUES
    ('Region 1', 'CO-ACC-R1', 'Rocky Mountain Health Plans'),
    ('Region 2', 'CO-ACC-R2', 'Northeast Health Partners'),
    ('Region 3', 'CO-ACC-R3', 'Colorado Community Health Alliance'),
    ('Region 4', 'CO-ACC-R4', 'Colorado Access')
)
INSERT INTO public.payer_coverage_areas (
  payer_id,
  area_type,
  area_code,
  name,
  state,
  effective_from,
  active
)
SELECT
  p.id,
  'colorado_acc_region',
  r.area_code,
  r.region_name,
  'CO',
  DATE '2025-07-01',
  true
FROM region_seed r
JOIN public.payers p
  ON lower(trim(p.name)) = lower(r.payer_name)
ON CONFLICT (payer_id, area_type, area_code, effective_from)
DO UPDATE SET
  name = EXCLUDED.name,
  state = EXCLUDED.state,
  active = true,
  effective_to = NULL,
  updated_at = now();

-- The schema intentionally supports additional effective-dated programs such
-- as Rocky Mountain Health PRIME and Denver Health Medicaid Choice when their
-- authoritative plan/network mappings are synchronized. No unsupported region
-- relationship is inferred here.

ALTER TABLE public.payer_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payer_coverage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payer_catalog_syncs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read payer networks" ON public.payer_networks;
CREATE POLICY "authenticated can read payer networks"
  ON public.payer_networks
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated can read payer coverage areas" ON public.payer_coverage_areas;
CREATE POLICY "authenticated can read payer coverage areas"
  ON public.payer_coverage_areas
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated can read payer catalog syncs" ON public.payer_catalog_syncs;
CREATE POLICY "authenticated can read payer catalog syncs"
  ON public.payer_catalog_syncs
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.payer_networks FROM anon, authenticated;
REVOKE ALL ON public.payer_coverage_areas FROM anon, authenticated;
REVOKE ALL ON public.payer_catalog_syncs FROM anon, authenticated;
GRANT SELECT ON public.payer_networks TO authenticated;
GRANT SELECT ON public.payer_coverage_areas TO authenticated;
GRANT SELECT ON public.payer_catalog_syncs TO authenticated;
