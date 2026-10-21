-- Strengthen canonical EHR lineage without breaking existing rows.
-- All new relationship columns are nullable and additive.

alter table public.appointments
  add column if not exists provider_location_id uuid,
  add column if not exists insurance_policy_id uuid;

alter table public.charge_capture_items
  add column if not exists provider_location_id uuid,
  add column if not exists insurance_policy_id uuid;

alter table public.professional_claims
  add column if not exists insurance_policy_id uuid;

alter table public.ledger_transactions
  add column if not exists practice_entity_id uuid,
  add column if not exists provider_id uuid,
  add column if not exists provider_location_id uuid,
  add column if not exists client_id uuid,
  add column if not exists appointment_id uuid,
  add column if not exists encounter_id uuid,
  add column if not exists charge_id uuid,
  add column if not exists claim_id uuid,
  add column if not exists insurance_policy_id uuid,
  add column if not exists payment_id uuid,
  add column if not exists adjustment_id uuid,
  add column if not exists accounting_period_id uuid;

-- Add FKs only when absent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='appointments_provider_location_id_fkey') then
    alter table public.appointments add constraint appointments_provider_location_id_fkey foreign key (provider_location_id) references public.provider_locations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='appointments_insurance_policy_id_fkey') then
    alter table public.appointments add constraint appointments_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='charge_capture_items_provider_location_id_fkey') then
    alter table public.charge_capture_items add constraint charge_capture_items_provider_location_id_fkey foreign key (provider_location_id) references public.provider_locations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='charge_capture_items_insurance_policy_id_fkey') then
    alter table public.charge_capture_items add constraint charge_capture_items_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='professional_claims_insurance_policy_id_fkey') then
    alter table public.professional_claims add constraint professional_claims_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='ledger_transactions_practice_entity_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_practice_entity_id_fkey foreign key (practice_entity_id) references public.practice_entities(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_provider_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_provider_id_fkey foreign key (provider_id) references public.providers(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_provider_location_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_provider_location_id_fkey foreign key (provider_location_id) references public.provider_locations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_client_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_client_id_fkey foreign key (client_id) references public.clients(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_appointment_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_appointment_id_fkey foreign key (appointment_id) references public.appointments(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_encounter_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_encounter_id_fkey foreign key (encounter_id) references public.encounters(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_charge_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_charge_id_fkey foreign key (charge_id) references public.charge_capture_items(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_claim_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_claim_id_fkey foreign key (claim_id) references public.professional_claims(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_insurance_policy_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_insurance_policy_id_fkey foreign key (insurance_policy_id) references public.client_insurance_policies(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_payment_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_payment_id_fkey foreign key (payment_id) references public.payments(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_adjustment_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_adjustment_id_fkey foreign key (adjustment_id) references public.adjustments(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='ledger_transactions_accounting_period_id_fkey') then
    alter table public.ledger_transactions add constraint ledger_transactions_accounting_period_id_fkey foreign key (accounting_period_id) references public.accounting_periods(id);
  end if;
end $$;

-- Cover the new foreign keys with indexes.
create index if not exists idx_appointments_provider_location_id on public.appointments(provider_location_id);
create index if not exists idx_appointments_insurance_policy_id on public.appointments(insurance_policy_id);
create index if not exists idx_charge_capture_items_provider_location_id on public.charge_capture_items(provider_location_id);
create index if not exists idx_charge_capture_items_insurance_policy_id on public.charge_capture_items(insurance_policy_id);
create index if not exists idx_professional_claims_insurance_policy_id on public.professional_claims(insurance_policy_id);
create index if not exists idx_ledger_transactions_practice_entity_id on public.ledger_transactions(practice_entity_id);
create index if not exists idx_ledger_transactions_provider_id on public.ledger_transactions(provider_id);
create index if not exists idx_ledger_transactions_provider_location_id on public.ledger_transactions(provider_location_id);
create index if not exists idx_ledger_transactions_client_id on public.ledger_transactions(client_id);
create index if not exists idx_ledger_transactions_appointment_id on public.ledger_transactions(appointment_id);
create index if not exists idx_ledger_transactions_encounter_id on public.ledger_transactions(encounter_id);
create index if not exists idx_ledger_transactions_charge_id on public.ledger_transactions(charge_id);
create index if not exists idx_ledger_transactions_claim_id on public.ledger_transactions(claim_id);
create index if not exists idx_ledger_transactions_insurance_policy_id on public.ledger_transactions(insurance_policy_id);
create index if not exists idx_ledger_transactions_payment_id on public.ledger_transactions(payment_id);
create index if not exists idx_ledger_transactions_adjustment_id on public.ledger_transactions(adjustment_id);
create index if not exists idx_ledger_transactions_accounting_period_id on public.ledger_transactions(accounting_period_id);

-- Backfill lineage where it is already unambiguous from existing encounter data.
update public.charge_capture_items c
set provider_location_id = e.location,
    insurance_policy_id = e.insurance_policy_id
from public.encounters e
where c.encounter_id = e.id
  and (c.provider_location_id is null or c.insurance_policy_id is null);

update public.professional_claims pc
set insurance_policy_id = e.insurance_policy_id
from public.encounters e
where pc.source_encounter_id = e.id
  and pc.insurance_policy_id is null
  and e.insurance_policy_id is not null;

update public.professional_claims pc
set insurance_policy_id = c.insurance_policy_id
from public.charge_capture_items c
where pc.charge_id = c.id
  and pc.insurance_policy_id is null
  and c.insurance_policy_id is not null;

-- Appointment backfill only where a single consistent encounter relationship exists.
update public.appointments a
set provider_location_id = x.provider_location_id,
    insurance_policy_id = x.insurance_policy_id
from (
  select appointment_id,
         min(location::text)::uuid as provider_location_id,
         min(insurance_policy_id::text)::uuid as insurance_policy_id
  from public.encounters
  group by appointment_id
  having count(distinct location) filter (where location is not null) <= 1
     and count(distinct insurance_policy_id) filter (where insurance_policy_id is not null) <= 1
) x
where a.id = x.appointment_id
  and (a.provider_location_id is null or a.insurance_policy_id is null);

-- Backfill ledger client/claim from ledger entries where all entries agree.
update public.ledger_transactions lt
set client_id = x.client_id,
    claim_id = x.claim_id
from (
  select ledger_transaction_id,
         min(client_id::text)::uuid as client_id,
         min(claim_id::text)::uuid as claim_id
  from public.ledger_entries
  group by ledger_transaction_id
  having count(distinct client_id) filter (where client_id is not null) <= 1
     and count(distinct claim_id) filter (where claim_id is not null) <= 1
) x
where lt.id = x.ledger_transaction_id
  and (lt.client_id is null or lt.claim_id is null);

-- Expand ledger lineage from claim where available.
update public.ledger_transactions lt
set encounter_id = pc.source_encounter_id,
    charge_id = pc.charge_id,
    insurance_policy_id = pc.insurance_policy_id,
    provider_id = pc.rendering_provider_id
from public.professional_claims pc
where lt.claim_id = pc.id
  and (lt.encounter_id is null or lt.charge_id is null or lt.insurance_policy_id is null or lt.provider_id is null);

update public.ledger_transactions lt
set appointment_id = e.appointment_id,
    provider_location_id = e.location
from public.encounters e
where lt.encounter_id = e.id
  and (lt.appointment_id is null or lt.provider_location_id is null);

update public.ledger_transactions lt
set practice_entity_id = pl.practice_entity_id
from public.provider_locations vpl
join public.practice_locations pl on pl.id = vpl.practice_location_id
where lt.provider_location_id = vpl.id
  and lt.practice_entity_id is null;