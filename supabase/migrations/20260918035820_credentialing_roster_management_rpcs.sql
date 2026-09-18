
create or replace function public.create_roster_action_work(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_action_type public.roster_action_type_enum,
  p_participation_id uuid default null,
  p_requested_change jsonb default '{}'::jsonb,
  p_notes text default null,
  p_due_date date default null,
  p_priority public.workqueue_priority_enum default 'normal'
)
returns table(roster_action_id uuid, workqueue_item_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_roster_action_id uuid;
  v_workqueue_item_id uuid;
  v_provider_name text;
  v_payer_name text;
  v_description text;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select
    concat_ws(' ', p.first_name, p.last_name),
    py.name
  into v_provider_name, v_payer_name
  from public.provider_payer_enrollments e
  join public.providers p
    on p.id = e.provider_id
   and p.tenant_id = e.tenant_id
  join public.payers py
    on py.id = e.payer_id
  where e.id = p_enrollment_id
    and e.tenant_id = p_tenant_id;

  if v_provider_name is null then
    raise exception 'Enrollment not found for tenant'
      using errcode = '22023';
  end if;

  if p_participation_id is not null and not exists (
    select 1
    from public.provider_network_participation np
    where np.id = p_participation_id
      and np.tenant_id = p_tenant_id
      and np.enrollment_id = p_enrollment_id
  ) then
    raise exception 'Network participation does not match enrollment'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.roster_actions ra
    where ra.tenant_id = p_tenant_id
      and ra.enrollment_id = p_enrollment_id
      and ra.action_type = p_action_type
      and ra.requested_change = coalesce(p_requested_change, '{}'::jsonb)
      and ra.status not in ('confirmed', 'rejected', 'cancelled')
  ) then
    raise exception 'An active matching roster action already exists'
      using errcode = '23505';
  end if;

  insert into public.roster_actions (
    tenant_id,
    enrollment_id,
    participation_id,
    action_type,
    status,
    requested_date,
    requested_change,
    notes
  )
  values (
    p_tenant_id,
    p_enrollment_id,
    p_participation_id,
    p_action_type,
    'ready',
    current_date,
    coalesce(p_requested_change, '{}'::jsonb),
    nullif(btrim(p_notes), '')
  )
  returning id into v_roster_action_id;

  v_description := coalesce(
    nullif(btrim(p_notes), ''),
    nullif(coalesce(p_requested_change, '{}'::jsonb)->>'details', ''),
    'Payer roster maintenance action'
  );

  v_workqueue_item_id := public.create_workqueue_item(
    p_tenant_id := p_tenant_id,
    p_workqueue_type := 'roster_action',
    p_source_object_type := 'roster_action',
    p_source_object_id := v_roster_action_id,
    p_title := 'Roster: ' || initcap(replace(p_action_type::text, '_', ' ')) ||
      ' - ' || v_provider_name || ' / ' || v_payer_name,
    p_description := v_description,
    p_priority := coalesce(p_priority, 'normal'),
    p_due_date := p_due_date,
    p_assigned_user_id := null
  );

  return query
  select v_roster_action_id, v_workqueue_item_id;
end;
$function$;

create or replace function public.transition_roster_action(
  p_tenant_id uuid,
  p_roster_action_id uuid,
  p_status public.roster_action_status_enum,
  p_reference_number text default null,
  p_notes text default null
)
returns public.roster_actions
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_old_status public.roster_action_status_enum;
  v_row public.roster_actions;
  v_workqueue_status public.workqueue_status_enum;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select ra.status
  into v_old_status
  from public.roster_actions ra
  where ra.id = p_roster_action_id
    and ra.tenant_id = p_tenant_id
  for update;

  if v_old_status is null then
    raise exception 'Roster action not found for tenant'
      using errcode = '22023';
  end if;

  update public.roster_actions
  set
    status = p_status,
    submitted_date = case
      when p_status = 'submitted' and submitted_date is null then current_date
      else submitted_date
    end,
    confirmed_date = case
      when p_status = 'confirmed' and confirmed_date is null then current_date
      when p_status <> 'confirmed' then null
      else confirmed_date
    end,
    reference_number = coalesce(nullif(btrim(p_reference_number), ''), reference_number),
    notes = coalesce(nullif(btrim(p_notes), ''), notes)
  where id = p_roster_action_id
    and tenant_id = p_tenant_id
  returning * into v_row;

  if v_old_status is distinct from p_status then
    insert into public.status_history (
      tenant_id,
      target_type,
      target_id,
      old_status,
      new_status,
      changed_by,
      reason
    )
    values (
      p_tenant_id,
      'roster_action',
      p_roster_action_id,
      v_old_status::text,
      p_status::text,
      auth.uid(),
      nullif(btrim(p_notes), '')
    );
  end if;

  v_workqueue_status := case p_status
    when 'submitted' then 'in_progress'::public.workqueue_status_enum
    when 'pending' then 'pending'::public.workqueue_status_enum
    when 'confirmed' then 'completed'::public.workqueue_status_enum
    when 'cancelled' then 'cancelled'::public.workqueue_status_enum
    else 'open'::public.workqueue_status_enum
  end;

  update public.workqueue_items
  set
    workqueue_status = v_workqueue_status,
    completed_at = case
      when v_workqueue_status = 'completed' then coalesce(completed_at, now())
      else null
    end,
    completed_by = case
      when v_workqueue_status = 'completed' then coalesce(completed_by, auth.uid())
      else null
    end
  where tenant_id = p_tenant_id
    and workqueue_type = 'roster_action'
    and source_object_type = 'roster_action'
    and source_object_id = p_roster_action_id
    and workqueue_status <> v_workqueue_status;

  return v_row;
end;
$function$;

revoke all on function public.create_roster_action_work(
  uuid, uuid, public.roster_action_type_enum, uuid, jsonb, text, date, public.workqueue_priority_enum
) from public, anon;
grant execute on function public.create_roster_action_work(
  uuid, uuid, public.roster_action_type_enum, uuid, jsonb, text, date, public.workqueue_priority_enum
) to authenticated, service_role;

revoke all on function public.transition_roster_action(
  uuid, uuid, public.roster_action_status_enum, text, text
) from public, anon;
grant execute on function public.transition_roster_action(
  uuid, uuid, public.roster_action_status_enum, text, text
) to authenticated, service_role;

