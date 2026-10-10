-- Keep audit logging from rolling back valid business writes when a stale tenant id is encountered.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer
set search_path to 'public','auth'
as $function$
declare
  v_raw_tenant_id uuid;
  v_valid_tenant_id uuid;
  v_target_id text;
  v_metadata jsonb := '{}'::jsonb;
begin
  v_raw_tenant_id := coalesce(nullif(to_jsonb(new)->>'tenant_id','')::uuid, nullif(to_jsonb(old)->>'tenant_id','')::uuid);
  v_target_id := coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id');
  if v_raw_tenant_id is not null then
    select id into v_valid_tenant_id from public.tenants where id=v_raw_tenant_id;
    if v_valid_tenant_id is null then
      v_metadata := jsonb_build_object('orphan_tenant_id',v_raw_tenant_id::text,'audit_warning','source row supplied tenant_id not present in tenants at audit time');
    end if;
  end if;
  insert into public.audit_logs(tenant_id,actor_id,action,target_type,target_id,old_values,new_values,metadata)
  values(v_valid_tenant_id,auth.uid(),tg_op,tg_table_name,v_target_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    v_metadata);
  return coalesce(new,old);
end;
$function$;

alter table public.claim_submissions
  add column if not exists encounter_id uuid,
  add column if not exists client_id uuid,
  add column if not exists practice_entity_id uuid,
  add column if not exists provider_location_id uuid,
  add column if not exists insurance_policy_id uuid,
  add column if not exists x12_version text,
  add column if not exists transaction_set_type text,
  add column if not exists interchange_control_number text,
  add column if not exists group_control_number text,
  add column if not exists transaction_set_control_number text,
  add column if not exists submitter_identifier text,
  add column if not exists receiver_identifier text,
  add column if not exists x12_snapshot jsonb not null default '{}'::jsonb;

update public.claim_submissions
set encounter_id=coalesce(encounter_id,"Encounter"), client_id=coalesce(client_id,client)
where (encounter_id is null and "Encounter" is not null) or (client_id is null and client is not null);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='claim_submissions_encounter_id_fkey') then alter table public.claim_submissions add constraint claim_submissions_encounter_id_fkey foreign key(encounter_id) references public.encounters(id) on delete set null; end if;
  if not exists(select 1 from pg_constraint where conname='claim_submissions_client_id_fkey') then alter table public.claim_submissions add constraint claim_submissions_client_id_fkey foreign key(client_id) references public.clients(id) on delete set null; end if;
  if not exists(select 1 from pg_constraint where conname='claim_submissions_practice_entity_id_fkey') then alter table public.claim_submissions add constraint claim_submissions_practice_entity_id_fkey foreign key(practice_entity_id) references public.practice_entities(id) on delete set null; end if;
  if not exists(select 1 from pg_constraint where conname='claim_submissions_provider_location_id_fkey') then alter table public.claim_submissions add constraint claim_submissions_provider_location_id_fkey foreign key(provider_location_id) references public.provider_locations(id) on delete set null; end if;
  if not exists(select 1 from pg_constraint where conname='claim_submissions_insurance_policy_id_fkey') then alter table public.claim_submissions add constraint claim_submissions_insurance_policy_id_fkey foreign key(insurance_policy_id) references public.client_insurance_policies(id) on delete set null; end if;
end $$;

update public.claim_submissions cs
set practice_entity_id=coalesce(cs.practice_entity_id,pc.practice_entity_id),
    provider_location_id=coalesce(cs.provider_location_id,pc.provider_location_id),
    insurance_policy_id=coalesce(cs.insurance_policy_id,pc.insurance_policy_id),
    encounter_id=coalesce(cs.encounter_id,pc.source_encounter_id),
    client_id=coalesce(cs.client_id,pc.client_id)
from public.professional_claims pc where pc.id=cs.claim_id;

create index if not exists idx_claim_submissions_encounter_id on public.claim_submissions(encounter_id);
create index if not exists idx_claim_submissions_client_id on public.claim_submissions(client_id);
create index if not exists idx_claim_submissions_practice_entity_id on public.claim_submissions(practice_entity_id);
create index if not exists idx_claim_submissions_provider_location_id on public.claim_submissions(provider_location_id);
create index if not exists idx_claim_submissions_insurance_policy_id on public.claim_submissions(insurance_policy_id);
create index if not exists idx_claim_submissions_x12_controls on public.claim_submissions(tenant_id,interchange_control_number,group_control_number,transaction_set_control_number);
