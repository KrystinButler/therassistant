-- Recovered from production migration history; already applied.
-- 837 claim snapshot/context lineage
ALTER TABLE public.professional_claims
  ADD COLUMN IF NOT EXISTS practice_entity_id uuid,
  ADD COLUMN IF NOT EXISTS provider_location_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='professional_claims_practice_entity_id_fkey') THEN
    ALTER TABLE public.professional_claims ADD CONSTRAINT professional_claims_practice_entity_id_fkey FOREIGN KEY (practice_entity_id) REFERENCES public.practice_entities(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='professional_claims_provider_location_id_fkey') THEN
    ALTER TABLE public.professional_claims ADD CONSTRAINT professional_claims_provider_location_id_fkey FOREIGN KEY (provider_location_id) REFERENCES public.provider_locations(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_professional_claims_practice_entity_id ON public.professional_claims(practice_entity_id);
CREATE INDEX IF NOT EXISTS idx_professional_claims_provider_location_id ON public.professional_claims(provider_location_id);

-- 835 file-level remittance context
ALTER TABLE public.era_files
  ADD COLUMN IF NOT EXISTS practice_entity_id uuid,
  ADD COLUMN IF NOT EXISTS payment_id uuid,
  ADD COLUMN IF NOT EXISTS payment_method_code text,
  ADD COLUMN IF NOT EXISTS production_date date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_files_practice_entity_id_fkey') THEN
    ALTER TABLE public.era_files ADD CONSTRAINT era_files_practice_entity_id_fkey FOREIGN KEY (practice_entity_id) REFERENCES public.practice_entities(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_files_payment_id_fkey') THEN
    ALTER TABLE public.era_files ADD CONSTRAINT era_files_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_era_files_practice_entity_id ON public.era_files(practice_entity_id);
CREATE INDEX IF NOT EXISTS idx_era_files_payment_id ON public.era_files(payment_id);
CREATE INDEX IF NOT EXISTS idx_era_files_trace ON public.era_files(tenant_id, check_or_trace_number) WHERE check_or_trace_number IS NOT NULL;

-- 835 claim-level operational lineage
ALTER TABLE public.era_claims
  ADD COLUMN IF NOT EXISTS encounter_id uuid,
  ADD COLUMN IF NOT EXISTS insurance_policy_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_claims_encounter_id_fkey') THEN
    ALTER TABLE public.era_claims ADD CONSTRAINT era_claims_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_claims_insurance_policy_id_fkey') THEN
    ALTER TABLE public.era_claims ADD CONSTRAINT era_claims_insurance_policy_id_fkey FOREIGN KEY (insurance_policy_id) REFERENCES public.client_insurance_policies(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_era_claims_encounter_id ON public.era_claims(encounter_id);
CREATE INDEX IF NOT EXISTS idx_era_claims_insurance_policy_id ON public.era_claims(insurance_policy_id);

-- 835 service-line reconciliation to claim lines and original charges
ALTER TABLE public.era_service_lines
  ADD COLUMN IF NOT EXISTS charge_id uuid,
  ADD COLUMN IF NOT EXISTS allowed_amount_cents bigint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_service_lines_charge_id_fkey') THEN
    ALTER TABLE public.era_service_lines ADD CONSTRAINT era_service_lines_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.charge_capture_items(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_era_service_lines_charge_id ON public.era_service_lines(charge_id);
CREATE INDEX IF NOT EXISTS idx_era_service_lines_claim_line_id ON public.era_service_lines(claim_line_id);

-- Connect parsed CAS adjustments to posted operational adjustments
ALTER TABLE public.era_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='era_adjustments_adjustment_id_fkey') THEN
    ALTER TABLE public.era_adjustments ADD CONSTRAINT era_adjustments_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.adjustments(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_era_adjustments_adjustment_id ON public.era_adjustments(adjustment_id);

-- Backfill claim snapshot context from encounter/location where unambiguous
UPDATE public.professional_claims pc
SET insurance_policy_id = COALESCE(pc.insurance_policy_id, e.insurance_policy_id),
    provider_location_id = COALESCE(pc.provider_location_id, coalesce((to_jsonb(e)->>'provider_location_id')::uuid, (to_jsonb(e)->>'location')::uuid))
FROM public.encounters e
WHERE pc.source_encounter_id = e.id
  AND (pc.insurance_policy_id IS NULL OR pc.provider_location_id IS NULL);

UPDATE public.professional_claims pc
SET practice_entity_id = pl.practice_entity_id
FROM public.provider_locations vpl
JOIN public.practice_locations pl ON pl.id = vpl.practice_location_id
WHERE pc.provider_location_id = vpl.id
  AND pc.practice_entity_id IS NULL;

-- Backfill ERA claim lineage from matched professional claim where available
UPDATE public.era_claims ec
SET encounter_id = COALESCE(ec.encounter_id, pc.source_encounter_id),
    insurance_policy_id = COALESCE(ec.insurance_policy_id, pc.insurance_policy_id)
FROM public.professional_claims pc
WHERE ec.claim_id = pc.id
  AND (ec.encounter_id IS NULL OR ec.insurance_policy_id IS NULL);
