-- Signing remains clinical-only. Persist recovery work before billing is attempted.
-- Reuse Work Center rather than introduce another queue/table.
-- Direct browser writes must have the same signer checks as the RPC. The
-- future Express API uses a trusted database connection and checks these
-- identities in its authenticated handler; no broader API deployment is added.
drop policy if exists "clinical_note_signatures tenant insert" on public.clinical_note_signatures;
drop policy if exists "demo anon insert clinical note signatures" on public.clinical_note_signatures;
create policy "linked clinician signature insert" on public.clinical_note_signatures
for insert to authenticated with check (
  signer_id=(select auth.uid()) and private.has_tenant_write_access(tenant_id)
  and exists(select 1 from public.tenant_user_roles r where r.tenant_id=clinical_note_signatures.tenant_id
    and r.user_id=(select auth.uid()) and r.role='clinician')
  and exists(select 1 from public.provider_user_links l where l.tenant_id=clinical_note_signatures.tenant_id
    and l.user_id=(select auth.uid()) and l.provider_id=clinical_note_signatures.provider_id and l.status='active')
  and exists(select 1 from public.clinical_notes n join public.tenants t on t.id=n.tenant_id
    where n.id=clinical_note_signatures.clinical_note_id and n.tenant_id=clinical_note_signatures.tenant_id
      and n.provider_id=clinical_note_signatures.provider_id
      and n.note_status in ('draft','in_progress','ready_for_signature')
      and nullif(trim(n.note_text),'') is not null
      and (n.service_date is null or n.service_date <= (now() at time zone t.timezone)::date))
  and nullif(trim(signature_text),'') is not null
);
revoke insert,update,delete on public.clinical_note_signatures from public,anon;
revoke update,delete on public.clinical_note_signatures from authenticated;

create or replace function private.ensure_clinical_billing_handoff(p_note_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $function$
declare
  v_note public.clinical_notes%rowtype;
  v_encounter public.encounters%rowtype;
  v_work_id uuid;
begin
  select * into v_note from public.clinical_notes where id=p_note_id;
  if not found then raise exception 'Clinical note not found'; end if;
  if v_note.encounter_id is null then return null; end if;
  select * into v_encounter from public.encounters
  where id=v_note.encounter_id and tenant_id=v_note.tenant_id for update;
  if not found or v_encounter.client_id is distinct from v_note.client_id
    or v_encounter.provider_id is distinct from v_note.provider_id then
    raise exception 'Clinical note does not match its source encounter';
  end if;
  if v_encounter.encounter_status='voided' then
    raise exception 'Voided encounters cannot be signed';
  end if;
  update public.encounters set encounter_status=case when encounter_status='closed' then encounter_status else 'completed' end,
    ended_at=coalesce(ended_at,now()), updated_at=now()
  where id=v_encounter.id and tenant_id=v_note.tenant_id;
  update public.appointments set appointment_status='completed', completed_at=coalesce(completed_at,now()), updated_at=now()
  where id=v_encounter.appointment_id and tenant_id=v_note.tenant_id
    and appointment_status not in ('cancelled','no_show','late_cancel','rescheduled');
  -- A retry must not reset an encounter already handed off to charges/claims.
  if v_encounter.billing_status='claimed' then return null; end if;
  if v_encounter.billing_status='charged'
    and exists(select 1 from public.encounter_service_lines where tenant_id=v_note.tenant_id and encounter_id=v_encounter.id)
    and not exists(select 1 from public.encounter_service_lines l where l.tenant_id=v_note.tenant_id and l.encounter_id=v_encounter.id
      and not exists(select 1 from public.charge_capture_items c where c.tenant_id=l.tenant_id
        and c.encounter_id=l.encounter_id and c.service_line_id=l.id
        and c.charge_status in ('ready_for_claim','claim_created','patient_responsibility','program_billing'))) then
    return null;
  end if;
  select id into v_work_id from public.workqueue_items
  where tenant_id=v_note.tenant_id and source_object_type='encounter'
    and source_object_id=v_encounter.id and workqueue_type='general_task'
    and title='Clinical billing handoff'
    and workqueue_status in ('open','in_progress','pending','snoozed','reopened')
  order by created_at,id limit 1;
  if v_work_id is null then
    insert into public.workqueue_items(tenant_id,workqueue_type,source_object_type,source_object_id,title,description,priority,due_date,created_by)
    values(v_note.tenant_id,'general_task','encounter',v_encounter.id,'Clinical billing handoff',
      'Signed clinical documentation needs charge reconciliation. Retry charge capture in Billing; do not re-sign the note.',
      'high',current_date,auth.uid()) returning id into v_work_id;
  end if;
  return v_work_id;
end;
$function$;
revoke all on function private.ensure_clinical_billing_handoff(uuid) from public,anon;
grant execute on function private.ensure_clinical_billing_handoff(uuid) to authenticated;

create or replace function private.queue_signed_clinical_billing_handoff()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if not exists(select 1 from public.clinical_notes where id=new.clinical_note_id and tenant_id=new.tenant_id) then
    raise exception 'Signature does not match its clinical note tenant';
  end if;
  perform private.ensure_clinical_billing_handoff(new.clinical_note_id);
  return new;
end;
$function$;
revoke all on function private.queue_signed_clinical_billing_handoff() from public,anon,authenticated;
drop trigger if exists trg_queue_signed_clinical_billing_handoff on public.clinical_note_signatures;
create trigger trg_queue_signed_clinical_billing_handoff after insert on public.clinical_note_signatures
for each row execute function private.queue_signed_clinical_billing_handoff();

create or replace function public.sign_encounter_note(
  p_encounter_id uuid, p_note_id uuid, p_provider_id uuid, p_signature_text text
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_note public.clinical_notes%rowtype;
  v_encounter public.encounters%rowtype;
  v_signed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Serialize note retries before the existing signature trigger locks the encounter.
  select * into v_note from public.clinical_notes where id=p_note_id and encounter_id=p_encounter_id for update;
  if not found then raise exception 'Clinical note not found'; end if;
  perform public.assert_tenant_access(v_note.tenant_id);
  if not exists(select 1 from public.tenant_user_roles where tenant_id=v_note.tenant_id
      and user_id=auth.uid() and role='clinician')
    or not exists(select 1 from public.provider_user_links where tenant_id=v_note.tenant_id
      and user_id=auth.uid() and provider_id=v_note.provider_id and status='active') then
    raise exception 'A linked clinician account is required to sign this note' using errcode='42501';
  end if;
  select * into v_encounter from public.encounters where id=p_encounter_id and tenant_id=v_note.tenant_id for update;
  if not found or v_note.provider_id is distinct from p_provider_id
    or v_encounter.provider_id is distinct from v_note.provider_id
    or v_encounter.client_id is distinct from v_note.client_id
    or v_encounter.encounter_status='voided' then
    raise exception 'Clinical note does not match the signing provider and encounter';
  end if;
  if nullif(trim(v_note.note_text),'') is null or nullif(trim(p_signature_text),'') is null then
    raise exception 'Clinical documentation and signature text are required';
  end if;
  if v_note.service_date > (now() at time zone (select timezone from public.tenants where id=v_note.tenant_id))::date then
    raise exception 'Future-dated clinical notes cannot be signed';
  end if;
  if v_note.note_status in ('signed','locked') then
    select signed_at into v_signed_at from public.clinical_note_signatures
    where tenant_id=v_note.tenant_id and clinical_note_id=v_note.id order by signed_at,id limit 1;
    if v_signed_at is null then raise exception 'Signed note has no signature; review its audit history'; end if;
    perform private.ensure_clinical_billing_handoff(v_note.id);
  else
    if v_note.note_status not in ('draft','in_progress','ready_for_signature') then
      raise exception 'Clinical note cannot be signed from its current status';
    end if;
    insert into public.clinical_note_signatures(tenant_id,clinical_note_id,signer_id,provider_id,signature_text)
    values(v_note.tenant_id,v_note.id,auth.uid(),v_note.provider_id,trim(p_signature_text)) returning signed_at into v_signed_at;
    -- Explicit as well as trigger-backed: no browser PATCH can be lost.
    update public.clinical_notes set note_status='signed',locked_at=coalesce(locked_at,v_signed_at),updated_at=now()
    where id=v_note.id and tenant_id=v_note.tenant_id;
  end if;
  return jsonb_build_object('note_id',v_note.id,'signed_at',v_signed_at);
end;
$function$;
revoke all on function public.sign_encounter_note(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.sign_encounter_note(uuid,uuid,uuid,text) to authenticated;

create or replace function public.complete_clinical_billing_handoff(p_encounter_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $function$
declare v_encounter public.encounters%rowtype;
begin
  select * into v_encounter from public.encounters where id=p_encounter_id for update;
  if not found then raise exception 'Encounter not found'; end if;
  perform public.assert_tenant_access(v_encounter.tenant_id);
  if v_encounter.billing_status not in ('held','charged','claimed')
    or not exists(select 1 from public.encounter_service_lines where encounter_id=v_encounter.id and tenant_id=v_encounter.tenant_id)
    or exists(
      select 1 from public.encounter_service_lines l
      where l.encounter_id=v_encounter.id and l.tenant_id=v_encounter.tenant_id and not exists(
        select 1 from public.charge_capture_items c join public.clinical_notes n
          on n.id=c.clinical_note_id and n.tenant_id=c.tenant_id
        where c.tenant_id=l.tenant_id and c.encounter_id=l.encounter_id and c.service_line_id=l.id
          and c.client_id=v_encounter.client_id and c.provider_id is not distinct from v_encounter.provider_id
          and n.encounter_id=v_encounter.id and n.note_status in ('signed','locked')
          and c.charge_status in ('ready_for_claim','claim_created','patient_responsibility','program_billing','blocked')
          and (c.charge_status <> 'blocked' or v_encounter.billing_status='held')
      )
    ) then return false; end if;
  if v_encounter.billing_status='held' and not exists(
    select 1 from public.workqueue_items where tenant_id=v_encounter.tenant_id
      and source_object_type='encounter' and source_object_id=v_encounter.id
      and workqueue_type in ('eligibility_issue','credentialing_issue','missing_documentation','charge_validation')
      and workqueue_status in ('open','in_progress','pending','snoozed','reopened')
  ) then return false; end if;
  update public.workqueue_items set workqueue_status='completed',completed_at=coalesce(completed_at,now()),
    completed_by=auth.uid(),updated_at=now()
  where tenant_id=v_encounter.tenant_id and source_object_type='encounter' and source_object_id=v_encounter.id
    and workqueue_type='general_task' and title='Clinical billing handoff'
    and workqueue_status in ('open','in_progress','pending','snoozed','reopened');
  return true;
end;
$function$;
revoke all on function public.complete_clinical_billing_handoff(uuid) from public,anon;
grant execute on function public.complete_clinical_billing_handoff(uuid) to authenticated;

-- Recover existing signed encounters that have not reached charge/claim completion.
insert into public.workqueue_items(tenant_id,workqueue_type,source_object_type,source_object_id,title,description,priority)
select e.tenant_id,'general_task','encounter',e.id,'Clinical billing handoff',
  'Signed clinical documentation needs charge reconciliation. Retry charge capture in Billing; do not re-sign the note.','high'
from public.encounters e where e.billing_status <> 'claimed' and e.encounter_status <> 'voided'
  and (e.billing_status <> 'charged'
    or not exists(select 1 from public.encounter_service_lines l where l.tenant_id=e.tenant_id and l.encounter_id=e.id)
    or exists(select 1 from public.encounter_service_lines l where l.tenant_id=e.tenant_id and l.encounter_id=e.id
      and not exists(select 1 from public.charge_capture_items c where c.tenant_id=l.tenant_id
        and c.encounter_id=l.encounter_id and c.service_line_id=l.id
        and c.charge_status in ('ready_for_claim','claim_created','patient_responsibility','program_billing'))))
  and exists(select 1 from public.clinical_notes n where n.tenant_id=e.tenant_id and n.encounter_id=e.id and n.note_status in ('signed','locked'))
  and not exists(select 1 from public.workqueue_items w where w.tenant_id=e.tenant_id and w.source_object_type='encounter'
    and w.source_object_id=e.id and w.workqueue_type='general_task' and w.title='Clinical billing handoff'
    and w.workqueue_status in ('open','in_progress','pending','snoozed','reopened'));
