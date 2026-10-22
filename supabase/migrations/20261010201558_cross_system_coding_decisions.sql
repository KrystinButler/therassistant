create or replace function public.apply_cross_system_diagnosis_sequence(
  p_encounter_id uuid,
  p_rule_id text,
  p_recommendation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encounter public.encounters%rowtype;
  v_item jsonb;
  v_code text;
  v_description text;
  v_sequence integer := 0;
begin
  select * into v_encounter from public.encounters where id=p_encounter_id;
  if not found or not private.has_tenant_write_access(v_encounter.tenant_id) then
    raise exception 'Encounter is unavailable';
  end if;
  if jsonb_typeof(p_recommendation) <> 'array' or jsonb_array_length(p_recommendation)=0 then
    raise exception 'Diagnosis recommendation is required';
  end if;
  if exists(select 1 from public.professional_claims where tenant_id=v_encounter.tenant_id and source_encounter_id=p_encounter_id) then
    raise exception 'An existing claim prevents diagnosis replacement here. Correct the claim workflow instead.';
  end if;

  update public.encounter_diagnoses
  set present_on_claim=false, is_primary=false, updated_at=now()
  where tenant_id=v_encounter.tenant_id and encounter_id=p_encounter_id;

  for v_item in select value from jsonb_array_elements(p_recommendation) loop
    v_code := upper(btrim(v_item ->> 'code'));
    v_description := nullif(btrim(v_item ->> 'description'),'');
    if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9.]{1,15}$' then
      raise exception 'Invalid diagnosis code recommendation';
    end if;
    v_sequence := v_sequence + 1;
    insert into public.encounter_diagnoses(
      tenant_id,encounter_id,client_id,diagnosis_code,diagnosis_description,is_primary,sequence_number,present_on_claim
    ) values (
      v_encounter.tenant_id,p_encounter_id,v_encounter.client_id,v_code,v_description,v_sequence=1,v_sequence,true
    )
    on conflict (encounter_id,diagnosis_code) do update set
      diagnosis_description=excluded.diagnosis_description,
      is_primary=excluded.is_primary,
      sequence_number=excluded.sequence_number,
      present_on_claim=true,
      client_id=coalesce(public.encounter_diagnoses.client_id,excluded.client_id),
      updated_at=now();
  end loop;

  insert into public.clinical_cross_mapping_decisions(
    tenant_id,encounter_id,rule_id,recommendation,action,rejection_justification
  ) values (
    v_encounter.tenant_id,p_encounter_id,coalesce(nullif(btrim(p_rule_id),''),'cross-system'),p_recommendation,'accepted',null
  );

  return jsonb_build_object('applied',true,'encounter_id',p_encounter_id,'diagnosis_count',v_sequence);
end;
$$;
revoke all on function public.apply_cross_system_diagnosis_sequence(uuid,text,jsonb) from public, anon;
grant execute on function public.apply_cross_system_diagnosis_sequence(uuid,text,jsonb) to authenticated;

create or replace function public.record_cross_system_coding_rejection(
  p_encounter_id uuid,
  p_rule_id text,
  p_recommendation jsonb,
  p_justification text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encounter public.encounters%rowtype;
  v_reason text := nullif(btrim(p_justification),'');
begin
  select * into v_encounter from public.encounters where id=p_encounter_id;
  if not found or not private.has_tenant_write_access(v_encounter.tenant_id) then
    raise exception 'Encounter is unavailable';
  end if;
  if v_reason is null then raise exception 'A justification is required to keep the current coding'; end if;
  if jsonb_typeof(p_recommendation) <> 'array' or jsonb_array_length(p_recommendation)=0 then
    raise exception 'Diagnosis recommendation is required';
  end if;
  insert into public.clinical_cross_mapping_decisions(
    tenant_id,encounter_id,rule_id,recommendation,action,rejection_justification
  ) values (
    v_encounter.tenant_id,p_encounter_id,coalesce(nullif(btrim(p_rule_id),''),'cross-system'),p_recommendation,'rejected',v_reason
  );
  return jsonb_build_object('recorded',true);
end;
$$;
revoke all on function public.record_cross_system_coding_rejection(uuid,text,jsonb,text) from public, anon;
grant execute on function public.record_cross_system_coding_rejection(uuid,text,jsonb,text) to authenticated;