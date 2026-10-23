-- Recovered from production migration history; already applied.
alter table public.client_balance_summaries
  add column if not exists encounter_id uuid,
  add column if not exists professional_claim_id uuid,
  add column if not exists insurance_policy_id uuid;

alter table public.payment_allocations
  add column if not exists encounter_id uuid,
  add column if not exists charge_id uuid,
  add column if not exists insurance_policy_id uuid;

alter table public.adjustments
  add column if not exists encounter_id uuid,
  add column if not exists charge_id uuid,
  add column if not exists insurance_policy_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='client_balance_summaries_encounter_id_fkey') then
    alter table public.client_balance_summaries add constraint client_balance_summaries_encounter_id_fkey foreign key (encounter_id) references public.encounters(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='client_balance_summaries_professional_claim_id_fkey') then
    alter table public.client_balance_summaries add constraint client_balance_summaries_professional_claim_id_fkey foreign key (professional_claim_id) references public.professional_claims(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='client_balance_summaries_insurance_policy_id_fkey') then
    alter table public.client_balance_summaries add constraint client_balance_summaries_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='payment_allocations_encounter_id_fkey') then
    alter table public.payment_allocations add constraint payment_allocations_encounter_id_fkey foreign key (encounter_id) references public.encounters(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='payment_allocations_charge_id_fkey') then
    alter table public.payment_allocations add constraint payment_allocations_charge_id_fkey foreign key (charge_id) references public.charge_capture_items(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='payment_allocations_insurance_policy_id_fkey') then
    alter table public.payment_allocations add constraint payment_allocations_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='adjustments_encounter_id_fkey') then
    alter table public.adjustments add constraint adjustments_encounter_id_fkey foreign key (encounter_id) references public.encounters(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='adjustments_charge_id_fkey') then
    alter table public.adjustments add constraint adjustments_charge_id_fkey foreign key (charge_id) references public.charge_capture_items(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='adjustments_insurance_policy_id_fkey') then
    alter table public.adjustments add constraint adjustments_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;
end $$;

create index if not exists idx_client_balance_summaries_encounter_id on public.client_balance_summaries(encounter_id);
create index if not exists idx_client_balance_summaries_professional_claim_id on public.client_balance_summaries(professional_claim_id);
create index if not exists idx_client_balance_summaries_insurance_policy_id on public.client_balance_summaries(insurance_policy_id);
create index if not exists idx_payment_allocations_encounter_id on public.payment_allocations(encounter_id);
create index if not exists idx_payment_allocations_charge_id on public.payment_allocations(charge_id);
create index if not exists idx_payment_allocations_insurance_policy_id on public.payment_allocations(insurance_policy_id);
create index if not exists idx_adjustments_encounter_id on public.adjustments(encounter_id);
create index if not exists idx_adjustments_charge_id on public.adjustments(charge_id);
create index if not exists idx_adjustments_insurance_policy_id on public.adjustments(insurance_policy_id);

-- Backfill payment allocation lineage from claims.
update public.payment_allocations pa
set encounter_id = pc.source_encounter_id,
    charge_id = pc.charge_id,
    insurance_policy_id = pc.insurance_policy_id
from public.professional_claims pc
where pa.claim_id = pc.id
  and (pa.encounter_id is null or pa.charge_id is null or pa.insurance_policy_id is null);

-- Backfill adjustment lineage from claims.
update public.adjustments a
set encounter_id = pc.source_encounter_id,
    charge_id = pc.charge_id,
    insurance_policy_id = pc.insurance_policy_id
from public.professional_claims pc
where a.claim_id = pc.id
  and (a.encounter_id is null or a.charge_id is null or a.insurance_policy_id is null);

-- Backfill the new canonical summary links from existing legacy links where possible.
update public.client_balance_summaries cbs
set encounter_id = c.encounter_id,
    insurance_policy_id = c.insurance_policy_id
from public.charge_capture_items c
where coalesce((to_jsonb(cbs)->>'charge_id')::uuid, (to_jsonb(cbs)->>'charge')::uuid) = c.id
  and (cbs.encounter_id is null or cbs.insurance_policy_id is null);

update public.client_balance_summaries cbs
set professional_claim_id = pc.id,
    encounter_id = coalesce(cbs.encounter_id, pc.source_encounter_id),
    insurance_policy_id = coalesce(cbs.insurance_policy_id, pc.insurance_policy_id)
from public.professional_claims pc
where coalesce((to_jsonb(cbs)->>'charge_id')::uuid, (to_jsonb(cbs)->>'charge')::uuid) = pc.charge_id
  and (cbs.professional_claim_id is null or cbs.encounter_id is null or cbs.insurance_policy_id is null);
