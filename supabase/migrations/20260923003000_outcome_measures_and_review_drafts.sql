-- Dated outcome totals and non-signable draft reviews. No copyrighted questionnaire text stored.
create table if not exists public.clinical_outcome_measures (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 provider_id uuid references public.providers(id) on delete set null,
 encounter_id uuid references public.encounters(id) on delete set null,
 instrument text not null check(instrument in ('PHQ-9','GAD-7')),
 score integer not null,
 assessed_on date not null,
 source text not null default 'clinician_entered' check(source in ('clinician_entered','patient_reported')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint outcome_score_in_range check(
  (instrument='PHQ-9' and score between 0 and 27) or
  (instrument='GAD-7' and score between 0 and 21)
 )
);
create index if not exists outcome_measures_patient_date_idx
 on public.clinical_outcome_measures(tenant_id,client_id,instrument,assessed_on desc);
alter table public.clinical_outcome_measures enable row level security;
drop policy if exists outcome_measures_select on public.clinical_outcome_measures;
create policy outcome_measures_select on public.clinical_outcome_measures for select to authenticated
 using(private.has_tenant_read_access(tenant_id));
drop policy if exists outcome_measures_insert on public.clinical_outcome_measures;
create policy outcome_measures_insert on public.clinical_outcome_measures for insert to authenticated
 with check(private.has_tenant_write_access(tenant_id));
drop policy if exists outcome_measures_update on public.clinical_outcome_measures;
create policy outcome_measures_update on public.clinical_outcome_measures for update to authenticated
 using(private.has_tenant_write_access(tenant_id)) with check(private.has_tenant_write_access(tenant_id));
drop policy if exists outcome_measures_delete on public.clinical_outcome_measures;
create policy outcome_measures_delete on public.clinical_outcome_measures for delete to authenticated
 using(private.has_tenant_write_access(tenant_id));

create table if not exists public.treatment_plan_review_drafts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 source_plan_id uuid not null references public.treatment_plans(id) on delete cascade,
 provider_id uuid references public.providers(id) on delete set null,
 review_date date not null,
 status text not null default 'draft' check(status='draft'),
 draft_text text not null,
 evidence_snapshot jsonb not null default '{}'::jsonb,
 generated_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists plan_review_patient_date_idx on public.treatment_plan_review_drafts(tenant_id,client_id,review_date desc);
alter table public.treatment_plan_review_drafts enable row level security;
drop policy if exists plan_review_drafts_select on public.treatment_plan_review_drafts;
create policy plan_review_drafts_select on public.treatment_plan_review_drafts for select to authenticated
 using(private.has_tenant_read_access(tenant_id));
drop policy if exists plan_review_drafts_insert on public.treatment_plan_review_drafts;
create policy plan_review_drafts_insert on public.treatment_plan_review_drafts for insert to authenticated
 with check(private.has_tenant_write_access(tenant_id));
drop policy if exists plan_review_drafts_update on public.treatment_plan_review_drafts;
create policy plan_review_drafts_update on public.treatment_plan_review_drafts for update to authenticated
 using(private.has_tenant_write_access(tenant_id)) with check(private.has_tenant_write_access(tenant_id));
drop policy if exists plan_review_drafts_delete on public.treatment_plan_review_drafts;
create policy plan_review_drafts_delete on public.treatment_plan_review_drafts for delete to authenticated
 using(private.has_tenant_write_access(tenant_id));

create or replace function public.check_outcome_review_tenant()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.clients c where c.id=new.client_id and c.tenant_id=new.tenant_id) then
  raise exception 'Patient does not belong to the selected practice';
 end if;
 if tg_table_name='clinical_outcome_measures' then
  if new.provider_id is not null and not exists(select 1 from public.providers p where p.id=new.provider_id and p.tenant_id=new.tenant_id) then
   raise exception 'Provider does not belong to the selected practice';
  end if;
  if new.encounter_id is not null and not exists(select 1 from public.encounters e where e.id=new.encounter_id and e.client_id=new.client_id and e.tenant_id=new.tenant_id) then
   raise exception 'Encounter does not belong to the selected patient and practice';
  end if;
 else
  if not exists(select 1 from public.treatment_plans p where p.id=new.source_plan_id and p.client_id=new.client_id and p.tenant_id=new.tenant_id) then
   raise exception 'Treatment plan does not belong to the selected patient and practice';
  end if;
  if new.provider_id is not null and not exists(select 1 from public.providers p where p.id=new.provider_id and p.tenant_id=new.tenant_id) then
   raise exception 'Provider does not belong to the selected practice';
  end if;
 end if;
 return new;
end;
$$;
drop trigger if exists outcome_measures_tenant_integrity on public.clinical_outcome_measures;
create trigger outcome_measures_tenant_integrity before insert or update on public.clinical_outcome_measures
 for each row execute function public.check_outcome_review_tenant();
drop trigger if exists plan_reviews_tenant_integrity on public.treatment_plan_review_drafts;
create trigger plan_reviews_tenant_integrity before insert or update on public.treatment_plan_review_drafts
 for each row execute function public.check_outcome_review_tenant();
revoke all on public.clinical_outcome_measures,public.treatment_plan_review_drafts from anon;
grant select,insert,update,delete on public.clinical_outcome_measures,public.treatment_plan_review_drafts to authenticated;
