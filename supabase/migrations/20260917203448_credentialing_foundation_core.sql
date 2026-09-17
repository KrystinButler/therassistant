-- Credentialing foundation: legal entities, locations, provider credentials,
-- scoped enrollments, applications, participation verification, rosters, issues, and document links.

-- 1) Credentialing enums
DO $$ BEGIN
  CREATE TYPE public.credential_status_enum AS ENUM ('pending','active','expired','suspended','revoked','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credentialing_application_status_enum AS ENUM (
    'not_started','intake','missing_information','ready_to_submit','submitted','payer_review',
    'additional_information_requested','approved','effective','roster_verified','directory_verified',
    'complete','denied','withdrawn','terminated','closed','recredentialing_due'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credentialing_requirement_status_enum AS ENUM ('missing','requested','received','verified','waived','not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.network_participation_status_enum AS ENUM ('unknown','pending','participating','non_participating','terminated','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.directory_status_enum AS ENUM ('unknown','listed','not_listed','inaccurate','not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roster_action_type_enum AS ENUM (
    'add_provider','remove_provider','update_demographics','add_location','remove_location',
    'correct_name','correct_npi','correct_tin','correct_taxonomy','add_product','remove_product','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roster_action_status_enum AS ENUM ('not_started','ready','submitted','pending','confirmed','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credentialing_issue_status_enum AS ENUM ('open','in_progress','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credentialing_issue_severity_enum AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend existing reusable enums.
ALTER TYPE public.workqueue_type_enum ADD VALUE IF NOT EXISTS 'credentialing_followup';
ALTER TYPE public.workqueue_type_enum ADD VALUE IF NOT EXISTS 'credential_expiration';
ALTER TYPE public.workqueue_type_enum ADD VALUE IF NOT EXISTS 'network_verification';
ALTER TYPE public.workqueue_type_enum ADD VALUE IF NOT EXISTS 'roster_action';
ALTER TYPE public.workqueue_type_enum ADD VALUE IF NOT EXISTS 'recredentialing';

ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'credentialing_application';
ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'provider_credential';
ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'network_participation';
ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'roster_action';
ALTER TYPE public.workqueue_source_object_type_enum ADD VALUE IF NOT EXISTS 'credentialing_issue';

ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'provider_license';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'dea_registration';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'malpractice_insurance';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'w9';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'caqh_profile';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'curriculum_vitae';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'credentialing_application';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'credentialing_approval';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'network_verification';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'roster_document';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'payer_contract';
ALTER TYPE public.document_type_enum ADD VALUE IF NOT EXISTS 'provider_certification';

-- 2) Legal entities and service locations
CREATE TABLE IF NOT EXISTS public.practice_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  dba_name text,
  entity_type text,
  tax_id text,
  group_npi text,
  taxonomy_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  practice_entity_id uuid REFERENCES public.practice_entities(id) ON DELETE SET NULL,
  name text NOT NULL,
  location_type text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  phone text,
  fax text,
  location_npi text,
  taxonomy_code text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  practice_location_id uuid NOT NULL REFERENCES public.practice_locations(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  effective_date date,
  termination_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, practice_location_id)
);

-- 3) Expand provider credentialing profile
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS middle_name text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS suffix text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS primary_specialty text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS caqh_id text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS caqh_attestation_date date;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS caqh_next_attestation_date date;

CREATE TABLE IF NOT EXISTS public.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  credential_type text NOT NULL,
  credential_name text,
  credential_number text,
  issuing_authority text,
  issuing_state text,
  status public.credential_status_enum NOT NULL DEFAULT 'pending',
  issue_date date,
  expiration_date date,
  verification_source text,
  verified_at timestamptz,
  verified_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Contract-to-product structure
ALTER TABLE public.payer_contracts ADD COLUMN IF NOT EXISTS practice_entity_id uuid REFERENCES public.practice_entities(id) ON DELETE SET NULL;
ALTER TABLE public.payer_contracts ADD COLUMN IF NOT EXISTS contract_reference text;
ALTER TABLE public.payer_contracts ADD COLUMN IF NOT EXISTS recredentialing_due_date date;

CREATE TABLE IF NOT EXISTS public.payer_contract_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payer_contract_id uuid NOT NULL REFERENCES public.payer_contracts(id) ON DELETE CASCADE,
  payer_plan_id uuid NOT NULL REFERENCES public.payer_plans(id) ON DELETE CASCADE,
  effective_date date,
  termination_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payer_contract_id, payer_plan_id)
);

-- 5) Expand enrollment scope from Provider + Payer to Provider + Payer + Plan + Entity + Location
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS payer_plan_id uuid REFERENCES public.payer_plans(id) ON DELETE SET NULL;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS practice_entity_id uuid REFERENCES public.practice_entities(id) ON DELETE SET NULL;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS practice_location_id uuid REFERENCES public.practice_locations(id) ON DELETE SET NULL;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS payer_contract_id uuid REFERENCES public.payer_contracts(id) ON DELETE SET NULL;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS submitted_date date;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS approved_date date;
ALTER TABLE public.provider_payer_enrollments ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

ALTER TABLE public.provider_payer_enrollments
  DROP CONSTRAINT IF EXISTS provider_payer_enrollments_provider_id_payer_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_payer_enrollment_scope
ON public.provider_payer_enrollments (
  tenant_id,
  provider_id,
  payer_id,
  COALESCE(payer_plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(practice_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(practice_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- 6) Credentialing applications/cases
CREATE TABLE IF NOT EXISTS public.credentialing_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.provider_payer_enrollments(id) ON DELETE CASCADE,
  application_type text NOT NULL DEFAULT 'initial',
  status public.credentialing_application_status_enum NOT NULL DEFAULT 'not_started',
  application_reference text,
  external_application_id text,
  submitted_date date,
  payer_received_date date,
  decision_date date,
  effective_date date,
  closed_date date,
  last_contact_date date,
  next_followup_date date,
  assigned_user_id uuid,
  priority public.workqueue_priority_enum NOT NULL DEFAULT 'normal',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credentialing_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.credentialing_applications(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status public.credentialing_application_status_enum,
  to_status public.credentialing_application_status_enum,
  event_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credentialing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.credentialing_applications(id) ON DELETE CASCADE,
  requirement_key text,
  requirement_name text NOT NULL,
  category text,
  status public.credentialing_requirement_status_enum NOT NULL DEFAULT 'missing',
  due_date date,
  received_date date,
  verified_at timestamptz,
  verified_by uuid,
  waiver_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credentialing_requirement_key
ON public.credentialing_requirements(application_id, requirement_key)
WHERE requirement_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.credentialing_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.credentialing_applications(id) ON DELETE CASCADE,
  followup_date date NOT NULL DEFAULT current_date,
  channel text,
  contact_name text,
  contact_details text,
  reference_number text,
  outcome text,
  next_followup_date date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7) Participation verification kept separate from enrollment/approval
CREATE TABLE IF NOT EXISTS public.provider_network_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL UNIQUE REFERENCES public.provider_payer_enrollments(id) ON DELETE CASCADE,
  participation_status public.network_participation_status_enum NOT NULL DEFAULT 'unknown',
  directory_status public.directory_status_enum NOT NULL DEFAULT 'unknown',
  effective_date date,
  termination_date date,
  last_verified_at timestamptz,
  next_verification_due_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.participation_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  participation_id uuid NOT NULL REFERENCES public.provider_network_participation(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verification_method text NOT NULL,
  result public.network_participation_status_enum NOT NULL,
  reference_number text,
  representative_name text,
  source_url text,
  notes text,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.participation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  participation_id uuid NOT NULL REFERENCES public.provider_network_participation(id) ON DELETE CASCADE,
  verification_id uuid REFERENCES public.participation_verifications(id) ON DELETE SET NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  evidence_type text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participation_id, document_id)
);

-- 8) Roster management and credentialing discrepancy tracking
CREATE TABLE IF NOT EXISTS public.roster_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.provider_payer_enrollments(id) ON DELETE CASCADE,
  participation_id uuid REFERENCES public.provider_network_participation(id) ON DELETE SET NULL,
  action_type public.roster_action_type_enum NOT NULL,
  status public.roster_action_status_enum NOT NULL DEFAULT 'not_started',
  requested_date date,
  submitted_date date,
  confirmed_date date,
  reference_number text,
  requested_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  assigned_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credentialing_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.provider_payer_enrollments(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.credentialing_applications(id) ON DELETE CASCADE,
  participation_id uuid REFERENCES public.provider_network_participation(id) ON DELETE CASCADE,
  provider_credential_id uuid REFERENCES public.provider_credentials(id) ON DELETE CASCADE,
  issue_type text NOT NULL,
  title text NOT NULL,
  description text,
  severity public.credentialing_issue_severity_enum NOT NULL DEFAULT 'medium',
  status public.credentialing_issue_status_enum NOT NULL DEFAULT 'open',
  identified_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  resolved_at timestamptz,
  assigned_user_id uuid,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(enrollment_id, application_id, participation_id, provider_credential_id) >= 1)
);

-- 9) Generic links from the existing document vault into credentialing records
CREATE TABLE IF NOT EXISTS public.credentialing_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.providers(id) ON DELETE CASCADE,
  provider_credential_id uuid REFERENCES public.provider_credentials(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.provider_payer_enrollments(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.credentialing_applications(id) ON DELETE CASCADE,
  participation_id uuid REFERENCES public.provider_network_participation(id) ON DELETE CASCADE,
  payer_contract_id uuid REFERENCES public.payer_contracts(id) ON DELETE CASCADE,
  link_type text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(provider_id, provider_credential_id, enrollment_id, application_id, participation_id, payer_contract_id) >= 1)
);

-- 10) Performance indexes for operational work queues
CREATE INDEX IF NOT EXISTS idx_practice_entities_tenant ON public.practice_entities(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_practice_locations_tenant ON public.practice_locations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_practice_locations_entity ON public.practice_locations(practice_entity_id);
CREATE INDEX IF NOT EXISTS idx_provider_locations_provider ON public.provider_locations(tenant_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider ON public.provider_credentials(tenant_id, provider_id, status);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_expiration ON public.provider_credentials(tenant_id, expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payer_contract_plans_contract ON public.payer_contract_plans(tenant_id, payer_contract_id);
CREATE INDEX IF NOT EXISTS idx_ppe_plan ON public.provider_payer_enrollments(payer_plan_id);
CREATE INDEX IF NOT EXISTS idx_ppe_entity ON public.provider_payer_enrollments(practice_entity_id);
CREATE INDEX IF NOT EXISTS idx_ppe_location ON public.provider_payer_enrollments(practice_location_id);
CREATE INDEX IF NOT EXISTS idx_ppe_contract ON public.provider_payer_enrollments(payer_contract_id);
CREATE INDEX IF NOT EXISTS idx_credentialing_apps_status ON public.credentialing_applications(tenant_id, status, next_followup_date);
CREATE INDEX IF NOT EXISTS idx_credentialing_apps_enrollment ON public.credentialing_applications(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_credentialing_events_application ON public.credentialing_application_events(application_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_credentialing_requirements_application ON public.credentialing_requirements(application_id, status);
CREATE INDEX IF NOT EXISTS idx_credentialing_followups_application ON public.credentialing_followups(application_id, followup_date DESC);
CREATE INDEX IF NOT EXISTS idx_credentialing_followups_next ON public.credentialing_followups(tenant_id, next_followup_date) WHERE next_followup_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_participation_status ON public.provider_network_participation(tenant_id, participation_status, next_verification_due_date);
CREATE INDEX IF NOT EXISTS idx_participation_verifications ON public.participation_verifications(participation_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_roster_actions_status ON public.roster_actions(tenant_id, status, submitted_date);
CREATE INDEX IF NOT EXISTS idx_credentialing_issues_status ON public.credentialing_issues(tenant_id, status, severity, due_date);
CREATE INDEX IF NOT EXISTS idx_credentialing_docs_document ON public.credentialing_document_links(document_id);
CREATE INDEX IF NOT EXISTS idx_credentialing_docs_application ON public.credentialing_document_links(application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credentialing_docs_provider ON public.credentialing_document_links(provider_id) WHERE provider_id IS NOT NULL;

-- 11) Standard timestamp and audit triggers
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'practice_entities','practice_locations','provider_locations','provider_credentials','payer_contract_plans',
    'credentialing_applications','credentialing_requirements','credentialing_followups',
    'provider_network_participation','participation_verifications','participation_evidence',
    'roster_actions','credentialing_issues'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_timestamps ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_set_timestamps BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_timestamps()', tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_changes ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_audit_row_changes AFTER INSERT OR DELETE OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', tbl);
  END LOOP;

  -- Immutable-ish event/link tables have no updated_at column, so audit only.
  FOREACH tbl IN ARRAY ARRAY['credentialing_application_events','credentialing_document_links'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_changes ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_audit_row_changes AFTER INSERT OR DELETE OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', tbl);
  END LOOP;
END $$;

-- 12) RLS and explicit Data API grants. No anon access is granted to credentialing data.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'practice_entities','practice_locations','provider_locations','provider_credentials','payer_contract_plans',
    'credentialing_applications','credentialing_application_events','credentialing_requirements','credentialing_followups',
    'provider_network_participation','participation_verifications','participation_evidence','roster_actions',
    'credentialing_issues','credentialing_document_links'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_select', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.has_tenant_read_access(tenant_id))', tbl || '_tenant_select', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (private.has_tenant_write_access(tenant_id))', tbl || '_tenant_insert', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_update', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (private.has_tenant_write_access(tenant_id)) WITH CHECK (private.has_tenant_write_access(tenant_id))', tbl || '_tenant_update', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_delete', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (private.has_tenant_write_access(tenant_id))', tbl || '_tenant_delete', tbl);
  END LOOP;
END $$;
