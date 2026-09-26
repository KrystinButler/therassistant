-- Atomic removal of unclaimed service lines; preserve all charge history.
create or replace function private.void_unclaimed_service_line_impl(
  p_encounter_id uuid, p_service_line_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_line public.encounter_service_lines%rowtype;
  v_voided integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before modifying billing data' using errcode='42501';
  end if;
  select e.tenant_id into v_tenant_id from public.encounters e
  where e.id=p_encounter_id for update;
  if v_tenant_id is null or not private.has_tenant_write_access(v_tenant_id) then
    raise exception 'Encounter is unavailable for this practice' using errcode='42501';
  end if;
  select * into v_line from public.encounter_service_lines l
  where l.id=p_service_line_id and l.encounter_id=p_encounter_id
    and l.tenant_id=v_tenant_id for update;
  if not found then
    raise exception 'Service line is unavailable for this encounter' using errcode='P0002';
  end if;
  if exists(select 1 from public.professional_claims p
            where p.source_encounter_id=p_encounter_id
            or p.charge_id in
              (select c.id from public.charge_capture_items c
               where c.service_line_id=p_service_line_id)) then
    raise exception 'Claim already exists; make this correction in Rejections or Claims' using errcode='23514';
  end if;
  if exists(select 1 from public.charge_capture_items c
            where c.service_line_id=p_service_line_id
              and c.charge_status not in ('blocked','ready_for_claim','voided')) then
    raise exception 'Posted, billed, or patient-responsibility charges cannot be voided here' using errcode='23514';
  end if;
  update public.charge_capture_items c set
    charge_status='voided',
    block_reason='Pre-claim service line correction',
    updated_at=now()
  where c.service_line_id=p_service_line_id
    and c.charge_status in ('blocked','ready_for_claim');
  get diagnostics v_voided=row_count;
  delete from public.encounter_service_lines
  where id=p_service_line_id and encounter_id=p_encounter_id;
  insert into public.audit_logs
    (tenant_id,actor_id,action,target_type,target_id,old_values,new_values,metadata)
  values
    (v_tenant_id,(select auth.uid()),'void_unclaimed_service_line',
     'encounter_service_line',p_service_line_id::text,to_jsonb(v_line),
     jsonb_build_object('removed',true,'voided_charge_count',v_voided),
     jsonb_build_object('encounter_id',p_encounter_id));
  return jsonb_build_object('voided',true,'encounter_id',p_encounter_id,
    'service_line_id',p_service_line_id,'voided_charge_count',v_voided);
end;
$function$;
revoke all on function private.void_unclaimed_service_line_impl(uuid,uuid) from public, anon, authenticated;
create or replace function public.void_unclaimed_service_line(
  p_encounter_id uuid,p_service_line_id uuid
) returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.void_unclaimed_service_line_impl(p_encounter_id,p_service_line_id);
$function$;
revoke all on function public.void_unclaimed_service_line(uuid,uuid) from public,anon;
grant execute on function public.void_unclaimed_service_line(uuid,uuid) to authenticated;
