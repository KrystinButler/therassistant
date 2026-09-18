
create or replace function public.create_roster_action_work(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_action_type public.roster_action_type_enum,
  p_requested_change jsonb default '{}'::jsonb,
  p_notes text default null,
  p_due_date date default null,
  p_priority public.workqueue_priority_enum default 'normal'::public.workqueue_priority_enum,
  p_assigned_user_id uuid default null
)
returns table (
  roster_action_id uuid,
  workqueue_item_id uuid
)
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_action_id uuid;
  v_work_id uuid;
  v_participation_id uuid;
  v_provider_name text;
  v_payer_name text;
  v_action_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required';
  end if;

  select
    pnp.id,
    trim(concat_ws(' ', pr.first_name, pr.last_name)),
    py.name
  into
    v_participation_id,
    v_provider_name,
    v_payer_name
  from public.provider_payer_enrollments e
  join public.providers pr
    on pr.id = e.provider_id
   and pr.tenant_id = e.tenant_id
  join public.payers py
    on py.id = e.payer_id
  left join public.provider_network_participation pnp
    on pnp.enrollment_id = e.id
   and pnp.tenant_id = e.tenant_id
  where e.id = p_enrollment_id
    and e.tenant_id = p_tenant_id;

  if not found then
    raise exception 'Enrollment does not belong to tenant';
  end if;

  if exists (
    select 1
    from public.roster_actions ra
    where ra.tenant_id = p_tenant_id
      and ra.enrollment_id = p_enrollment_id
      and ra.action_type = p_action_type
      and ra.status not in (
        'confirmed'::public.roster_action_status_enum,
        'cancelled'::public.roster_action_status_enum
      )
  ) then
    raise exception 'An active roster action of this type already exists for the enrollment';
  end if;

  insert into public.roster_actions (
    tenant_id,
    enrollment_id,
    participation_id,
    action_type,
    status,
    requested_date,
    requested_change,
    notes,
    assigned_user_id
  )
  values (
    p_tenant_id,
    p_enrollment_id,
    v_participation_id,
    p_action_type,
    'not_started'::public.roster_action_status_enum,
    current_date,
    coalesce(p_requested_change, '{}'::jsonb),
    nullif(trim(p_notes), ''),
    p_assigned_user_id
  )
  returning id into v_action_id;

  v_action_label := replace(p_action_type::text, '_', ' ');

  v_work_id := public.create_workqueue_item(
    p_tenant_id,
    'roster_action'::public.workqueue_type_enum,
    'roster_action'::public.workqueue_source_object_type_enum,
    v_action_id,
    concat(
      'Roster: ',
      initcap(v_action_label),
      case when coalesce(v_provider_name, '') <> '' then concat(' · ', v_provider_name) else '' end,
      case when coalesce(v_payer_name, '') <> '' then concat(' · ', v_payer_name) else '' end
    ),
    nullif(trim(p_notes), ''),
    coalesce(p_priority, 'normal'::public.workqueue_priority_enum),
    p_due_date,
    p_assigned_user_id
  );

  return query select v_action_id, v_work_id;
end;
$function$;

revoke all on function public.create_roster_action_work(
  uuid,
  uuid,
  public.roster_action_type_enum,
  jsonb,
  text,
  date,
  public.workqueue_priority_enum,
  uuid
) from public, anon;

grant execute on function public.create_roster_action_work(
  uuid,
  uuid,
  public.roster_action_type_enum,
  jsonb,
  text,
  date,
  public.workqueue_priority_enum,
  uuid
) to authenticated, service_role;

create or replace function public.transition_roster_action(
  p_tenant_id uuid,
  p_roster_action_id uuid,
  p_status public.roster_action_status_enum,
  p_reference_number text default null,
  p_notes text default null,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_old_status public.roster_action_status_enum;
  v_enrollment_id uuid;
  v_reason text;
  v_work_status public.workqueue_status_enum;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required';
  end if;

  select status, enrollment_id
  into v_old_status, v_enrollment_id
  from public.roster_actions
  where id = p_roster_action_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Roster action does not belong to tenant';
  end if;

  if p_status = v_old_status then
    return p_roster_action_id;
  end if;

  if not (
    (v_old_status = 'not_started' and p_status in ('ready', 'cancelled')) or
    (v_old_status = 'ready' and p_status in ('submitted', 'cancelled')) or
    (v_old_status = 'submitted' and p_status in ('pending', 'confirmed', 'rejected')) or
    (v_old_status = 'pending' and p_status in ('confirmed', 'rejected', 'cancelled')) or
    (v_old_status = 'rejected' and p_status in ('ready', 'cancelled'))
  ) then
    raise exception 'Invalid roster action transition: % -> %', v_old_status, p_status;
  end if;

  update public.roster_actions
  set
    status = p_status,
    submitted_date = case
      when p_status = 'submitted' and submitted_date is null then current_date
      else submitted_date
    end,
    confirmed_date = case
      when p_status = 'confirmed' then current_date
      when p_status <> 'confirmed' then null
      else confirmed_date
    end,
    reference_number = coalesce(nullif(trim(p_reference_number), ''), reference_number),
    notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = p_roster_action_id
    and tenant_id = p_tenant_id;

  v_reason := coalesce(
    nullif(trim(p_reason), ''),
    concat('Roster action moved from ', v_old_status::text, ' to ', p_status::text)
  );

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
    v_reason
  );

  v_work_status := case
    when p_status = 'confirmed' then 'completed'::public.workqueue_status_enum
    when p_status = 'cancelled' then 'cancelled'::public.workqueue_status_enum
    when p_status = 'not_started' then 'open'::public.workqueue_status_enum
    else 'in_progress'::public.workqueue_status_enum
  end;

  update public.workqueue_items
  set
    workqueue_status = v_work_status,
    completed_at = case
      when v_work_status = 'completed' then now()
      else null
    end,
    completed_by = case
      when v_work_status = 'completed' then auth.uid()
      else null
    end
  where tenant_id = p_tenant_id
    and source_object_type = 'roster_action'::public.workqueue_source_object_type_enum
    and source_object_id = p_roster_action_id
    and workqueue_type = 'roster_action'::public.workqueue_type_enum
    and workqueue_status not in (
      'completed'::public.workqueue_status_enum,
      'cancelled'::public.workqueue_status_enum
    );

  return p_roster_action_id;
end;
$function$;

revoke all on function public.transition_roster_action(
  uuid,
  uuid,
  public.roster_action_status_enum,
  text,
  text,
  text
) from public, anon;

grant execute on function public.transition_roster_action(
  uuid,
  uuid,
  public.roster_action_status_enum,
  text,
  text,
  text
) to authenticated, service_role;

