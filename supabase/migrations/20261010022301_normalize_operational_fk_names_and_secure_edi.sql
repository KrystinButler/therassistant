-- EDI connection RLS: match established tenant-scoped access pattern.
DROP POLICY IF EXISTS "tenant_edi_connections tenant select" ON public.tenant_edi_connections;
DROP POLICY IF EXISTS "tenant_edi_connections tenant insert" ON public.tenant_edi_connections;
DROP POLICY IF EXISTS "tenant_edi_connections tenant update" ON public.tenant_edi_connections;

CREATE POLICY "tenant_edi_connections tenant select"
ON public.tenant_edi_connections FOR SELECT TO authenticated
USING (private.has_tenant_read_access(tenant_id));

CREATE POLICY "tenant_edi_connections tenant insert"
ON public.tenant_edi_connections FOR INSERT TO authenticated
WITH CHECK (private.has_tenant_admin_access(tenant_id));

CREATE POLICY "tenant_edi_connections tenant update"
ON public.tenant_edi_connections FOR UPDATE TO authenticated
USING (private.has_tenant_admin_access(tenant_id))
WITH CHECK (private.has_tenant_admin_access(tenant_id));

-- Add canonical aliases for legacy relationship columns; keep legacy columns for compatibility.
ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS provider_location_id uuid,
  ADD COLUMN IF NOT EXISTS tenant_user_id uuid;
UPDATE public.encounters SET
  provider_location_id = COALESCE(provider_location_id, location),
  tenant_user_id = COALESCE(tenant_user_id, "User_id")
WHERE (provider_location_id IS NULL AND location IS NOT NULL)
   OR (tenant_user_id IS NULL AND "User_id" IS NOT NULL);

ALTER TABLE public.clinical_note_signatures
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS tenant_user_id uuid;
UPDATE public.clinical_note_signatures SET
  encounter_id = COALESCE(encounter_id, "Encounter_Id"),
  tenant_user_id = COALESCE(tenant_user_id, "User_id")
WHERE (encounter_id IS NULL AND "Encounter_Id" IS NOT NULL)
   OR (tenant_user_id IS NULL AND "User_id" IS NOT NULL);

ALTER TABLE public.client_diagnoses
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS treatment_plan_id uuid;
UPDATE public.client_diagnoses SET
  encounter_id = COALESCE(encounter_id, "Encounter_Id"),
  treatment_plan_id = COALESCE(treatment_plan_id, plan)
WHERE (encounter_id IS NULL AND "Encounter_Id" IS NOT NULL)
   OR (treatment_plan_id IS NULL AND plan IS NOT NULL);

ALTER TABLE public.eligibility_benefits
  ADD COLUMN IF NOT EXISTS insurance_policy_id uuid;
UPDATE public.eligibility_benefits
SET insurance_policy_id = COALESCE(insurance_policy_id, "Insurance")
WHERE insurance_policy_id IS NULL AND "Insurance" IS NOT NULL;

ALTER TABLE public.denials
  ADD COLUMN IF NOT EXISTS encounter_id uuid;
UPDATE public.denials
SET encounter_id = COALESCE(encounter_id, "Encounter_Id")
WHERE encounter_id IS NULL AND "Encounter_Id" IS NOT NULL;

ALTER TABLE public.encounter_diagnoses
  ADD COLUMN IF NOT EXISTS client_id uuid;
UPDATE public.encounter_diagnoses ed
SET client_id = COALESCE(ed.client_id, ed."Patient", e.client_id)
FROM public.encounters e
WHERE e.id = ed.encounter_id
  AND ed.client_id IS NULL;

ALTER TABLE public.credentialing_application_events
  ADD COLUMN IF NOT EXISTS provider_id uuid;
UPDATE public.credentialing_application_events
SET provider_id = COALESCE(provider_id, "Provder_Id")
WHERE provider_id IS NULL AND "Provder_Id" IS NOT NULL;

ALTER TABLE public.claim_status_history
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS client_id uuid;
UPDATE public.claim_status_history SET
  appointment_id = COALESCE(appointment_id, appointment),
  encounter_id = COALESCE(encounter_id, "Encounter"),
  client_id = COALESCE(client_id, "Client")
WHERE (appointment_id IS NULL AND appointment IS NOT NULL)
   OR (encounter_id IS NULL AND "Encounter" IS NOT NULL)
   OR (client_id IS NULL AND "Client" IS NOT NULL);

ALTER TABLE public.claim_diagnoses
  ADD COLUMN IF NOT EXISTS appointment_id uuid;
UPDATE public.claim_diagnoses
SET appointment_id = COALESCE(appointment_id, "Appointment")
WHERE appointment_id IS NULL AND "Appointment" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounters_provider_location_id_fkey') THEN
    ALTER TABLE public.encounters ADD CONSTRAINT encounters_provider_location_id_fkey FOREIGN KEY (provider_location_id) REFERENCES public.provider_locations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounters_tenant_user_id_fkey') THEN
    ALTER TABLE public.encounters ADD CONSTRAINT encounters_tenant_user_id_fkey FOREIGN KEY (tenant_user_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinical_note_signatures_encounter_id_fkey') THEN
    ALTER TABLE public.clinical_note_signatures ADD CONSTRAINT clinical_note_signatures_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinical_note_signatures_tenant_user_id_fkey') THEN
    ALTER TABLE public.clinical_note_signatures ADD CONSTRAINT clinical_note_signatures_tenant_user_id_fkey FOREIGN KEY (tenant_user_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_diagnoses_encounter_id_fkey') THEN
    ALTER TABLE public.client_diagnoses ADD CONSTRAINT client_diagnoses_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_diagnoses_treatment_plan_id_fkey') THEN
    ALTER TABLE public.client_diagnoses ADD CONSTRAINT client_diagnoses_treatment_plan_id_fkey FOREIGN KEY (treatment_plan_id) REFERENCES public.treatment_plans(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='eligibility_benefits_insurance_policy_id_fkey') THEN
    ALTER TABLE public.eligibility_benefits ADD CONSTRAINT eligibility_benefits_insurance_policy_id_fkey FOREIGN KEY (insurance_policy_id) REFERENCES public.client_insurance_policies(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='denials_encounter_id_fkey') THEN
    ALTER TABLE public.denials ADD CONSTRAINT denials_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='encounter_diagnoses_client_id_fkey') THEN
    ALTER TABLE public.encounter_diagnoses ADD CONSTRAINT encounter_diagnoses_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='credentialing_application_events_provider_id_fkey') THEN
    ALTER TABLE public.credentialing_application_events ADD CONSTRAINT credentialing_application_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_status_history_appointment_id_fkey') THEN
    ALTER TABLE public.claim_status_history ADD CONSTRAINT claim_status_history_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_status_history_encounter_id_fkey') THEN
    ALTER TABLE public.claim_status_history ADD CONSTRAINT claim_status_history_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_status_history_client_id_fkey') THEN
    ALTER TABLE public.claim_status_history ADD CONSTRAINT claim_status_history_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='claim_diagnoses_appointment_id_fkey') THEN
    ALTER TABLE public.claim_diagnoses ADD CONSTRAINT claim_diagnoses_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_encounters_provider_location_id ON public.encounters(provider_location_id);
CREATE INDEX IF NOT EXISTS idx_encounters_tenant_user_id ON public.encounters(tenant_user_id);
CREATE INDEX IF NOT EXISTS idx_clinical_note_signatures_encounter_id ON public.clinical_note_signatures(encounter_id);
CREATE INDEX IF NOT EXISTS idx_clinical_note_signatures_tenant_user_id ON public.clinical_note_signatures(tenant_user_id);
CREATE INDEX IF NOT EXISTS idx_client_diagnoses_encounter_id ON public.client_diagnoses(encounter_id);
CREATE INDEX IF NOT EXISTS idx_client_diagnoses_treatment_plan_id ON public.client_diagnoses(treatment_plan_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_benefits_insurance_policy_id ON public.eligibility_benefits(insurance_policy_id);
CREATE INDEX IF NOT EXISTS idx_denials_encounter_id ON public.denials(encounter_id);
CREATE INDEX IF NOT EXISTS idx_encounter_diagnoses_client_id ON public.encounter_diagnoses(client_id);
CREATE INDEX IF NOT EXISTS idx_credentialing_application_events_provider_id ON public.credentialing_application_events(provider_id);
CREATE INDEX IF NOT EXISTS idx_claim_status_history_appointment_id ON public.claim_status_history(appointment_id);
CREATE INDEX IF NOT EXISTS idx_claim_status_history_encounter_id ON public.claim_status_history(encounter_id);
CREATE INDEX IF NOT EXISTS idx_claim_status_history_client_id ON public.claim_status_history(client_id);
CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_appointment_id ON public.claim_diagnoses(appointment_id);