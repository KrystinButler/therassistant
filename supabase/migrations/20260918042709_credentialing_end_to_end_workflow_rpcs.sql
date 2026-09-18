
create or replace function public.create_credentialing_case(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_payer_id uuid,
  p_payer_plan_id uuid default null,
  p_practice_entity_id uuid default null,
  p_practice_location_id uuid default null,
  p_payer_contract_id uuid default null,
  p_application_type text default 'initial',
  p_priority public.workqueue_priority_enum default 'normal',
  p_notes text default null
)
returns table(enrollment_id uuid, application_id uuid)
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $function$
declare
  v_enrollment_id uuid;
  v_application_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  v_enrollment_id := public.upsert_scoped_provider_enrollment(
    p_tenant_id := p_tenant_id,
    p_provider_id := p_provider_id,
    p_payer_id := p_payer_id,
    p_payer_plan_id := p_payer_plan_id,
    p_practice_entity_id := p_practice_entity_id,
    p_practice_location_id := p_practice_location_id,
    p_payer_contract_id := p_payer_contract_id,
    p_enrollment_status := 'in_progress',
    p_notes := p_notes
  );

  if exists (
    select 1
    from public.credentialing_applications ca
    where ca.tenant_id = p_tenant_id
      and ca.enrollment_id = v_enrollment_id
      and ca.status not in ('complete','denied','withdrawn','terminated','closed')
  ) then
    raise exception 'An active credentialing application already exists for this scope'
      using errcode = '23505';
  end if;

  insert into public.credentialing_applications (
    tenant_id,
    enrollment_id,
    application_type,
    status,
    priority,
    notes
  )
  values (
    p_tenant_id,
    v_enrollment_id,
    coalesce(nullif(btrim(p_application_type), ''), 'initial'),
    'intake',
    coalesce(p_priority, 'normal'),
    nullif(btrim(p_notes), '')
  )
  returning id into v_application_id;

  return query select v_enrollment_id, v_application_id;
end;
$function$;

create or replace function public.transition_credentialing_application(
  p_tenant_id uuid,
  p_application_id uuid,
  p_status public.credentialing_application_status_enum,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $function$
declare
  v_old_status public.credentialing_application_status_enum;
  v_enrollment_id uuid;
  v_enrollment_status public.provider_enrollment_status_enum;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select ca.status, ca.enrollment_id
  into v_old_status, v_enrollment_id
  from public.credentialing_applications ca
  where ca.id = p_application_id
    and ca.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Credentialing application not found for tenant'
      using errcode = '22023';
  end if;

  if p_status is distinct from v_old_status and not (
    (v_old_status = 'not_started' and p_status in ('intake','closed')) or
    (v_old_status = 'intake' and p_status in ('missing_information','ready_to_submit','withdrawn','closed')) or
    (v_old_status = 'missing_information' and p_status in ('intake','ready_to_submit','withdrawn','closed')) or
    (v_old_status = 'ready_to_submit' and p_status in ('submitted','missing_information','withdrawn','closed')) or
    (v_old_status = 'submitted' and p_status in ('payer_review','additional_information_requested','approved','denied','withdrawn','closed')) or
    (v_old_status = 'payer_review' and p_status in ('additional_information_requested','approved','denied','withdrawn','closed')) or
    (v_old_status = 'additional_information_requested' and p_status in ('submitted','payer_review','approved','denied','withdrawn','closed')) or
    (v_old_status = 'approved' and p_status in ('effective','denied','closed')) or
    (v_old_status = 'effective' and p_status in ('roster_verified','terminated','closed')) or
    (v_old_status = 'roster_verified' and p_status in ('directory_verified','terminated','closed')) or
    (v_old_status = 'directory_verified' and p_status in ('complete','terminated','closed')) or
    (v_old_status = 'complete' and p_status in ('recredentialing_due','terminated')) or
    (v_old_status = 'denied' and p_status in ('ready_to_submit','closed')) or
    (v_old_status = 'withdrawn' and p_status = 'closed') or
    (v_old_status = 'terminated' and p_status = 'closed') or
    (v_old_status = 'recredentialing_due' and p_status in ('intake','closed','terminated'))
  ) then
    raise exception 'Invalid credentialing application transition: % -> %', v_old_status, p_status
      using errcode = '22023';
  end if;

  update public.credentialing_applications
  set
    status = p_status,
    submitted_date = case
      when p_status = 'submitted' and submitted_date is null then current_date
      else submitted_date
    end,
    payer_received_date = case
      when p_status = 'payer_review' and payer_received_date is null then current_date
      else payer_received_date
    end,
    decision_date = case
      when p_status in ('approved','denied') and decision_date is null then current_date
      else decision_date
    end,
    closed_date = case
      when p_status in ('closed','withdrawn','terminated') and closed_date is null then current_date
      else closed_date
    end,
    notes = case
      when nullif(btrim(p_reason), '') is not null
        then concat_ws(E'\n', nullif(notes,''), '[' || current_date::text || '] ' || btrim(p_reason))
      else notes
    end
  where id = p_application_id
    and tenant_id = p_tenant_id;

  v_enrollment_status := case
    when p_status in ('intake','missing_information','ready_to_submit') then 'in_progress'::public.provider_enrollment_status_enum
    when p_status in ('submitted','payer_review','additional_information_requested') then 'submitted'::public.provider_enrollment_status_enum
    when p_status in ('approved','effective','roster_verified','directory_verified','complete') then 'approved'::public.provider_enrollment_status_enum
    when p_status = 'denied' then 'denied'::public.provider_enrollment_status_enum
    when p_status = 'terminated' then 'terminated'::public.provider_enrollment_status_enum
    when p_status = 'recredentialing_due' then 'needs_revalidation'::public.provider_enrollment_status_enum
    else null
  end;

  if v_enrollment_status is not null then
    update public.provider_payer_enrollments
    set enrollment_status = v_enrollment_status
    where id = v_enrollment_id
      and tenant_id = p_tenant_id
      and enrollment_status is distinct from v_enrollment_status;
  end if;

  if p_status in ('complete','denied','withdrawn','terminated','closed') then
    update public.workqueue_items
    set
      workqueue_status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completed_by = coalesce(completed_by, auth.uid())
    where tenant_id = p_tenant_id
      and workqueue_type = 'credentialing_followup'
      and source_object_type = 'credentialing_application'
      and source_object_id = p_application_id
      and workqueue_status not in ('completed','cancelled');
  end if;

  return p_application_id;
end;
$function$;

create or replace function public.record_credentialing_followup(
  p_tenant_id uuid,
  p_application_id uuid,
  p_followup_date date default current_date,
  p_channel text default null,
  p_contact_name text default null,
  p_contact_details text default null,
  p_reference_number text default null,
  p_outcome text default null,
  p_next_followup_date date default null,
  p_notes text default null
)
returns table(followup_id uuid, workqueue_item_id uuid)
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $function$
declare
  v_followup_id uuid;
  v_workqueue_id uuid;
  v_provider_name text;
  v_payer_name text;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select
    concat_ws(' ', pr.first_name, pr.last_name),
    py.name
  into v_provider_name, v_payer_name
  from public.credentialing_applications ca
  join public.provider_payer_enrollments e
    on e.id = ca.enrollment_id
   and e.tenant_id = ca.tenant_id
  join public.providers pr
    on pr.id = e.provider_id
   and pr.tenant_id = e.tenant_id
  join public.payers py on py.id = e.payer_id
  where ca.id = p_application_id
    and ca.tenant_id = p_tenant_id;

  if not found then
    raise exception 'Credentialing application not found for tenant'
      using errcode = '22023';
  end if;

  insert into public.credentialing_followups (
    tenant_id,
    application_id,
    followup_date,
    channel,
    contact_name,
    contact_details,
    reference_number,
    outcome,
    next_followup_date,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    p_application_id,
    coalesce(p_followup_date, current_date),
    nullif(btrim(p_channel), ''),
    nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_contact_details), ''),
    nullif(btrim(p_reference_number), ''),
    nullif(btrim(p_outcome), ''),
    p_next_followup_date,
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_followup_id;

  select w.id
  into v_workqueue_id
  from public.workqueue_items w
  where w.tenant_id = p_tenant_id
    and w.workqueue_type = 'credentialing_followup'
    and w.source_object_type = 'credentialing_application'
    and w.source_object_id = p_application_id
    and w.workqueue_status not in ('completed','cancelled')
  order by w.created_at desc
  limit 1
  for update;

  if p_next_followup_date is null then
    if v_workqueue_id is not null then
      update public.workqueue_items
      set
        workqueue_status = 'completed',
        completed_at = coalesce(completed_at, now()),
        completed_by = coalesce(completed_by, auth.uid())
      where id = v_workqueue_id;
    end if;
  elsif v_workqueue_id is null then
    v_workqueue_id := public.create_workqueue_item(
      p_tenant_id := p_tenant_id,
      p_workqueue_type := 'credentialing_followup',
      p_source_object_type := 'credentialing_application',
      p_source_object_id := p_application_id,
      p_title := 'Credentialing follow-up · ' || v_provider_name || ' · ' || v_payer_name,
      p_description := coalesce(nullif(btrim(p_outcome), ''), nullif(btrim(p_notes), ''), 'Payer follow-up due'),
      p_priority := 'normal',
      p_due_date := p_next_followup_date,
      p_assigned_user_id := null
    );
  else
    update public.workqueue_items
    set
      workqueue_status = 'open',
      due_date = p_next_followup_date,
      title = 'Credentialing follow-up · ' || v_provider_name || ' · ' || v_payer_name,
      description = coalesce(nullif(btrim(p_outcome), ''), nullif(btrim(p_notes), ''), description),
      completed_at = null,
      completed_by = null
    where id = v_workqueue_id;
  end if;

  return query select v_followup_id, v_workqueue_id;
end;
$function$;

revoke all on function public.create_credentialing_case(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, public.workqueue_priority_enum, text
) from public, anon;
grant execute on function public.create_credentialing_case(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, public.workqueue_priority_enum, text
) to authenticated, service_role;

revoke all on function public.transition_credentialing_application(
  uuid, uuid, public.credentialing_application_status_enum, text
) from public, anon;
grant execute on function public.transition_credentialing_application(
  uuid, uuid, public.credentialing_application_status_enum, text
) to authenticated, service_role;

revoke all on function public.record_credentialing_followup(
  uuid, uuid, date, text, text, text, text, text, date, text
) from public, anon;
grant execute on function public.record_credentialing_followup(
  uuid, uuid, date, text, text, text, text, text, date, text
) to authenticated, service_role;

