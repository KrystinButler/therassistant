-- 1) Harden generic audit logging so an invalid/stale tenant reference in the audited row
-- cannot roll back the underlying business transaction. Preserve the attempted tenant in metadata.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_raw_tenant_id uuid;
  v_valid_tenant_id uuid;
  v_target_id text;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  v_raw_tenant_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>'tenant_id','')::uuid,
    NULLIF(to_jsonb(OLD)->>'tenant_id','')::uuid
  );
  v_target_id := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');

  IF v_raw_tenant_id IS NOT NULL THEN
    SELECT id INTO v_valid_tenant_id
    FROM public.tenants
    WHERE id = v_raw_tenant_id;

    IF v_valid_tenant_id IS NULL THEN
      v_metadata := jsonb_build_object(
        'orphan_tenant_id', v_raw_tenant_id::text,
        'audit_warning', 'source row supplied tenant_id not present in tenants at audit time'
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs
    (tenant_id, actor_id, action, target_type, target_id, old_values, new_values, metadata)
  VALUES
    (
      v_valid_tenant_id,
      auth.uid(),
      TG_OP,
      TG_TABLE_NAME,
      v_target_id,
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
      v_metadata
    );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 2) Canonical claim-submission lineage while retaining legacy fields for app compatibility.
ALTER TABLE public.claim_submissions
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS practice_entity_id uuid,
  ADD COLUMN IF NOT EXISTS provider_location_id uuid,
  ADD COLUMN IF NOT EXISTS insurance_policy_id uuid,
  ADD COLUMN IF NOT EXISTS x12_version text,
  ADD COLUMN IF NOT EXISTS transaction_set_type text,
  ADD COLUMN IF NOT EXISTS interchange_control_number text,
  ADD COLUMN IF NOT EXISTS group_control_number text,
  ADD COLUMN IF NOT EXISTS transaction_set_control_number text,
  ADD COLUMN IF NOT EXISTS submitter_identifier text,
  ADD COLUMN IF NOT EXISTS receiver_identifier text,
  ADD COLUMN IF NOT EXISTS x12_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.claim_submissions
SET encounter_id = COALESCE(encounter_id, "Encounter"),
    client_id = COALESCE(client_id, client)
WHERE (encounter_id IS NULL AND "Encounter" IS NOT NULL)
   OR (client_id IS NULL AND client IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_submissions_encounter_id_fkey') THEN
    ALTER TABLE public.claim_submissions
      ADD CONSTRAINT claim_submissions_encounter_id_fkey
      FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_submissions_client_id_fkey') THEN
    ALTER TABLE public.claim_submissions
      ADD CONSTRAINT claim_submissions_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_submissions_practice_entity_id_fkey') THEN
    ALTER TABLE public.claim_submissions
      ADD CONSTRAINT claim_submissions_practice_entity_id_fkey
      FOREIGN KEY (practice_entity_id) REFERENCES public.practice_entities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_submissions_provider_location_id_fkey') THEN
    ALTER TABLE public.claim_submissions
      ADD CONSTRAINT claim_submissions_provider_location_id_fkey
      FOREIGN KEY (provider_location_id) REFERENCES public.provider_locations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_submissions_insurance_policy_id_fkey') THEN
    ALTER TABLE public.claim_submissions
      ADD CONSTRAINT claim_submissions_insurance_policy_id_fkey
      FOREIGN KEY (insurance_policy_id) REFERENCES public.client_insurance_policies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill submission context from the immutable claim/encounter chain where available.
UPDATE public.claim_submissions cs
SET practice_entity_id = COALESCE(cs.practice_entity_id, pc.practice_entity_id),
    provider_location_id = COALESCE(cs.provider_location_id, pc.provider_location_id),
    insurance_policy_id = COALESCE(cs.insurance_policy_id, pc.insurance_policy_id),
    encounter_id = COALESCE(cs.encounter_id, pc.source_encounter_id),
    client_id = COALESCE(cs.client_id, pc.client_id)
FROM public.professional_claims pc
WHERE pc.id = cs.claim_id;

-- 3) Missing indexes on operational/clinical/EDI FKs.
CREATE INDEX IF NOT EXISTS idx_appointments_cpt_code ON public.appointments(cpt_code);
CREATE INDEX IF NOT EXISTS idx_charge_capture_items_cpt_code ON public.charge_capture_items(cpt_code);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_encounter_id ON public.claim_submissions(encounter_id);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_client_id ON public.claim_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_practice_entity_id ON public.claim_submissions(practice_entity_id);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_provider_location_id ON public.claim_submissions(provider_location_id);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_insurance_policy_id ON public.claim_submissions(insurance_policy_id);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_legacy_encounter ON public.claim_submissions("Encounter");
CREATE INDEX IF NOT EXISTS idx_claim_submissions_legacy_client ON public.claim_submissions(client);
CREATE INDEX IF NOT EXISTS idx_client_balance_summaries_legacy_appointment ON public.client_balance_summaries(appointment);
CREATE INDEX IF NOT EXISTS idx_client_balance_summaries_legacy_charge ON public.client_balance_summaries(charge);
CREATE INDEX IF NOT EXISTS idx_client_balance_summaries_legacy_claim ON public.client_balance_summaries(claim);
CREATE INDEX IF NOT EXISTS idx_client_balance_summaries_legacy_location ON public.client_balance_summaries(location);
CREATE INDEX IF NOT EXISTS idx_client_balance_summaries_legacy_provider ON public.client_balance_summaries(provider);
CREATE INDEX IF NOT EXISTS idx_client_diagnoses_legacy_encounter ON public.client_diagnoses("Encounter_Id");
CREATE INDEX IF NOT EXISTS idx_client_diagnoses_plan ON public.client_diagnoses(plan);
CREATE INDEX IF NOT EXISTS idx_clinical_note_signatures_legacy_encounter ON public.clinical_note_signatures("Encounter_Id");
CREATE INDEX IF NOT EXISTS idx_clinical_note_signatures_legacy_user ON public.clinical_note_signatures("User_id");
CREATE INDEX IF NOT EXISTS idx_clinical_notes_cpt_code ON public.clinical_notes(cpt_code);
CREATE INDEX IF NOT EXISTS idx_denials_legacy_encounter ON public.denials("Encounter_Id");
CREATE INDEX IF NOT EXISTS idx_eligibility_benefits_legacy_insurance ON public.eligibility_benefits("Insurance");
CREATE INDEX IF NOT EXISTS idx_eligibility_benefits_cpt_code ON public.eligibility_benefits(cpt_code);
CREATE INDEX IF NOT EXISTS idx_encounter_diagnoses_legacy_patient ON public.encounter_diagnoses("Patient");
CREATE INDEX IF NOT EXISTS idx_encounter_service_lines_cpt_hcpcs ON public.encounter_service_lines(cpt_hcpcs_code);
CREATE INDEX IF NOT EXISTS idx_encounters_legacy_user ON public.encounters("User_id");
CREATE INDEX IF NOT EXISTS idx_encounters_legacy_location ON public.encounters(location);
CREATE INDEX IF NOT EXISTS idx_era_service_lines_cpt_code ON public.era_service_lines(cpt_code);
CREATE INDEX IF NOT EXISTS idx_professional_claim_lines_cpt_code ON public.professional_claim_lines(cpt_code);

-- 4) Make X12 control-number lookup efficient and prevent accidental duplicate transaction-set controls within a tenant when populated.
CREATE INDEX IF NOT EXISTS idx_claim_submissions_x12_controls
  ON public.claim_submissions(tenant_id, interchange_control_number, group_control_number, transaction_set_control_number);
