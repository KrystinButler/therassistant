-- Atomic, retry-safe rejected-claim corrections. Applied migration: 20260925000330.
create table if not exists public.claim_correction_requests (
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  claim_id uuid not null references public.professional_claims(id) on delete cascade,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists claim_correction_requests_tenant_idx
  on public.claim_correction_requests(tenant_id,claim_id,created_at desc);
alter table public.claim_correction_requests enable row level security;
revoke all on public.claim_correction_requests from public,anon,authenticated;
grant select,insert,update on public.claim_correction_requests to authenticated;
drop policy if exists claim_correction_requests_select on public.claim_correction_requests;
create policy claim_correction_requests_select on public.claim_correction_requests for select to authenticated
 using (private.has_tenant_write_access(tenant_id));
drop policy if exists claim_correction_requests_insert on public.claim_correction_requests;
create policy claim_correction_requests_insert on public.claim_correction_requests for insert to authenticated
 with check (private.has_tenant_write_access(tenant_id));
drop policy if exists claim_correction_requests_update on public.claim_correction_requests;
create policy claim_correction_requests_update on public.claim_correction_requests for update to authenticated
 using (private.has_tenant_write_access(tenant_id))
 with check (private.has_tenant_write_access(tenant_id));

CREATE OR REPLACE FUNCTION public.rcm_save_rejection_corrections(p_claim_id uuid, p_request_id uuid, p_values jsonb, p_lines jsonb, p_diagnoses jsonb, p_revalidate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.professional_claims%rowtype;
  v_payload jsonb;
  v_existing public.claim_correction_requests%rowtype;
  v_row jsonb;
  v_id text;
  v_client uuid;
  v_rendering uuid;
  v_billing uuid;
  v_new_status public.claim_status_enum;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'An authenticated staff identity is required'
      using errcode = '42501';
  end if;
  select * into v_claim from public.professional_claims
    where id=p_claim_id for update;
  if not found or not private.has_tenant_write_access(v_claim.tenant_id) then
    raise exception 'Claim is unavailable for correction'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_typeof(p_diagnoses) is distinct from 'array' then
    raise exception 'Invalid correction payload' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'values',p_values,'lines',p_lines,'diagnoses',p_diagnoses,
    'revalidate',coalesce(p_revalidate,false)
  );
  insert into public.claim_correction_requests
    (request_id,tenant_id,claim_id,payload)
  values (p_request_id,v_claim.tenant_id,p_claim_id,v_payload)
  on conflict (request_id) do nothing;
  if not found then
    select * into v_existing from public.claim_correction_requests
      where request_id=p_request_id for update;
    if not found
       or v_existing.tenant_id<>v_claim.tenant_id
       or v_existing.claim_id<>p_claim_id
       or v_existing.payload<>v_payload
       or v_existing.result is null then
      raise exception 'Correction request ID was reused with different values'
        using errcode = '22023';
    end if;
    return v_existing.result || '{"replayed":true}'::jsonb;
  end if;

  v_client := nullif(p_values->>'client_id','')::uuid;
  v_rendering := nullif(p_values->>'rendering_provider_id','')::uuid;
  v_billing := nullif(p_values->>'billing_provider_id','')::uuid;
  if v_client is null or not exists (
    select 1 from public.clients where id=v_client and tenant_id=v_claim.tenant_id
  ) then
    raise exception 'Select a patient in the active practice before saving' using errcode='22023';
  end if;
  if (v_rendering is not null and not exists (
    select 1 from public.providers where id=v_rendering and tenant_id=v_claim.tenant_id))
    or (v_billing is not null and not exists (
    select 1 from public.providers where id=v_billing and tenant_id=v_claim.tenant_id)) then
    raise exception 'Provider must belong to the active practice' using errcode='22023';
  end if;

  v_new_status := v_claim.claim_status;
  if coalesce(p_revalidate,false) and v_new_status not in
    ('ready_for_validation'::public.claim_status_enum,
     'validation_failed'::public.claim_status_enum,
     'corrected'::public.claim_status_enum) then
    v_new_status := 'corrected'::public.claim_status_enum;
  end if;
  update public.professional_claims set
    client_id=v_client,
    payer_id=nullif(p_values->>'payer_id','')::uuid,
    rendering_provider_id=v_rendering,
    billing_provider_id=v_billing,
    patient_control_number=nullif(btrim(p_values->>'patient_control_number'),''),
    payer_claim_number=nullif(btrim(p_values->>'payer_claim_number'),''),
    service_date_from=nullif(p_values->>'service_date_from','')::date,
    service_date_to=nullif(p_values->>'service_date_to','')::date,
    total_charge_cents=greatest(0,coalesce(nullif(p_values->>'total_charge_cents','')::bigint,0)),
    claim_status=v_new_status
  where id=p_claim_id and tenant_id=v_claim.tenant_id;
  if not found then raise exception 'Unable to save claim fields'; end if;

  for v_row in select value from jsonb_array_elements(p_lines) loop
    v_id := v_row->>'id';
    if nullif(btrim(v_row->>'cpt_code'),'') is null
       or nullif(v_row->>'service_date','') is null
       or coalesce((v_row->>'units')::numeric,0)<=0
       or coalesce((v_row->>'charge_amount_cents')::bigint,0)<=0 then
      raise exception 'Each correction line requires date, procedure, units and charge'
        using errcode='22023';
    end if;
    if coalesce(v_id,'') like 'new:%' then
      insert into public.professional_claim_lines
        (tenant_id,claim_id,service_date,cpt_code,modifier1,modifier2,
         diagnosis_pointer,place_of_service,units,charge_amount_cents)
      values (v_claim.tenant_id,p_claim_id,(v_row->>'service_date')::date,
        upper(btrim(v_row->>'cpt_code')),
        nullif(upper(btrim(v_row->>'modifier1')),''),
        nullif(upper(btrim(v_row->>'modifier2')),''),
        nullif(btrim(v_row->>'diagnosis_pointer'),''),
        nullif(btrim(v_row->>'place_of_service'),''),
        (v_row->>'units')::numeric,(v_row->>'charge_amount_cents')::bigint);
    else
      update public.professional_claim_lines set
        service_date=(v_row->>'service_date')::date,
        cpt_code=upper(btrim(v_row->>'cpt_code')),
        modifier1=nullif(upper(btrim(v_row->>'modifier1')),''),
        modifier2=nullif(upper(btrim(v_row->>'modifier2')),''),
        diagnosis_pointer=nullif(btrim(v_row->>'diagnosis_pointer'),''),
        place_of_service=nullif(btrim(v_row->>'place_of_service'),''),
        units=(v_row->>'units')::numeric,
        charge_amount_cents=(v_row->>'charge_amount_cents')::bigint
      where id=v_id::uuid and claim_id=p_claim_id and tenant_id=v_claim.tenant_id;
      if not found then raise exception 'Claim line no longer belongs to this claim'; end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_diagnoses) loop
    v_id := v_row->>'id';
    if nullif(btrim(v_row->>'diagnosis_code'),'') is null then
      raise exception 'Diagnosis code is required' using errcode='22023';
    end if;
    if coalesce(v_id,'') like 'new:%' then
      insert into public.claim_diagnoses
        (tenant_id,claim_id,diagnosis_code,pointer_order)
      values (v_claim.tenant_id,p_claim_id,
        upper(btrim(v_row->>'diagnosis_code')),
        greatest(1,coalesce((v_row->>'pointer_order')::int,1)));
    else
      update public.claim_diagnoses set
        diagnosis_code=upper(btrim(v_row->>'diagnosis_code')),
        pointer_order=greatest(1,coalesce((v_row->>'pointer_order')::int,1))
      where id=v_id::uuid and claim_id=p_claim_id and tenant_id=v_claim.tenant_id;
      if not found then raise exception 'Diagnosis no longer belongs to this claim'; end if;
    end if;
  end loop;

  v_result := jsonb_build_object('claim_id',p_claim_id,'saved',true,'replayed',false);
  update public.claim_correction_requests set result=v_result
    where request_id=p_request_id and tenant_id=v_claim.tenant_id;
  return v_result;
end;
$function$;

revoke all on function public.rcm_save_rejection_corrections(uuid,uuid,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.rcm_save_rejection_corrections(uuid,uuid,jsonb,jsonb,jsonb,boolean) to authenticated;
