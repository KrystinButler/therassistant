alter table public.claim_submissions alter column claim_id drop not null;

create or replace function public.rcm_record_external_submission(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_external_reference text,
  p_submission_method text default 'external_837p'
)
returns jsonb language plpgsql security invoker
set search_path=public,pg_temp
as $function$
declare
  v_batch public.claim_batches%rowtype;
  v_submission_id uuid;
  v_claim_count integer;
  v_submitted_at timestamptz := now();
  v_client_id uuid;
  v_encounter_id uuid;
  v_practice_entity_id uuid;
  v_provider_location_id uuid;
  v_insurance_policy_id uuid;
  v_claims jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);
  if nullif(trim(p_external_reference),'') is null then raise exception 'External submission reference is required.'; end if;

  select * into v_batch from public.claim_batches
  where tenant_id=p_tenant_id and id=p_batch_id for update;
  if not found then raise exception 'Claim batch not found.'; end if;
  if v_batch.batch_status not in ('ready'::public.claim_batch_status_enum,'created'::public.claim_batch_status_enum) then
    raise exception 'Batch cannot be submitted from status %.',v_batch.batch_status;
  end if;

  select count(*) into v_claim_count
  from public.claim_batch_items cbi join public.professional_claims pc on pc.id=cbi.claim_id and pc.tenant_id=cbi.tenant_id
  where cbi.tenant_id=p_tenant_id and cbi.batch_id=p_batch_id;
  if v_claim_count=0 then raise exception 'Batch has no claims to submit.'; end if;
  if exists(select 1 from public.claim_batch_items cbi join public.professional_claims pc on pc.id=cbi.claim_id and pc.tenant_id=cbi.tenant_id where cbi.tenant_id=p_tenant_id and cbi.batch_id=p_batch_id and pc.claim_status<>'batched'::public.claim_status_enum) then
    raise exception 'Every claim in the batch must be batched before submission.';
  end if;

  select
    case when count(distinct pc.client_id)=1 then min(pc.client_id) end,
    case when count(distinct pc.source_encounter_id) filter(where pc.source_encounter_id is not null)=1 then min(pc.source_encounter_id) end,
    case when count(distinct pc.practice_entity_id) filter(where pc.practice_entity_id is not null)=1 then min(pc.practice_entity_id) end,
    case when count(distinct pc.provider_location_id) filter(where pc.provider_location_id is not null)=1 then min(pc.provider_location_id) end,
    case when count(distinct pc.insurance_policy_id) filter(where pc.insurance_policy_id is not null)=1 then min(pc.insurance_policy_id) end,
    jsonb_agg(jsonb_build_object('claim_id',pc.id,'patient_control_number',pc.patient_control_number,'client_id',pc.client_id,'encounter_id',pc.source_encounter_id,'practice_entity_id',pc.practice_entity_id,'provider_location_id',pc.provider_location_id,'insurance_policy_id',pc.insurance_policy_id,'payer_id',pc.payer_id,'total_charge_cents',pc.total_charge_cents) order by pc.created_at,pc.id)
  into v_client_id,v_encounter_id,v_practice_entity_id,v_provider_location_id,v_insurance_policy_id,v_claims
  from public.claim_batch_items cbi join public.professional_claims pc on pc.id=cbi.claim_id and pc.tenant_id=cbi.tenant_id
  where cbi.tenant_id=p_tenant_id and cbi.batch_id=p_batch_id;

  insert into public.claim_submissions(
    tenant_id,batch_id,claim_id,encounter_id,client_id,practice_entity_id,provider_location_id,insurance_policy_id,
    submission_status,submission_method,submitted_at,response_payload,x12_version,transaction_set_type,x12_snapshot
  ) values(
    p_tenant_id,p_batch_id,null,v_encounter_id,v_client_id,v_practice_entity_id,v_provider_location_id,v_insurance_policy_id,
    'submitted'::public.submission_status_enum,coalesce(nullif(trim(p_submission_method),''),'external_837p'),v_submitted_at,
    jsonb_build_object('external_reference',trim(p_external_reference),'recorded_source','user_confirmed_external_submission'),
    '005010X222A1','837P',jsonb_build_object('batch_id',p_batch_id,'batch_name',v_batch.batch_name,'claim_count',v_claim_count,'total_charge_cents',v_batch.total_charge_cents,'edi_storage_path',v_batch.edi_storage_path,'edi_file_name',v_batch.edi_file_name,'edi_sha256',v_batch.edi_sha256,'edi_byte_length',v_batch.edi_byte_length,'edi_generated_at',v_batch.edi_generated_at,'edi_archived_at',v_batch.edi_archived_at,'claims',coalesce(v_claims,'[]'::jsonb))
  ) returning id into v_submission_id;

  update public.claim_batches set batch_status='submitted'::public.claim_batch_status_enum,submitted_at=v_submitted_at,updated_at=now() where tenant_id=p_tenant_id and id=p_batch_id;
  insert into public.claim_status_history(tenant_id,claim_id,old_status,new_status,changed_by,reason)
  select p_tenant_id,pc.id,pc.claim_status,'submitted'::public.claim_status_enum,auth.uid(),'External 837P submission recorded. Reference: '||trim(p_external_reference)
  from public.claim_batch_items cbi join public.professional_claims pc on pc.id=cbi.claim_id and pc.tenant_id=cbi.tenant_id
  where cbi.tenant_id=p_tenant_id and cbi.batch_id=p_batch_id;
  update public.professional_claims pc set claim_status='submitted'::public.claim_status_enum,submitted_at=v_submitted_at,updated_at=now()
  from public.claim_batch_items cbi where cbi.tenant_id=p_tenant_id and cbi.batch_id=p_batch_id and pc.tenant_id=cbi.tenant_id and pc.id=cbi.claim_id;
  return jsonb_build_object('batch_id',p_batch_id,'submission_id',v_submission_id,'claim_count',v_claim_count,'submitted_at',v_submitted_at);
end;
$function$;

revoke execute on function public.rcm_record_external_submission(uuid,uuid,text,text) from anon;
grant execute on function public.rcm_record_external_submission(uuid,uuid,text,text) to authenticated;
